import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import ConfigManager from "../logic/ConfigManager";
import { ClosePanelMode, ShowPanelMode } from "../common/GameDef";

const {ccclass} = cc._decorator;

@ccclass
export default class panelKefu extends UIPanelViewBase {

    private strVIP:string = "http://154.37.155.17/chattool/player?d={info}";
    private strVIP2:string = "http://154.37.155.17/chattool/player?d={info}";

    private loading:cc.ProgressBar = null;
    private web:cc.WebView = null;
    private externalUrl:string = "";
    private embeddedUrl:string = "";
    private expectedWebOrigin:string = "";
    private webReady:boolean = false;
    private webLoadAttempt:number = 0;
    private webMessageHandler:(event:MessageEvent) => void = null;

    onLoad () {
        super.onLoad();
    }

    start () {
        if(this.strUserData == "")
        {
            this.strUserData = "客服";
        }

        this.web = this.node.getChildByName("web").getComponent(cc.WebView);

        let strUrl = "";
        let passkey = "";
        let channel = "general";
        if(this.strUserData == "客服")
        {
            strUrl = ConfigManager.getInstance().kefuUrl;
        }
        else if(this.strUserData == "VIP充值")
        {
            strUrl = this.strVIP;
            channel = "vip_recharge";
        }
        else if(this.strUserData == "VIP充值2")
        {
            strUrl = this.strVIP2;
            channel = "vip_recharge";
        }

        let account = GameDataManager.getAccount();
        let playerInfo:any = {
            playerId: account.guuid,
            nickname: account.name,
            level: account.level,
            platform: cc.sys.os === cc.sys.OS_IOS ? "ios" : (cc.sys.os === cc.sys.OS_ANDROID ? "android" : "web"),
            channel: channel,
            metadata: {
                "角色": account.role || "",
                "当前房间": account.roomID || "",
                "客服入口": this.strUserData
            },
            ts: Math.floor(Date.now() / 1000)
        };
        let strEx = Tool.encrypt(JSON.stringify(playerInfo), passkey);
        if(strUrl.indexOf("{info}") >= 0)
        {
            strUrl = strUrl.replace(RegExp("{info}",'g'), encodeURIComponent(strEx));
        }
        else
        {
            strUrl += (strUrl.indexOf("?") >= 0 ? "&" : "?") + "d=" + encodeURIComponent(strEx);
        }

        if(cc.sys.os === cc.sys.OS_IOS)
        {
            strUrl = this.AppendQuery(strUrl, "device", "ios");
        }

        // 默认在游戏内打开；原有外部网页版协议保留，但游戏界面不显示跳出按钮。
        this.externalUrl = strUrl;
        this.embeddedUrl = this.AppendQuery(strUrl, "embed", "game");
        this.expectedWebOrigin = this.GetWebOrigin(this.embeddedUrl);

        this.loading = Tool.GetChild(this.node,"进度/img").getComponent(cc.ProgressBar);
        this.loading.progress = 0;
        this.schedule(this.UpdateProgress, 0.02);

        // 必须先监听再赋URL。浏览器首次创建iframe时，缓存页可能在同一帧完成加载，
        // 原先的“先赋URL、后监听”会漏掉第一次loaded事件，关闭重开后才恢复。
        this.web.node.on("loaded", this.OnWebLoaded, this);
        this.web.node.on("error", this.OnWebError, this);
        if(cc.sys.isBrowser && typeof window !== "undefined")
        {
            this.webMessageHandler = this.OnWebMessage.bind(this);
            window.addEventListener("message", this.webMessageHandler, false);
        }

        this.ConfigureTitle();
        this.ConfigureTransparentWebView();
        // 下一帧再导航，确保WebView对应的DOM/原生控件已经完成首次布局。
        this.scheduleOnce(this.BeginWebLoad, 0);
    }

    onDestroy () {
        this.unschedule(this.UpdateProgress);
        this.unschedule(this.BeginWebLoad);
        this.unschedule(this.CheckWebReady);
        if(this.web != null && cc.isValid(this.web.node))
        {
            this.web.node.off("loaded", this.OnWebLoaded, this);
            this.web.node.off("error", this.OnWebError, this);
        }
        if(cc.sys.isBrowser && typeof window !== "undefined" && this.webMessageHandler != null)
        {
            window.removeEventListener("message", this.webMessageHandler, false);
            this.webMessageHandler = null;
        }
    }

    private ConfigureTitle()
    {
        let popup = Tool.GetChild(this.node, "title/弹出");
        if(popup != null)
        {
            // 外部网页版继续兼容，但游戏内入口不向玩家展示跳出按钮。
            popup.active = false;
        }
    }

