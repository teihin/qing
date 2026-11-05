import Tool from "../common/Tool";
import Debug from "../common/Debug";
import GameDataManager from "../GameDataManager";
import MobileManager from "../mobile/MobileManager";
import {
    DIRECT_CHAT_HTTP_BASE,
    WEB_DIRECT_CHAT_HTTP_BASE,
    DIRECT_CHAT_WS_URL,
    WEB_DIRECT_CHAT_WS_URL,
    DIRECT_CHAT_WS_CONNECT_TIMEOUT_MS,
    DIRECT_CHAT_WS_REQUEST_TIMEOUT_MS,
    DIRECT_CHAT_WS_RECONNECT_BASE_MS,
    DIRECT_CHAT_WS_RECONNECT_MAX_MS
} from "../common/GameDef";

var KBEngine = require("kbengine");

/** 直聊接口返回的业务错误。code 与服务端第 9 章错误码一一对应。 */
export class DirectChatError extends Error
{
    public code:string = "";
    public status:number = 0;
    constructor(message:string,code:string = "",status:number = 0)
    {
        super(message);
        this.code = code;
        this.status = status;
    }
}

export interface DirectPeer
{
    guuid:string; name:string; note:string; avatar:string; role:string;
}

export interface DirectClub
{
    clubId:string; clubName:string; role:string; unread:number;
}

export interface DirectConversation
{
    conversationId:string;
    isDefaultTarget:boolean;
    clubId:string;
    clubName:string;
    peer:DirectPeer;
    lastMessage:string;
    lastMessageType:string;
    lastMessageAt:string;
    unread:number;
    canSend:boolean;
}

export interface DirectAttachment
{
    id:string; type:string; url:string; thumbnailUrl:string;
    durationMs:number; width:number; height:number; voiceId:string;
}

export interface DirectMessage
{
    id:string;
    messageType:string;
    text:string;
    attachment:DirectAttachment;
    senderGuuid:string;
    senderName:string;
    senderRole:string;
    clientMessageId:string;
    createdAt:string;
    /** 本地状态：发送中/发送失败，仅在客户端有效。 */
    pending:boolean;
    failed:boolean;
    /**
     * 仅 messageType === "system" 的本地通报使用：完整年月日时分秒，
     * 这类消息由客户端自己插进列表，不来自 /api/direct。
     */
    systemTime?:string;
}

export interface DirectMember
{
    guuid:string; name:string; note:string; avatar:string; role:string; online:boolean; canChat:boolean;
}

export interface DirectMessagePage
{
    items:DirectMessage[];
    hasMoreBefore:boolean;
    beforeCursor:string;
    hasMoreAfter:boolean;
    afterCursor:string;
    conversationId:string;
    peer:DirectPeer;
    canSend:boolean;
    canDelete:boolean;
    role:string;
    readOnlyReason:string;
}

export interface DirectConversationPage
{
    clubId:string;
    items:DirectConversation[];
    page:number;
    pageSize:number;
    hasMore:boolean;
    role:string;
    canDelete:boolean;
}

export interface DirectMemberPage
{
    clubId:string;
    items:DirectMember[];
    page:number;
    pageSize:number;
    hasMore:boolean;
    role:string;
}

export interface DirectUnread
{
    total:number;
    byClub:{[clubId:string]:number};
}

/** 聊天托管状态：俱乐部群主、盟主和大盟主可开启。 */
export interface DirectHostingInfo
{
    eligible:boolean;
    enabled:boolean;
    role:string;
    roleName:string;
    groupType:string;
    groupId:string;
    groupName:string;
    clubId:string;
    clubName:string;
    enabledAt:string;
    message:string;
}

/** 图片来源：相册/文件选择，或调用相机现拍。 */
export type DirectImageSource = "library" | "camera";

/** 客户端图片选择结果。 */
export interface DirectPickedImage
{
    data:any;          // Uint8Array / ArrayBuffer
    mime:string;
    width:number;
    height:number;
    size:number;
}

/**
 * 俱乐部 1 对 1 私聊管理器。
 *
 * 全项目只允许存在一个实例：鉴权、令牌、俱乐部上下文、会话/成员缓存、长连接、
 * 未读汇总、发送重试、图片上传和录音状态全部收敛在这里，页面脚本只做展示与交互，
 * 不允许各自发请求或各自起定时器（设计文档 10.1 / 10.5.4）。
 */
export default class DirectChatManager
{
    private static instance:DirectChatManager = null;

    public static GetInstance():DirectChatManager
    {
        if(DirectChatManager.instance == null)
            DirectChatManager.instance = new DirectChatManager();
        return DirectChatManager.instance;
    }

    /** 角色显示名：角色只影响入口和删除按钮，不改变会话模型（文档 5.3）。 */
    public static RoleName(role:any):string
    {
        let value = role == null ? "" : String(role).trim();
        const key = value.toLowerCase();
        if(key === "union_owner" || value === "大盟主")
            return "大盟主";
        if(key === "owner" || value === "老板" || value === "群主")
            return "群主";
        if(value === "盟主")
            return "盟主";
        if(key === "leader" || key === "agent" || value === "代理" || value === "合伙人")
            return "合伙人";
        if(key === "manager" || value === "管理员")
            return "管理员";
        return "玩家";
    }

    /** 群主、联盟大群主、代理才有「删除（隐藏）聊天」入口；服务端仍会再校验一次。 */
    public static CanDeleteRole(role:any):boolean
    {
        let value = role == null ? "" : String(role);
        return value === "owner" || value === "leader" || value === "agent" || value === "union_owner";
    }

    // ---------------- 身份与令牌 ----------------

    private token:string = "";
    private tokenExpiresAt:number = 0;
    private tokenGuuid:string = "";
    /** 账号代际：切号后自增，旧回包一律丢弃。 */
    private accountGeneration:number = 0;
    private guuid:string = "";
    private name:string = "";
    private avatar:string = "";
    private meRole:string = "";
    private authPromise:Promise<void> = null;

    // ---------------- 俱乐部上下文 ----------------

    private clubs:DirectClub[] = [];
    private clubLoaded:boolean = false;
    private currentClubId:string = "";
    private unread:DirectUnread = {total:0,byClub:{}};

    // ---------------- 缓存 ----------------

    private conversationCache:{[clubId:string]:DirectConversationPage} = {};
    /** 全局消息页缓存；已读清理不能只改当前俱乐部缓存。 */
    private allConversationCache:DirectConversationPage = null;
    private memberCache:{[clubId:string]:DirectMemberPage} = {};
    private pendingClientIds:{[key:string]:string} = {};
    private hostingInfo:DirectHostingInfo = null;

    // ---------------- 长连接与断线补偿 ----------------

    private foregroundHooked:boolean = false;
    private realtimeSocket:any = null;
    private realtimeWanted:boolean = false;
    private realtimePaused:boolean = false;
    private realtimeConnecting:boolean = false;
    private realtimeReconnectTimer:any = null;
    private realtimeConnectTimer:any = null;
    private realtimeReconnectAttempt:number = 0;
    private realtimeSerial:number = 0;
    private realtimeRequestSerial:number = 0;
    private realtimeTicket:string = "";
    private realtimeTicketExpiresAt:number = 0;
    private realtimeTicketPromise:Promise<void> = null;
    private realtimePending:{[requestId:string]:any} = {};
    private realtimeUnreadBusy:boolean = false;
    private realtimeUnreadQueued:boolean = false;

    // ---------------- 录音 ----------------

    private voiceSink:((voiceId:string,durationMs:number)=>void) = null;
    private voiceStartAt:number = 0;
    private voiceCancelled:boolean = false;
    private voiceFailed:string = "";

    // ---------------- 事件 ----------------

    private listeners:{[event:string]:Array<Function>} = {};

    private constructor()
    {
        this.HookForeground();
    }

    // ================= 基础工具 =================

    /** 浏览器走 HTTPS 反代域名，原生走 IP 直连；两条都指向同一个 ChatTool。 */
    public ApiBase():string
    {
        return cc.sys.isBrowser ? WEB_DIRECT_CHAT_HTTP_BASE : DIRECT_CHAT_HTTP_BASE;
    }

    /** 接口基址去掉 /api/direct 后的根，用于拼接服务端返回的相对上传地址。 */
    private RootBase():string
    {
        let base = this.ApiBase();
        let index = base.indexOf("/api/direct");
        return index >= 0 ? base.substr(0,index) : base;
    }

    public On(event:string,handler:Function):void
    {
        if(handler == null)
            return;
        let list = this.listeners[event];
        if(list == null)
        {
            list = [];
            this.listeners[event] = list;
        }
        for(let item of list)
        {
            if(item === handler)
                return;
        }
        list.push(handler);
    }

    public Off(event:string,handler:Function):void
    {
        let list = this.listeners[event];
        if(list == null)
            return;
        for(let i = list.length - 1;i >= 0;i--)
        {
            if(list[i] === handler)
                list.splice(i,1);
        }
    }

    public OffAll(target:any):void
    {
        for(let event in this.listeners)
        {
            let list = this.listeners[event];
            for(let i = list.length - 1;i >= 0;i--)
            {
                let handler:any = list[i];
                if(handler === target || (handler != null && handler.owner === target))
                    list.splice(i,1);
            }
        }
    }

