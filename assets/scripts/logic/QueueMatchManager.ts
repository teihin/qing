import UIManager from "../common/UIManager";
import { ShowPanelMode } from "../common/GameDef";
import WebSceneLoader from "../common/WebSceneLoader";

var KBEngine = require("kbengine");

const {ccclass} = cc._decorator;

export interface QueueMatchMember {
    id:string;
    name:string;
    photo:string;
    rank:number;
    isSelf:boolean;
    online:number;
    queueSeconds:number;
    queueTime:string;
    bottom:string;
    status:string;
}

export interface QueueMatchSnapshot {
    status:string;
    queueActive:boolean;
    busy:boolean;
    rank:number;
    queueCount:number;
    assignFailCount:number;
    queueId:string;
    roomID:number;
    site:number;
    leftSeconds:number;
    message:string;
    members:QueueMatchMember[];
    listCount:number;
    listLoading:boolean;
    listMessage:string;
    listUpdatedAt:number;
}

interface QueuePreSitReservation {
    queueId:string;
    roomID:number;
    site:number;
    accepted:boolean;
    playerListConfirmed:boolean;
    expiresAt:number;
}

type QueueCommand = "" | "apply" | "cancel" | "query";
type SwitchPhase = "idle" | "leaving" | "transition" | "entering" | "pre_sitting" | "waiting_room_scene" | "reconciling";

/**
 * 排队撮合和快速换房必须跨越 login、roomTransition、drh8 三个场景，
 * 因此由常驻组件统一持有状态和消费进退房回包。
 */
@ccclass
export default class QueueMatchManager extends cc.Component {
    private static instance:QueueMatchManager = null;

    private initialized:boolean = false;
    private pendingCommand:QueueCommand = "";
    private pendingCommandToken:number = 0;
    private switchPhase:SwitchPhase = "idle";
    private switchGeneration:number = 0;
    private queueActive:boolean = false;
    private status:string = "none";
    private rank:number = 0;
    private queueCount:number = 0;
    private assignFailCount:number = 0;
    private queueId:string = "";
    private targetRoomID:number = 0;
    private targetSite:number = -1;
    private leftSeconds:number = 0;
    private message:string = "";
    private pendingRoomNotice:string = "";
    private members:QueueMatchMember[] = [];
    private listCount:number = 0;
    private listLoading:boolean = false;
    private listMessage:string = "";
    private listRoomID:number = 0;
    private listRequestToken:number = 0;
    private listRequestSilent:boolean = false;
    private listUpdatedAt:number = 0;
    private reservation:QueuePreSitReservation = null;
    private lastPreSitQueueId:string = "";
    private switchDeadline:number = 0;
    private recoveringSwitch:boolean = false;
    private disconnectedDuringSwitch:boolean = false;
    private recoveryToken:number = 0;

    public static getInstance():QueueMatchManager
    {
        if(QueueMatchManager.instance == null)
        {
            let node = new cc.Node("QueueMatchManager");
            cc.game.addPersistRootNode(node);
            QueueMatchManager.instance = node.addComponent(QueueMatchManager);
        }
        QueueMatchManager.instance.initialize();
        return QueueMatchManager.instance;
    }

    onLoad()
    {
        QueueMatchManager.instance = this;
        this.initialize();
    }

    private initialize()
    {
        if(this.initialized)
            return;
        this.initialized = true;
        KBEngine.Event.register("QueueMatchInfo", this, "onQueueMatchInfo");
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
        KBEngine.Event.register("onLeaveRoom", this, "onLeaveRoom");
        KBEngine.Event.register("onEnterRoom", this, "onEnterRoom");
        KBEngine.Event.register("onRoomCommand", this, "onRoomCommand");
        KBEngine.Event.register("onLoginSuccessfully", this, "onLoginSuccessfully");
        KBEngine.Event.register("onReloginBaseappSuccessfully", this, "onReloginSuccessfully");
        KBEngine.Event.register("onDisconnected", this, "onDisconnected");
        KBEngine.Event.register("onKicked", this, "onKicked");

        // 场景极小，提前预加载可以把房间内快速切换的额外耗时降到最低。
        cc.director.preloadScene("roomTransition", null, (error:any)=>{
            if(error)
                cc.warn("预加载快速换房场景失败", error);
        });
    }

    onDestroy()
    {
        KBEngine.Event.deregisterAll(this);
        this.unscheduleAllCallbacks();
        if(QueueMatchManager.instance === this)
            QueueMatchManager.instance = null;
    }

    public getSnapshot():QueueMatchSnapshot
    {
        return {
            status: this.status,
            queueActive: this.queueActive,
            busy: this.pendingCommand != "" || this.isSwitching(),
            rank: this.rank,
            queueCount: this.queueCount,
            assignFailCount: this.assignFailCount,
            queueId: this.queueId,
            roomID: this.targetRoomID,
            site: this.targetSite,
            leftSeconds: this.leftSeconds,
            message: this.message,
            members: this.members.slice(0),
            listCount: this.listCount,
            listLoading: this.listLoading,
            listMessage: this.listMessage,
            listUpdatedAt: this.listUpdatedAt
        };
    }

