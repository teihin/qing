import UIPanelViewBase from "../common/UIPanelViewBase";
import GameDataManager from "../GameDataManager";
import Tool from "../common/Tool";
import UIManager from "../common/UIManager";
import { ShowPanelMode } from "../common/GameDef";

var KBEngine = require("kbengine");
const {ccclass} = cc._decorator;

/**
 * 俱乐部模式「我的红利」弹窗。
 *
 * 全部数据按当前俱乐部读取（V2 文档 §9）：
 * - 顶部统计：`查询_俱乐部_红利_统计` → `ClubBonusStats`
 *   今日/昨日新增、累计提取、未提取余额；累计红利 = 未提取 + 累计提取。
 * - 明细：`查询_俱乐部_红利_明细` → `ClubBonusList`。
 * - 提取：`提取_俱乐部_红利`，`extract_gold` 为整数元；当前入口按全部可提整数元提取。
 *
 * `mode=union` 时复用同一套界面和逻辑，改走联盟红利（V2 文档 §10）：
 * `查询_联盟_红利_统计` → `ClubUnionBonusStats`、`查询_联盟_红利_明细` → `ClubUnionBonusList`、
 * `提取_联盟_红利`。统计字段与俱乐部分红同名，明细的「房间号」列显示来源房间。
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

    onLoad() {
        super.onLoad();
        this.initList();
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
        this.beginQuery();
    }

    onEnable() {
        if(!this.started) return;
        this.beginQuery();
    }

    onDisable() {
        this.claimPending = false;
        this.statsPending = false;
        this.listPending = false;
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
        if(!isFinite(fen)) return "—";
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
        this.setLabel("统计/今日红利/num", "—");
        this.setLabel("统计/昨日红利/num", "—");
        this.setLabel("统计/累计红利/num", "—");
        this.setLabel("未领取红利/num", "—");
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

    public onHallCommand(code:number, raw:string) {
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
        else if(name === "提取红利") this.openClaimPanel();
        else if(name === "记录") {
            this.requestStats();
            this.requestList(0);
        }
        else if(name === "取消提取") this.closeClaimPanel();
        else if(name === "确认提取") this.submitClaim();
        else if(name === "首页") this.requestList(0);
        else if(name === "上一页") this.requestList(Math.max(0, this.page - 1));
        else if(name === "下一页") this.requestList(Math.min(this.totalPages - 1, this.page + 1));
        else if(name === "尾页") this.requestList(Math.max(0, this.totalPages - 1));
    }
}
