import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import { ShowPanelMode, ClosePanelMode } from "../common/GameDef";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import ClubManagementView, { ClubContext, ClubPlayer } from "./ClubManagementView";
import HallClubManagementApi from "./ClubManagementApi";
import panelPlayerPicker, { PlayerPickerItem } from "./panelPlayerPicker";
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
    /** BOSS 扩展信息（IP / 最后登录）请求的 context，可为空表示没有在查。 */
    private extContext:string = "";
    private extTimer:any = null;
    private static extSerial:number = 0;
    private loading:boolean = false;
    private timeoutTimer:any = null;
    private view:ClubManagementView = null;
    private api:HallClubManagementApi = null;
    private context:ClubContext = null;

    // ---- 下级成员行内「添加到分组」（《俱乐部玩家分组》§4.1）----
    /**
     * 选组沿用现成的 panelPlayerPicker（mode=group），这里只负责发「设置_俱乐部_分组_成员」。
     * 加人回执用 `pgset:` 前缀的 context：panelBossPlayerInfo 也监听同名推送，
     * 靠前缀区分归属，避免它重复弹提示并白刷一次分组列表。
     */
    private groupContext:string = "";
    private groupTimer:any = null;
    private static groupSerial:number = 0;

    onLoad () {
        super.onLoad();
        // 从数据统计（基准 0 或牌桌里的 1）点开，比它高一层就够；不要再写死 210，
        // 那会把大厅里后开的弹窗全压到它下面（同 panelBossPlayerInfo 的说明）。
        this.node.zIndex = Tool.PanelBaseZ(this.node) + 1;
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
        KBEngine.Event.register("NumberList", this, "OnMemberList");
        // 加人结果走 ClubPlayerGroupResult 推送（0x200 只带 context）。
        KBEngine.Event.register("ClubPlayerGroupResult", this, "OnGroupResult");
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
        if(this.extTimer != null) {
            clearTimeout(this.extTimer);
            this.extTimer = null;
        }
        this.ClearGroupTimer();
        this.groupContext = "";
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
        // 下级成员行内的「添加到分组」：只有小BOSS（俱乐部/联盟管理员）才注入入口，
        // 不是小BOSS 时 ClubManagementView 那边一颗按钮都不会亮。
        this.view.SetGroupPicker({
            canAdd:(item:ClubPlayer)=>this.CanAddGroup(item),
            open:(item:ClubPlayer)=>this.OpenGroupPicker(item)
        });
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
        const text = param == null ? "" : String(param);
        // 加人命令的回执：受理只带 context（结果在推送里），失败带错误文案。
        if(this.groupContext !== "" && text.indexOf(this.groupContext) >= 0) {
            if(nCode === 0x200 || nCode === 0x500)
                return;
            const failed = this.ErrorText(text);
            this.FinishGroupRequest();
            this.Message(failed);
            return;
        }
        // 扩展信息用独立 context 且回包常晚于成员详情，必须在 loading 判断之前拦下来。
        if(this.extContext !== "" && text.indexOf(this.extContext) >= 0) {
            this.OnExtInfo(nCode, text);
            return;
        }
        if(!this.loading)
            return;
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
        this.QueryExtInfo();
    }

    // ------------------------------------------------------------------
    // BOSS 扩展信息：当前IP / 最后登录时间
    // 文档：服务器文档整理/玩家扩展信息查询-客户端接口文档.md
    // 只有平台 boss/bigboss 放行，客户端先按 IsBossAccount() 决定要不要发；
    // 不是 BOSS 就完全不发，也不动那两行（Prefab 里默认隐藏）。
    // ------------------------------------------------------------------
    private QueryExtInfo():void {
        if(!GameDataManager.IsBossAccount())
            return;
        if(this.userId === "")
            return;
        const account:any = GameDataManager.getAccount();
        if(account == null)
            return;
        // 先占位，回包晚到时界面不会看起来缺一行。
        if(this.view)
            this.view.SetPlayerExtInfo("查询中…", "查询中…", true);
        this.extContext = "playerext:" + Date.now() + ":" + (++panelClubPlayerInfo.extSerial);
        const param:any = {
            header:"查询_玩家_扩展_信息",
            user_id:this.userId,
            context:this.extContext
        };
        // club_id 只写服务端审计日志，不参与查询；有就带上。
        if(this.clubId !== "")
            param.club_id = this.clubId;
        try {
            account.reqHallCommand(JSON.stringify(param), "P@" + this.extContext);
        }
        catch(error) {
            this.extContext = "";
            if(this.view)
                this.view.SetPlayerExtInfo("", "", true);
            return;
        }
        // 服务端未部署/无回包时不能永远停在「查询中…」。
        this.extTimer = setTimeout(()=>{
            this.extTimer = null;
            if(this.extContext === "")
                return;
            this.extContext = "";
            if(this.view && cc.isValid(this.node))
                this.view.SetPlayerExtInfo("", "", true);
        }, 8000);
    }

    private OnExtInfo(nCode:number, raw:string):void {
        this.extContext = "";
        if(this.extTimer != null) {
            clearTimeout(this.extTimer);
            this.extTimer = null;
        }
        if(this.view == null || !cc.isValid(this.node))
            return;
        if(nCode !== 0x200) {
            // 无权限/玩家不存在这类失败不打断详情主流程，两行留「—」。
            this.view.SetPlayerExtInfo("", "", true);
            return;
        }
        const data:any = this.Unwrap(raw);
        const result:any = data && data.result !== undefined ? data.result : data;
        if(result == null || typeof result !== "object") {
            this.view.SetPlayerExtInfo("", "", true);
            return;
        }
        const guuid = String(result.guuid == null ? "" : result.guuid).trim();
        if(guuid !== "" && guuid !== this.userId)
            return;
        // 明文 IP 不上屏，只显示可逆短码；规则见 玩家扩展信息查询-客户端接口文档.md §8。
        this.view.SetPlayerExtInfo(
            panelClubPlayerInfo.EncodeIp(String(result.ip == null ? "" : result.ip).trim()),
            String(result.last_login_time == null ? "" : result.last_login_time).trim(),
            true);
    }

    private static readonly IP_CODE_ALPHABET:string = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    /**
     * IPv4 → 6 位 Base62 短码（固定 6 位，左侧补 0），无损可逆。
     * 后台还原按文档同一规则实现；非 IPv4 返回 ""，界面显示「—」。
     */
    private static EncodeIp(ip:string):string {
        const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
        if(m == null)
            return "";
        const bytes:number[] = [];
        for(let i = 1; i <= 4; i++) {
            const v = parseInt(m[i], 10);
            if(!(v >= 0 && v <= 255))
                return "";
            bytes.push(v);
        }
        const alphabet = panelClubPlayerInfo.IP_CODE_ALPHABET;
        let value = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
        let body = "";
        for(let i = 0; i < 6; i++) {
            body = alphabet.charAt(value % 62) + body;
            value = Math.floor(value / 62);
        }
        return body;
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
    // 下级成员行内「添加到分组」
    // 文档：服务器文档整理/俱乐部玩家分组-客户端与后台接口文档.md（§3.1 / §4.1）
    // 只有小BOSS（后台配了 club_manage / union_manage 的管理员）才有这个入口，
    // 服务端仍会按管理域再校验一次，跨俱乐部 / 跨联盟会被拒。
    // ------------------------------------------------------------------

    /**
     * 当前账号能不能给这个玩家加分组。
     * - 不是小BOSS（没有 club_manage / union_manage）→ 不显示按钮；
     * - 俱乐部管理员只对自己管理范围内的俱乐部放行；
     * - 联盟管理员在客户端拿不到「俱乐部属于哪个联盟」，按已配管理范围放行、服务端复核；
     * - 盟主行属于联盟里另一家俱乐部，恒不加（也避开那行「额度」两格的位置）。
     */
    private CanAddGroup(item:ClubPlayer):boolean {
        if(item == null || item.isLeader === true)
            return false;
        const id = String(item.id || "").trim();
        if(!/^\d+$/.test(id))
            return false;
        const account:any = GameDataManager.getAccount();
        if(account == null)
            return false;
        const clubs = GameDataManager.SplitIdList(account.club_manage);
        const unions = GameDataManager.SplitIdList(account.union_manage);
        if(clubs.length === 0 && unions.length === 0)
            return false;
        const clubId = String(item.clubId || this.clubId || "").trim();
        if(clubId !== "" && clubs.indexOf(clubId) >= 0)
            return true;
        return unions.length > 0;
    }

    /**
     * 行内「添加到分组」：先选分组（复用现成的 panelPlayerPicker），选完再发加人命令。
     * 选组弹窗是另外 showPanel 出来的浮层，层级由 panelPlayerPicker 自己抬（见它的 onLoad）。
     */
    private OpenGroupPicker(item:ClubPlayer):void {
        if(!this.CanAddGroup(item))
            return;
        const clubId = String(item.clubId || this.clubId || "").trim();
        if(clubId === "") {
            this.Message("缺少俱乐部信息，无法查询分组");
            return;
        }
        panelPlayerPicker.Open({
            title:"添加到分组",
            mode:"group",
            clubId:clubId,
            onPick:(picked:PlayerPickerItem)=>{
                if(picked == null || String(picked.id || "").trim() === "")
                    return;
                this.SubmitGroupSet(String(picked.id).trim(),item);
            }
        });
    }

    /** 设置_俱乐部_分组_成员：成功数据走 ClubPlayerGroupResult 推送，0x200 只代表已受理。 */
    private SubmitGroupSet(groupId:string,item:ClubPlayer):void {
        const userId = item == null ? "" : String(item.id || "").trim();
        if(groupId === "" || userId === "")
            return;
        const account:any = GameDataManager.getAccount();
        if(account == null) {
            this.Message("网络未就绪，请稍后重试");
            return;
        }
        this.FinishGroupRequest();
        this.groupContext = "pgset:" + Date.now() + ":" + (++panelClubPlayerInfo.groupSerial);
        const ctx = this.groupContext;
        this.groupTimer = setTimeout(()=>{
            if(this.groupContext !== ctx)
                return;
            this.groupContext = "";
            this.groupTimer = null;
            this.Message("操作超时，请刷新后确认是否已加入分组");
        }, 12000);
        try {
            account.reqHallCommand(JSON.stringify({
                header:"设置_俱乐部_分组_成员",
                group_id:groupId,
                user_id:userId,
                context:ctx
            }), "P@" + ctx);
        }
        catch(error) {
            this.FinishGroupRequest();
            this.Message("请求发送失败，请稍后重试");
        }
    }

    /** ClubPlayerGroupResult：action=set_member 才是这次加人的结果。 */
    public OnGroupResult(raw:any):void {
        if(this.groupContext === "")
            return;
        const data = this.Unwrap(raw);
        if(data == null)
            return;
        if(String(data.action == null ? "" : data.action) !== "set_member")
            return;
        const ctx = String(data.context == null ? "" : data.context);
        if(ctx !== "" && ctx !== this.groupContext)
            return;
        this.FinishGroupRequest();
        const userId = String(data.user_id == null ? "" : data.user_id).trim();
        const groupName = String(data.group_name == null ? "" : data.group_name).trim();
        const who = String(data.user_name == null ? "" : data.user_name).trim() || userId || "玩家";
        if(this.view)
            this.view.SetMemberGroup(userId,groupName);
        this.Message(groupName !== "" ? "已把「" + who + "」加入「" + groupName + "」" : "已加入分组");
    }

    private FinishGroupRequest():void {
        this.ClearGroupTimer();
        this.groupContext = "";
    }

    private ClearGroupTimer():void {
        if(this.groupTimer != null) {
            clearTimeout(this.groupTimer);
            this.groupTimer = null;
        }
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
