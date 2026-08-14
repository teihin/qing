import UIPanelViewBase from "../common/UIPanelViewBase";
import DrhPlayerLogic from "../logic/DrhPlayerLogic";
import UIManager from "../common/UIManager";
import { ClosePanelMode, ShowPanelMode } from "../common/GameDef";
import Tool from "../common/Tool";
import ImageManager from "../logic/ImageManager";
import GameDataManager from "../GameDataManager";
import Debug from "../common/Debug";
import WebLoadingManager from "../common/WebLoadingManager";
var KBEngine = require("kbengine");
const {ccclass, property} = cc._decorator;

@ccclass
export default class panelUserInfo extends UIPanelViewBase {

    private player:DrhPlayerLogic = null;
    private bIsVip:boolean = false

    onLoad () {
        super.onLoad();

        KBEngine.Event.register("onHallCommand", this, "onHallCommand");

        this.node.getChildByName("msk").on(cc.Node.EventType.TOUCH_START,()=>{
            UIManager.getInstance().closePanelByName(this.node.name,ClosePanelMode.Normal);
        },this);
    }

    start () {
        if(this.arrayEx.length>0)
        {
            this.player = this.arrayEx[0];

            if(this.player.info.strUserID == GameDataManager.getAccount().guuid) //自己显示充值
            {
                Tool.GetChild(this.node,"数据/赠送").active = false;
                Tool.GetChild(this.node,"数据/充值").active = true;
            }
            else
            {
                Tool.GetChild(this.node,"数据/赠送").active = true;
                Tool.GetChild(this.node,"数据/充值").active = false;
            }
        }
        else
        {
            UIManager.getInstance().closePanelByName(this.node.name,ClosePanelMode.Normal);
        }

        Tool.GetChild(this.node,"数据/id").getComponent(cc.Label).string = this.player.info.strUserID;
        Tool.GetChild(this.node,"数据/name").getComponent(cc.Label).string = this.player.info.strUserName;
        let img = Tool.GetChild(this.node,"数据/头像/mask/img").getComponent(cc.Sprite);
        if (!ImageManager.getInstance().GetImageByName(this.player.info.strUserID, this.player.info.strPhoto, img))
        {
            ImageManager.getInstance().AddWaitFreshImage2Catch(this.player.info.strUserID, img);
        }

        Tool.GetChild(this.node,"数据/屏蔽语音").getComponent(cc.Toggle).isChecked = this.player.gameLogic.CheckNoAudio(this.player.info.strUserID)
        this.UpdateInfo();

        this.GetVipInfo()
    }

    // update (dt) {}
    public onButtonClick(button:cc.Button)
    {
        if(button.node.name === "看一下")
        {
            if((GameDataManager.getAccount().gold+GameDataManager.getAccount().gold2/100)<0.2)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"余额不足！");
                return;
            }
            let strParam:string = this.player.info.remark;
            if (strParam == "")
                strParam = "0,0,0,0,0,0,0";
            let arrayParam = strParam.split(',');

            let nWin = Number(arrayParam[0]);
            let nLose = Number(arrayParam[1]);
            let nHe = Number(arrayParam[2]);

            let nTotle = nWin + nLose + nHe;
            let nFanPer = nTotle > 0 ? Number(arrayParam[3]) * 100 / nTotle : 0;
            let nWinPer = nTotle > 0 ? nWin * 100 / nTotle : 0;

            let nFanWin = Number(arrayParam[3])>0?Number(arrayParam[5])*100/Number(arrayParam[3]):0;