    public isHandlingRoomNavigation():boolean
    {
        return this.switchPhase != "idle";
    }

    public requestApply(currentRoomID:any):boolean
    {
        if(this.pendingCommand != "" || this.queueActive || this.isSwitching())
            return false;
        let roomID = Number(currentRoomID);
        if(!isFinite(roomID) || roomID <= 0)
        {
            this.setMessage("当前不在可排队的房间中");
            return false;
        }
        let account = this.getAccount();
        if(account == null)
        {
            this.setMessage("游戏连接尚未就绪");
            return false;
        }

        this.queueId = "";
        this.targetRoomID = 0;
        this.targetSite = -1;
        this.reservation = null;
        this.lastPreSitQueueId = "";
        this.status = "applying";
        this.message = "正在申请排队…";
        this.beginCommand("apply");
        account.reqHallCommand(JSON.stringify({
            header: "申请_排队_撮合",
            roomType: "Custom",
            roomID: roomID
        }), "p@queue_match");
        this.emitState();
        return true;
    }

    public requestCancel():boolean
    {
        if(this.pendingCommand != "" || !this.queueActive || this.isSwitching())
            return false;
        let account = this.getAccount();
        if(account == null)
            return false;
        this.status = "cancelling";
        this.message = "正在取消排队…";
        this.beginCommand("cancel");
        account.reqHallCommand(JSON.stringify({
            header: "取消_排队_撮合"
        }), "p@queue_match_cancel");
        this.emitState();
        return true;
    }

    public requestQuery(silent:boolean = false):boolean
    {
        if(this.pendingCommand != "")
            return false;
        let account = this.getAccount();
        if(account == null)
            return false;
        if(!silent)
        {
            this.message = "正在查询排队状态…";
            this.emitState();
        }
        this.beginCommand("query");
        account.reqHallCommand(JSON.stringify({
            header: "查询_排队_撮合"
        }), "p@queue_match_query");
        return true;
    }

    /** 查询当前参考房间同组的真实排队名单，与单人排队状态查询相互独立。 */
    public requestList(currentRoomID:any, silent:boolean = false):boolean
    {
        if(this.listLoading)
            return false;
        let roomID = Number(currentRoomID);
        if(!isFinite(roomID) || roomID <= 0)
        {
            if(!silent)
            {
                this.listMessage = "当前房间信息无效";
                this.members = [];
                this.listCount = 0;
                this.listUpdatedAt = 0;
                this.emitState();
            }
            return false;
        }
        let account = this.getAccount();
        if(account == null)
        {
            if(!silent)
            {
                this.listMessage = "游戏连接尚未就绪";
                this.emitState();
            }
            return false;
        }

        this.listRoomID = roomID;
        this.listLoading = true;
        this.listRequestSilent = silent;
        this.listMessage = "";
        if(!silent)
        {
            this.members = [];
            this.listCount = 0;
            this.listUpdatedAt = 0;
        }
        let token = ++this.listRequestToken;
        account.reqHallCommand(JSON.stringify({
            header: "查询_排队_列表",
            roomType: "Custom",
            roomID: roomID,
            page: 0,
            count: 30
        }), "p@queue_match_list");
        if(!silent)
            this.emitState();
        this.scheduleOnce(()=>{
            if(!this.listLoading || token != this.listRequestToken)
                return;
            this.listLoading = false;
            this.listRequestSilent = false;
            if(!silent)
            {
                this.listMessage = "排队名单加载超时，请重新打开";
                this.emitState();
            }
        }, 10);
        return true;
    }

    public onRoomViewReady()
    {
        let account = this.getAccount();
        let roomID = account == null ? 0 : Number(account.roomID);
        if(this.switchPhase == "waiting_room_scene" && roomID == this.targetRoomID)
            this.switchPhase = "idle";
        let reservation = this.getReservationForRoom(roomID);
        if(reservation != null)
            KBEngine.Event.fire("QueuePreSitReservation", this.copyReservation(reservation));
        this.emitState();
        if(this.pendingRoomNotice != "")
        {
            let notice = this.pendingRoomNotice;
            this.pendingRoomNotice = "";
            KBEngine.Event.fire("QueueMatchNotice", notice);
        }
    }

    public getReservationForRoom(roomID:any):any
    {
        if(this.reservation == null)
            return null;
        if(this.reservation.expiresAt <= Date.now())
        {
            this.reservation = null;
            return null;
        }
        if(Number(roomID) != this.reservation.roomID)
            return null;
        return this.copyReservation(this.reservation);
    }

    public consumeReservation(roomID:any, site:number)
    {
        if(this.reservation == null)
            return;
        if(this.reservation.roomID == Number(roomID) && this.reservation.site == site)
        {
            // PlayerList 和预坐成功回包没有固定先后顺序。PlayerList 先到时只能
            // 记录座位已经展示。本人已出现在目标座位就是预坐成功的
            // 权威事实，排队流程应立即结束，不能等迟到的命令回包才刷新 UI。
            let commandAlreadyAccepted = this.reservation.accepted;
            this.reservation.playerListConfirmed = true;
            this.finishQueueAtPreSit();
            if(commandAlreadyAccepted)
                this.reservation = null;
            this.emitState();
        }
    }

