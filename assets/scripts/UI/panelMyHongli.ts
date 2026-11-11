import UIPanelViewBase from "../common/UIPanelViewBase";
import GameDataManager from "../GameDataManager";
import Tool from "../common/Tool";
import UIManager from "../common/UIManager";
import ImageManager from "../logic/ImageManager";
import { ShowPanelMode } from "../common/GameDef";

var KBEngine = require("kbengine");
const {ccclass} = cc._decorator;

/**
 * 俱乐部模式「我的红利」弹窗，两个页签：
 *
 * 1. 我的红利（默认）：顶部统计 `查询_俱乐部_红利_统计` → `ClubBonusStats`，
 *    明细 `查询_俱乐部_红利_明细` → `ClubBonusList`，提取 `提取_俱乐部_红利`。
 *    今日/昨日新增、累计提取、未提取余额；累计红利 = 未提取 + 累计提取。
 * 2. 业绩股：`异步_查询_俱乐部_业绩_信息` / `_下发_列表` / `设置_俱乐部_业绩_授权`，
 *    展示「我 / 下放 / 剩」占比与已授权下级列表，可按 ID 添加下级代理。
 *
 * `mode=union` 时复用第一页，改走联盟红利（V2 文档 §10）：
 * `查询_联盟_红利_统计` → `ClubUnionBonusStats`、`查询_联盟_红利_明细` → `ClubUnionBonusList`、
 * `提取_联盟_红利`。联盟维度没有业绩股，页签整条隐藏。
 *
 * 不再读取账号 `hongli` / `all_hongli`，也不再用旧的
 * `查询_俱乐部_代理_收益` / `提取_玩家_红利`。
 */
@ccclass
export default class panelMyHongli extends UIPanelViewBase {
    private readonly PAGE_SIZE:number = 15;
    /** 记录行行距：行高 84 + 间隔 12，与 Prefab 里模板行一致。 */
    private readonly ROW_SPACING:number = 96;
    private page:number = 0;
    private totalPages:number = 1;
    private claimPending:boolean = false;
    private started:boolean = false;

    private static readonly TAB_HONGLI:number = 0;
    private static readonly TAB_PERF:number = 1;
    private static readonly PERF_PAGE_SIZE:number = 10;
    /** 业绩股行高 96 + 间隔 10。 */
    private static readonly PERF_ROW_SPACING:number = 106;
    private static readonly PERF_HEADER_INFO:string = "异步_查询_俱乐部_业绩_信息";
    private static readonly PERF_HEADER_LIST:string = "异步_查询_俱乐部_业绩_下发_列表";
    private static readonly PERF_HEADER_GRANT:string = "设置_俱乐部_业绩_授权";

    /** 列表是 ScrollView（列表/视口/内容），行由模板 记录行 克隆。 */
    private listRoot:cc.Node = null;
    private listView:cc.Node = null;
    private listContent:cc.Node = null;
    private rowTemplate:cc.Node = null;
    private rows:cc.Node[] = [];

    /** 当前俱乐部 ID；空串表示没有俱乐部，页面不展示任何红利数据。 */
    private clubId:string = "";
    /** club = 当前俱乐部分成；union = 联盟创建者的联盟抽成。 */
    private mode:string = "club";
    /** 当前未提取余额（分），提取时取整数元部分。 */
    private unclaimedFen:number = 0;
    /** 防止另一套红利面板的推送串到本面板。 */
    private statsPending:boolean = false;
    private listPending:boolean = false;

    // ---------------------------------------------------------------- 页签 / 业绩股
    private currentTab:number = panelMyHongli.TAB_HONGLI;
    private tabRoot:cc.Node = null;
    private tabNodes:cc.Node[] = [];
    private tabOnFrame:cc.SpriteFrame = null;
    private tabOffFrame:cc.SpriteFrame = null;
    private hongliNodes:cc.Node[] = [];
    private perfRoot:cc.Node = null;

    private perfView:cc.Node = null;
    private perfContent:cc.Node = null;
    private perfRowTemplate:cc.Node = null;
    private perfRows:cc.Node[] = [];
    private perfInput:cc.EditBox = null;
    private perfEnabled:boolean = true;
    private perfPage:number = 0;
    private perfTotalPages:number = 1;

    private perfInfoPending:boolean = false;
    private perfListPending:boolean = false;
    private perfGrantPending:boolean = false;
    private perfInfoContext:string = "";
    private perfListContext:string = "";
    private perfGrantContext:string = "";

