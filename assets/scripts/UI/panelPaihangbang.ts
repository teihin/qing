import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import { ShowPanelMode } from "../common/GameDef";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import ConfigManager from "../logic/ConfigManager";
import LeaderboardScrollView from "../common/LeaderboardScrollView";
import PaiHangScrollItem from "../common/PaiHangScrollItem";

var KBEngine = require("kbengine");
const {ccclass, property} = cc._decorator;
type Board = "玩家手数榜" | "玩家赢分榜" | "代理红利榜";
type Mode = "club" | "hall";
interface RankingRequest {
    board: Board;
    self: boolean;
    page: number;
    filter: string;
    epoch: number;
    account: any;
}
/** 一个榜的四条通道：列表/自己 的命令名 + 推送路由名。 */
interface BoardChannel {
    list: string;
    self: string;
    listRoute: string;
    selfRoute: string;
}
/**
 * 俱乐部模式（game_mode=club）：三个榜共用「查询_俱乐部_活动_自己排名」，
 * 靠 rank_type 区分，推送都是 ClubActivitySelfRank。
 * 口径与单位见 服务器文档整理/俱乐部荣耀榜-客户端接口文档.md v2.5。
 */
const CLUB_SELF_HEADER = "查询_俱乐部_活动_自己排名";
/** 服务端新增：一次拿到三个榜 + 手数各档位的开启状态，推送 ClubActivityStatus。 */
const STATUS_HEADER = "查询_俱乐部_活动_状态";
const STATUS_CONTEXT = "club_rank_status";
const CLUB_SELF_ROUTE = "ClubActivitySelfRank";
const CLUB_CHANNELS: {[key: string]: BoardChannel} = {
    "玩家手数榜": {list: "查询_俱乐部_活动_玩家手数", self: CLUB_SELF_HEADER,
        listRoute: "ClubActivityPlayedcount", selfRoute: CLUB_SELF_ROUTE},
    "玩家赢分榜": {list: "查询_俱乐部_活动_玩家输赢", self: CLUB_SELF_HEADER,
        listRoute: "ClubActivityUserScore", selfRoute: CLUB_SELF_ROUTE},
    "代理红利榜": {list: "查询_俱乐部_活动_代理红利", self: CLUB_SELF_HEADER,
        listRoute: "ClubActivityProxyHongli", selfRoute: CLUB_SELF_ROUTE}
};
/** 大厅模式全平台榜：保留原命令，服务端没有俱乐部功能时回落用。 */
const HALL_CHANNELS: {[key: string]: BoardChannel} = {
    "玩家手数榜": {list: "查询_活动_玩家手数", self: "查询_活动_自己手数",
        listRoute: "ListActivityPlayedcount", selfRoute: "ListActivitySelfPlayedcount"},
    "玩家赢分榜": {list: "查询_活动_玩家输赢", self: "查询_活动_自己输赢",
        listRoute: "ListActivityUserScore", selfRoute: "ListActivitySelfUserScore"},
    "代理红利榜": {list: "查询_活动_代理红利", self: "查询_活动_自己红利",
        listRoute: "ListActivityProxyHongli", selfRoute: "ListActivitySelfProxyHongli"}
};
const BOARDS: Board[] = ["玩家手数榜", "玩家赢分榜", "代理红利榜"];
/** 手数榜的档位；每个档位在后台单独开关，探测时必须逐个问。 */
const PLAY_TYPES = ["1皮", "2皮", "5皮", "10皮", "20皮"];
/** 俱乐部榜「我的排名」的 rank_type。 */
const RANK_TYPES: {[key: string]: string} = {"玩家手数榜": "play", "玩家赢分榜": "score", "代理红利榜": "bonus"};

@ccclass
export default class panelPaihangbang extends UIPanelViewBase {
    @property(cc.Node)
    rowTemplate: cc.Node = null;