    private copyReservation(reservation:QueuePreSitReservation):any
    {
        return {
            queueId: reservation.queueId,
            roomID: reservation.roomID,
            site: reservation.site,
            accepted: reservation.accepted,
            playerListConfirmed: reservation.playerListConfirmed === true
        };
    }

    private onLoginSuccessfully()
    {
        if(this.isSwitching())
            this.scheduleOnce(()=>this.beginSwitchReconciliation("正在恢复换房状态…"), 0.5);
        else
            this.scheduleOnce(()=>this.requestQuery(true), 1.0);
    }

    private onReloginSuccessfully()
    {
        if(this.isSwitching())
            this.scheduleOnce(()=>this.beginSwitchReconciliation("正在恢复换房状态…"), 0.2);
        else
            this.scheduleOnce(()=>this.requestQuery(true), 0.5);
    }

    private onDisconnected()
    {
        if(!this.isSwitching())
            return;
        this.switchGeneration++;
        this.pendingCommand = "";
        this.pendingCommandToken++;
        this.disconnectedDuringSwitch = true;
        this.recoveringSwitch = true;
        this.switchPhase = "reconciling";
        this.status = "switching";
        this.message = "网络已断开，正在等待重新连接…";
        let token = ++this.recoveryToken;
        this.emitState();
        // 普通重连仍由 GameDataManager 负责；这里只保证过渡页不会无限停留。
        this.scheduleOnce(()=>{
            if(token != this.recoveryToken || !this.disconnectedDuringSwitch || !this.isSwitching())
                return;
            this.finishSwitchReconciliation("网络连接超时，已退出快速换房");
        }, 30);
    }

    private onKicked()
    {
        this.clearAllState();
    }

    private beginCommand(command:QueueCommand)
    {
        this.pendingCommand = command;
        let token = ++this.pendingCommandToken;
        this.scheduleOnce(()=>{
            if(this.pendingCommandToken != token || this.pendingCommand == "")
                return;
            let timedOutCommand = this.pendingCommand;
            this.pendingCommand = "";
            if(timedOutCommand == "apply")
            {
                this.status = "none";
                this.message = "排队申请超时，请重试";
            }
            else if(timedOutCommand == "cancel")
            {
                this.status = this.queueActive ? "queued" : "none";
                this.message = "取消排队超时，请查询后重试";
            }
            else
            {
                this.message = this.queueActive ? "排队状态查询超时" : "";
            }
            if(timedOutCommand == "query" && this.recoveringSwitch)
            {
                this.finishSwitchReconciliation("换房状态确认超时，已退出快速换房");
                return;
            }
            this.emitState();
        }, 10);
    }

    private finishCommand():QueueCommand
    {
        let command = this.pendingCommand;
        this.pendingCommand = "";
        this.pendingCommandToken++;
        return command;
    }

    private onHallCommand(nCode:number, param:string)
    {
        let rawParam = param == null ? "" : param.toString();
        let envelope = this.parseEnvelope(param);
        let context = envelope == null || envelope.context == null ? "" : envelope.context.toString();
        if(context.indexOf("p@") == 0)
            context = context.substr(2);
        if(context == "queue_match_list" || rawParam.indexOf("queue_match_list") >= 0)
        {
            this.handleQueueListResponse(nCode, envelope);
            return;
        }
        if(this.pendingCommand == "")
            return;

        let expectedContext = this.pendingCommand == "apply" ? "queue_match" :
            (this.pendingCommand == "cancel" ? "queue_match_cancel" : "queue_match_query");
        if(context != "" && context != expectedContext)
            return;

        let payload = envelope == null ? null : this.unwrapPayload(envelope);
        if(payload == null)
        {
            // 其他大厅命令可能与排队查询并发返回，无法识别时不能误消费。
            if(rawParam.indexOf("排队_撮合") < 0 && rawParam.indexOf("queue_match") < 0)
                return;
            payload = {};
        }

        let status = payload.status == null ? "" : payload.status.toString();
        let looksLikeQueue = status == "accepted" || status == "queued" || status == "assigning" ||
            status == "none" || status == "cancelled" || status == "failed" ||
            rawParam.indexOf("排队_撮合") >= 0 || rawParam.indexOf("queue_match") >= 0;
        if(!looksLikeQueue)
            return;

        let command = this.finishCommand();
        if(nCode != 0x200)
        {
            this.handleCommandFailure(command, payload, nCode);
            return;
        }

        let shouldRefreshList = false;
        if(command == "apply")
        {
            if(status == "accepted")
            {
                shouldRefreshList = true;
                // matched 甚至预坐成功都可能早于 accepted，后到的申请回包不能复活已结束的队列。
                if(this.queueId == "" && (this.reservation == null ||
                    (!this.reservation.accepted && !this.reservation.playerListConfirmed)))
                {
                    this.queueActive = true;
                    this.status = "queued";
                    this.message = payload.message == null ? "已进入排队" : payload.message.toString();
                }
            }
            else
            {
                this.queueActive = false;
                this.status = "failed";
                this.message = this.payloadMessage(payload, "当前状态不能排队");
            }
        }
        else if(command == "cancel")
        {
            if(status == "cancelled")
            {
                shouldRefreshList = true;
                this.clearQueueState();
                this.message = "已取消排队";
            }
            else
            {
                this.status = this.queueActive ? "queued" : "none";
                this.message = this.payloadMessage(payload, "取消排队失败");
            }
        }
        else if(command == "query")
        {
            this.applyQueryPayload(payload);
        }
        this.emitState();
        // 只在服务端确认申请/取消成功后刷新，保证弹窗中的名单反映最新队列；
        // 失败回包保留当前名单，避免无意义请求覆盖可见的服务端错误。
        if(shouldRefreshList)
            this.refreshListAfterOperation();
    }

