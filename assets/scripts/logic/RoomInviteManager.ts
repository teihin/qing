import UIManager from "../common/UIManager";
import { ClosePanelMode, RoomType, ShowPanelMode } from "../common/GameDef";
import GpsManager from "./GpsManager";
import ConfigManager from "./ConfigManager";
import QueueMatchManager from "./QueueMatchManager";
import WebSceneLoader from "../common/WebSceneLoader";

var KBEngine = require("kbengine");

const {ccclass} = cc._decorator;

export interface RoomInviteData {
    roomType:string;
    roomID:number;
    inviterID:string;
    inviterName:string;
    bottom:string;
    minBuyIn:number;
    currentPlayers:number;
    maxPlayers:number;
    text:string;
    receivedAt:number;
    expiresAt:number;
}

interface StoredRoomInviteState {
    version:number;
    sendCooldowns:{[roomKey:string]:number};
    seenRooms:{[roomKey:string]:number};
    /** 旧版本曾错误持久化该字段；现仅用于兼容读取并自动清除。 */
    suppressAll?:boolean;
}

/**
 * 房间邀请状态必须跨越大厅、牌桌和客户端重启，所以统一由常驻管理器维护。
 * 服务端只负责转发通知；三分钟发送冷却和接收去重全部由客户端保存。
 */
@ccclass
export default class RoomInviteManager extends cc.Component {
    private static instance:RoomInviteManager = null;
    private static readonly STORAGE_PREFIX:string = "room_invite_state_v1_";
    private static readonly INVITE_PREFIX:string = "ROOM_INVITE|";
    private static readonly SEND_COOLDOWN_MS:number = 180000;
    private static readonly RECEIVE_TTL_MS:number = 30000;
    private static readonly MAX_PENDING_COUNT:number = 10;

    private initialized:boolean = false;
    private accountID:string = "";
    private sendCooldowns:{[roomKey:string]:number} = {};
    private seenRooms:{[roomKey:string]:number} = {};
    private suppressAll:boolean = false;
    private pendingQueue:RoomInviteData[] = [];
    private currentInvite:RoomInviteData = null;
    private dialogRequestedAt:number = 0;
    private navigationPhase:string = "idle"; // idle / leaving / transition / entering / loading
    private navigationInvite:RoomInviteData = null;
    private navigationLeftCurrentRoom:boolean = false;
    private navigationGeneration:number = 0;
    private navigationDeadline:number = 0;

    public static getInstance():RoomInviteManager
    {
        if(RoomInviteManager.instance == null)
        {
            let node = new cc.Node("RoomInviteManager");
            cc.game.addPersistRootNode(node);
            RoomInviteManager.instance = node.addComponent(RoomInviteManager);
        }
        RoomInviteManager.instance.initialize();
        return RoomInviteManager.instance;
    }

    onLoad()
    {
        RoomInviteManager.instance = this;
        this.initialize();
    }

    private initialize()
    {
        if(this.initialized)
            return;
        this.initialized = true;
        KBEngine.Event.register("SystemInfo", this, "onSystemInfo");
        KBEngine.Event.register("onLoginSuccessfully", this, "onLoginSuccessfully");
        KBEngine.Event.register("onLeaveRoom", this, "onLeaveRoomForInvite");
        KBEngine.Event.register("onEnterRoom", this, "onEnterRoomForInvite");
        cc.director.on(cc.Director.EVENT_AFTER_SCENE_LAUNCH, this.onSceneLaunched, this);
        this.schedule(this.onTick, 1, cc.macro.REPEAT_FOREVER, 0.5);
        this.ensureAccountState();
    }

    onDestroy()
    {
        KBEngine.Event.deregisterAll(this);
        cc.director.off(cc.Director.EVENT_AFTER_SCENE_LAUNCH, this.onSceneLaunched, this);
        this.unscheduleAllCallbacks();
        if(RoomInviteManager.instance === this)
            RoomInviteManager.instance = null;
    }

    public static isRoomInviteSystemMessage(strMsg:any):boolean
    {
        return RoomInviteManager.extractSystemContent(strMsg).indexOf(RoomInviteManager.INVITE_PREFIX) === 0;
    }

