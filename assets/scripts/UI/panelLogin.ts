import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import { ShowPanelMode, CardInfo, WEB_IP, SERVER_IP, SERVER_IP_TEST, WEB_RESET_PASS } from "../common/GameDef";
import GameDataManager from "../GameDataManager";
import MobileManager from "../mobile/MobileManager";
import Debug from "../common/Debug";
import Tool from "../common/Tool";
import ConfigManager from "../logic/ConfigManager";

var KBEngine = require("kbengine");

const {ccclass, property} = cc._decorator;

@ccclass
export default class panelLogin extends UIPanelViewBase {


    private _loginUserName:string = "";
    private _loginPass:string = "";
    private strLastMMSMask:string = "";
    onLoad(){
        super.onLoad();

        
        if(cc.sys.os === cc.sys.OS_IOS || cc.sys.os === cc.sys.OS_ANDROID)
        {
            this._loginUserName = Tool.GetConfigString("unionid","");
            Debug.Log("本地缓存账号111122111:"+this._loginUserName);
        }
        else
        {
            //PC版随机一个账号
            // this._loginUserName = new Date().getTime().toString();
            // cc.sys.localStorage.setItem("unionid",this._loginUserName);

            //PC版读取本地配置账号
            //this._loginUserName = "testabc";
        }
        this.node.getChildByName("ver").getComponent(cc.Label).string = GameDataManager.getInstance().strLocalVertion;


        KBEngine.Event.register("onLoginSuccessfully", this, "onLoginSuccessfully");   


        let test = new CardInfo(1,2,1,2,1,2);
        Debug.Log(test.nCheck.toString());

        MobileManager.getInstance();



        //初始化账号密码
        this._loginPass = Tool.GetConfigString("pass","");
        this.node.getChildByName("手机号").getComponent(cc.EditBox).string = this._loginUserName;
        this.node.getChildByName("密码").getComponent(cc.EditBox).string = this._loginPass;


        //Debug.Error("https://mcybde.com/chat/text/chat_04RAVp.html?extradata="+Tool.encrypt("{\"vipid\":\"999999\",\"name\":\"黄澄澄\"}"))

        
    }



    //登陆成功！
    onLoginSuccessfully()
    {
        UIManager.getInstance().showPanel("panelMain",ShowPanelMode.CloseOther,"登陆");
    }
    

    onButtonClick(button:cc.Button)
    {
        if(button.node.name === "登陆")
        {
            if(cc.sys.os == cc.sys.OS_IOS || cc.sys.os == cc.sys.OS_ANDROID)
            {
                //检测本地是否存在账号记录                
                if(this._loginUserName === null)
                {
                    MobileManager.getInstance().wxLogin();
                }
                else //直接登陆
                {
                    Debug.Log("发现缓存账号："+this._loginUserName);
                    this.onLoginSystem();
                }
                
            }
            else//其他平台直接账号登陆
            {
                console.log("非移动平台，直接登陆！");
                Debug.Log("当前模式:"+ Tool.GetConfigString("登陆模式","外网"));
                this.onLoginSystem();
            }

        }
        else if(button.node.name === "内网" && cc.sys.isBrowser)
        {
            Debug.Log("进入内网");
            cc.sys.localStorage.setItem("登陆模式","内网");
            GameDataManager.getInstance().initKBE();
            cc.game.restart();
        }
        else if(button.node.name === "外网" && cc.sys.isBrowser)
        {
            Debug.Log("进入外网");
            cc.sys.localStorage.setItem("登陆模式","外网");
            GameDataManager.getInstance().initKBE();
            cc.game.restart();
        }
        else if(button.node.name === "关闭上层")
        {
            button.node.parent.active = false;
        }
        else if(button.node.name === "关闭上上层")
        {
            button.node.parent.parent.active = false;
        }
        else if(button.node.name === "忘记密码")
        {
            //this.node.getChildByName("修改密码").active = true;
            cc.sys.openURL(ConfigManager.getInstance().resetPwdUrl);
        }
        else if(button.node.name === "获取验证码")
        {
            // let strPhone =Tool.GetChild(this.node,"修改密码/列表/账号/手机号").getComponent(cc.EditBox).string;
            // if(strPhone.length != 11)
            // {
            //     UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入正确的手机号!");
            //     return;
            // }
            // this.strLastMMSMask = Tool.SendMMS(strPhone);
            // Tool.GetChild(this.node,"修改密码/列表/验证码/time").active = true;
            // Tool.GetChild(this.node,"修改密码/列表/验证码/获取验证码").active = false;
            // let nCount = 20;
            // this.schedule(()=>{
            //     Tool.GetChild(this.node,"修改密码/列表/验证码/time").getComponent(cc.Label).string = (nCount--).toString();
            //     if(nCount==0)
            //     {
            //         Tool.GetChild(this.node,"修改密码/列表/验证码/time").active = false;
            //         Tool.GetChild(this.node,"修改密码/列表/验证码/获取验证码").active = true; 
            //     }
            // },1,nCount,0.1);
        }
        else if(button.node.name === "清除用户" || button.node.name === "清除密码")
        {
            button.node.parent.getComponent(cc.EditBox).string = ""
        }
    }
    //登陆游戏
    onLoginSystem()
    {
        let strID = this.node.getChildByName("手机号").getComponent(cc.EditBox).string;
        let strPass = this.node.getChildByName("密码").getComponent(cc.EditBox).string;

        if(strID.length<1)
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入正确的账号");
            return;
        }
        if(strPass == "")
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入密码");
            return;
        }

        cc.sys.localStorage.setItem("unionid",strID);
        cc.sys.localStorage.setItem("pass",strPass);

        GameDataManager.getInstance().loginGame(strID,strPass,"登陆")
    }
    OnEndTest()
    {
        console.log("进入end");
    }
}
