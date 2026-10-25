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
 * 数据来源按《俱乐部代理与邀请码 — 客户端接口文档》：
 * - 今日 / 昨日收益：`查询_俱乐部_代理_收益`（必带 club_id、date），推送路由
 *   `ClubAgentIncomeInfo`，读 `summary.total_fen`（分，展示 ÷100）。
 * - 收益明细列表：同一接口的 `result` 数组（`ClubAgentIncome`）。
 * - 累计红利 / 未领取红利 / 提取：账号属性 `all_hongli` / `hongli` 与既有命令
 *   `提取_玩家_红利`；文档 §1.7 明确 `*_fen` 与红利账户同单位，§6 时序里代理也是
 *   用这条既有命令提红利，俱乐部模式免门槛（§7-10），所以客户端不提示 5 个下级门槛。
 *
 * 两处协议要点：
 * 1. `ClubAgentIncomeInfo` 的推送**不带请求上下文**，同界面不能并发同路由请求，
 *    所以今日 → 昨日 → 列表按序串行，用 pendingKind 配对。
 * 2. 服务端 0x301 异常回包只带 context，因此每个请求都在 param 里显式带 `context`。
 *
 * 未传 club_id 时（panelHongli 的「提取红利」入口）退回平台代理口径：
 * 今日/昨日走 `异步_查询_红利_信息`，列表走 `查询_玩家_红利提取_记录`
 * （它的数据由 onMessage 路由 `HongliList` 推送，不走 onHallCommand）。
 */
@ccclass
export default class panelMyHongli extends UIPanelViewBase {
    private readonly PAGE_SIZE:number = 8;
    private page:number = 0;
    private totalPages:number = 1;
    private claimPending:boolean = false;
    private started:boolean = false;

    /** 俱乐部 ID；空串表示平台代理口径。 */
    private clubId:string = "";
    /** today / yesterday / list，用于配对 ClubAgentIncomeInfo 的串行推送。 */
    private pendingKind:string = "";
    /** 服务端未上线俱乐部代理收益接口时置位，退回平台红利统计。 */
    private clubIncomeUnavailable:boolean = false;
    /** income=俱乐部分成明细；history=红利提取流水。 */
    private listMode:string = "income";

    onLoad() {
        super.onLoad();
        KBEngine.Event.register("set_hongli", this, "set_hongli");
        KBEngine.Event.register("set_all_hongli", this, "set_all_hongli");
        KBEngine.Event.register("set_use_hongli", this, "set_use_hongli");
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
        KBEngine.Event.register("ClubAgentIncomeInfo", this, "onClubAgentIncome");
        KBEngine.Event.register("HongliList", this, "onHongliList");
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
        this.pendingKind = "";
    }

    // ---------------------------------------------------------------- 基础

    private readUserData() {
        this.clubId = "";
        const raw = this.strUserData || "";
        if(raw === "") return;
        let data:any = null;
        try { data = JSON.parse(raw); } catch(_) { data = null; }
        if(!data || typeof data !== "object") return;
        this.clubId = String(data.club_id || data.clubId || "");
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

    /** 账号属性里的红利单位是分。 */
    private accountAmount(raw:any):string {
        const value = Number(raw);
        if(!isFinite(value)) return "—";
        return Math.trunc(value / 100).toString();
    }

    /** 接口里的 *_fen 单位为分，展示成元。 */
    private fenText(raw:any):string {
        const fen = Number(raw);
        if(!isFinite(fen)) return "—";
        const yuan = fen / 100;
        return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2);
    }

    private dateString(offsetDay:number):string {
        const now = new Date();
        now.setDate(now.getDate() + offsetDay);
        const month = String(now.getMonth() + 1);
        const day = String(now.getDate());
        return now.getFullYear() + "-" + (month.length < 2 ? "0" + month : month) + "-" + (day.length < 2 ? "0" + day : day);
    }

    private parseJson(raw:any):any {
        if(raw && typeof raw === "object") return raw;
        if(typeof raw !== "string") return null;
        try { return JSON.parse(raw); } catch(_) { return null; }
    }