    onLoad() {
        super.onLoad();
        this.initList();
        this.initPerf();
        KBEngine.Event.register("ClubBonusStats", this, "onClubBonusStats");
        KBEngine.Event.register("ClubUnionBonusStats", this, "onClubBonusStats");
        KBEngine.Event.register("ClubBonusList", this, "onClubBonusList");
        KBEngine.Event.register("ClubUnionBonusList", this, "onClubBonusList");
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
    }

    start() {
        // strUserData 在节点挂载之后才由 UIManager 赋值，onLoad/onEnable 里读不到。
        this.readUserData();
        this.started = true;
        this.initTabs();
        this.switchTab(this.isUnion() ? panelMyHongli.TAB_HONGLI : this.currentTab, true);
    }

    onEnable() {
        if(!this.started) return;
        if(this.currentTab === panelMyHongli.TAB_PERF && !this.isUnion()) this.refreshPerf();
        else this.beginQuery();
    }

    onDisable() {
        this.claimPending = false;
        this.statsPending = false;
        this.listPending = false;
        this.perfInfoPending = false;
        this.perfListPending = false;
        this.perfGrantPending = false;
    }

    // ---------------------------------------------------------------- 基础

    private readUserData() {
        this.clubId = "";
        this.mode = "club";
        const raw = this.strUserData || "";
        if(raw === "") return;
        let data:any = null;
        try { data = JSON.parse(raw); } catch(_) { data = null; }
        if(!data || typeof data !== "object") return;
        if(String(data.mode || "") === "union") {
            this.mode = "union";
            return;
        }
        this.clubId = String(data.club_id || data.clubId || "");
    }

    private isUnion():boolean {
        return this.mode === "union";
    }

    private label(path:string):cc.Label {
        const node = Tool.GetChild(this.node, path);
        return node && node.getComponent(cc.Label);
    }

    private setLabel(path:string, value:any) {
        const target = this.label(path);
        if(target) target.string = value === null || value === undefined || value === "" ? "—" : String(value);
    }

    private setNodeLabel(node:cc.Node, name:string, value:string) {
        const target = node.getChildByName(name);
        if(target && target.getComponent(cc.Label)) target.getComponent(cc.Label).string = value;
    }

    private setHint(text:string) {
        const hint = Tool.GetChild(this.node, "提示");
        if(!hint) return;
        hint.active = text !== "";
        this.setLabel("提示", text);
    }