    private static extractSystemContent(strMsg:any):string
    {
        try
        {
            let data = typeof strMsg === "string" ? JSON.parse(strMsg) : strMsg;
            if(data == null || data.system_content == null)
                return "";
            return data.system_content.toString();
        }
        catch(error)
        {
            return "";
        }
    }

    private onLoginSuccessfully()
    {
        this.scheduleOnce(()=>{
            this.ensureAccountState();
            this.tryPresentNext();
        }, 0);
    }

    private onSceneLaunched()
    {
        this.scheduleOnce(()=>this.tryPresentNext(), 0.2);
    }

    public onLobbyReady()
    {
        this.ensureAccountState();
        this.scheduleOnce(()=>this.tryPresentNext(), 0);
    }

    private onTick = ()=>
    {
        this.ensureAccountState();
        let now = Date.now();
        if(this.navigationPhase != "idle" && this.navigationDeadline > 0 && now >= this.navigationDeadline)
            this.failRoomNavigation("切换房间超时，请稍后重试");

        // 牌桌内只允许未坐下的观战玩家看到邀请。若弹窗展示后玩家刚好坐下，
        // 立即关闭当前弹窗并丢弃已登记的待展示邀请，避免坐下状态仍能跨房跳转。
        this.dropInvitesForSeatedAudience();
        let changed = this.pruneExpiredCooldowns(now);
        if(changed)
        {
            this.persistState();
            KBEngine.Event.fire("RoomInviteStateChanged");
        }

        if(this.currentInvite != null && this.currentInvite.expiresAt <= now && !this.isInvitePanelOpen())
        {
            // 首次下载Prefab可能超过数秒，加载期间不能把同一邀请重新入队，
            // 否则慢网下会在第一个弹窗关闭后重复弹出。只有确认不再处于
            // panelRoomInvite异步加载状态时，才丢弃已经过期的当前邀请。
            let ui = UIManager.getInstance();
            if(ui.strCashPanelName != "panelRoomInvite")
            {
                this.currentInvite = null;
                this.dialogRequestedAt = 0;
            }
        }
        this.tryPresentNext();
    };

    private getAccount():any
    {
        try
        {
            if(KBEngine.app == null || typeof KBEngine.app.player !== "function")
                return null;
            return KBEngine.app.player();
        }
        catch(error)
        {
            return null;
        }
    }

    private resolveAccountID():string
    {
        let account = this.getAccount();
        if(account != null && account.guuid != null && account.guuid.toString() != "")
            return account.guuid.toString();
        let loginName = cc.sys.localStorage.getItem("unionid");
        return loginName == null ? "" : loginName.toString().trim();
    }

    private storageKey(accountID:string):string
    {
        return RoomInviteManager.STORAGE_PREFIX + encodeURIComponent(accountID);
    }

    private ensureAccountState():boolean
    {
        let nextAccountID = this.resolveAccountID();
        if(nextAccountID == "")
            return false;
        if(this.accountID == nextAccountID)
            return true;

        this.accountID = nextAccountID;
        this.sendCooldowns = {};
        this.seenRooms = {};
        this.suppressAll = false;
        this.pendingQueue = [];
        this.currentInvite = null;
        this.dialogRequestedAt = 0;

        let raw = cc.sys.localStorage.getItem(this.storageKey(this.accountID));
        let hasLegacyPersistentSuppression = false;
        if(raw != null && raw != "")
        {
            try
            {
                let data:StoredRoomInviteState = JSON.parse(raw);
                if(data != null && data.version === 1)
                {
                    this.sendCooldowns = data.sendCooldowns == null ? {} : data.sendCooldowns;
                    this.seenRooms = data.seenRooms == null ? {} : data.seenRooms;
                    // “本次登录不再弹出”只能在当前客户端会话内生效。旧版本把它
                    // 写进了localStorage，导致重启后仍永久拦截邀请；这里不再恢复，
                    // 并在下方重写存储以自动迁移旧记录，同时保留冷却和房间去重。
                    hasLegacyPersistentSuppression = data.suppressAll === true;
                }
            }
            catch(error)
            {
                cc.warn("房间邀请本地记录损坏，已自动重置");
            }
        }
        if(hasLegacyPersistentSuppression || this.pruneExpiredCooldowns(Date.now()))
            this.persistState();
        return true;
    }