    private PAGE_PER_COUNT = 30;
    private selected: Board = "玩家手数榜";
    /** 俱乐部版客户端默认走俱乐部榜；服务端是纯大厅模式时自动回落到全平台榜。 */
    private mode: Mode = "club";
    private epoch = 0;
    private lists: {[key: string]: LeaderboardScrollView} = {};
    // Legacy replies have no request ID: serialize each reply channel and keep
    // its latest desired request so rapid filter changes cannot mix rows.
    private pending: {[key: string]: RankingRequest} = {};
    private desired: {[key: string]: RankingRequest} = {};
    /**
     * 探测「哪些榜开着」。客户端没有查活动开关的接口，只能每个榜打一次最小查询，
     * 用服务端文案「活动没有开启」判断关闭；其它错误（未开始 / 无权查看 / 网络）一律按开着处理，
     * 宁可多显示一个空榜，也不要把正在进行的榜藏掉。
     */
    private probePending: string[] = [];
    /** 探测回包结果：键是探测 context（probe_<rankType>[_档位]），值 on / off。 */
    private probeResult: {[key: string]: string} = {};
    /** 活动状态接口在飞；超时或失败时回落到逐榜探测。 */
    private statusPending = false;
    /** 回落探测进行中：这段时间内不发正常榜单请求，否则回包会串台、互相顶掉。 */
    private probing = false;
    /** header -> 榜，用于识别探测回包（服务端会把 context 覆盖成 header 名）。 */
    private probeHeaders: {[header: string]: string} = {};
    /** 探测完成后是否已经进入过某个榜；用户抢在探测前点了 tab 也置位，避免被探测结果顶掉。 */
    private listReady = false;

    onLoad() {
        super.onLoad();
        const events = [
            ["ListActivityPlayedcount", "OnListActivityPlayedcount"],
            ["ListActivitySelfPlayedcount", "OnListActivitySelfPlayedcount"],
            ["ListActivityUserScore", "OnListActivityUserScore"],
            ["ListActivitySelfUserScore", "OnListActivitySelfUserScore"],
            ["ListActivityProxyHongli", "ListActivityProxyHongli"],
            ["ListActivitySelfProxyHongli", "ListActivitySelfProxyHongli"],
            // 俱乐部榜路由；我的排名三个榜共用一个推送。
            ["ClubActivityPlayedcount", "OnClubActivityPlayedcount"],
            ["ClubActivityUserScore", "OnClubActivityUserScore"],
            ["ClubActivityProxyHongli", "OnClubActivityProxyHongli"],
            ["ClubActivitySelfRank", "OnClubActivitySelfRank"],
            ["ClubActivityStatus", "OnClubActivityStatus"],
            ["UserHashInfo", "OnUserHashInfo"], ["onHallCommand", "onHallCommand"],
            ["onDisconnected", "onDisconnected"], ["onReloginBaseappSuccessfully", "onRankingReconnect"]
        ];
        events.forEach(([event, handler]) => KBEngine.Event.register(event, this, handler));
        BOARDS.forEach(board => {
            const list = Tool.GetChild(this.node, "容器/" + board + "/列表").getComponent(LeaderboardScrollView);
            list.callBackFresh = (page: number) => this.queryList(board, page);
            this.lists[board] = list;
        });
    }

    onEnable() {
        this.epoch++;
        this.probePending = [];
        this.probeResult = {};
        this.listReady = false;
        this.probing = false;
        this.probeHeaders = {};
        this.statusPending = false;
        // 上一次可能把没开的榜 tab 藏了，重新打开先全部恢复，再由这次探测决定隐藏哪些。
        this.restoreAllBoards();
        const firstTab = this.tabNode("玩家手数榜");
        if (firstTab) firstTab.getComponent(cc.Toggle).isChecked = true;
        // 俱乐部榜先问开关，再决定显示哪几个 tab；大厅模式没有开关概念，照旧直接进第一个榜。
        if (this.mode === "club" && this.requestStatus()) return;
        this.enterBoard("玩家手数榜");
    }

    onDisable() { this.epoch++; }

    public onDisconnected() {
        this.epoch++;
        this.pending = {};
        this.desired = {};
        this.probePending = [];
        this.probeResult = {};
        this.statusPending = false;
        this.listReady = false;
        if (this.node.activeInHierarchy) this.resetHeader();
    }

    public onRankingReconnect() {
        if (!this.node.activeInHierarchy) return;
        this.probePending = [];
        this.probeResult = {};
        this.listReady = false;
        this.probing = false;
        this.probeHeaders = {};
        this.statusPending = false;
        this.restoreAllBoards();
        if (this.mode === "club" && this.requestStatus()) return;
        this.enterBoard(this.selected);
    }