    private Fire(event:string,...args:any[]):void
    {
        let list = this.listeners[event];
        if(list == null || list.length === 0)
            return;
        // 复制一份，回调里可能注销自己。
        let snapshot = list.slice(0);
        for(let handler of snapshot)
        {
            try { handler.apply(null,args); }
            catch(error) { Debug.Error("直聊事件回调异常:" + error); }
        }
    }

    private Account():any
    {
        try { return GameDataManager.getAccount(); }
        catch(error) { return null; }
    }

    /** 当前游戏账号 guuid；未登录返回空串。 */
    public CurrentGuuid():string
    {
        let account = this.Account();
        if(account == null || account.guuid === undefined || account.guuid === null)
            return "";
        return String(account.guuid).trim();
    }

    /** 账号变化时清空全部缓存、令牌和长连接（文档 10.5.2）。 */
    public SyncAccount():boolean
    {
        let guuid = this.CurrentGuuid();
        if(guuid === this.guuid)
            return false;
        if(this.guuid !== "")
            Debug.Log("直聊账号已切换:" + this.guuid + " -> " + guuid);
        this.ResetAccount(guuid);
        return true;
    }

    public ResetAccount(guuid:string = ""):void
    {
        this.StopRealtime();
        this.ClearVoiceState();
        this.accountGeneration++;
        this.guuid = guuid;
        this.name = "";
        this.avatar = "";
        this.meRole = "";
        this.token = "";
        this.tokenExpiresAt = 0;
        this.tokenGuuid = "";
        this.authPromise = null;
        this.clubs = [];
        this.clubLoaded = false;
        this.currentClubId = "";
        this.unread = {total:0,byClub:{}};
        this.conversationCache = {};
        this.allConversationCache = null;
        this.memberCache = {};
        this.pendingClientIds = {};
        this.hostingInfo = null;
        this.Fire("accountChanged",guuid);
        this.Fire("unread",0,{});
    }

    // ================= HTTP =================

    private IsAuthError(error:any):boolean
    {
        return error != null && (error.code === "DIRECT_AUTH_REQUIRED" || error.code === "DIRECT_AUTH_EXPIRED");
    }

    /**
     * 统一请求入口。所有直聊接口都必须经过这里，页面不得自行创建 XHR。
     * @param method GET/POST/DELETE
     * @param path 以 / 开头的接口路径（相对 /api/direct）
     * @param body JSON 请求体
     * @param options raw: 直接发送二进制；timeout: 毫秒
     */
    public Request(method:string,path:string,body:any = null,options:any = null):Promise<any>
    {
        let opts = options == null ? {} : options;
        let generation = this.accountGeneration;
        let url = path.indexOf("http") === 0 ? path : this.ApiBase() + path;
        let startedAt = Date.now();
        return this.EnsureSession().then(()=>{
            let authMs = Date.now() - startedAt;
            let sendAt = Date.now();
            return this.Send(method,url,body,opts,false).then((data:any)=>{
                // 首次进页面偶发数秒等待；拆成鉴权/请求两段便于定位是登录还是网络。
                let total = Date.now() - startedAt;
                if(total >= 1000)
                    Debug.Log("直聊请求较慢 " + path + " 总=" + total + "ms 鉴权=" + authMs + "ms 请求=" + (Date.now() - sendAt) + "ms");
                return data;
            });
        }).then((data:any)=>{
            if(generation !== this.accountGeneration)
                throw new DirectChatError("账号已切换","DIRECT_ACCOUNT_CHANGED");
            return data;
        });
    }

    private Send(method:string,url:string,body:any,opts:any,isRetry:boolean):Promise<any>
    {
        let generation = this.accountGeneration;
        return new Promise<any>((resolve,reject)=>{
            let xhr = new XMLHttpRequest();
            let finished = false;
            let timeout = opts.timeout === undefined ? 15000 : opts.timeout;
            let timer:any = null;
            let done = (action:Function,value:any)=>{
                if(finished)
                    return;
                finished = true;
                if(timer != null)
                    clearTimeout(timer);
                action(value);
            };
            // 令牌失效时清空并重新鉴权后重试一次；账号已切换则直接丢弃。
            let fail = (error:any)=>{
                if(finished)
                    return;
                if(!isRetry && this.IsAuthError(error) && generation === this.accountGeneration)
                {
                    finished = true;
                    if(timer != null)
                        clearTimeout(timer);
                    this.token = "";
                    this.tokenExpiresAt = 0;
                    this.tokenGuuid = "";
                    this.authPromise = null;
                    this.EnsureSession().then(()=>{
                        return this.Send(method,url,body,opts,true);
                    }).then(resolve,reject);
                    return;
                }
                done(reject,error);
            };
            xhr.onreadystatechange = ()=>{
                if(xhr.readyState !== 4 || finished)
                    return;
                let text = xhr.responseText == null ? "" : String(xhr.responseText);
                let payload:any = null;
                try { payload = text === "" ? null : JSON.parse(text); }
                catch(error) { payload = null; }
                if(payload != null && payload.ok === true)
                {
                    done(resolve,payload.data);
                    return;
                }
                let code = payload != null && payload.error != null ? String(payload.error.code || "") : "";
                let message = payload != null && payload.error != null ? String(payload.error.message || "") : "";
                if(message === "")
                    message = xhr.status === 0 ? "网络异常，请检查网络后重试" : "请求失败（" + xhr.status + "）";
                fail(new DirectChatError(message,code,xhr.status));
            };
            xhr.onerror = ()=>{ fail(new DirectChatError("网络异常，请检查网络后重试","NETWORK_ERROR",0)); };
            xhr.ontimeout = ()=>{ fail(new DirectChatError("请求超时，请稍后重试","TIMEOUT",0)); };
            xhr.onabort = ()=>{ done(reject,new DirectChatError("请求已取消","ABORTED",0)); };
            timer = setTimeout(()=>{
                if(finished)
                    return;
                try { xhr.abort(); }
                catch(error) {}
                done(reject,new DirectChatError("请求超时，请稍后重试","TIMEOUT",0));
            },timeout);
            try
            {
                xhr.open(method,url,true);
                if(this.token !== "")
                    xhr.setRequestHeader("X-Direct-Token",this.token);
                if(opts.raw === true)
                    xhr.setRequestHeader("Content-Type",opts.contentType || "application/octet-stream");
                else if(body !== null && body !== undefined)
                    xhr.setRequestHeader("Content-Type","application/json;charset=utf-8");
                xhr.send(opts.raw === true ? body : (body === null || body === undefined ? null : JSON.stringify(body)));
            }
            catch(error)
            {
                done(reject,new DirectChatError("请求发送失败，请稍后重试","SEND_FAILED",0));
                return;
            }
        });
    }

    // ================= 鉴权 =================

    private TokenStorageKey(guuid:string):string
    {
        return "directChatToken:" + guuid;
    }

    private LoadStoredToken(guuid:string):void
    {
        try
        {
            let raw = cc.sys.localStorage.getItem(this.TokenStorageKey(guuid));
            if(raw == null || raw === "")
                return;
            let data = JSON.parse(raw);
            if(data == null || data.token === undefined)
                return;
            this.token = String(data.token);
            this.tokenExpiresAt = Number(data.expiresAt) || 0;
            this.tokenGuuid = guuid;
        }
        catch(error) { this.token = ""; }
    }

    private StoreToken():void
    {
        if(this.guuid === "")
            return;
        try
        {
            cc.sys.localStorage.setItem(this.TokenStorageKey(this.guuid),JSON.stringify({
                token:this.token, expiresAt:this.tokenExpiresAt
            }));
        }
        catch(error) {}
    }

    private ClearStoredToken():void
    {
        if(this.guuid === "")
            return;
        try { cc.sys.localStorage.removeItem(this.TokenStorageKey(this.guuid)); }
        catch(error) {}
    }

    /**
     * 建立/续用聊天会话。
     *
     * 身份来源二选一：
     * 1. 账号上带的服务端票据（`chatTicket`/`chat_ticket`，由 KB 登录服签发，HMAC 保护）；
     * 2. 与客服入口一致的轻量加密资料（`Tool.encrypt` + `ts`），服务端解密后才认可 guuid，
     *    客户端从不直接提交 meGuuid 字段。
     */
    public EnsureSession():Promise<void>
    {
        this.SyncAccount();
        if(this.guuid === "")
            return Promise.reject(new DirectChatError("请先登录游戏","DIRECT_AUTH_REQUIRED"));
        if(this.token !== "" && this.tokenGuuid === this.guuid && this.tokenExpiresAt > Date.now() + 60000)
        {
            this.StartRealtime();
            return Promise.resolve();
        }
        if(this.authPromise != null)
            return this.authPromise;
        if(this.token === "" && this.tokenGuuid === "")
            this.LoadStoredToken(this.guuid);
        if(this.token !== "" && this.tokenGuuid === this.guuid && this.tokenExpiresAt > Date.now() + 60000)
        {
            this.StartRealtime();
            return Promise.resolve();
        }

        let generation = this.accountGeneration;
        this.authPromise = new Promise<void>((resolve,reject)=>{
            let account = this.Account();
            let body:any = {};
            let ticket = account == null ? "" : this.ReadTicket(account);
            if(ticket !== "")
                body.ticket = ticket;
            else
                body.payload = this.BuildLinkPayload(account);
            let authStartedAt = Date.now();
            this.Send("POST",this.ApiBase() + "/session",body,{timeout:15000},true).then((data:any)=>{
                let authCost = Date.now() - authStartedAt;
                if(authCost >= 1000)
                    Debug.Log("直聊会话建立耗时 " + authCost + "ms");
                if(generation !== this.accountGeneration)
                {
                    reject(new DirectChatError("账号已切换","DIRECT_ACCOUNT_CHANGED"));
                    return;
                }
                this.token = data != null ? String(data.token || "") : "";
                this.tokenExpiresAt = DirectChatManager.ParseTime(data != null ? data.expiresAt : 0);
                this.tokenGuuid = this.guuid;
                if(data != null && data.me != null)
                {
                    this.name = String(data.me.name || "");
                    this.avatar = String(data.me.avatar || "");
                }
                this.StoreToken();
                this.authPromise = null;
                this.StartRealtime();
                resolve();
            },(error:any)=>{
                this.authPromise = null;
                if(error instanceof DirectChatError && error.status === 404)
                {
                    // 服务端还没部署直聊路由时给出可定位的提示，避免被当成网络抖动反复重试。
                    reject(new DirectChatError("聊天服务尚未开通，请联系管理员","DIRECT_SERVICE_UNAVAILABLE",404));
                    return;
                }
                reject(error instanceof DirectChatError ? error : new DirectChatError("聊天登录失败，请稍后重试","DIRECT_AUTH_REQUIRED"));
            });
        });
        return this.authPromise;
    }