    private hasCommand(raw:any, name:string):boolean {
        return typeof raw === "string" && raw.indexOf(name) >= 0;
    }

    // ---------------------------------------------------------------- 账号余额

    private refreshAccountValues() {
        const account:any = GameDataManager.getAccount();
        if(!account) {
            this.setLabel("统计/累计红利/num", "—");
            this.setLabel("未领取红利/num", "—");
            this.setLabel("提取红利面板/bk/可提取金额", "可提取金额：—");
            return;
        }
        this.setLabel("统计/累计红利/num", this.accountAmount(account.all_hongli));
        this.setLabel("未领取红利/num", this.accountAmount(account.hongli));
        this.setLabel("提取红利面板/bk/可提取金额", "可提取金额：" + this.accountAmount(account.hongli));
    }

    public set_hongli() { this.refreshAccountValues(); }
    public set_all_hongli() { this.refreshAccountValues(); }
    public set_use_hongli() { this.refreshAccountValues(); }

    // ---------------------------------------------------------------- 查询入口

    private beginQuery() {
        this.refreshAccountValues();
        const clubMode = this.clubId !== "" && !this.clubIncomeUnavailable;
        this.listMode = clubMode ? "income" : "history";
        this.page = 0;
        if(clubMode) {
            // 今日 → 昨日 → 列表 必须串行：ClubAgentIncomeInfo 的推送不带 context，并发会串数据。
            this.setLabel("统计/今日红利/num", "—");
            this.setLabel("统计/昨日红利/num", "—");
            this.setHint("正在加载俱乐部收益…");
            this.requestIncome("today", this.dateString(0), 0, 1);
        } else {
            this.requestAccountSummary();
            this.requestRecords(0);
        }
    }

    /** 俱乐部维度：今日/昨日/明细。count=1 只取 summary。 */
    private requestIncome(kind:string, date:string, page:number, count:number) {
        const account:any = GameDataManager.getAccount();
        if(!account || this.clubId === "") return;
        this.pendingKind = kind;
        if(kind === "list") this.setHint("正在加载俱乐部收益明细…");
        if(kind === "today" || kind === "yesterday") this.armIncomeWatchdog();
        const params:any = {
            header:"查询_俱乐部_代理_收益",
            club_id:this.clubId,
            date:date,
            page:String(page),
            count:String(count),
            context:"查询_俱乐部_代理_收益"
        };
        account.reqHallCommand(JSON.stringify(params), "P@查询_俱乐部_代理_收益");
    }

    /** 服务端没上线该命令时可能既无推送也不回 0x301，用超时兜底回退，避免卡在加载中。 */
    private armIncomeWatchdog() {
        this.unscheduleAllCallbacks();
        this.scheduleOnce(() => {
            if(this.clubIncomeUnavailable) return;
            // 只兜「今日/昨日」没回包的情况；列表请求本来就可能慢，不回退。
            if(this.pendingKind !== "today" && this.pendingKind !== "yesterday") return;
            this.fallbackToAccountIncome();
        }, 3);
    }

    private fallbackToAccountIncome() {
        this.clubIncomeUnavailable = true;
        this.pendingKind = "";
        this.listMode = "history";
        this.setLabel("统计/今日红利/num", "—");
        this.setLabel("统计/昨日红利/num", "—");
        this.requestAccountSummary();
        this.requestRecords(0);
    }

    /** 平台口径的今日/昨日红利（俱乐部接口不可用时兜底）。 */
    private requestAccountSummary() {
        const account:any = GameDataManager.getAccount();
        if(!account) return;
        const params:any = {header:"异步_查询_红利_信息", context:"异步_查询_红利_信息"};
        account.reqHallCommand(JSON.stringify(params), "P@异步_查询_红利_信息");
    }