    private enterBoard(board: Board) {
        this.listReady = true;
        this.selectBoard(board);
    }

    /**
     * 优先用服务端的 查询_俱乐部_活动_状态（推送 ClubActivityStatus）一次拿到全部开关；
     * 命令不存在 / 报错 / 1.2 秒没回包时回落到 beginProbe 兜底探测。
     */
    private requestStatus(): boolean {
        const account = GameDataManager.getAccount();
        if (!account) return false;
        this.probePending = [];
        this.probeResult = {};
        this.probeHeaders = {};
        this.probing = false;
        this.statusPending = true;
        const params: any = {header: STATUS_HEADER, context: STATUS_CONTEXT};
        account.reqHallCommand(JSON.stringify(params), "P@" + STATUS_HEADER);
        const epoch = this.epoch;
        this.scheduleOnce(() => {
            if (epoch !== this.epoch || !this.statusPending) return;
            this.statusPending = false;
            this.beginProbe();
        }, 1.2);
        return true;
    }

    /**
     * 兜底探测：状态接口不可用时，只探赢分 / 红利两个榜各一次。
     *
     * 手数榜不在这里探：它 5 个档位分别开关，而服务端回包会把 context 覆盖成 header 名，
     * 5 个用同一 header 的请求回包无法区分是哪个档位，硬判会藏错；宁可多显示一个空榜。
     */
    private beginProbe(): boolean {
        if (this.probing) return true;
        const account = GameDataManager.getAccount();
        if (!account) return false;
        this.probing = true;
        this.probePending = [];
        this.probeResult = {};
        this.probeHeaders = {};
        ["玩家赢分榜", "代理红利榜"].forEach(board => {
            const channel = CLUB_CHANNELS[board];
            const rankType = RANK_TYPES[board];
            this.probePending.push(rankType);
            this.probeHeaders[channel.list] = rankType;
            const params: any = {
                header: channel.list, page: "0", count: "1", is_zip: "0", context: "probe_" + rankType
            };
            account.reqHallCommand(JSON.stringify(params), "P@" + channel.list);
        });
        // 断线或服务端不回时不能一直空白：1 秒后按「开着」收尾。
        const epoch = this.epoch;
        this.scheduleOnce(() => {
            if (epoch !== this.epoch || !this.probing) return;
            this.finishProbe();
        }, 1);
        return true;
    }

    private finishProbe() {
        this.probing = false;
        this.probePending = [];
        this.probeHeaders = {};
        this.applyBoardVisibility();
    }

    /** 状态推送：字段结构兼容「按行」「按榜」「榜→档位」三种写法，认不出就回落探测。 */
    public OnClubActivityStatus(msg: string) {
        if (!this.statusPending) return;
        this.statusPending = false;
        try {
            const data = JSON.parse(msg);
            this.collectStatus(data && (data.ClubActivityStatus !== undefined ? data.ClubActivityStatus : data));
        } catch (error) {
            cc.warn("排行榜活动状态解析失败");
        }
        if (Object.keys(this.probeResult).length === 0) {
            this.beginProbe();
            return;
        }
        this.applyBoardVisibility();
    }

    private collectStatus(node: any) {
        if (node == null) return;
        if (Array.isArray(node)) {
            node.forEach(item => this.collectStatus(item));
            return;
        }
        if (typeof node !== "object") return;
        const rankType = node.rank_type != null ? node.rank_type : node.rankType;
        if (rankType) {
            // 文档 3.6：status 0 未开启 / 1 未开始 / 2 进行中 / 3 已结束；没有 status 时退回 activity_on。
            if (node.status != null && /^[0-3]$/.test(String(node.status).trim())) {
                this.recordStatus(String(rankType), String(node.dipi == null ? "" : node.dipi), String(node.status).trim());
            } else {
                const raw = node.activity_on != null ? node.activity_on : (node.activityOn != null ? node.activityOn : node.on);
                const on = this.onValue(raw);
                if (on !== null) this.recordStatus(String(rankType), String(node.dipi == null ? "" : node.dipi), on ? "2" : "0");
            }
        }
        Object.keys(node).forEach(key => {
            const lower = key.toLowerCase();
            if (lower === "play" || lower === "score" || lower === "bonus") {
                const value = node[key];
                const scalar = this.onValue(value);
                if (scalar !== null) {
                    this.recordStatus(lower, "", scalar ? "2" : "0");
                } else if (value && typeof value === "object" && !Array.isArray(value)) {
                    Object.keys(value).forEach(dipi => {
                        const inner = this.onValue(value[dipi]);
                        if (inner !== null) this.recordStatus(lower, dipi, inner ? "2" : "0");
                    });
                }
                return;
            }
            this.collectStatus(node[key]);
        });
    }