    private handleQueueListResponse(nCode:number, envelope:any)
    {
        if(!this.listLoading)
            return;
        this.listLoading = false;
        let silent = this.listRequestSilent;
        this.listRequestSilent = false;
        this.listRequestToken++;
        let payload = envelope == null ? null : this.unwrapPayload(envelope);
        if(payload != null && payload.context == "queue_match_list" &&
            payload.result != null && !Array.isArray(payload.result))
            payload = this.unwrapPayload(payload);
        if(nCode != 0x200 || payload == null || payload.status == "failed")
        {
            if(!silent)
            {
                this.members = [];
                this.listCount = 0;
                this.listUpdatedAt = 0;
                this.listMessage = this.payloadMessage(payload, this.serverError(nCode, "排队名单加载失败"));
                this.emitState();
            }
            return;
        }
        this.members = this.parseMembers(payload.result);
        this.listCount = this.safeNumber(payload.count, this.safeNumber(payload.queue_count, this.members.length));
        this.listMessage = "";
        this.listUpdatedAt = Date.now();
        this.emitState();
    }

    private refreshListAfterOperation()
    {
        if(this.listRoomID <= 0)
            return;
        let roomID = this.listRoomID;
        let retry = (left:number)=>{
            if(this.requestList(roomID) || left <= 0)
                return;
            this.scheduleOnce(()=>retry(left - 1), 0.5);
        };
        this.scheduleOnce(()=>retry(22), 0.3);
    }

    private handleCommandFailure(command:QueueCommand, payload:any, nCode:number)
    {
        if(command == "apply")
        {
            this.queueActive = false;
            this.status = "failed";
        }
        else if(command == "cancel")
        {
            this.status = this.queueActive ? "queued" : "none";
        }
        this.message = this.payloadMessage(payload, this.serverError(nCode, "排队操作失败"));
        this.emitState();
    }

    private applyQueryPayload(payload:any)
    {
        let status = payload.status == null ? "none" : payload.status.toString();
        this.rank = this.safeNumber(payload.rank, 0);
        this.queueCount = this.safeNumber(payload.queue_count, 0);
        this.assignFailCount = this.safeNumber(payload.assign_fail_count, 0);
        this.leftSeconds = this.safeNumber(payload.left_seconds, 0);
        this.message = payload.message == null ? "" : payload.message.toString();

        if(this.recoveringSwitch)
        {
            this.reconcileSwitchPayload(payload, status);
            return;
        }

        if(status == "queued")
        {
            this.queueActive = true;
            this.status = "queued";
            return;
        }
        if(status == "assigning")
        {
            this.queueActive = true;
            this.handleMatched(payload);
            return;
        }
        if(status == "none" && !this.isSwitching())
        {
            this.clearQueueState();
            return;
        }
        if(status == "failed")
        {
            this.queueActive = false;
            this.status = "failed";
            this.message = this.payloadMessage(payload, "排队失败，请重新申请");
        }
    }

    private onQueueMatchInfo(strMsg:string)
    {
        let payload = this.parsePayload(strMsg);
        if(payload == null || payload.status == null)
            return;
        let status = payload.status.toString();
        if(status == "matched")
        {
            // 允许 matched 早于 accepted；取消完成后的旧推送则不再接受。
            if(!this.queueActive && this.status != "applying")
                return;
            this.handleMatched(payload);
            this.emitState();
        }
        else if(status == "failed")
        {
            let failedQueueId = payload.queue_id == null ? "" : payload.queue_id.toString();
            if(failedQueueId != "" && this.queueId != "" && failedQueueId != this.queueId)
                return;
            this.switchGeneration++;
            this.switchPhase = "idle";
            this.queueActive = false;
            this.status = "failed";
            this.assignFailCount = this.safeNumber(payload.assign_fail_count, this.assignFailCount);
            this.message = this.payloadMessage(payload, "排队失败，请重新申请");
            this.queueId = "";
            this.reservation = null;
            this.lastPreSitQueueId = "";
            this.emitState();
            KBEngine.Event.fire("QueueMatchNotice", this.message);
        }
    }

