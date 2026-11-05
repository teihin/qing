import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import { KEFU_CHAT_HTTP_BASE, WEB_KEFU_CHAT_HTTP_BASE } from "../common/GameDef";
import { DirectAttachment, DirectChatError, DirectMessage, DirectPickedImage } from "./DirectChatManager";

const OFFICIAL_CHANNEL = "general";
const MEDIA_URL_TTL = 20 * 60 * 1000;
const UPLOAD_TIMEOUT = 60 * 1000;

export interface OfficialKefuState
{
    conversationId:string;
    status:string;
    category:string;
    agentName:string;
    onlineAgents:number;
    canSend:boolean;
    readOnlyReason:string;
}

/**
 * 游戏内官方客服直聊。
 *
 * 复用 ChatTool 玩家端（/chattool/api/player/*）的咨询会话、排队和客服工作台，
 * 用内嵌令牌走请求头，不依赖 WebView Cookie；与俱乐部直聊 /api/direct 完全独立。
 */
export default class OfficialKefuManager
{
    private static instance:OfficialKefuManager = null;

    public static GetInstance():OfficialKefuManager
    {
        if(OfficialKefuManager.instance == null)
            OfficialKefuManager.instance = new OfficialKefuManager();
        return OfficialKefuManager.instance;
    }

    private token:string = "";
    private sessionRef:string = "";
    private guuid:string = "";
    private conversationId:string = "";
    private mediaUrls:{[mediaId:string]:{url:string;expiresAt:number}} = {};

    public CurrentGuuid():string
    {
        let account = GameDataManager.getAccount();
        if(account == null || account.guuid === undefined || account.guuid === null)
            return "";
        return String(account.guuid).trim();
    }

    public ConversationId():string
    {
        return this.conversationId;
    }

    public Reset():void
    {
        this.token = "";
        this.sessionRef = "";
        this.conversationId = "";
        this.guuid = "";
        this.mediaUrls = {};
    }

    /** 建立（或复用）官方客服会话；玩家每次重新打开都会用当前资料续上排队/接待中的会话。 */
    public Open():Promise<OfficialKefuState>
    {
        let guuid = this.CurrentGuuid();
        if(guuid === "")
            return Promise.reject(new DirectChatError("请先登录游戏","PLAYER_NOT_LOGIN"));
        if(this.guuid !== guuid)
            this.Reset();
        this.guuid = guuid;

        let account = GameDataManager.getAccount();
        let playerInfo:any = {
            playerId: guuid,
            nickname: account.name,
            level: account.level,
            platform: cc.sys.os === cc.sys.OS_IOS ? "ios" : (cc.sys.os === cc.sys.OS_ANDROID ? "android" : "web"),
            channel: OFFICIAL_CHANNEL,
            metadata: {
                "角色": account.role || "",
                "当前房间": account.roomID || "",
                "客服入口": "官方客服"
            },
            ts: Math.floor(Date.now() / 1000)
        };
        let encryptedData = Tool.encrypt(JSON.stringify(playerInfo),"");
        return this.Send("POST","/api/player/session",{ encryptedData:encryptedData, embedded:true },true)
            .then((data:any)=>{
                this.token = String(data.embeddedToken || "");
                this.sessionRef = String(data.sessionRef || "");
                let conv = data.conversation == null ? {} : data.conversation;
                this.conversationId = String(conv.id || "");
                return this.NormalizeState(data);
            });
    }

    public RefreshState():Promise<OfficialKefuState>
    {
        return this.Send("GET","/api/player/me",null,false).then((data:any)=>{
            let conv = data.conversation == null ? {} : data.conversation;
            let id = String(conv.id || "");
            if(id !== "")
                this.conversationId = id;
            return this.NormalizeState(data);
        });
    }

    public LoadMessages():Promise<DirectMessage[]>
    {
        if(this.token === "")
            return Promise.reject(new DirectChatError("客服会话尚未建立","PLAYER_SESSION_EXPIRED"));
        return this.Send("GET","/api/player/messages",null,false).then((data:any)=>{
            let items:DirectMessage[] = [];
            for(let one of (data == null || data.items == null ? [] : data.items))
                items.push(this.NormalizeMessage(one));
            return this.ResolveMediaUrls(items).then(()=>items);
        });
    }

    public SendText(text:string,clientMessageId:string):Promise<DirectMessage>
    {
        return this.Send("POST","/api/player/messages",{
            text:text, clientMessageId:clientMessageId
        },false).then((data:any)=>this.NormalizeMessage(data));
    }

