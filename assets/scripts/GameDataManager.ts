import { SERVER_IP, SERVER_PORT, IS_USE_WSS, LOGIN_BY_IP, SERVER_URL, ClosePanelMode, ShowPanelMode, WEB_IP, SERVER_IP_TEST, BASE_SERVER_IP, WEB_KB_WSS_PROXY_BASE_URL, WEB_KB_WSS_ALLOWED_PORTS } from "./common/GameDef";
import Debug from "./common/Debug";
import UIManager from "./common/UIManager";
import DrhNameManager from "./logic/DrhNameManager";
import MobileManager from "./mobile/MobileManager";
import Tool from "./common/Tool";
import DeviceIdentityManager from "./logic/DeviceIdentityManager";
import QueueMatchManager from "./logic/QueueMatchManager";
import WebSceneLoader from "./common/WebSceneLoader";
import WebWakeLockManager from "./common/WebWakeLockManager";
import RoomInviteManager from "./logic/RoomInviteManager";

var KBEngine = require("kbengine");

const {ccclass, property} = cc._decorator;

@ccclass
export default class GameDataManager extends cc.Component {

    isInitSystem: boolean = false; //是否已经初始化过
    strLocalVertion:string = "-"; //本地版本
    strRemoteVertion:string = ""; //服务器版本


    public strLastUserName:string = ""; //最后一次登陆的id
    public strLastPass:string = ""; //最后一次密码
    public bLoginSuccess:boolean = false; //是否已经成功连接到服务器，成功则发送心跳
    private _loginAttempt:number = 0;
    private _antiTheftLoginStopped:boolean = false;
    private _automaticReconnectStoppedByKick:boolean = false;
    private _pendingForcedLogoutMessage:string = "";
    // 踢线原因仍在判定（探测登录服是否在线）时，登录页先挂着等结果，不能先弹中性文案。
    private _forcedLogoutReasonPending:boolean = false;
    private _forcedLogoutListeners:((message:string)=>void)[] = [];

    // 踢线提示分两种：只有确认是账号在别处登录时才报顶号，
    // 服务器重启/停机仍沿用既有的中性失效提示（历史上误报异地登录会被玩家投诉）。
    private static readonly KickMessageOtherDevice:string = "该账号已被其他设备登录";
    private static readonly KickMessageConnectionLost:string = "当前登录连接已失效，请重新登录";
    // 判定踢线原因时等待登录服握手的上限：正常几十毫秒，超过即按服务端不可用处理。
    private static readonly KickProbeTimeoutMs:number = 1500;

    public dtLastSend = new Date().getTime() + 1000*10; //最后一次发送心跳时间
    public dtLastSuccess = new Date().getTime() + 1000*10; //最后一次成功时间;
    public nNetworkDelay:number = 0; //网络延迟

    public nSelfPlayerSit = 0;

    public dtLastExit = new Date().getTime(); //最后一次退出后台时间

    public nShowNotify = true; //是否显示公告， 进入游戏只显示一次

    static instance: GameDataManager
    static getInstance() {
        if (!GameDataManager.instance) {            
            let node = new cc.Node("GameDataManager");
            cc.game.addPersistRootNode(node);
            this.instance = node.addComponent(GameDataManager);
            this.instance.initDataManager();
        }
        return GameDataManager.instance;
    }

    onDestroy(){
        WebWakeLockManager.shutdown();
        KBEngine.Event.deregisterAll(this);
        // GameDataManager 是常驻节点，热更新完成调用 cc.game.restart() 时也会被销毁。
        // 此时 KBEngine 的消息表可能已经开始清理，继续触发 logout 会让
        // Bundle.newMessage 收到 undefined，并阻断 Cocos 的重启销毁流程。
        // Native 重启会直接关闭旧连接，不需要在 onDestroy 中再发送登出包。
        GameDataManager.instance = null;
    }


    public static GetSerVerIP():string
    {
        let strType = Tool.GetConfigString("登陆模式","外网");
        Debug.Log("当前热更服务器:"+strType);
        return strType==="外网"?SERVER_IP:SERVER_IP_TEST;
    }


    //返回account对象
    static getAccount():any
    {
        // 切换账号/热更重启前会调用 KBEngine.destroy()，那段窗口里 app 是 undefined，
        // 场景销毁期间的遗留回调可能走到这里；返回 null 让调用方的判空生效。
        if(KBEngine.app == null || typeof KBEngine.app.player !== "function")
            return null;
        return KBEngine.app.player();
    }