    private onValue(value: any): boolean {
        if (value === true || value === 1) return true;
        if (value === false || value === 0) return false;
        if (typeof value === "string") {
            const text = value.trim().toLowerCase();
            if (["1", "true", "on", "yes", "开"].indexOf(text) >= 0) return true;
            if (["0", "false", "off", "no", "关"].indexOf(text) >= 0) return false;
        }
        return null;
    }

    /** state 用服务端的 0/1/2/3（0 未开启，1 未开始，2 进行中，3 已结束）。 */
    private recordStatus(rankType: string, dipi: string, state: string) {
        this.probeResult["probe_" + rankType + (dipi ? "_" + dipi : "")] = state;
    }

    /** 探测回包：吞掉这类请求的 onHallCommand，避免走到正常失败处理里刷提示。 */
    private handleProbeReply(code: number, param: string): boolean {
        // 只有探测期间的该榜回包才吞掉，避免把正常列表请求当成探测回包。
        if (!this.probing) return false;
        let context = "";
        try {
            const data = JSON.parse(param);
            context = data && data.context ? String(data.context) : "";
        } catch (error) {
            return false;
        }
        // 服务端可能把 context 原样回传（probe_score），也可能覆盖成 header 名，两种都认。
        const rankType = context.indexOf("probe_") === 0
            ? context.slice(6)
            : (this.probeHeaders[context] || "");
        if (rankType === "") return false;
        const index = this.probePending.indexOf(rankType);
        if (index >= 0) this.probePending.splice(index, 1);
        const off = this.failureText(param).indexOf("活动没有开启") >= 0;
        this.probeResult["probe_" + rankType] = off ? "0" : "2";
        if (this.probePending.length === 0) this.finishProbe();
        return true;
    }

    /**
     * 某个榜是否要显示：
     * 0 未开启、1 未开始 都隐藏（运营常留未来时间的配置，玩家看到空榜没意义）；
     * 2 进行中、3 已结束 显示（已结束也要能看最终名次）；
     * 没有任何结论（超时/断线/没探到）一律显示，宁可多显示也不误藏。
     */
    private boardVisible(rankType: string): boolean {
        const prefix = "probe_" + rankType;
        const keys = Object.keys(this.probeResult).filter(key => key.indexOf(prefix) === 0);
        if (keys.length === 0) return true;
        return keys.some(key => this.probeResult[key] === "2" || this.probeResult[key] === "3" || this.probeResult[key] === "on");
    }

    /** 三个榜 tab 节点：走引擎原生按名取，避免嵌套路径解析出错。 */
    private tabNode(board: Board): cc.Node {
        const group = this.node.getChildByName("条件");
        return group ? group.getChildByName(board) : null;
    }

    /** 按探测结果隐藏未开启的榜；当前选中的榜被关掉时自动切到第一个开着的榜。 */
    private applyBoardVisibility() {
        if (this.mode !== "club" || !this.node.activeInHierarchy) return;
        if (this.probing || this.statusPending) return;
        let first: Board = null;
        const trace: string[] = [];
        BOARDS.forEach(board => {
            const visible = this.boardVisible(RANK_TYPES[board]);
            const toggle = this.tabNode(board);
            trace.push(board + "=" + (visible ? "on" : "off") + (toggle ? "" : "[无节点]"));
            if (toggle) toggle.active = visible;
            if (visible && !first) first = board;
        });
        cc.log("[排行榜] 榜单开关 " + trace.join(" ") + " 结果:" + JSON.stringify(this.probeResult));
        if (!first) {
            this.listReady = true;
            // 三个榜都没开：只留当前这个容器承载提示文案，其它容器隐藏。
            BOARDS.forEach(board => {
                const view = Tool.GetChild(this.node, "容器/" + board);
                if (view) view.active = board === this.selected;
            });
            if (this.lists[this.selected]) this.lists[this.selected].notice("本次活动还没有开启任何榜单");
            return;
        }
        if (!this.listReady) {
            this.enterBoard(first);
            return;
        }
        if (!this.boardVisible(RANK_TYPES[this.selected])) {
            const firstTab = this.tabNode(first);
            const toggle = firstTab ? firstTab.getComponent(cc.Toggle) : null;
            if (toggle) toggle.isChecked = true;
            this.selectBoard(first);
            return;
        }
        // 探测期间用户手动点过 tab 的话，selectBoard 已把列表清空但请求被挡下了，
        // 这里补一次加载（已经加载过的页 beginPage 会自己拒绝，不会重复请求）。
        this.queryList(this.selected, 0);
    }

