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
interface RankingRequest {
    board: Board;
    self: boolean;
    page: number;
    filter: string;
    epoch: number;
    account: any;
}
const QUERIES = {
    "玩家手数榜": ["查询_活动_玩家手数", "查询_活动_自己手数", "ListActivityPlayedcount", "ListActivitySelfPlayedcount"],
    "玩家赢分榜": ["查询_活动_玩家输赢", "查询_活动_自己输赢", "ListActivityUserScore", "ListActivitySelfUserScore"],
    "代理红利榜": ["查询_活动_代理红利", "查询_活动_自己红利", "ListActivityProxyHongli", "ListActivitySelfProxyHongli"]
};

@ccclass
export default class panelPaihangbang extends UIPanelViewBase {
    @property(cc.Node)
    rowTemplate: cc.Node = null;

    private PAGE_PER_COUNT = 30;
    private selected: Board = "玩家手数榜";
    private epoch = 0;
    private lists: {[key: string]: LeaderboardScrollView} = {};
    // Legacy replies have no request ID: serialize each reply channel and keep
    // its latest desired request so rapid filter changes cannot mix rows.
    private pending: {[key: string]: RankingRequest} = {};
    private desired: {[key: string]: RankingRequest} = {};

    onLoad() {
        super.onLoad();
        const events = [
            ["ListActivityPlayedcount", "OnListActivityPlayedcount"],
            ["ListActivitySelfPlayedcount", "OnListActivitySelfPlayedcount"],
            ["ListActivityUserScore", "OnListActivityUserScore"],
            ["ListActivitySelfUserScore", "OnListActivitySelfUserScore"],
            ["ListActivityProxyHongli", "ListActivityProxyHongli"],
            ["ListActivitySelfProxyHongli", "ListActivitySelfProxyHongli"],
            ["UserHashInfo", "OnUserHashInfo"], ["onHallCommand", "onHallCommand"],
            ["onDisconnected", "onDisconnected"], ["onReloginBaseappSuccessfully", "onRankingReconnect"]
        ];
        events.forEach(([event, handler]) => KBEngine.Event.register(event, this, handler));
        (Object.keys(QUERIES) as Board[]).forEach(board => {
            const list = Tool.GetChild(this.node, "容器/" + board + "/列表").getComponent(LeaderboardScrollView);
            list.callBackFresh = (page: number) => this.queryList(board, page);
            this.lists[board] = list;
        });
    }

    onEnable() {
        this.epoch++;
        Tool.GetChild(this.node, "条件/玩家手数榜").getComponent(cc.Toggle).isChecked = true;
        this.selectBoard("玩家手数榜");
    }

    onDisable() { this.epoch++; }

    public onDisconnected() {
        this.epoch++;
        this.pending = {};
        this.desired = {};
        if (this.node.activeInHierarchy) this.resetHeader();
    }

    public onRankingReconnect() {
        if (this.node.activeInHierarchy) this.selectBoard(this.selected);
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
        if (!toggle.isChecked || !toggle.node.activeInHierarchy) return;
        const name = toggle.node.name;
        if (Object.prototype.hasOwnProperty.call(QUERIES, name)) this.selectBoard(name as Board);
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
        ConfigManager.getInstance().GetOneHashKey("活动文本_" + board, "活动文本_" + board);
    }

    public SwitchTab(name: string) {
        this.selected = name as Board;
        this.node.getChildByName("容器").children.forEach(child => child.active = child.name === name);
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
        if (board !== this.selected || !this.node.activeInHierarchy || !this.lists[board].beginPage(page)) return;
        this.query(board, false, page);
        if (page === 0) this.query(board, true, 0);
    }

    private query(board: Board, self: boolean, page: number) {
        const key = QUERIES[board][self ? 3 : 2];
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
        this.pending[key] = request;
        const header = QUERIES[request.board][request.self ? 1 : 0];
        const params: any = {header, page: String(request.page), count: String(this.PAGE_PER_COUNT)};
        if (request.board === "玩家手数榜") {
            params.play_type = request.filter;
            if (!request.self) params.is_zip_result = "0";
        } else if (request.board === "代理红利榜" && !request.self) {
            params.is_scale = "0"; params.is_self = "0";
        }
        request.account.reqHallCommand(JSON.stringify(params), "P@" + header);
    }

    private receive(board: Board, self: boolean, strMsg: string) {
        const key = QUERIES[board][self ? 3 : 2];
        const request = this.pending[key];
        if (!request) return;
        delete this.pending[key];
        const wanted = this.desired[key];
        try {
            const data = JSON.parse(strMsg);
            if (!data) throw new Error("Empty leaderboard response");
            if (data && this.current(request) && this.same(request, wanted)) {
                if (self) this.showSelf(board, data, key);
                else this.lists[board].renderPage(data, key, this.rowTemplate, this.PAGE_PER_COUNT, request.page);
                this.dates(data);
            }
        } catch (error) {
            cc.warn("排行榜数据解析失败", key);
            if (!self && this.current(request) && this.same(request, wanted)) this.lists[board].failPage(request.page);
        }
        if (!this.same(request, wanted) && this.current(wanted)) this.send(key, wanted);
    }

    private showSelf(board: Board, data: any, key: string) {
        const one = (data[key] || [])[0] || {};
        const value = PaiHangScrollItem.number(one.activity_num, board === "玩家赢分榜");
        const metric = board === "玩家手数榜" ? "有效手数" : board === "玩家赢分榜" ? "我的赢分" : "我的红利";
        const rank = Number(one.user_no) > 0 && (board === "玩家手数榜" || Number(one.activity_num) > 0) ? String(one.user_no) : "未上榜";
        const reward = PaiHangScrollItem.number(one.user_reward == null ? 0 : one.user_reward);
        this.header("V8本人指标", metric + " " + value);
        this.header("V8排名", rank);
        this.header("V8奖励", reward);
        this.header("我的信息", metric + ":" + value + " 当前排名:" + rank + " 奖励:" + reward);
        Tool.GetChild(this.node, "广告/已领取").active = Number(one.lingqu_count) > 0;
        Tool.GetChild(this.node, "广告/领取奖励").active = one.lingqu_on === "True" && one.is_reward === "True" && Number(one.lingqu_count) <= 0;
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

    private claim(header: string, page: number, filter = false) {
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
        (Object.keys(QUERIES) as Board[]).forEach(board => {
            if (info.context === "活动文本_" + board)
                Tool.GetChild(this.node, "容器/" + board + "/文本/txt").getComponent(cc.Label).string = info.content;
        });
    }

    public onHallCommand(code: number, param: string) {
        // Release failed channels so switching/retrying can recover.
        if (code !== 0x200) Object.keys(this.pending).forEach(key => {
            const r = this.pending[key];
            if (param.indexOf(QUERIES[r.board][r.self ? 1 : 0]) >= 0) {
                delete this.pending[key];
                const wanted = this.desired[key];
                if (!r.self && this.same(r, wanted) && this.current(r)) this.lists[r.board].failPage(r.page);
                if (!this.same(r, wanted) && this.current(wanted)) this.send(key, wanted);
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