    /**
     * 客户端能拿到的 BOSS/运营账号口径：`level >= 99`。
     * 服务端「代理链路」命令仍以 d_users 的 boss/bigboss 名单做最终鉴权，
     * 这里只决定要不要显示 BOSS 专属入口，不能当作权限校验。
     */
    public static IsBossAccount():boolean
    {
        const account:any = GameDataManager.getAccount();
        if(account == null)
            return false;
        const level = Number(account.level);
        if(isFinite(level) && level >= 99)
            return true;
        // 老平台账号（董事长/总裁）没有 99 级，但同样是运营视角。
        const role = account.role == null ? "" : String(account.role);
        return role.indexOf("董事长") >= 0 || role.indexOf("总裁") >= 0;
    }

    //全局初始化
    initDataManager()
    {
        if(this.isInitSystem === true)
            return;
        this.isInitSystem = true;

        this.initKBE();

        DrhNameManager.getInstance().initManager();
        MobileManager.getInstance().InitGvoice();
        MobileManager.getInstance().InitTalkingData();
        WebWakeLockManager.init();
        // 提前准备设备标识，减少用户点击登录后的等待时间。
        DeviceIdentityManager.getInstance().prepare();
        QueueMatchManager.getInstance();
        RoomInviteManager.getInstance();

        
        
        //注册事件
        KBEngine.Event.register("onConnectionState", this, "onConnectionState");
        KBEngine.Event.register("onLoginFailed", this, "onLoginFailed");
        KBEngine.Event.register("onLoginBaseappFailed", this, "onLoginBaseappFailed");		
        KBEngine.Event.register("onReloginBaseappFailed", this, "onReloginBaseappFailed");
        KBEngine.Event.register("onReloginBaseappSuccessfully", this, "onReloginBaseappSuccessfully");
        KBEngine.Event.register("onLoginBaseapp", this, "onLoginBaseapp");   
        KBEngine.Event.register("onDisconnected", this, "onDisconnected");
        
        KBEngine.Event.register("onLoginSuccessfully", this, "onLoginSuccessfully");   

        
        KBEngine.Event.register("onEnterRoom", this, "onEnterRoom");
        KBEngine.Event.register("onGoToMain", this, "onGoToMain");        
        KBEngine.Event.register("onKicked", this, "onKicked");

        KBEngine.Event.register("set_client_status", this, "set_client_status");
        KBEngine.Event.register("SystemInfo", this, "SystemInfo"); //全局通知

        //初始化游戏配置

        //启动重连校验
        this.autoSendHeart();
        this.autoCheckConnectState();


        //注册程序切换后台前台消息
        cc.game.on(cc.game.EVENT_HIDE,()=>{
            //程序进入后台
            Debug.Log("程序进入后台了！！！！！！！！！！！！！！");
            this.dtLastExit = new Date().getTime();
        },this);
        cc.game.on(cc.game.EVENT_SHOW,()=>{
            //程序进入前台
            Debug.Log("程序恢复前台了！！！！！！！！！！！！！！");
            this.dtLastSuccess = new Date().getTime();

            //检验退出时长
            let span = new Date().getTime()-this.dtLastExit;
            Debug.Log("退出时长:"+span);
            if(span>1000*60*30 && !cc.sys.isBrowser)//超过30分钟需要重新登陆
            {
                UIManager.getInstance().closePanelByName("panelKefu",ClosePanelMode.Normal);
                cc.game.restart();
            }
        },this);
    }

    //初始化KB
    initKBE(){


        Debug.Error("初始化了一次KB");

        var args = new KBEngine.KBEngineArgs();
        const useWebWss = cc.sys.isBrowser;
    
        args.ip = GameDataManager.GetSerVerIP();
        args.port = SERVER_PORT;
        args.isWss = useWebWss ? true : IS_USE_WSS; // Web统一WSS；Android/iOS保持原有WS
        args.wssProxyBaseURL = useWebWss ? WEB_KB_WSS_PROXY_BASE_URL : "";
        args.wssProxyAllowedPorts = useWebWss ? WEB_KB_WSS_ALLOWED_PORTS : [];
        args.isByIP = LOGIN_BY_IP;             //用ip还是用域名登录服务器   有修改官方的kbengine.js
        args.serverURL = SERVER_URL;

        args.defBaseAppIP = BASE_SERVER_IP //指定登录的BASEAPP地址

        KBEngine.create(args);
    }