    private ReadTicket(account:any):string
    {
        let value = account == null ? "" : (account.chatTicket != null ? account.chatTicket :
            (account.chat_ticket != null ? account.chat_ticket : ""));
        return value == null ? "" : String(value).trim();
    }

    /** 与客服链接同一套轻量加密：服务端用 CHAT_PLAYER_LINK_KEY 解密并校验 ts。 */
    private BuildLinkPayload(account:any):string
    {
        let guuid = this.guuid;
        let name = account == null ? "" : String(account.name == null ? (account.nickname == null ? guuid : account.nickname) : account.name);
        // 游戏账号的正式头像字段是 photo；avatar 只作为旧账号/旧壳字段的兼容回退。
        let avatar = account == null ? "" : String(account.photo == null ?
            (account.avatar == null ? (account.avatarIndex == null ? "" : account.avatarIndex) : account.avatar) : account.photo);
        let platform = cc.sys.isNative ? (cc.sys.os === cc.sys.OS_ANDROID ? "android" : "ios") : "web";
        let plain = JSON.stringify({
            playerId:guuid,
            nickname:name === "" ? guuid : name,
            avatar:avatar,
            platform:platform,
            ts:Math.floor(Date.now() / 1000)
        });
        return Tool.encrypt(plain);
    }

    private static ParseTime(value:any):number
    {
        if(value === null || value === undefined)
            return 0;
        if(typeof value === "number")
            return value;
        let time = Date.parse(String(value).replace(/-/g,"/").replace(/\.\d+$/,""));
        return isFinite(time) ? time : 0;
    }

    public Logout():Promise<void>
    {
        if(this.token === "" || this.guuid === "")
        {
            this.ResetAccount(this.CurrentGuuid());
            return Promise.resolve();
        }
        let guuid = this.guuid;
        return this.Request("DELETE","/session").then(()=>{
            this.ClearStoredToken();
            this.ResetAccount(guuid);
        },()=>{
            this.ClearStoredToken();
            this.ResetAccount(guuid);
        });
    }

    public Me():{guuid:string;name:string;avatar:string}
    {
        // 会话可能复用缓存令牌，服务端返回的 me.avatar 可能是旧值；当前游戏账号的 photo
        // 才是本地正在展示的头像，优先使用它保证自己的消息头像与“我的”页面一致。
        let account = this.Account();
        let localAvatar = account == null || account.photo == null ? "" : String(account.photo).trim();
        return {guuid:this.guuid,name:this.name,avatar:localAvatar === "" ? this.avatar : localAvatar};
    }

    // ================= 俱乐部 =================

    public Clubs():DirectClub[]
    {
        return this.clubs.slice(0);
    }

    public ClubLoaded():boolean
    {
        return this.clubLoaded;
    }

    public CurrentClub():DirectClub
    {
        for(let club of this.clubs)
        {
            if(club.clubId === this.currentClubId)
                return club;
        }
        return null;
    }

    public CurrentClubId():string
    {
        return this.currentClubId;
    }

    /** 切换俱乐部：立即记录新 clubId 并让旧缓存失效（文档 10.6）。 */
    public SetCurrentClub(clubId:string):void
    {
        let value = clubId == null ? "" : String(clubId).trim();
        if(value === this.currentClubId)
            return;
        this.currentClubId = value;
        this.Fire("clubChanged",value);
    }

    /**
     * 用游戏账号里的俱乐部字段（club_make / club_join / club_join2 / club_manage）
     * 解析默认俱乐部；服务端返回的俱乐部列表加载完成后按列表再校正一次。
     */
    public ResolveAccountClubId():string
    {
        let account = this.Account();
        if(account == null)
            return "";
        let ids:string[] = [];
        for(let value of [account.club_make,account.club_join,account.club_join2,account.club_manage])
        {
            let raw = String(value == null ? "" : value).split(",");
            for(let one of raw)
            {
                let id = one.trim();
                if(/^\d{6}$/.test(id) && ids.indexOf(id) < 0)
                    ids.push(id);
            }
        }
        let selected = "";
        try { selected = String(cc.sys.localStorage.getItem("lastRoomClub:" + this.guuid) || "").trim(); }
        catch(error) { selected = ""; }
        if(selected !== "" && ids.indexOf(selected) >= 0)
            return selected;
        return ids.length > 0 ? ids[0] : "";
    }

    public LoadClubs():Promise<DirectClub[]>
    {
        return this.Request("GET","/clubs").then((data:any)=>{
            let items:DirectClub[] = [];
            let list = data != null && data.items != null ? data.items : [];
            for(let one of list)
            {
                items.push({
                    clubId:String(one.clubId || ""),
                    clubName:String(one.clubName || one.clubId || ""),
                    role:String(one.role || "member"),
                    unread:Number(one.unread || 0)
                });
            }
            this.clubs = items;
            this.clubLoaded = true;
            if(this.currentClubId === "" || this.FindClub(items,this.currentClubId) == null)
            {
                let fallback = this.ResolveAccountClubId();
                let club = this.FindClub(items,fallback);
                this.currentClubId = club != null ? club.clubId : (items.length > 0 ? items[0].clubId : "");
            }
            this.RecalculateUnread();
            this.Fire("clubs",items);
            return items;
        });
    }

    private FindClub(items:DirectClub[],clubId:string):DirectClub
    {
        for(let item of items)
        {
            if(item.clubId === clubId)
                return item;
        }
        return null;
    }

    public LoadUnread():Promise<DirectUnread>
    {
        return this.Request("GET","/unread").then((data:any)=>{
            let unread:DirectUnread = {total:0,byClub:{}};
            if(data != null)
            {
                unread.total = Number(data.total || 0);
                let byClub = data.byClub == null ? {} : data.byClub;
                for(let key in byClub)
                    unread.byClub[key] = Number(byClub[key] || 0);
            }
            this.ApplyUnread(unread);
            return unread;
        });
    }

    // ================= 聊天托管 =================

    /** 查询托管资格与开关状态。force 为 false 时复用本次登录内的结果。 */
    public HostingStatus(force:boolean = false):Promise<DirectHostingInfo>
    {
        if(!force && this.hostingInfo != null)
            return Promise.resolve(this.hostingInfo);
        return this.Request("GET","/hosting").then((data:any)=>{
            let info = this.NormalizeHostingInfo(data);
            this.hostingInfo = info;
            this.Fire("hosting",info);
            return info;
        });
    }

    /** 开启/关闭当前账号的聊天托管；服务端会再次校验大群主/盟主身份。 */
    public SetHosting(enabled:boolean):Promise<DirectHostingInfo>
    {
        return this.Request("POST","/hosting",{enabled:enabled}).then((data:any)=>{
            let info = this.NormalizeHostingInfo(data);
            this.hostingInfo = info;
            this.Fire("hosting",info);
            return info;
        });
    }

    private NormalizeHostingInfo(data:any):DirectHostingInfo
    {
        let source = data == null ? {} : data;
        return {
            eligible:source.eligible === true,
            enabled:source.enabled === true,
            role:String(source.role || ""),
            roleName:String(source.roleName || ""),
            groupType:String(source.groupType || ""),
            groupId:String(source.groupId || ""),
            groupName:String(source.groupName || ""),
            clubId:String(source.clubId || ""),
            clubName:String(source.clubName || ""),
            enabledAt:String(source.enabledAt || ""),
            message:String(source.message || "")
        };
    }

    /**
     * 只在未读摘要真的变化时通知页面。摘要只在长连接事件、恢复前台或
     * 断线重连时补拉，不再按固定周期访问服务端。
     */
    private ApplyUnread(unread:DirectUnread):void
    {
        let changed = this.unread.total !== unread.total;
        if(!changed)
        {
            let keys:{[clubId:string]:boolean} = {};
            for(let key in this.unread.byClub)
                keys[key] = true;
            for(let key in unread.byClub)
                keys[key] = true;
            for(let key in keys)
            {
                if(Number(this.unread.byClub[key] || 0) !== Number(unread.byClub[key] || 0))
                {
                    changed = true;
                    break;
                }
            }
        }
        this.unread = unread;
        for(let club of this.clubs)
            club.unread = Number(unread.byClub[club.clubId] || 0);
        if(changed)
            this.Fire("unread",unread.total,unread.byClub);
    }