    private requestRecords(page:number = 0) {
        this.page = Math.max(0, page);
        const account:any = GameDataManager.getAccount();
        if(!account) return;
        if(this.listMode === "income") {
            // 串行链（今日→昨日→列表）未走完时不插队，否则同路由推送会串。
            if(this.pendingKind !== "" && this.pendingKind !== "list") return;
            this.requestIncome("list", this.dateString(0), this.page, this.PAGE_SIZE);
            return;
        }
        // 服务端这条 SQL 只有 limit count、没有 offset，page 无效；
        // 按 (page+1)*PAGE_SIZE 取回后本地切页，翻页才不会重复同一批。
        const params:any = {
            header:"查询_玩家_红利提取_记录",
            user_id:String(account.guuid || ""),
            count:String((this.page + 1) * this.PAGE_SIZE),
            context:"查询_玩家_红利提取_记录"
        };
        this.setHint("正在加载提取记录…");
        account.reqHallCommand(JSON.stringify(params), "P@查询_玩家_红利提取_记录");
    }

    // ---------------------------------------------------------------- 推送处理

    /** 路由 ClubAgentIncomeInfo：{number, count, summary:{date,total_fen,total_count}, result:[ClubAgentIncome]} */
    public onClubAgentIncome(raw:any) {
        const msg:any = this.parseJson(raw);
        if(!msg || typeof msg !== "object") return;
        this.unscheduleAllCallbacks();
        const kind = this.pendingKind;
        if(kind === "today" || kind === "yesterday") {
            const summary = msg.summary && typeof msg.summary === "object" ? msg.summary : null;
            this.setLabel(kind === "today" ? "统计/今日红利/num" : "统计/昨日红利/num",
                summary ? this.fenText(summary.total_fen) : "0");
            if(kind === "today") this.requestIncome("yesterday", this.dateString(-1), 0, 1);
            else this.requestIncome("list", this.dateString(0), 0, this.PAGE_SIZE);
            return;
        }
        if(kind !== "list") return;
        this.pendingKind = "";
        this.renderIncomeRows(msg);
    }

    /** 路由 HongliList：{HongliList:[{date,hongli_number}], context} */
    public onHongliList(raw:any) {
        if(this.listMode !== "history") return;
        const msg:any = this.parseJson(raw);
        if(!msg || typeof msg !== "object") return;
        const rows:any[] = Array.isArray(msg.HongliList) ? msg.HongliList : [];
        this.renderHistoryRows(rows);
    }

