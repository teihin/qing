import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import { ShowPanelMode, ClosePanelMode } from "../common/GameDef";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import ClubManagementView, { ClubContext, ClubPlayer } from "./ClubManagementView";
import HallClubManagementApi from "./ClubManagementApi";
var KBEngine = require("kbengine");

const {ccclass, property} = cc._decorator;

/**
 * 独立「玩家信息」弹窗：原来是 panelMain.prefab 里的「俱乐部玩家设置弹窗」，
 * 现拆成独立 Prefab，任何界面都能 showPanel 打开。
 *
 *   UIManager.showPanel("panelClubPlayerInfo", ShowPanelMode.Cover,
 *       JSON.stringify({userId:"580629", clubId:"267493"}));
 *
 * 节点结构与交互仍由 ClubManagementView 驱动（上下分/赠送/备注/比例/暗扣/下级/额度记录
 * 全部复用同一套逻辑），这里只负责：按 userId + clubId 拉一次单人详情 → 转 ClubPlayer → 打开。
 */
@ccclass
export default class panelClubPlayerInfo extends UIPanelViewBase {

    private static serial:number = 0;

    /**
     * 独立弹窗只做「查看」：成员设置页里的管理操作按钮一律收起，
     * 标签与数值（备注 / 比例 / 代理状态 / 盟主比例 / 暗扣）照常显示。
     */
    private static readonly ACTION_NODES:string[] = [
        "玩家设置赠送金币", "玩家设置上下分", "玩家设置踢出俱乐部",
        "玩家设置备注", "玩家设置调整比例", "玩家设置代理开关",
        "玩家设置开通额度", "玩家设置增加额度", "玩家设置减少额度",
        "玩家设置调整盟主比例", "玩家设置调整暗扣"
    ];

    /** 任意界面复用入口：只给玩家 ID 也能开，clubId 缺省时用服务端按 ID 反查。 */
    public static Open(userId:string, clubId:string = "", name:string = ""):void {
        UIManager.getInstance().showPanel("panelClubPlayerInfo", ShowPanelMode.Cover,
            JSON.stringify({userId:userId, clubId:clubId, name:name}));
    }

    private userId:string = "";
    private clubId:string = "";
    private requestContext:string = "";
    private loading:boolean = false;
    private timeoutTimer:any = null;
    private view:ClubManagementView = null;
    private api:HallClubManagementApi = null;
    private context:ClubContext = null;

    onLoad () {
        super.onLoad();
        // 从数据统计（基准 0 或牌桌里的 1）点开，比它高一层就够；不要再写死 210，
        // 那会把大厅里后开的弹窗全压到它下面（同 panelBossPlayerInfo 的说明）。
        this.node.zIndex = Tool.PanelBaseZ(this.node) + 1;
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
        KBEngine.Event.register("NumberList", this, "OnMemberList");
    }

    start () {
        this.ReadInput();
        this.BuildView();
        this.BindMask();
        this.QueryDetail();
    }

    /** 收起所有管理操作按钮，只留只读展示。 */
    private HideActions():void {
        for(const name of panelClubPlayerInfo.ACTION_NODES) {
            const node = this.At("俱乐部玩家设置弹窗/面板/" + name);
            if(node != null)
                node.active = false;
        }
    }

    /** 面板子树会先被激活再显示，必须在激活后重新扫描一遍按钮。 */
    private BindButtons():void {
        const buttons = this.node.getComponentsInChildren(cc.Button);
        for(const button of buttons) {
            button.transition = cc.Button.Transition.NONE;
            button.node.targetOff(this);
            button.node.on("click", ()=>this.onButtonClick(button), this);
        }
    }

    /** 遮罩本身没有 cc.Button（面板是被拆出来的），这里补一个点击关闭。 */
    private BindMask():void {
        const mask = this.At("俱乐部玩家设置弹窗/遮罩");
        if(mask == null)
            return;
        mask.targetOff(this);
        mask.on(cc.Node.EventType.TOUCH_END, ()=>{
            UIManager.getInstance().closePanelByName(this.node.name, ClosePanelMode.Normal);
        }, this);
    }