    private ConfigureTransparentWebView()
    {
        if(this.web == null)
            return;
        try {
            let impl:any = (this.web as any)._impl;
            if(impl != null && impl._iframe != null)
            {
                if(typeof impl._iframe.setBackgroundTransparent === "function")
                {
                    impl._iframe.setBackgroundTransparent(true);
                }
                if(impl._iframe.style != null)
                {
                    impl._iframe.style.background = "transparent";
                    impl._iframe.setAttribute("allowtransparency", "true");
                }
            }
            if(impl != null && impl._div != null && impl._div.style != null)
            {
                impl._div.style.background = "transparent";
            }
        } catch(error) {
            cc.warn("客服WebView透明背景设置失败", error);
        }

        if(cc.sys.isBrowser)
            return;
        try {
            if(cc.sys.os === cc.sys.OS_ANDROID)
            {
                jsb.reflection.callStaticMethod(
                    "org/cocos2dx/javascript/QingChatWebViewBridge",
                    "Enable",
                    "()V"
                );
            }
            else if(cc.sys.os === cc.sys.OS_IOS)
            {
                (jsb.reflection as any).callStaticMethod("QingChatWebViewBridge", "Enable");
            }
        } catch(error) {
            // 老基础包没有桥接时仍可发送文字；图片、视频选择需更新原生包。
            cc.warn("客服媒体选择桥接暂不可用", error);
        }
    }

    private AppendQuery(url:string, key:string, value:string):string
    {
        return url + (url.indexOf("?") >= 0 ? "&" : "?")
            + encodeURIComponent(key) + "=" + encodeURIComponent(value);
    }

    private GetWebOrigin(url:string):string
    {
        if(!cc.sys.isBrowser || typeof document === "undefined")
            return "";
        try {
            let anchor = document.createElement("a");
            anchor.href = url;
            return anchor.protocol + "//" + anchor.host;
        } catch(error) {
            return "";
        }
    }

    private BeginWebLoad()
    {
        if(this.web == null || this.embeddedUrl == "" || this.webReady)
            return;

        this.webLoadAttempt += 1;
        this.unschedule(this.CheckWebReady);
        let targetUrl = this.embeddedUrl;
        if(this.webLoadAttempt > 1)
        {
            targetUrl = this.AppendQuery(targetUrl, "chat_retry", Date.now().toString());
        }
        this.web.url = targetUrl;
        this.scheduleOnce(this.CheckWebReady, this.webLoadAttempt === 1 ? 8 : 12);
    }

    private CheckWebReady()
    {
        if(this.webReady)
            return;
        if(this.webLoadAttempt < 2)
        {
            this.BeginWebLoad();
            return;
        }
        this.ShowWebLoadError();
    }

    private OnWebMessage(event:MessageEvent)
    {
        if(this.webReady || event == null || event.data == null || event.data.type !== "chattool:player-ready")
            return;
        if(this.expectedWebOrigin != "" && event.origin !== this.expectedWebOrigin)
            return;

        try {
            let impl:any = this.web == null ? null : (this.web as any)._impl;
            if(impl != null && impl._iframe != null && impl._iframe.contentWindow != null
                && event.source !== impl._iframe.contentWindow)
                return;
        } catch(error) {
            return;
        }

        // 页面已经渲染但接口首次初始化失败时，也自动重试一次；第二次则保留网页自己的错误提示。
        if(event.data.ok === false && this.webLoadAttempt < 2)
        {
            this.scheduleOnce(this.BeginWebLoad, 0.3);
            return;
        }
        this.MarkWebReady();
    }

    private MarkWebReady()
    {
        if(this.webReady)
            return;
        this.webReady = true;
        this.unschedule(this.CheckWebReady);
        this.unschedule(this.UpdateProgress);
        this.ConfigureTransparentWebView();
        if(this.loading != null)
            this.loading.progress = 1;
    }

    private OnWebLoaded()
    {
        this.ConfigureTransparentWebView();
        // Native WebView没有window.postMessage握手，仍以loaded作为完成标志。
        if(!cc.sys.isBrowser)
            this.MarkWebReady();
    }

    private OnWebError()
    {
        if(this.webReady)
            return;
        if(this.webLoadAttempt < 2)
        {
            this.scheduleOnce(this.BeginWebLoad, 0.3);
            return;
        }
        this.ShowWebLoadError();
    }

    private ShowWebLoadError()
    {
        this.unschedule(this.CheckWebReady);
        this.unschedule(this.UpdateProgress);
        UIManager.getInstance().showPanel(
            "panelMsgView",
            ShowPanelMode.Cover,
            "游戏内客服加载失败，请检查网络后点击关闭并重新进入。"
        );
    }

    public UpdateProgress()
    {
        if(this.loading != null && this.loading.progress < 0.92)
        {
            this.loading.progress = Math.min(0.92, this.loading.progress + 0.006);
        }
    }

    public onButtonClick(button:cc.Button)
    {
        if(button.node.name === "关闭上层")
        {
            button.node.parent.active = false;
        }
        else if(button.node.name === "关闭上上层")
        {
            button.node.parent.parent.active = false;
        }
        else if(button.node.name === "关闭")
        {
            UIManager.getInstance().closePanelByName(this.node.name);
        }
        else if(button.node.name === "弹出")
        {
            if(this.externalUrl != "")
                cc.sys.openURL(this.externalUrl);
        }
    }
}