    private handleMatched(payload:any)
    {
        let queueId = payload.queue_id == null ? "" : payload.queue_id.toString();
        let roomID = this.safeNumber(payload.roomID, 0);
        let site = this.safeNumber(payload.site, -1);
        if(queueId == "" || roomID <= 0 || site < 0)
        {
            this.message = "匹配通知参数不完整，正在重新查询";
            this.scheduleOnce(()=>this.requestQuery(true), 0.5);
            return;
        }
        if(this.isSwitching() && queueId == this.queueId)
            return;

        this.queueActive = true;
        this.status = "assigning";
        this.queueId = queueId;
        this.targetRoomID = roomID;
        this.targetSite = site;
        let hasLeftSeconds = payload.left_seconds != null;
        this.leftSeconds = this.safeNumber(payload.left_seconds, this.safeNumber(payload.timeout, 0));
        let timeoutSeconds = hasLeftSeconds ? Math.max(1, this.leftSeconds) : this.safeNumber(payload.timeout, 10);
        this.switchDeadline = Date.now() + Math.max(3, timeoutSeconds) * 1000 + 2000;
        this.assignFailCount = this.safeNumber(payload.assign_fail_count, this.assignFailCount);
        this.message = "已匹配座位，正在快速进入房间";

        let account = this.getAccount();
        if(account == null)
            return;
        let currentRoomID = Number(account.roomID);
        let generation = ++this.switchGeneration;
        this.armSwitchWatchdog(generation);
        if(currentRoomID == roomID)
        {
            if(this.lastPreSitQueueId == queueId)
            {
                // 已发送过同一个queue_id的预坐时只等待服务端过期或新分配，
                // 防卡对账不能变成客户端自行重试同一座位。
                this.switchPhase = "pre_sitting";
                this.status = "pre_sitting";
                this.message = "正在确认座位状态…";
            }
            else
                this.beginQueuePreSit();
            if(this.currentSceneName() != "drh8")
                this.loadTargetRoomScene(generation);
            return;
        }

        if(currentRoomID > 0)
        {
            this.switchPhase = "leaving";
            this.status = "switching";
            try { account.reqStopGame(); } catch(error) {}
            account.reqLeaveRoom();
            this.message = "正在离开当前房间…";
            return;
        }
        this.switchPhase = "entering";
        this.status = "switching";
        this.requestEnterTarget(generation);
    }

    private onLeaveRoom(nCode:number)
    {
        if(this.switchPhase != "leaving")
            return;
        let generation = this.switchGeneration;
        if(nCode != 0x200)
        {
            this.switchPhase = "idle";
            this.status = "queued";
            this.message = "离开当前房间失败，继续等待匹配";
            this.emitState();
            this.scheduleOnce(()=>this.requestQuery(true), 0.5);
            return;
        }

        this.switchPhase = "transition";
        this.status = "switching";
        this.message = "正在快速切换房间…";
        this.emitState();
        let started = WebSceneLoader.loadScene("roomTransition", (error:any)=>{
            if(generation != this.switchGeneration)
                return;
            if(error)
            {
                this.failTargetRoom("快速换房场景加载失败");
                return;
            }
            this.prepareTransitionView();
            let imageManagerModule = require("./ImageManager");
            let imageManagerClass = imageManagerModule == null ? null : imageManagerModule.default;
            if(imageManagerClass != null && imageManagerClass.instance != null)
                imageManagerClass.instance.ReleaseInvalidSceneReferences();
            this.switchPhase = "entering";
            this.requestEnterTarget(generation);
        },()=>generation == this.switchGeneration && this.switchPhase == "transition");
        if(!started)
            this.failTargetRoom("快速换房场景正在加载，请重试");
    }

    private requestEnterTarget(generation:number)
    {
        if(generation != this.switchGeneration)
            return;
        let account = this.getAccount();
        if(account == null)
        {
            this.failTargetRoom("游戏连接已断开");
            return;
        }
        account.reqEnterRoom("Custom", this.targetRoomID, "{{\"special_rule\": \"观战\"}}");
    }

    private onEnterRoom(nCode:number, nRoomID:number)
    {
        if(this.switchPhase != "entering")
            return;
        if(Number(nRoomID) != this.targetRoomID)
        {
            // 上一次分配的迟到回包不能判定当前新分配失败，先查询服务端权威队列状态。
            this.beginSwitchReconciliation("房间状态已变化，正在重新确认…");
            return;
        }
        if(nCode != 0x200)
        {
            this.failTargetRoom(this.serverError(nCode, "进入匹配房间失败"));
            return;
        }

        this.beginQueuePreSit();
        if(this.currentSceneName() != "drh8")
            this.loadTargetRoomScene(this.switchGeneration);
    }

    private loadTargetRoomScene(generation:number)
    {
        let started = WebSceneLoader.loadScene("drh8", (error:any)=>{
            if(generation != this.switchGeneration)
                return;
            if(error)
            {
                this.failTargetRoom("牌桌场景加载失败");
                return;
            }
            UIManager.getInstance().ResetBase();
            this.switchPhase = this.reservation == null ? "idle" : "waiting_room_scene";
            this.onRoomViewReady();
        },()=>generation == this.switchGeneration && this.switchPhase != "idle");
        if(!started)
            this.failTargetRoom("牌桌场景正在加载，请重试");
    }