    onDestroy () {
        if(this.timeoutTimer != null) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
        if(this.api)
            KBEngine.Event.deregisterAll(this.api);
        this.api = null;
        this.view = null;
        super.onDestroy();
    }

    // ------------------------------------------------------------------
    // 入参 / 上下文
    // ------------------------------------------------------------------
    private ReadInput():void {
        let data:any = null;
        try {
            data = JSON.parse(this.strUserData || "{}");
        }
        catch(error) {
            data = null;
        }
        if(data != null && (data.userId || data.user_id)) {
            this.userId = String(data.userId || data.user_id || "").trim();
            this.clubId = String(data.clubId || data.club_id || "").trim();
            return;
        }
        const player:any = this.arrayEx && this.arrayEx.length > 0 ? this.arrayEx[0] : null;
        if(player != null && player.info != null) {
            this.userId = String(player.info.strUserID || "").trim();
            this.clubId = String(player.info.req_club_id || "").trim();
        }
    }

    private BuildView():void {
        const account:any = GameDataManager.getAccount();
        this.context = {
            accountId:String(account ? account.guuid : ""),
            id:this.clubId,
            name:"",
            // 平台 boss 看到完整管理能力；服务端另有 boss 名单鉴权。
            role:"owner" as any,
            ownerId:"",
            isAgent:false
        };
        this.view = new ClubManagementView(this.node, ()=>this.context, (text:string)=>this.Message(text));
        // 下级成员 / 额度记录两个页签要真正发请求，必须挂上同一个 API 适配器。
        // 红点回调和代理判断在独立弹窗里没有意义，给空实现。
        this.api = new HallClubManagementApi(()=>{}, ()=>false, ()=>[]);
        try {
            this.view.SetApi(this.api);
        }
        catch(error) {
            // SetApi 里会顺带刷新大厅那张俱乐部主页卡片，独立弹窗里没有那些节点，
            // 失败不影响弹窗本身的可视化与页签请求。
        }
    }