    private RecalculateUnread():void
    {
        let byClub:{[clubId:string]:number} = {};
        let total = 0;
        for(let club of this.clubs)
        {
            if(club.unread > 0)
            {
                byClub[club.clubId] = club.unread;
                total += club.unread;
            }
        }
        this.ApplyUnread({total:total,byClub:byClub});
    }

    public UnreadTotal():number
    {
        return this.unread.total;
    }

    public UnreadOfClub(clubId:string):number
    {
        if(clubId == null || clubId === "")
            return 0;
        let value = this.unread.byClub[clubId];
        return value === undefined ? 0 : value;
    }

    // ================= 会话列表 =================

    public CachedConversations(clubId:string):DirectConversationPage
    {
        let page = this.conversationCache[clubId];
        return page === undefined ? null : page;
    }

    public InvalidateConversations(clubId:string = ""):void
    {
        if(clubId === "")
            this.conversationCache = {};
        else
            delete this.conversationCache[clubId];
    }

    public LoadConversations(clubId:string,page:number = 1):Promise<DirectConversationPage>
    {
        let target = clubId == null ? "" : String(clubId).trim();
        if(target === "")
            return Promise.reject(new DirectChatError("当前账号没有俱乐部","CLUB_NOT_FOUND"));
        return this.Request("GET","/clubs/" + encodeURIComponent(target) + "/conversations?page=" + page + "&pageSize=30")
            .then((data:any)=>{
                let result:DirectConversationPage = {
                    clubId:target, items:[], page:1, pageSize:30, hasMore:false, role:"member", canDelete:false
                };
                if(data != null)
                {
                    let list = data.items == null ? [] : data.items;
                    for(let one of list)
                    {
                        let peer = one.peer == null ? {} : one.peer;
                        result.items.push({
                            conversationId:String(one.conversationId || ""),
                            isDefaultTarget:one.isDefaultTarget === true,
                            clubId:String(one.clubId || target),
                            clubName:String(one.clubName || ""),
                            peer:{
                                guuid:String(peer.guuid || ""),
                                name:String(peer.name || peer.guuid || ""),
                                note:String(peer.note || ""),
                                avatar:String(peer.avatar || ""),
                                role:String(peer.role || "member")
                            },
                            lastMessage:String(one.lastMessage || ""),
                            lastMessageType:String(one.lastMessageType || ""),
                            lastMessageAt:String(one.lastMessageAt || ""),
                            unread:Number(one.unread || 0),
                            canSend:one.canSend !== false
                        });
                    }
                    result.page = Number(data.page || 1);
                    result.pageSize = Number(data.pageSize || 30);
                    result.hasMore = data.hasMore === true;
                    result.role = String(data.role || "member");
                    result.canDelete = data.canDelete === true;
                }
                // 只在当前 clubId 未被切换时写入缓存，避免旧回包覆盖新俱乐部列表。
                if(this.currentClubId === "" || this.currentClubId === target)
                    this.conversationCache[target] = result;
                this.Fire("conversations",target,result);
                return result;
            });
    }

    /** 最近一次成功的全局会话第一页；仅用于消息页首屏先渲染。 */
    public CachedAllConversations():DirectConversationPage
    {
        return this.allConversationCache;
    }

    /** 加载当前账号所有俱乐部的会话摘要，服务端按最新消息做全局分页。 */
    public LoadAllConversations(page:number = 1):Promise<DirectConversationPage>
    {
        return this.Request("GET","/conversations?page=" + page + "&pageSize=30")
            .then((data:any)=>{
                let result:DirectConversationPage = {
                    clubId:"", items:[], page:1, pageSize:30, hasMore:false, role:"member", canDelete:false
                };
                if(data != null)
                {
                    for(let one of (data.items == null ? [] : data.items))
                    {
                        let peer = one.peer == null ? {} : one.peer;
                        result.items.push({
                            conversationId:String(one.conversationId || one.id || ""),
                            isDefaultTarget:one.isDefaultTarget === true,
                            clubId:String(one.clubId || ""),
                            clubName:String(one.clubName || ""),
                            peer:{
                                guuid:String(peer.guuid || ""),
                                name:String(peer.name || peer.guuid || ""),
                                note:String(peer.note || ""),
                                avatar:String(peer.avatar || ""),
                                role:String(peer.role || "member")
                            },
                            lastMessage:String(one.lastMessage || ""),
                            lastMessageType:String(one.lastMessageType || ""),
                            lastMessageAt:String(one.lastMessageAt || ""),
                            unread:Number(one.unread || 0),
                            canSend:one.canSend !== false
                        });
                    }
                    result.page = Number(data.page || 1);
                    result.pageSize = Number(data.pageSize || 30);
                    result.hasMore = data.hasMore === true;
                }
                if(page === 1)
                    this.allConversationCache = result;
                this.Fire("allConversations",result);
                return result;
            });
    }

    /** 创建或恢复会话（幂等）；已有隐藏会话时会清除隐藏状态并返回同一会话。 */
    public OpenConversation(clubId:string,peerGuuid:string):Promise<DirectConversation>
    {
        return this.Request("POST","/clubs/" + encodeURIComponent(clubId) + "/conversations",
            {peerGuuid:peerGuuid}).then((data:any)=>{
            // 兼容服务端将会话包在 conversation 字段中的返回格式；进入详情前必须
            // 拿到真实 ID，禁止继续打开空会话页面。
            let view = data != null && data.conversation != null ? data.conversation : data;
            let conversationId = String(view != null ? (view.conversationId || view.id || "") : "");
            if(conversationId === "")
                throw new DirectChatError("会话创建失败，请稍后重试","CONVERSATION_NOT_FOUND");
            let peer = view != null && view.peer != null ? view.peer : {};
            let result:DirectConversation = {
                conversationId:conversationId,
                isDefaultTarget:false,
                clubId:String(clubId),
                clubName:String(view != null ? (view.clubName || "") : ""),
                peer:{
                    guuid:String(peer.guuid || peerGuuid),
                    name:String(peer.name || peerGuuid),
                    note:String(peer.note || ""),
                    avatar:String(peer.avatar || ""),
                    role:String(peer.role || "member")
                },
                lastMessage:String(view != null ? (view.lastMessage || "") : ""),
                lastMessageType:String(view != null ? (view.lastMessageType || "") : ""),
                lastMessageAt:String(view != null ? (view.lastMessageAt || "") : ""),
                unread:Number(view != null ? (view.unread || 0) : 0),
                canSend:true
            };
            this.InvalidateConversations(clubId);
            return result;
        });
    }

    // ================= 成员 =================

    public CachedMembers(clubId:string):DirectMemberPage
    {
        let page = this.memberCache[clubId];
        return page === undefined ? null : page;
    }

    public LoadMembers(clubId:string,keyword:string = "",page:number = 1):Promise<DirectMemberPage>
    {
        let target = clubId == null ? "" : String(clubId).trim();
        if(target === "")
            return Promise.reject(new DirectChatError("当前账号没有俱乐部","CLUB_NOT_FOUND"));
        let url = "/clubs/" + encodeURIComponent(target) + "/members?page=" + page + "&pageSize=30";
        if(keyword != null && keyword !== "")
            url += "&keyword=" + encodeURIComponent(keyword);
        return this.Request("GET",url).then((data:any)=>{
            let result:DirectMemberPage = {clubId:target,items:[],page:1,pageSize:30,hasMore:false,role:"member"};
            if(data != null)
            {
                for(let one of (data.items == null ? [] : data.items))
                {
                    result.items.push({
                        guuid:String(one.guuid || ""),
                        name:String(one.name || one.guuid || ""),
                        note:String(one.note || ""),
                        avatar:String(one.avatar || ""),
                        role:String(one.role || "member"),
                        online:one.online === true,
                        canChat:one.canChat === true
                    });
                }
                result.page = Number(data.page || 1);
                result.pageSize = Number(data.pageSize || 30);
                result.hasMore = data.hasMore === true;
                result.role = String(data.role || "member");
            }
            // 只缓存第一页无搜索条件的完整列表，供页面快速回显。
            if(page === 1 && (keyword == null || keyword === ""))
                this.memberCache[target] = result;
            return result;
        });
    }

    // ================= 消息 =================

    /** 页面重试/替换本地消息时复用同一套字段归一化，避免字段名漂移。 */
    public NormalizeMessageForPanel(raw:any):DirectMessage
    {
        return this.NormalizeMessage(raw == null ? {} : raw);
    }

    private NormalizeMessage(one:any):DirectMessage
    {
        let attachment = one == null ? null : one.attachment;
        let view:DirectAttachment = null;
        if(attachment != null)
        {
            view = {
                id:String(attachment.id || ""),
                type:String(attachment.type || ""),
                url:this.AbsoluteMediaUrl(String(attachment.url || "")),
                thumbnailUrl:this.AbsoluteMediaUrl(String(attachment.thumbnailUrl || "")),
                durationMs:Number(attachment.durationMs || 0),
                width:Number(attachment.width || 0),
                height:Number(attachment.height || 0),
                voiceId:String(attachment.voiceId || "")
            };
        }
        return {
            id:String(one.id || ""),
            messageType:String(one.messageType || "text"),
            text:String(one.text || ""),
            attachment:view,
            senderGuuid:String(one.senderGuuid || ""),
            senderName:String(one.senderName || ""),
            senderRole:String(one.senderRole || ""),
            clientMessageId:String(one.clientMessageId || ""),
            createdAt:String(one.createdAt || ""),
            pending:one.pending === true,
            failed:one.failed === true
        };
    }