    public onHallCommand(code:number, raw:string) {
        if(this.hasCommand(raw, "查询_俱乐部_代理_收益")) {
            // 服务端未上线 4.6（命令不存在回 0x301）：退回平台红利口径，避免面板空白。
            if(code !== 0x200 && !this.clubIncomeUnavailable) this.fallbackToAccountIncome();
            return;
        }
        if(this.hasCommand(raw, "查询_玩家_红利提取_记录")) {
            if(code !== 0x200) this.setHint("提取记录加载失败");
            return;
        }
        if(this.hasCommand(raw, "异步_查询_红利_信息")) {
            if(code === 0x200) this.renderAccountSummary(this.parseJson(raw));
            return;
        }
        if(this.hasCommand(raw, "提取_玩家_红利")) {
            this.claimPending = false;
            if(code === 0x200) {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "提取成功！");
                this.refreshAccountValues();
                if(this.clubId !== "" && !this.clubIncomeUnavailable) this.requestIncome("today", this.dateString(0), 0, 1);
                else this.requestAccountSummary();
                this.requestRecords(0);
            } else {
                const message:any = this.parseJson(raw);
                const error = message && message.result && message.result.error ? message.result.error : "提取失败，请稍后重试";
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, error);
            }
            return;
        }

        // `异步_查询_红利_信息` 服务端直接返回 [今日,昨日,前日]，回包里不一定带命令名，
        // 用形状兜底，避免统计永远空着。
        const message:any = this.parseJson(raw);
        if(code === 0x200 && Array.isArray(message) && message.length >= 2) this.renderAccountSummary(message);
        else if(code === 0x200 && message && Array.isArray(message.result) && message.result.length >= 2 && typeof message.result[0] !== "object")
            this.renderAccountSummary(message);
    }

    private renderAccountSummary(message:any) {
        if(!message) return;
        const data:any = Array.isArray(message) ? message : message.result;
        if(!Array.isArray(data)) return;
        this.setLabel("统计/今日红利/num", data[0]);
        this.setLabel("统计/昨日红利/num", data[1]);
        this.refreshAccountValues();
    }

    // ---------------------------------------------------------------- 列表渲染

    private rowNodes():cc.Node[] {
        const list = Tool.GetChild(this.node, "列表");
        return list ? list.children : [];
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

    private renderIncomeRows(message:any) {
        const rows:any[] = Array.isArray(message.result) ? message.result : [];
        const reportedPage = Number(message.number);
        const reportedCount = Number(message.count);
        if(isFinite(reportedPage) && reportedPage >= 0) this.page = reportedPage;
        this.totalPages = isFinite(reportedCount) && reportedCount > 0
            ? Math.max(1, Math.ceil(reportedCount / this.PAGE_SIZE))
            : Math.max(1, this.page + 1);

        const nodes = this.rowNodes();
        nodes.forEach((node, index) => {
            const row = rows[index];
            node.active = !!row;
            if(!row) return;
            this.setNodeLabel(node, "玩家", String(row.winner_name || row.winner_guuid || "—"));
            const percent = Number(row.percent);
            this.setNodeLabel(node, "类型", isFinite(percent) ? ("分成 " + percent + "%") : "分成");
            this.setNodeLabel(node, "金额", this.fenText(row.amount_fen));
            this.setNodeLabel(node, "时间", String(row.time || row.date || "—"));
        });
        this.setHint(rows.length === 0 ? "暂无收益明细" : "");
        this.refreshPaging();
    }

    private renderHistoryRows(all:any[]) {
        const start = this.page * this.PAGE_SIZE;
        const rows = all.slice(start, start + this.PAGE_SIZE);
        const account:any = GameDataManager.getAccount();
        const selfId = account ? String(account.guuid || "") : "";
        const nodes = this.rowNodes();
        nodes.forEach((node, index) => {
            const row = rows[index];
            node.active = !!row;
            if(!row) return;
            this.setNodeLabel(node, "玩家", String(row.player_guuid || row.user_id || selfId || "—"));
            this.setNodeLabel(node, "类型", "红利提取");
            this.setNodeLabel(node, "金额", String(row.hongli_number === undefined || row.hongli_number === null ? "—" : row.hongli_number));
            this.setNodeLabel(node, "时间", String(row.date || row.time || "—"));
        });
        // 服务端没有总条数，只能按"本页是否取满"推断还有没有下一页。
        this.totalPages = all.length >= (this.page + 1) * this.PAGE_SIZE ? this.page + 2 : Math.max(1, this.page + 1);
        this.setHint(rows.length === 0 ? "暂无提取记录" : "");
        this.refreshPaging();
    }

    // ---------------------------------------------------------------- 交互

    private openClaimPanel() {
        const account:any = GameDataManager.getAccount();
        if(!account) return;
        if(Number(account.hongli) <= 0) {
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "当前没有红利！");
            return;
        }
        this.refreshAccountValues();
        const panel = this.node.getChildByName("提取红利面板");
        if(panel) panel.active = true;
    }

    private submitClaim() {
        if(this.claimPending) return;
        const account:any = GameDataManager.getAccount();
        if(!account) return;
        if(Number(account.hongli) <= 0) {
            this.closeClaimPanel();
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "当前没有红利！");
            return;
        }
        this.claimPending = true;
        this.closeClaimPanel();
        // 服务端按 param.context 回包；不带的话 0x200/0x301 回包里没有命令名，配不上回调。
        const params:any = {header:"提取_玩家_红利", context:"提取_玩家_红利"};
        account.reqHallCommand(JSON.stringify(params), "P@提取_玩家_红利");
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
        else if(name === "记录") this.requestRecords(0);
        else if(name === "取消提取") this.closeClaimPanel();
        else if(name === "确认提取") this.submitClaim();
        else if(name === "首页") this.requestRecords(0);
        else if(name === "上一页") this.requestRecords(Math.max(0, this.page - 1));
        else if(name === "下一页") this.requestRecords(Math.min(this.totalPages - 1, this.page + 1));
        else if(name === "尾页") this.requestRecords(Math.max(0, this.totalPages - 1));
    }
}