    /** 回落到全平台榜时把三个 tab 恢复出来（大厅榜没有开关）。 */
    private restoreAllBoards() {
        BOARDS.forEach(board => {
            const toggle = this.tabNode(board);
            if (toggle) toggle.active = true;
        });
    }

    public onButtonClick(button: cc.Button) {
        if (button.node.name === "领取奖励") {
            if (this.selected === "玩家手数榜") this.LingquShoushu();
            else if (this.selected === "玩家赢分榜") this.LingquWin();
            else this.LingquHongli();
        } else if (button.node.name === "客服") {
            UIManager.getInstance().showPanel("panelKefu", ShowPanelMode.Cover);
        } else {
            super.onButtonClick(button);
        }
    }

    public onToggleClick(toggle: cc.Toggle) {
        if (!toggle.node.activeInHierarchy) return;
        if (!toggle.isChecked) {
            // 三个榜 tab 是单选，点当前这个不能把它点成"未选中"，否则界面会没有任何选中态。
            if (BOARDS.indexOf(toggle.node.name as Board) >= 0) toggle.isChecked = true;
            return;
        }
        const name = toggle.node.name;
        if (BOARDS.indexOf(name as Board) >= 0) {
            // 用户抢在探测前手动选榜：标记已进入，探测结果只负责隐藏 tab，不再改选择。
            this.listReady = true;
            this.selectBoard(name as Board);
        }
        else if (toggle.node.parent.name === "选择手数") {
            this.epoch++;
            this.resetHeader();
            this.lists["玩家手数榜"].clearPage();
            this.GetShouShuList(0, true);
        }
    }

    private selectBoard(board: Board) {
        this.epoch++;
        this.SwitchTab(board);
        this.resetHeader();
        this.lists[board].clearPage();
        this.lists[board].node.parent.getChildByName("V8空列表").active = false;
        this.queryList(board, 0);
        // 活动说明文本是全平台榜的运营文案，俱乐部榜不读，避免出现「全平台」口径。
        if (this.mode === "hall") ConfigManager.getInstance().GetOneHashKey("活动文本_" + board, "活动文本_" + board);
    }

    private channels(): {[key: string]: BoardChannel} {
        return this.mode === "club" ? CLUB_CHANNELS : HALL_CHANNELS;
    }

    /** pending/desired 的键：三个俱乐部自己排名共用一个命令名，必须按 榜+自己 区分。 */
    private keyOf(board: Board, self: boolean): string {
        return board + (self ? "|self" : "|list");
    }

    private headerOf(board: Board, self: boolean): string {
        return this.channels()[board][self ? "self" : "list"];
    }

    private routeOf(board: Board, self: boolean): string {
        return this.channels()[board][self ? "selfRoute" : "listRoute"];
    }

    public SwitchTab(name: string) {
        this.selected = name as Board;
        this.node.getChildByName("容器").children.forEach(child => child.active = child.name === name);
        // tab 的选中态：Toggle 靠 checkMark 节点显示，这里统一同步一遍，
        // 避免程序切榜（探测结果 / 回落大厅）时容器换了但高亮还停在旧 tab 上。
        BOARDS.forEach(board => {
            const tab = this.tabNode(board);
            if (!tab) return;
            const toggle = tab.getComponent(cc.Toggle);
            if (toggle && toggle.isChecked !== (board === name)) toggle.isChecked = board === name;
            const mark = Tool.GetChild(tab, "checkmark");
            if (mark) mark.active = board === name;
        });
    }