    private persistState()
    {
        if(this.accountID == "")
            return;
        let data:StoredRoomInviteState = {
            version: 1,
            sendCooldowns: this.sendCooldowns,
            seenRooms: this.seenRooms
        };
        try
        {
            cc.sys.localStorage.setItem(this.storageKey(this.accountID), JSON.stringify(data));
        }
        catch(error)
        {
            cc.warn("保存房间邀请本地记录失败", error);
        }
    }

    public clearCurrentAccountSession()
    {
        let currentID = this.accountID == "" ? this.resolveAccountID() : this.accountID;
        if(currentID != "")
            cc.sys.localStorage.removeItem(this.storageKey(currentID));
        this.accountID = "";
        this.sendCooldowns = {};
        this.seenRooms = {};
        this.suppressAll = false;
        this.pendingQueue = [];
        this.currentInvite = null;
        this.dialogRequestedAt = 0;
        this.navigationPhase = "idle";
        this.navigationInvite = null;
        this.navigationLeftCurrentRoom = false;
        this.navigationGeneration++;
        this.navigationDeadline = 0;
        UIManager.getInstance().closePanelByName("panelRoomInvite", ClosePanelMode.Normal);
        KBEngine.Event.fire("RoomInviteStateChanged");
    }

    public isHandlingRoomNavigation():boolean
    {
        return this.navigationPhase != "idle";
    }

    private roomKey(roomType:any, roomID:any):string
    {
        return (roomType == null ? "Custom" : roomType.toString()) + ":" + Number(roomID).toString();
    }

    private pruneExpiredCooldowns(now:number):boolean
    {
        let changed = false;
        Object.keys(this.sendCooldowns).forEach((key:string)=>{
            let expiresAt = Number(this.sendCooldowns[key]);
            if(!isFinite(expiresAt) || expiresAt <= now)
            {
                delete this.sendCooldowns[key];
                changed = true;
            }
        });
        return changed;
    }

    public getRemainingSeconds(roomType:any, roomID:any):number
    {
        if(!this.ensureAccountState())
            return 0;
        let expiresAt = Number(this.sendCooldowns[this.roomKey(roomType, roomID)] || 0);
        return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    }

    private startCooldown(roomType:any, roomID:any)
    {
        if(!this.ensureAccountState())
            return;
        this.sendCooldowns[this.roomKey(roomType, roomID)] = Date.now() + RoomInviteManager.SEND_COOLDOWN_MS;
        this.persistState();
        KBEngine.Event.fire("RoomInviteStateChanged");
    }

    public sendInvite(roomType:string, roomID:any, bottom:string, minBuyIn:number, currentPlayers:number, maxPlayers:number):boolean
    {
        if(!this.ensureAccountState())
            return false;
        let numericRoomID = Number(roomID);
        let account = this.getAccount();
        let minimumBuyIn = Number(minBuyIn);
        if(account == null || typeof account.reqHallCommand !== "function" || !isFinite(numericRoomID) || numericRoomID <= 0 ||
            !isFinite(minimumBuyIn) || minimumBuyIn <= 0)
            return false;
        if(this.getRemainingSeconds(roomType, numericRoomID) > 0)
            return false;

        let inviterID = account.guuid == null ? this.accountID : account.guuid.toString();
        let inviterName = account.name == null || account.name.toString() == "" ? "牌友" : account.name.toString();
        let safeBottom = bottom == null || bottom == "" ? "--" : bottom.toString().replace(/^底皮/, "");
        let count = Math.max(0, Math.floor(Number(currentPlayers) || 0));
        let max = Math.max(count, Math.floor(Number(maxPlayers) || 0));
        let displayText = inviterName + "邀请你加入房间" + numericRoomID.toString();
        let content = [
            "ROOM_INVITE",
            "V2",
            roomType || "Custom",
            numericRoomID.toString(),
            inviterID,
            encodeURIComponent(inviterName),
            encodeURIComponent(safeBottom),
            minimumBuyIn.toString(),
            count.toString(),
            max.toString(),
            encodeURIComponent(displayText)
        ].join("|");

        // 当前接口没有独立成功回包。按产品约定，点击时立即落盘并启动冷却，
        // 即使网络发送失败也不回滚，避免连续点击造成全服刷屏。
        this.startCooldown(roomType, numericRoomID);
        try
        {
            account.reqHallCommand(JSON.stringify({
                header: "通知_所有玩家_信息",
                system_content: content
            }), "room_invite");
            return true;
        }
        catch(error)
        {
            cc.warn("发送房间邀请失败", error);
            return false;
        }
    }

