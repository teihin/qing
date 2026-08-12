import UIPanelViewBase from "../common/UIPanelViewBase";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import UIManager from "../common/UIManager";
import { ShowPanelMode } from "../common/GameDef";
import ImageManager from "../logic/ImageManager";
import ConfigManager from "../logic/ConfigManager";
import Debug from "../common/Debug";

var KBEngine = require("kbengine");

const {ccclass, property} = cc._decorator;

@ccclass
export default class panelGivePad extends UIPanelViewBase {

    private strID:string = "";
    private strNum:string = "";
    private strYLinfo:string = "";//预留信息

    onLoad () {
        super.onLoad();

        KBEngine.Event.register("UserName", this, "UserName");
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
        KBEngine.Event.register("onAccountCommand", this, "onAccountCommand");
        KBEngine.Event.register("UserHashInfo",this, "OnUserHashInfo");

       // ConfigManager.getInstance().GetOneHashKey("预留信息_"+GameDataManager.getAccount().guuid,"预留信息");

    }

    start () {
        let arrayTemp = this.strUserData.split(",");
        this.strID = arrayTemp[0];
        this.strNum = arrayTemp[1];

        if(this.strNum == "")
        {
            Tool.GetChild(this.node,"bk/输入金额").active = true;
            Tool.GetChild(this.node,"bk/金额").active = false;
        }
        else
        {
            Tool.GetChild(this.node,"bk/输入金额").active = false;
            Tool.GetChild(this.node,"bk/金额").active = true;
        }

        Tool.GetChild(this.node,"bk/id").getComponent(cc.Label).string = this.strID;
        Tool.GetChild(this.node,"bk/金额").getComponent(cc.Label).string = this.strNum;

        this.GetUserInfo();
    }

    // update (dt) {}

    public onButtonClick(button:cc.Button)
    {
        if(button.node.name === "关闭")
        {
            UIManager.getInstance().closePanelByName(this.node.name);
        }
        else if(button.node.name === "确定赠送")
        {
            let strNum = "";
            if(Tool.GetChild(this.node,"bk/输入金额").active)
               strNum = Tool.GetChild(this.node,"bk/输入金额").getComponent(cc.EditBox).string;
            else
                strNum = this.strNum;
            if(strNum == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入金额!");
                return;
            }
            if(!/^0*[1-9][0-9]*$/.test(strNum))
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"赠送金额只能输入大于0的整数！");
                return;
            }

            let strPass = Tool.GetChild(this.node,"bk/密码").getComponent(cc.EditBox).string;
            if(strPass == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入密码!");
                return;
            }

            // let yl = Tool.GetChild(this.node,"bk/预留信息").getComponent(cc.EditBox).string;
            // if(yl == "")
            // {
            //     UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入预留信息!");
            //     return;
            // }

            // if(yl != this.strYLinfo)
            // {
            //     UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"预留信息校验错误，操作失败!");
            //     return;
            // }

            let strParam = "{\"header\":\"调用_方法_Exchange2\",\"target_guuid\":\"" + this.strID + "\",\"money_value\":\"" + strNum + "\",\"money_type\":\"gold\",\"user_pwd\":\"" + strPass + "\",\"client_version\":\"2022032201\"}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "P@调用_方法_Exchange2");
            UIManager.getInstance().closePanelByName(this.node.name);
        }
    }

    public GetUserInfo()
    {
        let strParam = "{\"header\":\"查询_用户_名字\",\"user_id\":\"" + this.strID + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_用户_名字");
    }

    public onHallCommand(nCode:number, param:string)
    {
        if(param.indexOf("查询_用户_名字")>=0)
        {
            if (nCode == 0x200)
            {
                
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);

                UIManager.getInstance().closePanelByName(this.node.name);
            }
        }
    }
    public onAccountCommand(nCode:number,param:string)
    {
     
    }


    public UserName(strMsg:string)
    {        
        let data = JSON.parse(strMsg);
        
        if(data == null)
            return;

        let strID:string = data["id"].toString();        
        let strName:string = data["name"];
        let avatarIndex:string = data.hasOwnProperty("photo") ? data["photo"].toString() : "";

        Tool.GetChild(this.node,"bk/name").getComponent(cc.Label).string  = strName;
        let img = Tool.GetChild(this.node,"bk/头像/mask/img").getComponent(cc.Sprite);
        if (!ImageManager.getInstance().GetImageByName(strID, avatarIndex, img))
        {
            ImageManager.getInstance().AddWaitFreshImage2Catch(strID, img);
        }
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

        if(context == "预留信息")
        {
            this.strYLinfo = Tool.Base64Decode(strContent);
            Debug.Log("收到预留:"+this.strYLinfo);
        }
    }
}