    private filter(): string {
        const toggles = Tool.GetChild(this.node, "容器/玩家手数榜/选择手数").getComponentsInChildren(cc.Toggle);
        const current = toggles.filter(t => t.node.active && t.isChecked)[0];
        return current ? current.node.name : "1皮";
    }

    private header(name: string, text: string) {
        Tool.GetChild(this.node, "广告/" + name).getComponent(cc.Label).string = text;
    }

    private resetHeader() {
        this.header("开始时间", "活动时间 —");
        this.header("结束时间", "至 —");
        this.header("V8本人指标", "");
        this.header("V8排名", "—");
        this.header("V8奖励", "—");
        this.header("我的信息", "");
        Tool.GetChild(this.node, "广告/领取奖励").active = false;
        Tool.GetChild(this.node, "广告/已领取").active = false;
    }

    private dates(data: any) {
        const format = (value: any) => value == null || value === "" ? "—" : String(value).replace(/-/g, "/").replace(/(\d{2}:\d{2}):\d{2}$/, "$1");
        if (data.start_date != null) this.header("开始时间", "活动时间 " + format(data.start_date));
        if (data.end_date != null) this.header("结束时间", "至 " + format(data.end_date));
    }

    private current(request: RankingRequest): boolean {
        return !!request && this.node.activeInHierarchy && request.epoch === this.epoch &&
            request.account === GameDataManager.getAccount() && request.board === this.selected &&
            (request.board !== "玩家手数榜" || request.filter === this.filter());
    }

    private same(a: RankingRequest, b: RankingRequest): boolean {
        return !!a && !!b && a.epoch === b.epoch && a.account === b.account &&
            a.page === b.page && a.filter === b.filter;
    }

    private queryList(board: Board, page: number) {
        // 探测/状态接口还没回来时不发列表请求：同一个 header 的回包会互相顶掉，造成重复请求。
        if (this.probing || this.statusPending) return;
        if (board !== this.selected || !this.node.activeInHierarchy || !this.lists[board].beginPage(page)) return;
        this.query(board, false, page);
        if (page === 0) this.query(board, true, 0);
    }

    private query(board: Board, self: boolean, page: number) {
        const key = this.keyOf(board, self);
        const account = GameDataManager.getAccount();
        if (!account) {
            if (!self) this.lists[board].failPage(page);
            return;
        }
        const request = {board, self, page, filter: board === "玩家手数榜" ? this.filter() : "", epoch: this.epoch, account};
        this.desired[key] = request;
        if (this.pending[key] && this.pending[key].account !== account) delete this.pending[key];
        if (!this.pending[key]) this.send(key, request);
    }

    private send(key: string, request: RankingRequest) {
        if (!this.current(request)) return;
        const inflight = this.pending[key];
        // 同一页同一档位已经在飞就不要重复发。
        if (inflight && inflight.page === request.page && inflight.filter === request.filter &&
            inflight.epoch === request.epoch && inflight.account === request.account) return;
        this.pending[key] = request;
        const header = this.headerOf(request.board, request.self);
        const params: any = {header, page: String(request.page), count: String(this.PAGE_PER_COUNT)};
        if (this.mode === "club") {
            // 俱乐部榜：手数榜按档位、我的排名按 rank_type；列表统一要未压缩行，
            // 一次请求就够（页面按需分页，服务端 count 上限 50）。
            if (request.board === "玩家手数榜") params.play_type = request.filter;
            if (request.self) params.rank_type = RANK_TYPES[request.board];
            else params.is_zip = "0";
        } else if (request.board === "玩家手数榜") {
            params.play_type = request.filter;
            if (!request.self) params.is_zip_result = "0";
        } else if (request.board === "代理红利榜" && !request.self) {
            params.is_scale = "0"; params.is_self = "0";
        }
        request.account.reqHallCommand(JSON.stringify(params), "P@" + header);
    }