    /** 图片走玩家端上传接口：服务端直接生成图片消息并派单，不需要再发一次文字消息。 */
    public SendImage(image:DirectPickedImage):Promise<DirectMessage>
    {
        if(this.token === "")
            return Promise.reject(new DirectChatError("客服会话尚未建立","PLAYER_SESSION_EXPIRED"));
        if(image == null || image.data == null)
            return Promise.reject(new DirectChatError("图片读取失败","MEDIA_INVALID"));
        let boundary = "----ChatTool" + Date.now().toString(16) + Math.random().toString(16).slice(2);
        let mime = String(image.mime || "image/jpeg");
        let ext = mime.indexOf("png") >= 0 ? ".png" :
            (mime.indexOf("webp") >= 0 ? ".webp" : (mime.indexOf("gif") >= 0 ? ".gif" : ".jpg"));
        let head = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"image" +
            ext + "\"\r\nContent-Type: " + mime + "\r\n\r\n";
        let tail = "\r\n--" + boundary + "--\r\n";
        let body = this.BuildMultipartBody(head,image.data,tail);
        return this.Send("POST","/api/player/uploads",body,false,{
            contentType:"multipart/form-data; boundary=" + boundary,
            timeout:UPLOAD_TIMEOUT
        }).then((data:any)=>{
            let message = this.NormalizeMessage(data);
            return this.ResolveMediaUrls([message]).then(()=>message);
        });
    }

    public MarkRead():Promise<void>
    {
        if(this.token === "")
            return Promise.resolve();
        return this.Send("POST","/api/player/read",{},false).then(()=>undefined);
    }

    /** 清除玩家这一侧的客服聊天记录；客服工作台仍保留完整记录。 */
    public Clear():Promise<void>
    {
        if(this.token === "")
            return Promise.resolve();
        return this.Send("POST","/api/player/clear",{},false).then(()=>undefined);
    }

    private NormalizeState(data:any):OfficialKefuState
    {
        let conv = data == null || data.conversation == null ? {} : data.conversation;
        let status = String(conv.status || "");
        let onlineAgents = Number(data == null ? 0 : data.onlineAgents) || 0;
        let state:OfficialKefuState = {
            conversationId:String(conv.id || ""),
            status:status,
            category:String(conv.category || "官方客服"),
            agentName:String(conv.agentName || ""),
            onlineAgents:onlineAgents,
            // 客服不在线也允许先留言；会话保持排队，客服上线后自动接入。
            canSend:status !== "closed",
            readOnlyReason:""
        };
        if(status === "closed")
            state.readOnlyReason = "本次咨询已结束，请重新进入官方客服";
        return state;
    }

    private NormalizeMessage(one:any):DirectMessage
    {
        let senderType = String(one == null ? "" : (one.senderType || ""));
        let isSystem = senderType === "system";
        let text = String(one == null ? "" : (one.text || ""));
        let rawType = String(one == null ? "" : (one.messageType || "text"));
        let mediaId = String(one == null ? "" : (one.mediaId || ""));
        let attachment:DirectAttachment = null;
        let messageType = isSystem ? "system" : "text";
        if(!isSystem && rawType === "image" && mediaId !== "")
        {
            messageType = "image";
            attachment = {
                id:mediaId,
                type:"image",
                url:"",
                thumbnailUrl:"",
                durationMs:0,
                width:0,
                height:0,
                voiceId:""
            };
        }
        else if(rawType === "voice" || rawType === "audio")
            text = text === "" ? "[语音]" : text;
        else if(rawType === "video")
            text = text === "" ? "[视频]" : text;
        else if(rawType === "file")
            text = text === "" ? "[文件]" : text;
        return {
            id:String(one == null ? "" : (one.id || "")),
            messageType:messageType,
            text:text,
            attachment:attachment,
            senderGuuid:isSystem ? "" : (senderType === "player" ? this.CurrentGuuid() : "kefu:" + String(one.senderId || "")),
            senderName:isSystem ? "系统消息" : (senderType === "player" ? "我" : String(one.senderName || "BF")),
            senderRole:isSystem ? "" : (senderType === "player" ? "member" : "official"),
            clientMessageId:String(one == null ? "" : (one.clientMessageId || "")),
            createdAt:String(one == null ? "" : (one.createdAt || "")),
            pending:false,
            failed:false
        };
    }

    /** 图片消息只存 mediaId，展示前按当前会话换取带 ticket 的媒体地址。 */
    private ResolveMediaUrls(items:DirectMessage[]):Promise<void>
    {
        let now = Date.now();
        let pending:{[mediaId:string]:Promise<any>} = {};
        for(let item of items)
        {
            if(item == null || item.messageType !== "image" || item.attachment == null)
                continue;
            let mediaId = item.attachment.id;
            if(mediaId === "")
                continue;
            let cached = this.mediaUrls[mediaId];
            if(cached != null && cached.url !== "" && cached.expiresAt > now)
                continue;
            if(pending[mediaId] == null)
            {
                pending[mediaId] = this.FetchMediaUrl(mediaId).then((entry)=>{
                    if(entry != null)
                        this.mediaUrls[mediaId] = entry;
                }).catch(()=>undefined);
            }
        }
        let keys = Object.keys(pending);
        let wait = keys.length === 0 ? Promise.resolve() : Promise.all(keys.map((key)=>pending[key]));
        return wait.then(()=>{
            for(let item of items)
            {
                if(item == null || item.messageType !== "image" || item.attachment == null)
                    continue;
                let cached = this.mediaUrls[item.attachment.id];
                if(cached != null && cached.url !== "")
                {
                    item.attachment.url = cached.url;
                    item.attachment.thumbnailUrl = cached.url;
                }
                else
                {
                    // 取不到媒体票据时退回文字占位，避免显示空白图片框。
                    item.messageType = "text";
                    item.text = "[图片]";
                    item.attachment = null;
                }
            }
        });
    }

