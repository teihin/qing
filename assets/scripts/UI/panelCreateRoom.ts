import UIPanelViewBase from "../common/UIPanelViewBase";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import SliderEx from "../common/SliderEx";
import UIManager from "../common/UIManager";
import Debug from "../common/Debug";
import { ShowPanelMode, RoomType } from "../common/GameDef";
import GpsManager from "../logic/GpsManager";
import ConfigManager from "../logic/ConfigManager";

const {ccclass, property} = cc._decorator;

@ccclass
export default class panelCreateRoom extends UIPanelViewBase {

    private sliderDipi:SliderEx = null; //底皮
    private sliderMinIn:SliderEx = null; //最小带入
    private sliderShengMang:SliderEx = null; //升芒最大倍数
    private sliderBeginRen:SliderEx = null; //开局人数
    private sliderNoIn:SliderEx = null; //多少分钟禁止进入
    private sliderGameLen:SliderEx = null; //游戏时长

    private arrayDipiMoney:number[] = [6,10,20,40,80,160]; //底皮扣钱
    private arrayDipiNum:number[] = [1,2,5,10,20,50];
    private arrayDipi:string[] = ["底皮1/3","底皮2/5","底皮5/10","底皮10/20","底皮20/40","底皮50/100"];
    private nMinIn = 50; //当前最小带入
    private arrayShengMang:string[] = ["升芒2倍","升芒3倍","升芒4倍","升芒5倍"];
    private arrayBeginRen:string[] = ["3人自动开","4人自动开","5人自动开","6人自动开","7人自动开"];
    private arrayNoIn:string[] = ["禁入无限制","禁入5分钟","禁入10分钟","禁入15分钟","禁入20分钟"];
    private arrayGameLen:string[] = ["0.5小时 30分钟 ","0.75小时 45分钟 ","1小时 60分钟 "];

    onLoad () {
        super.onLoad();
        let arraySlider = Tool.GetChild(this.node,"列表").getComponentsInChildren(SliderEx);

        for(let item of arraySlider)
        {
            if(item.node.name === "底皮")
            {
                this.sliderDipi = item;
            }
            else if(item.node.name === "最小带入")
            {
                this.sliderMinIn = item;
            }
            else if(item.node.name === "升芒最大倍数")
            {
                this.sliderShengMang = item;
            }
            else if(item.node.name === "开局人数")
            {
                this.sliderBeginRen = item;
            }
            else if(item.node.name === "禁入时间")
            {
                this.sliderNoIn = item;
            }
            else if(item.node.name === "游戏时长")
            {
                this.sliderGameLen = item;
            }
        }
        this.InitConfig();
    }

    start () {

        Tool.GetChild(this.node,"列表/title/名称").getComponent(cc.Label).string = GameDataManager.getAccount().name+"的牌局";
        Tool.GetChild(this.node,"列表/金币/gold").getComponent(cc.Label).string = GameDataManager.getAccount().gold;
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
        else if(button.node.name === "确定创建房间")
        {
            let strRole = "房间名称:私密房 ";
            let arrayToggle = Tool.GetChild(this.node,"列表").getComponentsInChildren(cc.Toggle);
            for(let item of arrayToggle)
            {
                if(item.isChecked)
                {
                    strRole += item.node.name;
                    strRole += " ";
                }
            }

            strRole += this.arrayDipi[this.sliderDipi.curValue]+" ";
            strRole += this.arrayDipi[this.sliderDipi.curValue].replace("底皮","芒果")+" ";
            strRole += "最小带入"+ this.nMinIn*(this.sliderMinIn.curValue+1) + " ";
            strRole += this.arrayShengMang[this.sliderShengMang.curValue] + " ";
            strRole += this.arrayBeginRen[this.sliderBeginRen.curValue] + " ";
            strRole += this.arrayNoIn[this.sliderNoIn.curValue] + " ";
            strRole += this.arrayGameLen[this.sliderGameLen.curValue] + " "

            let strMsg = "{\"game_round\": 99999,\"room_mode\":\"积分房卡房\", \"play_mode\": \"传销扯旋\",\"max_number\": 8, \"special_rule\": \""+strRole+" 8人 观战 带分 控制带入 大厅配分模式 特牌\"}";
            Debug.Log(strMsg);

            if(!GpsManager.getInstance().IsGpsOpen()&&ConfigManager.getInstance().enalbe_gps=="True")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"未打开GPS不能进入房间！")
                return;
            }