    private receive(board: Board, self: boolean, strMsg: string) {
        const key = this.keyOf(board, self);
        const route = this.routeOf(board, self);
        const request = this.pending[key];
        if (!request) return;
        delete this.pending[key];
        const wanted = this.desired[key];
        try {
            const data = JSON.parse(strMsg);
            if (!data) throw new Error("Empty leaderboard response");
            if (data && this.current(request) && this.same(request, wanted)) {
                if (self) this.showSelf(board, data, route);
                else this.lists[board].renderPage(data, route, this.rowTemplate, this.PAGE_PER_COUNT, request.page);
                this.dates(data);
            }
        } catch (error) {
            cc.warn("排行榜数据解析失败", key);
            if (!self && this.current(request) && this.same(request, wanted)) this.lists[board].failPage(request.page);
        }
        if (!this.same(request, wanted) && this.current(wanted) && !this.pending[key]) this.send(key, wanted);
    }

    private showSelf(board: Board, data: any, route: string) {
        let one = (data[route] || [])[0] || {};
        // 服务端「我的排名」实测会回榜单第一名（不是本人），ID 对不上就用榜单里自己那一行兜底。
        if (!GameDataManager.IsSelfPlayerId(one.user_guuid)) one = this.selfFromList(board) || one;
        const value = PaiHangScrollItem.number(one.activity_num, board === "玩家赢分榜");
        const metric = board === "玩家手数榜" ? "有效手数" : board === "玩家赢分榜" ? "我的赢分" : "我的红利";
        // 名次只看 user_no：赢分是负数也照样有排名，不能拿 activity_num 的正负判断有没有上榜。
        const rankText = one.user_no == null ? "" : String(one.user_no).trim();
        const hasRank = /^\d+$/.test(rankText) && Number(rankText) > 0;
        const rank = hasRank ? rankText : "未上榜";
        const reward = PaiHangScrollItem.number(one.user_reward == null ? 0 : one.user_reward);
        this.header("V8本人指标", metric + " " + value);
        this.header("V8排名", rank);
        this.header("V8奖励", reward);
        this.header("我的信息", metric + ":" + value + " 当前排名:" + rank + " 奖励:" + reward);
        Tool.GetChild(this.node, "广告/已领取").active = this.mode === "hall" && Number(one.lingqu_count) > 0;
        // 俱乐部榜只做展示，服务端 lingqu_on 恒为 False；大厅榜保持原领取逻辑。
        Tool.GetChild(this.node, "广告/领取奖励").active = this.mode === "hall" &&
            one.lingqu_on === "True" && one.is_reward === "True" && Number(one.lingqu_count) <= 0;
    }

    /** 在已加载的榜里按自己的 ID 找名次；找不到（排在当前页之外）返回 null。 */
    private selfFromList(board: Board): any {
        const account: any = GameDataManager.getAccount();
        if (!account) return null;
        const ids = [account.guuid, account.custom_id];
        for (const id of ids) {
            if (id == null || String(id).trim() === "") continue;
            const row = this.lists[board] && this.lists[board].findRow(String(id).trim());
            if (row) return row;
        }
        return null;
    }

    public GetShouShuList(page = 0, force = false) { this.queryList("玩家手数榜", page); }
    public GetWinList(page = 0) { this.queryList("玩家赢分榜", page); }
    public GetHongliList(page = 0, force = false) { this.queryList("代理红利榜", page); }
    public GetShouShuSelf(page = 0) { this.query("玩家手数榜", true, page); }
    public GetWinSelf(page = 0) { this.query("玩家赢分榜", true, page); }
    public GetHongliSelf(page = 0) { this.query("代理红利榜", true, page); }
    public OnListActivityPlayedcount(msg: string) { this.receive("玩家手数榜", false, msg); }
    public OnListActivityUserScore(msg: string) { this.receive("玩家赢分榜", false, msg); }
    public ListActivityProxyHongli(msg: string) { this.receive("代理红利榜", false, msg); }
    public OnListActivitySelfPlayedcount(msg: string) { this.receive("玩家手数榜", true, msg); }
    public OnListActivitySelfUserScore(msg: string) { this.receive("玩家赢分榜", true, msg); }
    public ListActivitySelfProxyHongli(msg: string) { this.receive("代理红利榜", true, msg); }

    public OnClubActivityPlayedcount(msg: string) { this.receive("玩家手数榜", false, msg); }
    public OnClubActivityUserScore(msg: string) { this.receive("玩家赢分榜", false, msg); }
    public OnClubActivityProxyHongli(msg: string) { this.receive("代理红利榜", false, msg); }

