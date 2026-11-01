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
    /** 成员设置入口传入时使用俱乐部积分；旧入口为空，继续走大厅通用金币转账。 */
    private clubId:string = "";
    private clubGiftPending:boolean = false;
    private strYLinfo:string = "";//预留信息

    private ClearGiftInputs():void
    {
        const password = Tool.GetChild(this.node,"bk/密码");
        const amount = Tool.GetChild(this.node,"bk/输入金额");
        if(password && password.getComponent(cc.EditBox))
            password.getComponent(cc.EditBox).string = "";
        if(amount && amount.getComponent(cc.EditBox))
            amount.getComponent(cc.EditBox).string = "";
    }

    onLoad () {
        super.onLoad();

        KBEngine.Event.register("UserName", this, "UserName");
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
        KBEngine.Event.register("onAccountCommand", this, "onAccountCommand");
        KBEngine.Event.register("UserHashInfo",this, "OnUserHashInfo");

       // ConfigManager.getInstance().GetOneHashKey("预留信息_"+GameDataManager.getAccount().guuid,"预留信息");

    }

    start () {
        this.clubGiftPending = false;
        this.ClearGiftInputs();
        let clubData:any = null;
        try { clubData = JSON.parse(this.strUserData); } catch(error) { clubData = null; }
        if(clubData && typeof clubData === "object" && clubData.userId != null)
        {
            this.strID = String(clubData.userId);
            this.clubId = clubData.clubId == null ? "" : String(clubData.clubId);
            this.strNum = clubData.amount == null ? "" : String(clubData.amount);
        }
        else
        {
            let arrayTemp = this.strUserData.split(",");
            this.strID = arrayTemp[0];
            this.strNum = arrayTemp[1];
            this.clubId = "";
        }

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
            this.clubGiftPending = false;
            this.ClearGiftInputs();
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

            if(this.clubId !== "")
            {
                const strPass = Tool.GetChild(this.node,"bk/密码").getComponent(cc.EditBox).string;
                if(strPass == "")
                {
                    UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入密码!");
                    return;
                }
                if(this.clubGiftPending)
                    return;
                this.clubGiftPending = true;
                const context = "club:gold:give-member:" + this.clubId + ":" + this.strID;
                const strParam = JSON.stringify({
                    header:"添加_俱乐部_成员_积分",club_id:this.clubId,user_id:this.strID,
                    user_add_gold:Number(strNum),user_pwd:strPass,context
                });
                GameDataManager.getAccount().reqHallCommand(strParam,"P@添加_俱乐部_成员_积分_" + context);
                return;
            }

            let strPass = Tool.GetChild(this.node,"bk/密码").getComponent(cc.EditBox).string;
            if(strPass == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入密码!");
                return;
            }

            // 旧的「玩家资料 → 赠送」入口仍使用大厅通用金币转账。
            let strParam = "{\"header\":\"调用_方法_Exchange2\",\"target_guuid\":\"" + this.strID + "\",\"money_value\":\"" + strNum + "\",\"money_type\":\"gold\",\"user_pwd\":\"" + strPass + "\",\"client_version\":\"2022032201\"}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "P@调用_方法_Exchange2");
            this.ClearGiftInputs();
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
        if(this.clubId !== "" && this.clubGiftPending && param && param.indexOf("添加_俱乐部_成员_积分") >= 0)
        {
            this.clubGiftPending = false;
            if(nCode === 0x200 || nCode === 0x500)
            {
                KBEngine.Event.fire("ClubGoldGiftChanged", this.clubId);
                this.ClearGiftInputs();
                UIManager.getInstance().closePanelByName(this.node.name);
            }
            else
            {
                let error = "俱乐部金币赠送失败，请稍后重试！";
                try
                {
                    const msg:any = JSON.parse(param);
                    const result:any = msg && msg.result;
                    if(result && result.error) error = String(result.error);
                    else if(msg && msg.error) error = String(msg.error);
                }
                catch(error) {}
                if(error.indexOf("请先设置交易密码") >= 0)
                {
                    UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,error,
                        [(confirmed:boolean)=>{
                            if(!confirmed)
                                return;
                            this.ClearGiftInputs();
                            UIManager.getInstance().closePanelByName(this.node.name);
                            KBEngine.Event.fire("OpenInitTransactionPassword");
                        }]);
                }
                else
                    UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,error);
            }
            return;
        }
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
        let data:any = null;
        try
        {
            data = JSON.parse(strMsg);
        }
        catch (error)
        {
            return;
        }

        if(data == null || data["id"] == null)
            return;

        let strID:string = data["id"].toString();
        if(strID != this.strID)
            return;

        let strName:string = data["name"] == null ? "" : data["name"].toString();
        let avatarIndex:string = data["photo"] == null ? "" : data["photo"].toString();

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
