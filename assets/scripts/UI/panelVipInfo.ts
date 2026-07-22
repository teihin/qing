import UIPanelViewBase from "../common/UIPanelViewBase";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import UIManager from "../common/UIManager";
import ScrollViewEx from "../common/ScrollViewEx";
import Debug from "../common/Debug";
import { ShowPanelMode } from "../common/GameDef";

var KBEngine = require("kbengine");

const {ccclass, property} = cc._decorator;

@ccclass
export default class panelVipInfo extends UIPanelViewBase {

    private bIsVip:boolean = false
    

    //玩家_购买_VIP
    //玩家_查询_VIP
    onLoad () {
        super.onLoad();

        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
        
        //更新vip信息
        this.GetVipInfo()
    }

    start () {

    }

    public GetVipInfo()
    {
        //更新vip信息
        let strParam = "{\"header\":\"玩家_查询_VIP\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@玩家_查询_VIP");
    }

    public onButtonClick(button:cc.Button)
    {
        super.onButtonClick(button)

        if(button.node.name == "VIP1")
        {
            Tool.GetChild(this.node,"确认购买面板").active = true
            Tool.GetChild(this.node,"确认购买面板/bk/msg").getComponent(cc.Label).string = "请确认是否花费30金币购买月卡？"
            Tool.GetChild(this.node,"确认购买面板/bk/vip").getComponent(cc.Label).string = "1"
        }
        else if(button.node.name == "VIP2")
        {
            Tool.GetChild(this.node,"确认购买面板").active = true
            Tool.GetChild(this.node,"确认购买面板/bk/msg").getComponent(cc.Label).string = "请确认是否花费120金币购买半年卡？"
            Tool.GetChild(this.node,"确认购买面板/bk/vip").getComponent(cc.Label).string = "2"
        }
        else if(button.node.name == "VIP3")
        {
            Tool.GetChild(this.node,"确认购买面板").active = true
            Tool.GetChild(this.node,"确认购买面板/bk/msg").getComponent(cc.Label).string = "请确认是否花费180金币购买年卡？"
            Tool.GetChild(this.node,"确认购买面板/bk/vip").getComponent(cc.Label).string = "3"
        }
        else if(button.node.name == "确认购买VIP")
        {
            Tool.GetChild(this.node,"确认购买面板").active = false
            let strLevel = Tool.GetChild(this.node,"确认购买面板/bk/vip").getComponent(cc.Label).string
   
            //扣费
            let nMoney = 30
            let strName = ""
            if(strLevel == "1")
            {
                nMoney = 30
                strName = "VIP月卡"
            }
            else if(strLevel == "2")
            {
                nMoney = 120
                strName = "VIP半年卡"
            }
            else if(strLevel == "3")
            {
                nMoney = 180
                strName = "VIP年卡"
            }

            if(GameDataManager.getAccount().gold<nMoney)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"余额不足，购买失败！")
                return
            }

            let strParam = "{\"header\":\"玩家_购买_VIP\",\"vip_level\":\""+strLevel+"\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@玩家_购买_VIP"); 
            strParam = "{\"header\":\"玩家_消费_命令\",\"consume_type\":\"购买"+strName+"\",\"money\":"+nMoney*100+"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "玩家_消费_命令");
            Tool.GetChild(this.node,"确认购买面板").active = false
        }
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
                this.InitShow()
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
            
        }
        else if(param.indexOf("玩家_购买_VIP") >= 0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"购买成功！");
                
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
            this.GetVipInfo()
        }
    }

    public InitShow()
    {

        let strParam:string = GameDataManager.getAccount().remark;
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

        Tool.GetChild(this.node,"基础数据/总手数").getComponent(cc.Label).string = (Number(arrayParam[0])+ Number(arrayParam[1])+ Number(arrayParam[2])).toString();
        Tool.GetChild(this.node,"基础数据/总胜率").getComponent(cc.Label).string =  nWinPer.toFixed(0).toString()+"%";
        Tool.GetChild(this.node,"基础数据/失败率").getComponent(cc.Label).string =  nLosePer.toFixed(0).toString()+"%";

        this.bIsVip = true
        //VIP数据
        Tool.GetChild(this.node,"VIP数据/胜利").getComponent(cc.Label).string = this.bIsVip? nWin.toString():"*"
        Tool.GetChild(this.node,"VIP数据/平局").getComponent(cc.Label).string = this.bIsVip?nHe.toString():"*"
        Tool.GetChild(this.node,"VIP数据/失败").getComponent(cc.Label).string = this.bIsVip?nLose.toString():"*"

        Tool.GetChild(this.node,"VIP数据/入池率").getComponent(cc.Label).string = this.bIsVip?(nRuChi.toFixed(0).toString()+"%"):"*"
        Tool.GetChild(this.node,"VIP数据/翻牌率").getComponent(cc.Label).string = this.bIsVip?(nFanPer.toFixed(0).toString()+"%"):"*"
        Tool.GetChild(this.node,"VIP数据/翻牌胜率").getComponent(cc.Label).string = this.bIsVip?(nFanWin.toFixed(0).toString()+"%"):"*"


    }
}