    loginDelay(){
        if(this._antiTheftLoginStopped || this._automaticReconnectStoppedByKick)
            return;
        this.scheduleOnce(()=>{
            if(this._antiTheftLoginStopped || this._automaticReconnectStoppedByKick)
                return;
            this.loginGame(this.strLastUserName,this.strLastPass,"重连");
        },3);
    }

    onConnectionState(success) {
        if(!success)
        {
            Debug.Error(" Connect(" + KBEngine.app.ip + ":" + KBEngine.app.port + ") is error! (连接错误)");
            this.bLoginSuccess = false;

            this.loginDelay();
        }
        else
        {
            Debug.Log(" Connect(" + KBEngine.app.ip + ":" + KBEngine.app.port + ") 成功！");
        }
    }

    onLoginFailed(failedcode) {
        var logStr = '';
        if(failedcode == 20)
        {
           logStr = "Login is failed(登陆失败), err=" + KBEngine.app.serverErr(failedcode) + ", " + KBEngine.app.serverdatas;
        }
        else
        {
           logStr = "Login is failed(登陆失败), err=" + KBEngine.app.serverErr(failedcode);
        }    
        KBEngine.INFO_MSG(logStr);	


        if(this.isAntiTheftLoginError(failedcode))
        {
            this._antiTheftLoginStopped = true;
            UIManager.getInstance().closePanelByName("panelLoading",ClosePanelMode.Top);
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,this.antiTheftLoginMessage(failedcode));
        }
        else if(!this.hasServerErrorDefinition(failedcode))
        {
            // 未登记的服务端错误不能自动重试，否则会反复登录、反复报错。
            // 数字错误码只保留在引擎日志中，不向玩家界面展示。
            this._antiTheftLoginStopped = true;
            UIManager.getInstance().closePanelByName("panelLoading",ClosePanelMode.Top);
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
                "登录失败，服务端拒绝了本次登录，请联系客服");
        }
        else if(failedcode>=3 && failedcode<=6)
        {
            UIManager.getInstance().closePanelByName("panelLoading",ClosePanelMode.Top);
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,KBEngine.app.serverErrDes(failedcode));
        }
        else
        {
            this.loginDelay();
        }

        
     }

     onReloginBaseappFailed(failedcode){
        KBEngine.INFO_MSG("reogin is failed(断线重连失败), err=" + KBEngine.app.serverErr(failedcode))
        this.loginDelay();
     }

     onReloginBaseappSuccessfully() {
        KBEngine.INFO_MSG("reogin is successfully!(断线重连成功!)")
    }

     onLoginBaseappFailed(failedcode) {
        KBEngine.INFO_MSG("LoginBaseapp is failed(登陆网关失败), err=" + KBEngine.app.serverErr(failedcode));
        this.loginDelay();
     }

     onLoginBaseapp() {
        KBEngine.INFO_MSG("Connect to loginBaseapp, please wait...(连接到网关， 请稍后...)");
     }

     onDisconnected() {
        KBEngine.INFO_MSG("onDisconnected：");
        this.loginDelay();
     }

     onKicked(failedcode:number){
        KBEngine.INFO_MSG("服务器终止当前连接，停止自动重连！failedcode=" + failedcode);
        if(this._automaticReconnectStoppedByKick)
            return;

        // onKicked表示本次连接已经被服务端终止，与普通断网分开处理。
        // 多设备互踢时若旧客户端继续自动重连，会造成两个客户端循环互踢。
        this._automaticReconnectStoppedByKick = true;
        this._loginAttempt++;
        this.bLoginSuccess = false;
        this.unschedule(this.callbackSendHeart);
        this.unschedule(this.callbackCheckConnectState);

        // 地址必须在切场景前取：login 场景会重建 KBEngine，这次连接的服务器信息届时已丢失。
        let serverAddr = "";
        try {
            if(KBEngine.app != null)
                serverAddr = KBEngine.app.getServerAddr(KBEngine.app.ip, KBEngine.app.port);
        } catch(error) {}

        let finishKick = (message:string)=>{
            // 探测期间玩家可能已经手动登录成功（会解除踢线锁），迟到结果不能再弹提示。
            if(!this._automaticReconnectStoppedByKick)
                return;
            // 留一条可核对的日志：线上出现误报时，靠它确认 failedcode 与判定结果。
            KBEngine.INFO_MSG("踢线提示判定：" + message + "，failedcode=" + failedcode);
            this._pendingForcedLogoutMessage = message;
            this._forcedLogoutReasonPending = false;
            let listeners = this._forcedLogoutListeners;
            this._forcedLogoutListeners = [];
            for(let i=0;i<listeners.length;i++)
            {
                try { listeners[i](message); } catch(error) {}
            }
        };

        // 踢线后本机已无法继续游戏：先把玩家送回登录页，提示文案等判定完成再推给登录页，
        // 避免先弹中性文案再改口。
        this._forcedLogoutReasonPending = true;
        this._pendingForcedLogoutMessage = "";
        UIManager.getInstance().closePanelByName("panelLoading",ClosePanelMode.Top);
        WebSceneLoader.loadScene("login");

        // 服务端为顶号定义了专属错误码时直接按错误名识别，不必探测。
        if(this.IsAnotherDeviceKick(failedcode)){
            finishKick(GameDataManager.KickMessageOtherDevice);
            return;
        }
        // 封禁/后台管理类踢人不能算成异地登录，同样保持中性提示。
        if(this.IsAdministrativeKick(failedcode)){
            finishKick(GameDataManager.KickMessageConnectionLost);
            return;
        }
        // 否则用登录服是否仍在提供服务来区分：服务器重启/停机时握手必然失败，
        // 保持中性提示；能连上说明服务端还在跑，本次踢线来自业务层（顶号）。
        this.ProbeKickReason(serverAddr,(byAnotherDevice:boolean)=>{
            finishKick(byAnotherDevice ? GameDataManager.KickMessageOtherDevice : GameDataManager.KickMessageConnectionLost);
        });
     }

     /**
      * 服务端错误码是否明确表示“账号在其他地方登录”。
      * 未定义或无法识别时返回 false，交由 ProbeKickReason 兜底，不能凭猜测报顶号。
      */
     private IsAnotherDeviceKick(failedcode:number):boolean
     {
        let code = "";
        let description = "";
        try { code = (KBEngine.app.serverErr(failedcode) || "").toString().toUpperCase(); } catch(error) {}
        try { description = (KBEngine.app.serverErrDes(failedcode) || "").toString(); } catch(error) {}
        if(code == "")
            return false;

        let keywords:string[] = ["ANOTHER_PLACE","ANOTHER_DEVICE","OTHER_DEVICE","OTHER_LOGIN","LOGIN_ANOTHER","KICKED_BY_LOGIN"];
        for(let i=0;i<keywords.length;i++)
        {
            if(code.indexOf(keywords[i]) >= 0)
                return true;
        }
        return description.indexOf("其他设备") >= 0 ||
            description.indexOf("异地登录") >= 0 ||
            description.indexOf("其他地方登录") >= 0;
     }

     /**
      * 服务端错误码是否表示封禁、后台管理等非登录类踢人：这类同样只给中性提示，
      * 不能因为服务端在线就误报成“其他设备登录”。
      */
     private IsAdministrativeKick(failedcode:number):boolean
     {
        let code = "";
        try { code = (KBEngine.app.serverErr(failedcode) || "").toString().toUpperCase(); } catch(error) {}
        if(code == "")
            return false;
        let keywords:string[] = ["BAN","FORBID","FREEZE","BLOCK","ADMIN","GM_"];
        for(let i=0;i<keywords.length;i++)
        {
            if(code.indexOf(keywords[i]) >= 0)
                return true;
        }
        return false;
     }

     /**
      * 探测登录服是否仍在提供服务，用来区分顶号与服务器重启。
      * 只做 WebSocket 握手、连上即关闭，不发送登录包，不会产生新的在线会话。
      */
     private ProbeKickReason(serverAddr:string,done:(byAnotherDevice:boolean)=>void)
     {
        let finished = false;
        let pending = 0;
        let sockets:any[] = [];
        let timer:any = null;

        let closeAll = ()=>{
            for(let i=0;i<sockets.length;i++)
            {
                let socket:any = sockets[i];
                if(socket == null)
                    continue;
                try {
                    socket.onopen = null;
                    socket.onerror = null;
                    socket.onclose = null;
                    socket.close();
                } catch(error) {}
            }
            sockets = [];
        };

        let finish = (online:boolean)=>{
            if(finished)
                return;
            finished = true;
            if(timer != null)
            {
                clearTimeout(timer);
                timer = null;
            }
            closeAll();
            done(online);
        };

        // 拿不到地址、客户端不支持 WebSocket 时按服务端不可用处理，保持中性提示。
        let WebSocketCtor:any = (typeof WebSocket === "undefined") ? null : WebSocket;
        if(WebSocketCtor == null)
        {
            finish(false);
            return;
        }

        let candidates:string[] = [];
        if(serverAddr != "")
            candidates.push(serverAddr);
        // 原生端直连 KBEngine 的握手在部分环境会被服务端协议头校验拒绝，
        // 因此再补一个公网 WSS 反代入口：两个入口任一握手成功都说明服务端仍在跑，
        // 而服务器停机/重启时两个入口都会失败。
        let proxyAddr = this.GetKickProbeProxyAddr(serverAddr);
        if(proxyAddr != "" && proxyAddr != serverAddr)
            candidates.push(proxyAddr);
        if(candidates.length == 0)
        {
            finish(false);
            return;
        }

        let failOne = ()=>{
            pending--;
            if(pending <= 0)
                finish(false);
        };

        timer = setTimeout(()=>{ finish(false); },GameDataManager.KickProbeTimeoutMs);
        for(let i=0;i<candidates.length;i++)
        {
            // 前一个入口可能同步抛错并已判负，别再建新连接，否则这个 socket 不会被关掉。
            if(finished)
                break;
            pending++;
            try {
                let socket:any = new WebSocketCtor(candidates[i]);
                sockets.push(socket);
                let settled = false;
                socket.onopen = ()=>{
                    settled = true;
                    finish(true);
                };
                socket.onerror = ()=>{
                    if(settled)
                        return;
                    settled = true;
                    failOne();
                };
                socket.onclose = ()=>{
                    if(settled)
                        return;
                    settled = true;
                    failOne();
                };
            } catch(error) {
                failOne();
            }
        }
     }

     /**
      * 公网 WSS 反代入口（与网页版登录同一个地址），仅在端口白名单内拼接。
      * 传入的已经是代理地址时返回空串，避免重复探测同一入口。
      */
     private GetKickProbeProxyAddr(serverAddr:string):string
     {
        if(serverAddr.indexOf("wss://") == 0 || serverAddr.indexOf("https://") == 0)
            return "";

        let portText = "";
        try { portText = String(KBEngine.app.port); } catch(error) {}
        if(!/^\d+$/.test(portText))
            return "";
        let portNumber = parseInt(portText,10);
        if(WEB_KB_WSS_ALLOWED_PORTS.length > 0 && WEB_KB_WSS_ALLOWED_PORTS.indexOf(portNumber) < 0)
            return "";

        let proxyBaseURL = WEB_KB_WSS_PROXY_BASE_URL;
        if(proxyBaseURL == "")
            return "";
        if(proxyBaseURL.charAt(proxyBaseURL.length - 1) != "/")
            proxyBaseURL += "/";
        return proxyBaseURL + portText + "/";
     }

     onLoginSuccessfully(){
        KBEngine.INFO_MSG("登陆服务器成功！");
        
        //登陆成功，启动心跳校验
        this.dtLastSuccess = new Date().getTime();
        this.bLoginSuccess = true;
        this._antiTheftLoginStopped = false;
        this._automaticReconnectStoppedByKick = false;
        // 重新登录成功说明上一次踢线提示已经过期，清掉残留，避免下次进登录页又弹一次。
        this._forcedLogoutReasonPending = false;
        this._pendingForcedLogoutMessage = "";
        this._forcedLogoutListeners = [];
        UIManager.getInstance().closePanelByName("panelLoading",ClosePanelMode.Top);

        //恢复重连校验        
        this.autoSendHeart();
        this.autoCheckConnectState();
     }

     //自动发送心跳
     autoSendHeart()
     {
        this.unschedule(this.callbackSendHeart);
        this.schedule(this.callbackSendHeart,2,cc.macro.REPEAT_FOREVER,0.1); //每2秒发送一次心跳
     }
     //发送心跳处理回调
     callbackSendHeart()
     {
        if(!this.bLoginSuccess) //没有登陆成功，不发送心跳
        {
            Debug.Info("没有登陆，暂不获取心跳!");
            return;
        }
        var account = KBEngine.app.player();
 
        try
        {
            account.reqHeart();
        }
        catch(e)
        {

        }

        
     }

     //自动断网检测
     autoCheckConnectState()
     {
        this.unschedule(this.callbackCheckConnectState);
        this.schedule(this.callbackCheckConnectState,1,cc.macro.REPEAT_FOREVER,1);
     }
     //断网检测回调
     callbackCheckConnectState()
     {
        if(!this.bLoginSuccess) //没有登陆不校验
        {
            Debug.Info("没有登陆不校验55555");
            return;
        }
        //Debug.Log("dtLastSuccess:"+this.dtLastSuccess);
        let span = new Date().getTime()-this.dtLastSuccess;
        //Debug.Log("校验结果:"+span);
        if(span>1000*6)
        {
            Debug.Log("网络校验异常，准备重新连接!");
            this.bLoginSuccess = false;
            UIManager.getInstance().showPanel("panelLoading",ShowPanelMode.Top);

            //超时，直接重连
            this.loginGame(this.strLastUserName,this.strLastPass,"重连");
        }
        
     }

    
    //登陆游戏
    async loginGame(strUserName:string,strPass:string,other:string)
    {
        this.strLastUserName = strUserName;
        this.strLastPass = strPass;
        if(other !== "重连")
        {
            this._antiTheftLoginStopped = false;
            this._automaticReconnectStoppedByKick = false;
        }
        if(this._antiTheftLoginStopped || this._automaticReconnectStoppedByKick)
            return;
        let attempt = ++this._loginAttempt;
        UIManager.getInstance().showPanel("panelLoading",ShowPanelMode.Top);
        let loginData = await DeviceIdentityManager.getInstance().createLoginData(other === "重连" ? "reconnect" : "login");
        if(attempt !== this._loginAttempt || this._antiTheftLoginStopped || this._automaticReconnectStoppedByKick)
            return;
        KBEngine.Event.fire("login", strUserName, strPass, loginData);
    }

    public consumeForcedLogoutMessage():string
    {
        let message = this._pendingForcedLogoutMessage;
        this._pendingForcedLogoutMessage = "";
        return message;
    }

    /**
     * 踢线原因是否还在判定。登录页必须先问这个再决定：
     * 判定中说明文案稍后由 AddForcedLogoutListener 推送，不能当成“没有提示”。
     */
    public IsForcedLogoutReasonPending():boolean
    {
        return this._forcedLogoutReasonPending;
    }

    public AddForcedLogoutListener(listener:(message:string)=>void)
    {
        if(listener == null)
            return;
        this._forcedLogoutListeners.push(listener);
    }

    public RemoveForcedLogoutListener(listener:(message:string)=>void)
    {
        let index = this._forcedLogoutListeners.indexOf(listener);
        if(index >= 0)
            this._forcedLogoutListeners.splice(index,1);
    }

    /**
     * 退出登录 / 切换账号的统一入口。
     * 本地只清空密码（pass），账号（unionid）等其它信息全部保留，
     * 登录页仍会回填上次的账号，玩家只需重新输入密码。
     * 设置页的“切换账号”和登录状态异常弹窗的“切换账号”必须都走这里，
     * 否则两条入口的行为会分叉。
     */
    public logoutToLogin()
    {
        // 先按当前账号清房间邀请等会话数据：这一步要用 unionid 解析账号，
        // 必须排在清密码之前，这样保留账号后也能命中同一份本地记录。
        RoomInviteManager.getInstance().clearCurrentAccountSession();
        // 仅清空密码字段；unionid 等账号信息保留。
        cc.sys.localStorage.setItem("pass","");
        this.strLastPass = "";
        this.bLoginSuccess = false;
        // cc.game.restart() 只重跑场景、不重置模块，KBEngine.app 是模块级单例，
        // 旧实例不清掉会在新场景 initKBE() 时命中
        // “Assertion of KBEngine.app not is null”，并且旧实例的 update 定时器和
        // login/logout 事件处理器会留到新场景，导致登录包和心跳被发两遍。
        // KBEngine.destroy() 会清定时器、卸事件、关掉旧 socket 后置空，是干净拆卸，
        // 不会像 app.logout() 那样在消息表已清理时抛异常。
        try
        {
            if(typeof KBEngine.destroy === "function")
                KBEngine.destroy();
        }
        catch(error)
        {
            Debug.Error("切换账号时注销 KBEngine 失败:" + error);
        }
        cc.game.restart();
    }

    private hasServerErrorDefinition(failedcode:number):boolean
    {
        return KBEngine.app != null &&
            KBEngine.app.serverErrs != null &&
            KBEngine.app.serverErrs[failedcode] != null;
    }

    private isAntiTheftLoginError(failedcode:number):boolean
    {
        let code = "";
        let description = "";
        try { code = (KBEngine.app.serverErr(failedcode) || "").toString(); } catch(error) {}
        try { description = (KBEngine.app.serverErrDes(failedcode) || "").toString(); } catch(error) {}
        let text = (code + " " + description).toUpperCase();
        return text.indexOf("ANTI_THEFT_DEVICE_REQUIRED") >= 0 ||
            text.indexOf("ANTI_THEFT_DEVICE_INVALID") >= 0 ||
            text.indexOf("ANTI_THEFT_DEVICE_MISMATCH") >= 0 ||
            text.indexOf("ANTI_THEFT_VERIFY_UNAVAILABLE") >= 0 ||
            text.indexOf("当前设备不是绑定设备") >= 0 ||
            text.indexOf("防盗号校验暂不可用") >= 0;
    }

    private antiTheftLoginMessage(failedcode:number):string
    {
        let code = "";
        let description = "";
        try { code = (KBEngine.app.serverErr(failedcode) || "").toString().toUpperCase(); } catch(error) {}
        try { description = (KBEngine.app.serverErrDes(failedcode) || "").toString(); } catch(error) {}
        if(code.indexOf("ANTI_THEFT_DEVICE_REQUIRED") >= 0)
            return "防盗号已开启，请升级或重新打开最新版客户端";
        if(code.indexOf("ANTI_THEFT_DEVICE_INVALID") >= 0)
            return "当前设备信息获取失败，请重启游戏后再试";
        if(code.indexOf("ANTI_THEFT_DEVICE_MISMATCH") >= 0 || description.indexOf("当前设备不是绑定设备") >= 0)
            return "当前设备不是绑定设备，请在原设备关闭防盗号或联系客服解绑";
        if(code.indexOf("ANTI_THEFT_VERIFY_UNAVAILABLE") >= 0 || description.indexOf("防盗号校验暂不可用") >= 0)
            return "防盗号校验暂不可用，请稍后再试或联系客服";
        return description == "" ? "防盗号校验失败，请联系客服" : description;
    }

    //回到大厅
    onGoToMain()
    {
        WebSceneLoader.loadScene("login");
    }
    onEnterRoom(nCode:number,nRoomID:number)
    {
        // 进房成功回包是房间上下文的最早权威节点。先交给常驻排队管理器
        // 保存，避免结算或旧退出逻辑提前清空Account.roomID后丢失原房间号。
        if(nCode == 0x200)
            QueueMatchManager.getInstance().rememberEnteredRoom(nRoomID);
        if(QueueMatchManager.getInstance().isHandlingRoomNavigation())
            return;
        if(nCode != 0x200 && cc.director.getScene().name != "login")
        {
            this.onGoToMain();
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
    private _callAUtoSendNotify = null;
    public StartAutoSendNotify(strMsg:string,nDelay:number)
    {
        if(this._callAUtoSendNotify != null)
            this.unschedule(this._callAUtoSendNotify);
        this._callAUtoSendNotify = this.callAutoSendNotify.bind(this,strMsg);
        this.schedule(this._callAUtoSendNotify,nDelay,cc.macro.REPEAT_FOREVER,0.1);
    }
    public callAutoSendNotify(strMsg:string)
    {
        GameDataManager.getAccount().reqHallCommand(strMsg, "P@通知_所有玩家_信息");
    }
    public StopAutoSendNotify()
    {
        if(this._callAUtoSendNotify != null)
            this.unschedule(this._callAUtoSendNotify);
    }

    public SystemInfo(strMsg:string)
    {
        if(RoomInviteManager.isRoomInviteSystemMessage(strMsg))
            return;
        let data = JSON.parse(strMsg);
        if (data == null)
        {
            return;
        }
        let strContent:string = data["system_content"]
        let arrayAll = strContent.split(',');

        UIManager.getInstance().showPanel("panelCloudNotify",ShowPanelMode.Top,arrayAll[4]);        
        
    }

}