    private FetchMediaUrl(mediaId:string):Promise<{url:string;expiresAt:number}>
    {
        return this.Send("GET","/api/player/media/" + encodeURIComponent(mediaId) + "/ticket",null,false)
            .then((data:any)=>{
                let path = String(data == null || data.path == null ? "" : data.path);
                if(path === "")
                    return null;
                return { url:this.ApiBase() + path, expiresAt:Date.now() + MEDIA_URL_TTL };
            });
    }

    private BuildMultipartBody(head:string,data:any,tail:string):ArrayBuffer
    {
        let headBytes = this.AsciiBytes(head);
        let dataBytes = this.ToBytes(data);
        let tailBytes = this.AsciiBytes(tail);
        let body = new Uint8Array(headBytes.length + dataBytes.length + tailBytes.length);
        body.set(headBytes,0);
        body.set(dataBytes,headBytes.length);
        body.set(tailBytes,headBytes.length + dataBytes.length);
        return body.buffer;
    }

    private AsciiBytes(text:string):Uint8Array
    {
        let bytes = new Uint8Array(text.length);
        for(let i = 0;i < text.length;i++)
            bytes[i] = text.charCodeAt(i) & 0xff;
        return bytes;
    }

    private ToBytes(data:any):Uint8Array
    {
        if(data == null)
            return new Uint8Array(0);
        if(typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer)
            return new Uint8Array(data);
        if(typeof ArrayBuffer !== "undefined" && typeof (ArrayBuffer as any).isView === "function" &&
            (ArrayBuffer as any).isView(data))
            return new Uint8Array(data.buffer,Number(data.byteOffset || 0),Number(data.byteLength || 0));
        if(data.buffer != null)
            return new Uint8Array(data.buffer);
        return new Uint8Array(0);
    }

    private ApiBase():string
    {
        return cc.sys.isBrowser ? WEB_KEFU_CHAT_HTTP_BASE : KEFU_CHAT_HTTP_BASE;
    }

    private Send(method:string,path:string,body:any,sessionCreate:boolean,
        raw:{contentType:string;timeout?:number} = null):Promise<any>
    {
        let url = this.ApiBase() + path;
        let timeout = raw != null && raw.timeout > 0 ? raw.timeout : 15000;
        return new Promise<any>((resolve,reject)=>{
            let xhr = new XMLHttpRequest();
            let finished = false;
            let timer:any = setTimeout(()=>{
                if(finished)
                    return;
                try { xhr.abort(); }
                catch(error) {}
                finished = true;
                reject(new DirectChatError("请求超时，请稍后重试","TIMEOUT",0));
            },timeout);
            let done = (ok:boolean,value:any)=>{
                if(finished)
                    return;
                finished = true;
                clearTimeout(timer);
                if(ok)
                    resolve(value);
                else
                    reject(value);
            };
            xhr.onreadystatechange = ()=>{
                if(xhr.readyState !== 4 || finished)
                    return;
                if(xhr.status === 204)
                {
                    done(true,null);
                    return;
                }
                let text = xhr.responseText == null ? "" : String(xhr.responseText);
                let payload:any = null;
                try { payload = text === "" ? null : JSON.parse(text); }
                catch(error) { payload = null; }
                if(payload != null && payload.ok === true)
                {
                    done(true,payload.data);
                    return;
                }
                let code = payload != null && payload.error != null ? String(payload.error.code || "") : "";
                let message = payload != null && payload.error != null ? String(payload.error.message || "") : "";
                if(message === "")
                    message = xhr.status === 0 ? "网络异常，请检查网络后重试" : "请求失败（" + xhr.status + "）";
                done(false,new DirectChatError(message,code,xhr.status));
            };
            xhr.onerror = ()=>done(false,new DirectChatError("网络异常，请检查网络后重试","NETWORK_ERROR",0));
            xhr.ontimeout = ()=>done(false,new DirectChatError("请求超时，请稍后重试","TIMEOUT",0));
            try
            {
                xhr.open(method,url,true);
                if(!sessionCreate && this.token !== "")
                    xhr.setRequestHeader("X-Player-Embedded-Token",this.token);
                if(!sessionCreate && this.sessionRef !== "")
                    xhr.setRequestHeader("X-Player-Session-Ref",this.sessionRef);
                if(raw != null)
                    xhr.setRequestHeader("Content-Type",raw.contentType);
                else if(body !== null && body !== undefined)
                    xhr.setRequestHeader("Content-Type","application/json;charset=utf-8");
                xhr.send(raw != null ? body : (body === null || body === undefined ? null : JSON.stringify(body)));
            }
            catch(error)
            {
                done(false,new DirectChatError("请求发送失败，请稍后重试","SEND_FAILED",0));
            }
        });
    }
}
