import UIManager from "../common/UIManager";
import {
    ShowPanelMode,
    ClosePanelMode,
    AUDIO_SERVER_HTTP_BASE
} from "../common/GameDef";
import Debug from "../common/Debug";
import WebVoiceClient from "./WebVoiceClient";

var KBEngine = require("kbengine");

const {ccclass, property} = cc._decorator;

//桥接NATIVE和js管理器

@ccclass
export default class MobileManager extends cc.Component {

    private nodeCap:cc.Node = null;
    private camera:cc.Camera = null;
    private _canvas:HTMLCanvasElement = null;
    private _callFunc = null;
    private texture:cc.RenderTexture = null;

    private webVoiceClient:WebVoiceClient = null;
    private voiceRecordIntent:number = 0;
    private voiceRecordReleased:boolean = true;
    private voiceRecordTimer:any = null;
    private voiceRoomGeneration:number = 0;
    private nativeVoiceGenerations:any = {};
    private lastVoiceErrorAt:number = 0;
    private unlockBrowserAudio = ()=>{
        if(this.webVoiceClient != null)
            this.webVoiceClient.unlockPlayback();
    };
    private stopBrowserVoiceWhenHidden = (event:any)=>{
        if((event == null || event.type !== "pagehide") &&
            typeof document !== "undefined" && document.visibilityState !== "hidden")
        {
            return;
        }
        if(this.voiceRecordReleased)
            return;
        // 页面即将被冻结时不等待普通松手的50ms尾音窗口，优先提交已录PCM。
        this.StopRecord(true);
        KBEngine.Event.fire("VoiceRecordStopped", "");
    };

    

    static instance: MobileManager
    static getInstance() {
        if (!MobileManager.instance) {            
            let node = new cc.Node("MobileManager");
            cc.game.addPersistRootNode(node);
            this.instance = node.addComponent(MobileManager);            
        }
        return MobileManager.instance;
    }
    onDestroy(){
        this.voiceRoomGeneration++;
        this.voiceRecordIntent++;
        this.voiceRecordReleased = true;
        this.ClearVoiceRecordTimer();
        if(this.webVoiceClient != null)
        {
            this.webVoiceClient.shutdown();
            this.webVoiceClient = null;
        }
        if(this.IsAndroidVoice())
        {
            try {
                jsb.reflection.callStaticMethod(
                    "org/cocos2dx/javascript/QingVoiceBridge",
                    "LeaveRoom",
                    "()V"
                );
            } catch(error) {
                Debug.Log("Android语音清理失败:" + this.GetVoiceErrorText(error));
            }
        }
        if(this.IsIOSVoice())
        {
            try {
                jsb.reflection.callStaticMethod("QingVoiceBridge", "LeaveRoom");
            } catch(error) {
                Debug.Log("iOS语音清理失败:" + this.GetVoiceErrorText(error));
            }
        }
        if(typeof document !== "undefined")
        {
            document.removeEventListener("touchend", this.unlockBrowserAudio, true);
            document.removeEventListener("visibilitychange", this.stopBrowserVoiceWhenHidden, true);
        }
        if(typeof window !== "undefined")
            window.removeEventListener("pagehide", this.stopBrowserVoiceWhenHidden, true);
        KBEngine.Event.deregisterAll(this);
        MobileManager.instance = null;
    }

    update (dt) {
        // 历史 GCloudVoice 插件已停用，不再轮询原生语音引擎。
    }

    // 历史微信登录已停用，保留方法以兼容旧按钮绑定。
    wxLogin()
    {
        console.log("微信登录已停用");
    }

    //底层返回消息
    public static onMsgReturn(type:string,msg:string)
    {
        //UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,type+msg);
        if(type === "粘贴")
        {
            KBEngine.Event.fire("onPasteData",msg);
            return;
        }
        let instance = MobileManager.instance;
        if(instance == null)
            return;
        if(type === "语音录制成功")
        {
            instance.OnNativeVoiceUploaded(msg);
        }
        else if(type === "语音录制失败")
        {
            instance.OnNativeVoiceFailed(msg);
        }
        else if(type === "语音录制自动停止")
        {
            instance.OnNativeVoiceAutoStopped(msg);
        }
        else if(type === "语音播放完成")
        {
            KBEngine.Event.fire("OnPlayNextAudio", "");
        }
        else if(type === "语音播放失败")
        {
            Debug.Error("原生语音播放失败:" + msg);
            KBEngine.Event.fire("OnPlayNextAudio", "");
        }
    }