    private safeDecode(value:any):string
    {
        try
        {
            return decodeURIComponent(value == null ? "" : value.toString());
        }
        catch(error)
        {
            return value == null ? "" : value.toString();
        }
    }

    private parseInvite(content:string):RoomInviteData
    {
        let parts = content.split("|");
        let now = Date.now();
        if(parts.length >= 11 && parts[0] == "ROOM_INVITE" && parts[1] == "V2")
        {
            let roomID = Number(parts[3]);
            let minBuyIn = Number(parts[7]);
            if(!isFinite(roomID) || roomID <= 0 || !isFinite(minBuyIn) || minBuyIn <= 0)
                return null;
            return {
                roomType: parts[2] || "Custom",
                roomID: roomID,
                inviterID: parts[4] || "",
                inviterName: this.safeDecode(parts[5]) || "牌友",
                bottom: this.safeDecode(parts[6]) || "--",
                minBuyIn: minBuyIn,
                currentPlayers: Math.max(0, Math.floor(Number(parts[8]) || 0)),
                maxPlayers: Math.max(0, Math.floor(Number(parts[9]) || 0)),
                text: this.safeDecode(parts.slice(10).join("|")),
                receivedAt: now,
                expiresAt: now + RoomInviteManager.RECEIVE_TTL_MS
            };
        }

        // V1及最初四段格式没有携带房间的实际最低带入。保留解析能力，
        // 但minBuyIn为0，接收阶段会为安全起见忽略，避免给金币不足玩家弹窗。
        if(parts.length >= 10 && parts[0] == "ROOM_INVITE" && parts[1] == "V1")
        {
            let roomID = Number(parts[3]);
            if(!isFinite(roomID) || roomID <= 0)
                return null;
            return {
                roomType: parts[2] || "Custom",
                roomID: roomID,
                inviterID: parts[4] || "",
                inviterName: this.safeDecode(parts[5]) || "牌友",
                bottom: this.safeDecode(parts[6]) || "--",
                minBuyIn: 0,
                currentPlayers: Math.max(0, Math.floor(Number(parts[7]) || 0)),
                maxPlayers: Math.max(0, Math.floor(Number(parts[8]) || 0)),
                text: this.safeDecode(parts.slice(9).join("|")),
                receivedAt: now,
                expiresAt: now + RoomInviteManager.RECEIVE_TTL_MS
            };
        }

        // 兼容服务器最初提供的快速联调格式：ROOM_INVITE|Custom|730564|文案。
        if(parts.length >= 4 && parts[0] == "ROOM_INVITE")
        {
            let roomID = Number(parts[2]);
            if(!isFinite(roomID) || roomID <= 0)
                return null;
            return {
                roomType: parts[1] || "Custom",
                roomID: roomID,
                inviterID: "",
                inviterName: "牌友",
                bottom: "--",
                minBuyIn: 0,
                currentPlayers: 0,
                maxPlayers: 0,
                text: parts.slice(3).join("|") || "有牌友邀请你加入房间",
                receivedAt: now,
                expiresAt: now + RoomInviteManager.RECEIVE_TTL_MS
            };
        }
        return null;
    }

    private getAccountBalance(account:any):number
    {
        if(account == null)
            return 0;
        let gold = Number(account.gold || 0);
        let gold2 = Number(account.gold2 || 0);
        if(!isFinite(gold))
            gold = 0;
        if(!isFinite(gold2))
            gold2 = 0;
        return gold + gold2 / 100;
    }

    private canAffordInvite(invite:RoomInviteData, account:any):boolean
    {
        let minBuyIn = invite == null ? 0 : Number(invite.minBuyIn);
        return isFinite(minBuyIn) && minBuyIn > 0 && this.getAccountBalance(account) >= minBuyIn;
    }

