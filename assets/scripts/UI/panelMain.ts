import HallClubManagementApi from "./ClubManagementApi";
import ClubManagementView from "./ClubManagementView";
import UIPanelViewBase from "../common/UIPanelViewBase";
import Debug from "../common/Debug";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import ScrollViewEx from "../common/ScrollViewEx";
import { ScrollEvent, ShowPanelMode, RoomType, ClosePanelMode, WEB_TX_IP } from "../common/GameDef";
import UIManager from "../common/UIManager";
import ImageManager from "../logic/ImageManager";
import MobileManager from "../mobile/MobileManager";
import ConfigManager from "../logic/ConfigManager";
import GpsManager from "../logic/GpsManager";
import UpdateManager from "../logic/UpdateManager";
import ScrollViewNoEnd from "../common/ScrollViewNoEnd";
import ObjPoolManager from "../logic/ObjPoolManager";
import scrollview2 from "../common/scrollview2";
import DeviceIdentityManager from "../logic/DeviceIdentityManager";
import QueueMatchManager from "../logic/QueueMatchManager";
import WebSceneLoader from "../common/WebSceneLoader";
import WebLoadingManager from "../common/WebLoadingManager";
import RoomInviteManager from "../logic/RoomInviteManager";
import panelExchangeStone from "./panelExchangeStone";
import panelBossPlayerInfo from "./panelBossPlayerInfo";
import { resolveRoomClubId, withRoomClubId } from "../logic/RoomClubContext";
import DirectChatManager from "../logic/DirectChatManager";

var KBEngine = require("kbengine");

const {ccclass, property} = cc._decorator;

@ccclass
export default class panelMain extends UIPanelViewBase {

    private PAGE_PER_COUNT:number = 15;
    @property(ScrollViewNoEnd)
    scrollRoom:ScrollViewNoEnd = null; //房间列表控件
    @property(cc.RawAsset)
    mainifestUrl: cc.RawAsset= null;

    strPreRoomParam:string = ""; 
    strCurRoomParam:string = ""; //最后一次请求参数

    private scrollExchangeInfo:ScrollViewEx = null;
    private scrollLiushui:ScrollViewEx = null;

    private txtInputRoomid:cc.Label = null; //房号

    private scrollRoom2:scrollview2 = null;
    private arrayRoomData:any[] = []; //房间滚动列表数据缓存
    private readonly ROOM_PAGE_COUNT:number = 200;
    private selectedRoomClubId:string = "";
    private roomClubAccountKey:string = "";
    private roomListLoading:boolean = false;
    private roomListHasMore:boolean = true;
    private roomListRequestPage:number = -1;
    private roomListRequestFilterKey:string = "";
    private roomListAppliedFilterKey:string = "";
    private roomListDesiredFilterKey:string = "";
    private roomListPendingRefresh:boolean = false;
    private readonly roomListRequestTimeoutHandler = ()=>{
        if(!this.roomListLoading)
            return;
        this.roomListLoading = false;
        this.roomListRequestPage = -1;
        this.roomListRequestFilterKey = "";
        // 超时后不自动连发同一请求；用户切换了筛选时只补发最新筛选。
        if(this.roomListPendingRefresh)
        {
            this.roomListPendingRefresh = false;
            this.scheduleOnce(()=>this.getAllRooms(0,true));
        }
    };
    /** 游戏规则创建/删除后延迟刷新房间列表；多次触发合并成最后一次。 */
    private roomListRuleRefreshScheduled:boolean = false;
    private readonly roomListRuleRefreshHandler = ()=>{
        this.roomListRuleRefreshScheduled = false;
        this.getAllRooms(0,true);
    };