    public static test(msg:string)
    {
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,msg);
    }
    public static test2(tt:string,msg:string)
    {
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,tt+msg);
    }


    //-------------------------------------------语音相关------------------------------------------------
    //语音初始化
    public InitGvoice()
    {
        if(!cc.sys.isBrowser)
            return;
        if(this.webVoiceClient == null)
        {
            this.webVoiceClient = new WebVoiceClient(()=>{
                KBEngine.Event.fire("OnPlayNextAudio", "");
            });
            if(typeof document !== "undefined")
            {
                document.addEventListener("touchend", this.unlockBrowserAudio, true);
                document.addEventListener("visibilitychange", this.stopBrowserVoiceWhenHidden, true);
            }
            if(typeof window !== "undefined")
                window.addEventListener("pagehide", this.stopBrowserVoiceWhenHidden, true);
        }
    }

    // 进入牌桌后提前检查浏览器能力和地址配置。
    public PrepareVoice()
    {
        if(this.IsIOSVoice())
        {
            try {
                jsb.reflection.callStaticMethod(
                    "QingVoiceBridge",
                    "Prepare:",
                    this.GetNativeVoiceHttpBase()
                );
            } catch(error) {
                Debug.Error("iOS语音初始化失败:" + this.GetVoiceErrorText(error));
            }
            return;
        }
        if(this.IsAndroidVoice())
        {
            try {
                jsb.reflection.callStaticMethod(
                    "org/cocos2dx/javascript/QingVoiceBridge",
                    "Prepare",
                    "(Ljava/lang/String;)V",
                    this.GetNativeVoiceHttpBase()
                );
            } catch(error) {
                Debug.Error("Android语音初始化失败:" + this.GetVoiceErrorText(error));
            }
            return;
        }
        if(!cc.sys.isBrowser)
            return;
        this.InitGvoice();
        if(this.webVoiceClient == null)
            return;
        this.webVoiceClient.prepare().catch((error:any)=>{
            // 预热失败不弹窗，用户真正按下语音时再给出明确提示。
            Debug.Log("语音预热未完成:" + this.GetVoiceErrorText(error));
        });
    }

    //开始录制
    public StartRecord()
    {
        if(this.IsIOSVoice())
        {
            if(!this.voiceRecordReleased)
                return;
            this.voiceRecordReleased = false;
            let intent = ++this.voiceRecordIntent;
            this.nativeVoiceGenerations[intent.toString()] = this.voiceRoomGeneration;
            this.ClearVoiceRecordTimer();
            this.voiceRecordTimer = setTimeout(()=>{
                if(intent !== this.voiceRecordIntent || this.voiceRecordReleased)
                    return;
                this.StopRecord();
                KBEngine.Event.fire("VoiceRecordStopped", "");
            }, 9600);
            try {
                jsb.reflection.callStaticMethod(
                    "QingVoiceBridge",
                    "StartRecord:clientTag:",
                    this.GetNativeVoiceHttpBase(),
                    intent.toString()
                );
            } catch(error) {
                delete this.nativeVoiceGenerations[intent.toString()];
                this.voiceRecordReleased = true;
                this.ClearVoiceRecordTimer();
                this.ShowVoiceError(error);
                KBEngine.Event.fire("VoiceRecordStopped", "");
            }
            return;
        }
        if(this.IsAndroidVoice())
        {
            if(!this.voiceRecordReleased)
                return;
            this.voiceRecordReleased = false;
            let intent = ++this.voiceRecordIntent;
            this.nativeVoiceGenerations[intent.toString()] = this.voiceRoomGeneration;
            this.ClearVoiceRecordTimer();
            this.voiceRecordTimer = setTimeout(()=>{
                if(intent !== this.voiceRecordIntent || this.voiceRecordReleased)
                    return;
                this.StopRecord();
                KBEngine.Event.fire("VoiceRecordStopped", "");
            }, 9600);
            try {
                jsb.reflection.callStaticMethod(
                    "org/cocos2dx/javascript/QingVoiceBridge",
                    "StartRecord",
                    "(Ljava/lang/String;Ljava/lang/String;)V",
                    this.GetNativeVoiceHttpBase(),
                    intent.toString()
                );
            } catch(error) {
                delete this.nativeVoiceGenerations[intent.toString()];
                this.voiceRecordReleased = true;
                this.ClearVoiceRecordTimer();
                this.ShowVoiceError(error);
                KBEngine.Event.fire("VoiceRecordStopped", "");
            }
            return;
        }
        if(!cc.sys.isBrowser)
            return;
        this.InitGvoice();
        if(this.webVoiceClient == null)
            return;
        // 多点触控、浏览器合成事件或按钮重复派发时只接受第一次按下。
        if(!this.voiceRecordReleased || this.webVoiceClient.isRecording())
            return;

        this.unlockBrowserAudio();
        this.voiceRecordReleased = false;
        let intent = ++this.voiceRecordIntent;
        this.ClearVoiceRecordTimer();
        // 从手指按下开始计时，包含麦克风恢复和网络建连耗时，避免慢网络下
        // 实际PCM超过服务器10秒上限。
        this.voiceRecordTimer = setTimeout(()=>{
            if(intent !== this.voiceRecordIntent || this.voiceRecordReleased)
                return;
            this.StopRecord();
            KBEngine.Event.fire("VoiceRecordStopped", "");
        }, 9600);
        this.webVoiceClient.start().then(()=>{
            if(intent !== this.voiceRecordIntent)
                return;
        }).catch((error:any)=>{
            if(intent !== this.voiceRecordIntent)
                return;
            this.voiceRecordReleased = true;
            this.ClearVoiceRecordTimer();
            let text = this.GetVoiceErrorText(error);
            if(text.indexOf("录音已取消") < 0 &&
                text.indexOf("录音已结束") < 0)
            {
                this.ShowVoiceError(error);
            }
            KBEngine.Event.fire("VoiceRecordStopped", "");
        });
    }

    //结束录制
    public StopRecord(immediate:boolean = false)
    {
        if(this.IsIOSVoice())
        {
            if(this.voiceRecordReleased)
                return;
            this.voiceRecordReleased = true;
            this.ClearVoiceRecordTimer();
            try {
                jsb.reflection.callStaticMethod("QingVoiceBridge", "StopRecord");
            } catch(error) {
                this.ShowVoiceError(error);
            }
            return;
        }
        if(this.IsAndroidVoice())
        {
            if(this.voiceRecordReleased)
                return;
            this.voiceRecordReleased = true;
            this.ClearVoiceRecordTimer();
            try {
                jsb.reflection.callStaticMethod(
                    "org/cocos2dx/javascript/QingVoiceBridge",
                    "StopRecord",
                    "()V"
                );
            } catch(error) {
                this.ShowVoiceError(error);
            }
            return;
        }
        if(!cc.sys.isBrowser)
            return;
        if(this.voiceRecordReleased)
            return;
        this.voiceRecordReleased = true;
        this.ClearVoiceRecordTimer();
        this.FinishWebRecord(immediate);
    }

    //下载录音
    public DownLoadRecord(strFile:string)
    {
        if(this.IsIOSVoice())
        {
            try {
                jsb.reflection.callStaticMethod(
                    "QingVoiceBridge",
                    "PlayFile:voiceId:",
                    this.GetNativeVoiceHttpBase(),
                    strFile
                );
            } catch(error) {
                Debug.Error("iOS语音播放失败:" + this.GetVoiceErrorText(error));
                KBEngine.Event.fire("OnPlayNextAudio", "");
            }
            return;
        }
        if(this.IsAndroidVoice())
        {
            try {
                jsb.reflection.callStaticMethod(
                    "org/cocos2dx/javascript/QingVoiceBridge",
                    "PlayFile",
                    "(Ljava/lang/String;Ljava/lang/String;)V",
                    this.GetNativeVoiceHttpBase(),
                    strFile
                );
            } catch(error) {
                Debug.Error("Android语音播放失败:" + this.GetVoiceErrorText(error));
                KBEngine.Event.fire("OnPlayNextAudio", "");
            }
            return;
        }
        if(!cc.sys.isBrowser)
            return;
        this.InitGvoice();
        if(this.webVoiceClient == null)
        {
            KBEngine.Event.fire("OnPlayNextAudio", "");
            return;
        }
        this.webVoiceClient.play(strFile).catch((error:any)=>{
            Debug.Error("语音播放失败:" + this.GetVoiceErrorText(error));
        });
    }

    // 收到房间语音消息时立即预下载；轮到播放时直接命中内存缓存。
    public PreloadRecord(strFile:string)
    {
        if(this.IsIOSVoice())
        {
            try {
                jsb.reflection.callStaticMethod(
                    "QingVoiceBridge",
                    "PreloadFile:voiceId:",
                    this.GetNativeVoiceHttpBase(),
                    strFile
                );
            } catch(error) {
                Debug.Log("iOS语音预下载失败:" + this.GetVoiceErrorText(error));
            }
            return;
        }
        if(this.IsAndroidVoice())
        {
            try {
                jsb.reflection.callStaticMethod(
                    "org/cocos2dx/javascript/QingVoiceBridge",
                    "PreloadFile",
                    "(Ljava/lang/String;Ljava/lang/String;)V",
                    this.GetNativeVoiceHttpBase(),
                    strFile
                );
            } catch(error) {
                Debug.Log("Android语音预下载失败:" + this.GetVoiceErrorText(error));
            }
            return;
        }
        if(!cc.sys.isBrowser)
            return;
        this.InitGvoice();
        if(this.webVoiceClient == null)
            return;
        this.webVoiceClient.preload(strFile).catch((error:any)=>{
            Debug.Log("语音预下载失败:" + this.GetVoiceErrorText(error));
        });
    }

    //播放录音(不允许外面调用)
    private PlayRecord()
    {
        // 网页版下载完成后由HTMLAudioElement直接播放。
    }

    public LeaveVoiceRoom()
    {
        this.voiceRoomGeneration++;
        this.voiceRecordIntent++;
        this.voiceRecordReleased = true;
        this.nativeVoiceGenerations = {};
        this.ClearVoiceRecordTimer();
        if(this.webVoiceClient != null)
            this.webVoiceClient.leaveRoom();
        if(this.IsAndroidVoice())
        {
            try {
                jsb.reflection.callStaticMethod(
                    "org/cocos2dx/javascript/QingVoiceBridge",
                    "LeaveRoom",
                    "()V"
                );
            } catch(error) {
                Debug.Log("Android语音离开房间清理失败:" + this.GetVoiceErrorText(error));
            }
        }
        if(this.IsIOSVoice())
        {
            try {
                jsb.reflection.callStaticMethod("QingVoiceBridge", "LeaveRoom");
            } catch(error) {
                Debug.Log("iOS语音离开房间清理失败:" + this.GetVoiceErrorText(error));
            }
        }
    }

    private FinishWebRecord(immediate:boolean = false)
    {
        if(this.webVoiceClient == null || !this.webVoiceClient.isRecording())
            return;
        let roomGeneration = this.voiceRoomGeneration;
        this.webVoiceClient.stop(immediate).then((voiceID:string)=>{
            if(voiceID == null || voiceID === "")
                return;
            // 上传期间已离开牌桌时不再把旧房间语音广播到新房间。
            if(roomGeneration !== this.voiceRoomGeneration)
                return;
            let account = this.GetAccount();
            if(account == null || typeof account.reqSay !== "function")
                throw new Error("游戏连接已断开");
            account.reqSay("@@语音@@" + voiceID);
        }).catch((error:any)=>{
            let text = this.GetVoiceErrorText(error);
            if(text.indexOf("录音时间太短") >= 0)
                return;
            this.ShowVoiceError(error);
        });
    }

    private ClearVoiceRecordTimer()
    {
        if(this.voiceRecordTimer != null)
        {
            clearTimeout(this.voiceRecordTimer);
            this.voiceRecordTimer = null;
        }
    }

    private IsAndroidVoice():boolean
    {
        return !cc.sys.isBrowser
            && cc.sys.os === cc.sys.OS_ANDROID
            && typeof jsb !== "undefined"
            && jsb.reflection != null;
    }

    private IsIOSVoice():boolean
    {
        return !cc.sys.isBrowser
            && cc.sys.os === cc.sys.OS_IOS
            && typeof jsb !== "undefined"
            && jsb.reflection != null;
    }

    private GetNativeVoiceHttpBase():string
    {
        let result = AUDIO_SERVER_HTTP_BASE;
        try {
            let configured = cc.sys.localStorage.getItem("AudioServerBaseURL");
            if(configured != null && configured.trim() !== "")
                result = configured.trim();
        } catch(error) {
            Debug.Log("读取Android语音服务器配置失败:" + error);
        }
        while(result.length > 0 && result.charAt(result.length - 1) === "/")
            result = result.substr(0, result.length - 1);
        return result;
    }

    private ParseNativeVoiceMessage(msg:string):any
    {
        let separator = msg == null ? -1 : msg.indexOf("\n");
        if(separator < 0)
            return { tag: -1, value: msg == null ? "" : msg };
        let tag = parseInt(msg.substring(0, separator), 10);
        return {
            tag: isNaN(tag) ? -1 : tag,
            value: msg.substring(separator + 1)
        };
    }

    private OnNativeVoiceUploaded(msg:string)
    {
        let response = this.ParseNativeVoiceMessage(msg);
        let key = response.tag.toString();
        let generation = this.nativeVoiceGenerations[key];
        delete this.nativeVoiceGenerations[key];
        if(response.value === "" || generation !== this.voiceRoomGeneration)
            return;
        let account = this.GetAccount();
        if(account == null || typeof account.reqSay !== "function")
        {
            this.ShowVoiceError(new Error("游戏连接已断开"));
            return;
        }
        account.reqSay("@@语音@@" + response.value);
    }

    private OnNativeVoiceFailed(msg:string)
    {
        let response = this.ParseNativeVoiceMessage(msg);
        let key = response.tag.toString();
        let generation = this.nativeVoiceGenerations[key];
        delete this.nativeVoiceGenerations[key];
        // 原生回调可能已排入主线程；切房后到达的旧失败不能污染新房间。
        if(generation !== this.voiceRoomGeneration)
            return;
        if(response.tag === this.voiceRecordIntent)
        {
            this.voiceRecordReleased = true;
            this.ClearVoiceRecordTimer();
            KBEngine.Event.fire("VoiceRecordStopped", "");
        }
        if(response.value.indexOf("录音时间太短") >= 0 ||
            response.value.indexOf("录音已取消") >= 0)
        {
            return;
        }
        this.ShowVoiceError(new Error(response.value));
    }

    private OnNativeVoiceAutoStopped(msg:string)
    {
        let response = this.ParseNativeVoiceMessage(msg);
        if(response.tag !== this.voiceRecordIntent)
            return;
        this.voiceRecordReleased = true;
        this.ClearVoiceRecordTimer();
        KBEngine.Event.fire("VoiceRecordStopped", "");
    }

    private GetAccount():any
    {
        if(KBEngine == null || KBEngine.app == null ||
            typeof KBEngine.app.player !== "function")
            return null;
        return KBEngine.app.player();
    }

    private ShowVoiceError(error:any)
    {
        let now = new Date().getTime();
        if(now - this.lastVoiceErrorAt < 1000)
            return;
        this.lastVoiceErrorAt = now;
        UIManager.getInstance().showPanel(
            "panelMsgView",
            ShowPanelMode.Cover,
            this.GetVoiceErrorText(error)
        );
    }

    private GetVoiceErrorText(error:any):string
    {
        if(error == null)
            return "语音功能暂时不可用";
        let message = error.message == null ? error.toString() : error.message.toString();
        if(message.indexOf("Permission") >= 0 ||
            message.indexOf("NotAllowedError") >= 0 ||
            message.indexOf("denied") >= 0)
        {
            if(this.IsAndroidVoice() || this.IsIOSVoice())
                return "麦克风权限未开启，请在系统设置中允许麦克风";
            return "麦克风权限未开启，请在浏览器设置中允许麦克风";
        }
        return message;
    }

    //------------------------------talkingdata------------------------------------
    public InitTalkingData()
    {
        // 历史 TalkingData SDK 已停用。
    }
    //设置账号信息
    public SetAccount()
    {
        // 历史 TalkingData SDK 已停用。
    }
    //设置自定义信息
    public OnTalkingEvent(strEvent:string,strParam:string)
    {
        // 历史 TalkingData SDK 已停用。
    }
    //-----------------------------------其他-------------------------------------------
    public GetCurGps():string
    {
        if(cc.sys.isBrowser)
            return;
        let ret:string = "";
        if(cc.sys.os == cc.sys.OS_ANDROID)
        {            
            ret = jsb.reflection.callStaticMethod("org/cocos2dx/javascript/AppActivity", "GetCurGps", "()Ljava/lang/String;");
        }
        else if(cc.sys.os == cc.sys.OS_IOS)
        {            
            ret = jsb.reflection.callStaticMethod("AppController","GetCurGps");        
        }        
        return ret;
    }


    //---------------------------------------截图-----------------------------------------
    private _width = 0;
    private _height = 0;
    public CaptureScreen()
    {
        //截图
        this.nodeCap = new cc.Node();
        this.nodeCap.parent = cc.find("Canvas/Normal");//cc.director.getScene();
        this.camera = this.nodeCap.addComponent(cc.Camera);
        this.nodeCap.opacity = 100;
        this.nodeCap.anchorX = 0.5;
        this.nodeCap.anchorY = 0.5;
        this.nodeCap.x = 0;//cc.visibleRect.width/2;
        this.nodeCap.y = 0;//cc.visibleRect.height/2;

        var texture = new cc.RenderTexture();
        var gl = cc.game._renderContext;
        texture.initWithSize(cc.visibleRect.width, cc.visibleRect.height, gl.STENCIL_INDEX8);
        //this.camera.cullingMask = 0xffffffff;
        this.camera.targetTexture = texture;
        this.texture = texture;
        this._callFunc = null;

        if(cc.sys.isBrowser)
        {
            this.captureAndShow_web();
        }
        else
        {
            this.scheduleOnce(() => {                
                let picData = this.initImageNative();
                UIManager.getInstance().showPanel("panelLoading",ShowPanelMode.Top);
                this.scheduleOnce(()=>{
                    Debug.Log("初始化完成");
                    //this.createCanvas(picData);
                    UIManager.getInstance().closePanelByName("panelLoading",ClosePanelMode.Top);
                    UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"已保存二维码到相册！");
                    Debug.Log("创建完结");
                    this.saveFile(picData);
                    Debug.Log("保存完成");
                    this.camera.enabled = false;
                },0.3);                
            },0.1);
        }
    }
    public initImageNative () {
        let data = this.texture.readPixels();
        this._width = this.texture.width;
        this._height = this.texture.height;
        let picData = this.filpYImage(data, this._width, this._height);
        return picData;
    }
    // override init with Data
    public createCanvas(picData) {
        let texture = new cc.Texture2D();
        texture.initWithData(picData, 32, this._width, this._height);

        let spriteFrame = new cc.SpriteFrame();
        spriteFrame.setTexture(texture);

        let node = new cc.Node();
        let sprite = node.addComponent(cc.Sprite);
        sprite.spriteFrame = spriteFrame;
        node.opacity = 0;

        node.zIndex = cc.macro.MAX_ZINDEX;
        node.parent = cc.find("Canvas/Normal");//cc.director.getScene();
        // set position
        let width = cc.winSize.width;
        let height = cc.winSize.height;
        node.x = 0;//width / 2;
        node.y = 0;//height / 2;
        node.on(cc.Node.EventType.TOUCH_START, () => {
            node.parent = null;
            node.destroy();
        });

        this.captureAction(node, width, height);
    }
    // This is a temporary solution
    public filpYImage (data, width, height) {
        // create the data array
        let picData = new Uint8Array(width * height * 4);
        let rowBytes = width * 4;
        for (let row = 0; row < height; row++) {
            let srow = height - 1 - row;
            let start = srow * width * 4;
            let reStart = row * width * 4;
            // save the piexls data
            for (let i = 0; i < rowBytes; i++) {
                picData[reStart + i] = data[start + i];
            }
        }
        return picData;
    }

    // sprite action
    public captureAction (capture:cc.Node, width, height) {
        UIManager.getInstance().closePanelByName("panelLoading",ClosePanelMode.Top);
        capture.opacity = 255;
        capture.anchorY = 0;
        capture.anchorX = 1;
        let scaleAction = cc.scaleTo(0.5,0.3);
        let targetPos = cc.v2(width/2,  -(height / 2));
        let moveAction = cc.moveTo(0.5, targetPos); 
        let spawn = cc.spawn(scaleAction, moveAction);
        capture.runAction(spawn);
        let blinkAction = cc.blink(0.1, 0.5);
        // scene action
        this.node.runAction(cc.sequence(blinkAction,cc.delayTime(0.5),cc.callFunc(()=>{            
            this.nodeCap.destroy();
            capture.destroy();
        })));
    }
    public saveFile (picData) {
        if (CC_JSB) {
            let filePath = jsb.fileUtils.getWritablePath() + 'share'+new Date().getTime().toString()+'.png';
            let success = jsb.saveImageData(picData, this._width, this._height, filePath)
            if (success) {
                Debug.Log("save image data success, file1: " + filePath);   
                //保存到相册
                this.SaveToBook(filePath);
                
            }
            else {
                Debug.Log("save image data failed!");
            }
        }
    }

    public SaveToBook(strFile)
    {
        if(cc.sys.isBrowser)
            return;
        if(cc.sys.os == cc.sys.OS_ANDROID)
        {            
            jsb.reflection.callStaticMethod("org/cocos2dx/javascript/AppActivity", "saveTextureToLocal", "(Ljava/lang/String;)V",strFile);
        }
        else if(cc.sys.os == cc.sys.OS_IOS)
        {            
            jsb.reflection.callStaticMethod("AppController","saveTextureToLocal:",strFile);        
        }
        else
        {
            console.log("非手机平台不支持下载");
        }
    }

    //拷贝数据到手机
    public CopyToPhone(strTxt)
    {
        if(cc.sys.isBrowser)
        {
            const el = document.createElement('textarea');
			el.value = strTxt;
 
			// Prevent keyboard from showing on mobile
			el.setAttribute('readonly', '');
			//el.style.contain = 'strict';
			el.style.position = 'absolute';
			el.style.left = '-9999px';
			el.style.fontSize = '12pt'; // Prevent zooming on iOS
 
			const selection = getSelection()!;
			let originalRange;
			if (selection.rangeCount > 0) {
				originalRange = selection.getRangeAt(0);
			}
 
			document.body.appendChild(el);
			el.select();
 
			// Explicit selection workaround for iOS
			el.selectionStart = 0;
			el.selectionEnd = strTxt.length;
 
			let success = false;
			try {
				success = document.execCommand('copy');
			} catch (err) { }
 
			document.body.removeChild(el);
 
			if (originalRange) {
				selection.removeAllRanges();
				selection.addRange(originalRange);
            return
            }
        }
        if(cc.sys.os == cc.sys.OS_ANDROID)
        {            
            jsb.reflection.callStaticMethod("org/cocos2dx/javascript/AppActivity", "CopyData", "(Ljava/lang/String;)V",strTxt);
        }
        else if(cc.sys.os == cc.sys.OS_IOS)
        {            
            jsb.reflection.callStaticMethod("AppController","CopyData:",strTxt);         
        }
        else
        {
            console.log("非手机平台不支持");
        }
    }
    //获取剪切板数据
    public GetPasteData()
    {
        if(cc.sys.os == cc.sys.OS_ANDROID)
        {            
            jsb.reflection.callStaticMethod("org/cocos2dx/javascript/AppActivity", "GetCopyData", "()V");
        }
        else if(cc.sys.os == cc.sys.OS_IOS)
        {            
            jsb.reflection.callStaticMethod("AppController","GetCopyData");            
        }
        else
        {
            console.log("非手机平台不支持");
        }
    }














    // create the img element
    public initImage () {
        // return the type and dataUrl
        if(this._canvas == null)
        {
            Debug.Log("发现canvas是空！！！！");
        }
        else
        {
            Debug.Log("如下1:");
           console.log(this._canvas);
        }
        var dataURL = this._canvas.toDataURL();
        var img = document.createElement("img");
        img.src = dataURL;
        return img;
    }
    // create the canvas and context, filpY the image Data
    public createSprite () 
    {
        var width = this.texture.width;
        var height = this.texture.height;
        if (!this._canvas) {
            this._canvas = document.createElement('canvas');
    
            this._canvas.width = width;
            this._canvas.height = height;
        }
        else {
            this.clearCanvas();
        }
        var ctx = this._canvas.getContext('2d');
        this.camera.render();
        var data = this.texture.readPixels();
        // write the render data
        var rowBytes = width * 4; 
        for (var row = 0; row < height; row++) {
            var srow = height - 1 - row;
            var imageData = ctx.createImageData(width, 1);
            var start = srow * width * 4;
            for (var i = 0; i < rowBytes; i++) {
                imageData.data[i] = data[start + i];
            }

            ctx.putImageData(imageData, 0, row);
        }
        return this._canvas;
    }
    // show on the canvas
    public showSprite (img) {
        var texture = new cc.Texture2D();
        texture.initWithElement(img);

        var spriteFrame = new cc.SpriteFrame();
        spriteFrame.setTexture(texture);

        var node = new cc.Node();
        var sprite = node.addComponent(cc.Sprite);
        sprite.spriteFrame = spriteFrame;

        node.zIndex = cc.macro.MAX_ZINDEX;
        node.parent = cc.director.getScene();
        node.x = cc.winSize.width / 2;
        node.y = cc.winSize.height / 2;
        node.on(cc.Node.EventType.TOUCH_START, () => {
            node.parent = null;
            node.destroy();
        }); 
    }

    public clearCanvas () {
        var ctx = this._canvas.getContext('2d');
        ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    }
    //截屏到本地终端设备
    public captureAndShow_native (strPngName, callFunc) {
        this._callFunc = callFunc;
        this.createSprite();
        var img = this.initImage();
        this.showSprite(img);
        this.saveFile_native(strPngName);
    }

    public saveFile_native (strPngName) {
        if (CC_JSB) {
            var data = this.texture.readPixels();
            var width = this.texture.width;
            var height = this.texture.height;
            var picData = this.filpYImage_native(data, width, height);

            var filePath = jsb.fileUtils.getWritablePath() + strPngName;

            var success = jsb.saveImageData(picData, width, height, filePath)
            if (success) {
                //cc.log("save image data success, file: " + filePath);
                 if (this._callFunc) {
                     this._callFunc(filePath);
                 }
            }
            else {
                cc.error("save image data failed!");
            }
        }
        else {
            cc.log("saveImage, only supported on native platform.");
        }
    }

    // This is a temporary solution
    public filpYImage_native (data, width, height) {
        // create the data array
        var picData = new Uint8Array(width * height * 4);
        var rowBytes = width * 4;
        for (var row = 0; row < height; row++) {
            var srow = height - 1 - row;
            var start = srow * width * 4;
            var reStart = row * width * 4;
            // save the piexls data
            for (var i = 0; i < rowBytes; i++) {
                picData[reStart + i] = data[start + i];
            }
        }    
        return picData;
    }

    //浏览器 网页截屏
    public captureAndShow_web () {
        this.createSprite();
        var img = this.initImage();
        this.showSprite(img);
        // download the pic as the file to your local
        //'Showing the capture'
        this.downloadFile_web('capture_to_web.png', img.src);
    }

    public base64Img2Blob_web(code){
        var parts = code.split(';base64,');
        var contentType = parts[0].split(':')[1];
        var raw = window.atob(parts[1]);
        var rawLength = raw.length;

        var uInt8Array = new Uint8Array(rawLength);

        for (var i = 0; i < rawLength; ++i) {
          uInt8Array[i] = raw.charCodeAt(i);
        }

        return new Blob([uInt8Array], {type: contentType}); 
    }

    public downloadFile_web (fileName, content){      
        var aLink = document.createElement('a');
        var blob = this.base64Img2Blob_web(content);
      
        var evt = document.createEvent("MouseEvents");
        evt.initEvent("click", false, false);
        aLink.download = fileName;
        aLink.href = URL.createObjectURL(blob);
 
        aLink.dispatchEvent(evt);
    }
}
cc["MobileManager"] = MobileManager;