            Tool.GetChild(this.node,"数据/统计/总局数").getComponent(cc.Label).string = arrayParam[4];
            Tool.GetChild(this.node,"数据/统计/总手数").getComponent(cc.Label).string = (Number(arrayParam[0])+ Number(arrayParam[1])+ Number(arrayParam[2])).toString();
            Tool.GetChild(this.node,"数据/统计/翻牌率").getComponent(cc.Label).string = nFanPer.toFixed(0).toString()+"%";
            Tool.GetChild(this.node,"数据/统计/翻牌胜率").getComponent(cc.Label).string = nFanWin.toFixed(0).toString()+"%";
            Tool.GetChild(this.node,"数据/统计/获胜手数").getComponent(cc.Label).string = nWin.toString();
            Tool.GetChild(this.node,"数据/统计/总胜率").getComponent(cc.Label).string =  nWinPer.toFixed(0).toString()+"%";

            //扣费
            strParam = "{\"header\":\"玩家_消费_命令\",\"consume_type\":\"看数据\",\"money\":20}";
            GameDataManager.getAccount().reqHallCommand(strParam, "玩家_消费_命令");
        }
        else if(button.node.parent.name === "道具")
        {
            let strGold = GameDataManager.getAccount().gold;
            let strGold2 = GameDataManager.getAccount().gold2;
            if (Number(strGold + "." + strGold2) < 0.1)
            {                
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "余额不足!");
                return;
            }

            let strParam = "{\"header\":\"玩家_消费_命令\",\"consume_type\":\"道具\",\"money\":10}";
            GameDataManager.getAccount().reqGameCommand(strParam, "玩家_消费_命令");
            GameDataManager.getAccount().reqSay("@@道具@@" + button.node.name + "@" + this.player.info.strUserID, GameDataManager.getInstance().nSelfPlayerSit);

            UIManager.getInstance().closePanelByName(this.node.name);
        }
        else if(button.node.name === "赠送")
        {
            UIManager.getInstance().showPanel("panelGivePad",ShowPanelMode.Cover,this.player.info.strUserID+",");
        }
        else if(button.node.name === "语音回放")
        {
            let strMsg = this.player.gameLogic.GetPlayerLastSay(this.player.info.strUserID);
            if(strMsg != "")
            {
                Debug.Log("开始回放"+strMsg);
                //替换座位号
                let json = JSON.parse(strMsg);
                let oldSit = json["number"];
                json["number"] = this.player.info.nSitNum;
                let temp:string = json["word"];
                temp = temp.replace(oldSit+":@@",this.player.info.nSitNum+":@@");
                json["word"] = temp;
                strMsg = JSON.stringify(json);
                Debug.Log("处理后"+strMsg);
                this.player.gameLogic.OnPlayerSay(strMsg);
                UIManager.getInstance().closePanelByName(this.node.name);
            }
            else
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"没有语音!");
            }
        }
        else if(button.node.name == "屏蔽语音")
        {

        }
        else if(button.node.name === "充值")
        {
            WebLoadingManager.loadBlockingRes("Prefabs/钱包","正在加载钱包",(err,obj)=>{
                if(err)
                {
                    cc.error(err.message || err);
                    Debug.Log("错误！！！！！！！！！");
                    return null;
                }
                if(this.node == null)
                    return;
                let node = cc.instantiate(obj);
                node.active = true;
                node.name = "钱包";
                node.parent =this.node.parent;
            });
        }
        else if(button.node.name == "开通VIP")
        {
            UIManager.getInstance().showPanel("panelVipInfo",ShowPanelMode.Cover)
        }
    }
    public onToggleClick(toggle:cc.Toggle)
    {
        if(toggle.node.name === "屏蔽语音" && toggle.isChecked)
        {
            this.player.gameLogic.AddNoAudio(this.player.info.strUserID);
        }
    }
    public UpdateInfo()
    {
        let strParam:string = this.player.info.remark;
        if (strParam == "")
            strParam = "0,0,0,0,0,0,0";
        let arrayParam = strParam.split(',');

        let nWin = Number(arrayParam[0]);
        let nLose = Number(arrayParam[1]);
        let nHe = Number(arrayParam[2]);
        let nRu = Number(arrayParam[6]); //入池次数

        let nTotle = nWin + nLose + nHe;
        let nFanPer = nTotle > 0 ? Number(arrayParam[3]) * 100 / nTotle : 0;
        let nWinPer = nTotle > 0 ? nWin * 100 / nTotle : 0;
        let nLosePer = nTotle > 0 ? nLose * 100 / nTotle : 0;

        let nFanWin = Number(arrayParam[3])>0?Number(arrayParam[5])*100/Number(arrayParam[3]):0;

        let nRuChi = nTotle > 0 ? nRu * 100 / nTotle : 0;   

        // //Tool.GetChild(this.node,"数据/统计/总局数").getComponent(cc.Label).string = arrayParam[4];
        // Tool.GetChild(this.node,"数据/统计/总手数").getComponent(cc.Label).string = (Number(arrayParam[0])+ Number(arrayParam[1])+ Number(arrayParam[2])).toString();
        // Tool.GetChild(this.node,"数据/统计/总胜率").getComponent(cc.Label).string =  nWinPer.toFixed(0).toString()+"%";
        // //Tool.GetChild(this.node,"数据/统计/翻牌率").getComponent(cc.Label).string = nFanPer.toFixed(0).toString()+"%";
        // //Tool.GetChild(this.node,"数据/统计/翻牌胜率").getComponent(cc.Label).string = nFanWin.toFixed(0).toString()+"%";
        // Tool.GetChild(this.node,"数据/统计/获胜手数").getComponent(cc.Label).string = nWin.toString();
        // Tool.GetChild(this.node,"数据/统计/平局手数").getComponent(cc.Label).string = nHe.toString();
        // Tool.GetChild(this.node,"数据/统计/失败手数").getComponent(cc.Label).string = nLose.toString();
        // //Tool.GetChild(this.node,"数据/统计/入池率").getComponent(cc.Label).string =  nRuChi.toFixed(0).toString()+"%";

        Tool.GetChild(this.node,"数据/统计/总手数").getComponent(cc.Label).string = (Number(arrayParam[0])+ Number(arrayParam[1])+ Number(arrayParam[2])).toString();
        Tool.GetChild(this.node,"数据/统计/总胜率").getComponent(cc.Label).string =  nWinPer.toFixed(0).toString()+"%";
        Tool.GetChild(this.node,"数据/统计/失败率").getComponent(cc.Label).string =  nLosePer.toFixed(0).toString()+"%";


        //VIP数据
        Tool.GetChild(this.node,"数据/统计/胜利").getComponent(cc.Label).string = this.bIsVip? nWin.toString():"*"
        Tool.GetChild(this.node,"数据/统计/平局").getComponent(cc.Label).string = this.bIsVip?nHe.toString():"*"
        Tool.GetChild(this.node,"数据/统计/失败").getComponent(cc.Label).string = this.bIsVip?nLose.toString():"*"

        Tool.GetChild(this.node,"数据/统计/入池率").getComponent(cc.Label).string = this.bIsVip?(nRuChi.toFixed(0).toString()+"%"):"*"
        Tool.GetChild(this.node,"数据/统计/翻牌率").getComponent(cc.Label).string = this.bIsVip?(nFanPer.toFixed(0).toString()+"%"):"*"
        Tool.GetChild(this.node,"数据/统计/翻牌胜率").getComponent(cc.Label).string = this.bIsVip?(nFanWin.toFixed(0).toString()+"%"):"*"
    }

    public GetVipInfo()
    {
        //更新vip信息
        let strParam = "{\"header\":\"玩家_查询_VIP\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@玩家_查询_VIP");
    }

    public onHallCommand(nCode:number, param:string)
    {
        if (param.indexOf("玩家_查询_VIP") >= 0)
        {
            if (nCode == 0x200)
            {
                //更新vip信息
                let msg = JSON.parse(param);
                let data = msg["result"];
                if(data["is_vip"] == 1)
                {
                    this.bIsVip = true
                }
                else
                {
                    this.bIsVip = false
                }
                this.UpdateInfo()
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
            
        }
    }
}
