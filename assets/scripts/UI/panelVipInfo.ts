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
        
        // VIP 消费已下线，按钮统一显示「暂未开放」，不吃 Prefab 里写死的「30金币」
        this.RefreshTierLabels();
        //更新vip信息
        this.GetVipInfo()
    }

    /** 三档按钮文案：标题 + 暂未开放（VIP 消费 2026-10-26 起停用）。 */
    private RefreshTierLabels()
    {
        this.SetTierLabel("VIP1","月卡");
        this.SetTierLabel("VIP2","半年卡");
        this.SetTierLabel("VIP3","年卡");
    }

    private SetTierLabel(strNode:string,strTitle:string)
    {
        let node = Tool.GetChild(this.node,strNode);
        let label = node == null ? null : node.getComponentInChildren(cc.Label);
        if(label != null)
            label.string = strTitle + "\n暂未开放";
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

        // VIP 消费已下线（2026-10-26 用户确认「现在没有 VIP 消费」）：
        // 既不发 `玩家_购买_VIP`，也不发 `玩家_消费_命令`，避免扣了钻石又拿不到权益。
        // 面板只留战绩信息展示，购买入口统一提示暂未开放。以后恢复 VIP 时在这里接回协议。
        if(button.node.name == "VIP1" || button.node.name == "VIP2" || button.node.name == "VIP3" || button.node.name == "确认购买VIP")
        {
            Tool.GetChild(this.node,"确认购买面板").active = false
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"VIP 购买暂未开放！")
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
        // 价格配置可能比 VIP 查询回包晚到，展示前再刷一次按钮文案
        this.RefreshTierLabels();

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