    private onSystemInfo(strMsg:string)
    {
        let content = RoomInviteManager.extractSystemContent(strMsg);
        if(content.indexOf(RoomInviteManager.INVITE_PREFIX) !== 0)
            return;
        if(!this.ensureAccountState())
        {
            cc.log("[RoomInvite] 已收到邀请，但当前账号尚未就绪");
            return;
        }
        if(this.suppressAll)
        {
            cc.log("[RoomInvite] 本次登录已设置不再弹出邀请");
            return;
        }

        let invite = this.parseInvite(content);
        if(invite == null)
        {
            cc.log("[RoomInvite] 邀请内容格式无效");
            return;
        }
        let account = this.getAccount();
        let selfID = account != null && account.guuid != null ? account.guuid.toString() : this.accountID;
        if(invite.inviterID != "" && invite.inviterID == selfID)
        {
            cc.log("[RoomInvite] 忽略自己发送的邀请");
            return;
        }

        if(!this.canAffordInvite(invite, account))
        {
            if(Number(invite.minBuyIn) > 0)
                cc.log("[RoomInvite] 当前金币低于房间最低带入，不展示邀请", invite.minBuyIn);
            else
                cc.log("[RoomInvite] 邀请缺少最低带入信息，不展示邀请");
            return;
        }

        let key = this.roomKey(invite.roomType, invite.roomID);
        if(this.seenRooms[key] != null)
        {
            cc.log("[RoomInvite] 该房间邀请本账号已处理", key);
            return;
        }

        // 第一条有效通知到达时就登记，防止弹窗尚未处理时同房其他玩家再次触发。
        this.seenRooms[key] = Date.now();
        this.persistState();

        let currentRoomID = account == null || account.roomID == null ? 0 : Number(account.roomID);
        if(currentRoomID == invite.roomID)
        {
            cc.log("[RoomInvite] 忽略当前所在房间的邀请", key);
            return;
        }
        let scene = cc.director.getScene();
        if(cc.isValid(scene) && scene.name == "drh8" && this.getRoomAudienceState() == "seated")
        {
            cc.log("[RoomInvite] 已坐下或正在占座，不展示邀请", key);
            return;
        }

        if(this.pendingQueue.length >= RoomInviteManager.MAX_PENDING_COUNT)
            this.pendingQueue.shift();
        this.pendingQueue.push(invite);
        cc.log("[RoomInvite] 邀请已进入弹窗队列", key);
        this.tryPresentNext();
    }

    private isInvitePanelOpen():boolean
    {
        return UIManager.getInstance().checkPanelByName("panelRoomInvite") === true;
    }

    private getRoomAudienceState():string
    {
        let panel = cc.find("Canvas/Normal/panelGameView");
        if(!cc.isValid(panel))
            return "unknown";
        let view:any = panel.getComponent("panelGameView");
        if(view == null || typeof view.GetRoomInviteAudienceState !== "function")
            return "unknown";
        return view.GetRoomInviteAudienceState();
    }

    /** PlayerList或预坐状态变化时可立即调用，避免等下一秒轮询才关闭弹窗。 */
    public onRoomAudienceStateChanged()
    {
        this.dropInvitesForSeatedAudience();
    }

    private dropInvitesForSeatedAudience():boolean
    {
        let scene = cc.director.getScene();
        if(!cc.isValid(scene) || scene.name != "drh8" || this.getRoomAudienceState() != "seated")
            return false;
        this.pendingQueue = [];
        if(this.currentInvite != null || this.isInvitePanelOpen())
        {
            this.currentInvite = null;
            this.dialogRequestedAt = 0;
            UIManager.getInstance().closePanelByName("panelRoomInvite", ClosePanelMode.Normal);
        }
        return true;
    }

    private canPresentInCurrentScene():boolean
    {
        let scene = cc.director.getScene();
        if(!cc.isValid(scene))
            return false;
        let ui = UIManager.getInstance();
        if(ui.checkPanelByName("panelLoading") === true)
            return false;
        if(scene.name == "login")
            return ui.checkPanelByName("panelMain") === true;
        if(scene.name == "drh8")
            return ui.checkPanelByName("panelGameView") === true && this.getRoomAudienceState() == "spectator";
        return false;
    }