    private Message(text:string):void {
        if(text)
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, text);
    }

    // ------------------------------------------------------------------
    // 查单人详情
    // ------------------------------------------------------------------
    private QueryDetail():void {
        if(this.userId === "") {
            this.Message("玩家ID无效");
            UIManager.getInstance().closePanelByName(this.node.name, ClosePanelMode.Normal);
            return;
        }
        const account:any = GameDataManager.getAccount();
        if(account == null) {
            this.Message("网络未就绪，请稍后重试");
            return;
        }
        this.Active("俱乐部玩家设置弹窗", true);
        // 弹窗子树默认 inactive，基类 onLoad 那次扫描拿不到里面的按钮，这里补绑。
        this.BindButtons();
        this.Text("俱乐部玩家设置弹窗/面板/玩家姓名", "加载中…");

        this.loading = true;
        this.requestContext = "clubcard:" + Date.now() + ":" + (++panelClubPlayerInfo.serial);
        this.timeoutTimer = setTimeout(()=>{
            if(!this.loading)
                return;
            this.loading = false;
            this.Message("查询超时，请稍后重试");
        }, 10000);

        const param:any = {
            header:"查询_俱乐部_成员",
            user_id:this.userId,
            count:"1",
            page:"0",
            context:this.requestContext
        };
        if(this.clubId !== "")
            param.club_id = this.clubId;
        try {
            account.reqHallCommand(JSON.stringify(param), "P@" + this.requestContext);
        }
        catch(error) {
            this.Finish();
            this.Message("请求发送失败，请稍后重试");
        }
    }

    private Finish():void {
        this.loading = false;
        if(this.timeoutTimer != null) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
    }

    public onHallCommand(nCode:number, param:string):void {
        if(!this.loading)
            return;
        const text = param == null ? "" : String(param);
        if(this.requestContext !== "" && text.indexOf(this.requestContext) < 0)
            return;
        if(nCode === 0x200)
            return;
        this.Finish();
        this.Message(this.ErrorText(text));
    }

    public OnMemberList(raw:any):void {
        if(!this.loading)
            return;
        const data = this.Unwrap(raw);
        if(data == null)
            return;
        const rows = this.MemberRows(data);
        if(rows == null)
            return;
        let target:any = null;
        for(const one of rows) {
            if(one && typeof one === "object" &&
                String(one.guuid || one.user_id || "") === this.userId) {
                target = one;
                break;
            }
        }
        if(target == null && rows.length === 1 && rows[0] && typeof rows[0] === "object")
            target = rows[0];
        if(target == null)
            return;
        this.Finish();
        const item = this.ToPlayer(target);
        if(this.view)
            this.view.OpenPlayerCard(item, this.context);
        this.HideActions();
    }

    private ToPlayer(row:any):ClubPlayer {
        const text = (v:any):string => String(v == null ? "" : v).trim();
        return {
            id:text(row.guuid || row.user_id),
            name:text(row.name),
            role:text(row.role),
            clubId:text(row.club_id) || this.clubId,
            clubGold:text(row.club_gold),
            isAgent:text(row.is_agent) === "1",
            isLeader:text(row.is_leader) === "1",
            agentPercent:text(row.percent),
            status:text(row.status),
            note:text(row.note),
            teamCount:text(row.team_count),
            points:text(row.gold),
            online:text(row.status) === "在线",
            todayWin:text(row.today_score),
            yesterdayWin:text(row.yesterday_score),
            totalWin:text(row.total_score),
            todayContribution:text(row.today_contrib_fen),
            yesterdayContribution:text(row.yesterday_contrib_fen),
            totalContribution:text(row.total_contrib_fen)
        } as ClubPlayer;
    }

    private Unwrap(raw:any):any {
        if(raw == null)
            return null;
        let data:any = raw;
        if(typeof data === "string") {
            try { data = JSON.parse(data); }
            catch(error) { return null; }
        }
        if(data == null || typeof data !== "object")
            return null;
        if(typeof data.result === "string") {
            try { data.result = JSON.parse(data.result); }
            catch(error) {}
        }
        return data;
    }

    private MemberRows(data:any):any[] {
        const candidates:any[] = [
            data.NumberList,
            data.result && data.result.NumberList,
            Array.isArray(data.result) ? data.result : null,
            Array.isArray(data) ? data : null
        ];
        for(const value of candidates) {
            if(Array.isArray(value))
                return value;
        }
        for(const value of [data.result, data]) {
            if(value && typeof value === "object" && !Array.isArray(value) &&
                (value.guuid !== undefined || value.user_id !== undefined))
                return [value];
        }
        return null;
    }

    private ErrorText(param:string):string {
        try {
            const data:any = JSON.parse(param);
            const result:any = data && data.result !== undefined ? data.result : data;
            if(typeof result === "string" && result !== "")
                return result;
            if(result && result.error)
                return String(result.error);
        }
        catch(error) {}
        return "查询失败，请稍后重试";
    }

    // ------------------------------------------------------------------
    // 基础工具
    // ------------------------------------------------------------------
    private At(path:string):cc.Node {
        return Tool.GetChild(this.node, path);
    }

    private Text(path:string, value:string):void {
        const node = this.At(path);
        const label = node ? node.getComponent(cc.Label) : null;
        if(label)
            label.string = value;
    }

    private Active(path:string, value:boolean):void {
        const node = this.At(path);
        if(node)
            node.active = value;
    }

    public onButtonClick(button:cc.Button):void {
        const name = button.node.name;
        if(name === "玩家设置关闭" || name === "遮罩") {
            UIManager.getInstance().closePanelByName(this.node.name, ClosePanelMode.Normal);
            return;
        }
        // 其余按钮（页签/复制ID…）仍交给 ClubManagementView 处理。
        if(this.view)
            this.view.HandleButton(button);
        this.HideActions();
    }
}