    private beginQueuePreSit()
    {
        let account = this.getAccount();
        if(account == null)
            return;
        this.switchPhase = "pre_sitting";
        this.status = "pre_sitting";
        this.message = "正在为你预留座位…";
        this.reservation = {
            queueId: this.queueId,
            roomID: this.targetRoomID,
            site: this.targetSite,
            accepted: false,
            playerListConfirmed: false,
            expiresAt: Date.now() + 30000
        };
        this.lastPreSitQueueId = this.queueId;
        KBEngine.Event.fire("QueuePreSitReservation", this.copyReservation(this.reservation));
        account.reqRoomCommand(JSON.stringify({
            header: "预坐_事件",
            site: this.targetSite,
            queue_id: this.queueId
        }), "queue_pre_site");
        this.emitState();
    }

    private onRoomCommand(nCode:number, param:string)
    {
        if(param == null)
            return;
        let matchedQueuePreSit = param.indexOf("queue_pre_site") >= 0 ||
            (this.queueId != "" && param.indexOf(this.queueId) >= 0);
        // PlayerList 可能先于命令回包确认预坐。此时快速换房已经结束，
        // 但仍要消费同一个预约的迟到回包，不能因 switchPhase 已归零而遗漏。
        let playerListConfirmed = this.reservation != null && this.reservation.playerListConfirmed;
        if(!matchedQueuePreSit || (this.switchPhase != "pre_sitting" && !playerListConfirmed))
            return;

        if(nCode == 0x200)
        {
            // 先保存稳定引用。真实网络中 PlayerList 可能早于本回包到达，任何
            // 清理动作都不能让随后派发的成功事件再去复制 null。
            let acceptedReservation = this.reservation;
            if(acceptedReservation != null)
            {
                acceptedReservation.accepted = true;
                acceptedReservation.expiresAt = Date.now() + 20000;
            }
            // 服务端确认排队预坐成功即代表撮合结束，带入不再属于排队流程。
            this.finishQueueAtPreSit();
            if(acceptedReservation != null)
            {
                KBEngine.Event.fire("QueuePreSitAccepted", this.copyReservation(acceptedReservation));
                if(acceptedReservation.playerListConfirmed && this.reservation === acceptedReservation)
                    this.reservation = null;
            }
            else
                cc.warn("排队预坐成功时预约状态已提前清理", this.queueId);
        }
        else
        {
            let failedOutsideRoomScene = this.currentSceneName() != "drh8";
            this.reservation = null;
            this.switchPhase = "idle";
            this.queueActive = true;
            this.status = "queued";
            this.message = this.serverError(nCode, "占座失败，继续等待重新匹配");
            this.queueId = "";
            this.targetRoomID = 0;
            this.targetSite = -1;
            this.lastPreSitQueueId = "";
            if(failedOutsideRoomScene)
                this.pendingRoomNotice = this.message;
            KBEngine.Event.fire("QueuePreSitFailed", this.message);
            // 留在已进入的目标房间，不能查询到旧 assigning 后自行重试同一座位；
            // 后续只消费服务端重新分配的下一条 QueueMatchInfo matched。
        }
        this.emitState();
    }

    /** PlayerList 或预坐回包任一确认占座后，统一结束本地排队展示。 */
    private finishQueueAtPreSit()
    {
        this.queueActive = false;
        this.status = "none";
        this.message = "匹配成功，请选择带入分数";
        this.rank = 0;
        this.queueCount = 0;
        this.assignFailCount = 0;
        this.lastPreSitQueueId = "";
        this.switchDeadline = 0;
        this.switchPhase = this.currentSceneName() == "drh8" ? "idle" : "waiting_room_scene";
    }

    private armSwitchWatchdog(generation:number)
    {
        let delaySeconds = Math.max(1, (this.switchDeadline - Date.now()) / 1000);
        this.scheduleOnce(()=>{
            if(generation != this.switchGeneration || !this.queueActive || !this.isSwitching())
                return;
            this.beginSwitchReconciliation("换房等待超时，正在确认当前状态…");
        }, delaySeconds);
    }

    private beginSwitchReconciliation(message:string)
    {
        if(!this.isSwitching())
            return;
        this.switchGeneration++;
        this.recoveryToken++;
        this.disconnectedDuringSwitch = false;
        this.recoveringSwitch = true;
        this.switchPhase = "reconciling";
        this.status = "switching";
        this.message = message;
        // 断线前或 matched 早于 accepted 时可能还挂着旧命令；上下文严格路由后
        // 可以安全废弃它，避免阻塞这次权威状态查询。
        this.pendingCommand = "";
        this.pendingCommandToken++;
        this.emitState();
        if(!this.requestQuery(true))
        {
            let token = this.recoveryToken;
            this.scheduleOnce(()=>{
                if(token == this.recoveryToken && this.recoveringSwitch)
                    this.finishSwitchReconciliation("无法确认换房状态，已退出快速换房");
            }, 3);
        }
    }

