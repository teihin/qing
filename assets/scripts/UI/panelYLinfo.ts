import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import { ClosePanelMode, ShowPanelMode } from "../common/GameDef";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import Debug from "../common/Debug";
import ConfigManager from "../logic/ConfigManager";

var KBEngine = require("kbengine");
const {ccclass, property} = cc._decorator;

@ccclass
export default class panelUserInfo extends UIPanelViewBase {

    private strLastMMSMask:string = "";//验证码
    private bFirstYL = false; //初次设置预留信息
    onLoad () {
        super.onLoad();

        let strAccount = Tool.GetConfigString("unionid","--");
        Tool.GetChild(this.node,"列表/账号/账号").getComponent(cc.Label).string = strAccount;

        
        KBEngine.Event.register("UserHashError",this, "OnUserHashError");
        ConfigManager.getInstance().GetOneHashKey("预留信息_"+GameDataManager.getAccount().guuid,"预留信息");

    }

    start () {
        
    }

    // update (dt) {}
    public onButtonClick(button:cc.Button)
    {
        if(button.node.name === "获取验证码")
        {
            this.strLastMMSMask = Tool.SendMMS(Tool.GetConfigString("unionid","")); 

            Tool.GetChild(this.node,"列表/验证码/time").active = true;
            Tool.GetChild(this.node,"列表/验证码/获取验证码").active = false;
            let nCount = 60;
            this.schedule(()=>{
                Tool.GetChild(this.node,"列表/验证码/time").getComponent(cc.Label).string = (nCount--).toString();
                if(nCount==0)
                {
                    Tool.GetChild(this.node,"列表/验证码/time").active = false;
                    Tool.GetChild(this.node,"列表/验证码/获取验证码").active = true; 
                }
            },1,nCount,0.1);
        }
        else if(button.node.name === "确定修改预留信息")
        {
            //名字只能是中文数字英文
            let strMSG1 =  Tool.GetChild(this.node,"列表/新密码1/新密码1").getComponent(cc.EditBox).string;
            let strMSG2 =  Tool.GetChild(this.node,"列表/新密码2/新密码2").getComponent(cc.EditBox).string;
            let strMask = Tool.GetChild(this.node,"列表/验证码/验证码").getComponent(cc.EditBox).string;

            if(strMask.length != 4 && !this.bFirstYL)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入验证码");
                return;
            }
            if(strMask != this.strLastMMSMask && !this.bFirstYL)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"验证码输入不正确！");
                return; 
            }

            if(!strMSG1.match(new RegExp('^[\u4E00-\u9FA5]+$')))
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"预留信息只能是中文!");
                return; 
            }
            if(strMSG1.length<3)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请至少输入3个中文汉字!");
                return; 
            }
            if(strMSG1 != strMSG2)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"2次输入的预留信息不一致!");
                return;  
            }

            //修改
            let strDex = Tool.Base64Encode(strMSG1);
            ConfigManager.getInstance().SetOneHashKey("预留信息_"+GameDataManager.getAccount().guuid,strDex);
            
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"修改预留信息成功!");
            //复位初次
            this.bFirstYL = false;
            Tool.GetChild(this.node,"列表/验证码").active = true;
            return; 
        }
        else if(button.node.name == "关闭")
        {
            UIManager.getInstance().closePanelByName(this.node.name);
        }
    }
    public onToggleClick(toggle:cc.Toggle)
    {

    }
    public OnUserHashError(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        if(data == null)
            return;
        let info = data["UserHashInfo"];
        let strKey:string = info["key"];
        let strContent:string = info["content"];
        let context:string = info["context"];

        if(context == "预留信息")
        {
            Debug.Log("没有找到预留信息！")
            this.bFirstYL = true;
            Tool.GetChild(this.node,"列表/验证码").active = false;
        }
    }
}   