    /** 服务端返回的媒体地址是相对 /api/direct 的路径，这里补全成可直接加载的地址。 */
    private AbsoluteMediaUrl(url:string):string
    {
        if(url == null || url === "")
            return "";
        if(url.indexOf("http://") === 0 || url.indexOf("https://") === 0)
            return url;
        if(url.indexOf("/api/") === 0)
            return this.RootBase() + url;
        return this.ApiBase() + url;
    }

    private NormalizeMessagePage(data:any,clubId:string):DirectMessagePage
    {
        let page:DirectMessagePage = {
            items:[], hasMoreBefore:false, beforeCursor:"", hasMoreAfter:false, afterCursor:"",
            conversationId:"", peer:null, canSend:true, canDelete:false, role:"member", readOnlyReason:""
        };
        if(data == null)
            return page;
        for(let one of (data.items == null ? [] : data.items))
            page.items.push(this.NormalizeMessage(one));
        page.hasMoreBefore = data.hasMoreBefore === true;
        page.beforeCursor = String(data.beforeCursor || "");
        page.hasMoreAfter = data.hasMoreAfter === true;
        page.afterCursor = String(data.afterCursor || "");
        page.conversationId = String(data.conversationId || "");
        page.canSend = data.canSend !== false;
        page.canDelete = data.canDelete === true;
        page.role = String(data.role || "member");
        page.readOnlyReason = String(data.readOnlyReason || "");
        if(data.peer != null)
        {
            page.peer = {
                guuid:String(data.peer.guuid || ""),
                name:String(data.peer.name || ""),
                note:String(data.peer.note || ""),
                avatar:String(data.peer.avatar || ""),
                role:String(data.peer.role || "member")
            };
        }
        return page;
    }

    /** 首次进入：只取最新一页（默认 30 条）。 */
    public LoadLatestMessages(conversationId:string):Promise<DirectMessagePage>
    {
        return this.Request("GET","/conversations/" + encodeURIComponent(conversationId) + "/messages?limit=30")
            .then((data:any)=>this.NormalizeMessagePage(data,""));
    }

    /** 上滑加载更早：原样回传服务端游标，不能用数组长度计算。 */
    public LoadBeforeMessages(conversationId:string,cursor:string):Promise<DirectMessagePage>
    {
        return this.Request("GET","/conversations/" + encodeURIComponent(conversationId) +
            "/messages?limit=30&before=" + encodeURIComponent(cursor))
            .then((data:any)=>this.NormalizeMessagePage(data,""));
    }

    /** 长连接事件后的增量补偿：after 只取该消息之后的新消息。 */
    public LoadMessagesAfter(conversationId:string,afterMessageId:string):Promise<DirectMessagePage>
    {
        return this.Request("GET","/conversations/" + encodeURIComponent(conversationId) +
            "/messages?limit=50&after=" + encodeURIComponent(afterMessageId))
            .then((data:any)=>this.NormalizeMessagePage(data,""));
    }

    public NewClientMessageId():string
    {
        let random = Math.floor(Math.random() * 0xFFFFFF).toString(36);
        return "c" + Date.now().toString(36) + random;
    }

    private SendMessageBody(conversationId:string,body:any):Promise<DirectMessage>
    {
        if(conversationId == null || String(conversationId).trim() === "")
            return Promise.reject(new DirectChatError("会话尚未建立，请返回消息列表重新打开","CONVERSATION_NOT_FOUND"));

        // 长连接已建立时优先发送 WebSocket 指令。若连接在发送过程中断开，
        // 用同一个 clientMessageId 回退到 HTTP；服务端幂等键保证不会产生重复消息。
        let send:Promise<any> = this.IsRealtimeOpen() ? this.SendViaRealtime(conversationId,body) :
            Promise.reject(new DirectChatError("长连接尚未建立","REALTIME_UNAVAILABLE",0));
        return send.catch((error:any)=>{
            if(error == null || error.realtimeRetryable === true || error.code === "REALTIME_UNAVAILABLE" ||
                error.code === "REALTIME_TIMEOUT" || error.code === "REALTIME_CLOSED")
            {
                return this.Request("POST","/conversations/" + encodeURIComponent(conversationId) + "/messages",body);
            }
            throw error;
        })
            .then((data:any)=>{
                let raw = data != null && data.message != null ? data.message : data;
                return this.NormalizeMessage(raw == null ? {} : raw);
            });
    }

    public SendText(conversationId:string,text:string,clientMessageId:string):Promise<DirectMessage>
    {
        return this.SendMessageBody(conversationId,{
            messageType:"text", clientMessageId:clientMessageId, text:text
        });
    }

    /**
     * 俱乐部管理操作的系统通报（上分/下分成功）。
     * 服务端只放行 owner/leader/agent 且文案符合固定格式，其余一律拒绝。
     */
    public SendSystemNotice(conversationId:string,text:string,clientMessageId:string):Promise<DirectMessage>
    {
        return this.SendMessageBody(conversationId,{
            messageType:"system", clientMessageId:clientMessageId, text:text
        });
    }

    public SendAttachmentMessage(conversationId:string,messageType:string,attachmentId:string,
        clientMessageId:string):Promise<DirectMessage>
    {
        return this.SendMessageBody(conversationId,{
            messageType:messageType, clientMessageId:clientMessageId, attachmentId:attachmentId
        });
    }

    public MarkRead(conversationId:string,messageId:string):Promise<void>
    {
        if(messageId == null || messageId === "")
            return Promise.resolve();
        return this.Request("POST","/conversations/" + encodeURIComponent(conversationId) + "/read",
            {lastReadMessageId:messageId}).then(()=>{
            this.ApplyLocalRead(conversationId,messageId);
            // 本地缓存用于即时消除红点，随后以服务端摘要校正跨俱乐部/跨页面的未读总数。
            return this.LoadUnread().then(()=>undefined,()=>undefined);
        });
    }

    /** 本地先把会话未读清零，服务端回包失败也不影响用户看到的红点。 */
    private ApplyLocalRead(conversationId:string,messageId:string):void
    {
        let clearedUnread = 0;
        let clearedClubId = "";
        // 先从任一缓存确定本次实际清掉的数量，避免同一会话同时存在于
        // 俱乐部页和全局页时重复扣减全局未读。
        for(let clubId in this.conversationCache)
        {
            let page = this.conversationCache[clubId];
            if(page == null)
                continue;
            for(let item of page.items)
            {
                if(item.conversationId === conversationId && item.unread > 0)
                {
                    clearedUnread = item.unread;
                    clearedClubId = clubId;
                    break;
                }
            }
            if(clearedUnread > 0)
                break;
        }
        if(clearedUnread === 0 && this.allConversationCache != null)
        {
            for(let item of this.allConversationCache.items)
            {
                if(item.conversationId === conversationId && item.unread > 0)
                {
                    clearedUnread = item.unread;
                    clearedClubId = item.clubId;
                    break;
                }
            }
        }

        // 所有已加载的会话列表都同步清零，但只按上面确定的一份数量扣总数。
        for(let clubId in this.conversationCache)
        {
            let page = this.conversationCache[clubId];
            if(page == null)
                continue;
            for(let item of page.items)
            {
                if(item.conversationId === conversationId)
                    item.unread = 0;
            }
        }
        if(this.allConversationCache != null)
        {
            for(let item of this.allConversationCache.items)
            {
                if(item.conversationId === conversationId)
                    item.unread = 0;
            }
        }

        if(clearedUnread > 0 && clearedClubId !== "")
        {
            // 当前缓存可能只覆盖一个俱乐部或一页会话，不能用缓存重算全局未读，
            // 否则会把尚未加载的其他俱乐部红点误清掉。
            let byClub:{[clubId:string]:number} = {};
            for(let clubId in this.unread.byClub)
                byClub[clubId] = this.unread.byClub[clubId];
            let value = Number(byClub[clearedClubId] || 0) - clearedUnread;
            if(value > 0)
                byClub[clearedClubId] = value;
            else
                delete byClub[clearedClubId];
            let total = 0;
            for(let clubId in byClub)
                total += Number(byClub[clubId] || 0);
            this.ApplyUnread({total:total,byClub:byClub});
        }
        this.Fire("read",conversationId,messageId);
        this.Fire("conversationRead",conversationId,messageId);
    }

    /** 删除（隐藏）当前用户的会话入口；服务端仍保留消息和对方记录。 */
    public HideConversation(conversationId:string):Promise<void>
    {
        return this.Request("DELETE","/conversations/" + encodeURIComponent(conversationId)).then(()=>{
            for(let clubId in this.conversationCache)
            {
                let page = this.conversationCache[clubId];
                if(page == null)
                    continue;
                for(let i = page.items.length - 1;i >= 0;i--)
                {
                    if(page.items[i].conversationId === conversationId)
                        page.items.splice(i,1);
                }
            }
            this.Fire("conversationHidden",conversationId);
        });
    }