    private reconcileSwitchPayload(payload:any, status:string)
    {
        this.recoveringSwitch = false;
        this.disconnectedDuringSwitch = false;
        this.recoveryToken++;
        if(status == "assigning")
        {
            this.switchPhase = "idle";
            this.handleMatched(payload);
            return;
        }

        this.reservation = null;
        this.lastPreSitQueueId = "";
        this.queueId = "";
        this.targetRoomID = 0;
        this.targetSite = -1;
        this.leftSeconds = 0;
        if(status == "queued")
        {
            this.queueActive = true;
            this.status = "queued";
            this.message = this.payloadMessage(payload, "本次座位已失效，继续等待重新匹配");
        }
        else if(status == "failed")
        {
            this.queueActive = false;
            this.status = "failed";
            this.message = this.payloadMessage(payload, "排队失败，请重新申请");
        }
        else
        {
            this.clearQueueState();
            this.message = "本次排队已结束";
        }
        this.finishSwitchReconciliation(this.message);
    }

    /**
     * 查询仍失败或服务端分配已经失效时，以账号当前 roomID 决定回到牌桌还是大厅。
     * 不重发旧的进房/预坐请求，避免与迟到回包竞争。
     */
    private finishSwitchReconciliation(message:string)
    {
        this.switchGeneration++;
        this.recoveryToken++;
        this.recoveringSwitch = false;
        this.disconnectedDuringSwitch = false;
        this.switchDeadline = 0;
        this.reservation = null;
        this.lastPreSitQueueId = "";
        this.pendingCommand = "";
        this.pendingCommandToken++;
        if(this.queueActive && this.status != "failed")
            this.status = "queued";
        this.message = message;
        this.emitState();

        let account = this.getAccount();
        let currentRoomID = account == null ? 0 : Number(account.roomID);
        if(this.currentSceneName() == "roomTransition")
        {
            let sceneName = currentRoomID > 0 ? "drh8" : "login";
            this.switchPhase = "waiting_room_scene";
            let started = WebSceneLoader.loadScene(sceneName, (error:any)=>{
                this.switchPhase = "idle";
                if(error)
                {
                    if(sceneName != "login")
                        WebSceneLoader.loadScene("login");
                    return;
                }
                UIManager.getInstance().ResetBase();
                if(sceneName == "drh8")
                    this.onRoomViewReady();
                if(sceneName == "login")
                    UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, message);
                else
                    KBEngine.Event.fire("QueueMatchNotice", message);
                this.scheduleOnce(()=>this.requestQuery(true), 0.5);
            });
            if(!started)
            {
                this.switchPhase = "idle";
                KBEngine.Event.fire("QueueMatchNotice", message);
            }
        }
        else
        {
            this.switchPhase = "idle";
            this.emitState();
            KBEngine.Event.fire("QueueMatchNotice", message);
            this.scheduleOnce(()=>this.requestQuery(true), 0.5);
        }
    }

    private failTargetRoom(message:string)
    {
        this.switchGeneration++;
        this.switchPhase = "idle";
        this.reservation = null;
        this.lastPreSitQueueId = "";
        this.status = this.queueActive ? "queued" : "none";
        this.message = message;
        this.emitState();
        if(this.currentSceneName() == "roomTransition")
        {
            WebSceneLoader.loadScene("login", ()=>{
                UIManager.getInstance().ResetBase();
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, message);
                this.scheduleOnce(()=>this.requestQuery(true), 0.5);
            });
        }
        else
        {
            KBEngine.Event.fire("QueueMatchNotice", message);
            this.scheduleOnce(()=>this.requestQuery(true), 0.5);
        }
    }

    /** 过渡画面节点全部放在 roomTransition.fire，这里仅处理长屏背景覆盖。 */
    private prepareTransitionView()
    {
        let canvas = cc.find("Canvas");
        if(canvas == null)
            return;

        let background = canvas.getChildByName("过渡背景");
        if(background != null)
        {
            let visibleSize = cc.view.getVisibleSize();
            let coverScale = Math.max(visibleSize.width / 750, visibleSize.height / 1334);
            background.setScale(coverScale);
        }
    }

    private emitState()
    {
        KBEngine.Event.fire("QueueMatchStateChanged", this.getSnapshot());
    }

    private setMessage(message:string)
    {
        this.message = message;
        this.emitState();
        KBEngine.Event.fire("QueueMatchNotice", message);
    }

    private clearQueueState()
    {
        this.queueActive = false;
        this.status = "none";
        this.rank = 0;
        this.queueCount = 0;
        this.assignFailCount = 0;
        this.queueId = "";
        this.targetRoomID = 0;
        this.targetSite = -1;
        this.leftSeconds = 0;
        this.lastPreSitQueueId = "";
    }

    private clearAllState()
    {
        this.switchGeneration++;
        this.switchPhase = "idle";
        this.pendingCommand = "";
        this.pendingCommandToken++;
        this.reservation = null;
        this.pendingRoomNotice = "";
        this.message = "";
        this.listLoading = false;
        this.listRequestSilent = false;
        this.listRequestToken++;
        this.listRoomID = 0;
        this.listMessage = "";
        this.listCount = 0;
        this.members = [];
        this.listUpdatedAt = 0;
        this.switchDeadline = 0;
        this.recoveringSwitch = false;
        this.disconnectedDuringSwitch = false;
        this.recoveryToken++;
        this.clearQueueState();
        this.emitState();
    }

    private isSwitching():boolean
    {
        return this.switchPhase != "idle";
    }

    private getAccount():any
    {
        try { return KBEngine.app == null ? null : KBEngine.app.player(); }
        catch(error) { return null; }
    }

    private currentSceneName():string
    {
        let scene = cc.director.getScene();
        return scene == null ? "" : scene.name;
    }

    private safeNumber(value:any, fallback:number):number
    {
        let numberValue = Number(value);
        return isFinite(numberValue) ? numberValue : fallback;
    }

    private parseQueueTimeSeconds(value:any):number
    {
        let text = value == null ? "" : value.toString().trim();
        if(text == "")
            return 0;
        if(text.indexOf(":") < 0)
        {
            let numberValue = Number(text);
            if(!isFinite(numberValue) || numberValue < 0)
                return 0;
            // 新接口的queue_time是入队Unix时间戳；同时兼容毫秒时间戳和
            // 少量旧接口直接返回“已经等待多少秒”的数字。
            if(numberValue > 100000000)
            {
                let timestampSeconds = numberValue > 100000000000 ? numberValue / 1000 : numberValue;
                return Math.max(0, Math.floor(Date.now() / 1000 - timestampSeconds));
            }
            return Math.max(0, Math.floor(numberValue));
        }
        let parts = text.split(":");
        let seconds = 0;
        for(let part of parts)
        {
            let amount = Number(part);
            if(!isFinite(amount) || amount < 0)
                return 0;
            seconds = seconds * 60 + Math.floor(amount);
        }
        return Math.max(0, seconds);
    }

    private formatQueueTime(seconds:number):string
    {
        let total = Math.max(0, Math.floor(seconds));
        let minutes = Math.floor(total / 60);
        let remain = total % 60;
        return minutes.toString() + ":" + (remain < 10 ? "0" : "") + remain.toString();
    }

    private parseOnlineStatus(value:any):number
    {
        if(value === undefined || value === null)
            return -1;
        if(value === true || value === 1)
            return 1;
        if(value === false || value === 0)
            return 0;
        let text = value.toString().trim().toLowerCase();
        if(text == "1" || text == "online" || text == "在线")
            return 1;
        if(text == "0" || text == "offline" || text == "离线")
            return 0;
        return -1;
    }

    private parsePayload(value:any):any
    {
        let envelope = this.parseEnvelope(value);
        return envelope == null ? null : this.unwrapPayload(envelope);
    }

    private parseEnvelope(value:any):any
    {
        if(value == null)
            return null;
        if(typeof value == "object")
            return value;
        let text = value.toString().trim();
        if(text == "")
            return null;
        try
        {
            return JSON.parse(text);
        }
        catch(error)
        {
            try { return JSON.parse(text.replace(/,\s*([}\]])/g, "$1")); }
            catch(secondError) { return null; }
        }
    }

    private unwrapPayload(payload:any):any
    {
        if(payload != null && payload.result != null)
        {
            if(typeof payload.result == "string")
            {
                try { return JSON.parse(payload.result); }
                catch(error) {}
            }
            if(typeof payload.result == "object")
                return payload.result;
        }
        return payload;
    }

    private parseMembers(value:any):QueueMatchMember[]
    {
        if(!Array.isArray(value))
            return [];
        let output:QueueMatchMember[] = [];
        for(let index = 0; index < value.length; index++)
        {
            let item = value[index] || {};
            let queueTime = (item.queue_time || "").toString();
            let hasQueueSeconds = item.queue_seconds !== undefined && item.queue_seconds !== null &&
                item.queue_seconds.toString() != "";
            let queueSeconds = hasQueueSeconds ?
                Math.max(0, Math.floor(this.safeNumber(item.queue_seconds, 0))) :
                this.parseQueueTimeSeconds(queueTime);
            if(queueTime == "")
                queueTime = this.formatQueueTime(queueSeconds);
            let bottom = (item.bottom || "").toString();
            if(bottom.match(/^\d+(\.\d+)?$/))
                bottom += "皮";
            output.push({
                id: (item.id || item.guuid || item.player_id || "").toString(),
                name: (item.name || item.nickname || item.player_name || "排队玩家").toString(),
                photo: (item.photo || item.avatar || "1").toString(),
                rank: this.safeNumber(item.rank, index + 1),
                isSelf: item.is_self === true || item.isSelf === true,
                online: this.parseOnlineStatus(item.online),
                queueSeconds: queueSeconds,
                queueTime: queueTime,
                bottom: bottom,
                status: (item.status || "排队中").toString()
            });
        }
        return output;
    }

    private payloadMessage(payload:any, fallback:string):string
    {
        if(payload != null)
        {
            if(payload.message != null && payload.message.toString() != "")
                return payload.message.toString();
            if(payload.error != null && payload.error.toString() != "")
                return payload.error.toString();
        }
        return fallback;
    }

    private serverError(code:number, fallback:string):string
    {
        try
        {
            let text = KBEngine.app.serverErrDes(code);
            if(text != null && text.toString() != "")
                return text.toString();
        }
        catch(error) {}
        return fallback;
    }
}