    /** 接口里的红利单位为分，展示成元。 */
    private fenText(raw:any):string {
        const fen = Number(raw);
        if(!isFinite(fen)) return "-";
        const yuan = fen / 100;
        return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2);
    }

    private parseJson(raw:any):any {
        if(raw && typeof raw === "object") return raw;
        if(typeof raw !== "string") return null;
        try { return JSON.parse(raw); } catch(_) { return null; }
    }

    private hasCommand(raw:any, name:string):boolean {
        return typeof raw === "string" && raw.indexOf(name) >= 0;
    }

    private resetStats() {
        this.unclaimedFen = 0;
        this.setLabel("统计/今日红利/num", "-");
        this.setLabel("统计/昨日红利/num", "-");
        this.setLabel("统计/累计红利/num", "-");
        this.setLabel("未领取红利/num", "-");
        this.setLabel("提取红利面板/bk/可提取金额", "可提取金额：—");
    }

    // ---------------------------------------------------------------- 查询

    private beginQuery() {
        this.resetStats();
        const account:any = GameDataManager.getAccount();
        if(!account) return;
        if(this.isUnion()) {
            this.requestStats();
            this.requestList(0);
            return;
        }
        if(this.clubId === "") {
            this.setHint("当前没有俱乐部，无法查看俱乐部红利");
            this.renderRows([], () => {}, "暂无红利明细");
            this.refreshPaging();
            return;
        }
        this.requestStats();
        this.requestList(0);
    }

    private requestStats() {
        const account:any = GameDataManager.getAccount();
        if(!account) return;
        if(!this.isUnion() && this.clubId === "") return;
        this.setHint(this.isUnion() ? "正在加载联盟红利…" : "正在加载俱乐部红利…");
        const params:any = this.isUnion() ? {
            header:"查询_联盟_红利_统计",
            context:"查询_联盟_红利_统计"
        } : {
            header:"查询_俱乐部_红利_统计",
            club_id:this.clubId,
            user_id:"",
            context:"查询_俱乐部_红利_统计"
        };
        this.statsPending = true;
        account.reqHallCommand(JSON.stringify(params), this.isUnion() ? "P@查询_联盟_红利_统计" : "P@查询_俱乐部_红利_统计");
    }

    private requestList(page:number = 0) {
        const account:any = GameDataManager.getAccount();
        if(!account) return;
        if(!this.isUnion() && this.clubId === "") return;
        this.page = Math.max(0, page);
        const params:any = this.isUnion() ? {
            header:"查询_联盟_红利_明细",
            count:String(this.PAGE_SIZE),
            page:String(this.page),
            context:"查询_联盟_红利_明细"
        } : {
            header:"查询_俱乐部_红利_明细",
            club_id:this.clubId,
            count:String(this.PAGE_SIZE),
            page:String(this.page),
            context:"查询_俱乐部_红利_明细"
        };
        this.listPending = true;
        account.reqHallCommand(JSON.stringify(params), this.isUnion() ? "P@查询_联盟_红利_明细" : "P@查询_俱乐部_红利_明细");
    }

    // ---------------------------------------------------------------- 推送处理

    /** 路由 ClubBonusStats / ClubUnionBonusStats：字段相同，按 context 区分来源。 */
    public onClubBonusStats(raw:any) {
        const msg:any = this.parseJson(raw);
        if(!msg || typeof msg !== "object") return;
        if(!this.statsPending) return;
        const expected = this.isUnion() ? "查询_联盟_红利_统计" : "查询_俱乐部_红利_统计";
        if(msg.context && String(msg.context) !== expected) return;
        if(msg.today_income_fen === undefined && msg.unclaimed_fen === undefined) return;
        this.statsPending = false;
        const unclaimed = Number(msg.unclaimed_fen);
        const extracted = Number(msg.total_extract_fen);
        this.unclaimedFen = isFinite(unclaimed) ? unclaimed : 0;
        const cumulativeFen = this.unclaimedFen + (isFinite(extracted) ? extracted : 0);
        this.setLabel("统计/今日红利/num", this.fenText(msg.today_income_fen));
        this.setLabel("统计/昨日红利/num", this.fenText(msg.yesterday_income_fen));
        this.setLabel("统计/累计红利/num", this.fenText(cumulativeFen));
        this.setLabel("未领取红利/num", this.fenText(this.unclaimedFen));
        this.setLabel("提取红利面板/bk/可提取金额", "可提取金额：" + this.fenText(this.unclaimedFen));
    }

    /** 路由 ClubBonusList / ClubUnionBonusList：[{number,count,date,...,bonus,player,name,guuid,level,room_id}] */
    public onClubBonusList(raw:any) {
        const msg:any = this.parseJson(raw);
        if(!msg || typeof msg !== "object") return;
        if(!this.listPending) return;
        const isUnionPayload = Array.isArray(msg.ClubUnionBonusList);
        if(isUnionPayload !== this.isUnion()) return;
        const rows:any[] = isUnionPayload ? msg.ClubUnionBonusList : (Array.isArray(msg.ClubBonusList) ? msg.ClubBonusList : []);
        this.listPending = false;
        this.renderBonusRows(rows);
    }

    public onHallCommand(code:number, raw:any) {
        if((this.perfInfoPending || this.perfListPending || this.perfGrantPending) && this.onPerfReply(code, raw)) return;
        if(this.hasCommand(raw, "查询_俱乐部_红利_统计") || this.hasCommand(raw, "查询_联盟_红利_统计")) {
            // 0x200 只是同步受理回包，统计结果随后由 ClubBonusStats 推送，不能在这里清 pending。
            if(code !== 0x200) {
                this.statsPending = false;
                this.showCommandError(raw, this.isUnion() ? "联盟红利统计加载失败" : "红利统计加载失败");
            }
            return;
        }
        if(this.hasCommand(raw, "查询_俱乐部_红利_明细") || this.hasCommand(raw, "查询_联盟_红利_明细")) {
            // 0x200 只是同步受理回包，明细随后由 ClubBonusList 推送。
            if(code !== 0x200) {
                this.listPending = false;
                this.showCommandError(raw, this.isUnion() ? "联盟红利明细加载失败" : "红利明细加载失败");
            }
            return;
        }
        if(this.hasCommand(raw, "提取_俱乐部_红利") || this.hasCommand(raw, "提取_联盟_红利")) {
            this.claimPending = false;
            if(code === 0x200) {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "提取成功！");
                this.requestStats();
                this.requestList(0);
            } else {
                const message:any = this.parseJson(raw);
                const error = message && message.result && message.result.error ? message.result.error : "提取失败，请稍后重试";
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, error);
            }
        }
    }

    private showCommandError(raw:any, fallback:string) {
        const message:any = this.parseJson(raw);
        const error = message && message.result && message.result.error ? message.result.error : fallback;
        this.setHint(error);
    }

    // ---------------------------------------------------------------- 列表渲染

    /** 抓取 ScrollView 结构；记录行 是模板，默认隐藏。 */
    private initList() {
        this.listRoot = Tool.GetChild(this.node, "列表");
        this.listView = Tool.GetChild(this.node, "列表/视口");
        this.listContent = Tool.GetChild(this.node, "列表/视口/内容");
        this.rowTemplate = Tool.GetChild(this.node, "列表/视口/内容/记录行");
        this.rows = [];
        if(this.rowTemplate) this.rowTemplate.active = false;
    }

    /** 按需克隆行，行数不够就补，够用就复用。 */
    private rowAt(index:number):cc.Node {
        if(!this.listContent || !this.rowTemplate) return null;
        while(this.rows.length <= index) {
            const row = cc.instantiate(this.rowTemplate);
            row.name = "记录行" + (this.rows.length + 1).toString();
            row.parent = this.listContent;
            row.active = false;
            this.rows.push(row);
        }
        return this.rows[index];
    }

    /**
     * 按行数撑开内容高度并回到顶部；父节点 视口 带 Widget，会跟随 列表 运行期尺寸，
     * 所以每次渲染都重新取一次高度，长屏下也不会错位。
     */
    private layoutList(count:number) {
        if(!this.listView || !this.listContent) return;
        const viewHeight = this.listView.height;
        const contentHeight = Math.max(viewHeight, count * this.ROW_SPACING);
        this.listContent.setContentSize(this.listView.width, contentHeight);
        // 内容锚点是 (0.5,1)，位置即内容顶边，对齐视口顶边才不会出现半截行。
        this.listContent.setPosition(0, viewHeight / 2);
        const scroll = this.listRoot ? this.listRoot.getComponent(cc.ScrollView) : null;
        if(scroll) {
            scroll.stopAutoScroll();
            scroll.scrollToTop(0);
        }
    }

    private renderRows(list:any[], fill:(node:cc.Node, row:any) => void, emptyText:string) {
        const half = this.rowTemplate ? this.rowTemplate.height / 2 : 30.5;
        this.rows.forEach(row => row.active = false);
        list.forEach((item, index) => {
            const row = this.rowAt(index);
            if(!row) return;
            row.active = true;
            row.setPosition(0, -(index * this.ROW_SPACING + half));
            fill(row, item);
        });
        this.layoutList(list.length);
        this.setHint(list.length === 0 ? emptyText : "");
    }

    private refreshPaging() {
        if(this.currentTab === panelMyHongli.TAB_PERF) return;
        const paging = Tool.GetChild(this.node, "分页");
        if(!paging) return;
        const canPrev = this.page > 0;
        const canNext = this.page + 1 < this.totalPages;
        const setInteractable = (name:string, value:boolean) => {
            const node = paging.getChildByName(name);
            if(node && node.getComponent(cc.Button)) node.getComponent(cc.Button).interactable = value;
        };
        setInteractable("首页", canPrev);
        setInteractable("上一页", canPrev);
        setInteractable("下一页", canNext);
        setInteractable("尾页", canNext);
        this.setLabel("分页/页码", (this.page + 1) + " / " + this.totalPages);
    }

    private renderBonusRows(rows:any[]) {
        const first:any = rows.length > 0 ? rows[0] : null;
        const reportedPage = first ? Number(first.number) : NaN;
        const reportedCount = first ? Number(first.count) : NaN;
        if(isFinite(reportedPage) && reportedPage >= 0) this.page = reportedPage;
        this.totalPages = isFinite(reportedCount) && reportedCount > 0
            ? Math.max(1, Math.ceil(reportedCount / this.PAGE_SIZE))
            : Math.max(1, this.page + (rows.length >= this.PAGE_SIZE ? 1 : 0));

        this.renderRows(rows, (node, row) => {
            // 玩家列取本局贡献抽水的玩家（`player`）；老回包只有 name/guuid 时兜底。
            const player = row.player || row.name || row.guuid;
            const room = row.room_id === undefined || row.room_id === null || String(row.room_id) === ""
                ? "—" : String(row.room_id);
            this.setNodeLabel(node, "玩家", String(player || "—"));
            this.setNodeLabel(node, "类型", room);
            this.setNodeLabel(node, "金额", this.fenText(row.bonus));
            this.setNodeLabel(node, "时间", String(row.date || row.time || "—"));
        }, this.isUnion() ? "暂无联盟红利明细" : "暂无红利明细");
        this.refreshPaging();
    }

    // ---------------------------------------------------------------- 页签

    private initTabs() {
        this.tabRoot = Tool.GetChild(this.node, "页签");
        this.hongliNodes = [];
        ["统计", "未领取底", "未领取红利", "提取红利", "列表面板", "表头", "列表", "提示"].forEach((name) => {
            const target = Tool.GetChild(this.node, name);
            if(target) this.hongliNodes.push(target);
        });
        this.tabNodes = [];
        const hongliTab = Tool.GetChild(this.node, "页签/页签_我的红利");
        const perfTab = Tool.GetChild(this.node, "页签/页签_业绩股");
        if(hongliTab) this.tabNodes.push(hongliTab);
        if(perfTab) this.tabNodes.push(perfTab);
        if(hongliTab && hongliTab.getComponent(cc.Sprite))
            this.tabOnFrame = hongliTab.getComponent(cc.Sprite).spriteFrame;
        if(perfTab && perfTab.getComponent(cc.Sprite))
            this.tabOffFrame = perfTab.getComponent(cc.Sprite).spriteFrame;
        // 联盟红利没有 club_id，业绩股页签整条隐藏。
        if(this.tabRoot) this.tabRoot.active = !this.isUnion();
        if(this.isUnion()) this.currentTab = panelMyHongli.TAB_HONGLI;
        this.applyTabVisual();
    }

    private applyTabVisual() {
        for(let i = 0; i < this.tabNodes.length; ++i) {
            const tab = this.tabNodes[i];
            if(!cc.isValid(tab)) continue;
            const sprite = tab.getComponent(cc.Sprite);
            if(sprite) {
                const frame = i === this.currentTab ? this.tabOnFrame : this.tabOffFrame;
                if(frame) sprite.spriteFrame = frame;
            }
            const labelNode = tab.getChildByName("文字");
            if(labelNode)
                labelNode.color = i === this.currentTab
                    ? new cc.Color(48, 30, 8, 255)
                    : new cc.Color(169, 192, 214, 255);
        }
    }

    private switchTab(tab:number, force:boolean = false) {
        if(tab !== panelMyHongli.TAB_HONGLI && tab !== panelMyHongli.TAB_PERF) return;
        if(!force && tab === this.currentTab) return;
        if(tab === panelMyHongli.TAB_PERF && this.isUnion()) return;
        this.currentTab = tab;
        this.closeClaimPanel();
        this.claimPending = false;
        this.applyTabVisual();
        this.hongliNodes.forEach((target) => {
            if(cc.isValid(target)) target.active = tab === panelMyHongli.TAB_HONGLI;
        });
        if(this.perfRoot) this.perfRoot.active = tab === panelMyHongli.TAB_PERF;
        if(tab === panelMyHongli.TAB_PERF) this.refreshPerf();
        else this.beginQuery();
    }

    // ---------------------------------------------------------------- 业绩股

    private initPerf() {
        this.perfRoot = Tool.GetChild(this.node, "业绩股页");
        this.perfView = Tool.GetChild(this.node, "业绩股页/业绩列表/视口");
        this.perfContent = Tool.GetChild(this.node, "业绩股页/业绩列表/视口/内容");
        this.perfRowTemplate = Tool.GetChild(this.node, "业绩股页/业绩列表/视口/内容/记录行");
        this.perfRows = [];
        if(this.perfRowTemplate) this.perfRowTemplate.active = false;
        const inputNode = Tool.GetChild(this.node, "业绩股页/输入区/代理ID输入");
        this.perfInput = inputNode ? inputNode.getComponent(cc.EditBox) : null;
        if(this.perfInput) this.perfInput.inputMode = cc.EditBox.InputMode.NUMERIC;
        if(this.perfRoot) this.perfRoot.active = false;
    }

    private setPerfHint(text:string) {
        const hint = Tool.GetChild(this.node, "业绩股页/业绩提示");
        if(!hint) return;
        hint.active = text !== "";
        const label = hint.getComponent(cc.Label);
        if(label) label.string = text;
    }

    private perfPercent(count:any, all:any):string {
        const total = Number(all);
        const value = Number(count);
        if(!isFinite(total) || total <= 0 || !isFinite(value)) return "0.00";
        return (value * 100 / total).toFixed(2);
    }

    /** 服务端占比是两位小数字符串，优先原样展示；缺省时再按次数换算。 */
    private applyPerfTotals(my:any, granted:any, left:any, all:any,
                           myPercent:any = null, grantedPercent:any = null, leftPercent:any = null) {
        const text = (raw:any, count:any):string => {
            if(raw !== null && raw !== undefined && String(raw) !== "") return String(raw);
            return this.perfPercent(count, all);
        };
        this.setLabel("业绩股页/业绩合计/我的占比", "我 " + text(myPercent, my) + "%");
        this.setLabel("业绩股页/业绩合计/下放占比", "下放 " + text(grantedPercent, granted) + "%");
        this.setLabel("业绩股页/业绩合计/剩余占比", "剩 " + text(leftPercent, left) + "%");
    }

    private refreshPerf() {
        this.perfPage = 0;
        this.perfTotalPages = 1;
        this.perfRows.forEach((row) => row.active = false);
        if(this.perfContent && this.perfView) {
            this.perfContent.setContentSize(this.perfView.width, this.perfView.height);
            this.perfContent.setPosition(0, this.perfView.height / 2);
        }
        this.refreshPerfPaging();
        if(this.clubId === "") {
            this.setPerfHint("当前没有俱乐部，无法查看业绩股");
            return;
        }
        this.setPerfHint("正在加载业绩股…");
        this.requestPerfInfo();
        this.requestPerfList(0);
    }

    private requestPerfInfo() {
        const account:any = GameDataManager.getAccount();
        if(!account || this.clubId === "") return;
        const ctx = "clubperf_info:" + Date.now();
        this.perfInfoPending = true;
        this.perfInfoContext = ctx;
        account.reqHallCommand(JSON.stringify({
            header:panelMyHongli.PERF_HEADER_INFO,
            club_id:this.clubId,
            date:-1,
            context:"p@" + ctx
        }), "P@" + ctx);
    }

    private requestPerfList(page:number = 0) {
        const account:any = GameDataManager.getAccount();
        if(!account || this.clubId === "") return;
        this.perfPage = Math.max(0, page);
        const ctx = "clubperf_list:" + Date.now() + ":" + this.perfPage;
        this.perfListPending = true;
        this.perfListContext = ctx;
        account.reqHallCommand(JSON.stringify({
            header:panelMyHongli.PERF_HEADER_LIST,
            club_id:this.clubId,
            date:-1,
            count:panelMyHongli.PERF_PAGE_SIZE,
            page:this.perfPage,
            context:"p@" + ctx
        }), "P@" + ctx);
    }

    private addPerfMember() {
        const account:any = GameDataManager.getAccount();
        if(!account) return;
        if(this.clubId === "") {
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "当前没有俱乐部！");
            return;
        }
        if(!this.perfEnabled) {
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "你尚未开通业绩，无法添加业绩股成员！");
            return;
        }
        const userId = this.perfInput ? String(this.perfInput.string || "").trim() : "";
        if(!/^\d+$/.test(userId)) {
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "请输入正确的下级代理ID！");
            return;
        }
        if(this.perfGrantPending) return;
        const ctx = "clubperf_grant:" + Date.now();
        this.perfGrantPending = true;
        this.perfGrantContext = ctx;
        this.setPerfHint("正在添加…");
        account.reqHallCommand(JSON.stringify({
            header:panelMyHongli.PERF_HEADER_GRANT,
            club_id:this.clubId,
            user_id:userId,
            enabled:1,
            context:"p@" + ctx
        }), "P@" + ctx);
    }

    /** 兼容字符串 / {"context","result"} / {"ret_code","ret_result"} 三种回包。 */
    private unwrapPerfReply(raw:any):any {
        let data:any = raw;
        let ctx:string = "";
        for(let i = 0; i < 4; ++i) {
            if(typeof data === "string") {
                try { data = JSON.parse(data); } catch(_) { return null; }
                continue;
            }
            if(data === null || typeof data !== "object" || Array.isArray(data)) return null;
            if(ctx === "" && data.context !== undefined && data.context !== null && String(data.context) !== "")
                ctx = String(data.context);
            if(typeof data.ret_result === "string") { data = data.ret_result; continue; }
            if(data.result !== undefined && data.result !== null) { data = data.result; continue; }
            break;
        }
        if(data === null || typeof data !== "object" || Array.isArray(data)) return null;
        if(ctx === "" && data.context !== undefined && data.context !== null)
            ctx = String(data.context);
        return {ctx:ctx, data:data};
    }

    private onPerfReply(code:number, raw:any):boolean {
        const reply:any = this.unwrapPerfReply(raw);
        if(!reply) return false;
        const data:any = reply.data;
        let ctx:string = reply.ctx;
        if(ctx === "") {
            if(data.ClubPerfInfo && this.perfInfoPending) ctx = this.perfInfoContext;
            else if(data.ClubPerfGrantList && this.perfListPending) ctx = this.perfListContext;
            else if(data.user_id !== undefined && data.enabled !== undefined && this.perfGrantPending) ctx = this.perfGrantContext;
            // 服务端异常回包可能不带 context，只有 perf 请求在途且不是红利命令时才兜底。
            else if(code !== 0x200 && !this.hasCommand(typeof raw === "string" ? raw : JSON.stringify(raw), "红利")) {
                if(this.perfGrantPending) ctx = this.perfGrantContext;
                else if(this.perfListPending) ctx = this.perfListContext;
                else if(this.perfInfoPending) ctx = this.perfInfoContext;
            }
        }
        const error = data.error ? String(data.error) : (code !== 0x200 ? "加载失败，请稍后重试" : "");

        if(ctx !== "" && ctx === this.perfInfoContext) {
            this.perfInfoPending = false;
            this.perfInfoContext = "";
            if(error !== "") this.setPerfHint(error);
            else this.applyPerfInfo(data.ClubPerfInfo || data);
            return true;
        }
        if(ctx !== "" && ctx === this.perfListContext) {
            this.perfListPending = false;
            this.perfListContext = "";
            if(error !== "") this.setPerfHint(error);
            else this.applyPerfList(data.ClubPerfGrantList || data, data);
            return true;
        }
        if(ctx !== "" && ctx === this.perfGrantContext) {
            this.perfGrantPending = false;
            this.perfGrantContext = "";
            if(error !== "") {
                this.setPerfHint(error);
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, error);
            }
            else this.onPerfGranted();
            return true;
        }
        return false;
    }

    private applyPerfInfo(info:any) {
        this.perfEnabled = info.enabled !== false;
        this.applyPerfTotals(info.my_count, info.granted_count, info.left_count, info.all_count,
            info.my_percent, info.granted_percent, info.left_percent);
        if(!this.perfEnabled) this.setPerfHint("你尚未开通业绩，暂不能查看业绩股");
    }

    private applyPerfList(listData:any, reply:any) {
        const list:any[] = Array.isArray(listData.list) ? listData.list : [];
        const total = Number(listData.count !== undefined ? listData.count
            : (reply && reply.count !== undefined ? reply.count : 0));
        const reportedPage = Number(listData.number !== undefined ? listData.number
            : (reply && reply.number !== undefined ? reply.number : NaN));
        if(isFinite(reportedPage) && reportedPage >= 0) this.perfPage = reportedPage;
        this.perfTotalPages = isFinite(total) && total > 0
            ? Math.max(1, Math.ceil(total / panelMyHongli.PERF_PAGE_SIZE))
            : Math.max(1, this.perfPage + (list.length >= panelMyHongli.PERF_PAGE_SIZE ? 1 : 0));
        this.applyPerfTotals(listData.my_count, listData.granted_count, listData.left_count, listData.all_count);
        this.renderPerfRows(list);
    }

    private onPerfGranted() {
        if(this.perfInput) this.perfInput.string = "";
        UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "已添加业绩股成员！");
        this.setPerfHint("已添加，正在刷新…");
        // 授权写库是异步的，稍等再刷新，避免读到旧名单。
        this.scheduleOnce(() => {
            if(this.currentTab === panelMyHongli.TAB_PERF) this.refreshPerf();
        }, 0.8);
    }

    private perfRowAt(index:number):cc.Node {
        if(!this.perfContent || !this.perfRowTemplate) return null;
        while(this.perfRows.length <= index) {
            const row = cc.instantiate(this.perfRowTemplate);
            row.name = "业绩行" + (this.perfRows.length + 1).toString();
            row.parent = this.perfContent;
            row.active = false;
            this.perfRows.push(row);
        }
        return this.perfRows[index];
    }

    private renderPerfRows(list:any[]) {
        this.perfRows.forEach((row) => row.active = false);
        const half = this.perfRowTemplate ? this.perfRowTemplate.height / 2 : 48;
        list.forEach((item, index) => {
            const row = this.perfRowAt(index);
            if(!row) return;
            row.active = true;
            row.setPosition(0, -(index * panelMyHongli.PERF_ROW_SPACING + half));
            const guuid = item && item.length > 0 ? String(item[0]) : "";
            const name = item && item.length > 1 ? String(item[1]) : "";
            const percent = item && item.length > 3 ? String(item[3]) : "0.00";
            this.setNodeLabel(row, "昵称", name !== "" ? name : ("ID" + guuid));
            this.setNodeLabel(row, "玩家ID", "ID:" + guuid);
            this.setNodeLabel(row, "占比", percent + "%");
            const avatar = Tool.GetChild(row, "头像/mask/img");
            const sprite = avatar ? avatar.getComponent(cc.Sprite) : null;
            if(sprite && guuid !== "") ImageManager.getInstance().BindPlayerListAvatar(guuid, sprite);
        });
        this.layoutPerfList(list.length);
        if(list.length > 0) {
            if(this.perfEnabled) this.setPerfHint("");
        }
        else this.setPerfHint(this.perfEnabled ? "暂无业绩股成员" : "你尚未开通业绩，暂不能查看业绩股");
        this.refreshPerfPaging();
    }

    private layoutPerfList(count:number) {
        if(!this.perfView || !this.perfContent) return;
        const viewHeight = this.perfView.height;
        const contentHeight = Math.max(viewHeight, count * panelMyHongli.PERF_ROW_SPACING);
        this.perfContent.setContentSize(this.perfView.width, contentHeight);
        // 内容锚点是 (0.5,1)，位置即内容顶边，对齐视口顶边才不会出现半截行。
        this.perfContent.setPosition(0, viewHeight / 2);
        const listNode = Tool.GetChild(this.node, "业绩股页/业绩列表");
        const scroll = listNode ? listNode.getComponent(cc.ScrollView) : null;
        if(scroll) {
            scroll.stopAutoScroll();
            scroll.scrollToTop(0);
        }
    }

    private refreshPerfPaging() {
        if(this.currentTab !== panelMyHongli.TAB_PERF) return;
        const paging = Tool.GetChild(this.node, "分页");
        if(!paging) return;
        const canPrev = this.perfPage > 0;
        const canNext = this.perfPage + 1 < this.perfTotalPages;
        const setInteractable = (name:string, value:boolean) => {
            const node = paging.getChildByName(name);
            if(node && node.getComponent(cc.Button)) node.getComponent(cc.Button).interactable = value;
        };
        setInteractable("首页", canPrev);
        setInteractable("上一页", canPrev);
        setInteractable("下一页", canNext);
        setInteractable("尾页", canNext);
        this.setLabel("分页/页码", (this.perfPage + 1) + " / " + this.perfTotalPages);
    }

    // ---------------------------------------------------------------- 交互

    private openClaimPanel() {
        const account:any = GameDataManager.getAccount();
        if(!account) return;
        if(!this.isUnion() && this.clubId === "") {
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "当前没有俱乐部！");
            return;
        }
        if(Math.floor(this.unclaimedFen / 100) < 1) {
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "红利不足 1 元，无法提取！");
            return;
        }
        this.setLabel("提取红利面板/bk/可提取金额", "可提取金额：" + Math.floor(this.unclaimedFen / 100));
        const panel = this.node.getChildByName("提取红利面板");
        if(panel) panel.active = true;
    }

    private submitClaim() {
        if(this.claimPending) return;
        const account:any = GameDataManager.getAccount();
        if(!account) return;
        const amount = Math.floor(this.unclaimedFen / 100);
        if((!this.isUnion() && this.clubId === "") || amount < 1) {
            this.closeClaimPanel();
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "红利不足 1 元，无法提取！");
            return;
        }
        this.claimPending = true;
        this.closeClaimPanel();
        const params:any = this.isUnion() ? {
            header:"提取_联盟_红利",
            extract_gold:amount,
            context:"提取_联盟_红利"
        } : {
            header:"提取_俱乐部_红利",
            club_id:this.clubId,
            extract_gold:amount,
            context:"提取_俱乐部_红利"
        };
        account.reqHallCommand(JSON.stringify(params), this.isUnion() ? "P@提取_联盟_红利" : "P@提取_俱乐部_红利");
        this.setHint("正在提取 " + amount + " 元…");
    }

    private closeClaimPanel() {
        const panel = this.node.getChildByName("提取红利面板");
        if(panel) panel.active = false;
    }

    private closeSelf() {
        UIManager.getInstance().closePanelByName(this.node.name);
    }

    public onButtonClick(button:cc.Button) {
        const name = button.node.name;
        if(name === "返回" || name === "关闭") this.closeSelf();
        else if(name === "页签_我的红利") this.switchTab(panelMyHongli.TAB_HONGLI);
        else if(name === "页签_业绩股") this.switchTab(panelMyHongli.TAB_PERF);
        else if(name === "确认添加业绩") this.addPerfMember();
        else if(name === "提取红利") this.openClaimPanel();
        else if(name === "记录") {
            this.requestStats();
            this.requestList(0);
        }
        else if(name === "取消提取") this.closeClaimPanel();
        else if(name === "确认提取") this.submitClaim();
        else if(name === "首页") this.goPage(0);
        else if(name === "上一页") this.goPage(this.currentTab === panelMyHongli.TAB_PERF
            ? Math.max(0, this.perfPage - 1) : Math.max(0, this.page - 1));
        else if(name === "下一页") this.goPage(this.currentTab === panelMyHongli.TAB_PERF
            ? Math.min(this.perfTotalPages - 1, this.perfPage + 1) : Math.min(this.totalPages - 1, this.page + 1));
        else if(name === "尾页") this.goPage(this.currentTab === panelMyHongli.TAB_PERF
            ? Math.max(0, this.perfTotalPages - 1) : Math.max(0, this.totalPages - 1));
    }

    private goPage(page:number) {
        if(this.currentTab === panelMyHongli.TAB_PERF) this.requestPerfList(page);
        else this.requestList(page);
    }
}