    /** 清除自己这一侧的聊天记录：服务端只记录清除时间，对方和客服仍可查看。 */
    public ClearConversation(conversationId:string):Promise<void>
    {
        return this.Request("POST","/conversations/" + encodeURIComponent(conversationId) + "/clear",{}).then(()=>{
            this.SetMessageCursor(conversationId,"");
            this.InvalidateConversations();
        });
    }

    // ================= 附件上传 =================

    public CreateImageAttachment(conversationId:string,image:DirectPickedImage):Promise<any>
    {
        return this.Request("POST","/conversations/" + encodeURIComponent(conversationId) + "/attachments",{
            type:"image",
            mimeType:image.mime,
            byteSize:image.size,
            sha256:"",
            width:image.width,
            height:image.height
        });
    }

    /**
     * XHR 原生上传统一发送 ArrayBuffer。
     * Web FileReader 返回 ArrayBuffer，Android/iOS 的 jsb.fileUtils 可能返回
     * Uint8Array 或带 offset 的 TypedArray；直接把后者交给不同平台的 XHR
     * 会出现空包、截断或 Content-Length 不一致。
     */
    private NormalizeUploadData(data:any):any
    {
        if(data == null)
            return data;
        if(typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer)
            return data;
        let bufferType:any = typeof ArrayBuffer !== "undefined" ? ArrayBuffer : null;
        if(bufferType != null && typeof bufferType.isView === "function" && bufferType.isView(data))
        {
            let begin = Number(data.byteOffset || 0);
            let length = Number(data.byteLength || 0);
            if(data.buffer != null && typeof data.buffer.slice === "function")
                return data.buffer.slice(begin,begin + length);
        }
        return data;
    }

    public UploadImageBinary(conversationId:string,attachmentId:string,data:any,mime:string):Promise<any>
    {
        return this.Request("POST","/conversations/" + encodeURIComponent(conversationId) +
            "/attachments/" + encodeURIComponent(attachmentId) + "/upload",this.NormalizeUploadData(data),
            {raw:true,contentType:mime,timeout:60000});
    }

    public CompleteAttachment(conversationId:string,attachmentId:string):Promise<any>
    {
        return this.Request("POST","/conversations/" + encodeURIComponent(conversationId) +
            "/attachments/" + encodeURIComponent(attachmentId) + "/complete",{});
    }

    /** 语音附件：只提交 AudioServer 的 voiceId，服务端会重新校验时长和大小。 */
    public CreateVoiceAttachment(conversationId:string,voiceId:string,durationMs:number):Promise<any>
    {
        return this.Request("POST","/conversations/" + encodeURIComponent(conversationId) + "/attachments",{
            type:"voice", provider:"audio_server", externalMediaId:voiceId, durationMs:durationMs
        });
    }

    /** 图片完整链路：创建附件 → 上传 → 确认 → 发送消息。 */
    public SendImageMessage(conversationId:string,image:DirectPickedImage,
        onStage:(stage:string)=>void = null):Promise<DirectMessage>
    {
        let notify = (stage:string)=>{ if(onStage != null) onStage(stage); };
        let attachmentId = "";
        notify("creating");
        return this.CreateImageAttachment(conversationId,image).then((ticket:any)=>{
            attachmentId = ticket != null ? String(ticket.attachmentId || "") : "";
            if(attachmentId === "")
                throw new DirectChatError("创建图片附件失败","MEDIA_INVALID");
            notify("uploading");
            return this.UploadImageBinary(conversationId,attachmentId,image.data,image.mime);
        }).then(()=>{
            notify("confirming");
            return this.CompleteAttachment(conversationId,attachmentId);
        }).then(()=>{
            notify("sending");
            return this.SendAttachmentMessage(conversationId,"image",attachmentId,this.NewClientMessageId());
        });
    }

    /** 语音完整链路：AudioServer 已返回 voiceId → 创建附件 → 发送语音消息。 */
    public SendVoiceMessage(conversationId:string,voiceId:string,durationMs:number):Promise<DirectMessage>
    {
        let attachmentId = "";
        return this.CreateVoiceAttachment(conversationId,voiceId,durationMs).then((ticket:any)=>{
            attachmentId = ticket != null ? String(ticket.attachmentId || "") : "";
            if(attachmentId === "")
                throw new DirectChatError("语音附件创建失败","MEDIA_INVALID");
            return this.SendAttachmentMessage(conversationId,"voice",attachmentId,this.NewClientMessageId());
        });
    }

    // ================= 长连接与断线补偿 =================

    private HookForeground():void
    {
        if(this.foregroundHooked)
            return;
        this.foregroundHooked = true;
        cc.game.on(cc.game.EVENT_HIDE,()=>{
            this.PauseRealtimeLifecycle();
        });
        cc.game.on(cc.game.EVENT_SHOW,()=>{
            this.ResumeRealtimeLifecycle();
        });
    }

    /** 切后台关闭长连接并丢弃录音，回到前台重新连接并补拉一次摘要。 */
    private PauseRealtimeLifecycle():void
    {
        this.PauseRealtime();
        if(this.IsRecording())
            this.CancelVoiceRecord();
    }

    private ResumeRealtimeLifecycle():void
    {
        if(this.guuid === "" || this.token === "")
            return;
        this.StartRealtime();
        this.LoadUnread().then(()=>this.LoadAllConversations()).catch(()=>{});
    }

    /**
     * 建立全局直聊长连接。连接只负责实时事件与发送确认，历史消息和媒体仍由
     * REST 接口承载；这样断线后可以使用消息 ID 游标补偿，不依赖内存事件不丢失。
     */
    public StartRealtime():void
    {
        this.realtimeWanted = true;
        this.realtimePaused = false;
        if(this.guuid === "" || this.token === "")
            return;
        this.ConnectRealtime();
    }

    public StopRealtime():void
    {
        this.realtimeWanted = false;
        this.realtimePaused = false;
        this.ClearRealtimeTimers();
        this.RejectRealtimePending(new DirectChatError("长连接已关闭","REALTIME_CLOSED",0));
        let socket = this.realtimeSocket;
        this.realtimeSocket = null;
        this.realtimeConnecting = false;
        this.realtimeSerial++;
        this.realtimeTicket = "";
        this.realtimeTicketExpiresAt = 0;
        this.realtimeTicketPromise = null;
        if(socket != null)
        {
            try { socket.close(); }
            catch(error) {}
        }
    }

    private PauseRealtime():void
    {
        this.realtimePaused = true;
        this.ClearRealtimeTimers();
        this.RejectRealtimePending(new DirectChatError("应用已进入后台","REALTIME_PAUSED",0));
        let socket = this.realtimeSocket;
        this.realtimeSocket = null;
        this.realtimeConnecting = false;
        this.realtimeSerial++;
        this.realtimeTicket = "";
        this.realtimeTicketExpiresAt = 0;
        if(socket != null)
        {
            try { socket.close(); }
            catch(error) {}
        }
    }

    private ClearRealtimeTimers():void
    {
        if(this.realtimeReconnectTimer != null)
        {
            clearTimeout(this.realtimeReconnectTimer);
            this.realtimeReconnectTimer = null;
        }
        if(this.realtimeConnectTimer != null)
        {
            clearTimeout(this.realtimeConnectTimer);
            this.realtimeConnectTimer = null;
        }
    }

    private RealtimeURL():string
    {
        let base = cc.sys.isBrowser ? WEB_DIRECT_CHAT_WS_URL : DIRECT_CHAT_WS_URL;
        return base + "?ticket=" + encodeURIComponent(this.realtimeTicket);
    }

    private IsRealtimeOpen():boolean
    {
        return this.realtimeSocket != null && this.realtimeSocket.readyState === 1;
    }

    private ConnectRealtime():void
    {
        if(!this.realtimeWanted || this.realtimePaused || this.guuid === "" || this.token === "")
            return;
        if(this.realtimeConnecting || this.IsRealtimeOpen())
            return;
        if(this.realtimeTicket === "" || this.realtimeTicketExpiresAt <= Date.now() + 5000)
        {
            if(this.realtimeConnecting)
                return;
            this.realtimeConnecting = true;
            let generation = this.accountGeneration;
            this.EnsureRealtimeTicket().then(()=>{
                if(generation !== this.accountGeneration || !this.realtimeWanted || this.realtimePaused)
                    return;
                this.realtimeConnecting = false;
                this.ConnectRealtime();
            },()=>{
                this.realtimeConnecting = false;
                this.ScheduleRealtimeReconnect();
            });
            return;
        }
        let WebSocketCtor:any = (typeof WebSocket !== "undefined") ? WebSocket : null;
        if(WebSocketCtor == null)
        {
            this.Fire("realtimeState","unsupported");
            return;
        }
        this.ClearRealtimeTimers();
        this.realtimeConnecting = true;
        let serial = ++this.realtimeSerial;
        let generation = this.accountGeneration;
        let socket:any;
        try { socket = new WebSocketCtor(this.RealtimeURL()); }
        catch(error)
        {
            this.realtimeConnecting = false;
            this.ScheduleRealtimeReconnect();
            return;
        }
        this.realtimeSocket = socket;
        socket.onopen = ()=>{
            if(serial !== this.realtimeSerial || generation !== this.accountGeneration || socket !== this.realtimeSocket)
            {
                try { socket.close(); } catch(error) {}
                return;
            }
            this.realtimeConnecting = false;
            this.realtimeReconnectAttempt = 0;
            this.realtimeTicket = "";
            this.realtimeTicketExpiresAt = 0;
            if(this.realtimeConnectTimer != null)
            {
                clearTimeout(this.realtimeConnectTimer);
                this.realtimeConnectTimer = null;
            }
            this.Fire("realtimeState","open");
            this.RefreshUnreadAfterRealtime();
        };
        socket.onmessage = (event:any)=>{
            if(serial !== this.realtimeSerial || generation !== this.accountGeneration || socket !== this.realtimeSocket)
                return;
            this.HandleRealtimeMessage(event == null ? null : event.data);
        };
        socket.onerror = ()=>{
            this.Fire("realtimeState","error");
            // 某些 WebView 只触发 error 不及时触发 close，主动关闭以进入统一重连流程。
            try { socket.close(); } catch(error) {}
        };
        socket.onclose = ()=>{
            if(socket !== this.realtimeSocket)
                return;
            this.realtimeSocket = null;
            this.realtimeConnecting = false;
            if(this.realtimeConnectTimer != null)
            {
                clearTimeout(this.realtimeConnectTimer);
                this.realtimeConnectTimer = null;
            }
            this.RejectRealtimePending(new DirectChatError("长连接已断开","REALTIME_CLOSED",0));
            this.Fire("realtimeState","closed");
            if(this.realtimeWanted && !this.realtimePaused && generation === this.accountGeneration)
                this.ScheduleRealtimeReconnect();
        };
        this.realtimeConnectTimer = setTimeout(()=>{
            if(socket === this.realtimeSocket && this.realtimeConnecting)
            {
                try { socket.close(); } catch(error) {}
            }
        },DIRECT_CHAT_WS_CONNECT_TIMEOUT_MS);
    }

