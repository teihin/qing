import GameDataManager from "../GameDataManager";
import Debug from "../common/Debug";
var KBEngine = require("kbengine");
//配置管理

const {ccclass, property} = cc._decorator;

@ccclass
export default class ConfigManager extends cc.Component {

    public android_down_url:string = "";
    public ios_down_url:string = "";
    public enalbe_gps:string = "True"; 
    public user_promission:string = "";
    public downloadurl:string = "http://www.baidu.com";
    public resetPwdUrl:string = "http://www.163.com";
    public kefuUrl:string = "http://www.163.com"

    static instance: ConfigManager
    static getInstance() {
        if (!ConfigManager.instance) {            
            let node = new cc.Node("ConfigManager");
            cc.game.addPersistRootNode(node);
            this.instance = node.addComponent(ConfigManager);   
            
            KBEngine.Event.register("UserHashInfo", this.instance, "OnUserHashInfo"); 
        }

        return ConfigManager.instance;
    }
    public onDestroy()
    {
        KBEngine.Event.deregisterAll(this);
        ConfigManager.instance = null;
    }
 
    public GetDownLoadUrl()
    {
        if(cc.sys.os === cc.sys.OS_ANDROID)
        {
            return this.android_down_url;
        }
        else if(cc.sys.os === cc.sys.OS_IOS)
        {
            return this.ios_down_url;
        }
    }

    //更新默认配置
    public UpdateDefConfig()
    {
       this.GetOneHashKey("强制GPS");
       this.GetOneHashKey("下载url");
       // this.GetOneHashKey("用户权限");
       this.GetOneHashKey("客服2","客服地址");
    }
    public GetOneHashKey(strKey:string,strEx:string = "")
    {
        let strTemp = strEx==""?"查询哈希_"+strKey:strEx;
        let strParam = "{\"header\":\"查询_哈希_信息\",\"key\":\""+strKey+"\",\"context\":\""+strTemp+"\"}";
        GameDataManager.getAccount().reqAccountCommand(strParam, "P@"+strEx);
    }
    public SetOneHashKey(strkey:string,strValue:string)
    {
        let strParam = "{\"header\":\"设置_哈希_信息\",\"key\":\""+strkey+"\",\"content\":\"" + strValue + "\",\"context\":\"设置哈希_"+strkey+"\"}";
        GameDataManager.getAccount().reqAccountCommand(strParam, "");
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

        if(context == "查询哈希_强制GPS")
        {
            this.enalbe_gps = strContent;
        }
        else if(context == "查询哈希_用户权限")
        {
            this.user_promission = strContent;
        }
        else if(context == "查询哈希_下载url")
        {
            this.downloadurl = strContent;
        }
        else if(context === "客服地址")
        {
            this.kefuUrl = strContent
        }
    }
}