    private listSet = ['战绩','代理','资金明细','赠送','设置'];
    private walletReturnToCashWater:boolean = false;
    private walletOpening:boolean = false;
    private walletOpenRequest:number = 0;
    private updatingMainTabSelection:boolean = false;
    private promotionReturnPanel:cc.Node = null;
    private clubManagementApi:HallClubManagementApi = null;
    public clubManagement:ClubManagementView = null;
    private clubInputId:string = "";
    /** 加入弹窗当前模式：普通俱乐部邀请码或 V2 联盟号。 */
    private clubJoinDialogMode:"club"|"union" = "club";
    /** 创建弹窗当前模式：普通俱乐部或 V2 联盟。 */
    private clubCreateDialogMode:"club"|"union" = "club";
    private clubCommandBusy:boolean = false;
    /** 当前俱乐部的 V2 联盟状态；查询未完成前不显示创建/加入入口。 */
    private clubUnionStatus:{[clubId:string]:{known:boolean;hasUnion:boolean;unionId?:string;unionName?:string;isOwner?:boolean;ownerConfirmed?:boolean;quotaFen?:number;unionPercent?:number}} = {};
    private clubUnionAsked:{[clubId:string]:number} = {};
    /** ClubUnionQuota 推送不带 club_id，记录最近一次联盟状态查询对应的俱乐部。 */
    private clubUnionPendingClubId:string = "";
    /** 联盟号到联盟名称的缓存；俱乐部回包缺 union_name 时由 ClubMyUnion 补齐。 */
    private clubUnionNames:{[unionId:string]:string} = {};
    private clubUnionNameAsked:{[clubId:string]:number} = {};
    private clubUnionNamePendingClubId:string = "";
    private unionCreateCostPending:number = 0;
    private unionCreateClubId:string = "";
    /** 本次「申请_加入_联盟」的俱乐部与联盟码；成功后立即把 union_apply 落到俱乐部信息。 */
    private unionJoinPendingClubId:string = "";
    private unionJoinPendingUnionId:string = "";
    private unionCreateName:string = "";
    private unionCreatePushReceived:boolean = false;
    private unionChargeBusy:boolean = false;
    private readonly unionChargeTimeoutHandler = ()=>{
        if(!this.unionChargeBusy)
            return;
        this.unionChargeBusy = false;
        this.unionCreateCostPending = 0;
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
            "联盟创建已受理，但钻石扣除处理超时，请稍后在「钻石流向」核对！");
    };
    /** 「我的 → 赠送」当前是否有一笔俱乐部积分请求等待回包。 */
    private clubGoldGiftPending:boolean = false;
    /** 最近一次俱乐部赠送记录查询，异步推送没有统一带回 club_id 时用它配对。 */
    private clubGiftRecordClubId:string = "";
    private clubGiftRecordPage:number = 0;
    /** 最近一次俱乐部金币流水查询的俱乐部和上下文；推送路由本身不带 club_id。 */
    private clubGoldWaterClubId:string = "";
    private clubGoldWaterRequestContext:string = "";
    private clubDetails:{[clubId:string]:any} = {};
    private clubAgentInfo:{[clubId:string]:any} = {};
    /** 群主钻石池数量（个），按俱乐部缓存；由查询/推送的最新 remark 后值更新。 */
    private clubStonePools:{[clubId:string]:number} = {};
    /** 钻石池查询节流，避免每次卡片刷新都重复发请求。 */
    private clubStonePoolAsked:{[clubId:string]:number} = {};
    /** 最近一次钻石池查询对应的俱乐部；ClubStoneWater 推送不带 club_id。 */
    private clubStonePoolRequestClubId:string = "";
    /** 「我的」页停留时每 30 秒补查一次，服务端不推送也能保持数字更新。 */
    private clubStonePoolPoll = ():void=>{
        if(this.currentMainTab !== "我的")
            return;
        const id = this.ResolveRoomClub();
        if(id === "" || !this.IsClubOwner(id))
            return;
        this.RequestClubStonePool(id,true);
    };
    /** 当前玩家在各俱乐部的额度查询结果；额度只在有权限时渲染。 */
    /** 额度查询节流，避免每次列表重绘都重复发请求。 */
    /** 发现页/登录后补拉俱乐部信息（含 union_id/union_quota）的节流。 */
    private clubInfoAsked:{[clubId:string]:number} = {};
    /** 收到代理信息推送后补查一次的节流时间，防止回包再触发补查形成循环。 */
    private clubAgentRecheck:{[clubId:string]:number} = {};
    /** 推广页缺邀请码时补查代理信息的时间戳，同样按俱乐部节流。 */
    private clubInviteCodeAsked:{[clubId:string]:number} = {};

    private ClearGiftInputs():void
    {
        const paths = ["赠送/操作/用户id","赠送/操作/金额","赠送/操作/V7交易密码"];
        for(const path of paths)
        {
            const node = Tool.GetChild(this.node,path);
            if(node && node.getComponent(cc.EditBox))
                node.getComponent(cc.EditBox).string = "";
        }
    }
    // 登录进大厅的默认分页只决定一次，之后用户手动切换或俱乐部关系变化都不再自动跳转。
    private lobbyEntryResolved:boolean = false;
    /**
     * 刚创建 / 刚申请加入俱乐部时记下当时的俱乐部 ID 列表。等服务端把新俱乐部写进
     * club_make / club_join 并推送 set_club_* 后，把「多出来的那一家」设为默认俱乐部
     * （「我的」当前俱乐部卡片、房间列表、进房 club_id 都取这个值），否则会停在上一次选中的家。
     */
    private pendingDefaultClub:boolean = false;
    private defaultClubBaseIds:string[] = [];
    private defaultClubTimer:any = null;
    /** 创建/申请加入后等推送的最长时间；超过就放弃自动切换，避免以后误切。 */
    private readonly DEFAULT_CLUB_WAIT_MS:number = 30 * 60 * 1000;
    /**
     * 创建俱乐部要扣的钻石数（后台「钻石消费价格」下发，默认 10000）。
     * 只在「创建请求被受理 → 扣费」这段窗口里有值，回包后清 0。
     */
    private clubCreateCostPending:number = 0;
    private clubChargeBusy:boolean = false;
    private readonly clubChargeTimeoutHandler = ()=>{
        if(!this.clubChargeBusy)
            return;
        this.clubChargeBusy = false;
        this.clubCreateCostPending = 0;
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
            "钻石扣除处理超时，请稍后在「钻石流向」核对，若有异常请联系客服！");
    };
    private readonly clubCommandTimeoutHandler = ()=>{
        if(!this.clubCommandBusy)
            return;
        this.clubCommandBusy = false;
        this.CancelPendingDefaultClub();
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
            "俱乐部操作超时，请稍后重试！");
    };

    private animateSet:dragonBones.ArmatureDisplay = null;

    private bNeedInitJYPwd:boolean = false;  //是否需要初始化交易密码
    private scrollCFNotify:ScrollViewEx = null; //惩罚公告列表

    private pendingAvatarIndex:string = ""; //等待服务端回写的首次/兼容头像序号
    private editAvatarBatch:{[panelName:string]:Array<string>} = {};
    private editAvatarBySlot:{[panelName:string]:{[slotName:string]:string}} = {};
    private pendingPaidAvatarIndex:string = "";
    private pendingPaidProfileName:string = "";
    private pendingPaidAvatarCost:number = 0; //本次实际发出的钻石数，回包提示用真实值
    // 换头像扣多少钻石由后台「钻石消费价格」下发，见 ConfigManager.GetConsumeStone
    private avatarChargeBusy:boolean = false;
    private readonly avatarChargeTimeoutHandler = ()=>{
        if(!this.avatarChargeBusy)
            return;
        this.FinishAvatarChargeRequest();
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"支付处理超时，请稍后确认余额后再试！");
    };
    private antiTheftToggle:cc.Toggle = null;
    private antiTheftStatus:cc.Label = null;
    private antiTheftBusy:boolean = false;
    private antiTheftSyncing:boolean = false;
    private antiTheftRequestId:string = "";
    private antiTheftDesired:boolean = false;
    private antiTheftTimeoutHandler = ()=>{
        if(!this.antiTheftBusy)
            return;
        this.antiTheftBusy = false;
        this.antiTheftRequestId = "";
        this.RefreshAntiTheftSetting("操作超时，请刷新设置后重试",true);
    };
    onLoad () {
        super.onLoad();
        // 大厅入口分页：没有俱乐部的玩家等价于点底栏「俱乐部」，直接进俱乐部页；其余进「发现」。
        if(!this.ResolveLobbyEntryTab())
            this.switchTabSel("发现");
        this.HidePromotionPanelOnLobbyOpen();
        
        KBEngine.Event.register("set_gold", this, "set_gold");
        KBEngine.Event.register("set_gold2", this, "set_gold");
        KBEngine.Event.register("set_stone", this, "set_stone");
        KBEngine.Event.register("set_name", this, "set_name");
        KBEngine.Event.register("set_guuid", this, "set_guuid");
        KBEngine.Event.register("set_level", this, "set_level");
        KBEngine.Event.register("set_role", this, "set_role");
        KBEngine.Event.register("set_photo", this, "set_photo");
        KBEngine.Event.register("set_anti_theft_on", this, "set_anti_theft_on");
        KBEngine.Event.register("set_playcount_count", this, "set_playcount_count");
        KBEngine.Event.register("onAccountCommand", this, "onAccountCommand");

        this.antiTheftToggle = Tool.GetChild(this.node,"设置/列表/item/防盗号/防盗号开关").getComponent(cc.Toggle);
        this.antiTheftStatus = Tool.GetChild(this.node,"设置/列表/item/防盗号状态").getComponent(cc.Label);
        DeviceIdentityManager.getInstance().prepare();

        
        
        

        KBEngine.Event.register("AllRoomInfo", this, "OnClubRoomInfo");
        KBEngine.Event.register("RefreshClubRoomList", this, "OnRefreshClubRoomList");

        KBEngine.Event.register("onEnterRoom", this, "onEnterRoom");
        KBEngine.Event.register("onGetReturnedRoom", this, "onGetReturnedRoom");

        KBEngine.Event.register("onExChange", this, "onExChange");
        KBEngine.Event.register("onExChange2", this, "onExChange");

        KBEngine.Event.register("ExchangeInfo", this, "OnGetExchangeList");
        // 兼容服务端按英文路由或按命令名回推俱乐部赠送流水。
        KBEngine.Event.register("ClubGoldAddRecord", this, "OnClubGiftRecordList");
        KBEngine.Event.register("AddMemberGoldList", this, "OnClubGiftRecordList");
        KBEngine.Event.register("查询_俱乐部_成员_积分_添加_记录", this, "OnClubGiftRecordList");
        KBEngine.Event.register("ListPlayerCashWater", this, "ListPlayerCashWater");
        KBEngine.Event.register("ClubGoldWater", this, "OnClubGoldWaterList");
        KBEngine.Event.register("ClubStoneWater", this, "OnClubStoneWater");
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
        KBEngine.Event.register("ClubGoldGiftChanged", this, "OnClubGoldGiftChanged");
        KBEngine.Event.register("OpenInitTransactionPassword", this, "OpenInitTransactionPassword");
        KBEngine.Event.register("set_club_join", this, "OnClubMembershipChanged");
        KBEngine.Event.register("set_club_make", this, "OnClubMembershipChanged");
        KBEngine.Event.register("set_club_manage", this, "OnClubMembershipChanged");
        KBEngine.Event.register("set_club_gold", this, "OnClubGoldChanged");
        KBEngine.Event.register("ClubAgentInfo", this, "OnClubAgentInfo");
        KBEngine.Event.register("ClubUnionQuota", this, "OnClubUnionQuota");
        KBEngine.Event.register("ClubUnionCreate", this, "OnClubUnionCreate");
        KBEngine.Event.register("ClubMyUnion", this, "OnClubMyUnion");

        KBEngine.Event.register("UserHashInfo",this, "OnUserHashInfo");
        KBEngine.Event.register("UserHash2Info",this, "UserHash2Info");
        KBEngine.Event.register("set_client_status", this, "set_client_status");

        KBEngine.Event.register("AccountProp", this, "AccountProp"); //查询玩家属性
        KBEngine.Event.register("openGG8", this, "openGG8");
        this.initUserInfo();

        if(this.scrollRoom === null)
        {
            this.scrollRoom = Tool.GetChild(this.node,"Main/发现/房间列表").getComponent(ScrollViewNoEnd);
        }
        this.scrollRoom2 = this.scrollRoom.getComponent(scrollview2);
        this.scrollRoom2.main = this;
        this.scrollRoom.node.on(cc.Node.EventType.TOUCH_END,()=>{
            if(this.arrayRoomData.length === 0 && !this.roomListLoading)
                this.getAllRooms(0);
        },this);
        this.scrollRoom.node.on("bounce-top",()=>{
            this.getAllRooms(0);
        },this);
        this.scrollRoom.node.on("scrolling",this.TryLoadMoreRooms,this);

        this.clubManagement = new ClubManagementView(this.node,()=>{
            const account = GameDataManager.getAccount();
            const id = this.ResolveRoomClub();
            const info = this.clubDetails[id];
            const agent = this.clubAgentInfo[id];
            // 老板的邀请码有时只在俱乐部信息里返回；代理信息未到时回退，避免卡片出现空的「邀请码:」。
            const agentCode = agent && agent.invite_code != null ? String(agent.invite_code).trim() : "";
            const infoCode = info && info.invite_code != null ? String(info.invite_code).trim() : "";
            const inviteCode = agentCode || infoCode;
            // 未登录/重连期间 getAccount() 为空，这里不能抛错中断大厅初始化。
            const guuid = account ? String(account.guuid || "") : "";
            const owns = account && String(account.club_make || "").split(",").map(x=>x.trim()).indexOf(id) >= 0;
            const manages = account && String(account.club_manage || "").split(",").map(x=>x.trim()).indexOf(id) >= 0;
            // 这里直接用代理信息判角色：owns/manages 已经在前面判过了，
            // 再走 IsClubAgentIn 会多一次 make/manage 排除，反而把代理判成成员。
            const role = owns ? "owner" : manages ? "manager" : this.IsClubAgent(agent) ? "agent" : "member";
            // is_leader 只表示创建者的直属代理；V2 下所有代理统一显示「合伙人」，不再作为盟主标签。
            const isLeader = role === "agent" && !!agent && Number(agent.is_leader) === 1;
            const union = this.clubUnionStatus[id];
            // 2026-11-03 v2.1：查询_俱乐部_信息 直接返回 union_id / union_apply / union_quota，
            // union_id 一旦有值不会再回到空。以俱乐部信息为准，查询_联盟_额度的失败不能把已入盟改回未入盟。
            const infoUnionId = String(info && info.union_id || "").trim();
            const infoApplyId = String(info && info.union_apply || "").trim();
            const statusUnionId = union && union.known && union.hasUnion ? String(union.unionId || "").trim() : "";
            const unionId = infoUnionId || statusUnionId;
            const unionName = String((union && union.unionName) ||
                (info && (info.union_name || info.unionName)) || this.CachedUnionName(unionId) || "").trim();
            const infoClubQuotaRaw = info && info.union_quota;
            const infoClubQuota = Number(infoClubQuotaRaw);
            const infoClubQuotaKnown = infoClubQuotaRaw !== undefined && infoClubQuotaRaw !== null &&
                String(infoClubQuotaRaw).trim() !== "" && Number.isFinite(infoClubQuota);
            const clubQuotaFen = infoClubQuotaKnown ? infoClubQuota :
                (union && union.isOwner !== true && union.quotaFen !== undefined ? union.quotaFen : undefined);
            return {accountId:guuid,ownerId:owns ? guuid : info && String(info.club_owner || ""),
                id,name:info && info.club_name || "俱乐部 " + id,inviteCode,role,isLeader,
                // role 会先判 owner/manager，代理兼管理员时就看不到「是不是代理」了；
                // 单独的 isAgent 只按服务端 is_agent 判，用于「我的红利」这类只跟代理关系有关的入口。
                isAgent:!owns && this.IsClubAgent(agent),
                unionKnown:!!info || (!!union && union.known),hasUnion:unionId !== "",
                unionId:unionId || undefined,unionName:unionName || undefined,
                unionApplyId:infoApplyId || undefined,
                unionQuotaFen:union ? union.quotaFen : undefined,
                unionQuotaIsPool:union ? union.isOwner === true : undefined,
                clubQuotaFen,
                stonePool:this.clubStonePools[id],
                // 卡片「比例」：代理取 ClubAgentInfo.percent；盟主取 ClubUnionQuota.union_percent。
                agentPercent:role === "agent" && agent && Number.isFinite(Number(agent.percent)) ?
                    Number(agent.percent) : undefined,
                unionPercent:union && union.isOwner === false ? union.unionPercent : undefined,
                // 必须保留 undefined：false 才表示「已明确不是总群主」，不能用未知当 false。
                unionIsOwner:union ? union.isOwner : undefined};
        },text=>UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,text),(player,mode)=>{
            if(player && player.id)
            {
                if(mode === "updown")
                {
                    // 上下分直接复用私聊里的上下分弹窗（上分/下分、快捷金额、交易密码），
                    // entry=settings 让它在成功后弹提示框，而不是往聊天会话里插系统通报。
                    UIManager.getInstance().showPanel("panelClubGoldPad",ShowPanelMode.Top,JSON.stringify({
                        clubId:this.ResolveRoomClub(),userId:String(player.id),
                        userName:String(player.name || player.id),mode:"updown",entry:"settings"
                    }));
                    return;
                }
                // 成员设置里的赠送必须绑定当前俱乐部，避免误走大厅通用金币转账。
                // give = 赠送_俱乐部_积分（扣自己积分）；updown = 添加_俱乐部_成员_积分（代理按额度上下分）。
                // panelGivePad 仍兼容旧的「玩家资料 → 赠送」入口。
                UIManager.getInstance().showPanel("panelGivePad",ShowPanelMode.Cover,JSON.stringify({
                    userId:String(player.id),clubId:this.ResolveRoomClub()
                }));
            }
        },()=>this.PlayAudio("eff/申请提示"),action=>this.HandleClubUnionAction(action));
        this.RefreshDiscoveryClubFunds(true);
        this.clubManagement.Refresh();
        this.clubManagementApi = new HallClubManagementApi((id,count)=>this.clubManagement.SetPendingCount(id,count),
            (id)=>this.IsClubAgentIn(id),()=>this.GetClubAgentIds(),
            // 文档：有客户端就推送。申请/授信成功后服务端随时可能推全量列表，
            // 已打开的入盟申请/盟友管理直接吃推送刷新，不再依赖用户手动刷新。
            page=>this.clubManagement.OnUnionApplicationsPushed(page),
            page=>this.clubManagement.OnUnionMembersPushed(page));
        this.clubManagement.SetApi(this.clubManagementApi);
        this.clubManagementApi.RefreshBadges();
        this.schedule(()=>this.clubManagementApi.RefreshBadges(),30);
        this.getAllRooms();


        //检测是否有需要返回的房间
        GameDataManager.getAccount().reqGetReturnedRoom();

        //更新HASH数据
        ConfigManager.getInstance().UpdateDefConfig();

        GpsManager.getInstance().StartAutoNotifyGps();

        this.set_role(null);
        this.set_level(null);

        this.node.getChildByName("加入房间").on(cc.Node.EventType.TOUCH_START,()=>{
            this.node.getChildByName("加入房间").active = false;
        },this);

        if(cc.sys.isBrowser)
        {
            Tool.GetChild(this.node,"Main/我的/信息/测试").active = true;
        }
        else
        {
            Tool.GetChild(this.node,"Main/我的/信息/测试").active = false;
        }

        // 「我的」右上角的数据统计入口：仅 BOSS 账号可见（prefab 里默认隐藏）。
        // 口径与牌局里的一致：level>=99 或 董事长/总裁；服务端仍会按 boss 名单鉴权。
        Tool.GetChild(this.node,"Main/我的/数据统计").active = GameDataManager.IsBossAccount();

        if(GameDataManager.instance.nShowNotify)
        {
            ConfigManager.getInstance().GetOneHashKey("系统公告","大厅查询公告");
            // ConfigManager.getInstance().GetOneHashKey("充值公告","充值公告");
            // ConfigManager.getInstance().GetOneHashKey("活动公告","活动公告");
            GameDataManager.instance.nShowNotify = false;
        }
        //ConfigManager.getInstance().SetOneHashKey("世界杯2","暂未开放")
        

        this.set_client_status()
       // this.set_paper()

        //检查下更新
        //UpdateManager.getInstance().checkUpdate(this.mainifestUrl);

        //修复下声音默认
        let audioeff = Tool.GetConfigNumber("AudioEff",100);
        if(audioeff>0)
        {
            cc.sys.localStorage.setItem("AudioEff",100);
        }

        this.scrollCFNotify = Tool.GetChild(this.node,"惩罚列表/list").getComponent(ScrollViewEx);
        this.scrollCFNotify.callBackFresh = this.GetCFNotifyInfo.bind(this);
        RoomInviteManager.getInstance().onLobbyReady();
    }


    /** 大厅「客服（私聊）」入口的总未读红点。所有俱乐部未读在此汇总（设计文档 11）。 */
    private directChatUnreadHandler:(total:number)=>void = null;
    /** 直聊新消息沿用新俱乐部申请提示音。 */
    private directChatRealtimeMessageHandler:(event:any)=>void = null;

    private SetupDirectChatEntry():void
    {
        if(this.directChatUnreadHandler != null)
            return;
        let manager = DirectChatManager.GetInstance();
        this.directChatUnreadHandler = (total:number)=>{ this.RefreshDirectChatBadge(total); };
        manager.On("unread",this.directChatUnreadHandler);
        this.directChatRealtimeMessageHandler = ()=>{ this.PlayAudio("eff/申请提示"); };
        manager.On("realtimeMessage",this.directChatRealtimeMessageHandler);
        // 消息入口属于大厅常驻状态：只要已登录，就保持一条直聊长连接。
        // 新消息事件到达后由 DirectChatManager 更新红点和消息列表。
        manager.StartRealtime();
        this.RefreshDirectChatBadge(manager.UnreadTotal());
        // 打开大厅补一次俱乐部与未读摘要；失败不影响大厅其他功能。
        manager.LoadClubs().then(()=>{
            return manager.LoadUnread();
        }).then((unread)=>{
            this.RefreshDirectChatBadge(unread.total);
        }).catch(()=>{});
        // 预先拉一次消息首页并加载页面资源，避免首次点「消息」时再等连接和 Prefab。
        manager.LoadAllConversations(1).catch(()=>{});
        cc.loader.loadRes("UI/panelMessage",()=>{});
    }

    private RefreshDirectChatBadge(total:number):void
    {
        let badge = Tool.GetChild(this.node,"Down/客服/红点");
        if(badge == null)
            return;
        badge.active = total > 0;
        let labelNode = Tool.GetChild(badge,"数量");
        if(labelNode == null)
            return;
        let label = labelNode.getComponent(cc.Label);
        if(label != null)
            label.string = total > 99 ? "99+" : total.toString();
    }

    onDestroy(){
        if(this.directChatUnreadHandler != null)
            DirectChatManager.GetInstance().Off("unread", this.directChatUnreadHandler);
        if(this.directChatRealtimeMessageHandler != null)
            DirectChatManager.GetInstance().Off("realtimeMessage", this.directChatRealtimeMessageHandler);
        if(this.clubManagementApi) this.clubManagementApi.Dispose();
        if(this.defaultClubTimer != null) { clearTimeout(this.defaultClubTimer);this.defaultClubTimer = null; }
        super.onDestroy();
    }

    onEnable(){
        this.SetupDirectChatEntry();
        this.HidePromotionPanelOnLobbyOpen();
        this.RefreshClubFinanceMenuVisibility();
        GameDataManager.getInstance().dtLastSend = new Date().getTime();
        GameDataManager.getInstance().dtLastSuccess = new Date().getTime();
    }

    /** 底部「推广」进入前所在的分页，关闭推广页后回到这里。 */
    private promotionTabReturn:string = "";
    /** 推广页是否顺带收起了底栏，关闭时按需恢复。 */
    private promotionHidDown:boolean = false;
    /** 当前 Main 分页名；推广页关闭后据此恢复底栏选中态。 */
    private currentMainTab:string = "发现";

    /** 大厅初次打开或重新启用时，推广分享页必须保持关闭。 */
    private HidePromotionPanelOnLobbyOpen()
    {
        this.promotionTabReturn = "";
        this.ClosePromotionPanel();
    }

    /** “我的”和代理入口共用这一个正式推广页，关闭后恢复打开它的页面。 */
    public OpenPromotionPanel(returnPanel:cc.Node = null):boolean
    {
        const promotionPanel = this.node.getChildByName("推广二维码");
        if(!cc.isValid(promotionPanel) || !this.node.activeInHierarchy)
            return false;

        // 推广链接与二维码只指向哈希配置里的下载地址，不再拼接 /zc?guuid= 推广参数。
        const qrUrl = ConfigManager.getInstance().downloadurl;
        this.RefreshPromotionInviteCode();
        const linkLabel = Tool.GetChild(promotionPanel,"V7推广链接");
        if(linkLabel && linkLabel.getComponent(cc.Label))
            linkLabel.getComponent(cc.Label).string = qrUrl;
        this.createQR(Tool.GetChild(promotionPanel,"二维码/img").getComponent(cc.Graphics),qrUrl);

        this.promotionReturnPanel = cc.isValid(returnPanel) && returnPanel !== this.node &&
            returnPanel.parent === this.node.parent ? returnPanel : null;
        promotionPanel.active = true;
        if(this.promotionReturnPanel)
            this.promotionReturnPanel.active = false;
        // 推广页背景不吞触摸，底栏留着会被点穿；它本来也被整页盖住，直接收起。
        const down = this.node.getChildByName("Down");
        if(down && down.active)
        {
            this.promotionHidDown = true;
            down.active = false;
        }
        return true;
    }

    private ClosePromotionPanel()
    {
        const promotionPanel = this.node.getChildByName("推广二维码");
        if(cc.isValid(promotionPanel))
            promotionPanel.active = false;
        const returnPanel = this.promotionReturnPanel;
        this.promotionReturnPanel = null;
        if(cc.isValid(returnPanel) && returnPanel.parent === this.node.parent)
            returnPanel.active = true;
        if(this.promotionHidDown)
        {
            this.promotionHidDown = false;
            this.node.getChildByName("Down").active = true;
        }
    }

    /** 推广页那一行显示的是「当前俱乐部邀请码」，没有俱乐部时整行（文字 + 复制按钮）都不显示。 */
    private RefreshPromotionInviteCode():void
    {
        const promotionPanel = this.node.getChildByName("推广二维码");
        if(!cc.isValid(promotionPanel))
            return;
        const clubId = this.ResolveRoomClub();
        const code = this.GetCurrentClubInviteCode(clubId);
        const rowVisible = !!clubId;
        const idLabel = Tool.GetChild(promotionPanel,"V7推广ID");
        if(idLabel)
        {
            idLabel.active = rowVisible;
            const label = idLabel.getComponent(cc.Label);
            if(label)
                label.string = rowVisible ? "俱乐部邀请码：" + code : "";
        }
        const copyButton = Tool.GetChild(promotionPanel,"复制推广ID");
        if(copyButton)
            copyButton.active = rowVisible;
        // 刚登录 / 刚入会时代理信息还没回包，有俱乐部却没码就先补查一次（10 秒内不重复发）。
        if(rowVisible && !code)
            this.RequestCurrentClubAgent(clubId);
    }

    /** 只取指定俱乐部的邀请码；缓存未到时返回空串。 */
    private GetCurrentClubInviteCode(clubId:string):string
    {
        if(!clubId)
            return "";
        const agent = this.clubAgentInfo[clubId];
        return agent && agent.invite_code != null ? String(agent.invite_code).trim() : "";
    }

    private RequestCurrentClubAgent(clubId:string,force:boolean = false):void
    {
        const account = GameDataManager.getAccount();
        if(!account || !clubId)
            return;
        const now = Date.now();
        if(!force && now - (this.clubInviteCodeAsked[clubId] || 0) < 10000)
            return;
        this.clubInviteCodeAsked[clubId] = now;
        account.reqHallCommand(JSON.stringify({header:"查询_俱乐部_代理_信息",club_id:clubId}),"p@club:agent:" + clubId);
    }

    start () {

        this.schedule(()=>this.RefreshGameSettingsEntry(),1);

        this.scrollExchangeInfo = Tool.GetChild(this.node,"赠送/赠送记录列表").getComponent(ScrollViewEx);
        this.scrollExchangeInfo.callBackFresh = this.GetAllExchangeInfo.bind(this);

        this.scrollLiushui = Tool.GetChild(this.node,"资金明细/资金明细列表").getComponent(ScrollViewEx);
        this.scrollLiushui.callBackFresh = this.GetLiuShuiInfo.bind(this);


        //
    }

    initUserInfo()
    {
        this.EnsureAccountAvatar();

        this.set_gold(0);
        this.set_stone(0);
        this.set_name("");
        this.set_guuid("");

        this.set_photo(null);
        this.set_playcount_count();
    }

    /**
     * 新账号头像字段为空时随机写入1～100；旧网址、文件名或越界值统一迁移为1。
     * pendingAvatarIndex用于服务端属性事件返回前的即时显示，避免重复随机。
     */
    private EnsureAccountAvatar():string
    {
        let account = GameDataManager.getAccount();
        let imageManager = ImageManager.getInstance();
        let rawValue = account.photo;
        let loginName = Tool.GetConfigString("unionid","").trim();
        let registrationAvatarKey = loginName == "" ? "" : "registrationAvatar_" + loginName;
        let registeredAvatar = registrationAvatarKey == "" ? "" : cc.sys.localStorage.getItem(registrationAvatarKey);
        if(imageManager.IsAvatarIndex(rawValue))
        {
            let serverAvatar = imageManager.NormalizeAvatarIndex(rawValue);
            if(imageManager.IsAvatarIndex(registeredAvatar) && serverAvatar != imageManager.NormalizeAvatarIndex(registeredAvatar))
            {
                this.pendingAvatarIndex = imageManager.NormalizeAvatarIndex(registeredAvatar);
                account.reqSetProperty("photo", this.pendingAvatarIndex);
                return this.pendingAvatarIndex;
            }
            this.pendingAvatarIndex = "";
            if(registrationAvatarKey != "")
                cc.sys.localStorage.removeItem(registrationAvatarKey);
            return serverAvatar;
        }

        if(this.pendingAvatarIndex != "")
            return this.pendingAvatarIndex;

        let rawText = rawValue === null || rawValue === undefined ? "" : rawValue.toString().trim();
        if(rawText == "" && imageManager.IsAvatarIndex(registeredAvatar))
            this.pendingAvatarIndex = imageManager.NormalizeAvatarIndex(registeredAvatar);
        else
            this.pendingAvatarIndex = rawText == "" ? imageManager.RandomAvatarIndex() : "1";
        account.reqSetProperty("photo", this.pendingAvatarIndex);
        return this.pendingAvatarIndex;
    }

    private GetActiveEditInfoNode():cc.Node
    {
        if(Tool.GetChild(this.node,"修改个人信息").active)
            return Tool.GetChild(this.node,"修改个人信息");
        if(Tool.GetChild(this.node,"修改个人信息2").active)
            return Tool.GetChild(this.node,"修改个人信息2");
        return null;
    }

    private PreviewEditAvatar(avatarValue:any)
    {
        let editNode = this.GetActiveEditInfoNode();
        if(editNode == null)
            return;
        this.SetEditAvatar(editNode, avatarValue);
    }

    private SetEditAvatar(editNode:cc.Node, avatarValue:any)
    {
        this.EnsureLocalAvatarSelector(editNode);
        let avatarIndex = ImageManager.getInstance().NormalizeAvatarIndex(avatarValue);
        Tool.GetChild(editNode,"头像/name").getComponent(cc.Label).string = avatarIndex;
        let img = Tool.GetChild(editNode,"头像/mask/img").getComponent(cc.Sprite);
        ImageManager.getInstance().SetLocalAvatar(img, avatarIndex);

        let listNode = editNode.getChildByName("本地头像列表");
        if(listNode == null)
            return;
        for(let item of listNode.children)
        {
            let selected = item.getChildByName("选中");
            if(selected != null)
                selected.active = this.editAvatarBySlot[editNode.name] != null &&
                    this.editAvatarBySlot[editNode.name][item.name] == avatarIndex;
        }
    }

    /**
     * 修改资料页保留20个固定头像槽位；图片内容每次打开或点“换一批”时随机刷新。
     * 节点由代码创建，避免把20份重复Sprite结构写进panelMain.prefab。
     */
    private EnsureLocalAvatarSelector(editNode:cc.Node)
    {
        let chooseTitle = Tool.GetChild(editNode,"选择头像");

        // 静态节点的尺寸和位置由正式 Prefab 维护，避免运行时再次覆盖
        // 换皮布局；这里只保留动态头像列表的创建与刷新。

        // “选择头像”图片现在作为列表标题，不再按一下切换一张。
        let chooseButton = chooseTitle.getComponent(cc.Button);
        if(chooseButton != null)
            chooseButton.interactable = false;

        let listNode = editNode.getChildByName("本地头像列表");
        if(listNode != null)
        {
            this.PositionLocalAvatarSelector(editNode,listNode);
            return;
        }

        listNode = new cc.Node("本地头像列表");
        listNode.setContentSize(640,430);
        this.PositionLocalAvatarSelector(editNode,listNode);
        editNode.addChild(listNode);

        // Widget alignment can finish after this page is activated. Reapply
        // the same top offset once on the next frame so the first opening and
        // later avatar refreshes use exactly the same position.
        this.scheduleOnce(()=>{
            if(cc.isValid(editNode) && cc.isValid(listNode))
                this.PositionLocalAvatarSelector(editNode,listNode);
        },0);

        for(let index = 1; index <= 20; index++)
        {
            let slotName = "头像槽位" + index.toString().padStart(2,"0");
            let item = new cc.Node(slotName);
            item.setContentSize(104,104);
            let col = (index - 1) % 5;
            let row = Math.floor((index - 1) / 5);
            item.setPosition((col - 2) * 124,165 - row * 110);
            listNode.addChild(item);

            let base = item.addComponent(cc.Graphics);
            base.fillColor = cc.color(10,8,5,245);
            base.circle(0,0,50);
            base.fill();
            base.lineWidth = 2;
            base.strokeColor = cc.color(126,79,31,230);
            base.circle(0,0,49);
            base.stroke();

            let imageNode = new cc.Node("头像");
            imageNode.setContentSize(90,90);
            item.addChild(imageNode);
            let sprite = imageNode.addComponent(cc.Sprite);
            sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;

            let selectedNode = new cc.Node("选中");
            selectedNode.setContentSize(104,104);
            selectedNode.active = false;
            item.addChild(selectedNode);
            let selected = selectedNode.addComponent(cc.Graphics);
            selected.lineWidth = 5;
            selected.strokeColor = cc.color(248,204,112,255);
            selected.circle(0,0,50);
            selected.stroke();
            selected.fillColor = cc.color(238,187,82,255);
            selected.circle(38,38,13);
            selected.fill();
            selected.lineWidth = 3;
            selected.strokeColor = cc.color(42,24,7,255);
            selected.moveTo(32,38);
            selected.lineTo(37,33);
            selected.lineTo(45,43);
            selected.stroke();

            let button = item.addComponent(cc.Button);
            button.transition = cc.Button.Transition.SCALE;
            button.zoomScale = 0.92;
            item.on("click",()=>{
                if(cc.isValid(editNode))
                {
                    let slotMap = this.editAvatarBySlot[editNode.name];
                    if(slotMap != null && ImageManager.getInstance().IsAvatarIndex(slotMap[slotName]))
                        this.SetEditAvatar(editNode, slotMap[slotName]);
                }
            },this);
        }
        this.RefreshEditAvatarBatch(editNode);
    }

    private PositionLocalAvatarSelector(editNode:cc.Node,listNode:cc.Node)
    {
        let visibleHeight = cc.view.getVisibleSize().height;
        let layoutHeight = Math.max(editNode.height,visibleHeight);
        listNode.setPosition(0,layoutHeight/2-542-215);
    }

    private RefreshEditAvatarBatch(editNode:cc.Node)
    {
        let listNode = editNode == null ? null : editNode.getChildByName("本地头像列表");
        if(listNode == null)
            return;

        let imageManager = ImageManager.getInstance();
        let previousBatch = this.editAvatarBatch[editNode.name] || [];
        let batch = imageManager.RandomAvatarBatch(20,previousBatch);
        let slotMap:{[slotName:string]:string} = {};
        this.editAvatarBatch[editNode.name] = batch;
        this.editAvatarBySlot[editNode.name] = slotMap;

        for(let index = 0; index < listNode.children.length && index < batch.length; index++)
        {
            let item = listNode.children[index];
            let avatarIndex = batch[index];
            slotMap[item.name] = avatarIndex;
            let sprite = Tool.GetChild(item,"头像").getComponent(cc.Sprite);
            imageManager.SetLocalAvatar(sprite,avatarIndex);
        }

        let selectedAvatar = Tool.GetChild(editNode,"头像/name").getComponent(cc.Label).string;
        if(imageManager.IsAvatarIndex(selectedAvatar))
            this.SetEditAvatar(editNode,selectedAvatar);
    }

    //兼容旧事件入口：现在刷新当前资料页中的20张随机头像，不改变已选头像。
    public RandHeadList()
    {
        let editNode = this.GetActiveEditInfoNode();
        if(editNode == null)
            return;
        this.EnsureLocalAvatarSelector(editNode);
        this.RefreshEditAvatarBatch(editNode);
    }

    private ApplyProfileChange(strName:string,avatarIndex:string)
    {
        let normalizedAvatar = ImageManager.getInstance().NormalizeAvatarIndex(avatarIndex);
        GameDataManager.getAccount().reqSetProperty("photo",normalizedAvatar);
        GameDataManager.getAccount().reqSetProperty("name",strName);
        Tool.GetChild(this.node,"修改个人信息").active = false;
        Tool.GetChild(this.node,"修改个人信息2").active = false;
        Tool.GetChild(this.node,"确定修改个人信息").active = false;
    }

    private QueuePaidAvatarChange(strName:string,avatarIndex:string)
    {
        this.pendingPaidProfileName = strName;
        this.pendingPaidAvatarIndex = ImageManager.getInstance().NormalizeAvatarIndex(avatarIndex);
        let prompt = Tool.GetChild(this.node,"确定修改个人信息/bk/msg");
        if(prompt != null)
        {
            let nCost = ConfigManager.getInstance().GetConsumeStone(ConfigManager.CONSUME_AVATAR);
            prompt.getComponent(cc.Label).string = "更换头像将消耗" + nCost + "钻石，是否确认？";
        }
        Tool.GetChild(this.node,"确定修改个人信息").active = true;
    }

    private SetAvatarChargeConfirmInteractable(interactable:boolean)
    {
        let confirmNode = Tool.GetChild(this.node,"确定修改个人信息/bk/确认修改个人信息");
        let button = confirmNode == null ? null : confirmNode.getComponent(cc.Button);
        if(button != null)
            button.interactable = interactable;
    }

    private FinishAvatarChargeRequest()
    {
        this.unschedule(this.avatarChargeTimeoutHandler);
        this.avatarChargeBusy = false;
        this.SetAvatarChargeConfirmInteractable(true);
    }

    private GetHallCommandError(param:string,fallback:string):string
    {
        try
        {
            let msg = JSON.parse(param);
            let result = msg == null ? null : msg["result"];
            if(result != null && result["error"] != null && result["error"].toString().trim() != "")
                return result["error"].toString();
        }
        catch(error)
        {
            Debug.Error("解析大厅命令错误信息失败："+error);
        }
        return fallback;
    }

    public OpenInitTransactionPassword():void
    {
        this.bNeedInitJYPwd = true;
        const modifyPanel = this.node.getChildByName("修改交易密码");
        if(modifyPanel != null)
            modifyPanel.active = false;
        const initPanel = this.node.getChildByName("初始化交易密码");
        if(initPanel != null)
            initPanel.active = true;
        this.ClearTransactionPasswordInputs();
    }

    private ShowTransactionPasswordRequired():void
    {
        const password = Tool.GetChild(this.node,"赠送/操作/V7交易密码");
        if(password != null && password.getComponent(cc.EditBox) != null)
            password.getComponent(cc.EditBox).string = "";
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
            "请先设置交易密码",[(confirmed:boolean)=>{
                if(confirmed)
                    this.OpenInitTransactionPassword();
            }]);
    }

    private ShowClubGoldGiftError(message:string):void
    {
        if(message.indexOf("请先设置交易密码") >= 0)
        {
            this.ShowTransactionPasswordRequired();
            return;
        }
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,message);
    }

    private ConfirmPaidAvatarChange()
    {
        if(this.avatarChargeBusy)
            return;
        if(!ImageManager.getInstance().IsAvatarIndex(this.pendingPaidAvatarIndex))
        {
            Tool.GetChild(this.node,"确定修改个人信息").active = false;
            return;
        }

        let account = GameDataManager.getAccount();
        let nCost = ConfigManager.getInstance().GetConsumeStone(ConfigManager.CONSUME_AVATAR);
        if(Number(account.stone) < nCost)
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"钻石不足" + nCost + "，无法更换头像！");
            Tool.GetChild(this.node,"确定修改个人信息").active = false;
            return;
        }

        this.avatarChargeBusy = true;
        this.pendingPaidAvatarCost = nCost;
        this.SetAvatarChargeConfirmInteractable(false);
        this.unschedule(this.avatarChargeTimeoutHandler);
        this.scheduleOnce(this.avatarChargeTimeoutHandler,8);
        let strParam = ConfigManager.getInstance().BuildConsumeStoneParam(ConfigManager.CONSUME_AVATAR);
        GameDataManager.getAccount().reqHallCommand(strParam,"P@玩家_消费_命令_换头像");
    }

    set_gold(num:number)
    {
        const text = this.ResolveDisplayGoldText();
        Tool.GetChild(this.node,"Main/我的/信息/gold").getComponent(cc.Label).string = text;
        const summary = Tool.GetChild(this.node,"资金明细/V8资金概况/当前金币");
        if(summary != null)
            summary.getComponent(cc.Label).string = text;
    }

    /**
     * 「我的」和「资金明细」顶部显示的金币。
     *
     * 俱乐部模式下 Account.gold 不再是玩家资产（接口文档 §10），这两个位置要显示
     * 当前俱乐部的积分；没有俱乐部时显示 0。不能用 Account.gold
     * 冒充俱乐部积分，也不要在俱乐部模式里显示平台金币。
     */
    private ResolveDisplayGoldText():string
    {
        const account:any = GameDataManager.getAccount();
        const clubId = account == null ? "" : this.ResolveRoomClub();
        if(clubId !== "")
        {
            const clubGold = this.GetClubGold(clubId);
            // 服务端没下发该俱乐部积分（含 -99 哨兵）时按 0 显示余额，
            // 但不能退回平台金币——那是另一个币种。
            return clubGold === "" ? "0" : clubGold;
        }
        if(account == null)
            return "0";
        return "0";
    }
    /** 钻石数＝account.stone，和金币框并排显示。 */
    set_stone(num:number)
    {
        const node = Tool.GetChild(this.node,"Main/我的/信息/stone");
        const label = node == null ? null : node.getComponent(cc.Label);
        if(label == null)
            return;
        const account = GameDataManager.getAccount();
        const value = account == null || account.stone == null ? 0 : account.stone;
        label.string = String(value);
        // 创建俱乐部弹窗开着时，余额一变就把「花费/余额够不够」跟着刷，别让玩家按旧余额判断。
        const createDialog = this.node.getChildByName("创建俱乐部弹窗");
        if(createDialog != null && createDialog.active)
            this.clubCreateDialogMode === "union" ? this.RefreshUnionCreateCostHint() : this.RefreshClubCreateCostHint();
    }
    set_name(name:string)
    {
        Tool.GetChild(this.node,"Main/我的/信息/name").getComponent(cc.Label).string = KBEngine.app.player().name;
        MobileManager.getInstance().SetAccount();
    }
    set_guuid(id:string)
    {
        Tool.GetChild(this.node,"Main/我的/信息/id").getComponent(cc.Label).string = KBEngine.app.player().guuid;
        MobileManager.getInstance().SetAccount();
    }

    /**
     * “我的”资料卡的五档底皮手数取自 Account.playcount_count。
     * 服务端按底皮档位升序以“#”分隔下发：0.1/0.3、0.2/0.5、1/3、2/5、5/10、10/20、20/40、50/100，
     * 所以 1、2、5、10、20 皮分别对应下标 2~6；字段缺失时保留占位“—”，不回退静态数字。
     */
    public set_playcount_count()
    {
        let account = GameDataManager.getAccount();
        let raw = account == null ? null : account.playcount_count;
        let strRaw = raw == null ? "" : raw.toString().trim();
        let arrayCount = strRaw == "" ? [] : strRaw.split("#");
        // 底皮档位与对应下标必须成对维护，不能只改其中一侧。
        let arrayStake:number[] = [1,2,5,10,20];
        let arrayIndex:number[] = [2,3,4,5,6];
        for(let i = 0;i < arrayStake.length;i++)
        {
            let labelNode = Tool.GetChild(this.node,"Main/我的/数据/V8" + arrayStake[i] + "皮手数");
            if(labelNode == null)
                continue;
            let label = labelNode.getComponent(cc.Label);
            if(label == null)
                continue;
            let value = arrayCount[arrayIndex[i]];
            label.string = (value == null || value === "") ? "—" : value;
        }
    }

    set_level(id:string)
    {
        this.RefreshAgentMenuVisibility();
        // if (Number(strLevel) > 50)
        // {
        //     Tool.GetChild(this.node,"Main/我的/操作/推广二维码").active = true;
        //     Tool.GetChild(this.node,"Main/我的/操作/代理").active = true;
        // }
        // else
        // {
        //     Tool.GetChild(this.node,"Main/我的/操作/推广二维码").active = false;
        //     Tool.GetChild(this.node,"Main/我的/操作/代理").active = false;
        // }

        // if(Number(strLevel)>50)
        // {
        //     Tool.GetChild(this.node,"Main/我的/转盘1").active = true;
        //     Tool.GetChild(this.node,"Main/我的/转盘2").active = false;
        //     Tool.GetChild(this.node,"Main/我的/转盘1").rotation = 0
        //     Tool.GetChild(this.node,"Main/我的/转盘2").rotation = 0
        // }
        // else
        // {
        //     Tool.GetChild(this.node,"Main/我的/转盘1").active = false;
        //     Tool.GetChild(this.node,"Main/我的/转盘2").active = true; 
        //     Tool.GetChild(this.node,"Main/我的/转盘1").rotation = 0
        //     Tool.GetChild(this.node,"Main/我的/转盘2").rotation = 0
        // }

        
        if(GameDataManager.getAccount().role == "老板")
        {
            Tool.GetChild(this.node,"Main/我的/信息/管理").active = true;
        }
        else
        {
            Tool.GetChild(this.node,"Main/我的/信息/管理").active = false;
        }
    }
    public set_role(old)
    {
        this.RefreshAgentMenuVisibility();
        // let nShowJL = Tool.GetConfigNumber("特殊开关",1);
        // if((GameDataManager.getAccount().role == "董事长" || GameDataManager.getAccount().role == "总裁") && nShowJL == 1)
        // {
        //     Tool.GetChild(this.node ,"Main/我的/操作/奖励").active = true;
        // }
        // else
        // {
        //     Tool.GetChild(this.node ,"Main/我的/操作/奖励").active = false;
        // }

        // if(cc.sys.isBrowser)
        // {
        //     Tool.GetChild(this.node ,"Main/我的/操作/奖励").active = true;
        // }

    }

    private IsCurrentUserAgent():boolean
    {
        let account = GameDataManager.getAccount();
        if(account == null)
            return false;

        let level = Number(account.level || 0);
        let role = account.role == null ? "" : account.role.toString();
        return level > 0 || role.indexOf("盟主") >= 0 || role.indexOf("合伙人") >= 0 ||
            role.indexOf("总裁") >= 0 || role.indexOf("老板") >= 0;
    }

    private RefreshAgentMenuVisibility()
    {
        let operation = Tool.GetChild(this.node,"Main/我的/滚动区/view/content/操作");
        if(operation == null)
            return;

        // 俱乐部模式不提供代理入口，包括旧 Prefab 中的同名节点。
        for(const child of operation.children)
            if(child.name === "代理") child.active = false;

        // 原生 Prefab Grid 按已激活入口自动补位，布局不再使用旧稿坐标。
        this.RefreshClubFinanceMenuVisibility();
    }

    private RefreshClubFinanceMenuVisibility():void
    {
        const hasClub = this.ResolveRoomClub() !== "";
        const paths = [
            "Main/我的/滚动区/view/content/操作/赠送",
            "Main/我的/滚动区/view/content/操作/兑换钻石",
            "Main/我的/滚动区/view/content/操作/上下分记录",
            "Main/我的/滚动区/view/content/操作/钻石池消耗",
            // 「额度授权记录」：大盟主查看给各盟主的额度授信流水，与钻石池消耗同属俱乐部专属入口。
            "Main/我的/滚动区/view/content/操作/额度授权记录"
        ];
        for(const path of paths)
        {
            const node = Tool.GetChild(this.node,path);
            if(node != null)
                node.active = hasClub;
        }
        const operation = Tool.GetChild(this.node,"Main/我的/滚动区/view/content/操作");
        const layout = operation == null ? null : operation.getComponent(cc.Layout);
        if(layout != null)
            layout.updateLayout();
        // 入口增减会改变 Grid 行数，同步按钮区/卡片/内容高度，避免底部留空或卡片重叠。
        if(this.clubManagement)
            this.clubManagement.syncProfileScroll(hasClub);
    }
    public set_photo(old)
    {
        let img = Tool.GetChild(this.node,"Main/我的/信息/头像/mask/img").getComponent(cc.Sprite);
        let avatarIndex = this.EnsureAccountAvatar();
        ImageManager.getInstance().SetLocalAvatar(img, avatarIndex, KBEngine.app.player().guuid);
    }

    //代金券
    // public set_paper(old = 0)
    // {
    //     Tool.GetChild(this.node,"Main/兑换/金币券/num").getComponent(cc.Label).string = GameDataManager.getAccount().paper;
    // }

    // update (dt) {}
    onButtonClick(button:cc.Button)
    {
        if(this.clubManagement && this.clubManagement.HandleButton(button))
            return;
        // 「我的」右上角的数据统计：打开 BOSS 数据面板（代理链/玩家信息）。
        // 按钮只对 BOSS 显示，这里再挡一道防止热更后节点状态残留被误点。
        if(button.node.name === "数据统计")
        {
            if(GameDataManager.IsBossAccount())
            {
                // 从大厅进来必须带当前俱乐部：面板的「玩家信息」「代理链路」两条查询都用它当
                // club_id，不带的话服务端会退回账号默认俱乐部，和当前在看的那家对不上。
                panelBossPlayerInfo.Open("", this.ResolveRoomClub());
            }
            return;
        }
        // 「我的」底部的兑换入口：和牌局菜单里那个是同一个弹窗。
        if(button.node.name === "兑换钻石")
        {
            if(this.ResolveRoomClub() === "")
            {
                this.RefreshClubFinanceMenuVisibility();
                return;
            }
            UIManager.getInstance().showPanel("panelExchangeStone",ShowPanelMode.Cover,"hall");
            return;
        }
        // Club rows also live under a content node; handle them before the room-row branch.
        if(button.node.name.indexOf("俱乐部条目_") === 0)
        {
            const id = button.node.name.substr("俱乐部条目_".length);
            if(this.GetMyClubIds().indexOf(id) < 0) return;
            this.ResolveRoomClub();
            this.selectedRoomClubId = id;
            if(this.roomClubAccountKey) cc.sys.localStorage.setItem(this.roomClubAccountKey,id);
            this.clubManagement.Refresh();
            this.RequestClubUnionStatus(id,true);
            // 切换俱乐部后顶部金币要跟着换成新俱乐部的积分，不能留着上一家的数字。
            this.set_gold(0);
            this.switchTabSel("发现");
            this.getAllRooms(0,true);
            return;
        }
        Debug.Log("消息:"+button.node.name);
        if(button.node.parent.name === "content")
        {
            //占位房间不能进入
            if(button.node.name == '-999')
            {
                return;
            }

            //私密房并且没有进入过则需要输入房号
            if(button.node.getChildByName("私密房").active && GameDataManager.getAccount().role !="老板")
            {
                let strState = button.node.getChildByName("状态").getComponent(cc.Sprite).spriteFrame.name
                if(strState != "状态_参与过")
                {
                    Tool.GetChild(this.node,"加入房间/bk/房号").getComponent(cc.Label).string = "";
                    this.node.getChildByName("加入房间").active = true;
                    return;
                }
            }

            if(!GpsManager.getInstance().IsGpsOpen()&&ConfigManager.getInstance().enalbe_gps=="True")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"未打开GPS不能进入房间！")
                return;
            }

            UIManager.getInstance().showPanel("panelLoading",ShowPanelMode.Top);
            // 进房必须带「从哪个俱乐部的房间列表点的这间房」，服务端据此确定抽水归属的代理链；不带则不参与俱乐部分成。
            const enterClubId = this.ResolveRoomClub();
            const strRoomSetting = withRoomClubId("{{\"special_rule\": \"观战\"}}",enterClubId);
            GameDataManager.getAccount().reqEnterRoom(RoomType.Custom,Number(button.node.name),strRoomSetting);

            MobileManager.getInstance().OnTalkingEvent("加入房间","加入房间");
        }
        else if(button.node.name === "战绩")
        {
            UIManager.getInstance().showPanel("panelRecordList",ShowPanelMode.Cover);
        }
        else if(button.node.name === "复制ID")
        {
            let strID = Tool.GetChild(this.node,"Main/我的/信息/id").getComponent(cc.Label).string.trim();
            if(strID === "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"玩家ID为空，暂时无法复制！");
                return;
            }
            let copied = MobileManager.getInstance().CopyToPhone(strID);
            let message = copied ? "玩家ID复制成功！" : "玩家ID复制失败，请稍后重试！";
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,message);
        }
        else if(button.node.name === "复制推广ID")
        {
            let strCode = this.GetCurrentClubInviteCode(this.ResolveRoomClub());
            if(strCode === "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"俱乐部邀请码为空，暂时无法复制！");
                return;
            }
            let copied = MobileManager.getInstance().CopyToPhone(strCode);
            let message = copied ? "俱乐部邀请码复制成功！" : "俱乐部邀请码复制失败，请稍后重试！";
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,message);
        }
        else if(button.node.name === "复制推广地址")
        {
            let strUrl = Tool.GetChild(this.node,"推广二维码/V7推广链接")
                .getComponent(cc.Label).string.trim();
            if(strUrl === "" || strUrl === "https://--")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"游戏下载地址为空，暂时无法复制！");
                return;
            }
            let copied = MobileManager.getInstance().CopyToPhone(strUrl);
            let message = copied ? "游戏下载地址复制成功！" : "游戏下载地址复制失败，请稍后重试！";
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,message);
        }
        else if(button.node.name === "查看数据")
        {
            let nCost = ConfigManager.getInstance().GetConsumeStone(ConfigManager.CONSUME_LOOK_DATA);
            if(Number(GameDataManager.getAccount().stone) < nCost)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"钻石不足，查看数据失败！");
                return;
            }

            let strParam:string = GameDataManager.getAccount().remark;
            if (strParam == "")
                strParam = "0,0,0,0,0,0,0";
            let arrayParam = strParam.split(',');

            let nWin = Number(arrayParam[0]);
            let nLose = Number(arrayParam[1]);
            let nHe = Number(arrayParam[2]);
            let nRu = Number(arrayParam[6]); //入池次数

            let nTotle = nWin + nLose + nHe;
            let nFanPer = nTotle > 0 ? Number(arrayParam[3]) * 100 / nTotle : 0;
            let nWinPer = nTotle > 0 ? nWin * 100 / nTotle : 0;

            let nFanWin = Number(arrayParam[3])>0?Number(arrayParam[5])*100/Number(arrayParam[3]):0;

            let nRuChi = nTotle > 0 ? nRu * 100 / nTotle : 0;

            Tool.GetChild(this.node,"Main/我的/数据/总局数").getComponent(cc.Label).string = arrayParam[4];
            Tool.GetChild(this.node,"Main/我的/数据/总手数").getComponent(cc.Label).string = (Number(arrayParam[0])+ Number(arrayParam[1])+ Number(arrayParam[2])).toString();
            Tool.GetChild(this.node,"Main/我的/数据/翻牌率").getComponent(cc.Label).string = nFanPer.toFixed(0).toString()+"%";
            Tool.GetChild(this.node,"Main/我的/数据/翻牌胜率").getComponent(cc.Label).string = nFanWin.toFixed(0).toString()+"%";
            Tool.GetChild(this.node,"Main/我的/数据/获胜手数").getComponent(cc.Label).string = nWin.toString();
            Tool.GetChild(this.node,"Main/我的/数据/总胜率").getComponent(cc.Label).string =  nWinPer.toFixed(0).toString()+"%";
            Tool.GetChild(this.node,"Main/我的/数据/入池率").getComponent(cc.Label).string =  nRuChi.toFixed(0).toString()+"%";

            //扣费
            strParam = ConfigManager.getInstance().BuildConsumeStoneParam(ConfigManager.CONSUME_LOOK_DATA);
            GameDataManager.getAccount().reqHallCommand(strParam, "玩家_消费_命令");
        }
        else if(button.node.name == "推广二维码")
        {
            // 「我的」里的入口不算底栏选中，关闭后保持「我的」即可。
            this.promotionTabReturn = "";
            this.OpenPromotionPanel();
        }
        else if(button.node.name === "保存二维码")
        {
            // 「分享海报」与「保存到相册」原来都是整屏截图保存，功能重复，已只保留「保存到相册」。
            MobileManager.getInstance().CaptureScreen();
        }
        else if(button.node.name === "赠送")
        {
            if(this.ResolveRoomClub() === "")
            {
                this.RefreshClubFinanceMenuVisibility();
                return;
            }
            this.node.getChildByName("赠送").active = true;
            this.ClearGiftInputs();
            this.GetAllExchangeInfo(0);
        }
        else if(button.node.name === "提交赠送")
        {
            let strID = Tool.GetChild(button.node.parent,"用户id").getComponent(cc.EditBox).string;
            let strNum = Tool.GetChild(button.node.parent,"金额").getComponent(cc.EditBox).string;
            if(strID.length != 6)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入正确的用户ID！");
                return;
            }
            if(strNum == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入金额!");
                return;
            }
            if(!/^0*[1-9][0-9]*$/.test(strNum))
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"赠送金额只能输入大于0的整数！");
                return;
            }

            const clubId = this.ResolveRoomClub();
            if(clubId !== "")
            {
                const strPass = Tool.GetChild(button.node.parent,"V7交易密码").getComponent(cc.EditBox).string;
                if(strPass == "")
                {
                    UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入密码!");
                    return;
                }
                if(this.clubGoldGiftPending)
                    return;
                this.clubGoldGiftPending = true;
                const context = "club:gold:give-main:" + clubId + ":" + strID;
                // 「赠送金币」是玩家之间转账：必须走「赠送_俱乐部_积分」，扣的是自己账户的积分。
                // 「添加_俱乐部_成员_积分」是代理按额度发筹码（后台侧也是直接加减目标积分、不扣操作者），
                // 拿它做赠送等于白送，自己的积分不会被扣。
                const clubParam = JSON.stringify({
                    header:"赠送_俱乐部_积分",club_id:clubId,user_id:strID,
                    user_add_gold:Number(strNum),user_pwd:strPass,context
                });
                GameDataManager.getAccount().reqHallCommand(
                    clubParam,"P@赠送_俱乐部_积分_" + context);
                return;
            }

            let strPass = Tool.GetChild(button.node.parent,"V7交易密码").getComponent(cc.EditBox).string;
            if(strPass == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入密码!");
                return;
            }

            // 没有当前俱乐部时保留大厅通用金币转账。
            let strParam = JSON.stringify({
                header:"调用_方法_Exchange2",
                target_guuid:strID,
                money_value:strNum,
                money_type:"gold",
                user_pwd:strPass,
                client_version:"2022032201"
            });
            GameDataManager.getAccount().reqAccountCommand(strParam, "P@调用_方法_Exchange2");
        }
        else if(button.node.name === "关闭上层")
        {
            button.node.parent.active = false;
        }
        else if(button.node.name === "关闭上上层")
        {
            if(button.node.parent.parent === this.node.getChildByName("推广二维码"))
            {
                const tab = this.promotionTabReturn;
                this.promotionTabReturn = "";
                this.ClosePromotionPanel();
                // 从底栏「推广」进来的，关掉后把底栏选中态恢复到进入前的分页。
                if(tab)
                    this.switchTabSel(tab);
            }
            else
                button.node.parent.parent.active = false;
        }
        else if(button.node.name === "游戏设置入口")
        {
            UIManager.getInstance().showPanel("panelGameSettings", ShowPanelMode.Cover);
        }
        else if(button.node.name === "设置")
        {
            this.node.getChildByName("设置").active = true;
            let nLiaoAudio = Tool.GetConfigNumber("AudioGCloud",1);
            let nGameAudio = Tool.GetConfigNumber("AudioEff",100);
           // let nSpecial = Tool.GetConfigNumber("特殊开关",1);

            Tool.GetChild(this.node,"设置/列表/item/聊天语音/聊天语音").getComponent(cc.Toggle).isChecked = nLiaoAudio == 1?true:false;
            Tool.GetChild(this.node,"设置/列表/item/游戏音效/游戏音效").getComponent(cc.Toggle).isChecked = nGameAudio >=1?true:false;
            this.RefreshAntiTheftSetting();
           // Tool.GetChild(this.node,"设置/列表/特殊开关/特殊开关").getComponent(cc.Toggle).isChecked = nSpecial == 1?true:false;
        
            // if(GameDataManager.getAccount().role == "董事长" || GameDataManager.getAccount().role == "总裁" || GameDataManager.getAccount().level == "99")
            // {
            //     Tool.GetChild(this.node,"设置/列表/特殊开关").active = true;
            // }
            // else
            // {
            //     Tool.GetChild(this.node,"设置/列表/特殊开关").active = false;
            // }
        }
        else if(button.node.name === "切换账号")
        {
            // 退出登录/切换账号统一走 GameDataManager：只清密码，保留账号。
            GameDataManager.getInstance().logoutToLogin();
            //Tool.RestartGame();
        }
        else if(button.node.name === "修改密码")
        {
            this.node.getChildByName("修改密码").active = true;
            let strAccount = Tool.GetConfigString("unionid","--");
            Tool.GetChild(this.node,"修改密码/列表/账号/账号").getComponent(cc.Label).string = strAccount;
        }
        else if(button.node.name === "获取验证码")
        {
            this.strLastMMSMask = Tool.SendMMS(Tool.GetConfigString("unionid","")); 

            Tool.GetChild(this.node,"修改密码/列表/验证码/time").active = true;
            Tool.GetChild(this.node,"修改密码/列表/验证码/获取验证码").active = false;
            let nCount = 60;
            this.schedule(()=>{
                Tool.GetChild(this.node,"修改密码/列表/验证码/time").getComponent(cc.Label).string = (nCount--).toString();
                if(nCount==0)
                {
                    Tool.GetChild(this.node,"修改密码/列表/验证码/time").active = false;
                    Tool.GetChild(this.node,"修改密码/列表/验证码/获取验证码").active = true; 
                }
            },1,nCount,0.1);
        }
        else if(button.node.name === "确定修改密码")
        {
            let strMask = Tool.GetChild(this.node,"修改密码/列表/验证码/验证码").getComponent(cc.EditBox).string;
            let strPass1 = Tool.GetChild(this.node,"修改密码/列表/新密码1/新密码1").getComponent(cc.EditBox).string;
            let strPass2 = Tool.GetChild(this.node,"修改密码/列表/新密码2/新密码2").getComponent(cc.EditBox).string;

            if(strMask.length != 4)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入验证码");
                return;
            }
            if(strPass1.length<6 || strPass1.length>12)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"密码必须为6到12位！");
                return; 
            }
            if(strPass2.length<6 || strPass2.length>12)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"密码必须为6到12位！");
                return; 
            }
            if(strPass2 !== strPass1)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"2次密码输入不相同！");
                return; 
            }
            if(strMask != this.strLastMMSMask)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"验证码输入不正确！");
                return; 
            }
            Tool.GetChild(this.node,"修改密码/列表/验证码/验证码").getComponent(cc.EditBox).string = "";
            Tool.GetChild(this.node,"修改密码/列表/新密码1/新密码1").getComponent(cc.EditBox).string = "";
            Tool.GetChild(this.node,"修改密码/列表/新密码2/新密码2").getComponent(cc.EditBox).string = "";

            let strParam = "{\"header\":\"修改_玩家_交易密码\",\"old_pwd\":\"000000\",\"new_pwd\":\"" + strPass1 + "\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@修改_玩家_交易密码");

        }
        else if(button.node.name === "资金明细")
        {
            this.node.getChildByName("资金明细").active = true;
            this.set_gold(0);
            this.GetLiuShuiInfo();
        }
        else if(button.node.name === "钻石流向")
        {
            // 钻石流向单独成 prefab（只保留金币流向页的下半部分），避免大厅继续变大。
            UIManager.getInstance().showPanel("panelStoneWater",ShowPanelMode.Cover);
        }
        else if(button.node.name === "上下分记录")
        {
            if(this.ResolveRoomClub() === "")
            {
                this.RefreshClubFinanceMenuVisibility();
                return;
            }
            UIManager.getInstance().showPanel("panelUpDownRecord",ShowPanelMode.Cover);
        }
        else if(button.node.name === "钻石池消耗")
        {
            if(this.ResolveRoomClub() === "")
            {
                this.RefreshClubFinanceMenuVisibility();
                return;
            }
            UIManager.getInstance().showPanel("panelStonePoolCost",ShowPanelMode.Cover);
        }
        else if(button.node.name === "额度授权记录")
        {
            // 大盟主（联盟总群主）查看自己给盟主的额度授信记录，数据见「我的」页同款入口。
            if(this.ResolveRoomClub() === "")
            {
                this.RefreshClubFinanceMenuVisibility();
                return;
            }
            UIManager.getInstance().showPanel("panelQuotaGrantRecord",ShowPanelMode.Cover);
        }
        else if(button.node.name === "金币充值")
        {
            this.OpenWallet(true);
        }
        else if(button.node.name === "奖励")
        {
            UIManager.getInstance().showPanel("panelJiangli",ShowPanelMode.Cover);
        }
        else if(button.node.name === "代理")
        {
            if(this.IsCurrentUserAgent())
            {
                UIManager.getInstance().showPanel("panelHongli",ShowPanelMode.Cover);
            }
            else
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"你不是合伙人，没有权限操作！");
            }
            
        }
        else if(button.node.name === "换一批头像")
        {
            this.RandHeadList();
        }
        else if(button.node.name === "确认随机头像")
        {
            let strName = Tool.GetChild(this.node,"修改个人信息/昵称").getComponent(cc.EditBox).string;
            if(strName == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称不能为空！");
                return; 
            }

            //名字只能是中文数字英文
            if(!strName.match(new RegExp('^[A-Za-z0-9\u3400-\u4DBF\u4E00-\u9FFF]+$')))
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称只能使用中文、英文字母或数字！");
                return; 
            }

            this.node.getChildByName("确定随机头像提示面板").active = false;
            this.node.getChildByName("修改个人信息").active = false;
            this.node.getChildByName("修改个人信息2").active = false;

            let random = ImageManager.getInstance().RandomAvatarIndex();
            GameDataManager.getAccount().reqSetProperty("photo",random);
            GameDataManager.getAccount().reqSetProperty("name",strName);
        }
        else if(button.node.name === "修改个人信息")
        {

            let strName = Tool.GetChild(this.node,"修改个人信息/昵称").getComponent(cc.EditBox).string;
            if(strName == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称不能为空！");
                return; 
            }
            if(strName.length>10)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称太长！");
                return; 
            }


            //名字只能是中文数字英文
            if(!strName.match(new RegExp('^[A-Za-z0-9\u3400-\u4DBF\u4E00-\u9FFF]+$')))
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称只能使用中文、英文字母或数字！");
                return; 
            }



            let strParam = "{\"header\":\"查询_用户_属性\",\"prop_name\":\"sm_name\",\"prop_value\":\""+strName+"\",\"result_name\":\"sm_guuid\",\"context\":\"名字查重\"}";
            GameDataManager.getAccount().reqHallCommand(strParam,"名字查重");
            
        }
        else if(button.node.name === "修改个人信息2")
        {
            let strName = Tool.GetChild(this.node,"修改个人信息2/昵称").getComponent(cc.EditBox).string;
            if(strName == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称不能为空！");
                return; 
            }
            if(strName.length>10)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称太长！");
                return; 
            }

            //名字只能是中文数字英文
            if(!strName.match(new RegExp('^[A-Za-z0-9\u3400-\u4DBF\u4E00-\u9FFF]+$')))
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称只能使用中文、英文字母或数字！");
                return; 
            }

            let strParam = "{\"header\":\"查询_用户_属性\",\"prop_name\":\"sm_name\",\"prop_value\":\""+strName+"\",\"result_name\":\"sm_guuid\",\"context\":\"名字查重\"}";
            GameDataManager.getAccount().reqHallCommand(strParam,"名字查重");

            //this.node.getChildByName("确定修改个人信息").active = true;
        
            
        }
        else if(button.node.name === "确认修改个人信息")
        {
            this.ConfirmPaidAvatarChange();
        }
        else if(button.node.name === "创建房间")
        {
            if(Number(GameDataManager.getAccount().level)<50 && !cc.sys.isBrowser)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"只有合伙人才能创建私密房!");
                return; 
            }
            UIManager.getInstance().showPanel("panelCreateRoom",ShowPanelMode.Cover);
        }
        else if(button.node.name === "加入房间")
        {
            this.node.getChildByName("加入房间").active = true;
            Tool.GetChild(this.node,"加入房间/bk/房号").getComponent(cc.Label).string = "";
        }
        else if(button.node.name === "客服")
        {
            // 2026-10-31 用户确认：底栏「客服」就是俱乐部私聊。
            // 消息页和大厅其他分页一样插在 Main 下，首次点击才加载，之后切走再切回直接复用。
            this.OpenDirectChatPage();
        }
        else if(button.node.name === "排行榜")
        {
            //UIManager.getInstance().showPanel("panelPaihangbang",ShowPanelMode.Cover);
            Debug.Log("进入");
            if(!Tool.GetChild(this.node,"排行榜"))
            {
                Debug.Log("没有！！！！！！！！");
                WebLoadingManager.loadBlockingRes("Prefabs/排行榜","正在加载排行榜",(err,obj)=>{
                    if(err)
                    {
                        cc.error(err.message || err);
                        Debug.Log("错误！！！！！！！！！");
                        return null;
                    }
                    if(this.node == null)
                        return;
                    let node = cc.instantiate(obj);
                    node.active = true;
                    node.name = "排行榜";
                    node.parent = this.node;//this.node.getChildByName("Main");
                });
            }
            else
            {
                Debug.Log("有!!!!!!!!!!!!");
                Tool.GetChild(this.node,"排行榜").active = true
            }
        }
        else if(button.node.name === "管理")
        {
            UIManager.getInstance().showPanel("panelManager",ShowPanelMode.Cover);
        }
        else if(button.node.name === "举报反馈")
        {
            //大厅"发现"下的举报反馈入口不做独立举报流程，直接进入客服界面
            UIManager.getInstance().showPanel("panelKefu",ShowPanelMode.Cover);
        }
        else if(button.node.name === "比赛场")
        {
            //比赛场暂未开放，点击只弹提示
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"暂无比赛，敬请期待！");
        }
        else if(button.node.name === "创建俱乐部")
        {
            this.clubJoinDialogMode = "club";
            this.clubCreateDialogMode = "club";
            this.SetCreateDialogText("club");
            Tool.GetChild(this.node,"创建俱乐部弹窗/面板/名称输入").getComponent(cc.EditBox).string = "";
            this.RefreshClubCreateCostHint();
            this.node.getChildByName("创建俱乐部弹窗").active = true;
        }
        else if(button.node.name === "加入俱乐部")
        {
            this.clubJoinDialogMode = "club";
            this.SetJoinDialogText("club");
            this.clubInputId = "";
            this.RefreshClubIdDisplay();
            this.node.getChildByName("加入俱乐部弹窗").active = true;
        }
        else if(button.node.name === "加入联盟")
        {
            this.OpenJoinUnionDialog();
        }
        else if(button.node.name === "关闭俱乐部弹窗")
        {
            const popup = button.node.parent.parent;
            if(popup === this.node.getChildByName("创建俱乐部弹窗"))
            {
                this.clubCreateDialogMode = "club";
                this.SetCreateDialogText("club");
            }
            else
            {
                this.clubJoinDialogMode = "club";
                this.SetJoinDialogText("club");
            }
            popup.active = false;
        }
        else if(button.node.parent.name === "俱乐部键盘")
        {
            if(button.node.name === "重输")
                this.clubInputId = "";
            else if(button.node.name === "删除")
                this.clubInputId = this.clubInputId.slice(0,-1);
            else if(/^\d$/.test(button.node.name) && this.clubInputId.length < 6)
                this.clubInputId += button.node.name;
            this.RefreshClubIdDisplay();
        }
        else if(button.node.name === "确认创建俱乐部")
        {
            this.clubCreateDialogMode === "union" ? this.CreateUnion() : this.CreateClub();
        }
        else if(button.node.name === "申请加入俱乐部")
        {
            this.clubJoinDialogMode === "union" ? this.JoinUnion() : this.JoinClub();
        }






        else if(button.node.parent.name === "键盘")
        {
            if(this.txtInputRoomid === undefined || this.txtInputRoomid === null)
            {
                this.txtInputRoomid = Tool.GetChild(this.node,"加入房间/bk/房号").getComponent(cc.Label);
            }
            if(button.node.name === "重置")
            {
                this.txtInputRoomid.string = "";
            }
            else if(button.node.name === "删除")
            {
                if(this.txtInputRoomid.string.length>0)
                {
                    this.txtInputRoomid.string = this.txtInputRoomid.string.substr(0,this.txtInputRoomid.string.length-1);
                }
            }
            else
            {
                if(this.txtInputRoomid.string.length>=6)
                {
                    return;
                }
                this.txtInputRoomid.string += button.node.name;
                if(this.txtInputRoomid.string.length >=6)
                {
                    this.node.getChildByName("加入房间").active = false;
                    if(!GpsManager.getInstance().IsGpsOpen()&&ConfigManager.getInstance().enalbe_gps=="True")
                    {
                        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"未打开GPS不能进入房间！")
                        return;
                    }

                    UIManager.getInstance().showPanel("panelLoading",ShowPanelMode.Top);
                    const account = GameDataManager.getAccount();
                    const clubId = this.ResolveRoomClub();
                    account.reqEnterRoom(RoomType.Custom,Number(this.txtInputRoomid.string),
                        withRoomClubId("{{\"special_rule\": \"观战\"}}",clubId));
        
                    MobileManager.getInstance().OnTalkingEvent("加入房间","加入房间");
                }
            }
        }
        else if(button.node.parent.name === "content1")
        {
            let headList = null;
            if(Tool.GetChild(this.node,"修改个人信息").active)
            {
                headList = Tool.GetChild(this.node,"修改个人信息/头像列表/view/content1");
            }
            else
            {
                headList = Tool.GetChild(this.node,"修改个人信息2/头像列表/view/content1");
            }
            for(let item of headList.children)
            {
                if(button.node.name === item.name)
                {
                    item.getComponent(cc.Sprite).enabled = true;
                    let avatarIndex = ImageManager.getInstance().NormalizeAvatarIndex(item.name);
                    Tool.GetChild(headList.parent.parent.parent,"头像/name").getComponent(cc.Label).string = avatarIndex;
                    let img = Tool.GetChild(headList.parent.parent.parent,"头像/mask/img").getComponent(cc.Sprite);
                    ImageManager.getInstance().SetLocalAvatar(img, avatarIndex);
                }
                else
                {
                    item.getComponent(cc.Sprite).enabled = false;
                }
            }
        }
        else if(button.node.name === "头像" || button.node.name === "编辑资料")
        {
            // 俱乐部弹窗打开时，头像点击一律交给 ClubManagementView 处理。
            // 不能只查祖先节点名：成员列表第一行头像与大厅「我的」页自己头像位置重叠，
            // 点击可能落到大厅那张头像上，此时祖先里并没有俱乐部弹窗。
            for(const name of ["俱乐部成员弹窗","俱乐部申请弹窗","俱乐部玩家设置弹窗"])
            {
                const popup = this.node.getChildByName(name);
                if(popup && popup.active)
                    return;
            }
            let ancestor:cc.Node = button.node;
            while(ancestor != null)
            {
                if(ancestor.name === "俱乐部成员弹窗" || ancestor.name === "俱乐部玩家设置弹窗")
                    return;
                ancestor = ancestor.parent;
            }
            let editNode = this.node.getChildByName("修改个人信息2");
            editNode.active = true;
            Tool.GetChild(editNode,"昵称").getComponent(cc.EditBox).string = GameDataManager.getAccount().name;
            this.EnsureLocalAvatarSelector(editNode);
            this.RefreshEditAvatarBatch(editNode);
            this.PreviewEditAvatar(this.EnsureAccountAvatar());
        }
        else if(button.node.name.indexOf("公告")>=0)
        {
            this.node.getChildByName(button.node.name).active = true;
            if(button.node.name == "公告6")
            {
                ConfigManager.getInstance().GetOneHashKey("系统公告","公告6");
            }
            if(button.node.name == "公告7")
            {
                ConfigManager.getInstance().GetOneHashKey("惩罚公告","公告7");
            }
            if(button.node.name == "公告8")
            {
                ConfigManager.getInstance().GetOneHashKey("充值提现公告","公告8");
            }
            // else if(button.node.name == "公告6")
            // {
                
            //     let strParam = "{\"header\":\"设置_哈希2_信息\",\"key\":\"处罚记录\",\"content\":\""+Tool.Base64Encode("---")+"\",\"context\":\"设置_处罚记录\"}";
            //     GameDataManager.getAccount().reqAccountCommand(strParam, "P@设置_处罚记录"); 
            // }
        }
        else if(button.node.name == "选择头像")
        {
            // 头像已全部列在当前页面，此节点仅作为列表标题保留。
            return;
        }
        else if(button.node.name == "上一页")
        {
            if(this.scrollCFNotify.nCurPage <= 1)
                return;
            this.GetCFNotifyInfo(this.scrollCFNotify.nCurPage-1);
        }
        else if(button.node.name == "下一页")
        {
            if(this.scrollCFNotify.nCurPage+1>this.scrollCFNotify.nTotlePage)
                return;
            this.GetCFNotifyInfo(this.scrollCFNotify.nCurPage+1);
        }
        else if(button.node.name == "尾页")
        {
            if(this.scrollCFNotify.nTotlePage == 0)
                return;
            this.GetCFNotifyInfo(this.scrollCFNotify.nTotlePage);
        }
        else if(button.node.name == "首页")
        {
            this.GetCFNotifyInfo();
        }

        else if(button.node.name === "测试绑定")
        {
            let strID = button.node.parent.getChildByName("id").getComponent(cc.EditBox).string;

            let strLogin = cc.sys.localStorage.getItem("unionid");

            let strParam = "{\"header\":\"设置_玩家上级_信息\",\"upper_guuid\":\"" + strID + "\",\"player_wxid\":\"" + strLogin + "\",\"player_wxname\":\"" + GameDataManager.getAccount().name + "\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_玩家上级_信息");
        }
        else if(button.node.name === "重新加载")
        {
            let strParam = "{\"header\":\"加载_玩家上级_信息\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@加载_玩家上级_信息");
        }
        else if(button.node.parent.name === "转盘1" || button.node.parent.name === "转盘2")
        {
            this.MoveItemPos(button.node)
        }
        else if(button.node.name === "兑换金币券")
        {
            if(Number(GameDataManager.getAccount().paper)<100)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"金币券不足一百张，不能兑换!")
                return;
            }
            let strParam = "{\"header\":\"提取_玩家_代金券\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@提取_玩家_代金券");
        }
        else if(button.node.name === "清除用户" || button.node.name === "清除密码")
        {
            button.node.parent.getComponent(cc.EditBox).string = ""
        }
        else if(button.node.name === '左箭头')
        {
            //拿到当前在哪
            let root = Tool.GetChild(this.node,"Main/我的/操作台/功能");
            let index = 0;
            for(let item of root.children)
            {
                if(item.active)
                {
                    index = item.getSiblingIndex();
                    break;
                }
            }
            index--;
            if(index<0)
            {
                index = root.children.length-1;
            }
            for(let i=0;i<root.children.length;i++)
            {
                if(i == index)
                {
                    root.children[i].active = true;
                }
                else
                {
                    root.children[i].active = false;
                }
            }
        }
        else if(button.node.name === '右箭头')
        {
           //拿到当前在哪
           let root = Tool.GetChild(this.node,"Main/我的/操作台/功能");
           let index = 0;
           for(let item of root.children)
           {
               if(item.active)
               {
                   index = item.getSiblingIndex();
                   break;
               }
           }
           index++;
           if(index>=root.children.length)
           {
               index = 0;
           }
           for(let i=0;i<root.children.length;i++)
           {
               if(i == index)
               {
                   root.children[i].active = true;
               }
               else
               {
                   root.children[i].active = false;
               }
           }
        }
        else if(button.node.name == "修改预留信息")
        {
            UIManager.getInstance().showPanel("修改预留信息",ShowPanelMode.Cover);
        }
        else if(button.node.name == "上一个")
        {
            this.nCurPosS++
            if(this.nCurPosS>=this.arrayDHS.length) //越界了，需要复位
            {
                this.nCurPosS = 0;
            }
            button.interactable = false;
            let anPos = this.nCurPosS-1
            if(anPos<0)
            {
                anPos = this.arrayDHS.length-1
            }
            Debug.Log("s位置:"+this.nCurPosS+" "+this.arrayDHS[anPos])
            this.animateSet.playAnimation(this.arrayDHS[anPos],1)
            this.animateSet.addEventListener(dragonBones.EventObject.COMPLETE,()=>{
                button.interactable = true;
            },this);
            //修复对象位置
            for(let i = 0;i<this.arrayDHN.length;i++)
            {
                let strNextName = this.arrayDHS[this.nCurPosS]
                if(this.arrayDHN[i].indexOf(strNextName)>=0)
                {
                    //找到
                    this.nCurPosN = i;
                    Debug.Log("n位置:"+this.nCurPosN+" "+this.arrayDHN[this.nCurPosN])
                }
            }
        }
        else if(button.node.name == "下一个")
        {
            this.nCurPosN++
            if(this.nCurPosN>=this.arrayDHN.length) //越界了，需要复位
            {
                this.nCurPosN = 0;
            }
            button.interactable = false;
            let anPos = this.nCurPosN-1
            if(anPos<0)
            {
                anPos = this.arrayDHN.length-1
            }
            Debug.Log("n位置:"+this.nCurPosN+" "+this.arrayDHN[anPos])
            this.animateSet.playAnimation(this.arrayDHN[anPos],1)
            this.animateSet.addEventListener(dragonBones.EventObject.COMPLETE,()=>{
                button.interactable = true;
            },this);
            
            //修复对象位置
            for(let i = 0;i<this.arrayDHS.length;i++)
            {
                let strNextName = this.arrayDHN[this.nCurPosN]
                strNextName = strNextName.replace("_1","")
                if(this.arrayDHS[i].indexOf(strNextName)>=0)
                {
                    //找到
                    this.nCurPosS = i;
                    Debug.Log("s位置:"+this.nCurPosS+" "+this.arrayDHS[this.nCurPosS])
                }
            }
        }
        else if(button.node.name == "动画选择")
        {
            let btn = Tool.GetChild(this.node,"Main/我的/操作动画/按钮/"+this.arrayBTNName[this.nCurPosS]).getComponent(cc.Button);

            this.onButtonClick(btn);
        }
        else if(button.node.name == "世界杯")
        {
            ConfigManager.getInstance().GetOneHashKey("世界杯2","世界杯2");
        }
        else if(button.node.name == "个人数据")
        {
            UIManager.getInstance().showPanel("panelVipInfo",ShowPanelMode.Cover);
        }
        else if(button.node.name == "修改登陆密码")
        {
            this.node.getChildByName("修改登陆密码").active = true;
        }
        else if(button.node.name == "确定修改登陆密码")
        {
            let strOldPwd = Tool.GetChild(this.node,"修改登陆密码/列表/原有密码/txt").getComponent(cc.EditBox).string
            let strNewPwd1 = Tool.GetChild(this.node,"修改登陆密码/列表/新密码1/txt").getComponent(cc.EditBox).string
            let strNewPwd2 = Tool.GetChild(this.node,"修改登陆密码/列表/新密码2/txt").getComponent(cc.EditBox).string
            if(strOldPwd == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入旧密码");
                return
            }
            if(strNewPwd1 == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入新密码");
                return
            }
            if(strNewPwd2 == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请再次输入新密码");
                return
            }
            if(strNewPwd1 != strNewPwd2)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"两次密码输入不一致");
                return
            }

            //开始修改
            let strParam = "{\"header\":\"修改_玩家_登录密码\",\"old_pwd\":\""+strOldPwd+"\",\"new_pwd\":\"" + strNewPwd1 + "\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@修改_玩家_登录密码");
        }
        else if(button.node.name == "修改交易密码")
        {
            if(this.bNeedInitJYPwd)
            {
                Tool.GetChild(this.node,"初始化交易密码").active = true
            }
            else
            {
                this.node.getChildByName("修改交易密码").active = true;
            }
            
        }
        else if(button.node.name == "确定修改交易密码")
        {
            let strOldPwd = Tool.GetChild(this.node,"修改交易密码/列表/原有密码/txt").getComponent(cc.EditBox).string
            let strNewPwd1 = Tool.GetChild(this.node,"修改交易密码/列表/新密码1/txt").getComponent(cc.EditBox).string
            let strNewPwd2 = Tool.GetChild(this.node,"修改交易密码/列表/新密码2/txt").getComponent(cc.EditBox).string
            if(strOldPwd == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入旧密码");
                return
            }
            if(strNewPwd1 == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入新密码");
                return
            }
            if(strNewPwd2 == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请再次输入新密码");
                return
            }
            if(strNewPwd1 != strNewPwd2)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"两次密码输入不一致");
                return
            }

            //开始修改
            let strParam = "{\"header\":\"修改_玩家_交易密码\",\"old_pwd\":\""+strOldPwd+"\",\"new_pwd\":\"" + strNewPwd1 + "\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@修改_玩家_交易密码");
        }
        else if(button.node.name == "确定初始化交易密码")
        {
            let strNewPwd1 = Tool.GetChild(this.node,"初始化交易密码/列表/新密码1/txt").getComponent(cc.EditBox).string
            let strNewPwd2 = Tool.GetChild(this.node,"初始化交易密码/列表/新密码2/txt").getComponent(cc.EditBox).string
            if(strNewPwd1 == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入新密码");
                return
            }
            if(strNewPwd2 == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请再次输入新密码");
                return
            }
            if(strNewPwd1 != strNewPwd2)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"两次密码输入不一致");
                return
            }
            //开始修改
            let strParam = "{\"header\":\"修改_玩家_交易密码\",\"old_pwd\":\"\",\"new_pwd\":\"" + strNewPwd1 + "\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@修改_玩家_交易密码");
        }
        else if(button.node.name == "惩罚列表")
        {
            Tool.GetChild(this.node,"惩罚列表").active = true
            this.GetCFNotifyInfo()
        }

    }

    private nCurPosS = 0; //当前动画位置
    private nCurPosN = 0; //当前动画位置
    private arrayDHS:string[] = ["Animation_MoneyFlow","Animation_Set","Animation_Agent","Animation_Record","Animation_Give"] //所有动画 顺时针
    private arrayDHN:string[] = ["Animation_MoneyFlow_1","Animation_Give_1","Animation_Record_1","Animation_Agent_1","Animation_Set_1"] //所有动画 逆时针
    private arrayBTNName:string[] = ["资金明细","设置","代理","战绩","赠送"]
    private strLastMMSMask:string = "";

    private ClearTransactionPasswordInputs()
    {
        let inputPaths = [
            "修改交易密码/列表/原有密码/txt",
            "修改交易密码/列表/新密码1/txt",
            "修改交易密码/列表/新密码2/txt",
            "初始化交易密码/列表/新密码1/txt",
            "初始化交易密码/列表/新密码2/txt"
        ];
        for(let path of inputPaths)
        {
            let editBox = Tool.GetChild(this.node,path).getComponent(cc.EditBox);
            editBox.string = "";
            editBox.blur();
        }
    }

    onToggleClick(toggle:cc.Toggle)
    {
        if(this.updatingMainTabSelection)
            return;
        // 用户自己点过任意分页/开关后，不再按俱乐部关系自动改分页。
        this.lobbyEntryResolved = true;
        if(toggle.node.name === "发现")
        {
            this.switchTabSel(toggle.node.name);
            this.getAllRooms();
        }
        else if(toggle.node.name === "推广")
        {
            // 推广是独立全屏分享页，不占用 Main 分页；关闭后回到进入前的分页。
            this.promotionTabReturn = this.currentMainTab;
            if(!this.OpenPromotionPanel())
                this.switchTabSel(this.promotionTabReturn || "发现");
        }
        else if(toggle.node.name === "兑换")
        {
            this.switchTabSel(toggle.node.name);
        }
        else if(toggle.node.name === "约局")
        {
            this.switchTabSel(toggle.node.name);
        }
        else if(toggle.node.name === "排行榜")
        {
            Debug.Log("进入");
            this.switchTabSel(toggle.node.name);

            if(!Tool.GetChild(this.node,"排行榜"))
            {
                Debug.Log("没有！！！！！！！！");
                WebLoadingManager.loadBlockingRes("Prefabs/排行榜","正在加载排行榜",(err,obj)=>{
                    if(err)
                    {
                        cc.error(err.message || err);
                        Debug.Log("错误！！！！！！！！！");
                        return null;
                    }
                    if(this.node == null)
                        return;
                    let node = cc.instantiate(obj);
                    node.active = true;
                    node.name = "排行榜";
                    node.parent =this.node.getChildByName("Main");
                });
            }
            else
            {
                Debug.Log("有!!!!!!!!!!!!");
            }
        }
        else if(toggle.node.name === "钱包")
        {
            this.OpenWallet(false);
        }
        else if(toggle.node.name === "俱乐部")
        {
            this.switchTabSel("俱乐部");
            this.RefreshClubList();
        }
        else if(toggle.node.name === "我的")
        {

            //更新vip信息
            let strParam = "{\"header\":\"玩家_查询_VIP\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@玩家_查询_VIP");

            strParam = "{\"header\":\"校验_玩家_交易密码\",\"old_pwd\":\"\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@校验_玩家_交易密码");


            // let strParam:string = GameDataManager.getAccount().remark;
            // if (strParam == "")
            //     strParam = "0,0,0,0,0,0,0";
            // let arrayParam = strParam.split(',');

            // let nWin = Number(arrayParam[0]);
            // let nLose = Number(arrayParam[1]);
            // let nHe = Number(arrayParam[2]);
            // let nRu = Number(arrayParam[6]); //入池次数

            // let nTotle = nWin + nLose + nHe;
            // let nFanPer = nTotle > 0 ? Number(arrayParam[3]) * 100 / nTotle : 0;
            // let nWinPer = nTotle > 0 ? nWin * 100 / nTotle : 0;

            // let nFanWin = Number(arrayParam[3])>0?Number(arrayParam[5])*100/Number(arrayParam[3]):0;

            // let nRuChi = nTotle > 0 ? nRu * 100 / nTotle : 0;



                    
            // Tool.GetChild(this.node,"Main/我的/数据/总手数").getComponent(cc.Label).string = (Number(arrayParam[0])+ Number(arrayParam[1])+ Number(arrayParam[2])).toString();
            // Tool.GetChild(this.node,"Main/我的/数据/总胜率").getComponent(cc.Label).string =  nWinPer.toFixed(0).toString()+"%";
            // Tool.GetChild(this.node,"Main/我的/数据/获胜手数").getComponent(cc.Label).string = nWin.toString();
            // Tool.GetChild(this.node,"Main/我的/数据/平局手数").getComponent(cc.Label).string = nHe.toString();
            // Tool.GetChild(this.node,"Main/我的/数据/失败手数").getComponent(cc.Label).string = nLose.toString();
            



            this.switchTabSel(toggle.node.name);
        }
        else if(toggle.node.name === "全" || toggle.node.name === "小" || toggle.node.name === "中" || toggle.node.name === "大")
        {
            if(toggle.node.parent.name === "过滤" && toggle.isChecked)
            {
                this.getAllRooms(0,true);
            }
        }
        else if(toggle.node.name === "有空位")
        {
            // 空位是独立复选条件，勾选和取消都要重新请求第一页。
            this.getAllRooms(0,true);
        }
        else if(toggle.node.parent.name === "过滤" && toggle.isChecked)
        {
            this.getAllRooms(0,true);
        }
        else if(toggle.node.name === "聊天语音")
        {
            cc.sys.localStorage.setItem("AudioGCloud",toggle.isChecked?1:0);
        }
        else if(toggle.node.name === "游戏音效")
        {
            cc.sys.localStorage.setItem("AudioEff",toggle.isChecked?100:0);
        }
        else if(toggle.node.name === "防盗号开关")
        {
            this.OnAntiTheftToggleChanged(toggle);
        }
        else if(toggle.node.name === "特殊开关")
        {
            cc.sys.localStorage.setItem("特殊开关",toggle.isChecked?1:0);
            // if(toggle.isChecked)
            // {
            //     if(GameDataManager.getAccount().role == "董事长" || GameDataManager.getAccount().role == "总裁" || GameDataManager.getAccount().level == "99")
            //     {
            //         Tool.GetChild(this.node ,"Main/我的/操作/奖励").active = true;
            //     }
            // }
            // else
            // {
            //     Tool.GetChild(this.node ,"Main/我的/操作/奖励").active = false;
            // }
        }
    }

    private IsAntiTheftEnabled():boolean
    {
        let account = GameDataManager.getAccount();
        return account != null && Number(account.anti_theft_on || 0) === 1;
    }

    private RefreshAntiTheftSetting(message:string = "",isError:boolean = false)
    {
        if(this.antiTheftToggle == null || this.antiTheftStatus == null)
            return;
        let enabled = this.IsAntiTheftEnabled();
        this.antiTheftSyncing = true;
        this.antiTheftToggle.isChecked = enabled;
        this.antiTheftToggle.interactable = !this.antiTheftBusy;
        this.antiTheftSyncing = false;
        this.antiTheftStatus.string = message != "" ? message : (enabled ? "已开启：仅当前绑定设备可登录" : "未开启：可在其他设备使用账号密码登录");
        this.antiTheftStatus.node.color = isError ? new cc.Color(218,187,112,255) : (enabled ? new cc.Color(66,204,190,255) : new cc.Color(139,161,171,255));
    }

    private OnAntiTheftToggleChanged(toggle:cc.Toggle)
    {
        if(this.antiTheftSyncing)
            return;
        let current = this.IsAntiTheftEnabled();
        let desired = toggle.isChecked;
        this.antiTheftSyncing = true;
        toggle.isChecked = current;
        this.antiTheftSyncing = false;
        if(this.antiTheftBusy || desired === current)
            return;

        DeviceIdentityManager.getInstance().prepare().then((identity)=>{
            if(!identity.available || (desired && !identity.persistent))
            {
                let message = identity.message || "当前设备无法稳定保存设备标识，不能开启防盗号";
                this.RefreshAntiTheftSetting(message,true);
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,message);
                return;
            }
            let message = desired ?
                (identity.platform === "web" ? "开启后账号将绑定当前浏览器。清除网站数据、更换浏览器或更换访问地址后将无法直接登录，需要联系客服解绑。确认开启吗？" : "开启后只有当前设备可以登录。设备丢失或更换手机前，请先关闭防盗号；否则需要联系客服解绑。确认开启吗？") :
                "关闭后，其他设备可直接使用账号密码登录。确认关闭防盗号吗？";
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,message,[(confirmed:boolean)=>{
                if(confirmed)
                    this.SendAntiTheftSetting(desired,identity.deviceId,identity.platform,identity.version);
                else
                    this.RefreshAntiTheftSetting("已取消修改",false);
            }]);
        });
    }

    private SendAntiTheftSetting(enabled:boolean,deviceId:string,platform:string,version:number)
    {
        if(this.antiTheftBusy)
            return;
        this.antiTheftBusy = true;
        this.antiTheftDesired = enabled;
        this.antiTheftRequestId = DeviceIdentityManager.getInstance().createRequestId();
        this.RefreshAntiTheftSetting(enabled ? "正在绑定当前设备…" : "正在关闭防盗号…",false);
        let param = JSON.stringify({
            header:"设置_防盗号_开关",
            anti_theft_on:enabled ? 1 : 0,
            device_id:deviceId,
            device_platform:platform,
            device_version:version,
            request_id:this.antiTheftRequestId
        });
        GameDataManager.getAccount().reqAccountCommand(param,"P@设置_防盗号_开关");
        this.unschedule(this.antiTheftTimeoutHandler);
        this.scheduleOnce(this.antiTheftTimeoutHandler,12);
    }

    public onAccountCommand(nCode:number,param:string)
    {
        if(this.antiTheftRequestId == "" || param == null || param.indexOf("设置_防盗号_开关") < 0)
            return;
        let payload:any = null;
        try { payload = JSON.parse(param); } catch(error) {}
        let result = payload != null && payload.result != null ? payload.result : payload;
        if(result != null && result.request_id != null && result.request_id !== this.antiTheftRequestId)
            return;
        let success = nCode === 0x200 && (result == null || result.success !== false);
        if(!success)
        {
            let message = result != null && result.message ? result.message : "防盗号设置失败，请稍后重试";
            this.FinishAntiTheftSetting(message,true);
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,message);
            return;
        }
        if(this.IsAntiTheftEnabled() === this.antiTheftDesired)
        {
            this.FinishAntiTheftSetting(result != null && result.message ? result.message : (this.antiTheftDesired ? "防盗号已开启" : "防盗号已关闭"),false);
            return;
        }
        this.RefreshAntiTheftSetting("服务器已受理，正在同步最终状态…",false);
    }

    public set_anti_theft_on(value:any = null)
    {
        if(this.antiTheftBusy && this.IsAntiTheftEnabled() === this.antiTheftDesired)
        {
            this.FinishAntiTheftSetting(this.antiTheftDesired ? "防盗号已开启" : "防盗号已关闭",false);
            return;
        }
        this.RefreshAntiTheftSetting();
    }

    private FinishAntiTheftSetting(message:string,isError:boolean)
    {
        this.unschedule(this.antiTheftTimeoutHandler);
        this.antiTheftBusy = false;
        this.antiTheftRequestId = "";
        this.RefreshAntiTheftSetting(message,isError);
    }

    private OpenWallet(returnToCashWater:boolean):void
    {
        if(this.walletOpening)
            return;
        this.walletOpening = true;
        this.walletReturnToCashWater = returnToCashWater;
        const request = ++this.walletOpenRequest;
        this.node.getChildByName("资金明细").active = false;
        this.switchTabSel("钱包");
        const main = this.node.getChildByName("Main");
        if(main.getChildByName("钱包") != null)
        {
            this.walletOpening = false;
            return;
        }
        WebLoadingManager.loadBlockingRes("Prefabs/钱包","正在加载钱包",(err,obj)=>{
            if(!cc.isValid(this.node) || request !== this.walletOpenRequest)
                return;
            this.walletOpening = false;
            if(err)
            {
                cc.error(err.message || err);
                this.CloseWallet();
                return;
            }
            const node = cc.instantiate(obj);
            node.active = false;
            node.name = "钱包";
            node.parent = main;
            node.active = true;
        });
    }

    public CloseWallet():void
    {
        const returnToCashWater = this.walletReturnToCashWater;
        // switchTabSel also invalidates a pending load and consumes its origin.
        this.switchTabSel(returnToCashWater ? "我的" : "发现");
        if(returnToCashWater)
        {
            this.node.getChildByName("资金明细").active = true;
            this.set_gold(0);
            // Retain the existing records, page and scroll offset on return.
        }
        else
            this.getAllRooms();
    }


    /** 消息页（俱乐部私聊）作为 Main 的一个分页，首次点击客服时实例化并缓存。 */
    private directChatPage:cc.Node = null;
    private directChatLoading:boolean = false;

    private OpenDirectChatPage():void
    {
        let main = this.node.getChildByName("Main");
        if(main == null)
            return;
        let page = main.getChildByName("消息");
        if(page == null && this.directChatPage != null && cc.isValid(this.directChatPage))
            page = this.directChatPage;
        if(page != null)
        {
            this.switchTabSel("消息");
            this.RefreshDirectChatPage(page);
            return;
        }
        if(this.directChatLoading)
            return;
        this.directChatLoading = true;
        cc.loader.loadRes("UI/panelMessage",(err:any,prefab:any)=>{
            this.directChatLoading = false;
            if(err != null || prefab == null || !cc.isValid(this.node))
            {
                cc.error(err && err.message ? err.message : err);
                return;
            }
            let existing = this.node.getChildByName("Main").getChildByName("消息");
            if(existing != null)
            {
                this.switchTabSel("消息");
                this.RefreshDirectChatPage(existing);
                return;
            }
            let node = cc.instantiate(prefab);
            node.name = "消息";
            node.parent = this.node.getChildByName("Main");
            node.active = true;
            this.directChatPage = node;
            this.switchTabSel("消息");
            this.RefreshDirectChatPage(node);
        });
    }

    /** 点击底栏「消息」时与下拉刷新同一入口；已在消息页也重新拉第一页。 */
    private RefreshDirectChatPage(page:cc.Node):void
    {
        if(page == null || !cc.isValid(page))
            return;
        let view:any = page.getComponent("panelMessage");
        if(view != null && typeof view.RefreshFromTop === "function")
            view.RefreshFromTop();
    }

    switchTabSel(strName:string)
    {
        if(strName === "我的" && this.clubManagement)
        {
            this.clubManagement.Refresh();
            const id = this.ResolveRoomClub();
            const account = GameDataManager.getAccount();
            if(id && account)
            {
                if(!this.clubDetails[id])
                    account.reqHallCommand(JSON.stringify({header:"查询_俱乐部_信息",club_id:id}),"p@club:info:" + id);
                const cachedAgent = this.clubAgentInfo[id];
                const cachedCode = cachedAgent && cachedAgent.invite_code != null ?
                    String(cachedAgent.invite_code).trim() : "";
                // 代理信息在但邀请码为空时也要补查，卡片上的「邀请码:」不能空着。
                if(!cachedAgent || !cachedCode)
                    this.RequestCurrentClubAgent(id,true);
                // 联盟审批不会推送，进「我的」时补查一次，入盟后创建/加入入口自动收起。
                this.RequestClubUnionStatus(id,false);
                this.RequestClubUnionName(id,true);
                // 群主钻石池只在群主卡片显示；查询节流，避免每次切页重复发。
                this.RequestClubStonePool(id);
            }
        }
        if(strName !== "钱包")
        {
            ++this.walletOpenRequest;
            this.walletOpening = false;
            this.walletReturnToCashWater = false;
        }
        let arrayTemp = this.node.getChildByName("Main").children;
        let switchedToPage = false;
        arrayTemp.forEach((item,idx,array)=>{
            if(item.name == strName)
            {
                item.active = true;
                switchedToPage = true;
            }
            else
            {
                item.active = false;
            }
        });
        if(switchedToPage)
            this.currentMainTab = strName;
        // 只在「我的」页停留时轮询钻石池；切页/离开立即停。
        this.unschedule(this.clubStonePoolPoll);
        if(strName === "我的" && this.IsClubOwner(this.ResolveRoomClub()))
            this.schedule(this.clubStonePoolPoll,30);
        if(strName === "发现")
            this.RefreshDiscoveryClubFunds(true);

        //复位Toggle
        let arrayToggle = this.node.getChildByName("Down").getComponentsInChildren(cc.Toggle);
        this.updatingMainTabSelection = true;
        try
        {
            arrayToggle.forEach((item,idx,array)=>{
                if(item.node.name === strName)
                {
                    if(!item.isChecked)
                        item.isChecked = true;
                }
                else if(item.isChecked)
                {
                    item.isChecked = false;
                }
            });
        }
        finally { this.updatingMainTabSelection = false; }

        // 钱包确认稿是独立全屏页，顶部已有返回按钮；打开钱包时隐藏
        // 大厅底栏，避免长屏下遮挡充值、提现与记录的底部操作区。
        this.node.getChildByName("Down").active = strName !== "钱包";
        if(strName === "我的")
            this.SyncMyPageScroll();
    }

    /**
     * 「我的」页下半部分（按钮区 + 当前俱乐部卡片）装在 Prefab 的「滚动区」里，
     * 内容高度由「当前俱乐部」卡片是否显示决定（ClubManagementView.syncProfileScroll），
     * 这里负责切页时对齐 Widget 并回到顶部，短屏也能看全。
     */
    private SyncMyPageScroll():void
    {
        // 切页当帧 Widget 还没对齐，延后一帧再读真实可视高度。
        this.scheduleOnce(()=>{
            if(!cc.isValid(this.node))
                return;
            const mine = Tool.GetChild(this.node,"Main/我的");
            const scroll = Tool.GetChild(this.node,"Main/我的/滚动区");
            const view = Tool.GetChild(scroll,"view");
            if(scroll == null || view == null)
                return;
            // 从页面到 view 逐层立即对齐，避免读到 Prefab 里的设计态尺寸。
            for(const target of [mine,scroll,view])
            {
                const widget = target && target.getComponent(cc.Widget);
                if(widget)
                    widget.updateAlignment();
            }
            if(view.height <= 0)
                return;
            // 内容高度按「有没有当前俱乐部卡片、是否显示联盟入口」取 550/660/350，统一由俱乐部视图计算。
            if(this.clubManagement)
                this.clubManagement.syncProfileScroll();
            const scrollView = scroll.getComponent(cc.ScrollView);
            if(scrollView)
                scrollView.scrollToTop(0);
        },0);
    }

    private ResolveRoomClub():string
    {
        const account = GameDataManager.getAccount();
        const key = account && account.guuid ? "lastRoomClub:" + account.guuid : "";
        const ids = this.GetMyClubIds();
        if(key !== this.roomClubAccountKey)
        {
            this.roomClubAccountKey = key;
            this.selectedRoomClubId = key ? cc.sys.localStorage.getItem(key) || "" : "";
        }
        if(ids.indexOf(this.selectedRoomClubId) < 0)
            this.selectedRoomClubId = ids.length > 0 ? ids[0] : "";
        if(key && this.selectedRoomClubId)
            cc.sys.localStorage.setItem(key,this.selectedRoomClubId);
        return this.selectedRoomClubId;
    }

    /**
     * 创建 / 申请加入俱乐部后开始等「新俱乐部」出现：记下当前俱乐部 ID 快照。
     * 等 set_club_make / set_club_join 推送回来再由 ApplyPendingDefaultClub 切默认。
     */
    private MarkPendingDefaultClub():void
    {
        this.pendingDefaultClub = true;
        this.defaultClubBaseIds = this.GetMyClubIds();
        if(this.defaultClubTimer != null)
        {
            clearTimeout(this.defaultClubTimer);
            this.defaultClubTimer = null;
        }
        this.defaultClubTimer = setTimeout(()=>{
            this.defaultClubTimer = null;
            this.pendingDefaultClub = false;
            this.defaultClubBaseIds = [];
        },this.DEFAULT_CLUB_WAIT_MS);
    }

    private CancelPendingDefaultClub():void
    {
        this.pendingDefaultClub = false;
        this.defaultClubBaseIds = [];
        if(this.defaultClubTimer != null)
        {
            clearTimeout(this.defaultClubTimer);
            this.defaultClubTimer = null;
        }
    }

    /**
     * 俱乐部关系推送到达时调用：快照里没有、现在多出来的那家就是刚创建/刚入会的俱乐部，
     * 直接设为默认俱乐部并落本地存储，让「我的」卡片、房间列表、进房 club_id 一起跟过去。
     */
    private ApplyPendingDefaultClub():boolean
    {
        if(!this.pendingDefaultClub)
            return false;
        const ids = this.GetMyClubIds();
        const added = ids.filter(id=>this.defaultClubBaseIds.indexOf(id) < 0);
        if(added.length === 0)
            return false;
        const clubId = added[added.length - 1];
        this.CancelPendingDefaultClub();
        const account = GameDataManager.getAccount();
        this.selectedRoomClubId = clubId;
        if(account && account.guuid)
            cc.sys.localStorage.setItem("lastRoomClub:" + account.guuid,clubId);
        return true;
    }

    private ClearClubRooms()
    {
        this.arrayRoomData = [];
        this.roomListAppliedFilterKey = "";
        if(this.scrollRoom2)
            this.scrollRoom2.Init([],true);
        if(this.scrollRoom)
        {
            this.scrollRoom.nCurPage = 0;
            this.scrollRoom.nCount = 0;
            this.scrollRoom.nTotlePage = 0;
        }
    }

    private GetRoomListFilter():{clubId:string,roomType:string,haveFreeSit:number,key:string}
    {
        let roomType = "";
        let haveFreeSit = 0;
        const arrayType = Tool.GetChild(this.node,"Main/发现/过滤").getComponentsInChildren(cc.Toggle);
        for(const toggle of arrayType)
        {
            if(!toggle.isChecked || !toggle.node.activeInHierarchy)
                continue;
            if(toggle.node.name === "有空位")
                haveFreeSit = 1;
            else if(roomType === "")
                roomType = toggle.node.name;
        }
        const clubId = this.ResolveRoomClub();
        return {clubId:clubId,roomType:roomType,haveFreeSit:haveFreeSit,key:clubId+"|"+roomType+"|"+haveFreeSit.toString()};
    }

    private TryLoadMoreRooms()
    {
        if(this.roomListLoading || !this.roomListHasMore || this.scrollRoom == null)
            return;

        const maxOffsetY = this.scrollRoom.getMaxScrollOffset().y;
        if(maxOffsetY <= 0)
            return;

        const offsetY = Math.max(0,this.scrollRoom.getScrollOffset().y);
        if(offsetY/maxOffsetY >= 0.75)
            this.getAllRooms(Number(this.scrollRoom.nCurPage)+1);
    }

    private FinishRoomListRequest()
    {
        this.unschedule(this.roomListRequestTimeoutHandler);
        this.roomListLoading = false;
        this.roomListRequestPage = -1;
        this.roomListRequestFilterKey = "";
    }

    private RequestLatestRoomFilterIfNeeded()
    {
        if(!this.roomListPendingRefresh)
            return;
        this.roomListPendingRefresh = false;
        this.scheduleOnce(()=>this.getAllRooms(0,true));
    }

    /** 游戏规则创建/删除后延迟刷新房间列表，避开服务端建房/关房推送。 */
    public OnRefreshClubRoomList(delay:number = 1.5)
    {
        const seconds = Math.max(0, Number(delay) || 0);
        if(this.roomListRuleRefreshScheduled)
            this.unschedule(this.roomListRuleRefreshHandler);
        this.roomListRuleRefreshScheduled = true;
        this.scheduleOnce(this.roomListRuleRefreshHandler, seconds);
    }

    // 获取房间列表。请求串行化，避免滚动和快速切换分类产生重复页或串包。
    getAllRooms(nPage:number = 0,_bFouce:boolean = false)
    {
        const filter = this.GetRoomListFilter();
        if(filter.key !== this.roomListDesiredFilterKey)
            this.ClearClubRooms();
        this.roomListDesiredFilterKey = filter.key;
        if(!filter.clubId)
        {
            this.roomListPendingRefresh = false;
            this.roomListHasMore = false;
            return;
        }

        if(this.roomListLoading)
        {
            // 强制刷新（例如创建/删除玩法后的延迟刷新）不能被在途请求吞掉。
            if(_bFouce || filter.key !== this.roomListRequestFilterKey)
                this.roomListPendingRefresh = true;
            else
                this.roomListPendingRefresh = false;
            return;
        }

        if(nPage > 0)
        {
            if(!this.roomListHasMore)
                return;
            if(filter.key !== this.roomListAppliedFilterKey)
            {
                nPage = 0;
            }
            else if(nPage !== Number(this.scrollRoom.nCurPage)+1)
            {
                return;
            }
        }

        this.strPreRoomParam = this.strCurRoomParam;
        this.strCurRoomParam = filter.key;
        this.roomListLoading = true;
        this.roomListRequestPage = nPage;
        this.roomListRequestFilterKey = filter.key;
        if(nPage === 0)
            this.roomListHasMore = true;

        this.unschedule(this.roomListRequestTimeoutHandler);
        this.scheduleOnce(this.roomListRequestTimeoutHandler,8);

        const requestData = {
            header:"查询_俱乐部_房间_信息",
            club_id:filter.clubId,
            is_zip_result:"1",
            page:nPage.toString(),
            count:this.ROOM_PAGE_COUNT.toString(),
            fillter_01:filter.roomType,
            is_have_site:filter.haveFreeSit.toString(),
            fillter_02:"",
            is_no_running:"0"
        };
        GameDataManager.getAccount().reqHallCommand(JSON.stringify(requestData), "P@查询_俱乐部_房间_信息");
    }

    // 解析房间列表信息
    OnClubRoomInfo(strMsg:string)
    {
        if(!this.roomListLoading)
            return;
        let msg:any = null;
        try
        {
            msg = JSON.parse(strMsg);
        }
        catch(error)
        {
            Debug.Error("解析OnClubRoomInfo内容失败："+error);
            this.FinishRoomListRequest();
            this.RequestLatestRoomFilterIfNeeded();
            return;
        }

        if(msg == null || !Array.isArray(msg.result))
        {
            Debug.Log("解析OnClubRoomInfo内容失败！");
            this.FinishRoomListRequest();
            this.RequestLatestRoomFilterIfNeeded();
            return;
        }

        const data:any[] = msg.result;
        const nCount = msg.hasOwnProperty("count") ? Math.max(0,Number(msg.count)||0) : 0;
        const requestPage = this.roomListRequestPage;
        const requestFilterKey = this.roomListRequestFilterKey;

        const nCurPage = msg.hasOwnProperty("number") ? Math.max(0,Number(msg.number)||0) : requestPage;

        if(nCurPage !== requestPage)
        {
            Debug.Error("丢弃页码不匹配的房间列表回包，请求页："+requestPage+"，返回页："+nCurPage);
            return;
        }

        this.FinishRoomListRequest();

        // 切换筛选期间返回的旧分类数据不再落到当前列表，随后只请求最新分类。
        if(requestFilterKey !== this.roomListDesiredFilterKey)
        {
            this.RequestLatestRoomFilterIfNeeded();
            return;
        }

        // 校验是否为压缩数组消息，不是则抛弃。
        if(data.length > 0 && strMsg.indexOf("room_id") >= 0)
        {
            Debug.Error("丢弃非压缩房间列表消息");
            this.RequestLatestRoomFilterIfNeeded();
            return;
        }

        const temp:any[] = [];
        for(const room of data)
        {
            if(Array.isArray(room) && room.length >= 9)
                temp.push(room);
            else
                Debug.Error("忽略格式错误的房间列表项");
        }
        this.scrollRoom2 = this.scrollRoom.getComponent(scrollview2);
        this.scrollRoom.nCurPage = nCurPage;
        this.scrollRoom.nCount = nCount;
        this.scrollRoom.nTotlePage = nCount > 0 ? Math.ceil(nCount/this.ROOM_PAGE_COUNT) : 0;

        if(nCurPage === 0)
        {
            this.arrayRoomData = temp;
            this.roomListAppliedFilterKey = requestFilterKey;
            this.scrollRoom2.Init(this.arrayRoomData,true);
        }
        else if(temp.length > 0)
        {
            // 服务端偶发重复页时按房间号覆盖旧数据，不重复追加节点。
            const roomIndex:{[roomID:string]:number} = {};
            for(let index=0;index<this.arrayRoomData.length;index++)
                roomIndex[String(this.arrayRoomData[index][0])] = index;
            for(const room of temp)
            {
                const roomID = String(room[0]);
                if(roomIndex.hasOwnProperty(roomID))
                    this.arrayRoomData[roomIndex[roomID]] = room;
                else
                {
                    roomIndex[roomID] = this.arrayRoomData.length;
                    this.arrayRoomData.push(room);
                }
            }
            this.scrollRoom2.Init(this.arrayRoomData,false);
        }

        if(temp.length === 0)
            this.roomListHasMore = false;
        else if(msg.hasOwnProperty("count"))
            this.roomListHasMore = this.arrayRoomData.length < nCount;
        else
            this.roomListHasMore = temp.length >= this.ROOM_PAGE_COUNT;

        this.RequestLatestRoomFilterIfNeeded();

     //   let cashItem = new Array<cc.Node>();
 

        //刷新界面
        /*
        for(let i=0;i<data.length;i++)
        {
            let objRoom:cc.Node = null;
            let jRoom = data[i];
            let room_id = jRoom.room_id;
            let room_status = jRoom.room_status;

            if(nCurPage == 0) 
            {
                
                
                
                
                
                let test = this.scrollRoom.content.childrenCount;
                if(i>=this.scrollRoom.content.childrenCount)
                {
                    // cc.loader.loadRes("Prefabs/房间对象",(err,obj)=>{
                    //     if(err)
                    //     {
                    //         cc.error(err.message || err);
                    //         return null;
                    //     }
                    //     let node = cc.instantiate(obj);
                    //     node.parent = this.scrollRoom.content;
                    //     this.setRoomItemInfo(node,jRoom,i==0&&nCurPage==0?true:false);
                    // });
                    ObjPoolManager.getInstance().getObj('房间对象',(err,node)=>{
                        if(err)
                        {
                            Debug.Log(err.message);
                            return null;
                        }
                        node.parent = this.scrollRoom.content;
                        this.setRoomItemInfo(node,jRoom,i==0&&nCurPage==0?true:false);
                    });
                }
                else
                {
                    this.setRoomItemInfo(this.scrollRoom.content.children[i],jRoom);
                }
            }
            else
            {
                //节点是否已经存在
                let arrayChild = this.scrollRoom.content.children; 
                for(let item of arrayChild)
                {
                    if(item.name == room_id)
                    {
                        objRoom = item;
                        break;
                    }
                }

                //结束状态的房间需要关闭
                if(room_status === "关闭" && objRoom!= null && cc.isValid(objRoom))
                {
                    //objRoom.destroy();
                    ObjPoolManager.getInstance().returnObj('房间对象',objRoom);
                    continue;
                }

                if(objRoom === null || !cc.isValid(objRoom) || !objRoom.active)
                {
                    // cc.loader.loadRes("Prefabs/房间对象",(err,obj)=>{
                    //     if(err)
                    //     {
                    //         cc.error(err.message || err);
                    //         return null;
                    //     }
                    //     let node = cc.instantiate(obj);
                    //     node.parent = this.scrollRoom.content;
                    //     this.setRoomItemInfo(node,jRoom,i==0&&nCurPage==0?true:false);
                    // });
                    ObjPoolManager.getInstance().getObj('房间对象',(err,node)=>{
                        if(err)
                        {
                            Debug.Log(err.message);
                            return null;
                        }
                        node.parent = this.scrollRoom.content;
                        this.setRoomItemInfo(node,jRoom,i==0&&nCurPage==0?true:false);
                    });
                }
                else
                {
                    this.setRoomItemInfo(objRoom,jRoom);
                }
            }
 
            
        }
       //如果是第一页，则清空
       if(nCurPage === 0)
       {      
           //多余的对象全部删除
           let arrayDel = new Array<cc.Node>();
           for(let i=data.length;i<this.scrollRoom.content.childrenCount;i++)
           {
               arrayDel.push(this.scrollRoom.content.children[i]);
           }
           for(let item of arrayDel)
           {
               //item.destroy();
               ObjPoolManager.getInstance().returnObj('房间对象',item);
           }
       }*/


        //let old = this.scrollRoom.getScrollOffset();

        // this.scheduleOnce(()=>{
           
        //     if((this.scrollRoom.content.height-this.scrollRoom.content.getComponent(cc.Layout).paddingBottom)<=this.scrollRoom.node.height)
        //     {
        //         this.scrollRoom.content.getComponent(cc.Layout).paddingBottom = this.scrollRoom.node.height - (this.scrollRoom.content.height-this.scrollRoom.content.getComponent(cc.Layout).paddingBottom) +100;
               
        //     }
        //     else
        //     {
        //         this.scrollRoom.content.getComponent(cc.Layout).paddingBottom = 100;            }

        // },0.1);
    }
    //设置房间信息
    setRoomItemInfo(node:cc.Node,jRoom:any,bToTop:boolean = false)
    {
        let room_id = jRoom.room_id;
        let creater_guuid = jRoom.creater_guuid;
        let room_status = jRoom.room_status;
        let remark = jRoom.remark;
        let is_sitedowned = jRoom.is_sitedowned;
        let inhold_count = jRoom.inhold_count;
        let play_mode = jRoom.play_mode;

        node.active = true;
        node.name = room_id.toString();
        return;

        let strRoomName = "";
        let strDiPi = "";
        let strMangGuo = "";
        let strDefTime = "";
        let strRule = "";
        let bSpecialMode = false;
        for(let i=0;i<jRoom.special_rule.length;i++)
        {
            let strTemp:string = jRoom.special_rule[i];
            if(strTemp.indexOf("房间名称:")>=0)
            {
                strRoomName = strTemp.replace("房间名称:","");
            }
            if (strTemp.indexOf("芒果") >= 0 && strTemp.indexOf("/") >= 0)
            {
                strMangGuo = strTemp;
            }
            if (strTemp.indexOf("底皮") >= 0)
            {
                strDiPi = strTemp;
            }
            if(strTemp.indexOf("分钟")>=0)
            {
                strDefTime = strTemp;
            }

            if(strTemp.indexOf("地九王")>=0)
            {
                bSpecialMode = true;
            }
        }
        if(strRoomName.indexOf("私密房")<0)
        {
            node.getChildByName("name").getComponent(cc.Label).string = strRoomName;
            node.getChildByName("私密房").active = false;
        }
        else
        {
            node.getChildByName("name").getComponent(cc.Label).string = "";
            node.getChildByName("私密房").active = true;
        }
        node.getChildByName("地九王").active = bSpecialMode;        
        node.getChildByName("底皮").getComponent(cc.Label).string = strDiPi.replace("底皮","");
        node.getChildByName("人数").getComponent(cc.Label).string = (jRoom.player_list.length+inhold_count).toString()+"/"+jRoom.max_number.toString();
        node.getChildByName("时间").getComponent(cc.Label).string = strDefTime;
        node.getChildByName("倒计时").getComponent(cc.Label).string = "剩余 "+remark+"";

        if(is_sitedowned === "True")
        {             
            cc.loader.loadRes("other/状态_参与过",cc.SpriteFrame,(err,obj)=>{
                if(err)
                {
                    cc.error(err.message || err);
                    return null;
                }
                if(cc.isValid(node))
                    node.getChildByName("状态").getComponent(cc.Sprite).spriteFrame = obj;
            });

            //更新背景
            cc.loader.loadRes("other/背景_参与过",cc.SpriteFrame,(err,obj)=>{
                if(err)
                {
                    cc.error(err.message || err);
                    return null;
                }
                if(cc.isValid(node))
                    node.getComponent(cc.Sprite).spriteFrame = obj;
            });
        }
        else
        {
            cc.loader.loadRes("other/状态_"+room_status,cc.SpriteFrame,(err,obj)=>{
                if(err)
                {
                    cc.error(err.message || err);
                    return null;
                }
                if(cc.isValid(node))
                    node.getChildByName("状态").getComponent(cc.Sprite).spriteFrame = obj;
            });     
            
            //更新背景
            cc.loader.loadRes("other/背景_"+room_status,cc.SpriteFrame,(err,obj)=>{
                if(err)
                {
                    cc.error(err.message || err);
                    return null;
                }
                if(cc.isValid(node))
                    node.getComponent(cc.Sprite).spriteFrame = obj;
            }); 
        }

        let btn = node.getComponent(cc.Button);
        
        btn.node.targetOff(this);
        btn.node.on("click",()=>{
            this.onButtonClick(btn);
        },this);
    }

    onEnterRoom(nCode:number,nRoomID:number)
    {
        if(QueueMatchManager.getInstance().isHandlingRoomNavigation())
            return;
        //准备进入游戏
        if(nCode === 0x200) //进入房间成功！
        {
            WebSceneLoader.loadScene("drh8");
        }
        else
        {
            let strMsg = "";
            if (nCode == 0x301)
            {
                strMsg = "进入房间失败!";
            }
            else if (nCode == 0x302)
            {
                strMsg = "房间不存在！";
            }
            else if (nCode == 0x303)
            {
                strMsg = "房间已满！";
            }
            else if (nCode == 0x304)
            {
                strMsg = this.ResolveRoomClub() !== "" ? "俱乐部金币不足！" : "钱不够啦！";
            }
            else if (nCode == 0x305)
            {
                strMsg = "房间已经解散！";
            }
            else if (nCode == 0x306)
            {
                strMsg = "规则不允许相同IP客户端加入游戏！";
            }


            UIManager.getInstance().closePanelByName("panelLoading",ClosePanelMode.Top);
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,strMsg);
        }
    }

    //恢复房间
    onGetReturnedRoom(nCode:number,nRoomID:number)
    {
        UIManager.getInstance().closePanelByName("panelLoading",ClosePanelMode.Top);
        if(nCode === 0x200) //需要恢复房间
        {
            if(!GpsManager.getInstance().IsGpsOpen()&&ConfigManager.getInstance().enalbe_gps=="True")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"未打开GPS不能进入房间！")
                return;
            }
            const account = GameDataManager.getAccount();
            const clubId = resolveRoomClubId(account, "", true);
            account.reqEnterRoom(RoomType.Custom,nRoomID,withRoomClubId("",clubId));
        }
    }
    public createQR(ctx:cc.Graphics,url:string) 
    {
        ctx.clear();
        Debug.Log(url);
		let qrcode:QRCode = new QRCode(-1, QRErrorCorrectLevel.H);
		qrcode.addData(url);
		qrcode.make();

        ctx.fillColor = cc.Color.BLACK;  
        
		//块宽高
		let tileW = ctx.node.width / qrcode.getModuleCount();
		let tileH = ctx.node.height / qrcode.getModuleCount();

		// draw in the Graphics
		for (let row = 0; row < qrcode.getModuleCount(); row++) {
			for (let col = 0; col < qrcode.getModuleCount(); col++) {
				if (qrcode.isDark(row, col)) {
					// ctx.fillColor = cc.Color.BLACK;
					let w = (Math.ceil((col + 1) * tileW) - Math.floor(col * tileW));
					let h = (Math.ceil((row + 1) * tileW) - Math.floor(row * tileW));
					ctx.rect(Math.round(col * tileW)-ctx.node.width/2 , Math.round(row * tileH)-ctx.node.height/2, w, h);
					ctx.fill();
				}
			}
		}
    }
    
    public onExChange(nCode:number)
    {
        // 大厅里同时可能开着「兑换钻石」弹窗，它自己也监听 onExChange。
        // 这里的文案是给「赠送/转账」用的，兑换这笔要让它先说，别抢着弹「交易成功」。
        if(panelExchangeStone.ShouldIgnoreHallExchange())
        {
            // 兑换会消耗群主钻石池，回大厅后立即补查一次；非群主会被 IsClubOwner 拦住。
            this.RequestClubStonePool(this.ResolveRoomClub(),true);
            return;
        }

        let strMsg = "";
        if (nCode == 0x200) //成功
        {
            strMsg = "交易成功！";
            this.GetAllExchangeInfo();
            this.ClearGiftInputs();
        }
        else if (nCode == 0x302)
        {
            strMsg = "余额不足，转账失败！";
        }
        else if (nCode == 0x303)
        {
            strMsg = "用户不存在，转账失败！";
        }
        else if (nCode == 0x304)
        {
            strMsg = "不能给自己转账！";
        }
        else if (nCode == 0x305)
        {
            strMsg = "不能给非关联账户转账！";
        }
        else if (nCode == 0x306)
        {
            strMsg = "房卡不能回转！";

        }
        else if(nCode == 0x307)
        {
            strMsg = "未设置初始密码，请设置后再操作！";
        }
        else if(nCode == 0x308)
        {
            strMsg = "密码错误，请重新输入";
        }
        else
        {
            strMsg = "交易失败！";
        }

        UIManager.getInstance().closePanelByName("panelLoading",ClosePanelMode.Top);
        UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, strMsg);
    }
    public GetAllExchangeInfo(nPage:number = 0)
    {
        const clubId = this.ResolveRoomClub();
        if(clubId !== "")
        {
            this.clubGiftRecordClubId = clubId;
            this.clubGiftRecordPage = nPage;
            const context = "club:gold:add-record:" + clubId + ":" + nPage;
            // 赠送记录改查玩家积分流水（§11.1）：only_add=1 只返回「添加积分」和「积分赠送」，
            // 正好是这一页要看的上下分与赠送；user_id 留空 = 查自己。
            // 同步回包只有空壳，列表由 ClubGoldWater 异步推送。
            this.clubGoldWaterClubId = clubId;
            this.clubGoldWaterRequestContext = context;
            const strParam = JSON.stringify({
                header:"查询_俱乐部_积分流水",
                club_id:clubId,
                user_id:"",
                only_add:1,
                count:this.PAGE_PER_COUNT,
                page:nPage,
                context
            });
            GameDataManager.getAccount().reqHallCommand(strParam,"P@" + context);
            return;
        }

        this.clubGiftRecordClubId = "";
        GameDataManager.getAccount().reqGetExchangeInfo(nPage);
    }
    public OnGetExchangeList(strMsg:string)
    {
        this.scrollExchangeInfo.UpdateList(strMsg,"ExchangeInfo","赠送记录对象",this.PAGE_PER_COUNT,this.setExchangeItemInfo.bind(this));
    }
    /** 俱乐部金币赠送/上下分成功后，成员列表、玩家设置卡和「我的 → 赠送」记录都要刷新。 */
    public OnClubGoldGiftChanged(clubId:string,userId?:string)
    {
        if(String(clubId || "") !== this.ResolveRoomClub())
            return;
        this.GetAllExchangeInfo(0);
        // 赠送扣的是自己的积分，上下分会动自己的额度，顶部与「我的」的金币/额度必须跟着换。
        this.set_gold(0);
        this.RefreshDiscoveryClubFunds(true);
        if(this.clubManagement)
            this.clubManagement.OnPlayerGoldChanged(userId == null ? "" : String(userId));
    }

    /** 兼容列表直返、result 包装和同名对象包装。 */
    private NormalizeClubGiftRecordList(strMsg:string):string
    {
        if(strMsg == null || strMsg === "")
            return null;
        let data:any = null;
        try { data = JSON.parse(strMsg); }
        catch(error) { return null; }
        if(data == null)
            return null;

        const listKeys:string[] = [
            "ClubGoldAddRecord", "ClubGoldAddRecordList", "ListClubGoldAddRecord", "AddMemberGoldList",
            "ClubGoldAddInfo", "ClubGoldAddList", "records", "list", "result"
        ];
        const find = (value:any,depth:number):any => {
            if(value == null || depth > 4)
                return null;
            if(Array.isArray(value))
                return {rows:value,owner:null};
            if(typeof value !== "object")
                return null;
            for(const key of listKeys)
            {
                const child = value[key];
                if(Array.isArray(child))
                    return {rows:child,owner:value};
            }
            for(const key of ["ClubGoldAddRecord","ClubGoldAddRecordList","ListClubGoldAddRecord","AddMemberGoldList","result","data","payload"])
            {
                const child = value[key];
                if(child && typeof child === "object")
                {
                    const found = find(child,depth + 1);
                    if(found)
                        return found;
                }
            }
            return null;
        };

        const found = find(data,0);
        if(!found || !Array.isArray(found.rows))
            return null;
        const owner:any = found.owner || data;
        const result:any = {ClubGoldAddRecord:found.rows};
        for(const key of ["number","count","pageIndex","pageNum","rowsTotal","context","club_id"])
        {
            if(data[key] != null) result[key] = data[key];
            else if(owner[key] != null) result[key] = owner[key];
        }
        return JSON.stringify(result);
    }

    public OnClubGiftRecordList(strMsg:string)
    {
        if(this.scrollExchangeInfo == null || this.clubGiftRecordClubId === "")
            return;
        const normalized = this.NormalizeClubGiftRecordList(strMsg);
        if(normalized == null)
            return;
        try
        {
            const payload:any = JSON.parse(normalized);
            const payloadClubId = payload && payload.club_id != null ? String(payload.club_id) : "";
            if(payloadClubId !== "" && payloadClubId !== this.clubGiftRecordClubId)
                return;
        }
        catch(error) { return; }
        this.scrollExchangeInfo.UpdateList(normalized,"ClubGoldAddRecord","赠送记录对象",
            this.PAGE_PER_COUNT,this.setClubGiftRecordItemInfo.bind(this));
    }

    private ReadClubGiftRecordValue(item:any,keys:string[],fallback:any = ""):any
    {
        if(item == null)
            return fallback;
        for(const key of keys)
        {
            if(item[key] != null && String(item[key]) !== "")
                return item[key];
        }
        return fallback;
    }

    /** 「我的 → 赠送」的历史记录行。数据源有两套：积分流水（ClubGoldWater，无对方 ID）和旧的添加记录（AddMemberGoldList）。 */
    public setClubGiftRecordItemInfo(node:cc.Node,objOne:any)
    {
        node.active = true;
        // 旧记录用 guuid/name 指向被操作的人；积分流水只有操作人 opter_name，没有对方 ID。
        const targetId = String(this.ReadClubGiftRecordValue(objOne,
            ["target_guuid","target_user_id","to_user_id","member_guuid","member_id","user_id","guuid","user_guuid"],""));
        const targetName = String(this.ReadClubGiftRecordValue(objOne,
            ["target_name","target_user_name","to_user_name","member_name","user_name","name"],""));
        const opterName = String(this.ReadClubGiftRecordValue(objOne,
            ["opter_name","operator_name","op_name","oper_name"],"")).trim();
        const amount = this.ReadClubGiftRecordValue(objOne,
            ["user_add_gold","add_gold","add_gold_num","change_gold","amount","money_value","money","gold","club_gold","score"],"");
        let strDate = String(this.ReadClubGiftRecordValue(objOne,
            ["date","time","create_time","created_at","op_time"],"")).replace("T"," ").replace(/\r?\n/g," ");
        const dateMatch = strDate.match(/^\d{4}[-\/]([0-9]{1,2})[-\/]([0-9]{1,2})\s+([0-9]{1,2}):([0-9]{2})/);
        if(dateMatch)
        {
            const month = dateMatch[1].length === 1 ? "0" + dateMatch[1] : dateMatch[1];
            const day = dateMatch[2].length === 1 ? "0" + dateMatch[2] : dateMatch[2];
            const hour = dateMatch[3].length === 1 ? "0" + dateMatch[3] : dateMatch[3];
            strDate = month + "/" + day + " " + hour + ":" + dateMatch[4];
        }
        else
        {
            strDate = strDate.replace(/^\d{4}[-\/]/,"").replace(/:[0-9]{2}(\.[0-9]+)?$/,"");
        }
        // type 列只有两个字宽：积分流水的「添加积分 / 积分赠送 / 积分受赠」要缩成短标签，
        // 旧添加记录原样给的是「添加 / 赠送」。都没有时按金额正负兜底。
        const rawType = String(this.ReadClubGiftRecordValue(objOne,["type","record_type"],""));
        // 服务端偶有千分位，去掉逗号再解析，否则金额会被当成 0 而丢掉正负判断。
        const amountNumber = Number(String(amount).replace(/,/g,""));
        const isMinus = isFinite(amountNumber) && amountNumber < 0;
        let typeText = rawType;
        if(typeText === "添加积分")
            typeText = "添加";
        else if(typeText === "积分赠送")
            typeText = "赠送";
        else if(typeText === "积分受赠")
            typeText = "收到";
        else if(typeText === "修改积分")
            typeText = "修改";
        if(typeText === "")
            typeText = isMinus ? "扣除" : "赠送";
        node.getChildByName("type").getComponent(cc.Label).string = typeText;

        const hasTarget = targetId !== "" || targetName !== "";
        node.getChildByName("id").getComponent(cc.Label).string = hasTarget
            ? targetName + "\r\nID:" + targetId
            : (opterName !== "" ? opterName : "—");
        // 金额保留原符号：负数是扣减（下分/送出），正数补「+」与其它记录页一致。
        const countNode = node.getChildByName("count");
        const hasAmount = isFinite(amountNumber) && String(amount) !== "";
        countNode.getComponent(cc.Label).string = hasAmount
            ? (amountNumber > 0 ? "+" + String(amount) : String(amount))
            : String(amount);
        // 客户口径（2026-11-07 测试反馈）：红色 = 加分，绿色 = 减分。
        if(hasAmount && amountNumber > 0)
            countNode.color = new cc.Color(255,65,52,255);
        else if(hasAmount && amountNumber < 0)
            countNode.color = new cc.Color(167,231,29,255);
        else
            countNode.color = new cc.Color(239,225,194,255);
        node.getChildByName("time").getComponent(cc.Label).string = strDate;

        const avatarRoot = node.getChildByName("头像");
        const avatarMask = avatarRoot ? avatarRoot.getChildByName("mask") : null;
        const avatarNode = avatarMask ? avatarMask.getChildByName("img") : null;
        const avatar = avatarNode ? avatarNode.getComponent(cc.Sprite) : null;
        if(avatar)
        {
            // 流水没有对方 ID，不能按名字取头像；清空，避免复用行残留上一条的头像。
            if(!hasTarget)
                avatar.spriteFrame = null;
            else if(!ImageManager.getInstance().GetImageByName(targetId,"",avatar))
                ImageManager.getInstance().AddWaitFreshImage2Catch(targetId,avatar);
        }
    }
    public setExchangeItemInfo(node:cc.Node,objOne:any)
    {
        node.active = true;

        let strTarID = objOne["target_guuid"];
        let strTarName = objOne["target_name"];
        let strSrcID = objOne["user_guuid"];
        let strSrcName = objOne["user_name"];

        // 确认稿的时间为单行“月/日 时:分”，不能沿用旧版两行日期。
        let strDate:string = String(objOne["date"] || "").replace("T"," ").replace(/\r?\n/g," ");
        let dateMatch = strDate.match(/^\d{4}[-\/]([0-9]{1,2})[-\/]([0-9]{1,2})\s+([0-9]{1,2}):([0-9]{2})/);
        if(dateMatch)
        {
            let month = dateMatch[1].length == 1 ? "0"+dateMatch[1] : dateMatch[1];
            let day = dateMatch[2].length == 1 ? "0"+dateMatch[2] : dateMatch[2];
            let hour = dateMatch[3].length == 1 ? "0"+dateMatch[3] : dateMatch[3];
            strDate = month+"/"+day+" "+hour+":"+dateMatch[4];
        }
        else
        {
            strDate = strDate.replace(/^\d{4}[-\/]/,"").replace(/:[0-9]{2}(\.[0-9]+)?$/,"");
        }
        let strStoneNum = objOne["stone_number"];

        //判断是转入还是转出
        let strUserID = GameDataManager.getAccount().guuid;
        let strDisplayID = strTarID;
        let strDisplayName = strTarName;

        if (strUserID == strSrcID) //转出
        {
            node.getChildByName("type").getComponent(cc.Label).string = "赠送";
        }
        else
        {
            strDisplayID = strSrcID;
            strDisplayName = strSrcName;
            node.getChildByName("type").getComponent(cc.Label).string = "收到";
        }
        node.getChildByName("id").getComponent(cc.Label).string = strDisplayName+"\r\nID:"+strDisplayID;
        node.getChildByName("count").getComponent(cc.Label).string = strStoneNum;
        node.getChildByName("time").getComponent(cc.Label).string = strDate;

        // 头像使用项目既有缓存/下载链路；圆形遮罩和金色外环已预制在行 Prefab。
        let avatarRoot = node.getChildByName("头像");
        let avatarMask = avatarRoot ? avatarRoot.getChildByName("mask") : null;
        let avatarNode = avatarMask ? avatarMask.getChildByName("img") : null;
        let avatar = avatarNode ? avatarNode.getComponent(cc.Sprite) : null;
        if(avatar && !ImageManager.getInstance().GetImageByName(strDisplayID,"",avatar))
        {
            ImageManager.getInstance().AddWaitFreshImage2Catch(strDisplayID,avatar);
        }
    }
    
    private GetMyClubIds():string[]
    {
        const account = GameDataManager.getAccount();
        const result:string[] = [];
        if(account == null)
            return result;
        for(const value of [account.club_make,account.club_join,account.club_join2,account.club_manage])
        {
            for(const raw of String(value || "").split(","))
            {
                const id = raw.trim();
                if(/^\d{6}$/.test(id) && result.indexOf(id) < 0)
                    result.push(id);
            }
        }
        return result;
    }

    /** 是否是代理：既不是创建者也不是管理员，且服务端 is_agent=1（代理必须由老板/上级设置）。 */
    private IsClubAgentIn(clubId:string):boolean
    {
        const account = GameDataManager.getAccount();
        if(account == null || !clubId)
            return false;
        const listOf = (value:any)=>String(value || "").split(",").map(id=>id.trim());
        if(listOf(account.club_make).indexOf(clubId) >= 0 || listOf(account.club_manage).indexOf(clubId) >= 0)
            return false;
        return this.IsClubAgent(this.clubAgentInfo[clubId]);
    }

    private GetClubAgentIds():string[]
    {
        return this.GetMyClubIds().filter(id=>this.IsClubAgentIn(id));
    }

    private IsClubAgent(info:any):boolean
    {
        if(!info)
            return false;
        // 创建者按「老板」显示，不算代理。
        if(Number(info.is_creator) === 1)
            return false;
        // 服务端实际会返回 is_agent（文档未记录）：普通成员 is_agent=0，但**身上照样带一个邀请码**，
        // 所以「有码」不能当判据，必须只认这个字段。
        if(info.is_agent != null)
            return Number(info.is_agent) === 1;
        if(info.is_proxy != null)
            return Number(info.is_proxy) === 1;
        // 老口径（服务端不返回 is_agent 时）：文档 §2.1 普通成员 invite_code 为空串。
        const code = info.invite_code == null ? "" : String(info.invite_code).trim();
        return code !== "";
    }

    /** 俱乐部代理接口只返回当前玩家自己的邀请码，列表不得展示下级邀请码。 */
    public OnClubAgentInfo(raw:any, secondaryRaw?:any, fromPush:boolean = true)
    {
        // 兼容事件总线可能携带的 (code, payload) 形式；正式路由通常只传 payload。
        if(secondaryRaw !== undefined && (typeof raw === "number" || typeof raw === "boolean"))
            raw = secondaryRaw;
        let data:any = raw;
        if(typeof data === "string")
        {
            try { data = JSON.parse(data); }
            catch(error) { return; }
        }
        if(data && data.result && !data.club_id)
            data = data.result;
        if(data && Array.isArray(data.result) && !data.club_id)
            data = data.result.length > 0 ? data.result[0] : null;
        if(!data || !data.club_id)
            return;
        // 只接受「本人」的代理信息：服务端若把上级/创建者的记录当成本人的回包，
        // 这条会把人误显示成代理（列表右下角）。
        const selfGuuid = GameDataManager.getAccount() == null ? "" : String(GameDataManager.getAccount().guuid || "");
        if(selfGuuid && data.user_id && String(data.user_id) !== selfGuuid)
            return;
        const clubId = String(data.club_id);
        this.clubAgentInfo[clubId] = data;
        // 本地还没选中任何俱乐部时（刚入会/刚登录），直接选中推送的这家，
        // 否则「我的」卡片会停在「暂无俱乐部」上，看着像没刷新。
        if(!this.ResolveRoomClub() && this.GetMyClubIds().indexOf(clubId) >= 0)
        {
            this.selectedRoomClubId = clubId;
            const current = GameDataManager.getAccount();
            if(current && current.guuid)
                cc.sys.localStorage.setItem("lastRoomClub:" + current.guuid,clubId);
        }
        // 上级把我设为代理后，服务端推来的这条快照可能还是设置前的（is_agent=0、
        // percent=0、invite_code 为空）。此时必须先刷新一次保证俱乐部列表和
        // 「我的」当前俱乐部卡片跟上推送，再补查一次拿真正生效后的状态。
        // requestDetails=true 只在本地没有缓存时才发查询，不会重复拉已有数据。
        this.RefreshClubList(true);
        this.RefreshDiscoveryClubFunds(true);
        if(this.clubManagement) this.clubManagement.Refresh();
        if(this.clubManagementApi) this.clubManagementApi.RefreshBadges();
        // 推广页开着的场合（大厅「我的」里点进去），邀请码这行要跟着刷新。
        this.RefreshPromotionInviteCode();
        if(Number(data.is_creator) === 1)
        {
            this.RequestClubStonePool(clubId);
            if(this.currentMainTab === "我的")
            {
                this.unschedule(this.clubStonePoolPoll);
                this.schedule(this.clubStonePoolPoll,30);
            }
        }
        if(!fromPush || Number(data.is_agent) === 1 || Number(data.is_creator) === 1)
            return;
        const now = Date.now();
        if(now - (this.clubAgentRecheck[clubId] || 0) < 10000)
            return;
        this.clubAgentRecheck[clubId] = now;
        if(!GameDataManager.getAccount())
            return;
        // 服务端推送常带设置前的快照，补查两次给「生效后」的数据留出落库和推送的时间。
        this.RecheckClubAgent(clubId,0.5);
        this.RecheckClubAgent(clubId,2);
    }

    private RecheckClubAgent(clubId:string,delay:number):void
    {
        this.scheduleOnce(()=>{
            const account = GameDataManager.getAccount();
            if(!cc.isValid(this.node) || !account)
                return;
            account.reqHallCommand(
                JSON.stringify({header:"查询_俱乐部_代理_信息",club_id:clubId}),"p@club:agent:" + clubId);
        },delay);
    }

    /** 登录进大厅默认分页：没有任何俱乐部时直接进俱乐部页（等价点击底栏「俱乐部」）。 */
    private ResolveLobbyEntryTab():boolean
    {
        if(this.lobbyEntryResolved)
            return true;
        const account = GameDataManager.getAccount();
        if(account == null)
            return false;
        // 账号实体已到但俱乐部属性还没下发时先不下结论，等 set_club_join/make/manage 推送。
        if(account.club_make === undefined && account.club_join === undefined && account.club_manage === undefined)
            return false;
        this.lobbyEntryResolved = true;
        // 只判断「有没有俱乐部关系」，不按 6 位 ID 格式过滤，避免位数不同的老数据被误判成无俱乐部。
        const hasClub = [account.club_make,account.club_join,account.club_manage].some(value=>
            String(value == null ? "" : value).split(",").some(id=>id.trim() !== ""));
        this.switchTabSel(hasClub ? "发现" : "俱乐部");
        if(!hasClub)
            this.RefreshClubList();
        return true;
    }

    public OnClubMembershipChanged()
    {
        this.clubAgentInfo = {};
        this.clubAgentRecheck = {};
        this.clubInfoAsked = {};
        this.clubUnionStatus = {};
        this.clubUnionAsked = {};
        this.clubUnionPendingClubId = "";
        this.clubUnionNames = {};
        this.clubUnionNameAsked = {};
        this.clubUnionNamePendingClubId = "";
        this.unionCreateName = "";
        this.clubStonePools = {};
        this.clubStonePoolAsked = {};
        this.clubStonePoolRequestClubId = "";
        if(!this.lobbyEntryResolved)
            this.ResolveLobbyEntryTab();
        // 刚创建 / 刚入会的俱乐部在这里落成默认俱乐部，后面的卡片、列表、房间筛选都取新值。
        this.ApplyPendingDefaultClub();
        this.RefreshClubFinanceMenuVisibility();
        this.RefreshDiscoveryClubFunds(true);
        if(this.clubManagement) this.clubManagement.Refresh();
        if(this.clubManagementApi) this.clubManagementApi.RefreshBadges();
        const page = Tool.GetChild(this.node,"Main/俱乐部");
        if(page && page.active)
            this.RefreshClubList();
        if(this.scrollRoom && this.GetRoomListFilter().key !== this.roomListDesiredFilterKey)
            this.getAllRooms(0,true);
        this.RequestClubUnionStatus(this.ResolveRoomClub(),false);
    }

    public OnClubGoldChanged()
    {
        // 俱乐部积分变化要同步「我的」和资金明细顶部，否则玩家看到的是旧余额。
        this.set_gold(0);
        this.RefreshDiscoveryClubFunds(false);
        const page = Tool.GetChild(this.node,"Main/俱乐部");
        if(page && page.active)
            this.RefreshClubList(false);
    }

    /** 查询当前俱乐部是否已有 V2 联盟；只有俱乐部创建者需要这个状态。 */
    private RequestClubUnionStatus(clubId:string,force:boolean = false):void
    {
        if(!clubId || !this.IsClubCreator(clubId))
            return;
        const account:any = GameDataManager.getAccount();
        if(!account || !account.guuid)
            return;
        const now = Date.now();
        if(!force && now - (this.clubUnionAsked[clubId] || 0) < 5000)
            return;
        if(force && now - (this.clubUnionAsked[clubId] || 0) < 1000)
            return;
        this.clubUnionAsked[clubId] = now;
        this.clubUnionPendingClubId = clubId;
        account.reqHallCommand(JSON.stringify({
            header:"查询_联盟_额度",context:"club:union:status:" + clubId
        }),"p@club:union:status:" + clubId);
    }

    /** ClubUnionQuota 没有固定携带 club_id，优先使用请求 context 绑定当前俱乐部。 */
    public OnClubUnionQuota(raw:any,secondaryRaw?:any):void
    {
        if(secondaryRaw !== undefined && (typeof raw === "number" || typeof raw === "boolean"))
            raw = secondaryRaw;
        let data:any = raw;
        if(typeof data === "string")
        {
            try { data = JSON.parse(data); }
            catch(error) { return; }
        }
        if(!data || typeof data !== "object")
            return;
        let body:any = data.ClubUnionQuota;
        if(!body && data.result !== undefined)
        {
            let result:any = data.result;
            if(typeof result === "string")
            {
                try { result = JSON.parse(result); }
                catch(error) { result = null; }
            }
            if(result && typeof result === "object")
                body = result.ClubUnionQuota || result;
        }
        if(!body)
            body = data;
        if(typeof body === "string")
        {
            try { body = JSON.parse(body); }
            catch(error) { return; }
        }
        const context = String(data.context || (body && body.context) || "");
        const match = context.match(/(?:^|:)union:(?:status|quota):([0-9]+)$/);
        const clubId = String(body.club_id || data.club_id ||
            (match ? match[1] : (this.clubUnionPendingClubId || this.ResolveRoomClub())));
        if(!clubId)
            return;
        const pushUnionId = String(body.union_id || data.union_id || "").trim();
        const previous = this.clubUnionStatus[clubId];
        const infoUnionId = String((this.clubDetails[clubId] && this.clubDetails[clubId].union_id) || "").trim();
        const previousUnionId = previous && previous.hasUnion ? String(previous.unionId || "").trim() : "";
        // 推送里缺 union_id 时不能用空串覆盖：按「本次推送 → 俱乐部信息 → 上次确认」取第一个非空值。
        const unionId = pushUnionId || infoUnionId || previousUnionId;
        const bodyName = String(body.union_name || body.unionName || data.union_name || "").trim();
        const cachedName = unionId ? this.CachedUnionName(unionId) : "";
        const unionName = bodyName || cachedName;
        // union_quota 单位分：总群主是联盟池，盟主是自己俱乐部额度。
        const quotaRaw = body.union_quota !== undefined ? body.union_quota : data.union_quota;
        const quotaNumber = Number(quotaRaw);
        const quotaKnown = quotaRaw !== undefined && quotaRaw !== null && String(quotaRaw).trim() !== "" &&
            Number.isFinite(quotaNumber);
        // is_owner=1 才是联盟总群主；部分 ClubUnionQuota 推送不带该字段（例如额度刷新），
        // 缺席时要沿用上一次结论，不能把已确认的总群主改回 false。
        const ownerValue = body.is_owner !== undefined ? body.is_owner : data.is_owner;
        const ownerKnown = ownerValue !== undefined && ownerValue !== null && String(ownerValue).trim() !== "";
        const ownerFlag = ownerValue === 1 || ownerValue === "1" ||
            ownerValue === true || String(ownerValue).toLowerCase() === "true";
        const reuseOwner = previous && (previous.unionId === unionId ||
            (!previous.unionId && previous.isOwner === true));
        // 创建/查询_我的_联盟 已确认的 owner 是账号级事实，不能被后续单俱乐部 is_owner=0 覆盖。
        const ownerConfirmed = !!(previous && previous.ownerConfirmed &&
            (!previous.unionId || previous.unionId === unionId));
        const isOwner = unionId === "" ? false : ownerConfirmed ? true : ownerKnown ? ownerFlag :
            (reuseOwner ? previous.isOwner : undefined);
        const quotaFen = quotaKnown ? quotaNumber :
            (previous && previous.unionId === unionId ? previous.quotaFen : undefined);
        // union_percent 只对 is_owner=0 的盟主有意义（100=不抽）；总群主没有这一层比例。
        const percentRaw = body.union_percent !== undefined ? body.union_percent : data.union_percent;
        const percentNumber = Number(percentRaw);
        const percentKnown = percentRaw !== undefined && percentRaw !== null &&
            String(percentRaw).trim() !== "" && Number.isFinite(percentNumber);
        const unionPercent = isOwner === false ?
            (percentKnown ? percentNumber :
                (previous && previous.isOwner === false && previous.unionId === unionId ? previous.unionPercent : undefined)) :
            undefined;
        this.clubUnionStatus[clubId] = {known:true,hasUnion:unionId !== "",unionId:unionId || undefined,
            unionName:unionName || undefined,isOwner,ownerConfirmed:ownerConfirmed || undefined,quotaFen,unionPercent};
        if(unionName) this.RememberUnionName(unionId,unionName);
        const info = this.clubDetails[clubId];
        if(info)
        {
            if(unionId)
            {
                info.union_id = unionId;
                if(unionName) info.union_name = unionName;
                // is_owner=0 的 union_quota 是本俱乐部额度；is_owner=1 是联盟池，不能写进俱乐部额度。
                if(isOwner === false && quotaKnown) info.union_quota = quotaFen;
            }
            else
            {
                info.union_id = "";
                delete info.union_name;
                delete info.union_quota;
            }
        }
        // 名称已知但 is_owner 缺失时也要探一次「我的联盟」：该命令只有总群主能成功，
        // 用它兜底确认「大盟主」，避免按钮因为额度推送缺字段而一直收起。
        if(unionId)
            this.RequestClubUnionName(clubId);
        if(this.clubManagement)
        {
            this.clubManagement.Refresh();
            // 盟友弹窗按俱乐部展示额度，额度推送只带池/本俱乐部数值，需重拉「我的联盟」。
            this.clubManagement.OnUnionQuotaPushed();
        }
        // 发现页顶部「额度」也依赖这次推送；不刷新的话要切一次俱乐部页再回来才显示。
        this.RefreshDiscoveryClubFunds(false);
        this.RefreshClubList(false);
    }

    /** 联盟名缓存：内存 + localStorage，重启后仍能显示名称而不是退化成联盟号。 */
    private CachedUnionName(unionId:string):string
    {
        if(!unionId) return "";
        const memory = this.clubUnionNames[unionId];
        if(memory) return memory;
        const stored = cc.sys.localStorage.getItem("unionName:" + unionId);
        if(stored) { this.clubUnionNames[unionId] = stored; return stored; }
        return "";
    }
    private RememberUnionName(unionId:string,name:string):void
    {
        const text = String(name || "").trim();
        if(!unionId || !text) return;
        this.clubUnionNames[unionId] = text;
        cc.sys.localStorage.setItem("unionName:" + unionId,text);
    }

    private ResolveClubUnionId(clubId:string):string
    {
        // 新文档：俱乐部信息里的 union_id 是权威归属；状态缓存只是补充。
        const info = this.clubDetails[clubId];
        const infoUnionId = String(info && info.union_id || "").trim();
        if(infoUnionId) return infoUnionId;
        const status = this.clubUnionStatus[clubId];
        return status && status.known && status.hasUnion ? String(status.unionId || "").trim() : "";
    }

    /** 联盟号已知但名称或总群主身份缺失时补查「我的联盟」；盟主无权限时静默退化为只显示联盟号。 */
    private RequestClubUnionName(clubId:string,force:boolean = false):void
    {
        if(!clubId || !this.IsClubCreator(clubId))
            return;
        const unionId = this.ResolveClubUnionId(clubId);
        const status = this.clubUnionStatus[clubId];
        // isOwner=false 也可能是额度推送缺字段造成的旧结论，仍要探一次才能纠正。
        const needOwner = !status || status.isOwner !== true;
        // 只缺名称或只缺总群主身份都要探一次；两者都已知才跳过。
        if(!unionId || (this.CachedUnionName(unionId) && !needOwner))
            return;
        const now = Date.now();
        const asked = this.clubUnionNameAsked[clubId] || 0;
        // 失败后 asked 会被写成未来时间，作为冷却；成功前 10 秒内不重复查。
        // 进「我的」时 force=true，绕过早先失败留下的长冷却，保证总群主能重新确认。
        if(!force && (now < asked || now - asked < 10000))
            return;
        const account:any = GameDataManager.getAccount();
        if(!account || !account.guuid)
            return;
        this.clubUnionNameAsked[clubId] = now;
        this.clubUnionNamePendingClubId = clubId;
        account.reqHallCommand(JSON.stringify({
            header:"查询_我的_联盟",context:"club:union:name:" + clubId
        }),"p@club:union:name:" + clubId);
    }

    /** ClubMyUnion 同时带回联盟名称和成员俱乐部，可补齐列表卡片上其他俱乐部的联盟归属。 */
    public OnClubMyUnion(raw:any,secondaryRaw?:any):void
    {
        if(secondaryRaw !== undefined && (typeof raw === "number" || typeof raw === "boolean"))
            raw = secondaryRaw;
        let data:any = raw;
        if(typeof data === "string")
        {
            try { data = JSON.parse(data); }
            catch(error) { return; }
        }
        if(!data || typeof data !== "object")
            return;
        let body:any = data.ClubMyUnion;
        if(!body && data.result !== undefined)
        {
            let result:any = data.result;
            if(typeof result === "string")
            {
                try { result = JSON.parse(result); }
                catch(error) { result = null; }
            }
            if(result && typeof result === "object")
                body = result.ClubMyUnion || result;
        }
        if(!body) body = data;
        if(typeof body === "string")
        {
            try { body = JSON.parse(body); }
            catch(error) { return; }
        }
        if(!body || typeof body !== "object")
            return;
        // 有的 ClubMyUnion 推送只带 union_name/members，不带 union_id；用请求 context 或待查询俱乐部反推。
        const context = String(data.context || (body && body.context) || "");
        const nameMatch = context.match(/(?:^|:)union:name:([0-9]+)$/);
        const pendingClub = nameMatch ? nameMatch[1] : this.clubUnionNamePendingClubId;
        let unionId = String(body.union_id || body.unionId || "").trim();
        if(!unionId && pendingClub)
            unionId = this.ResolveClubUnionId(pendingClub);
        if(!unionId)
            return;
        const unionName = String(body.union_name || body.unionName || "").trim();
        const poolRaw = body.union_quota !== undefined ? body.union_quota : body.unionQuota;
        const poolNumber = Number(poolRaw);
        const poolKnown = poolRaw !== undefined && poolRaw !== null && String(poolRaw).trim() !== "" &&
            Number.isFinite(poolNumber);
        if(unionName)
            this.RememberUnionName(unionId,unionName);
        for(const id in this.clubUnionStatus)
        {
            const status = this.clubUnionStatus[id];
            if(status && status.unionId === unionId && unionName)
                status.unionName = unionName;
        }
        for(const id in this.clubDetails)
        {
            const info = this.clubDetails[id];
            if(!info || String(info.union_id || "").trim() !== unionId)
                continue;
            if(unionName && !info.union_name)
                info.union_name = unionName;
        }
        // members 里的俱乐部属于同一联盟；即使当前玩家只加入了其中几家，也能拿到名字和归属。
        const members:any[] = Array.isArray(body.members) ? body.members : [];
        for(const member of members)
        {
            const id = String(member && (member.club_id || member.clubId) || "").trim();
            if(!id)
                continue;
            if(!this.clubDetails[id])
                this.clubDetails[id] = {club_id:id,club_name:member.club_name || member.clubName || ""};
            const info = this.clubDetails[id];
            info.union_id = unionId;
            if(unionName)
                info.union_name = info.union_name || unionName;
            const memberQuotaRaw = member.union_quota;
            const memberQuota = Number(memberQuotaRaw);
            if(memberQuotaRaw !== undefined && memberQuotaRaw !== null && String(memberQuotaRaw).trim() !== "" &&
                Number.isFinite(memberQuota))
                info.union_quota = memberQuota;
            const status = this.clubUnionStatus[id];
            if(status && status.known)
            {
                status.hasUnion = true;
                status.unionId = unionId;
                if(unionName)
                    status.unionName = unionName;
            }
        }
        // 总群主的卡片额度来自联盟池；ClubMyUnion 的 union_quota 就是池余额，拿到就同步到当前总群主俱乐部。
        const currentClubId = this.ResolveRoomClub();
        const currentStatus = currentClubId ? this.clubUnionStatus[currentClubId] : null;
        if(currentStatus && currentStatus.unionId === unionId && currentStatus.isOwner === true && poolKnown)
            currentStatus.quotaFen = poolNumber;
        const pending = pendingClub;
        this.clubUnionNamePendingClubId = "";
        if(pending)
        {
            this.clubUnionNameAsked[pending] = Date.now();
            // 查询_我的_联盟 成功本身就证明调用者是总群主；只有目标俱乐部确实属于这个联盟时
            // 才落到它头上，避免多俱乐部账号串到别家联盟。
            const pendingUnionId = this.ResolveClubUnionId(pending);
            if(!pendingUnionId || pendingUnionId === unionId)
            {
                const status = this.clubUnionStatus[pending];
                if(status)
                {
                    status.known = true;
                    status.hasUnion = true;
                    status.unionId = unionId;
                    status.isOwner = true;
                    status.ownerConfirmed = true;
                    if(unionName) status.unionName = unionName;
                    if(poolKnown) status.quotaFen = poolNumber;
                }
                else this.clubUnionStatus[pending] = {known:true,hasUnion:true,unionId:unionId,
                    unionName:unionName || undefined,isOwner:true,ownerConfirmed:true,
                    quotaFen:poolKnown ? poolNumber : undefined};
                const info = this.clubDetails[pending];
                if(info)
                {
                    info.union_id = unionId;
                    if(unionName) info.union_name = unionName;
                }
            }
        }
        if(this.clubManagement) this.clubManagement.Refresh();
        this.RefreshDiscoveryClubFunds(false);
        this.RefreshClubList(false);
    }

    /** 创建联盟完成后由 ClubUnionCreate 推送联盟号；状态先落本地，按钮立即隐藏。 */
    public OnClubUnionCreate(raw:any,secondaryRaw?:any):void
    {
        if(secondaryRaw !== undefined && (typeof raw === "number" || typeof raw === "boolean"))
            raw = secondaryRaw;
        let data:any = raw;
        if(typeof data === "string")
        {
            try { data = JSON.parse(data); }
            catch(error) { return; }
        }
        if(!data || typeof data !== "object")
            return;
        let body:any = data.ClubUnionCreate;
        if(!body && data.result !== undefined)
        {
            let result:any = data.result;
            if(typeof result === "string")
            {
                try { result = JSON.parse(result); }
                catch(error) { result = null; }
            }
            if(result && typeof result === "object")
                body = result.ClubUnionCreate || result;
        }
        if(!body) body = data;
        const context = String(data.context || (body && body.context) || "");
        const match = context.match(/(?:^|:)union:create:([0-9]+)$/);
        const clubId = String((match && match[1]) || this.unionCreateClubId || this.ResolveRoomClub());
        const unionId = String(body.union_id || data.union_id || "").trim();
        if(!clubId || !unionId)
            return;
        this.unionCreatePushReceived = true;
        const unionName = this.unionCreateName.trim();
        this.clubUnionStatus[clubId] = {known:true,hasUnion:true,unionId,unionName:unionName || undefined,isOwner:true,ownerConfirmed:true};
        // 创建成功即把 union_id 写回俱乐部信息，后续额度查询即使竞态失败也不会把入口改回创建/加入。
        if(!this.clubDetails[clubId])
            this.clubDetails[clubId] = {club_id:clubId,club_name:""};
        this.clubDetails[clubId].union_id = unionId;
        if(this.clubDetails[clubId].union_quota === undefined)
            this.clubDetails[clubId].union_quota = 0;
        if(unionName)
        {
            this.RememberUnionName(unionId,unionName);
            this.clubDetails[clubId].union_name = unionName;
        }
        this.unionCreateName = "";
        if(this.clubManagement) this.clubManagement.Refresh();
        this.RefreshClubList(false);
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"联盟创建成功，联盟号：" + unionId);
    }

    /** 刷新发现页 Title 下当前俱乐部的积分和额度。额度未确认有权限前保持隐藏。 */
    private RefreshDiscoveryClubFunds(requestQuota:boolean = true):void
    {
        const title = Tool.GetChild(this.node,"Main/发现/Title");
        if(!title)
            return;

        const clubId = this.ResolveRoomClub();
        const goldRoot = title.getChildByName("金币框");
        const goldNode = goldRoot && goldRoot.getChildByName("gold") ?
            goldRoot.getChildByName("gold") : title.getChildByName("gold");
        const goldLabel = goldNode ? goldNode.getComponent(cc.Label) : null;
        if(goldLabel)
            goldLabel.string = clubId ? this.GetClubGold(clubId) : "0";

        const quotaNode = title.getChildByName("额度");
        const unionQuota = this.UnionQuotaDisplay(clubId);
        if(quotaNode)
        {
            quotaNode.active = unionQuota.visible;
            const quotaLabel = quotaNode.getComponent(cc.Label);
            if(quotaLabel)
                quotaLabel.string = unionQuota.visible ? unionQuota.label + "：" + unionQuota.text : "";
        }
        // 联盟池只给总群主；放在俱乐部额度下面一行。
        const poolFen = this.UnionPoolFen(clubId);
        const poolNode = title.getChildByName("联盟池");
        if(poolNode)
        {
            const showPool = poolFen !== undefined;
            poolNode.active = showPool;
            if(showPool)
            {
                const poolLabel = poolNode.getComponent(cc.Label);
                if(poolLabel) poolLabel.string = "联盟池：" + this.FormatFen(poolFen);
            }
        }

        if(clubId && requestQuota)
        {
            const info = this.clubDetails[clubId];
            // 登录后 clubDetails 往往还没加载，发现页要主动补拉，否则要等进俱乐部页才显示额度。
            if(!info || info.union_id === undefined || info.union_quota === undefined)
                this.RequestClubInfo(clubId);
            this.RequestClubUnionStatus(clubId,false);
        }
    }

    /**
     * Account.club_gold 是 JSON 字符串，键为俱乐部 ID，值为当前玩家在该俱乐部的积分。
     * 兼容引擎已经把属性解析成对象的情况，不能把平台 Account.gold 当作俱乐部积分。
     */
    private GetClubGold(clubId:string):string
    {
        const account:any = GameDataManager.getAccount();
        if(!account || !clubId)
            return "";
        let value:any = account.club_gold;
        if(typeof value === "string")
        {
            try { value = JSON.parse(value); }
            catch(error) { return ""; }
        }
        if(!value || typeof value !== "object")
            return "";
        const raw = value[clubId];
        if(raw === undefined || raw === null || String(raw).trim() === "")
            return "";
        const number = Number(raw);
        // 服务端约定 -99 表示该俱乐部没有积分数据，不能把它当实际余额显示。
        if(!Number.isFinite(number) || number === -99)
            return "";
        return number.toString();
    }

    /**
     * V2 额度显示口径：
     * - 俱乐部创建者（老板）才显示；
     * - 联盟总群主（is_owner=1）显示联盟池；
     * - 加盟俱乐部老板（is_owner=0）显示本俱乐部 union_quota。
     */
    private UnionQuotaDisplay(clubId:string):{visible:boolean;label:string;text:string}
    {
        if(!clubId || !this.IsClubCreator(clubId))
            return {visible:false,label:"",text:""};
        const info = this.clubDetails[clubId];
        // 俱乐部信息（查询_俱乐部_信息）是权威归属：只要已入盟且带回 union_quota，
        // 即使 查询_联盟_额度 还没回包，发现页也应立即显示本俱乐部额度。
        const infoUnionId = String(info && info.union_id || "").trim();
        const infoRaw = info && info.union_quota;
        const infoNumber = Number(infoRaw);
        const infoKnown = infoRaw !== undefined && infoRaw !== null && String(infoRaw).trim() !== "" &&
            Number.isFinite(infoNumber);
        const status = this.clubUnionStatus[clubId];
        const knownUnion = !!infoUnionId || !!(status && status.known && status.hasUnion);
        if(!knownUnion)
            return {visible:false,label:"",text:""};
        // 额度位统一显示本俱乐部额度；总群主的联盟池另在名字下面显示。
        const fen = infoKnown ? infoNumber :
            (status && status.isOwner !== true && status.quotaFen !== undefined &&
                Number.isFinite(Number(status.quotaFen)) ? Number(status.quotaFen) : undefined);
        if(fen === undefined)
            return {visible:false,label:"",text:""};
        const yuan = fen / 100;
        const text = Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2).replace(/\.?0+$/,"");
        return {visible:true,label:"额度",text};
    }
    private FormatFen(fen:any):string
    {
        const number = Number(fen);
        if(!Number.isFinite(number)) return "";
        const yuan = number / 100;
        return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2).replace(/\.?0+$/,"");
    }
    /** 联盟池只对总群主显示（is_owner=1 的 union_quota）。 */
    private UnionPoolFen(clubId:string):number
    {
        const status = this.clubUnionStatus[clubId];
        if(!status || status.isOwner !== true || status.quotaFen === undefined)
            return undefined;
        const fen = Number(status.quotaFen);
        return Number.isFinite(fen) ? fen : undefined;
    }

    /** 登录/发现页补拉俱乐部信息：v2.1 回包带 union_id / union_apply / union_quota。 */
    private RequestClubInfo(clubId:string):void
    {
        if(!clubId) return;
        const account:any = GameDataManager.getAccount();
        if(!account || !account.guuid) return;
        const now = Date.now();
        if(now - (this.clubInfoAsked[clubId] || 0) < 5000) return;
        this.clubInfoAsked[clubId] = now;
        account.reqHallCommand(JSON.stringify({
            header:"查询_俱乐部_信息",club_id:clubId
        }),"p@club:info:" + clubId);
    }

    private RefreshClubList(requestDetails:boolean = true)
    {
        const page = Tool.GetChild(this.node,"Main/俱乐部");
        if(!page)
            return;
        const currentId = this.ResolveRoomClub();
        this.RequestClubUnionStatus(currentId,requestDetails);
        const joinedIds = this.GetMyClubIds();
        // 当前俱乐部固定排在第一位，其余保持原有关系顺序。
        const ids = currentId && joinedIds.indexOf(currentId) >= 0 ?
            [currentId].concat(joinedIds.filter(id=>id !== currentId)) : joinedIds;
        const list = Tool.GetChild(page,"俱乐部列表");
        const content = Tool.GetChild(list,"view/content");
        const template = content.getChildByName("俱乐部条目模板");
        for(const row of content.children.slice())
        {
            if(row !== template)
            {
                row.removeFromParent();
                row.destroy();
            }
        }
        // 条目卡高 231；行距按「卡高 + 24」留出肉眼可见的间隔（原来的固定 218 会让相邻卡片叠住 13px）。
        const rowPitch = Math.max(231,template.height) + 24;
        content.height = Math.max(list.height,ids.length * rowPitch);
        Tool.GetChild(page,"空状态").active = ids.length === 0;
        list.active = ids.length > 0;
        if(ids.length === 0)
            return;

        ids.forEach((id,index)=>{
            const row = cc.instantiate(template);
            row.name = "俱乐部条目_" + id;
            row.parent = content;
            row.setPosition(0,-index * rowPitch);
            row.active = true;
            row.on("click",this.onButtonClickVirtual,this);
            const info = this.clubDetails[id];
            const name = info && info.club_name ? String(info.club_name) : "俱乐部 " + id;
            const agent = this.clubAgentInfo[id];
            const account = GameDataManager.getAccount();
            const ownerIds = String(account.club_make || "").split(",");
            const isOwner = ownerIds.indexOf(id) >= 0 || !!(agent && Number(agent.is_creator) === 1);
            const isAgent = this.IsClubAgent(agent);
            const status = this.clubUnionStatus[id];
            const infoUnionId = String(info && info.union_id || "").trim();
            const statusUnionId = status && status.known && status.hasUnion ? String(status.unionId || "").trim() : "";
            // 俱乐部信息的 union_id 为权威归属；额度查询失败/竞态不能把已入盟清掉。
            const unionId = infoUnionId || statusUnionId;
            const unionName = String((status && status.unionName) ||
                (info && (info.union_name || info.unionName)) || this.CachedUnionName(unionId) || "").trim();
            const nameLabel = row.getChildByName("俱乐部名称");
            if(nameLabel)
            {
                // 联盟俱乐部显示「俱乐部名(联盟名)」；名称未回来时先显示联盟号，避免卡片只剩一个图标。
                const suffix = unionName || (unionId ? "联盟" + unionId : "");
                const label = nameLabel.getComponent(cc.Label);
                label.string = unionId ? name + "(" + suffix + ")" : name;
                // 带联盟后缀时整体降一档字号，避免 260 宽的标题在缺省字号下被压得过小。
                label.fontSize = unionId ? 32 : 38;
                label.lineHeight = unionId ? 36 : 40;
            }
            const unionBadge = row.getChildByName("联盟徽记");
            if(unionBadge)
                unionBadge.active = unionId !== "";
            if(unionId)
                this.RequestClubUnionName(id);
            const goldLabel = row.getChildByName("俱乐部金币");
            if(goldLabel)
            {
                goldLabel.active = true;
                goldLabel.getComponent(cc.Label).string = this.GetClubGold(id);
            }
            const unionQuota = this.UnionQuotaDisplay(id);
            const quotaLabel = row.getChildByName("额度");
            if(quotaLabel)
            {
                quotaLabel.active = unionQuota.visible;
                if(unionQuota.visible)
                    quotaLabel.getComponent(cc.Label).string = unionQuota.label + "：" + unionQuota.text;
            }
            const poolFen = this.UnionPoolFen(id);
            const poolLabel = row.getChildByName("联盟池");
            if(poolLabel)
            {
                const showPool = poolFen !== undefined;
                poolLabel.active = showPool;
                if(showPool)
                    poolLabel.getComponent(cc.Label).string = "联盟池：" + this.FormatFen(poolFen) + " 元";
            }
            // 邀请码每人都展示：代理/老板显示自己的码，普通成员回包里带的就是他上级的码（服务端口径）。
            // 注意这个码只影响「展示」，身份判定仍只看 is_agent，两者互不牵连。
            const inviteCode = agent && agent.invite_code ? String(agent.invite_code).trim() : "";
            const inviteLabel = row.getChildByName("邀请码");
            if(inviteLabel)
                inviteLabel.getComponent(cc.Label).string = inviteCode ? "邀请码 " + inviteCode : "";
            // The club emblem is only a placeholder in the card background. The live
            // avatar belongs to the club creator and must be loaded by creator ID.
            const ownerId = info && (info.club_owner || info.owner_guuid || info.owner_id) ?
                String(info.club_owner || info.owner_guuid || info.owner_id) :
                isOwner ? String(account.guuid || "") : "";
            const avatarNode = row.getChildByName("头像") || row.getChildByName("徽记");
            const avatar = avatarNode ? avatarNode.getComponent(cc.Sprite) : null;
            if(avatar)
            {
                if(ownerId)
                    ImageManager.getInstance().BindPlayerListAvatar(ownerId,avatar);
                else
                    ImageManager.getInstance().SetLocalAvatar(avatar,"1");
            }
            const role = isOwner ? (unionId ? (status && status.isOwner === true ? "大盟主" : "盟主") : "群主") :
                isAgent ? "合伙人" : "";
            const playerBase = row.getComponent(cc.Sprite);
            if(playerBase)
                playerBase.enabled = role === "";
            const roleBase = row.getChildByName("角色条目底图");
            if(roleBase)
                roleBase.active = role !== "";
            const roleLabel = row.getChildByName("身份");
            if(roleLabel)
                roleLabel.getComponent(cc.Label).string = role;
            if(requestDetails && !info)
            {
                const request = {header:"查询_俱乐部_信息",club_id:id};
                GameDataManager.getAccount().reqHallCommand(JSON.stringify(request),"p@club:info:" + id);
            }
            if(requestDetails && !agent)
            {
                const request = {header:"查询_俱乐部_代理_信息",club_id:id};
                GameDataManager.getAccount().reqHallCommand(JSON.stringify(request),"p@club:agent:" + id);
            }
        });
        list.getComponent(cc.ScrollView).scrollToTop(0);
    }

    private HandleClubUnionAction(action:"create"|"join"):void
    {
        if(action === "create")
            this.OpenCreateUnionDialog();
        else
            this.OpenJoinUnionDialog();
    }

    /** 游戏设置入口：仅联盟盟主，或未加入联盟的俱乐部老板可见。 */
    private RefreshGameSettingsEntry():void
    {
        const entry = Tool.GetChild(this.node,"Main/发现/游戏设置入口");
        if(!entry)
            return;
        const clubId = this.ResolveRoomClub();
        let show = false;
        if(clubId)
        {
            const union:any = this.clubUnionStatus[clubId];
            const info:any = this.clubDetails[clubId];
            const hasUnion = !!(union && union.hasUnion) ||
                !!(info && String(info.union_id || "").trim() !== "");
            // 联盟盟主是账号级身份，不因当前选中的俱乐部不同而消失。
            let isUnionOwner = false;
            for(const key in this.clubUnionStatus)
            {
                if(this.clubUnionStatus[key] && this.clubUnionStatus[key].isOwner === true)
                {
                    isUnionOwner = true;
                    break;
                }
            }
            // 已入盟只认联盟盟主；未入盟才给俱乐部老板。
            show = isUnionOwner || (!hasUnion && this.IsClubCreator(clubId));
        }
        if(entry.active !== show)
            entry.active = show;
    }

    private IsClubCreator(clubId:string):boolean
    {
        const account:any = GameDataManager.getAccount();
        if(!account || !clubId)
            return false;
        const ids = String(account.club_make || "").split(",").map(id=>id.trim());
        if(ids.indexOf(clubId) >= 0)
            return true;
        const agent = this.clubAgentInfo[clubId];
        return !!agent && Number(agent.is_creator) === 1;
    }

    private CanOpenUnionAction(showMessage:boolean = true):boolean
    {
        const clubId = this.ResolveRoomClub();
        if(!clubId || !this.IsClubCreator(clubId))
        {
            if(showMessage)
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"只有当前俱乐部创建者可以操作联盟！");
            return false;
        }
        const status = this.clubUnionStatus[clubId];
        if(!status || !status.known)
        {
            this.RequestClubUnionStatus(clubId,true);
            if(showMessage)
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"正在查询联盟状态，请稍后再试！");
            return false;
        }
        if(status.hasUnion)
        {
            if(showMessage)
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"当前俱乐部已经加入联盟！");
            return false;
        }
        return true;
    }

    private OpenCreateUnionDialog():void
    {
        if(!this.CanOpenUnionAction())
            return;
        this.clubCreateDialogMode = "union";
        this.unionCreateName = "";
        this.SetCreateDialogText("union");
        Tool.GetChild(this.node,"创建俱乐部弹窗/面板/名称输入").getComponent(cc.EditBox).string = "";
        this.RefreshUnionCreateCostHint();
        this.node.getChildByName("创建俱乐部弹窗").active = true;
    }

    private SetCreateDialogText(mode:"club"|"union"):void
    {
        const union = mode === "union";
        const values:{[path:string]:string} = union ? {
            "创建俱乐部弹窗/面板/标题底/标题":"创建联盟",
            "创建俱乐部弹窗/面板/名称标题":"联盟名称",
            "创建俱乐部弹窗/面板/名称输入/PLACEHOLDER_LABEL":"请输入联盟名称",
            "创建俱乐部弹窗/面板/确认创建俱乐部/确定文字":"确认创建联盟",
            "创建俱乐部弹窗/面板/说明":"创建后您将成为大盟主"
        } : {
            "创建俱乐部弹窗/面板/标题底/标题":"创建俱乐部",
            "创建俱乐部弹窗/面板/名称标题":"俱乐部名称",
            "创建俱乐部弹窗/面板/名称输入/PLACEHOLDER_LABEL":"请输入俱乐部名称",
            "创建俱乐部弹窗/面板/确认创建俱乐部/确定文字":"确认创建",
            "创建俱乐部弹窗/面板/说明":"创建后可邀请好友加入"
        };
        Object.keys(values).forEach(path=>{
            const node = Tool.GetChild(this.node,path);
            const label = node && node.getComponent(cc.Label);
            if(label) label.string = values[path];
        });
    }

    private RefreshUnionCreateCostHint():void
    {
        const node = Tool.GetChild(this.node,"创建俱乐部弹窗/面板/费用提示");
        const label = node == null ? null : node.getComponent(cc.Label);
        if(label == null)
            return;
        const cost = ConfigManager.getInstance().GetConsumeStone(ConfigManager.CONSUME_CREATE_UNION);
        const account = GameDataManager.getAccount();
        const stone = account == null || account.stone == null ? 0 : Number(account.stone);
        if(cost <= 0)
        {
            label.string = "创建联盟免费";
            node.color = new cc.Color(255,238,197);
        }
        else if(stone < cost)
        {
            label.string = "创建联盟需消耗" + cost + "钻石，当前余额" + stone + "，钻石不足";
            node.color = new cc.Color(255,120,110);
        }
        else
        {
            label.string = "创建联盟需消耗" + cost + "钻石（当前余额" + stone + "）";
            node.color = new cc.Color(255,238,197);
        }
    }

    private CreateUnion():void
    {
        if(!this.CanOpenUnionAction())
            return;
        const edit = Tool.GetChild(this.node,"创建俱乐部弹窗/面板/名称输入").getComponent(cc.EditBox);
        const name = edit.string.trim();
        if(!name)
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入联盟名称！");
            return;
        }
        const cost = ConfigManager.getInstance().GetConsumeStone(ConfigManager.CONSUME_CREATE_UNION);
        if(cost > 0)
        {
            const account:any = GameDataManager.getAccount();
            const stone = account == null || account.stone == null ? 0 : Number(account.stone);
            if(stone < cost)
            {
                this.RefreshUnionCreateCostHint();
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
                    "钻石不足" + cost + "，无法创建联盟！");
                return;
            }
        }
        const clubId = this.ResolveRoomClub();
        this.unionCreateCostPending = cost;
        this.unionCreateClubId = clubId;
        this.unionCreateName = name;
        this.unionCreatePushReceived = false;
        this.SendClubCommand({header:"创建_联盟",club_id:clubId,
            union_name:name,context:"club:union:create:" + clubId},"union:create:" + clubId);
    }

    private OpenJoinUnionDialog():void
    {
        if(!this.CanOpenUnionAction())
            return;
        this.clubJoinDialogMode = "union";
        this.clubInputId = "";
        this.SetJoinDialogText("union");
        this.RefreshClubIdDisplay();
        this.node.getChildByName("加入俱乐部弹窗").active = true;
    }

    private SetJoinDialogText(mode:"club"|"union"):void
    {
        const union = mode === "union";
        const title = Tool.GetChild(this.node,"加入俱乐部弹窗/面板/标题底/标题");
        if(title && title.getComponent(cc.Label)) title.getComponent(cc.Label).string = union ? "加入联盟" : "加入俱乐部";
        const inputLabel = Tool.GetChild(this.node,"加入俱乐部弹窗/面板/俱乐部ID输入框/俱乐部ID显示");
        if(inputLabel && inputLabel.getComponent(cc.Label)) inputLabel.getComponent(cc.Label).string = union ? "请输入联盟号" : "请输入邀请码";
        const confirm = Tool.GetChild(this.node,"加入俱乐部弹窗/面板/申请加入俱乐部/确定文字");
        if(confirm && confirm.getComponent(cc.Label)) confirm.getComponent(cc.Label).string = union ? "申请加入联盟" : "申请加入俱乐部";
    }

    private JoinUnion():void
    {
        if(!/^\d{6}$/.test(this.clubInputId))
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入6位联盟号！");
            return;
        }
        if(!this.CanOpenUnionAction())
            return;
        const clubId = this.ResolveRoomClub();
        this.unionJoinPendingClubId = clubId;
        this.unionJoinPendingUnionId = this.clubInputId;
        this.SendClubCommand({header:"申请_加入_联盟",club_id:clubId,union_id:this.clubInputId,
            context:"club:union:join:" + clubId},"union:join:" + clubId);
    }

    private RefreshClubIdDisplay()
    {
        const label = Tool.GetChild(this.node,"加入俱乐部弹窗/面板/俱乐部ID输入框/俱乐部ID显示").getComponent(cc.Label);
        label.string = this.clubInputId || (this.clubJoinDialogMode === "union" ? "请输入联盟号" : "请输入邀请码");
    }

    private SendClubCommand(request:any,context:string)
    {
        if(this.clubCommandBusy)
            return;
        this.clubCommandBusy = true;
        this.unschedule(this.clubCommandTimeoutHandler);
        this.scheduleOnce(this.clubCommandTimeoutHandler,10);
        GameDataManager.getAccount().reqHallCommand(JSON.stringify(request),"p@club:" + context);
    }

    /**
     * 刷新「创建俱乐部」弹窗里的费用提示（要花多少钻、余额够不够）。
     * 价格走后台「钻石消费价格」页，未配置时用 ConfigManager 内置默认（10000 钻）。
     */
    private RefreshClubCreateCostHint()
    {
        const node = Tool.GetChild(this.node,"创建俱乐部弹窗/面板/费用提示");
        const label = node == null ? null : node.getComponent(cc.Label);
        if(label == null)
            return;
        const nCost = ConfigManager.getInstance().GetConsumeStone(ConfigManager.CONSUME_CREATE_CLUB);
        const account = GameDataManager.getAccount();
        const nStone = account == null || account.stone == null ? 0 : Number(account.stone);
        if(nCost <= 0)
        {
            label.string = "创建免费";
            node.color = new cc.Color(255,238,197);
        }
        else if(nStone < nCost)
        {
            label.string = "创建需消耗" + nCost + "钻石，当前余额" + nStone + "，钻石不足";
            node.color = new cc.Color(255,120,110);
        }
        else
        {
            label.string = "创建需消耗" + nCost + "钻石（当前余额" + nStone + "）";
            node.color = new cc.Color(255,238,197);
        }
    }

    private CreateClub()
    {
        if(this.clubCreateDialogMode === "union")
        {
            this.CreateUnion();
            return;
        }
        const edit = Tool.GetChild(this.node,"创建俱乐部弹窗/面板/名称输入").getComponent(cc.EditBox);
        const name = edit.string.trim();
        if(!name)
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入俱乐部名称！");
            return;
        }
        // 创建费＝后台「钻石消费价格」里的「创建俱乐部」（默认 10000 钻）。余额不够就地拦。
        const nCost = ConfigManager.getInstance().GetConsumeStone(ConfigManager.CONSUME_CREATE_CLUB);
        if(nCost > 0)
        {
            const account = GameDataManager.getAccount();
            const nStone = account == null || account.stone == null ? 0 : Number(account.stone);
            if(nStone < nCost)
            {
                this.RefreshClubCreateCostHint();
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
                    "钻石不足" + nCost + "，无法创建俱乐部！");
                return;
            }
        }
        this.clubCreateCostPending = nCost;
        // ⚠️ 扣费排在「创建被服务端受理」之后：名字重复 / 超过 10 家这类失败是同步返回 0x301 的，
        //    先扣再创建会让玩家白扣一笔，所以顺序是「先创建、受理成功再扣」，见 ChargeClubCreateFee。
        // 创建成功后新俱乐部会通过 set_club_make 推送出现，届时自动设为默认俱乐部。
        this.MarkPendingDefaultClub();
        this.SendClubCommand({header:"创建_俱乐部",club_name:name,club_mode:"1"},"create");
    }

    /**
     * 创建请求受理后再扣钻石。扣费本身由服务端执行（`玩家_消费_命令` + `money_type=stone`），
     * 这里只负责发命令与提示。CreateClub 已经拦过一次余额，这里不再重复判断。
     */
    private ChargeClubCreateFee()
    {
        const nCost = this.clubCreateCostPending;
        if(nCost <= 0)
        {
            this.clubCreateCostPending = 0;
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
                "创建请求已受理，俱乐部创建后会显示在列表中。");
            return;
        }
        // 弹窗在这一步已经关掉，玩家点不到「确认创建」，所以不需要再加防重复提交。
        const strParam = ConfigManager.getInstance().BuildConsumeStoneParam(ConfigManager.CONSUME_CREATE_CLUB);
        this.clubChargeBusy = true;
        this.unschedule(this.clubChargeTimeoutHandler);
        this.scheduleOnce(this.clubChargeTimeoutHandler,8);
        GameDataManager.getAccount().reqHallCommand(strParam,"P@玩家_消费_命令_创建俱乐部");
    }

    /** 创建联盟受理后扣除默认/后台配置的联盟创建费。 */
    private ChargeUnionCreateFee():void
    {
        const nCost = this.unionCreateCostPending;
        if(nCost <= 0)
        {
            this.unionCreateCostPending = 0;
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"联盟创建请求已受理。");
            return;
        }
        const strParam = ConfigManager.getInstance().BuildConsumeStoneParam(ConfigManager.CONSUME_CREATE_UNION);
        this.unionChargeBusy = true;
        this.unschedule(this.unionChargeTimeoutHandler);
        this.scheduleOnce(this.unionChargeTimeoutHandler,8);
        GameDataManager.getAccount().reqHallCommand(strParam,"P@玩家_消费_命令_创建联盟");
    }

    private JoinClub()
    {
        // 新规则：凭 6 位邀请码入会，码里带俱乐部，不再单独输入俱乐部 ID。
        if(!/^\d{6}$/.test(this.clubInputId))
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入6位邀请码！");
            return;
        }
        // 审批通过后 set_club_join 推送出现新俱乐部，届时自动设为默认俱乐部。
        this.MarkPendingDefaultClub();
        this.SendClubCommand({header:"申请_加入_俱乐部",invite_code:this.clubInputId},"join");
    }

    private HandleClubHallCommand(nCode:number,param:string):boolean
    {
        if(param.indexOf("club:") < 0)
            return false;
        let response:any = null;
        try { response = JSON.parse(param); }
        catch(error) { Debug.Error("解析俱乐部回包失败：" + error); return false; }
        let context = response && response.context ? String(response.context) : "";
        if(context.indexOf("p@") === 0 || context.indexOf("P@") === 0)
            context = context.substr(2);
        // Hall 服务端会把回调标签拼到客户端 context 前面，例如：
        // 赠送_俱乐部_积分_club:gold:give-main:567671:718968。
        // 截出真正的 club context，确保 0x200/0x301 都能进入对应提示分支。
        const clubContextIndex = context.indexOf("club:");
        if(clubContextIndex > 0)
            context = context.substr(clubContextIndex);
        if(context.indexOf("club:") !== 0)
            return false;
        if(context.indexOf("club:stone:pool:") === 0)
        {
            // 同步回包通常是空壳，正式数据走 ClubStoneWater；有 result 时也兼容处理。
            if(nCode === 0x200 && response.result)
                this.OnClubStoneWater(response.result);
            else if(nCode !== 0x200)
            {
                this.clubStonePoolRequestClubId = "";
                if(this.clubManagement) this.clubManagement.Refresh();
            }
            return true;
        }
        if(context.indexOf("club:info:") === 0)
        {
            const id = context.substr("club:info:".length);
            if(nCode === 0x200 && response.result && response.result.club_id)
            {
                const result:any = response.result;
                const oldInfo = this.clubDetails[id];
                if(oldInfo)
                {
                    const has=Object.prototype.hasOwnProperty;
                    // union_id 一旦有值不会回到空；旧服务端/竞态下回包可能缺字段或给空串，不能把已入盟清掉。
                    const knownUnion = this.ResolveClubUnionId(id) || String(oldInfo.union_id || "").trim();
                    if(!has.call(result,"union_id") || (!String(result.union_id || "").trim() && knownUnion))
                        result.union_id = knownUnion;
                    if(!has.call(result,"union_name") && oldInfo.union_name)
                        result.union_name = oldInfo.union_name;
                    if(!has.call(result,"union_apply") && oldInfo.union_apply)
                        result.union_apply = oldInfo.union_apply;
                    if(!has.call(result,"union_quota") && oldInfo.union_quota !== undefined)
                        result.union_quota = oldInfo.union_quota;
                }
                this.clubDetails[id] = result;
                const unionId = String(result.union_id || "").trim();
                const unionName = String(result.union_name || result.unionName || "").trim();
                if(unionId && unionName)
                    this.RememberUnionName(unionId,unionName);
                if(unionId)
                    this.RequestClubUnionName(id);
                if(this.clubManagement) this.clubManagement.Refresh();
                this.RefreshDiscoveryClubFunds(false);
                this.RefreshClubList(false);
            }
            return true;
        }
        if(context.indexOf("club:agent:") === 0)
        {
            const id = context.substr("club:agent:".length);
            if(nCode === 0x200 && response.result && response.result.club_id)
                this.OnClubAgentInfo(response.result,undefined,false);
            // 代理信息的正式结果通过 ClubAgentInfo 推送，0x200 的同步结果通常为空。
            return true;
        }
        if(context.indexOf("club:union:name:") === 0)
        {
            const id = context.substr("club:union:name:".length);
            if(nCode === 0x200)
            {
                // 正式名称通常走 ClubMyUnion 推送；同步 result 也兼容处理。
                if(response.result || response.ClubMyUnion)
                    this.OnClubMyUnion(response);
            }
            else
            {
                // 盟主可能没有「我的联盟」权限；冷却 5 分钟，避免每次刷新都发无效请求。
                const error = this.GetHallCommandError(param,"");
                const notOwner = error.indexOf("总群主") >= 0 || error.indexOf("你还没有联盟") >= 0;
                // 明确非总群主冷却 5 分钟；网络/其它失败 10 秒后可重探，避免总群主被一次失败卡住。
                this.clubUnionNameAsked[id] = Date.now() + (notOwner ? 300000 : 10000);
                this.clubUnionNamePendingClubId = "";
                // 明确不是总群主时落 isOwner=false，避免把「大群主」和入盟申请按钮误显示给盟主。
                if(notOwner)
                {
                    const noUnion = error.indexOf("你还没有联盟") >= 0;
                    const status = this.clubUnionStatus[id];
                    // 创建成功或上一次「查询_我的_联盟」已确认 owner 时，单次失败不改身份。
                    if(!(status && status.ownerConfirmed))
                    {
                        if(status)
                        {
                            status.isOwner = false;
                            if(noUnion)
                            {
                                status.known = true;
                                status.hasUnion = false;
                                status.unionId = undefined;
                            }
                        }
                        else this.clubUnionStatus[id] = {known:true,hasUnion:!noUnion,isOwner:false};
                        if(this.clubManagement) this.clubManagement.Refresh();
                    }
                }
            }
            return true;
        }
        if(context.indexOf("club:union:status:") === 0)
        {
            const id = context.substr("club:union:status:".length);
            if(nCode === 0x200)
            {
                // 正式数据通常通过 ClubUnionQuota 推送；同步 result 也兼容处理。
                if(response.result || response.ClubUnionQuota)
                    this.OnClubUnionQuota(response);
            }
            else
            {
                const error = this.GetHallCommandError(param,"");
                // 新文档：俱乐部 union_id 一旦有值不会回到空。额度查询失败/竞态时不能用空结果覆盖已入盟状态。
                const existing = this.ResolveClubUnionId(id);
                const previous = this.clubUnionStatus[id];
                if(existing)
                {
                    this.clubUnionStatus[id] = {known:true,hasUnion:true,unionId:existing,
                        unionName:(previous && previous.unionName) || this.CachedUnionName(existing) || undefined,
                        isOwner:previous ? previous.isOwner : undefined};
                }
                else if(error.indexOf("你还没有联盟") >= 0)
                    this.clubUnionStatus[id] = {known:true,hasUnion:false,isOwner:false};
                else
                    this.clubUnionStatus[id] = {known:false,hasUnion:false,isOwner:false};
                if(this.clubManagement) this.clubManagement.Refresh();
            }
            return true;
        }
        if(context.indexOf("club:gold:water:") === 0)
        {
            // 查询接口的同步回包通常只有空壳，列表由 ClubGoldWater 推送；
            // 若服务端直接把列表放进 result，也在这里兼容显示。
            if(nCode === 0x200 && response.result)
                this.OnClubGoldWaterList(JSON.stringify(response.result));
            else if(nCode !== 0x200 && context === this.clubGoldWaterRequestContext)
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
                    this.GetHallCommandError(param,"俱乐部金币流水查询失败，请稍后重试！"));
            return true;
        }
        if(context.indexOf("club:gold:give-main:") === 0)
        {
            if(!this.clubGoldGiftPending)
                return true;
            this.clubGoldGiftPending = false;
            if(nCode === 0x200 || nCode === 0x500)
            {
                this.ClearGiftInputs();
                this.RefreshDiscoveryClubFunds(false);
                if(this.clubManagement) this.clubManagement.Refresh();
                this.GetAllExchangeInfo(0);
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"俱乐部金币赠送成功！");
            }
            else
            {
                this.ShowClubGoldGiftError(this.GetHallCommandError(param,"俱乐部金币赠送失败，请稍后重试！"));
            }
            return true;
        }
        if(context.indexOf("club:gold:add-record:") === 0)
        {
            // 赠送记录现在查「查询_俱乐部_积分流水」：列表由 ClubGoldWater 异步推送，
            // 同步回包通常只有空壳；若服务端把列表塞进同步 result，也在这里立刻显示。
            if(nCode === 0x200 && response.result)
                this.OnClubGoldWaterList(JSON.stringify(response.result));
            else if(nCode !== 0x200)
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
                    this.GetHallCommandError(param,"赠送记录查询失败，请稍后重试！"));
            return true;
        }
        const isUnionCreate = context.indexOf("club:union:create:") === 0;
        const isUnionJoin = context.indexOf("club:union:join:") === 0;
        if(context !== "club:create" && context !== "club:join" && !isUnionCreate && !isUnionJoin)
            return false;
        this.unschedule(this.clubCommandTimeoutHandler);
        this.clubCommandBusy = false;
        if(nCode !== 0x200)
        {
            // 命令没被受理就不会有新俱乐部出现，撤掉待切换标记，避免以后误切默认俱乐部。
            this.CancelPendingDefaultClub();
            // 名字重复 / 超过 10 家都在这里同步失败，没受理就不扣费。
            if(isUnionCreate)
                this.unionCreateCostPending = 0;
            else if(isUnionJoin)
            {
                this.unionJoinPendingClubId = "";
                this.unionJoinPendingUnionId = "";
            }
            else
                this.clubCreateCostPending = 0;
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
                this.GetHallCommandError(param,isUnionCreate ? "创建联盟失败！" :
                    isUnionJoin ? "申请加入联盟失败！" :
                    context === "club:create" ? "创建俱乐部失败！" : "申请加入俱乐部失败！"));
            return true;
        }
        if(isUnionCreate)
        {
            const clubId = context.substr("club:union:create:".length);
            this.unionCreateClubId = clubId;
            // ClubUnionCreate 推送通常晚于同步回包；这里保留已有状态，别把推送写入的名称覆盖掉。
            const previous = this.clubUnionStatus[clubId] || {};
            this.clubUnionStatus[clubId] = {known:true,hasUnion:true,isOwner:true,
                unionId:previous.unionId,unionName:previous.unionName || this.unionCreateName || undefined};
            this.node.getChildByName("创建俱乐部弹窗").active = false;
            this.clubCreateDialogMode = "club";
            this.SetCreateDialogText("club");
            this.ChargeUnionCreateFee();
        }
        else if(isUnionJoin)
        {
            const clubId = context.substr("club:union:join:".length) || this.unionJoinPendingClubId;
            if(clubId)
            {
                if(!this.clubDetails[clubId])
                    this.clubDetails[clubId] = {club_id:clubId,club_name:""};
                // 新文档用 union_apply 表示审核中的联盟码；只用于状态展示，不再隐藏创建/加入入口。
                this.clubDetails[clubId].union_apply = this.unionJoinPendingUnionId;
            }
            this.unionJoinPendingClubId = "";
            this.unionJoinPendingUnionId = "";
            this.node.getChildByName("加入俱乐部弹窗").active = false;
            this.clubJoinDialogMode = "club";
            if(this.clubManagement) this.clubManagement.Refresh();
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"加入联盟申请已提交，请等待大盟主审批。");
        }
        else if(context === "club:create")
        {
            this.node.getChildByName("创建俱乐部弹窗").active = false;
            // 受理成功才扣费，提示语由扣费回包给出（带真实扣费金额）。
            this.ChargeClubCreateFee();
        }
        else
        {
            this.node.getChildByName("加入俱乐部弹窗").active = false;
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"加入申请已提交，请等待俱乐部管理员审批。");
        }
        this.RefreshClubList();
        return true;
    }

    public onHallCommand(nCode:number, param:string)
    {
        if(param && param.indexOf("ClubAgentInfo") >= 0)
        {
            this.OnClubAgentInfo(param,undefined,false);
            return;
        }
        if(this.HandleClubHallCommand(nCode,param))
            return;
        const isUnionCreateChargeReply = param.indexOf("玩家_消费_命令_创建联盟") >= 0 ||
            (this.unionChargeBusy && param.indexOf("玩家_消费_命令") >= 0 && param.indexOf("创建联盟") >= 0);
        if(isUnionCreateChargeReply)
        {
            const nCharged = this.unionCreateCostPending;
            this.unionCreateCostPending = 0;
            this.unschedule(this.unionChargeTimeoutHandler);
            this.unionChargeBusy = false;
            if(nCode == 0x200)
            {
                if(!this.unionCreatePushReceived)
                    UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
                        nCharged > 0 ? "创建联盟成功，已扣除" + nCharged + "钻石。" : "创建联盟成功！");
            }
            else
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
                    "联盟已创建，但钻石扣除失败：" + this.GetHallCommandError(param,"未知原因") + "。请联系客服处理！");
            }
            return;
        }
        const isClubCreateChargeReply = param.indexOf("玩家_消费_命令_创建俱乐部") >= 0 ||
            (this.clubChargeBusy && param.indexOf("玩家_消费_命令") >= 0 && param.indexOf("创建俱乐部") >= 0);
        if(isClubCreateChargeReply)
        {
            const nCharged = this.clubCreateCostPending;
            this.clubCreateCostPending = 0;
            this.unschedule(this.clubChargeTimeoutHandler);
            this.clubChargeBusy = false;
            if(nCode == 0x200)
            {
                if(nCharged <= 0)
                    return;
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
                    "创建请求已受理，已扣除" + nCharged + "钻石，俱乐部创建后会显示在列表中。");
            }
            else
            {
                // 创建本身已被受理，这里只失败在扣费：不能装作成功，交给客服对账最稳。
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
                    "创建请求已受理，但钻石扣除失败：" + this.GetHallCommandError(param,"未知原因")
                    + "。请联系客服处理！");
            }
            return;
        }
        const isAvatarChargeReply = param.indexOf("玩家_消费_命令_换头像") >= 0 ||
            (this.avatarChargeBusy && param.indexOf("玩家_消费_命令") >= 0 && param.indexOf("换头像") >= 0);
        if(isAvatarChargeReply)
        {
            let profileName = this.pendingPaidProfileName;
            let avatarIndex = this.pendingPaidAvatarIndex;
            this.FinishAvatarChargeRequest();
            if(nCode == 0x200)
            {
                if(ImageManager.getInstance().IsAvatarIndex(avatarIndex))
                {
                    this.pendingPaidProfileName = "";
                    this.pendingPaidAvatarIndex = "";
                    this.ApplyProfileChange(profileName,avatarIndex);
                    // 提示里报本次实际扣的钻石数（后台可配，别再写死"10元"）
                    let nCharged = this.pendingPaidAvatarCost;
                    this.pendingPaidAvatarCost = 0;
                    UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
                        nCharged > 0 ? ("头像修改成功，已扣除" + nCharged + "钻石！") : "头像修改成功！");
                }
            }
            else
            {
                this.pendingPaidAvatarCost = 0;
                Tool.GetChild(this.node,"确定修改个人信息").active = false;
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
                    this.GetHallCommandError(param,"头像修改失败，未完成扣费，请稍后重试！"));
            }
        }
        else if(param.indexOf("修改_玩家_登录密码")>=0 || param.indexOf("修改_玩家_交易密码")>=0)
        {
            if (nCode == 0x200)
            {
                if(param.indexOf("修改_玩家_交易密码")>=0)
                {
                    this.ClearTransactionPasswordInputs();
                    if(this.bNeedInitJYPwd)
                        Tool.GetChild(this.node,"初始化交易密码").active = false;
                    this.bNeedInitJYPwd = false;
                }
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "修改密码成功！");                
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("提取_玩家_代金券")>=0)
        {
            if (nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                let content = data["LetPaperToGold"]["prompt"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, content);                
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("玩家_查询_VIP")>=0)
        {
            if (nCode == 0x200)
            {
                
                //更新vip信息
                let msg = JSON.parse(param);
                let data = msg["result"];
                if(data["is_vip"] == 1)
                {
                    let level = data["vip_level"].toString()
                    Tool.GetChild(this.node,"Main/我的/信息/VIP").active = true
                    let arrayAll = Tool.GetChild(this.node,"Main/我的/信息/VIP/VIP类型").children
                    for(let one of arrayAll)
                    {
                        if(one.name == level)
                        {
                            one.active = true
                        }
                        else
                        {
                            one.active = false
                        }
                    }
                    Tool.GetChild(this.node,"Main/我的/信息/VIP/VIP到期时间").getComponent(cc.Label).string = data["vip_due_datetime"]+"到期"
                }
                else
                {
                    Tool.GetChild(this.node,"Main/我的/信息/VIP").active = false
                }
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("校验_玩家_交易密码")>=0)
        {
            if (nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
               
                this.bNeedInitJYPwd = true
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                this.bNeedInitJYPwd = false
            }
        }

    }
    //查询资金流水
    public GetLiuShuiInfo(nPage:number = 0)
    {
        const account:any = GameDataManager.getAccount();
        if(account == null)
            return;

        const clubId = this.ResolveRoomClub();
        if(clubId !== "")
        {
            // §11.1：俱乐部积分流水必须按俱乐部查询，数据从 ClubGoldWater 异步推送。
            this.clubGoldWaterClubId = clubId;
            this.clubGoldWaterRequestContext = "club:gold:water:" + clubId + ":" + nPage;
            const strParam = JSON.stringify({
                header:"查询_俱乐部_积分流水",
                club_id:clubId,
                user_id:"",
                count:this.PAGE_PER_COUNT,
                page:nPage,
                context:this.clubGoldWaterRequestContext
            });
            account.reqHallCommand(strParam,"P@" + this.clubGoldWaterRequestContext);
            return;
        }

        // 无俱乐部时保留大厅平台金币的存量流水接口。
        this.clubGoldWaterClubId = "";
        this.clubGoldWaterRequestContext = "";
        const strParam = "{\"header\":\"查询_玩家_现金流水\",\"user_id\":\"" + account.guuid + "\",\"page\":\"" + nPage.toString() + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        account.reqHallCommand(strParam, "P@查询_玩家_现金流水");
    }

    //--------------------------------------------------------------------------
    // 群主钻石池
    //--------------------------------------------------------------------------
    private IsClubOwner(clubId:string):boolean
    {
        const id = clubId == null ? "" : String(clubId).trim();
        if(id === "")
            return false;
        const account:any = GameDataManager.getAccount();
        if(account == null)
            return false;
        const guuid = String(account.guuid || "");
        if(guuid && String(account.club_make || "").split(",").map(x=>x.trim()).indexOf(id) >= 0)
            return true;
        const agent = this.clubAgentInfo[id];
        return !!(agent && Number(agent.is_creator) === 1);
    }

    /**
     * 群主钻石池只有群主/boss 能查；用流水最新一条的 remark「前→后」取当前池子。
     * count 直接要 100（服务端总条数封顶 100），避免再翻页找最后一条。
     */
    public RequestClubStonePool(clubId:string,force:boolean = false):void
    {
        const id = clubId == null ? "" : String(clubId).trim();
        if(id === "" || !this.IsClubOwner(id))
            return;
        const now = Date.now();
        if(!force && now - (this.clubStonePoolAsked[id] || 0) < 15000)
            return;
        const account:any = GameDataManager.getAccount();
        if(account == null)
            return;
        this.clubStonePoolAsked[id] = now;
        this.clubStonePoolRequestClubId = id;
        const context = "club:stone:pool:" + id + ":" + now;
        const strParam = JSON.stringify({
            header:"查询_俱乐部_钻石流水",
            club_id:id,
            count:100,
            page:0,
            context
        });
        account.reqHallCommand(strParam,"P@" + context);
    }

    private ClubOwnerId(clubId:string):string
    {
        const info = this.clubDetails[clubId];
        const owner = info && info.club_owner != null ? String(info.club_owner).trim() : "";
        if(owner !== "")
            return owner;
        const agent = this.clubAgentInfo[clubId];
        return agent && Number(agent.is_creator) === 1 ? String(agent.user_id || "").trim() : "";
    }

    /** ClubStoneWater 推送/同步回包：取日期最新的一条，读 remark 箭头后的池子数量。 */
    public OnClubStoneWater(raw:any, secondaryRaw?:any):void
    {
        if(secondaryRaw !== undefined && (typeof raw === "number" || typeof raw === "boolean"))
            raw = secondaryRaw;
        let data:any = raw;
        if(typeof data === "string")
        {
            try { data = JSON.parse(data); }
            catch(error) { return; }
        }
        if(data && data.result && !data.ClubStoneWater)
            data = data.result;
        if(data && data.ret_result && !data.ClubStoneWater)
            data = data.ret_result;
        if(data == null || !Array.isArray(data["ClubStoneWater"]))
            return;

        const rows = data["ClubStoneWater"];
        let clubId = this.clubStonePoolRequestClubId;
        if(clubId === "")
        {
            // 没有待配对的查询时，只接受当前俱乐部群主的推送；推送本身不带 club_id。
            clubId = this.ResolveRoomClub();
            if(clubId === "" || !this.IsClubOwner(clubId))
                return;
            const ownerId = this.ClubOwnerId(clubId);
            const rowOwner = rows.length > 0 && rows[0] && rows[0].guuid != null ?
                String(rows[0].guuid).trim() : "";
            if(ownerId !== "" && rowOwner !== "" && ownerId !== rowOwner)
                return;
        }
        if(this.ResolveRoomClub() !== clubId)
            return;

        if(rows.length === 0)
        {
            this.clubStonePools[clubId] = 0;
            this.clubStonePoolRequestClubId = "";
            if(this.clubManagement) this.clubManagement.Refresh();
            return;
        }

        let latest:any = rows[0];
        let latestTime = -Infinity;
        for(const row of rows)
        {
            const time = Date.parse(String(row && row.date || "").replace(" ","T"));
            if(!isFinite(time))
                continue;
            if(time >= latestTime)
            {
                latest = row;
                latestTime = time;
            }
        }
        const remark = latest == null || latest.remark == null ? "" : String(latest.remark);
        const parts = remark.split(/→|->/);
        const afterText = parts.length > 1 ? parts[parts.length - 1] : remark;
        const pool = Number(String(afterText).replace(/[^\d.-]/g,""));
        if(!isFinite(pool))
            return;

        this.clubStonePools[clubId] = Math.max(0,Math.trunc(pool));
        this.clubStonePoolRequestClubId = "";
        if(this.clubManagement) this.clubManagement.Refresh();
    }

    public ListPlayerCashWater(strMsg:string)
    {
        // 俱乐部页面只接受 ClubGoldWater，避免旧路由回包覆盖俱乐部积分流水。
        if(this.ResolveRoomClub() !== "")
            return;
        this.scrollLiushui.UpdateList(strMsg,"ListPlayerCashWater","资金明细对象",this.PAGE_PER_COUNT,this.setLiushuiItemInfo.bind(this));
    }

    /** 俱乐部积分流水推送：{"ClubGoldWater":[...]}。推送样例不带 club_id，按最近一次请求配对。 */
    public OnClubGoldWaterList(strMsg:any)
    {
        if(this.clubGoldWaterClubId === "")
            return;
        if(this.ResolveRoomClub() !== this.clubGoldWaterClubId)
            return;

        const payload = this.NormalizeClubGoldWaterList(strMsg);
        if(payload == null)
            return;
        // 「我的 → 赠送」记录和「资金明细」页现在都查这一条流水接口，
        // 按最近一次请求的 context 决定渲染到哪个列表。
        if(this.clubGoldWaterRequestContext.indexOf("club:gold:add-record:") === 0)
        {
            if(this.scrollExchangeInfo == null)
                return;
            this.scrollExchangeInfo.UpdateList(payload,"ClubGoldWater","赠送记录对象",
                this.PAGE_PER_COUNT,this.setClubGiftRecordItemInfo.bind(this));
            return;
        }
        if(this.scrollLiushui == null)
            return;
        this.scrollLiushui.UpdateList(payload,"ClubGoldWater","资金明细对象",
            this.PAGE_PER_COUNT,this.setClubGoldWaterItemInfo.bind(this));
    }

    private NormalizeClubGoldWaterList(strMsg:any):string
    {
        if(strMsg == null || strMsg === "")
            return null;
        let data:any = strMsg;
        if(typeof strMsg === "string")
        {
            try { data = JSON.parse(strMsg); }
            catch(error) { return null; }
        }
        if(data == null || typeof data !== "object")
            return null;
        if(Array.isArray(data["ClubGoldWater"]))
            return JSON.stringify(data);
        const result = data["result"];
        if(result && Array.isArray(result["ClubGoldWater"]))
            return JSON.stringify(result);
        return null;
    }

    public setClubGoldWaterItemInfo(node:cc.Node,jItem:any)
    {
        node.active = true;

        const type = jItem["type"] == null ? "" : String(jItem["type"]);
        node.getChildByName("type").getComponent(cc.Label).string = type || "—";

        // §11.1 的 gold 是整数元，负数表示减少；不要沿用旧流水的 old_money/new_money。
        const gold = Number(jItem["gold"]);
        const validGold = !isNaN(gold) && isFinite(gold);
        const amount = validGold ? Math.trunc(gold) : 0;
        const countNode = node.getChildByName("count");
        countNode.getComponent(cc.Label).string = validGold ?
            (amount > 0 ? "+" + amount.toString() : amount.toString()) : "--";

        // 新接口返回 remark（前→后），对应列表中的「流向后」列；接口没有当前余额字段。
        const remark = jItem["remark"] == null ? "" : String(jItem["remark"]);
        node.getChildByName("now").getComponent(cc.Label).string = remark || "—";

        const date = jItem["date"] == null ? "" : String(jItem["date"]);
        const match = date.match(/^\d{4}[-\/]([0-9]{1,2})[-\/]([0-9]{1,2})[ T]([0-9]{1,2}):([0-9]{2})/);
        const month = match && match[1].length === 1 ? "0" + match[1] : match ? match[1] : "";
        const day = match && match[2].length === 1 ? "0" + match[2] : match ? match[2] : "";
        const hour = match && match[3].length === 1 ? "0" + match[3] : match ? match[3] : "";
        node.getChildByName("time").getComponent(cc.Label).string = match ?
            month + "/" + day + " " + hour + ":" + match[4] : date;

        const roomId = jItem["room_id"] == null ? "" : String(jItem["room_id"]).trim();
        const iconType = roomId !== "" || type === "带入" || type === "结算" ? "game" :
            (type === "添加积分" || type === "修改积分") ? "gift" :
            amount > 0 ? "in" : amount < 0 ? "out" : "";
        for(const key of ["in","out","gift","game"])
        {
            const icon = node.getChildByName("V8类型图标_" + key);
            if(icon != null) icon.active = key === iconType;
        }

        // 客户口径（2026-11-07 测试反馈）：红色 = 加分，绿色 = 减分，与旧实现相反。
        if(amount > 0)
            countNode.color = new cc.Color(255,65,52,255);
        else if(amount < 0)
            countNode.color = new cc.Color(167,231,29,255);
        else
            countNode.color = new cc.Color(239,225,194,255);
    }
    public setLiushuiItemInfo(node:cc.Node,jItem:any)
    {
        node.active = true;

        node.getChildByName("type").getComponent(cc.Label).string = jItem["option_type"];
        let oldBalance = Number(jItem["old_money"]);
        let newBalance = Number(jItem["new_money"]);
        let change = Number(jItem["add_money"]);
        if(!isNaN(oldBalance) && isFinite(oldBalance) && !isNaN(newBalance) && isFinite(newBalance))
            change = newBalance - oldBalance;

        let countNode = node.getChildByName("count");
        let countText = this.FormatCashWaterNumber(change);
        countNode.getComponent(cc.Label).string = change > 0 ? "+" + countText : countText;
        node.getChildByName("now").getComponent(cc.Label).string = this.FormatCashWaterNumber(newBalance);
        const date = jItem["date"] == null ? "" : jItem["date"].toString();
        const match = date.match(/^\d{4}[-\/]([0-9]{2})[-\/]([0-9]{2})[ T]([0-9]{2}):([0-9]{2})/);
        node.getChildByName("time").getComponent(cc.Label).string = match ?
            match[1]+"/"+match[2]+" "+match[3]+":"+match[4] : date;
        const type = jItem["option_type"] == null ? "" : jItem["option_type"].toString();
        // These server operation names are game transactions, too (same as the
        // management backend's transactionGameCondition).
        const gameOperations = ["带入", "打局", "结算", "芒皮", "揍芒", "休芒"];
        const iconType = type.indexOf("充值") >= 0 ? "in" : type.indexOf("提现") >= 0 ? "out" :
            (type.indexOf("赠送") >= 0 || type.indexOf("受赠") >= 0) ? "gift" :
            (type.indexOf("游戏") >= 0 || type.indexOf("牌局") >= 0 || gameOperations.indexOf(type) >= 0) ? "game" : "";
        for(const key of ["in","out","gift","game"])
        {
            const icon = node.getChildByName("V8类型图标_"+key);
            if(icon != null) icon.active = key === iconType;
        }

        // 客户口径（2026-11-07 测试反馈）：红色 = 加分，绿色 = 减分，与旧实现相反。
        if(change > 0)
        {
            countNode.color = new cc.Color(255,65,52,255);
        }
        else if(change < 0)
        {
            countNode.color = new cc.Color(167,231,29,255);
        }
        else
            countNode.color = new cc.Color(239,225,194,255);
    }

    private FormatCashWaterNumber(value:number):string
    {
        if(isNaN(value) || !isFinite(value))
            return "--";
        let rounded = Math.round(value * 100) / 100;
        if(Math.abs(rounded) < 0.005)
            rounded = 0;
        return rounded.toString();
    }

    public OnUserHashInfo(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        if(data == null)
            return;
        let info = data["UserHashInfo"];
        let strKey:string = info["key"];
        let strContent:string = info["content"];
        let context:string = info["context"];
        if(context === "大厅查询公告")
        {
            if(strContent!="")
            {
                UIManager.getInstance().showPanel("panelNotifyView",ShowPanelMode.Cover,strContent);
            }
        }
        else  if(context === "充值公告")
        {
            if(strContent!="")
            {
                UIManager.getInstance().showPanel("panelNotifyViewCZ",ShowPanelMode.Cover,strContent);
            }
        }
        else  if(context === "活动公告")
        {
            if(strContent!="")
            {
                UIManager.getInstance().showPanel("panelNotifyViewHD",ShowPanelMode.Cover,strContent);
            }
        }
        else if(context === "公告6")
        {
            this.SetScrollableAnnouncement("公告6",strContent==""?"":Tool.Base64Decode(strContent));
        }
        else if(context === "公告7")
        {
            Tool.GetChild(this.node,"公告7/list/view/content/msg").getComponent(cc.Label).string = strContent==""?"":Tool.Base64Decode(strContent);;
        }
        else if(context === "公告8")
        {
            this.SetScrollableAnnouncement("公告8",strContent==""?"":Tool.Base64Decode(strContent));
        }
        else if(context === "世界杯2")
        {
            if(strContent == "1")
            {
                UIManager.getInstance().showPanel("panelSJB",ShowPanelMode.Cover);
            }
            else
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,strContent);
            }
        }
    }

    /** 根据公告文字的实际换行高度刷新内容区，确保长公告可以完整滚动。 */
    private SetScrollableAnnouncement(panelName:string,message:string)
    {
        let list = Tool.GetChild(this.node,panelName+"/list");
        let content = list == null ? null : Tool.GetChild(list,"view/content");
        let messageNode = content == null ? null : content.getChildByName("msg");
        let label = messageNode == null ? null : messageNode.getComponent(cc.Label);
        let scrollView = list == null ? null : list.getComponent(cc.ScrollView);
        if(label == null || content == null || scrollView == null)
            return;

        message = Tool.NormalizeMultilineText(message);
        label.string = message;
        this.scheduleOnce(() =>
        {
            if(!cc.isValid(this.node) || !cc.isValid(label.node) || !cc.isValid(content))
                return;
            let forceUpdate = (label as any)._forceUpdateRenderData;
            if(typeof forceUpdate === "function")
                forceUpdate.call(label, true);
            // RESIZE_HEIGHT 会先根据620像素正文宽度算出自动换行后的真实高度；
            // 不能只按显式换行数回写，否则一段很长但没有换行符的公告会被压成一行。
            let explicitLineHeight = message.split("\n").length * label.lineHeight;
            label.node.height = Math.max(label.lineHeight, label.node.height, explicitLineHeight);
            let layout = content.getComponent(cc.Layout);
            if(layout != null && layout.enabled)
                layout.updateLayout();
            // 公告详情的高清背景与标题均已预制在Prefab中；这里只根据
            // 服务端正文长度扩展滚动范围，不在运行时生成或调整美术节点。
            const v7MessageTop = 25;
            const v7MessageBottomPadding = 30;
            const v7ViewportHeight = content.parent == null ?
                scrollView.node.height : content.parent.height;
            content.height = Math.max(
                v7ViewportHeight,
                v7MessageTop + label.node.height + v7MessageBottomPadding
            );
            scrollView.stopAutoScroll();
            scrollView.scrollToTop(0);
        },0);
    }
    public UserHash2Info(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        if(data == null)
            return;
        let info = data["UserHash2Info"];
        let strKey:string = info["key"];
        let strContent:string = info["content"];
        let context:string = info["context"];
        if(context === "查询_处罚记录")
        {
            
            Tool.GetChild(this.node,"公告7/list/view/content/msg").getComponent(cc.Label).string = Tool.Base64Decode(strContent);
            
        }
    }
    public set_client_status()
    {
        let client_status = GameDataManager.getAccount().client_status;
        if(client_status == "")
        {
            UIManager.getInstance().closePanelByName("panelLoginErrorEx",ClosePanelMode.Top);            
        }
        else
        {
            UIManager.getInstance().showPanel("panelLoginErrorEx",ShowPanelMode.Top,client_status);          
            
        }
    }
    public AccountProp(strMsg:string)
    {
        let json = JSON.parse(strMsg);
        if(json == null)
            return;

        let context = json["context"];
        let result_name = json["result_name"];
        let result_value = json["result_value"];

        if(context === "名字查重")
        {
            let bCanChange = false;
            
            if(result_value.length <= 0)
            {
                bCanChange = true;
            }
            else if(result_value.length == 1)
            {
                if(result_value[0] == GameDataManager.getAccount().guuid)
                {
                    bCanChange = true;
                }
            }

            if(bCanChange)
            {
                if(Tool.GetChild(this.node,"修改个人信息").active)
                {
                    let strName = Tool.GetChild(this.node,"修改个人信息/昵称").getComponent(cc.EditBox).string;
                    if(strName == "")
                    {
                        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称不能为空！");
                        return; 
                    }
                    if(strName.length>10)
                    {
                        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称太长！");
                        return; 
                    }

                    //名字只能是中文数字英文
                    if(!strName.match(new RegExp('^[A-Za-z0-9\u3400-\u4DBF\u4E00-\u9FFF]+$')))
                    {
                        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称只能使用中文、英文字母或数字！");
                        return; 
                    }

                    //是否选择头像
                    let imgName = Tool.GetChild(this.node,"修改个人信息/头像/name").getComponent(cc.Label).string;

                    if(imgName == "")
                    {
                       //UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请选择头像");
                                   //是否选择头像
                        this.node.getChildByName("确定随机头像提示面板").active = true;
                        return; 
                    }
        
        
                    this.ApplyProfileChange(strName,imgName);
                }
                else if(Tool.GetChild(this.node,"修改个人信息2").active)
                {
                    let strName = Tool.GetChild(this.node,"修改个人信息2/昵称").getComponent(cc.EditBox).string;
                    let imgName = Tool.GetChild(this.node,"修改个人信息2/头像/name").getComponent(cc.Label).string;
                    let selectedAvatar = ImageManager.getInstance().NormalizeAvatarIndex(imgName);
                    let currentAvatar = this.EnsureAccountAvatar();
                    if(selectedAvatar != currentAvatar)
                    {
                        this.QueuePaidAvatarChange(strName,selectedAvatar);
                        return;
                    }
                    this.ApplyProfileChange(strName,selectedAvatar);
                }
            }
            else
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"名字已被占用！");
            }
        }
    }

    //----------------------测试分布代码-------------------
    private MoveItemPos(item:cc.Node)
    {
        Tool.GetChild(this.node,"Main/我的/功能").active = false;

        let arrayPos = []
        //if(Number(strLevel)>=50)
       // {
            arrayPos = [[0,227],[215.88,70.14],[133.42,-183.64],[-133.42,-183.64],[-215.88,70.14]]
        // }
        // else
        // {
        //     arrayPos = [[0,227],[227,0],[0,-227],[-227,0]];
        // }
        let nPos = 0;
        for(let i=0;i<arrayPos.length;i++)
        {
            let one = arrayPos[i]
            if(Math.abs(one[0] - item.x)<=1 && Math.abs(one[1] - item.y)<=1)
            {
                nPos = i
                break;
            }
        }




        let nDir = 0; //方向
        if(nPos<=2)
        {
            nDir = 0
        }
        else
        {
            nDir = -1
        }
        if(arrayPos.length >4)
        {
            if(nPos == 3)
            nPos = 2
        }
        else
        {
            if(nPos == 3)
            nPos = 1
        }

        if(nPos == 4)
            nPos = 1

        let maxLen = arrayPos.length-1;

        //开始全体转
        for(let one of item.parent.children)
        {
            //找到one 的位置
            let nSelfPos = 0;
            for(let i=0;i<arrayPos.length;i++)
            {
                let temp = arrayPos[i]
                if(Math.abs(temp[0] - one.x)<=1 && Math.abs(temp[1] - one.y)<=1)
                {
                    nSelfPos = i
                    break;
                }
            }

            let arrayAction = [];
            let lastPos = [];
            let tempArray = []
            for(let i=1;i<=nPos;i++) //连续转几次
            {
                //下一个位置
                let nextPos = [];
                if(nDir == 0) //逆时针
                {
                    let nNextPos = nSelfPos-i;
                    if(nNextPos<0)
                    {
                        nNextPos = maxLen+nNextPos+1
                    }
                    nextPos = arrayPos[nNextPos];
                    tempArray.push(nNextPos)
                }
                else{ //顺时针
                    let nNextPos = nSelfPos+i;
                    if(nNextPos>maxLen)
                    {
                        if(nNextPos == 5)
                            nNextPos = 0
                        else if(nNextPos == 6)
                            nNextPos = 1
                        else if(nNextPos == 7)
                            nNextPos = 3
                        else if(nNextPos == 4)
                            nNextPos = 0
                        else 
                            nNextPos = 4
                    }
                    nextPos = arrayPos[nNextPos];
                    tempArray.push(nNextPos)
                }   
                arrayAction.push(cc.moveTo(0.3,cc.v2(nextPos[0],nextPos[1])))
                lastPos = nextPos;
                
            }
            arrayAction.push(cc.callFunc(()=>{
                one.x = lastPos[0];
                one.y = lastPos[1];
                //显示菜单  
                this.ShowToolMenu(item.name)
            }))
            if(arrayAction.length>1)
                one.runAction(cc.sequence(arrayAction));
            else
                this.ShowToolMenu(item.name)
            
        }
    }
    private ShowToolMenu(strName:string)
    {
        strName = strName.replace('a','');        
        Tool.GetChild(this.node,"Main/我的/功能").active = true;
        for(let one of Tool.GetChild(this.node,"Main/我的/功能").children)
        {
            if(one.name === strName)
            {
                one.active = true;
            }
            else
            {
                one.active = false
            }
        }
        
    }
    public openGG8()
    {
        this.node.getChildByName("公告8").active = true;

        ConfigManager.getInstance().GetOneHashKey("充值提现公告","公告8");
        
    }
    //查询惩罚公告
    public GetCFNotifyInfo(nPage:number = 1)
    {
        Tool.HTTP_GET("http://"+WEB_TX_IP+"/fmis/DataGamePunishs/getitems?pagetotal=10&pageindex="+nPage,(ret)=>{
            Debug.Log(ret)
            if(ret.status == 200)
            {
                let jRet = JSON.parse(ret.response)
                Debug.Log(jRet)
                this.OnCFNotifyReturn(ret.response)
            }
        },(err)=>{
            UIManager.getInstance().closePanelByName("panelLoading",ClosePanelMode.Top);
            // UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"支付网络异常！")
        })
    }

    public OnCFNotifyReturn(strMsg:string)
    {
        this.scrollCFNotify.UpdateList(strMsg,"data","惩罚公告对象",this.PAGE_PER_COUNT,this.setCFNotifyItem.bind(this));
    }
    public setCFNotifyItem(node:cc.Node,jItem:any)
    {
        node.active = true
        //刷新数据
        let arrayAll = node.children

        let i =0
        for(;i<jItem["UUIDS"].length;i++)
        {
            arrayAll[i].active = true
            let one = jItem["UUIDS"][i]
            Tool.GetChild(arrayAll[i],"name").getComponent(cc.Label).string = one["UUID"]+" "+one["NAME"]
            Tool.GetChild(arrayAll[i],"type").getComponent(cc.Label).string = i==0?jItem["REASON_INFO"]:""
            Tool.GetChild(arrayAll[i],"result").getComponent(cc.Label).string = i==0?jItem["RESULT_INFO"]:""
        }

        Tool.GetChild(node,"时间/txt").getComponent(cc.Label).string = jItem["CREATE_TIME"]
        //多余的隐藏
        for(;i<arrayAll.length;i++)
        {
            if(arrayAll[i].name == "分隔线" || arrayAll[i].name == "时间")
                continue
            arrayAll[i].active = false
        }
    }
}