    private EnsureRealtimeTicket():Promise<void>
    {
        if(this.realtimeTicket !== "" && this.realtimeTicketExpiresAt > Date.now() + 5000)
            return Promise.resolve();
        if(this.realtimeTicketPromise != null)
            return this.realtimeTicketPromise;
        let generation = this.accountGeneration;
        let request = this.Send("POST",this.ApiBase() + "/ws-ticket",{},
            {timeout:DIRECT_CHAT_WS_CONNECT_TIMEOUT_MS},false).then((data:any)=>{
            if(generation !== this.accountGeneration || !this.realtimeWanted || this.realtimePaused)
                throw new DirectChatError("账号已切换","DIRECT_ACCOUNT_CHANGED",0);
            this.realtimeTicket = String(data != null ? (data.ticket || "") : "");
            this.realtimeTicketExpiresAt = DirectChatManager.ParseTime(data != null ? data.expiresAt : 0);
            if(this.realtimeTicket === "")
                throw new DirectChatError("长连接票据无效","REALTIME_TICKET_INVALID",0);
        });
        this.realtimeTicketPromise = request;
        request.then(()=>{
            if(this.realtimeTicketPromise === request)
                this.realtimeTicketPromise = null;
        },()=>{
            if(this.realtimeTicketPromise === request)
                this.realtimeTicketPromise = null;
        });
        return request;
    }

    private ScheduleRealtimeReconnect():void
    {
        if(!this.realtimeWanted || this.realtimePaused || this.realtimeReconnectTimer != null)
            return;
        let delay = Math.min(DIRECT_CHAT_WS_RECONNECT_MAX_MS,
            DIRECT_CHAT_WS_RECONNECT_BASE_MS * Math.pow(2,this.realtimeReconnectAttempt));
        this.realtimeReconnectAttempt = Math.min(10,this.realtimeReconnectAttempt + 1);
        this.realtimeReconnectTimer = setTimeout(()=>{
            this.realtimeReconnectTimer = null;
            this.ConnectRealtime();
        },delay);
    }

    private HandleRealtimeMessage(raw:any):void
    {
        let event:any = null;
        try { event = typeof raw === "string" ? JSON.parse(raw) : raw; }
        catch(error) { return; }
        if(event == null || event.type == null)
            return;
        let type = String(event.type);
        if(type === "ready" || type === "pong")
        {
            this.Fire("realtime",type,event.data || {});
            return;
        }
        if(type === "message.new")
        {
            this.Fire("realtimeMessage",event.data || {});
            this.RefreshUnreadAfterRealtime();
            return;
        }
        if(type === "message.sent")
        {
            this.ResolveRealtimeRequest(String(event.requestId || ""),event.data || {});
            return;
        }
        if(type === "error")
        {
            let data = event.data || {};
            let error:any = new DirectChatError(String(data.message || "长连接请求失败"),
                String(data.code || "REALTIME_ERROR"),0);
            error.realtimeRetryable = false;
            this.RejectRealtimeRequest(String(event.requestId || ""),error);
        }
    }

    private RefreshUnreadAfterRealtime():void
    {
        if(this.realtimeUnreadBusy)
        {
            this.realtimeUnreadQueued = true;
            return;
        }
        this.realtimeUnreadBusy = true;
        // 一个实时事件只触发一组摘要/列表请求，页面通过 allConversations 事件直接更新，
        // 避免再为消息列表启动独立轮询或重复拉取。
        Promise.all([this.LoadUnread(),this.LoadAllConversations()]).then(()=>{
            this.realtimeUnreadBusy = false;
            if(this.realtimeUnreadQueued)
            {
                this.realtimeUnreadQueued = false;
                this.RefreshUnreadAfterRealtime();
            }
        },()=>{
            this.realtimeUnreadBusy = false;
        });
    }

    private NewRealtimeRequestID():string
    {
        this.realtimeRequestSerial++;
        return "ws-" + Date.now().toString(36) + "-" + this.realtimeRequestSerial.toString(36);
    }

    private SendViaRealtime(conversationId:string,body:any):Promise<any>
    {
        if(!this.IsRealtimeOpen())
            return Promise.reject(new DirectChatError("长连接尚未建立","REALTIME_UNAVAILABLE",0));
        let requestId = this.NewRealtimeRequestID();
        let generation = this.accountGeneration;
        return new Promise<any>((resolve,reject)=>{
            let timer = setTimeout(()=>{
                delete this.realtimePending[requestId];
                let error:any = new DirectChatError("长连接发送超时，请重试","REALTIME_TIMEOUT",0);
                error.realtimeRetryable = true;
                reject(error);
            },DIRECT_CHAT_WS_REQUEST_TIMEOUT_MS);
            this.realtimePending[requestId] = {resolve:resolve,reject:reject,timer:timer,generation:generation};
            try
            {
                this.realtimeSocket.send(JSON.stringify({type:"message.send",requestId:requestId,
                    conversationId:conversationId,message:body}));
            }
            catch(error)
            {
                clearTimeout(timer);
                delete this.realtimePending[requestId];
                let failed:any = new DirectChatError("长连接发送失败，请重试","REALTIME_UNAVAILABLE",0);
                failed.realtimeRetryable = true;
                reject(failed);
            }
        });
    }

    private ResolveRealtimeRequest(requestId:string,data:any):void
    {
        let pending = this.realtimePending[requestId];
        if(pending == null)
            return;
        delete this.realtimePending[requestId];
        clearTimeout(pending.timer);
        if(pending.generation !== this.accountGeneration)
        {
            pending.reject(new DirectChatError("账号已切换","DIRECT_ACCOUNT_CHANGED",0));
            return;
        }
        pending.resolve(data);
    }

    private RejectRealtimeRequest(requestId:string,error:any):void
    {
        if(requestId === "")
            return;
        let pending = this.realtimePending[requestId];
        if(pending == null)
            return;
        delete this.realtimePending[requestId];
        clearTimeout(pending.timer);
        pending.reject(error);
    }

    private RejectRealtimePending(error:any):void
    {
        for(let requestId in this.realtimePending)
            this.RejectRealtimeRequest(requestId,error);
    }

    /** 页面每次拿到最新消息后同步补偿游标，避免重复拉取。 */
    public SetMessageCursor(conversationId:string,messageId:string):void
    {
        if(conversationId == null || conversationId === "")
            return;
        this.pendingClientIds[conversationId] = messageId == null ? "" : messageId;
    }

    // ================= 录音与语音 =================

    /** 录音/播放统一走 MobileManager 单例，未初始化时按需创建。 */
    private Voice():MobileManager
    {
        try { return MobileManager.getInstance(); }
        catch(error) { return null; }
    }

    public VoiceSupported():boolean
    {
        if(cc.sys.isBrowser)
            return true;
        return this.Voice() != null;
    }

    public StartVoiceRecord(onDone:(voiceId:string,durationMs:number)=>void,
        onFailed:(message:string)=>void = null):string
    {
        let manager = this.Voice();
        if(manager == null)
            return "当前环境不支持录音";
        this.voiceCancelled = false;
        this.voiceFailed = "";
        this.voiceStartAt = Date.now();
        this.voiceSink = (voiceId:string,durationMs:number)=>{
            let sink = this.voiceSink;
            if(this.voiceCancelled)
                return;
            if(voiceId == null || voiceId === "")
            {
                if(onFailed != null)
                    onFailed("录音失败，请重试");
                return;
            }
            if(onDone != null)
                onDone(voiceId,durationMs);
        };
        manager.SetVoiceRecordResultHandler((voiceId:string)=>{
            let duration = Date.now() - this.voiceStartAt;
            this.voiceStartAt = 0;
            if(this.voiceSink != null)
                this.voiceSink(voiceId,duration);
        },(message:string)=>{
            this.voiceStartAt = 0;
            this.voiceFailed = message;
            if(onFailed != null)
                onFailed(message);
        });
        try
        {
            manager.StartRecord();
        }
        catch(error)
        {
            this.voiceSink = null;
            return "录音启动失败";
        }
        return "";
    }