    private tryPresentNext()
    {
        // 没有待展示邀请时不要每秒访问UIManager，避免无意义的场景查询和日志。
        if(this.suppressAll || this.currentInvite != null || this.pendingQueue.length <= 0)
            return;
        if(this.isInvitePanelOpen() || !this.canPresentInCurrentScene())
            return;
        let now = Date.now();
        while(this.pendingQueue.length > 0)
        {
            let invite = this.pendingQueue.shift();
            if(invite == null || invite.expiresAt <= now)
                continue;
            this.currentInvite = invite;
            this.dialogRequestedAt = now;
            cc.log("[RoomInvite] 正在打开邀请弹窗", this.roomKey(invite.roomType, invite.roomID));
            UIManager.getInstance().showPanel("panelRoomInvite", ShowPanelMode.Cover, JSON.stringify(invite));
            return;
        }
    }

    public handleDialogAction(invite:RoomInviteData, join:boolean, suppressForSession:boolean)
    {
        // 慢网下旧Prefab可能在邀请过期、下一条邀请开始处理后才完成实例化。
        // 旧弹窗只能关闭自己，不能清掉或跳转到管理器当前的新邀请。
        if(invite != null && this.currentInvite != null &&
            (invite.receivedAt != this.currentInvite.receivedAt || this.roomKey(invite.roomType, invite.roomID) != this.roomKey(this.currentInvite.roomType, this.currentInvite.roomID)))
        {
            UIManager.getInstance().closePanelByName("panelRoomInvite", ClosePanelMode.Normal);
            return;
        }
        if(suppressForSession)
        {
            this.suppressAll = true;
            this.pendingQueue = [];
        }
        this.currentInvite = null;
        this.dialogRequestedAt = 0;
        UIManager.getInstance().closePanelByName("panelRoomInvite", ClosePanelMode.Normal);

        if(join)
        {
            this.pendingQueue = [];
            this.requestEnterRoom(invite);
        }
        else if(!this.suppressAll)
        {
            this.scheduleOnce(()=>this.tryPresentNext(), 0.15);
        }
    }

