import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import ConfigManager from "../logic/ConfigManager";
import { ClosePanelMode } from "../common/GameDef";

const {ccclass, property} = cc._decorator;

@ccclass
export default class panelKefu extends UIPanelViewBase {

    // private strKF:string = "http://203.107.63.249:88/chatlink.html?agentid=bdbd429542191477212d36bcee06778d&metadata={info}";//"https://chat.meiqia.cn/widget/standalone.html?eid=ec514deaf8b068d645b96b74fd7c992e&metadata={info}";
    // private strVIP:string = "http://203.107.63.249:88/vip/chatlink.html?agentid=bb4bde36abd481153a5334b0fb220b78&metadata={info}";//"https://chat.meiqia.cn/widget/standalone.html?eid=f54a10e193bf3842ecaf589d80a90fc8&metadata={info}";
    // private strVIP2:string = "http://203.107.63.249:88/vip2/chatlink.html?&agentid=dc99d1d7371ab13a7284bf3051864e54&metadata={info}";//"https://chat.meiqia.cn/widget/standalone.html?eid=f54a10e193bf3842ecaf589d80a90fc8&metadata={info}";
    
    private strKF:string =  ""//"https://4mff4v.com:443/chat/text/chat_0t1Bp9.html?extradata={info}"//"https://mcybde.com/chat/text/chat_04RAVp.html?extradata={info}"
    private strVIP:string = "http://154.37.155.17/chattool/player?d={info}";
    private strVIP2:string = "http://154.37.155.17/chattool/player?d={info}";
    

    private loading:cc.ProgressBar = null;

    

    private web:cc.WebView = null;
    onLoad () {
        super.onLoad();
    }
    

    start () {
        //http://mcybde.com:443/chat/text/chat_04RAVp.html?&agentid=2c90ffef80b2348101816bff8fed0963&metadata={info}
        //ConfigManager.getInstance().SetOneHashKey("客服2","https://mcybde.com:443/chat/text/chat_04RAVp.html?skill=2c90ffef80b2348101816bc7a34a01d9&agent=2c90ffef80b2348101816bff8fed0963&l=zh&extradata={info}")
        if(this.strUserData == "")
        {
            this.strUserData = "客服";
        }

        //Tool.GetChild(this.node,"title/label").getComponent(cc.Label).string = this.strUserData;
        this.web = this.node.getChildByName("web").getComponent(cc.WebView);

        let strUrl = "";
        let passkey = ""
        let channel = "general"
        if(this.strUserData == "客服")
        {
            strUrl = ConfigManager.getInstance().kefuUrl//this.strKF;
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
        let strEx = Tool.encrypt(JSON.stringify(playerInfo),passkey);
        if(strUrl.indexOf("{info}") >= 0)
        {
            strUrl = strUrl.replace(RegExp("{info}",'g'),encodeURIComponent(strEx));
        }
        else
        {
            strUrl += (strUrl.indexOf("?") >= 0 ? "&" : "?") + "d=" + encodeURIComponent(strEx);
        }
        

        if(cc.sys.os === cc.sys.OS_IOS)
        {
            strUrl+="&device=ios";
        }

        cc.sys.openURL(strUrl)
        UIManager.getInstance().closePanelByName(this.node.name,ClosePanelMode.Normal)
        return

        this.web.url = strUrl;

        //显示进度
        this.loading = Tool.GetChild(this.node,"进度/img").getComponent(cc.ProgressBar);
        this.loading.progress = 0;
        this.schedule(this.UpdateProgress,0.01,1000,0.1);

        if(cc.sys.os != cc.sys.OS_IOS)
        {
            Tool.GetChild(this.node,"title/弹出").active = false;
            this.web.node.on("loaded",()=>{
                this.loading.progress = 1;
                this.unschedule(this.UpdateProgress);
            },this);
        }
        else
        {
            Tool.GetChild(this.node,"title/弹出").active = false;
            this.scheduleOnce(()=>{
                this.loading.progress = 1;
                this.unschedule(this.UpdateProgress);
            },6);
        }



    }
    public UpdateProgress()
    {
        this.loading.progress = this.loading.progress+0.001;
    }

    // update (dt) {}

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
            cc.sys.openURL(this.web.url);
        }
    }
}