            UIManager.getInstance().showPanel("panelLoading",ShowPanelMode.Top);
            GameDataManager.getAccount().reqEnterRoom(RoomType.Custom, 0, strMsg);
        }
    }
    
    public InitConfig()
    {
        //底皮
        this.sliderDipi.minValue = 0;
        this.sliderDipi.maxValue = this.arrayDipi.length-1;
        this.sliderDipi.node.on("onValueChange",()=>{
            let nCur = this.sliderDipi.curValue;
            let strMsg = this.arrayDipi[nCur];
            this.sliderDipi.node.parent.getChildByName("底皮num").getComponent(cc.Label).string = strMsg;

            //更新最小带入
            this.nMinIn =  this.arrayDipiNum[nCur]*50;
            this.sliderMinIn.curValue = 0;

            Tool.GetChild(this.node,"列表/金币/消耗").getComponent(cc.Label).string = "消耗:"+this.arrayDipiMoney[nCur];
        },this);

        //最小带入
        this.sliderMinIn.minValue = 0;
        this.sliderMinIn.maxValue = 5;
        this.sliderMinIn.node.on("onValueChange",()=>{
            let nCur = this.sliderMinIn.curValue;
            let nShow = this.nMinIn*(nCur+1);
            this.sliderMinIn.node.parent.getChildByName("最小带入num").getComponent(cc.Label).string = nShow.toString();
        },this);

        //升芒最大倍数
        this.sliderShengMang.minValue = 0;
        this.sliderShengMang.maxValue = this.arrayShengMang.length-1;
        this.sliderShengMang.node.on("onValueChange",()=>{
            let nCur = this.sliderShengMang.curValue;
            let arrayAll = this.sliderShengMang.node.getComponentsInChildren(cc.Label);
            for(let item of arrayAll)
            {
                if(item.node.name == nCur.toString())
                {
                    item.node.color = cc.color(160,142,244,255);
                }
                else
                {
                    item.node.color = cc.Color.WHITE;
                }
            }
        },this);

        //开局人数
        this.sliderBeginRen.minValue = 0;
        this.sliderBeginRen.maxValue = this.arrayBeginRen.length-1;
        this.sliderBeginRen.node.on("onValueChange",()=>{
            let nCur = this.sliderBeginRen.curValue;
            let arrayAll = this.sliderBeginRen.node.getComponentsInChildren(cc.Label);
            for(let item of arrayAll)
            {
                if(item.node.name == nCur.toString())
                {
                    item.node.color = cc.color(160,142,244,255);
                }
                else
                {
                    item.node.color = cc.Color.WHITE;
                }
            }
        },this);

        //禁入时间
        this.sliderNoIn.minValue = 0;
        this.sliderNoIn.maxValue = this.arrayNoIn.length-1;
        this.sliderNoIn.node.on("onValueChange",()=>{
            let nCur = this.sliderNoIn.curValue;
            let arrayAll = this.sliderNoIn.node.getComponentsInChildren(cc.Label);
            for(let item of arrayAll)
            {
                if(item.node.name == nCur.toString())
                {
                    item.node.color = cc.color(160,142,244,255);
                }
                else
                {
                    item.node.color = cc.Color.WHITE;
                }
            }
        },this);

        //游戏时长
        this.sliderGameLen.minValue = 0;
        this.sliderGameLen.maxValue = this.arrayGameLen.length-1;
        this.sliderGameLen.node.on("onValueChange",()=>{
            let nCur = this.sliderGameLen.curValue;
            let arrayAll = this.sliderGameLen.node.getComponentsInChildren(cc.Label);
            for(let item of arrayAll)
            {
                if(item.node.name == nCur.toString())
                {
                    item.node.color = cc.color(160,142,244,255);
                }
                else
                {
                    item.node.color = cc.Color.WHITE;
                }
            }
        },this);


    }
}