    /** 三个俱乐部榜共用一个「我的排名」推送，按在飞的请求认榜。 */
    public OnClubActivitySelfRank(msg: string) {
        for (const board of BOARDS) {
            if (!this.pending[this.keyOf(board, true)]) continue;
            this.receive(board, true, msg);
            return;
        }
    }

    private claim(header: string, page: number, filter = false) {
        // 俱乐部榜只展示奖励，不提供领取（服务端 lingqu_on 恒 False）。
        if (this.mode === "club") return;
        const params: any = {header, page: String(page), count: String(this.PAGE_PER_COUNT)};
        if (filter) params.play_type = this.filter();
        GameDataManager.getAccount().reqHallCommand(JSON.stringify(params), "P@" + header);
    }
    public LingquShoushu(page = 0) { this.claim("领取_活动_自己手数", page, true); }
    public LingquWin(page = 0) { this.claim("领取_活动_自己输赢", page); }
    public LingquHongli(page = 0) { this.claim("领取_活动_自己红利", page); }

    public OnUserHashInfo(strMsg: string) {
        const info = JSON.parse(strMsg).UserHashInfo;
        if (!info) return;
        BOARDS.forEach(board => {
            if (info.context === "活动文本_" + board)
                Tool.GetChild(this.node, "容器/" + board + "/文本/txt").getComponent(cc.Label).string = info.content;
        });
    }

    /** 俱乐部榜命令不可用（纯大厅模式 / 服务端还没上线）时回落全平台榜。 */
    private needHallFallback(param: string): boolean {
        const markers = ["俱乐部功能未启用", "命令不存在", "未注册", "接口未注册", "非法命令"];
        return markers.some(marker => param.indexOf(marker) >= 0);
    }

    /** GC_FAILED 的 result.error 文案；拿不到就返回空串。 */
    private failureText(param: string): string {
        try {
            const data = JSON.parse(param);
            const error = data && data.result && data.result.error;
            return error == null ? "" : String(error).trim();
        } catch (error) {
            return "";
        }
    }

    public onHallCommand(code: number, param: string) {
        if (this.handleProbeReply(code, param)) return;
        // 状态命令的回执：成功是「回执 + ClubActivityStatus 推送」两条消息，回执码不能当失败依据
        // （本项目 GC_OK 不等于 0x200），只有明确带 result.error 才回落逐榜探测，否则等推送。
        if (this.statusPending &&
            (param.indexOf(STATUS_CONTEXT) >= 0 || param.indexOf(STATUS_HEADER) >= 0)) {
            if (this.failureText(param) !== "") {
                this.statusPending = false;
                this.beginProbe();
            }
            return;
        }
        if (code !== 0x200 && this.mode === "club" && this.needHallFallback(param)) {
            this.mode = "hall";
            this.pending = {};
            this.desired = {};
            this.probePending = [];
            this.probeResult = {};
            this.listReady = false;
            this.restoreAllBoards();
            if (this.node.activeInHierarchy) this.enterBoard(this.selected);
            return;
        }
        // Release failed channels so switching/retrying can recover.
        if (code !== 0x200) Object.keys(this.pending).forEach(key => {
            const r = this.pending[key];
            if (param.indexOf(this.headerOf(r.board, r.self)) >= 0) {
                delete this.pending[key];
                const wanted = this.desired[key];
                // 服务端给了业务文案（活动没有开启/活动未开始/无权查看）就照原样显示，
                // 不要一律显示"加载失败，请滑动重试"。
                if (!r.self && this.same(r, wanted) && this.current(r)) {
                    const text = this.failureText(param);
                    if (text) this.lists[r.board].notice(text);
                    else this.lists[r.board].failPage(r.page);
                }
                if (!this.same(r, wanted) && this.current(wanted) && !this.pending[key]) this.send(key, wanted);
            }
        });
        const claims: [string, Board][] = [["领取_活动_自己手数", "玩家手数榜"], ["领取_活动_自己输赢", "玩家赢分榜"], ["领取_活动_自己红利", "代理红利榜"]];
        claims.forEach(([header, board]) => {
            if (param.indexOf(header) < 0) return;
            if (code === 0x200) {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "操作成功！");
                this.scheduleOnce(() => this.query(board, true, 0), .3);
            } else {
                const msg = JSON.parse(param);
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, msg.result.error);
            }
        });
    }
}