    public StopVoiceRecord():void
    {
        let manager = this.Voice();
        if(manager == null)
            return;
        try { manager.StopRecord(); }
        catch(error) { Debug.Error("停止录音失败:" + error); }
    }

    public CancelVoiceRecord():void
    {
        this.voiceCancelled = true;
        let manager = this.Voice();
        if(manager == null)
            return;
        try { manager.StopRecord(true); }
        catch(error) { Debug.Error("取消录音失败:" + error); }
    }

    public IsRecording():boolean
    {
        return this.voiceStartAt > 0;
    }

    public RecordElapsedMs():number
    {
        return this.voiceStartAt > 0 ? Date.now() - this.voiceStartAt : 0;
    }

    public LastVoiceError():string
    {
        return this.voiceFailed;
    }

    private ClearVoiceState():void
    {
        this.voiceSink = null;
        this.voiceStartAt = 0;
        this.voiceCancelled = false;
        this.voiceFailed = "";
        let manager = this.Voice();
        if(manager != null)
            manager.SetVoiceRecordResultHandler(null,null);
    }

    /** 播放直聊语音：voiceId 走 AudioServer，不进入房间语音广播。 */
    public PlayVoice(voiceId:string):void
    {
        let manager = this.Voice();
        if(manager == null || voiceId == null || voiceId === "")
            return;
        manager.PreloadRecord(voiceId);
        manager.DownLoadRecord(voiceId);
    }

    // ================= 图片选择 =================

    private imagePicker:((result:DirectPickedImage)=>void) = null;
    private imagePickReject:((error:Error)=>void) = null;

    public ImagePickSupported():boolean
    {
        if(cc.sys.isBrowser)
            return typeof document !== "undefined";
        return cc.sys.isNative && typeof jsb !== "undefined" && jsb.reflection != null;
    }

    /**
     * 选择图片。浏览器走 <input type=file>（camera 时追加 capture）；原生走
     * DirectChatImageBridge 的 Pick/TakePhoto，由它把结果写到缓存目录后回调
     * `DirectChatImagePicked`（见 native 桥说明）。
     */
    public PickImage(source:DirectImageSource = "library"):Promise<DirectPickedImage>
    {
        if(!this.ImagePickSupported())
            return Promise.reject(new DirectChatError("当前平台不支持选择图片","MEDIA_INVALID"));
        return new Promise<DirectPickedImage>((resolve,reject)=>{
            this.imagePicker = resolve;
            this.imagePickReject = reject;
            if(cc.sys.isBrowser)
                this.PickImageInBrowser(source);
            else
                this.PickImageNative(source);
        });
    }

    /** 原生桥的失败原因转成可读提示；code 沿用桥返回的 denied/unsupported。 */
    private PickImageError(code:string,source:DirectImageSource):DirectChatError
    {
        let camera = source === "camera";
        if(code === "denied")
            return new DirectChatError(camera ? "未获得相机权限，请在系统设置中允许后重试" : "未获得相册权限，请在系统设置中允许后重试","MEDIA_PERMISSION");
        if(code === "unsupported")
            return new DirectChatError(camera ? "当前设备无法拍照，请改用相册选择" : "当前版本不支持选择图片，请更新客户端","MEDIA_INVALID");
        return new DirectChatError(camera ? "已取消拍照" : "未选择图片","MEDIA_INVALID");
    }

    private FinishPickImage(result:DirectPickedImage,error:Error):void
    {
        let resolve = this.imagePicker;
        let reject = this.imagePickReject;
        this.imagePicker = null;
        this.imagePickReject = null;
        if(error != null)
        {
            if(reject != null)
                reject(error);
            return;
        }
        if(resolve != null)
            resolve(result);
    }

    private PickImageInBrowser(source:DirectImageSource):void
    {
        let input:any = document.createElement("input");
        input.type = "file";
        input.accept = "image/jpeg,image/png,image/webp";
        // 移动浏览器靠 capture 直接调相机；桌面浏览器忽略该属性，退化成文件选择。
        if(source === "camera")
            input.capture = "environment";
        input.style.display = "none";
        let finished = false;
        let cleanup = ()=>{
            if(input.parentNode != null)
                input.parentNode.removeChild(input);
        };
        input.onchange = ()=>{
            if(finished)
                return;
            finished = true;
            let file = input.files != null && input.files.length > 0 ? input.files[0] : null;
            if(file == null)
            {
                cleanup();
                this.FinishPickImage(null,new DirectChatError("未选择图片","MEDIA_INVALID"));
                return;
            }
            let mime = String(file.type || "").toLowerCase();
            if(["image/jpeg","image/png","image/webp"].indexOf(mime) < 0)
            {
                cleanup();
                this.FinishPickImage(null,new DirectChatError("只支持 JPEG、PNG、WebP 图片","MEDIA_INVALID"));
                return;
            }
            if(Number(file.size) > 10 * 1024 * 1024)
            {
                cleanup();
                this.FinishPickImage(null,new DirectChatError("图片不能超过 10MB","MEDIA_TOO_LARGE"));
                return;
            }
            let reader = new FileReader();
            reader.onload = ()=>{
                let data:any = reader.result;
                let url = URL.createObjectURL(file);
                let image = new Image();
                image.onload = ()=>{
                    let width = image.naturalWidth || image.width;
                    let height = image.naturalHeight || image.height;
                    URL.revokeObjectURL(url);
                    cleanup();
                    if(width > 4096 || height > 4096)
                    {
                        this.FinishPickImage(null,new DirectChatError("图片最长边不能超过 4096 像素","MEDIA_INVALID"));
                        return;
                    }
                    this.FinishPickImage({data:data,mime:mime,width:width,height:height,size:Number(file.size)},null);
                };
                image.onerror = ()=>{
                    URL.revokeObjectURL(url);
                    cleanup();
                    this.FinishPickImage(null,new DirectChatError("图片读取失败","MEDIA_INVALID"));
                };
                image.src = url;
            };
            reader.onerror = ()=>{
                cleanup();
                this.FinishPickImage(null,new DirectChatError("图片读取失败","MEDIA_INVALID"));
            };
            reader.readAsArrayBuffer(file);
        };
        document.body.appendChild(input);
        input.click();
    }

    private PickImageNative(source:DirectImageSource):void
    {
        let camera = source === "camera";
        let requestId = Date.now().toString(36) + (camera ? "c" : "p");
        // 老包里没有原生桥时 jsb.reflection 不抛异常、回调也永远不来，
        // 这里兜一个超时，免得按钮点下去完全没反应。
        let watchdog = setTimeout(()=>{
            this.FinishPickImage(null,new DirectChatError(
                camera ? "当前版本不支持拍照，请更新客户端" : "当前版本不支持选择图片，请更新客户端",
                "MEDIA_INVALID"));
        },30000);
        (window as any).DirectChatImagePicked = (payload:any)=>{
            let data:any = payload;
            if(typeof payload === "string")
            {
                try { data = JSON.parse(payload); }
                catch(error) { data = null; }
            }
            if(data == null)
            {
                clearTimeout(watchdog);
                this.FinishPickImage(null,new DirectChatError("图片读取失败","MEDIA_INVALID"));
                return;
            }
            if(data.requestId !== undefined && String(data.requestId) !== requestId)
                return;
            clearTimeout(watchdog);
            let errorCode = String(data.error || "");
            let path = String(data.path || "");
            let mime = String(data.mime || "image/jpeg").toLowerCase();
            if(mime === "image/jpg")
                mime = "image/jpeg";
            let width = Number(data.width || 0);
            let height = Number(data.height || 0);
            let size = Number(data.size || 0);
            if(path === "")
            {
                this.FinishPickImage(null,this.PickImageError(errorCode,source));
                return;
            }
            let bytes:any = null;
            try
            {
                if(typeof jsb !== "undefined" && jsb.fileUtils != null && jsb.fileUtils.getDataFromFile != null)
                    bytes = jsb.fileUtils.getDataFromFile(path);
            }
            catch(error) { bytes = null; }
            if(bytes == null)
            {
                this.FinishPickImage(null,new DirectChatError("图片读取失败","MEDIA_INVALID"));
                return;
            }
            bytes = this.NormalizeUploadData(bytes);
            if(size <= 0)
            {
                try
                {
                    size = Number(bytes.byteLength || bytes.length || 0);
                }
                catch(error) { size = 0; }
            }
            if(size <= 0)
            {
                this.FinishPickImage(null,new DirectChatError("图片读取失败","MEDIA_INVALID"));
                return;
            }
            this.FinishPickImage({data:bytes,mime:mime,width:width,height:height,size:size},null);
        };
        try
        {
            if(cc.sys.os === cc.sys.OS_ANDROID)
            {
                jsb.reflection.callStaticMethod("org/cocos2dx/javascript/DirectChatImageBridge",
                    camera ? "TakePhoto" : "Pick","(Ljava/lang/String;)V",requestId);
            }
            else
            {
                jsb.reflection.callStaticMethod("DirectChatImageBridge",
                    camera ? "TakePhoto:" : "Pick:",requestId);
            }
        }
        catch(error)
        {
            clearTimeout(watchdog);
            this.FinishPickImage(null,this.PickImageError("unsupported",source));
        }
    }
}
