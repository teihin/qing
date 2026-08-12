import { SERVER_IP, SERVER_PORT, IS_USE_WSS, LOGIN_BY_IP, SERVER_URL, ClosePanelMode, ShowPanelMode, WEB_IP, SERVER_IP_TEST, BASE_SERVER_IP } from "./common/GameDef";
import Debug from "./common/Debug";
import UIManager from "./common/UIManager";
import DrhNameManager from "./logic/DrhNameManager";
import MobileManager from "./mobile/MobileManager";
import Tool from "./common/Tool";
import DeviceIdentityManager from "./logic/DeviceIdentityManager";
import QueueMatchManager from "./logic/QueueMatchManager";

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
        return KBEngine.app.player();
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
        // 提前准备设备标识，减少用户点击登录后的等待时间。
        DeviceIdentityManager.getInstance().prepare();
        QueueMatchManager.getInstance();

        
        
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
    
        args.ip = GameDataManager.GetSerVerIP();
        args.port = SERVER_PORT;
        args.isWss = IS_USE_WSS;              //是否用wss协议， true:wss  false:ws
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
        // 多设备互踢时若旧客户端继续自动重连，会造成两个客户端循环互踢；
        // 服务器重启也可能发出同类事件，因此界面只显示中性的失效提示。
        this._automaticReconnectStoppedByKick = true;
        this._pendingForcedLogoutMessage = "当前登录连接已失效，请重新登录";
        this._loginAttempt++;
        this.bLoginSuccess = false;
        this.unschedule(this.callbackSendHeart);
        this.unschedule(this.callbackCheckConnectState);
        UIManager.getInstance().closePanelByName("panelLoading",ClosePanelMode.Top);
        cc.director.loadScene("login");
     }

     onLoginSuccessfully(){
        KBEngine.INFO_MSG("登陆服务器成功！");
        
        //登陆成功，启动心跳校验
        this.dtLastSuccess = new Date().getTime();
        this.bLoginSuccess = true;
        this._antiTheftLoginStopped = false;
        this._automaticReconnectStoppedByKick = false;
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
        cc.director.loadScene("login");
    }
    onEnterRoom(nCode:number,nRoomID:number)
    {
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