    private requestEnterRoom(invite:RoomInviteData)
    {
        if(invite == null || !isFinite(Number(invite.roomID)) || Number(invite.roomID) <= 0)
            return;
        let account = this.getAccount();
        if(account == null || typeof account.reqEnterRoom !== "function")
        {
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "游戏连接尚未就绪，请稍后再试");
            return;
        }
        if(!this.canAffordInvite(invite, account))
        {
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover,
                "当前金币不足该房间最低带入" + Number(invite.minBuyIn).toString());
            return;
        }
        if(Number(account.roomID || 0) == Number(invite.roomID))
        {
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "你已经在该房间中");
            return;
        }
        if(ConfigManager.getInstance().enalbe_gps == "True" && !GpsManager.getInstance().IsGpsOpen())
        {
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "未打开GPS不能进入房间！");
            return;
        }

        let roomType:any = invite.roomType == RoomType.Easy ? RoomType.Easy : RoomType.Custom;
        let scene = cc.director.getScene();
        if(Number(account.roomID || 0) > 0 && cc.isValid(scene) && scene.name == "drh8")
        {
            if(this.getRoomAudienceState() != "spectator")
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "已坐下的玩家不能切换到其他邀请房间");
                return;
            }
            let queueManager = QueueMatchManager.getInstance();
            let queueState = queueManager.getSnapshot();
            if(queueManager.isHandlingRoomNavigation() || queueState.queueActive || queueState.busy)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "请先取消排队，再前往邀请房间");
                return;
            }
            this.beginRoomNavigation(invite, roomType);
            return;
        }
        UIManager.getInstance().showPanel("panelLoading", ShowPanelMode.Top);
        account.reqEnterRoom(roomType, Number(invite.roomID), "{{\"special_rule\": \"观战\"}}");
    }

    private beginRoomNavigation(invite:RoomInviteData, roomType:any)
    {
        if(this.navigationPhase != "idle")
            return;
        // 点击“前往”与真正发送退房请求之间再做一次座位校验，防止弹窗
        // 展示后快速预坐/坐下，仍借旧弹窗切走当前房间。
        if(this.getRoomAudienceState() != "spectator")
        {
            this.dropInvitesForSeatedAudience();
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "你已占座，不能前往其他邀请房间");
            return;
        }
        let account = this.getAccount();
        if(account == null || typeof account.reqLeaveRoom !== "function")
        {
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "游戏连接尚未就绪，请稍后再试");
            return;
        }
        this.navigationInvite = Object.assign({}, invite, { roomType: roomType });
        this.navigationPhase = "leaving";
        this.navigationLeftCurrentRoom = false;
        this.navigationGeneration++;
        this.navigationDeadline = Date.now() + 15000;
        UIManager.getInstance().showPanel("panelLoading", ShowPanelMode.Top);
        try
        {
            if(typeof account.reqStopGame === "function")
                account.reqStopGame();
            account.reqLeaveRoom();
        }
        catch(error)
        {
            this.failRoomNavigation("离开当前房间失败，请稍后重试");
        }
    }

    private onLeaveRoomForInvite(nCode:number)
    {
        if(this.navigationPhase != "leaving")
            return;
        if(nCode != 0x200)
        {
            this.failRoomNavigation("离开当前房间失败，暂时无法前往邀请房间");
            return;
        }

        this.navigationLeftCurrentRoom = true;
        this.navigationPhase = "transition";
        this.navigationDeadline = Date.now() + 30000;
        let generation = this.navigationGeneration;
        let started = WebSceneLoader.loadScene("roomTransition", (error:any)=>{
            if(generation != this.navigationGeneration || this.navigationPhase != "transition")
                return;
            if(error)
            {
                this.failRoomNavigation("快速换房场景加载失败");
                return;
            }
            UIManager.getInstance().ResetBase();
            let account = this.getAccount();
            if(account == null || this.navigationInvite == null)
            {
                this.failRoomNavigation("游戏连接已断开");
                return;
            }
            this.navigationPhase = "entering";
            this.navigationDeadline = Date.now() + 15000;
            account.reqEnterRoom(this.navigationInvite.roomType, Number(this.navigationInvite.roomID), "{{\"special_rule\": \"观战\"}}");
        }, ()=>generation == this.navigationGeneration && this.navigationPhase == "transition");
        if(!started)
            this.failRoomNavigation("快速换房场景正在加载，请稍后重试");
    }

    private onEnterRoomForInvite(nCode:number, nRoomID:number)
    {
        if(this.navigationPhase != "entering" || this.navigationInvite == null)
            return;
        if(Number(nRoomID) != Number(this.navigationInvite.roomID))
            return;
        if(nCode != 0x200)
        {
            this.failRoomNavigation("进入邀请房间失败，房间可能已满或已解散");
            return;
        }

        this.navigationPhase = "loading";
        this.navigationDeadline = Date.now() + 30000;
        let generation = this.navigationGeneration;
        let started = WebSceneLoader.loadScene("drh8", (error:any)=>{
            if(generation != this.navigationGeneration || this.navigationPhase != "loading")
                return;
            if(error)
            {
                this.failRoomNavigation("牌桌场景加载失败");
                return;
            }
            UIManager.getInstance().ResetBase();
            this.navigationPhase = "idle";
            this.navigationInvite = null;
            this.navigationLeftCurrentRoom = false;
            this.navigationDeadline = 0;
        }, ()=>generation == this.navigationGeneration && this.navigationPhase == "loading");
        if(!started)
            this.failRoomNavigation("牌桌场景正在加载，请稍后重试");
    }

    private failRoomNavigation(message:string)
    {
        let leftRoom = this.navigationLeftCurrentRoom;
        this.navigationGeneration++;
        this.navigationPhase = "idle";
        this.navigationInvite = null;
        this.navigationLeftCurrentRoom = false;
        this.navigationDeadline = 0;

        let showError = ()=>{
            UIManager.getInstance().ResetBase();
            UIManager.getInstance().closePanelByName("panelLoading", ClosePanelMode.Top);
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, message);
        };
        let scene = cc.director.getScene();
        if(leftRoom || (cc.isValid(scene) && scene.name == "roomTransition"))
        {
            let started = WebSceneLoader.loadScene("login", (error:any)=>{
                if(error)
                    return;
                showError();
            });
            if(!started)
                showError();
            return;
        }
        showError();
    }
}
