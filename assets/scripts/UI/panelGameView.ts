import UIPanelViewBase from "../common/UIPanelViewBase";
import GameDataManager from "../GameDataManager";
import UIManager from "../common/UIManager";
import { ClosePanelMode, RoomType, ShowPanelMode, CardInfo, PlayerState, PlayerPos } from "../common/GameDef";
import Tool from "../common/Tool";
import Debug from "../common/Debug";
import DrhLogicMgr from "../logic/DrhLogicMgr";
import GpsManager from "../logic/GpsManager";
import SliderEx from "../common/SliderEx";
import PKCardInfoScript from "../logic/PKCardInfoScript";
import DrhNameManager from "../logic/DrhNameManager";
import ImageManager from "../logic/ImageManager";
import MobileManager from "../mobile/MobileManager";
import ConfigManager from "../logic/ConfigManager";
import DrhPlayerLogic from "../logic/DrhPlayerLogic";
import ScrollViewEx from "../common/ScrollViewEx";

var KBEngine = require("kbengine");

const {ccclass, property} = cc._decorator;

@ccclass
export default class panelGameView extends UIPanelViewBase {

    private PAGE_PER_COUNT:number = 15;
    private gameLogic:DrhLogicMgr = null;

    private bBeginCuo:boolean = false;
    private bBeginDa:boolean = false;
    private transCmd2Cover:cc.Node = null;


    private transShow:cc.Node; //当前下分选择
    private transShowBegin:cc.Node; //开始位置
    private transShowEnd:cc.Node; //结束位置
    private txtCurDa:cc.Label;
    private imgBattery:cc.ProgressBar;
    private txtBattery:cc.Label;

    private mapID2Gps = new Map<string,string>();

    private scrollGuanZhan:ScrollViewEx = null;
    private scrollHuiGu:ScrollViewEx = null;

    public displayJC:dragonBones.ArmatureDisplay = null; //奖池动画
    public displayZP:dragonBones.ArmatureDisplay = null; //转盘结束动画
    public displayZPRun:dragonBones.ArmatureDisplay = null; //转盘结束动画

    public displayQP1:dragonBones.ArmatureDisplay = null; //切牌动画\
    public displayQP2:dragonBones.ArmatureDisplay = null; //切牌动画\
    public displayQP3:dragonBones.ArmatureDisplay = null; //切牌动画\

    private scrollJCList:ScrollViewEx = null;
    onEnable(){
       // Debug.Error("进入enable")
    }

    onLoad () {
        super.onLoad();



        if(this.gameLogic === null)
        {
            this.gameLogic = this.node.getComponent(DrhLogicMgr);
        }
       // Debug.Error("进入load");
        this.UpdateTableImg();
        this.UpdateBackImg();

        //注册网络消息
        KBEngine.Event.register("onLeaveRoom", this, "onLeaveRoom");
        KBEngine.Event.register("onEnterRoom", this, "onEnterRoom");
        KBEngine.Event.register("PromptInfo", this, "onPromptInfo");
        KBEngine.Event.register("PromptInfo2", this, "onPromptInfo2");
        KBEngine.Event.register("onRoomCommand", this, "onRoomCommand");
        KBEngine.Event.register("onGetReturnedRoom", this, "onGetReturnedRoom");

        KBEngine.Event.register("GamePlayerListInfo", this, "onGamePlayerListInfo");
        KBEngine.Event.register("GameWatcherListInfo", this, "onGameWatcherListInfo");

        KBEngine.Event.register("RoundScore", this, "OnRoundScore");
        KBEngine.Event.register("OtherInfo", this, "OnOtherInfo");
        KBEngine.Event.register("SystemInfo", this, "SystemInfo");

        KBEngine.Event.register("onExChange", this, "onExChange");
        KBEngine.Event.register("onExChange2", this, "onExChange");

        KBEngine.Event.register("onHallCommand", this, "onHallCommand");

        KBEngine.Event.register("RewardPoolRec", this, "RewardPoolRec");
        KBEngine.Event.register("Paipu", this, "Paipu"); //文字牌谱

        this.scrollGuanZhan = Tool.GetChild(this.node,"实时战绩/围观列表").getComponent(ScrollViewEx);
        this.scrollGuanZhan.callBackFresh = this.GetWatchList.bind(this);

        this.scrollHuiGu = Tool.GetChild(this.node,"牌局回顾/回顾列表").getComponent(ScrollViewEx);
        this.scrollHuiGu.callBackFresh = this.ShowHistoryInfo.bind(this);

        this.setRoomInfo();

        this.node.on(cc.Node.EventType.TOUCH_END,(event:cc.Event.EventTouch)=>{
            this.OnPointDown(event);        
            //let end = event.getLocation();
            //let start = event.getStartLocation();
            // if(Math.abs(start.y-end.y)>50)
            // {
            //     let nName = Tool.GetConfigNumber("桌面",4);
            //     nName++;
            //     if(nName>4)
            //     {
            //         nName = 1;
            //     }
            //     cc.sys.localStorage.setItem("桌面",nName.toString());
            //     this.UpdateTableImg();
            // }
        },this);

        //扯牌按钮添加消息
        Tool.GetChild(this.node,"cmd2/目标/扯1/BK0").on(cc.Node.EventType.TOUCH_END,(event:cc.Event.EventTouch)=>{
            this.OnPointDown(event);
        },this);
        Tool.GetChild(this.node,"cmd2/目标/扯2/BK0").on(cc.Node.EventType.TOUCH_END,(event:cc.Event.EventTouch)=>{
            this.OnPointDown(event);
        },this);
        Tool.GetChild(this.node,"cmd2/手牌/手1/BK0").on(cc.Node.EventType.TOUCH_END,(event:cc.Event.EventTouch)=>{
            this.OnPointDown(event);
        },this);
        Tool.GetChild(this.node,"cmd2/手牌/手2/BK0").on(cc.Node.EventType.TOUCH_END,(event:cc.Event.EventTouch)=>{
            this.OnPointDown(event);
        },this);
        Tool.GetChild(this.node,"cmd2/手牌/手3/BK0").on(cc.Node.EventType.TOUCH_END,(event:cc.Event.EventTouch)=>{
            this.OnPointDown(event);
        },this);
        Tool.GetChild(this.node,"cmd2/手牌/手4/BK0").on(cc.Node.EventType.TOUCH_END,(event:cc.Event.EventTouch)=>{
            this.OnPointDown(event);
        },this);

        if(this.transCmd2Cover == null)
            this.transCmd2Cover = Tool.GetChild(this.node,"搓牌窗口/遮罩");
            this.transCmd2Cover.on(cc.Node.EventType.TOUCH_START,(event:cc.Event.EventTouch)=>{
            this.bBeginCuo = true;
        },this);
        this.transCmd2Cover.on(cc.Node.EventType.TOUCH_END,(event:cc.Event.EventTouch)=>{
            if (this.bBeginCuo)
            {
                this.DelayShowCuoInfo();
                this.bBeginCuo = false;
            }
        },this);
        this.transCmd2Cover.on(cc.Node.EventType.TOUCH_MOVE,(event:cc.Event.EventTouch)=>{
            if(this.bBeginCuo)
            {
                var delta=event.getDelta();

                this.transCmd2Cover.x+=delta.x;
                this.transCmd2Cover.y+=delta.y;
            }
        },this);

        //大拖拽响应
        let transDa = Tool.GetChild(this.node,"cmd1/大");
        transDa.on(cc.Node.EventType.TOUCH_START,(event:cc.Event.EventTouch)=>{
            this.bBeginDa = true;
            if (this.transShow == null)
                this.transShow = Tool.GetChild(this.node,"大进度/标记");
            if (this.transShowBegin == null)
                this.transShowBegin = Tool.GetChild(this.node,"大进度/0");
            if (this.transShowEnd == null)
                this.transShowEnd = Tool.GetChild(this.node,"大进度/5");
            if (this.txtCurDa == null)
                this.txtCurDa = Tool.GetChild(this.node,"大进度/标记/txt").getComponent(cc.Label);
            this.node.getChildByName("大进度").active = true    ;
            this.transShow.position = this.transShowBegin.position;

            this.txtCurDa.string = this.CheckSmallPlay(this.GetCurDaText());
        },this);
        transDa.on(cc.Node.EventType.TOUCH_MOVE,(event:cc.Event.EventTouch)=>{
            this.onDaMove(event);
        },this);
        Tool.GetChild(this.node,"大进度").on(cc.Node.EventType.TOUCH_MOVE,(event:cc.Event.EventTouch)=>{
            this.onDaMove(event);
        },this);
        transDa.on(cc.Node.EventType.TOUCH_END,(event:cc.Event.EventTouch)=>{
            this.onDaEnd(event);
        },this);
        transDa.on(cc.Node.EventType.TOUCH_CANCEL,(event:cc.Event.EventTouch)=>{
            this.onDaEnd(event);
        },this);

        //语音播放响应
        let transSay = Tool.GetChild(this.node,"RoomFrame/SayBT");
        transSay.on(cc.Node.EventType.TOUCH_START,(event:cc.Event.EventTouch)=>{
            //观战玩家不能说话
            if (this.gameLogic.GetPlayerCtlByID(0).info.strUserID !=  GameDataManager.getAccount().guuid)
            {
                return;
            }
            MobileManager.getInstance().StartRecord();
            this.node.getChildByName("TalkShow").active = true;
        },this);
        transSay.on(cc.Node.EventType.TOUCH_END,(event:cc.Event.EventTouch)=>{
            if(this.node.getChildByName("TalkShow").active)
            {
                MobileManager.getInstance().StopRecord();
                this.node.getChildByName("TalkShow").active = false;
            }

            KBEngine.Event.fire("OnPlayNextAudio");
        },this);
        transSay.on(cc.Node.EventType.TOUCH_CANCEL,(event:cc.Event.EventTouch)=>{
            if(this.node.getChildByName("TalkShow").active)
            {
                MobileManager.getInstance().StopRecord();
                this.node.getChildByName("TalkShow").active = false;
            }
            KBEngine.Event.fire("OnPlayNextAudio");
        },this);

        this.imgBattery = Tool.GetChild(this.node,"BK/电量/进度").getComponent(cc.ProgressBar);
        this.txtBattery = Tool.GetChild(this.node,"BK/电量/num").getComponent(cc.Label);
        //定时刷新电量
        this.schedule(()=>{
            let level = cc.sys.getBatteryLevel();
            Debug.Log("获取电量-:"+level);
            this.imgBattery.progress = level;
            this.txtBattery.string = parseInt((level*100).toString())+"%";
            if(level<0.15)
            {
                this.imgBattery.node.color = cc.Color.RED;
                this.imgBattery.node.parent.color = cc.Color.RED;
            }
            else
            {
                this.imgBattery.node.color = cc.Color.WHITE;
                this.imgBattery.node.parent.color = cc.Color.WHITE;
            }
        },60,cc.macro.REPEAT_FOREVER,0.1);



       
        this.displayJC = this.node.getChildByName("奖池").getComponent(dragonBones.ArmatureDisplay);
        this.displayJC.addEventListener(dragonBones.EventObject.COMPLETE,()=>{
            //Debug.Error("播放完成");
            this.node.getChildByName("奖池").active = false;
        },this);
        // this.displayZP = Tool.GetChild(this.node,"转盘/结果动画").getComponent(dragonBones.ArmatureDisplay);
        // this.displayZP.addEventListener(dragonBones.EventObject.COMPLETE,()=>{
        //     Debug.Error("播放完成");
        //     this.displayZP.node.active = false;
        // },this);
        // this.displayZPRun = Tool.GetChild(this.node,"转盘/转盘动画/转盘动画").getComponent(dragonBones.ArmatureDisplay);
        // this.displayZPRun.addEventListener(dragonBones.EventObject.COMPLETE,()=>{
        //     this.displayZPRun.node.active = false;
        // },this);

        this.displayQP1 = this.node.getChildByName("切牌1").getComponent(dragonBones.ArmatureDisplay);
        this.displayQP1.addEventListener(dragonBones.EventObject.COMPLETE,()=>{
            this.node.getChildByName("切牌1").active = false;
            this.node.getChildByName("切牌2").active = false;
            this.node.getChildByName("切牌3").active = false;
        },this);
        this.displayQP2 = this.node.getChildByName("切牌2").getComponent(dragonBones.ArmatureDisplay);
        this.displayQP2.addEventListener(dragonBones.EventObject.COMPLETE,()=>{
            this.node.getChildByName("切牌1").active = false;
            this.node.getChildByName("切牌2").active = false;
            this.node.getChildByName("切牌3").active = false;
        },this);
        
        this.displayQP3 = this.node.getChildByName("切牌3").getComponent(dragonBones.ArmatureDisplay);
        this.displayQP3.addEventListener(dragonBones.EventObject.COMPLETE,()=>{
            this.node.getChildByName("切牌1").active = false;
            this.node.getChildByName("切牌2").active = false;
            this.node.getChildByName("切牌3").active = false;
        },this);


        Tool.GetChild(this.node,"实时战绩").on(cc.Node.EventType.TOUCH_START,()=>{
            this.CloseAllShow();
        },this);
        Tool.GetChild(this.node,"牌局回顾").on(cc.Node.EventType.TOUCH_START,()=>{
            this.CloseAllShow();
        },this);

        Tool.GetChild(this.node,"奖池面板").on(cc.Node.EventType.TOUCH_END,()=>{
            Tool.GetChild(this.node,"奖池面板").active = false;
        },this);

        this.scrollJCList = Tool.GetChild(this.node,"奖池面板/容器/奖池记录/记录列表").getComponent(ScrollViewEx);
        this.scrollJCList.callBackFresh = this.GetAllJiangDetal.bind(this);
    }
    public CloseAllShow()
    {
        Tool.GetChild(this.node,"ConfigMain").active = false;
        Tool.GetChild(this.node,"实时战绩").active = false;
        Tool.GetChild(this.node,"牌局回顾").active = false;
        Tool.GetChild(this.node,"牌局回顾").active = false;
        Tool.GetChild(this.node,"系统设置").active = false;
        Tool.GetChild(this.node,"牌型提示").active = false;
        Tool.GetChild(this.node,"带入窗口").active = false;
    }

    public onDaMove(event:cc.Event.EventTouch)
    {
        if (this.bBeginDa)
        {
            
            var delta = event.getLocation();
            //this.transCmd2Cover.x+=delta.x;
            let pos = this.transShow.parent.convertToNodeSpaceAR(delta);
            this.transShow.y=pos.y;                

            if (this.transShow.position.y < this.transShowBegin.position.y)
            {
                this.transShow.position = this.transShowBegin.position;
            }
            else if (this.transShow.position.y > this.transShowEnd.position.y)
            {
                this.transShow.position = this.transShowEnd.position;
            }
            else
            {
                
            }

            this.txtCurDa.string = this.CheckSmallPlay(this.GetCurDaText());
            return;
        }
    }
    public onDaEnd(event:cc.Event.EventTouch)
    {
        if (this.bBeginDa)
        {
            
            this.bBeginDa = false;

            this.node.getChildByName("大进度").active = false;
            if (this.txtCurDa.string == "敲")
            {
                this.gameLogic.GetPlayerCtlByID(0).reqRaise("-3");
            }
            else if (this.txtCurDa.string == "0")
            {

            }
            else
            {
                this.gameLogic.GetPlayerCtlByID(0).reqRaise(this.txtCurDa.string);
            }
        }
    }


    public DelayShowCuoInfo()
    {

        this.scheduleOnce(()=>{
            Tool.GetChild(this.node,"搓牌窗口/遮罩").active = false;
            Tool.GetChild(this.node,"搓牌窗口/牌/手1").active = false;
            Tool.GetChild(this.node,"搓牌窗口/牌/手2").active = false;
            
            this.scheduleOnce(()=>{
                GameDataManager.getAccount().reqGameCommand("{\"header\":\"玩家_搓牌_事件\"}", "");
                this.node.getChildByName("搓牌窗口").active = false;
                this.gameLogic.GetPlayerCtlByID(0).PlayCoverOneCard(3);
                if(this.gameLogic.GetPlayerCtlByID(0).info.role == "看牌")
                {
                    this.scheduleOnce(()=>{
                        this.gameLogic.GetPlayerCtlByID(0).ShowCmdPad(true, 2);
                    },1);
                }

            },1);
        },0.3);
    }
    

    start () {

    }


    public OnPointDown(event:cc.Event.EventTouch)
    {
        if(event.getCurrentTarget().name === this.node.name)
        {
            Tool.GetChild(this.node,"ConfigMain").active = false;
            Tool.GetChild(this.node,"实时战绩").active = false;
            Tool.GetChild(this.node,"牌局回顾").active = false;
            Tool.GetChild(this.node,"牌局回顾").active = false;
            Tool.GetChild(this.node,"系统设置").active = false;
            Tool.GetChild(this.node,"牌型提示").active = false;
            Tool.GetChild(this.node,"带入窗口").active = false;
        } 
        else
        {
            let arrayTar = Tool.GetChild(this.node,"cmd2/目标").getComponentsInChildren(PKCardInfoScript);
            let arraySrc = Tool.GetChild(this.node,"cmd2/手牌").getComponentsInChildren(PKCardInfoScript);
            if (event.getCurrentTarget().name == "BK0" && event.getCurrentTarget().parent.name.indexOf("手") >= 0)
            {
                let card = event.getCurrentTarget().parent.getComponent(PKCardInfoScript);
                //找到一个没设置过的
                this.PlayButtonAudio();
    
                let find:PKCardInfoScript = null;
                for (let one of arrayTar)
                {
                    if (!one.node.active)
                    {
                        find = one;
                        break;
                    }
                }
                if (find != null)
                {
                    find.node.active = true;
                    find.SetCardValue(card.nType, card.nNum, 0);
                    card.node.active = false;
                }
    
            }
            if (event.getCurrentTarget().name == "BK0" && event.getCurrentTarget().parent.name.indexOf("扯") >= 0)
            {
                let card = event.getCurrentTarget().parent.getComponent(PKCardInfoScript);
                this.PlayButtonAudio();
    
                for (let one of arraySrc)
                {
                    if (one.node.active)
                        continue;
                    if (one.nType == card.nType && one.nNum == card.nNum)
                    {
                        one.node.active = true;
                        break;
                    }
                }
                card.SetCardValue(0, 0, 0, 1);
                card.node.active = false;
            }
    
    
            //刷新牌型
            let bOK = false;
            let arrayOut = new Array<CardInfo>();
            for (let one of arrayTar)
            {
                if (one.node.active && one.nNum != 0)
                {
                    arrayOut.push(new CardInfo(one.nType, one.nNum));
                }
            }
            if (arrayOut.length == 2)
                bOK = true;
            for (let one of arraySrc)
            {
                if (one.node.active)
                {
                    arrayOut.push(new CardInfo(one.nType, one.nNum));
                }
            }
            if (arrayOut.length == 4 && bOK == true)
            {
                let strNameUp = DrhNameManager.getInstance().GetDrhNameByCard(Tool.GetArrayRange(arrayOut,0,2));
                let strNameDown = DrhNameManager.getInstance().GetDrhNameByCard(Tool.GetArrayRange(arrayOut,2,2));
                Tool.GetChild(this.node,"cmd2/牌型1").active = true;
                Tool.GetChild(this.node,"cmd2/牌型2").active = true;
                Tool.GetChild(this.node,"cmd2/牌型1").getComponent(cc.Label).string = strNameUp;
                Tool.GetChild(this.node,"cmd2/牌型2").getComponent(cc.Label).string = strNameDown;
            }
            else
            {
                Tool.GetChild(this.node,"cmd2/牌型1").active = false;
                Tool.GetChild(this.node,"cmd2/牌型2").active = false;
            }
            
            //如果手牌还打开的需要隐藏
            this.gameLogic.GetPlayerCtlByID(0).GetTransHand().opacity = 0;
        }


        


    }

    public UpdateTableImg()
    {
        let strName = Tool.GetConfigString("桌面","1");
        let img = Tool.GetChild(this.node,"BK").getComponent(cc.Sprite);
        Tool.LoadImg(img,"zuotype/"+strName);
        // //修改LOGO
        // let imgLogo = Tool.GetChild(this.node,"BK/img").getComponent(cc.Sprite);
        // Tool.LoadImg(imgLogo,"zuotype/"+strName+"a");

        //修改图标
        // if(strName == "4")
        //     strName = "2"
        // if(strName == "5")
        //     strName = "3"
        // let img1 = Tool.GetChild(this.node,"RoomFrame/ConfigBT").getComponent(cc.Sprite);
        // Tool.LoadImg(img1,"zuotype/tb/"+strName+"-1")

        // let img2 = Tool.GetChild(this.node,"RoomFrame/信息").getComponent(cc.Sprite);
        // Tool.LoadImg(img2,"zuotype/tb/"+strName+"-2")

        // let img3 = Tool.GetChild(this.node,"RoomFrame/表情/聊天").getComponent(cc.Sprite);
        // Tool.LoadImg(img3,"zuotype/tb/"+strName+"-3")

        // let img4 = Tool.GetChild(this.node,"RoomFrame/记录").getComponent(cc.Sprite);
        // Tool.LoadImg(img4,"zuotype/tb/"+strName+"-4")
    }
    public UpdateBackImg()
    {
        let strName = Tool.GetConfigString("牌背","1");
        let arrayAll = Tool.GetChild(this.node,"UserInfo").getComponentsInChildren(PKCardInfoScript);
        for(let one of arrayAll)
        {
            let img = one.node.getChildByName("BK1").getComponent(cc.Sprite);
            Tool.LoadImg(img,"zuotype/牌背"+strName);
        }

        //调整搓牌背面
        let cuo = Tool.GetChild(this.node,"搓牌窗口/遮罩").getComponent(cc.Sprite);
        Tool.LoadImg(cuo,"zuotype/搓背"+strName);
    }

    public onToggleClick(toggle:cc.Toggle)
    {
        if(toggle.node.name.indexOf("桌面")>=0)
        {
            let strName = toggle.node.name.replace("桌面","");
            cc.sys.localStorage.setItem("桌面",strName);
            this.UpdateTableImg();
        }
        else if(toggle.node.name.indexOf("牌背")>=0)
        {
            let strName = toggle.node.name.replace("牌背","");
            cc.sys.localStorage.setItem("牌背",strName);
            this.UpdateBackImg();
        }
        else if(toggle.node.name === "搓牌开关")
        {
           // cc.sys.localStorage.setItem("搓牌开关",toggle.isChecked?"Ture":"False");
           GameDataManager.getAccount().setDefinedProperty("player_setting",toggle.isChecked?"True":"False");
        }
        else if(toggle.node.name === "音乐开关")
        {
            cc.sys.localStorage.setItem("背景音乐",toggle.isChecked?1:0);
        }
        else if(toggle.node.name === "语音开关")
        {
            cc.sys.localStorage.setItem("AudioGCloud",toggle.isChecked?1:0);
        }
        else if(toggle.node.name === "音效开关")
        {
            cc.sys.localStorage.setItem("AudioEff",toggle.isChecked?100:0);
        }
        else if(toggle.node.name == "奖池" || toggle.node.name == "奖池总览" || toggle.node.name == "奖池记录")
        {
            this.switchJC(toggle.node.name);
        }
        else if(toggle.node.name === "牌局回顾" || toggle.node.name === "文字牌谱")
        {
            let arrayAll = Tool.GetChild(this.node,"牌局回顾/操作").getComponentsInChildren(cc.Toggle);
            for(let item of arrayAll)
            {
                if(item.node.name == toggle.node.name)
                {
                    item.isChecked = true;
                }
                else
                {
                    item.isChecked = false;
                }
            }
            if(toggle.node.name === "牌局回顾")
            {
                Tool.GetChild(this.node,"牌局回顾/回顾列表").active = true;
                Tool.GetChild(this.node,"牌局回顾/文字牌谱").active = false;
                
                this.ShowHistoryInfo(this.nCurPage);
            }
            else
            {
                Tool.GetChild(this.node,"牌局回顾/回顾列表").active = false;
                Tool.GetChild(this.node,"牌局回顾/文字牌谱").active = true;  
                this.ShowHistoryPaiPuInfo(this.nCurPage);
            }
        }
    }

    // update (dt) {}

    onButtonClick(button:cc.Button)
    {
        if(button.node.name != "ConfigBT")
        {
            this.node.getChildByName("ConfigMain").active = false;
        }


        if(button.node.name === "ConfigBT")
        {
            Tool.GetChild(this.node,"ConfigMain").active = true;

            //如果自己是创建房间的人，则显示解散
            if(this.gameLogic.strCreatorID === GameDataManager.getAccount().guuid)
            {
                Tool.GetChild(this.node,"ConfigMain/解散房间").active = true;
            }
            else
            {
                Tool.GetChild(this.node,"ConfigMain/解散房间").active = false;
            }

        }
        else if(button.node.name === "退出房间")
        {
            let strUserID = GameDataManager.getAccount().guuid;
            let strSet:string = GameDataManager.getAccount().roomSetting;

            if (this.gameLogic.round_count == "0" || this.gameLogic.round_count == ""  || this.gameLogic.GetPlayerCtlByID(0).info.strUserID != strUserID || this.gameLogic.strGameState == "end" || (strSet.indexOf("带分") >= 0 && this.gameLogic.GetPlayerCtlByID(0).info.emState != PlayerState.running && this.gameLogic.GetPlayerCtlByID(0).info.strUserID == strUserID))
            {                
                GameDataManager.getAccount().roomID = "";
                GameDataManager.getAccount().reqStopGame();
                GameDataManager.getAccount().reqLeaveRoom();

                UIManager.getInstance().showPanel("panelLoading",ShowPanelMode.Top);    
                MobileManager.getInstance().OnTalkingEvent("退出房间","退出房间");            
            }
            else
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"已经开局不能退出！");                
            }

            
        }
        else if(button.node.name.indexOf("坐下")>=0)
        {
            let strParam = "{\"header\":\"玩家_补芒_查询\",\"context\":\""+button.node.name+"\"}";
            GameDataManager.getAccount().reqGameCommand(strParam, "玩家_补芒_查询");           
        }
        else if(button.node.name === "关闭上层")
        {
            button.node.parent.active = false;
        }
        else if(button.node.name === "关闭上上层")
        {
            button.node.parent.parent.active = false;
        }
        else if(button.node.name === "确认带入")
        {
            let strName = Tool.GetChild(this.node,"带入窗口/sit").getComponent(cc.Label).string;
            strName = strName.replace("坐下", "");
            let strMsg = Tool.GetChild(this.node,"带入窗口/msg").getComponent(cc.Label).string;
            strMsg = strMsg.replace("带入积分:", "");

            if (Number(strMsg) <= 0)
            {
                this.ShowMsg("带入积分必须大于0！");
                return;
            }

            let strUserID = GameDataManager.getAccount().guuid;
            if (!this.CheckCanSitByGps() && strUserID != this.gameLogic.GetPlayerCtlByID(0).info.strUserID)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Top,"你的距离和其他玩家接近，请更换环境!");                
                return;
            }



            let strClubID = "";

            if (this.gameLogic.GetPlayerCtlByID(0).info.req_club_id != "")
                strClubID = this.gameLogic.GetPlayerCtlByID(0).info.req_club_id;


            let nSitPos = 0;
            //自己如果没有坐
            
            if (this.gameLogic.GetPlayerCtlByID(0).info.strUserID == strUserID)
            {
                nSitPos = Number(strName);
                GameDataManager.getAccount().reqRoomCommand("{\"header\":\"坐下_事件\",\"money\":" + strMsg + ",\"ready\":1,\"type\":\"申请\",\"club_id\":\"" + strClubID + "\"}", "坐下_事件1");
            }
            else
            {
                //计算出真实坐下位置
                nSitPos = this.gameLogic.nSelfIndex + Number(strName);
                if (nSitPos > this.gameLogic.MAX_PLAYER - 1)
                {
                    nSitPos = nSitPos - this.gameLogic.MAX_PLAYER;
                }
                GameDataManager.getAccount().reqRoomCommand("{\"header\":\"坐下_事件\",\"site\":" + nSitPos.toString() + ",\"money\":" + strMsg + ",\"ready\":1,\"type\":\"申请\",\"club_id\":\"" + strClubID + "\"}", "坐下_事件");
            }

            button.node.parent.active = false;            
        }
        else if (button.node.name == "丢")
        {
            button.node.parent.active = false;
            this.gameLogic.GetPlayerCtlByID(0).reqPass();
        }
        else if (button.node.name == "休")
        {
            this.gameLogic.GetPlayerCtlByID(0).reqRaise("-5");
        }
        else if (button.node.name == "敲")
        {
            button.node.parent.active = false;
            this.gameLogic.GetPlayerCtlByID(0).reqRaise("-3");
        }
        else if (button.name == "确定敲牌")
        {
            button.node.parent.active = false;
            this.gameLogic.GetPlayerCtlByID(0).reqRaise("-3");
        }
        else if (button.node.name == "大")
        {            
            this.gameLogic.GetPlayerCtlByID(0).ShowCmdPad(true, 4);
        }
        else if (button.node.name == "跟")
        {
            this.gameLogic.GetPlayerCtlByID(0).reqRaise("-1");
        }
        else if (button.node.name == "留座离桌")
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"为玩家留座5分钟，牌局结束后开始留坐!");
            
            GameDataManager.getAccount().reqRoomCommand("{\"header\":\"留座_事件\"}", "留座_事件");
            button.node.parent.active = false;
        }
        else if (button.node.name == "回坐")
        {
            if (!GpsManager.getInstance().IsGpsOpen())
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"检测到GPS未打开，不能回坐！");                
                return;
            }
            let strUserID = GameDataManager.getAccount().guuid;
            if (this.gameLogic.GetPlayerCtlByID(0).info.strUserID != strUserID)
            {
                return;
            }

            if (this.gameLogic.GetPlayerCtlByID(0).info.is_can_return == "True")
            {
                //回坐的时候需要提示补充的芒果
                this.checkBuMang("回坐");
                
            }
            else
            {
                this.onButtonClick(Tool.GetChild(this.node,"ConfigMain/补充钵钵").getComponent(cc.Button));                
            }
        }
        else if(button.node.name === "站起围观")
        {
            GameDataManager.getAccount().reqRoomCommand("{\"header\":\"起立_事件\"}", "起立_事件");
            button.node.parent.active = false;
        }
        else if(button.node.name === "牌型展示")
        {
            this.node.getChildByName("牌型提示").active = true;
            button.node.parent.active = false;
        }
        else if(button.node.name === "牌局设置")
        {
            this.node.getChildByName("系统设置").active = true;
            button.node.parent.active = false;
            //桌面
            let strName = Tool.GetConfigString("桌面","4");
            let arrayToggle = Tool.GetChild(this.node,"系统设置/设置/桌面").getComponentsInChildren(cc.Toggle);
            for(let one of arrayToggle)
            {
                if(one.node.name == "桌面"+strName)
                {
                    one.isChecked = true;
                    break;
                }
            }
            let nBKAudio = Tool.GetConfigNumber("背景音乐",1);
            let nLiaoAudio = Tool.GetConfigNumber("AudioGCloud",1);
            let nGameAudio = Tool.GetConfigNumber("AudioEff",100);
            //Tool.GetChild(this.node,"系统设置/设置/音乐/音乐开关").getComponent(cc.Toggle).isChecked = nBKAudio==1?true:false;
            Tool.GetChild(this.node,"系统设置/设置/声音/音效/音效开关").getComponent(cc.Toggle).isChecked = nGameAudio>=1?true:false;
            Tool.GetChild(this.node,"系统设置/设置/声音/语音/语音开关").getComponent(cc.Toggle).isChecked = nLiaoAudio==1?true:false;

            let strBack = Tool.GetConfigString("牌背","1");
            let arrayToggle2 = Tool.GetChild(this.node,"系统设置/设置/牌背").getComponentsInChildren(cc.Toggle);
            for(let one of arrayToggle2)
            {
                if(one.node.name == "牌背"+strBack)
                {
                    one.isChecked = true;
                    break;
                }
            }

        }
        else if (button.node.name == "补充钵钵")
        {

            button.node.parent.active = false;
            let strUserID = GameDataManager.getAccount().guuid;
            //如果没有位置不允许申请
            if (this.gameLogic.GetPlayerCtlByID(0).info.strUserID != strUserID)
            {
                this.ShowMsg("请先找位置坐下！");
                return;
            }

            //如果当前没有留座则直接补分this.info.site_countdown != "0" && this.info.site_countdown != ""
            let countdown = this.gameLogic.GetPlayerCtlByID(0).info.site_countdown;
            if(countdown!="0"&&countdown!=""&&!this.bFromTC)
            {
                this.checkBuMang();
                Tool.GetChild(this.node,"带入窗口").active = false;
            }
            else{
                Tool.GetChild(this.node,"带入窗口").active = true;
            }
            this.bFromTC = false;
            
            Tool.GetChild(this.node,"带入窗口/sit").getComponent(cc.Label).string = this.gameLogic.nSelfIndex.toString();
            

            let  strSet:string = GameDataManager.getAccount().roomSetting;
            let strGold = GameDataManager.getAccount().gold;
            let nMax = Number(strGold) - Number(strGold) * 10 / 100;

            let nPos = strSet.indexOf("底皮");
            let nEnd = strSet.indexOf(" ", nPos);
            let strDi = strSet.substr(nPos, nEnd - nPos);

            nPos = strSet.indexOf("最小带入");
            nEnd = strSet.indexOf(" ", nPos);
            let strMin = strSet.substr(nPos, nEnd - nPos);
            strMin = strMin.replace("最小带入", "");

            let strMaxIn = strGold;

            let nCount = Number(strMaxIn) / Number(strMin);

            let slider = Tool.GetChild(this.node,"带入窗口/Slider").getComponent(SliderEx);              
            slider.maxValue = nCount-1;


            //找到自己的历史带入
            let nHisIn = Number(this.gameLogic.GetPlayerCtlByID(0).info.begin_score);
   
            Tool.GetChild(this.node,"带入窗口/gold").getComponent(cc.Label).string = strGold;
            Tool.GetChild(this.node,"带入窗口/已带入").getComponent(cc.Label).string = this.CheckSmallPlay(nHisIn.toString()) + "/" + strMaxIn;
            


            if (Number(strMaxIn) < Number(strMin))
            {
                Tool.GetChild(this.node,"带入窗口/余额不足提示").active = true;
                Tool.GetChild(this.node,"带入窗口/余额不足提示/txt").getComponent(cc.Label).string = "金币余额不足" + Number(strMin) + "，请先充值！";
            }
            else
            {
                Tool.GetChild(this.node,"带入窗口/余额不足提示").active = false;                
            }


            Tool.GetChild(this.node,"带入窗口/msg").getComponent(cc.Label).string = strMin;

            

            slider.progress = 0;
            let callback = ()=>{                
                let nBei = slider.curValue + 1;
                let nNew = Number(strMin) * nBei;
                Tool.GetChild(this.node,"带入窗口/msg").getComponent(cc.Label).string = nNew.toString();
            };
            slider.node.off("onValueChange",callback,this);
            slider.node.on("onValueChange",callback,this);

        }
        else if (button.node.name == "确定扯牌")
        {
            
            let arrayTar = Tool.GetChild(this.node,"cmd2/目标").getComponentsInChildren(PKCardInfoScript);
            let arrayOut = new Array<CardInfo>();
            for (let one of arrayTar)
            {
                if (one.node.active && one.nNum != 0)
                {
                    arrayOut.push(new CardInfo(one.nType, one.nNum));
                }
            }
            if (arrayOut.length < 2)
            {
                this.ShowMsg("请先组合牌型！");
                return;
            }
            let arraySrc = Tool.GetChild(this.node,"cmd2/手牌").getComponentsInChildren(PKCardInfoScript);
            for (let one of arraySrc)
            {
                if (one.node.active)
                {
                    arrayOut.push(new CardInfo(one.nType, one.nNum));
                }
            }
            if (arrayOut.length != 4)
            {
                this.ShowMsg("请先组合牌型！");
                return;
            }

            this.gameLogic.GetPlayerCtlByID(0).reqShow(arrayOut);
        }
        else if (button.node.name == "底池1" || button.node.name == "底池2" || button.node.name == "底池3")
        {
            let strNum = button.node.getChildByName("num").getComponent(cc.Label).string;
            this.gameLogic.GetPlayerCtlByID(0).reqRaise(strNum);
        }
        else if(button.node.name === "看牌")
        {
            this.node.getChildByName("搓牌窗口").active = false;
            this.gameLogic.GetPlayerCtlByID(0).PlayCoverOneCard(3);

            GameDataManager.getAccount().reqGameCommand("{\"header\":\"玩家_搓牌_事件\"}", "");

            if(this.gameLogic.GetPlayerCtlByID(0).info.role == "看牌")
            {
                this.scheduleOnce(()=>{
                    this.gameLogic.GetPlayerCtlByID(0).ShowCmdPad(true, 2);
                },1);
            }

        }
        else if(button.node.name === "记录")
        {
            this.node.getChildByName("实时战绩").active = true;
            this.GetReadRecordInfo();
            this.GetWatchList();

            this.nCurRoomTime = this.gameLogic.game_end_time;
            this.unschedule(this.callbackRoomTimeCount);
            //启动房间刷新倒计时                    
            this.schedule(this.callbackRoomTimeCount,1,cc.macro.REPEAT_FOREVER,0.1);

            let strCuo = GameDataManager.getAccount().player_setting;
            Tool.GetChild(this.node,"实时战绩/搓牌开关").getComponent(cc.Toggle).isChecked = strCuo=="True"?true:false;
        }
        else if(button.node.name === "信息")
        {
            this.node.getChildByName("牌局回顾").active = true;

            //显示战绩，隐藏牌谱


            Tool.GetChild(this.node,"牌局回顾/操作/牌局回顾").getComponent(cc.Toggle).isChecked = true;

            this.ShowHistoryInfo(Number(this.gameLogic.round_count) - 1);

            let  strSet:string = GameDataManager.getAccount().roomSetting;
            if(strSet.indexOf("地九王")>=0)
            {                
                Tool.GetChild(this.node,"牌局回顾/地方").active = true;
            }
            else
            {                
                Tool.GetChild(this.node,"牌局回顾/地方").active = false;
            }
        }
        else if(button.node.name == "返回大厅")
        {
            KBEngine.Event.fire("onGoToMain");
        }
        else if(button.node.name ==="异常刷新")
        {
            //Tool.GetChild(this.node,"cmd1/大").stopAllActions();
            //this.node.getChildByName("cmd1").active = !this.node.getChildByName("cmd1").active;
            //let strRoomID = GameDataManager.getAccount().roomID;
            //this.SystemInfo("{\"system_content\":\""+"0,0," + strRoomID + ",33333,手动阀手动阀手动阀手动阀\"}");
            
            GameDataManager.getAccount().reqGetFullMessage();
            //UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"刷新成功！");
           // this.node.getChildByName("奖池").active = true;
           // this.displayJC.playAnimation("newAnimation",1);
            
        }
        else if(button.node.parent.name === "UserInfo")
        {
            let player = button.node.getComponent(DrhPlayerLogic);

            let arrayParam = new Array<DrhPlayerLogic>();
            
            arrayParam.push(player);

            // if (player.playerPos == PlayerPos.self && GameDataManager.getAccount().guuid == this.gameLogic.GetPlayerCtlByID(0).info.strUserID)
            // {
            //     UIManager.getInstance().showPanel("panelTalk",ShowPanelMode.Cover,"",arrayParam)
            // }
            // else
            // {
                UIManager.getInstance().showPanel("panelUserInfo",ShowPanelMode.Cover,"",arrayParam)
            //}

            let strParam = "{\"header\":\"提交_玩家_信息\",\"action\":\"点击头像\",\"content\":\""+player.info.strUserID+"\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@提交_玩家_信息");
        }
        else if(button.node.name === "表情")
        {

            if (GameDataManager.getAccount().guuid == this.gameLogic.GetPlayerCtlByID(0).info.strUserID)
            {
                UIManager.getInstance().showPanel("panelTalk",ShowPanelMode.Cover);
            }
        }
        else if(button.node.name === "解散房间")
        {
            button.node.parent.active = false;
            this.node.getChildByName("解散房间").active = true;
        }
        else if(button.node.name === "确认解散")
        {
            button.node.parent.active = false;
            GameDataManager.getAccount().reqExec("申请_解散_事件");            
        }
        else if(button.node.name == "充值")
        {
            cc.loader.loadRes("Prefabs/钱包",(err,obj)=>{
                if(err)
                {
                    cc.error(err.message || err);
                    Debug.Log("错误！！！！！！！！！");
                    return null;
                }
                let node = cc.instantiate(obj);
                node.active = true;
                node.name = "钱包";
                node.parent =this.node.parent;
            });
        }
        else if(button.node.name === "首页")
        {
            this.ShowHistoryInfo(1);
        }
        else if(button.node.name === "上一页")
        {
            if(this.nCurPage == 1)
                return;
            this.ShowHistoryInfo(this.nCurPage-1);
        }
        else if(button.node.name === "下一页")
        {
            if(this.nCurPage+1 > (Number(this.gameLogic.round_count)-1))
                return;
            this.ShowHistoryInfo(this.nCurPage+1);
        }
        else if(button.node.name === "尾页")
        {
            if(Number(this.gameLogic.round_count)<=1)
                return;
            this.ShowHistoryInfo(Number(this.gameLogic.round_count)-1);
        }
        else if(button.node.name === "聊天")
        {
            //观战玩家不能说话
            if (this.gameLogic.GetPlayerCtlByID(0).info.strUserID != GameDataManager.getAccount().guuid)
            {
                return;
            }
            UIManager.getInstance().showPanel("panelTalkMsg",ShowPanelMode.Cover);
        }
        else if(button.node.name === "延时")
        {
            if (Number(GameDataManager.getAccount().gold.toString()) < Number(this.gameLogic.GetPlayerCtlByID(0).info.count_times))
            {
                this.ShowMsg("金币不足无法延时！");
                return;
            }

            if( this.gameLogic.GetPlayerCtlByID(0).info.count_times == "0")
            {
                GameDataManager.getAccount().reqGameCommand("{\"header\":\"延长时间_命令\"}", "延长时间_命令");
                return;
            }

            this.node.getChildByName("扣费提示").active = true;
            Tool.GetChild(this.node,"扣费提示/msg").getComponent(cc.Label).string = "确认消耗"+ this.gameLogic.GetPlayerCtlByID(0).info.count_times + "金币延时20秒吗？";
           
        }
        else if(button.node.name === "确认延时")
        {
            button.node.parent.active = false;
            GameDataManager.getAccount().reqGameCommand("{\"header\":\"延长时间_命令\"}", "延长时间_命令");
       
        }
        else if(button.node.name == "强制秀牌")
        {
            if (Number(GameDataManager.getAccount().gold) < 5)
            {
                this.ShowMsg("余额不足，强制看牌失败！");
                return;
            }
            for(let one of this.gameLogic.arrayPlayer)
            {
                one.FourceLook();
            }

            let strParam = "{\"header\":\"玩家_翻所有人牌_命令\"}";
            GameDataManager.getAccount().reqGameCommand(strParam, "玩家_翻所有人牌_命令");
            strParam = "{\"header\":\"玩家_消费_命令\",\"consume_type\":\"强制秀牌\",\"money\":500}";
            GameDataManager.getAccount().reqGameCommand(strParam, "玩家_消费_命令");
            button.interactable = false;
            button.node.opacity = 100;
        }
        else if(button.node.name == "看剩余牌")
        {
            let strGold = GameDataManager.getAccount().gold;
            let  strGold2 = GameDataManager.getAccount().gold2;
            if (Number(strGold + "." + strGold2) < 0.1)
            {
                this.ShowMsg("余额不足，强制看牌失败！");
                return;
            }

            if (this.gameLogic.GetPlayerCtlByID(0).LookNextCard())
            {
                let strParam = "{\"header\":\"玩家_消费_命令\",\"consume_type\":\"看下一张牌\",\"money\":10}";
                GameDataManager.getAccount().reqGameCommand(strParam, "玩家_消费_命令");

                button.interactable = false;
                button.node.opacity = 100;
            }
        }
        else if(button.node.name == "秀牌")
        {
            let nIndex = button.node.parent.getSiblingIndex();
            let strShow = this.gameLogic.GetPlayerCtlByID(0).info.turn_pai;
            if (strShow == "")
            {
                strShow = "00";
            }
            let arrayAll = new Array<string>();
            arrayAll.push(strShow[0].toString());
            arrayAll.push(strShow[1].toString());

            arrayAll[nIndex] = arrayAll[nIndex] == "0" ? "1" : "0";

            let strOut = arrayAll[0] + arrayAll[1];

            let strParam = "{\"header\":\"玩家_翻牌_命令\",\"turn_pai\":\"" + strOut + "\"}";
            GameDataManager.getAccount().reqGameCommand(strParam, "玩家_翻牌_命令");
        }
        else if(button.node.name.indexOf("策略")>=0)
        {
            let strType = button.node.name.replace("策略","");
            let strParam = "{\"header\":\"执行安全_命令\",\"style\":\""+ strType + "\"}";
            GameDataManager.getAccount().reqGameCommand(strParam, "执行安全_命令");
        }
        else if(button.node.name == "修复")
        {
            let strParam = "{\"header\":\"执行检查_命令\"}";
            GameDataManager.getAccount().reqGameCommand(strParam, "执行检查_命令");
        }
        else if(button.node.name == "完成")
        {
            let strParam = "{\"header\":\"关闭检查_命令\"}";
            GameDataManager.getAccount().reqGameCommand(strParam, "关闭检查_命令");
        }
        else if (button.node.name == "休或丢")
        {
            let strCur = this.gameLogic.GetPlayerCtlByID(0).info.take;
            let strNew = "关闭";
            if (strCur == "关闭" || strCur == "自动休")
            {
                strNew = button.node.name;
                Tool.LoadImg(Tool.GetChild(this.node,"cmd3/休或丢").getComponent(cc.Sprite),"other/休或丢1");
                Tool.LoadImg(Tool.GetChild(this.node,"cmd3/自动休").getComponent(cc.Sprite),"other/自动休0");
            }
            else if (strCur == "休或丢")
            {
                strNew = "关闭";
                Tool.LoadImg(Tool.GetChild(this.node,"cmd3/休或丢").getComponent(cc.Sprite),"other/休或丢0");
                Tool.LoadImg(Tool.GetChild(this.node,"cmd3/自动休").getComponent(cc.Sprite),"other/自动休0");
            }
            this.gameLogic.GetPlayerCtlByID(0).info.take = strNew;

            let strParam = "{\"header\":\"玩家_预定_命令\",\"take\":\"" + strNew + "\"}";
            GameDataManager.getAccount().reqGameCommand(strParam, "@P玩家_预定_命令");
        }
        else if (button.node.name == "自动休")
        {
            let strCur = this.gameLogic.GetPlayerCtlByID(0).info.take;
            let strNew = "关闭";
            if (strCur == "关闭" || strCur == "休或丢")
            {
                strNew = button.node.name;
                Tool.LoadImg(Tool.GetChild(this.node,"cmd3/休或丢").getComponent(cc.Sprite),"other/休或丢0");
                Tool.LoadImg(Tool.GetChild(this.node,"cmd3/自动休").getComponent(cc.Sprite),"other/自动休1");
            }
            else if (strCur == "自动休")
            {
                strNew = "关闭";
                Tool.LoadImg(Tool.GetChild(this.node,"cmd3/休或丢").getComponent(cc.Sprite),"other/休或丢0");
                Tool.LoadImg(Tool.GetChild(this.node,"cmd3/自动休").getComponent(cc.Sprite),"other/自动休0");
            }
            this.gameLogic.GetPlayerCtlByID(0).info.take = strNew;
            let strParam = "{\"header\":\"玩家_预定_命令\",\"take\":\"" + strNew + "\"}";
            GameDataManager.getAccount().reqGameCommand(strParam, "@P玩家_预定_命令");
        }
        else if(button.node.name == "切牌")
        {
            let strUserID = GameDataManager.getAccount().guuid;
            if(strUserID != this.gameLogic.GetPlayerCtlByID(0).info.strUserID)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "未参与牌局不能切牌!");
                return;
            }

            let strParam = "{\"header\":\"玩家_切牌_命令\"}";
            GameDataManager.getAccount().reqGameCommand(strParam, "玩家_切牌_命令");

            strParam = "{\"header\":\"玩家_消费_命令\",\"consume_type\":\"切牌\",\"money\":100}";
            GameDataManager.getAccount().reqGameCommand(strParam, "玩家_消费_命令");

            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "已发起切牌！");
            
        }
        else if(button.node.name == "确认芒果")
        {
            let strName = button.node.parent.getChildByName("name").getComponent(cc.Label).string;
            
            if(strName == "补分")
            {
                //直接显示窗口
                Tool.GetChild(this.node,"带入窗口").active = true;
            }
            else if(strName == "回坐")
            {
                GameDataManager.getAccount().reqRoomCommand("{\"header\":\"回座_事件\"}", "回座_事件");
            }
            else if(strName == "弹窗")
            {
                this.bFromTC =true;
                let button = Tool.GetChild(this.node,"ConfigMain/补充钵钵").getComponent(cc.Button);
                this.onButtonClick(button);
            }
            else    
            {
                this.onSitButton(strName);
                
            }
            button.node.parent.active = false;
            
        }
        else if(button.node.name === "奖池条")
        {
            Tool.GetChild(this.node,"奖池面板").active = true;
            this.switchJC("奖池");
        }
        else if(button.node.name === "举报")
        {
            Tool.GetChild(this.node,"举报窗口").active = true;
            //复位
            let arrayAll = Tool.GetChild(this.node,"举报窗口/头像列表/view/举报content").children;
            //刷新当局列表
            let arrayZJ = Tool.GetChild(this.node,"牌局回顾/回顾列表/view/content").children;
            let i=0;
            for(i=0;i<arrayZJ.length;i++)
            {
                let item = arrayZJ[i];
                if(!item.active)
                {
                    arrayAll[i].active = false;
                    arrayAll[i].getChildByName("选择").active = false;
                    continue;
                }
                arrayAll[i].active = true;
                arrayAll[i].name = item.getChildByName("id").getComponent(cc.Label).string.replace("ID:","");
                Tool.GetChild(arrayAll[i],"mask/img").getComponent(cc.Sprite).spriteFrame = Tool.GetChild(item,"head/img").getComponent(cc.Sprite).spriteFrame;
                Tool.GetChild(arrayAll[i],"name").getComponent(cc.Label).string = item.getChildByName("name").getComponent(cc.Label).string;
                arrayAll[i].getChildByName("选择").active = false;
            }
            for(;i<arrayAll.length;i++)
            {
                arrayAll[i].active = false;
            }

            Tool.GetChild(this.node,"举报窗口/公告文本").getComponent(cc.EditBox).string = "";
        }
        else if(button.node.parent.name == "举报content")
        {
            button.node.getChildByName("选择").active = !button.node.getChildByName("选择").active;
        }
        else if(button.node.name === "提交举报")
        {
            this.node.getChildByName("举报扣费提示").active = true;
            Tool.GetChild(this.node,"举报扣费提示/msg").getComponent(cc.Label).string = "确认消耗50金币举报玩家吗？";
           
        }
        else if(button.node.name === "确认举报")
        {
            this.node.getChildByName("举报扣费提示").active = false;

            if (Number(GameDataManager.getAccount().gold) < 50)
            {
                this.ShowMsg("余额不足，不能举报失败！");
                return;
            }



            let arrayAll = Tool.GetChild(this.node,"举报窗口/头像列表/view/举报content").children;

            let strUsers = "";
            for(let one of arrayAll)
            {
                if(one.active == false)
                    continue;
                if(one.getChildByName("选择").active)
                {
                    strUsers += one.name+",";
                }
            } 
            let strMsg = Tool.GetChild(this.node,"举报窗口/公告文本").getComponent(cc.EditBox).string;

            if(strUsers =="")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请选择要举报的用户")
                return;
            }

            if(strMsg =="")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入举报原因！")
                return;
            }
            if(strMsg.length>500)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"文本内容过长！");
                return;
            }
            Tool.GetChild(this.node,"举报窗口").active = false;
            let strParam = "{\"header\":\"举报_玩家_信息\",\"room_id\":\""+GameDataManager.getAccount().roomID+"\",\"player_list\":\""+strUsers+"\",\"grame_round\":\""+this.nCurPage+"\",\"report_info\":\""+Tool.Base64Encode(strMsg)+"\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@举报_玩家_信息");

            strParam = "{\"header\":\"玩家_消费_命令\",\"consume_type\":\"举报\",\"money\":5000}";
            GameDataManager.getAccount().reqHallCommand(strParam, "玩家_消费_命令");
        }
        else if(button.node.name.indexOf("tt")>=0)
        {
            let strName = button.node.name.replace("tt","");
            if(strName == "1")
            {
                this.gameLogic.playingView.displayQP1.node.active = true;
                this.gameLogic.playingView.displayQP2.node.active = false;
                this.gameLogic.playingView.displayQP3.node.active = false;
                this.gameLogic.playingView.displayQP1.playAnimation("animation",1);
            }
            else if(strName == "2")
            {
                this.gameLogic.playingView.displayQP1.node.active = false;
                this.gameLogic.playingView.displayQP2.node.active = true;
                this.gameLogic.playingView.displayQP3.node.active = false;
                this.gameLogic.playingView.displayQP2.playAnimation("animation",1);
            }
            else if(strName == "3")
            {
                this.gameLogic.playingView.displayQP1.node.active = false;
                this.gameLogic.playingView.displayQP2.node.active = false;
                this.gameLogic.playingView.displayQP3.node.active = true;
                this.gameLogic.playingView.displayQP3.playAnimation("animation",1);
            }
        }
        else if(button.node.name === "转盘")
        {
            this.node.getChildByName("转盘").active = true;
            this.GetZhuanPanInfo();
            this.GetZhuanPanList();
        }
        else if(button.node.name === "转盘1") //开始抽奖
        {
            let strParam = "{\"header\":\"玩家_抽奖_命令\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@玩家_抽奖_命令");
        }
    }

    public GetZhuanPanInfo()
    {
        let strParam = "{\"header\":\"获取_玩家_抽奖_信息\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_玩家_抽奖_信息");
    }

    public switchJC(strName:string)
    {
        let arrayAll = Tool.GetChild(this.node,"奖池面板/条件").getComponentsInChildren(cc.Toggle);
        for(let item of arrayAll)
        {
            if(item.node.name == strName)
            {
                item.isChecked = true;
            }
            else
            {
                item.isChecked = false;
            }
        }
        let arrayView = Tool.GetChild(this.node,"奖池面板/容器").children;
        for(let view of arrayView)
        {
            if(view.name == strName)
            {
                view.active = true;
            }
            else
            {
                view.active = false;
            }
        }
        //数据
        if(strName == "奖池记录")
        {
            this.GetAllJiangDetal();
        }
        else
        {
            this.GetAllJiangChiInfo();
        }
    }
    //查询奖池信息
    public GetAllJiangChiInfo()
    {
        let strParam = "{\"header\":\"查询_奖池_信息\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_奖池_信息");
    }
    //查询奖池记录
    public GetAllJiangDetal()
    {
        let strSet:string = GameDataManager.getAccount().roomSetting;
        let nPos = strSet.indexOf("底皮");
        let nEnd = strSet.indexOf(" ", nPos);
        let strDi = strSet.substr(nPos, nEnd - nPos);

        let strParam = "{\"header\":\"查询_奖池_记录\",\"score_type\":\"" + strDi + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_奖池_记录");
    }

    public bFromTC = false; //从弹窗过来的补分不需要再次确认

    onLeaveRoom(nCode:number)
    {
        if(nCode === 0x200)
        {
            cc.director.loadScene("login");
        }
        else
        {
            cc.director.loadScene("login");
        }
    }
    onEnterRoom(nCode:number,nRoomID:number)
    {
        //准备进入游戏
        if(nCode === 0x200 && GameDataManager.getAccount().bReSendFull) //进入房间成功！
        {
            //游戏内重连，需要获取全量
            this.scheduleOnce(()=>{
                GameDataManager.getAccount().reqGetFullMessage();
                GameDataManager.getAccount().bReSendFull = false;
            },0.5); 
        }
    }

    //恢复房间
    onGetReturnedRoom(nCode:number,nRoomID:number)
    {
        UIManager.getInstance().closePanelByName("panelLoading",ClosePanelMode.Top);
        if(nCode === 0x200) //需要恢复房间
        {
            if(nRoomID != 0) //需要进入房间
            {
                GameDataManager.getAccount().bReSendFull = true;
                GameDataManager.getAccount().reqEnterRoom(RoomType.Custom,nRoomID,"");
            }
            else
            {
                KBEngine.Event.fire("onGoToMain");
            }
        }
        else
        {
            KBEngine.Event.fire("onGoToMain");
        }
    }

    setRoomInfo()
    {
        //更新房间号
        Tool.GetChild(this.node,"RoomFrame/roomnum").getComponent(cc.Label).string = GameDataManager.getAccount().roomID;
        //更新房间信息
        let test = GameDataManager.getAccount();
        let strSet = GameDataManager.getAccount().roomSetting;
        Debug.Log(strSet);
        let json = JSON.parse(strSet);
        let roles:string = json["special_rule"];
        let arrayRoles = roles.split(" ");

        let strRoomInfo = "";
        let strDiFen = "";
        arrayRoles.forEach((role,idx,array)=>{
            if (role.indexOf("圈芒") >= 0)
            {
                strRoomInfo += role;
                strRoomInfo += "@";
            }
            if (role.indexOf("休揍芒") >= 0)
            {
                strRoomInfo += "休芒/揍芒";
                strRoomInfo += " ";
            }
            if (role.indexOf("底皮") >= 0)
            {
                this.gameLogic.strRoomDipi = role;
                strDiFen = role;
            }
            if (role.indexOf("吃喜") >= 0 && role.indexOf("/") >= 0)
            {
                strRoomInfo += role;
                strRoomInfo += " ";
            }
            if (role.indexOf("九王") >= 0)
            {
                strRoomInfo += role;
                strRoomInfo += "@";

            }
            if (role.indexOf("分少优势") >= 0)
            {
                strRoomInfo += role;
                strRoomInfo += "@";

            }
            if (role.indexOf("手") >= 0)
            {
                strRoomInfo += role;
                strRoomInfo += "@";
            }
            if(role.indexOf("房间名称:")>=0)
            {
                this.gameLogic.strRoomName = role.replace("房间名称:", "");                
            }
            if(role.indexOf("分钟")>=0)
            {
                this.gameLogic.strRoomTime = role;
            }
            if(role.indexOf("人自动开")>=0)
            {                
                this.node.getChildByName("等待开局提示").getComponent(cc.Label).string = "满"+role[0]+"人准备后自动开局";
            }
        },this);
        strRoomInfo = strDiFen + " " + strRoomInfo;
        strRoomInfo = strRoomInfo.replace(RegExp(" ",'g'), "\r\n");
        strRoomInfo = strRoomInfo.replace(RegExp("@",'g'), " ");
        strRoomInfo = strRoomInfo.replace("圈芒", "手手芒");
        strRoomInfo = strRoomInfo.replace("分少优势", "赔小家");
        strRoomInfo = strRoomInfo.replace("手手芒 ", "手手芒/");
        let strTxt = strRoomInfo + (strRoomInfo.indexOf("地九王") >= 0 && strSet.indexOf("特牌") < 0 ? " 无特牌" : "");

        Tool.GetChild(this.node,"RoomFrame/info/类型/地九王").active = strTxt.indexOf("地九王") >= 0 ? true : false;
        Tool.GetChild(this.node,"RoomFrame/info/类型/私密房").active = roles.indexOf("私密房") >= 0 ? true : false;
        Tool.GetChild(this.node,"RoomFrame/info").getComponent(cc.Label).string = strTxt.replace("地九王","");



        //修改等待信息
    }

    showMsg(strMsg:string)
    {
        Tool.GetChild(this.node,"提示").active = true;
        Tool.GetChild(this.node,"提示/txt").getComponent(cc.Label).string = strMsg;
        this.unschedule(this.delayCloseMsg);
        this.scheduleOnce(this.delayCloseMsg,2);
    }
    delayCloseMsg()
    {
        this.node.getChildByName("提示").active = false;
    }

    showGameInfo(strMsg:string)
    {
        Tool.GetChild(this.node,"开局提示/txt").getComponent(cc.Label).string = strMsg;
        this.unschedule(this.delayCloseMsg2);
        this.scheduleOnce(this.delayCloseMsg2,2);
    }
    delayCloseMsg2()
    {
        this.node.getChildByName("开局提示").active = false;
    }

    onPromptInfo(strMsg:string)
    {
        strMsg = strMsg.replace(',}',"}");
        let json = JSON.parse(strMsg);
        if(json === null)
        {
            Debug.Log("Json 格式异常！");
            return;
        }
        let strWord = json["word"];
        if(strWord!=null && strWord != "")
        {
            if (strWord == "房主同意坐下")
            {
                //this.gameLogic.GetPlayerCtlByID(0).PlayAudio(0, "坐下");
            }
            else if (strWord.indexOf("揍芒") >= 0 || strWord.indexOf("休芒") >= 0 || strWord.indexOf("没搭动") >= 0)
            {
                this.showGameInfo(strWord);
                return;
            }
            else if(strWord.indexOf("弹窗,留座")>=0)
            {
                
                    // let button = Tool.GetChild(this.node,"ConfigMain/补充钵钵").getComponent(cc.Button);
                    // this.onButtonClick(button);
                //弹窗的都需要查询
                this.checkBuMang("弹窗");
                
                return;
            }
            else if(strWord.indexOf("不补芒")>=0)
            {

            }
            else
                this.showMsg(strWord);
        }
    }
    onPromptInfo2(strMsg:string)
    {
        strMsg = strMsg.replace(',}',"}");
        let json = JSON.parse(strMsg);
        if(json === null)
        {
            Debug.Log("Json 格式异常！");
            return;
        }
        let strWord = json["word"];
        let strContext = json["context"];
        if(strWord!=null && strWord != "")
        {
            if(strWord.indexOf("不补芒")>=0)
            {
                if(strContext == "回坐")
                {
                    GameDataManager.getAccount().reqRoomCommand("{\"header\":\"回座_事件\"}", "回座_事件");
                }
                else if(strContext == "补分")
                {
                    this.node.getChildByName("带入窗口").active = true;
                }
                else if(strContext == "弹窗")
                {
                    let button = Tool.GetChild(this.node,"ConfigMain/补充钵钵").getComponent(cc.Button);
                    this.onButtonClick(button);
                }
                else
                    this.onSitButton(strContext);
            }
            else
            {
                //提示补芒
                Tool.GetChild(this.node,"芒果提示/msg").getComponent(cc.Label).string = strWord;
                Tool.GetChild(this.node,"芒果提示/name").getComponent(cc.Label).string = strContext;
                this.node.getChildByName("芒果提示").active = true;
            }
        }
    }
    public UpdateGPSInfo()
    {
        let strParam = "{\"header\":\"获取_房间内玩家_地理_命令\"}";
        GameDataManager.getAccount().reqAccountCommand(strParam, "获取_房间内玩家_地理_命令");
    }
    public ShowMsg(strMsg:string)
    {
        Tool.GetChild(this.node,"提示/txt").getComponent(cc.Label).string = strMsg;
        
        this.node.getChildByName("提示").active = true;
        this.unschedule(this.delayCloseMsg);
        this.scheduleOnce(this.delayCloseMsg,2);

    }
    public DelayCloseMsg()
    {
        this.node.getChildByName("提示").active = false;
    }
    //检测GPS是否有相近得玩家
    public CheckCanSitByGps():boolean
    {
        let strEnableGps = ConfigManager.getInstance().enalbe_gps;
        if (strEnableGps == null || strEnableGps != "True" || cc.sys.os == cc.sys.OS_WINDOWS || cc.sys.isBrowser)
            return true;

        //校验和其他玩家距离
        let strCurGps = GpsManager.getInstance().GetCurGps();
        if (strCurGps == "" || strCurGps == "0,0" || strCurGps == "0.0,0.0")
        {
            return false;
        }

        for(let player of this.gameLogic.arrayPlayer)
        {
            if (player.info.strUserID == "init" || player.info.strGps == "" || player.info.strGps == "0,0" || player.info.strGps == "0.0,0.0")   //修复有没开GPS玩家坐下后影响其他玩家
                continue;
            let strDes = GpsManager.getInstance().GetLengthGPS(strCurGps, player.info.strGps);

            if (strDes == "" || Number(strDes) < 300)
            {
                return false;
            }
        }
        return true;
    }
    //检测是否小皮玩法,
    public CheckSmallPlay(strNum:string):string
    {
        let strSet:string = GameDataManager.getAccount().roomSetting;
        if ((strSet.indexOf("0.1/0.3") >= 0 || strSet.indexOf("0.2/0.5") >= 0) && strNum !="敲" && strNum != "")
        {
            
            let fOut = Number(strNum) / 10;
            return fOut.toString();
        }
        else
        {
            return strNum;
        }
    }
    public onRoomCommand(nCode:number, param:string)
    {
        if (param.indexOf("坐下") >= 0)
        {
            if (nCode == 0x200)
            {
                if(param == "坐下_事件1")
                {
                    this.ShowMsg("带入成功!");
                }
                else
                {
                    this.ShowMsg("坐下成功！");
                }
                
            }
            else
            {
                
            }
        }
    }
    public PlayButtonAudio()
    {

    }
    //计算当前需要显示的选择
    public GetCurDaText():string
    {
        let strSet:string = GameDataManager.getAccount().roomSetting;
        //找到底分，下注分必须为底分的整倍数
        let nPos = strSet.indexOf("底皮");
        let nPosE = strSet.indexOf(" ", nPos);
        let strDi = strSet.substr(nPos, nPosE - nPos);
        strDi = strDi.replace("底皮", "");
        nPos = strDi.indexOf("/");
        strDi = strDi.substr(nPos + 1);

        let  nDi = (strDi.indexOf("0.")>=0)?Number((Number(strDi)*10)):Number(strDi);

        //计算总共需要分的份数
        let nAll = this.gameLogic.GetPlayerCtlByID(0).info.nGoldNum + Number(this.gameLogic.GetPlayerCtlByID(0).info.beicount); //总共的钱，上限
        let nTotleFen = (nAll - Number(this.gameLogic.GetPlayerCtlByID(0).info.min_score)) / nDi;
        //不足一份按照一份算
        if (nTotleFen < 1)
            nTotleFen = 1;
        //计算每一份的高度
        let fOneFenHight = (this.transShowEnd.position.y - this.transShowBegin.position.y) /nTotleFen;

        //得到当前拖拽高度
        let fCurHigth = this.transShow.position.y - this.transShowBegin.position.y;
        if (fCurHigth <= 0)
            fCurHigth = 0;

        //得到当前高度对应的刻度数
        let fCurFen = fCurHigth / fOneFenHight;
        fCurFen = Math.ceil(fCurFen);  //向上取整

        //计算当前的金额
        if (fCurFen >= nTotleFen)
            return "敲";
        else
        {
            let nAdd = fCurFen * nDi;
            if (nAdd>0)
            {
                if(nAdd>500)
                {
                    Debug.Log("111");
                }
                return (Number(this.gameLogic.GetPlayerCtlByID(0).info.min_score)+ nAdd).toString();
            }
            else
            {
                return "0";
            }

        }

    }
    public GetReadRecordInfo()
    {
        let strParam = "{\"header\":\"获取_游戏内玩家_信息_命令\"}";
        GameDataManager.getAccount().reqAccountCommand(strParam, "P@获取_游戏内玩家_信息_命令");
        Tool.GetChild(this.node,"实时战绩/战绩列表/view/content").removeAllChildren();
        
    }

    public GetWatchList()
    {
        let strParam = "{\"header\":\"获取_游戏内旁观_信息_命令\"}";
        GameDataManager.getAccount().reqAccountCommand(strParam, "P@获取_游戏内旁观_信息_命令");
        Tool.GetChild(this.node,"实时战绩/围观列表/view/content").removeAllChildren(); 
    }
    public onGamePlayerListInfo(strParam:string)
    {
        let data = JSON.parse(strParam);

        if (data == null)
        {
            Debug.Error("查询实时战绩消息 json格式异常！");
            return;
        }

        let transParent = Tool.GetChild(this.node,"实时战绩/战绩列表/view/content");
        transParent.removeAllChildren();
        let strUserID = GameDataManager.getAccount().guuid;


        let nTotleIn = 0;
        let nTotleScore = 0; //总得分

        let  jList = data["GamePlayerListInfo"];
        for (let i = 0; i < jList.length; i++)
        {
            let one = jList[i];
            let strID = one["id"].toString();
            let strName = one["name"].toString();
            let strMoney = one["money_score"].toString();
            let strIn = one["init_money"].toString();
            let strScore = one["total_score"].toString();

            nTotleIn += Number(strIn);
            if(Number(strScore)>0)
                nTotleScore += Number(strScore);
            cc.loader.loadRes("Prefabs/带入记录",(err,obj)=>{
                if(err)
                {
                    cc.error(err.message || err);
                    return null;
                }
                let node:cc.Node = cc.instantiate(obj);
                node.parent = transParent;

                node.getChildByName("name").getComponent(cc.Label).string = strName;
                node.getChildByName("in").getComponent(cc.Label).string = this.CheckSmallPlay( strIn);                
                
    
                if (strID == strUserID)
                {
                    node.getChildByName("name").color = cc.color(74, 149, 251, 255);
                    node.getChildByName("in").color = cc.color(74, 149, 251, 255);
                }
                else
                {
                    node.getChildByName("name").color = cc.color(255,255,255,255);
                    node.getChildByName("in").color = cc.color(255,255,255,255);
                }
    
                if (Number(strScore) > 0)
                {
                    node.getChildByName("score").getComponent(cc.Label).string = "+" + this.CheckSmallPlay( strScore);
                    node.getChildByName("score").color = cc.Color.RED;

                    
                }
                else if (Number(strScore) < 0)
                {
                    node.getChildByName("score").getComponent(cc.Label).string = this.CheckSmallPlay( strScore);
                    node.getChildByName("score").color = cc.color(21, 255, 139, 255);
                }
                else
                {
                    node.getChildByName("score").getComponent(cc.Label).string = this.CheckSmallPlay( strScore);
                }
    
    
                //检测玩家是否在位置上            
                let bFind = false;
                for(let player of this.gameLogic.arrayPlayer)
                {
                    if(strID == player.info.strUserID)
                    {
                        bFind = true;
                        break;
                    }
                }
                if(!bFind)
                {
                    let arrayAllTxt = node.getComponentsInChildren(cc.Label);
                    for(let txt of arrayAllTxt)
                    {
                        txt.node.color = cc.color(124,124,124,255);
                    }
                }
    
            });
        }

        Tool.GetChild(this.node,"实时战绩/总带入").getComponent(cc.Label).string =  nTotleIn.toString();
        // if(data.hasOwnProperty("boss_xi_money"))
        // {
        //     Tool.GetChild(this.node,"实时战绩/平台").getComponent(cc.Label).string = data["boss_xi_money"];
        // }
        // if(data.hasOwnProperty("player_xi_money"))
        // {
        //     Tool.GetChild(this.node,"实时战绩/喜金").getComponent(cc.Label).string = data["player_xi_money"];
        // }
        Tool.GetChild(this.node,"实时战绩/奖池").getComponent(cc.Label).string = data["reward_pool"].toString();
        if(Number(data["reward_pool"])>0)
        {
            Tool.GetChild(this.node,"实时战绩/奖池").color = cc.Color.RED;
        }
        else if(Number(data["reward_pool"]) == 0)
        {
            Tool.GetChild(this.node,"实时战绩/奖池").color = cc.Color.WHITE;
        }
        else{
            Tool.GetChild(this.node,"实时战绩/奖池").color = cc.Color.GREEN;
        }
        Tool.GetChild(this.node,"实时战绩/总得分").getComponent(cc.Label).string = nTotleScore.toString();
        
    }
    public onGameWatcherListInfo(strParam:string)
    {
        this.scrollGuanZhan.UpdateList(strParam,"GameWatcherListInfo","观战对象",this.PAGE_PER_COUNT,this.setGuanZhanItem.bind(this));
    }
    public setGuanZhanItem(node:cc.Node,jItem:any)
    {
        node.active = true;
        node.getChildByName("name").getComponent(cc.Label).string = jItem["name"];
        let img = Tool.GetChild(node,"head/img").getComponent(cc.Sprite);
        let avatarIndex = jItem.hasOwnProperty("photo") ? jItem["photo"].toString() : "";
        if (!ImageManager.getInstance().GetImageByName(jItem["id"], avatarIndex, img))
        {
            ImageManager.getInstance().AddWaitFreshImage2Catch(jItem["id"], img);
        }
    }

    
    private nCurPage = 1;
    public ShowHistoryInfo(nRound:number)
    {
        //如果当前是查看牌谱则掉查询牌谱
        if(!Tool.GetChild(this.node,"牌局回顾/回顾列表").active)
        {
            this.ShowHistoryPaiPuInfo(nRound);
            return;
        }


        if (nRound > 0)
        {
            this.nCurPage = nRound;
            Tool.GetChild(this.node,"牌局回顾/分页/页码").getComponent(cc.Label).string = nRound.toString()+"/"+(Number(this.gameLogic.round_count)-1);
            let strParam = "{\"header\":\"查询_房间_玩家_战绩_信息\",\"room_id\":\"" + GameDataManager.getAccount().roomID + "\",\"round_id\":\"" + nRound.toString() + "\"}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "@查询_房间_玩家_战绩_信息");
        }
    }

    public ShowHistoryPaiPuInfo(nRound:number)
    {
        if (nRound > 0)
        {
            this.nCurPage = nRound;
            Tool.GetChild(this.node,"牌局回顾/分页/页码").getComponent(cc.Label).string = nRound.toString()+"/"+(Number(this.gameLogic.round_count)-1);
            let strParam = "{\"header\":\"查询_房间_玩家_牌谱_信息\",\"room_id\":\"" + GameDataManager.getAccount().roomID + "\",\"round_id\":\"" + nRound.toString() + "\"}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "@查询_房间_玩家_牌谱_信息");
        }
    }

    private strShowPai:string = "";
    public OnRoundScore(strMsg:string)
    {
        // Tool.GetChild(this.node,"牌局回顾/平台").getComponent(cc.Label).string = "";
        let data = JSON.parse(strMsg);
        if(data == null)
            return;
        let jList = data["RoundScore"];
        if (jList.length > 0)
        {
            let  jRound = jList[0];                      
            if (jRound.hasOwnProperty("remark2"))
            {
                this.strShowPai = jRound["remark2"].toString();
            }

            let jPlayers = jRound["players"];            
            for (let i = 0; i < jPlayers.length; i++)
            {
                let jItem = jPlayers[i];
                if(i>=this.scrollHuiGu.content.childrenCount)
                {
                    cc.loader.loadRes("Prefabs/回顾对象",(err,obj)=>{
                        if(err)
                        {
                            cc.error(err.message || err);
                            return null;
                        }
                        let node = cc.instantiate(obj);
                        node.parent = this.scrollHuiGu.content;
                        this.setItemInfo(node,jItem);
                    });
                }
                else
                {
                    this.setItemInfo(this.scrollHuiGu.content.children[i],jItem);
                }
            }
            //多余的对象全部删除
            let arrayDel = new Array<cc.Node>();
            for(let i=jPlayers.length;i<this.scrollHuiGu.content.childrenCount;i++)
            {
                arrayDel.push(this.scrollHuiGu.content.children[i]);
            }
            for(let item of arrayDel)
            {
                item.destroy();
            }
        }


        if(this.strShowPai === "秀")
        {
            Tool.GetChild(this.node,"牌局回顾/举报").active = true
        }
        else
        {
            Tool.GetChild(this.node,"牌局回顾/举报").active = false
        }

    }

    public setItemInfo(objNew:cc.Node,jOne:any)
    {
        objNew.active = true;
        let strName:string = jOne["user_name"].toString();
        let strID:string = jOne["user_guuid"].toString();
        let strScore:string = jOne["score"].toString();
        let strMark:string = jOne["remark"].toString();

        //处理mark
        let arrayAll = strMark.split('@');
        let strState = arrayAll[0];
        let strCards:string = "{\"hand\":" + arrayAll[1] + "}";
        let strOther1:string = arrayAll[2];
        let strOther2:string = arrayAll[3];
        let strOther3:string = arrayAll[4];
        //strOther5 = arrayAll[5];
        let strBank:string = arrayAll[6];
        let strInitCard:string = "{\"hand\":" + arrayAll[7] + "}";
        let strTurn:string = arrayAll[8]; //眼睛
        let strJC = arrayAll[9]; //奖池
        
        if(Number(strJC)>0)
        {
            Tool.GetChild(this.node,"牌局回顾/奖池").getComponent(cc.Label).string = "+"+strJC;
            Tool.GetChild(this.node,"牌局回顾/奖池").color = cc.Color.RED;
        }
        else if(Number(strJC) == 0)
        {
            Tool.GetChild(this.node,"牌局回顾/奖池").getComponent(cc.Label).string = strJC;
            Tool.GetChild(this.node,"牌局回顾/奖池").color = cc.Color.WHITE;
        }
        else
        {
            Tool.GetChild(this.node,"牌局回顾/奖池").getComponent(cc.Label).string = strJC;
            Tool.GetChild(this.node,"牌局回顾/奖池").color = cc.Color.GREEN;
        }




        let strPeiXiaoJia = arrayAll.length<=10?"": arrayAll[10];


        let arrayCardsInit = new Array<CardInfo>();
        let cardLast:CardInfo = null; //尾牌
        //解析初始手牌
        let dHandInit = JSON.parse(strInitCard);
        let jHandAllInit = dHandInit["hand"];
        for (let j = 0; j < 2; j++) //前2张
        {
            let  jOneCard = jHandAllInit[j];
            arrayCardsInit.push(new CardInfo(Number(jOneCard[0]), Number(jOneCard[1])));
        }
        //有最后一张
        if(jHandAllInit.length == 4)
        {
            let jOneCard = jHandAllInit[3];
            cardLast = new CardInfo(Number(jOneCard[0]), Number(jOneCard[1]));
        }



        let arrayCards = new Array<CardInfo>();
        //解析手牌
        let dHand = JSON.parse(strCards);
        let jHandAll = dHand["hand"];
        for (let j = 0; j < jHandAll.length; j++)
        {
            let jOneCard = jHandAll[j];
            arrayCards.push(new CardInfo(Number(jOneCard[0]), Number(jOneCard[1])));
        }

           //刷新显示数据                    
           objNew.getChildByName("name").getComponent(cc.Label).string = strName;
           objNew.getChildByName("id").getComponent(cc.Label).string = "ID:" + strID;

           //objNew.getChildByName("小家").active = (strPeiXiaoJia == "赔小家" ? true : false);

           if (strBank == "庄家")
           {
               objNew.getChildByName("庄").active = true;
           }
           else
           {
               objNew.getChildByName("庄").active = false;
           }

           if (strState != "花牌" && strState != "关牌")
           {
                objNew.getChildByName("state").active = true;
               Tool.LoadImg(objNew.getChildByName("state").getComponent(cc.Sprite),"other/" + strState);   
           }                     
           else
               objNew.getChildByName("state").active = false;
           let strShowScore = strScore.indexOf("-") >= 0 ? strScore : (strScore == "0" ? strScore : "+" + strScore);
           objNew.getChildByName("score").getComponent(cc.Label).string = "";//this.CheckSmallPlay( strShowScore);


           let arrayTxt = objNew.getChildByName("list").getComponentsInChildren(cc.Label);
           let nCur = 4;
           for (let one of arrayTxt)
           {
               let strTxt = arrayAll[nCur--].trim();

               if(nCur == 2)
               {
                   strTxt = strShowScore;
                   
                    if (strShowScore.indexOf("-") >= 0)
                    {
                        one.node.color = cc.color(21, 255, 139, 255);
                    }
                    else if (strShowScore.indexOf("+") >= 0)
                    {
                        one.node.color = cc.Color.RED;
                    }
               }
               else
               {
                    one.node.color = cc.Color.WHITE;
               }

               if (strTxt == "")
               {
                   one.node.active = true;
                   one.string = "";
                   continue;
               }
               else 
               {
                    one.node.active = true;
               }
               
               let nP = strTxt.indexOf(":");
               if(nP>0)
               {
                    let strSub1 = strTxt.substr(0, nP+1);
                    let strSub2 = strTxt.substr(nP + 1);
                    strSub2 = this.CheckSmallPlay(strSub2);
                    one.string = strSub1 + strSub2;
               }
               else
               {
                   one.string = this.CheckSmallPlay(strTxt);
               }

               
           }

        //    if (strShowScore.indexOf("-") >= 0)
        //    {
        //         transScore.color = cc.color(21, 255, 139, 255);
        //    }
        //    else if (strShowScore.indexOf("+") >= 0)
        //    {
        //         transScore.color = cc.Color.RED;
        //    }

           //刷新手牌
           let handCard:Array<PKCardInfoScript> = objNew.getChildByName("手牌").getComponentsInChildren(PKCardInfoScript);

           //修改牌面
           let strPN = Tool.GetConfigString("牌背","1");
           for(let one of handCard)
           {
               let img = one.node.getChildByName("BK1").getComponent(cc.Sprite);
               Tool.LoadImg(img,"zuotype/牌背"+strPN);
           }


           let nPos = 0;
           for (; nPos < arrayCards.length; nPos++)
           {
               let card = arrayCards[nPos];
               handCard[nPos].SetCardValue(card.nType, card.nNum, 0);

               //复位横线
               handCard[nPos].node.getChildByName("line").active = false;
               if (strState == "弃牌" || strState == "关牌" || strState == "休牌" ||arrayCards.length<4)
               {

               }
               else
               {
                    //检测是否时初始牌
                    for (let one of arrayCardsInit)
                    {
                        if (card.nType == one.nType && card.nNum == one.nNum)
                        {
                            //handCard[nPos].transform.Find("line").gameObject.SetActive(true);
                            let imgLine = handCard[nPos].node.getChildByName("line");
                            imgLine.active = true;
                            imgLine.color = cc.color(236, 255, 20, 255);
                            break;
                        }
                    }
                    if(card.nType == cardLast.nType && card.nNum == cardLast.nNum)
                    {
                        let imgLine = handCard[nPos].node.getChildByName("line");
                        imgLine.active = true;
                        imgLine.color = cc.color(255, 79, 49, 255);
                    }
               }


           }
           for (; nPos < 4; nPos++)
           {
               handCard[nPos].node.active = false;
           }

           if (strState == "花牌")
           {
               objNew.getChildByName("三花").active = true;
               objNew.getChildByName("三花").getComponent(cc.Label).string = "三花";
           }
           else
           {
               objNew.getChildByName("三花").active = false;
           }

           let strUserID = GameDataManager.getAccount().guuid;
           if ((strState == "弃牌" || strState == "休牌" || strState == "关牌") && strID != strUserID && this.strShowPai!="秀")
           {
               handCard[0].ShowFace(1);
               handCard[1].ShowFace(1);
           }

           //是否秀过牌
           if(strState == "弃牌" && strTurn.length>=2)
           {
               if(strTurn[0].toString() == "1")
               {
                   handCard[0].ShowFace(0);
               }
               if(strTurn[1].toString() == "1")
               {
                   handCard[1].ShowFace(0);
               }
           }



           //刷牌型
           if (arrayCards.length < 4 || strState == "花牌")
           {
               Tool.GetChild(objNew,"手牌/牌型1").active = false;
               Tool.GetChild(objNew,"手牌/牌型2").active = false;
           }
           else
           {
               if (strState == "弃牌" || strState == "休牌")
               {
                   Tool.GetChild(objNew,"手牌/牌型1").active = false;
                   Tool.GetChild(objNew,"手牌/牌型2").active = false;
               }
               else
               {
                   let strCardName = DrhNameManager.getInstance().GetDrhNameByCard(Tool.GetArrayRange(arrayCards,0,2));
                   Tool.GetChild(objNew,"手牌/牌型1").active = true;
                   Tool.GetChild(objNew,"手牌/牌型1").getComponent(cc.Label).string = strCardName;

                   strCardName = DrhNameManager.getInstance().GetDrhNameByCard(Tool.GetArrayRange(arrayCards,2,2));
                   Tool.GetChild(objNew,"手牌/牌型2").active = true;
                   Tool.GetChild(objNew,"手牌/牌型2").getComponent(cc.Label).string = strCardName;
               }
           }

           let img = Tool.GetChild(objNew,"head/img").getComponent(cc.Sprite);
           if (!ImageManager.getInstance().GetImageByName(strID, "", img))
           {
               ImageManager.getInstance().AddWaitFreshImage2Catch(strID, img);
           }
    }



    public nCurRoomTime:number;
    public txtRoomTime:cc.Label = null;
    //房间倒计时
    public callbackRoomTimeCount()
    {
        //刷新数据
        if (this.nCurRoomTime > 0 && this.gameLogic.round_count!="0")
            this.nCurRoomTime--;
        
        if(this.txtRoomTime === null)
        {
            this.txtRoomTime = Tool.GetChild(this.node,"实时战绩/title2/倒计时").getComponent(cc.Label);
        }
        let time = new Date(0,0,0,0,0,this.nCurRoomTime,0);
        this.txtRoomTime.string = time.getHours().toString().padStart(2,"0")+":"+time.getMinutes().toString().padStart(2,"0")+":"+time.getSeconds().toString().padStart(2,"0");
    }
    public OnOtherInfo(strParam:string)
    {
        let data = JSON.parse(strParam);
        if (data == null)
        {
            Debug.Error("查询_房间地理信息 json格式异常！");
            return;
        }
        let jList = data["OtherInfo"];

        this.mapID2Gps.clear();
       
        for (let i = 0; i < jList.length; i++)
        {
            let jOne = jList[i];
            let strID = jOne["id"].toString();            
            let gps = jOne["gps"].toString();
            
            this.mapID2Gps.set(strID,gps);
        }

        //刷新到每个人头上
        for(let player of this.gameLogic.arrayPlayer)
        {
            if(this.mapID2Gps.has(player.info.strUserID))
            {
                player.info.strGps = this.mapID2Gps.get(player.info.strUserID);
            }
        }

        //如果时第一次进入房间，需要判断是否存在距离相近的玩家
        if (strParam.indexOf("校验能否观战") >= 0)
        {
            if (!this.CheckCanSitByGps())
            {
                //退出房间，并取消所有房间内消息监听
                KBEngine.Event.deregisterOut(this);
                GameDataManager.getAccount().setDefinedProperty("roomID", "");
                GameDataManager.getAccount().reqStopGame();
                GameDataManager.getAccount().reqLeaveRoom();
                this.node.getChildByName("GPS警告").active = true;                
            }
        }
    }
    public SystemInfo(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        if (data == null)
        {
            return;
        }
        let strContent:string = data["system_content"];


        let arrayAll = strContent.split(',');

        let strRoomID = GameDataManager.getAccount().roomID;
        if(strRoomID == arrayAll[2])
        {
            let strUserID = GameDataManager.getAccount().guuid;

            this.node.getChildByName("奖池").active = true;

            Tool.GetChild(this.node,"奖池/num").getComponent(cc.Label).string = arrayAll[3];
            this.showMsg(arrayAll[4]);

            this.displayJC.playAnimation("newAnimation",1);

            //播放声音
            this.gameLogic.PlayAudio2("喜金");
        }
  
    }
    public onExChange(nCode:number)
    {
        let strMsg = "";
        if (nCode == 0x200) //成功
        {
            strMsg = "交易成功！";
        }
        else if (nCode == 0x302)
        {
            strMsg = "余额不足，转账失败！";
        }
        else if (nCode == 0x303)
        {
            strMsg = "用户不存在，转账失败！";
        }
        else if (nCode == 0x304)
        {
            strMsg = "不能给自己转账！";
        }
        else if (nCode == 0x305)
        {
            strMsg = "不能给非关联账户转账！";
        }
        else if (nCode == 0x306)
        {
            strMsg = "房卡不能回转！";

        }
        else if(nCode == 0x307)
        {
            strMsg = "未设置初始密码，请设置后再操作！";
        }
        else if(nCode == 0x308)
        {
            strMsg = "密码错误，请重新输入";
        }
        else
        {
            strMsg = "交易失败！";
        }

        UIManager.getInstance().closePanelByName("panelLoading",ClosePanelMode.Top);
        UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, strMsg);
    }
    
    public onSitButton(param:string)
    {
            //检测当前模式，根据模式走不同流程
            let strSet:string = GameDataManager.getAccount().roomSetting;
            //检测当前是否已经坐下
            let strUserID = GameDataManager.getAccount().guuid;
            if (strUserID == this.gameLogic.GetPlayerCtlByID(0).info.strUserID)
            {
                this.ShowMsg("已经坐下了！");
                return;
            }

            //检测是否人满
            let nCountAll = 0;
            this.gameLogic.arrayPlayer.forEach((player,idx,array)=>{
                if (player.info.strUserID != "init")
                {
                    nCountAll++;
                }
            },this);


            if (!GpsManager.getInstance().IsGpsOpen()) //判断GPS是否打开
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"当前手机定位功能未开启，建议您到手机系统中打开定位服务");                
                return;
            }

            if(!this.CheckCanSitByGps())
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"你的距离和其他玩家过近，请更换网络环境!");   
                return;
            }


            //是否坐过，如果坐过直接带入
            for(let one of this.gameLogic.arraySited)
            {
                if (one == strUserID) //已经坐过了， 直接发起坐下
                {
                    let strName = param.replace("坐下", "");
                    //计算出真实坐下位置
                    let nSitPos = this.gameLogic.nSelfIndex + Number(strName);
                    if (nSitPos > this.gameLogic.MAX_PLAYER - 1)
                    {
                        nSitPos = nSitPos - this.gameLogic.MAX_PLAYER;
                    }
                    GameDataManager.getAccount().reqRoomCommand("{\"header\":\"坐下_事件\",\"site\":" + nSitPos.toString() + "}", "坐下_事件");
                    return;
                }
            }


            //this.checkBuMang();
            this.node.getChildByName("带入窗口").active = true;
            Tool.GetChild(this.node,"带入窗口/sit").getComponent(cc.Label).string = param;
        


            let strGold = GameDataManager.getAccount().gold;


            let nPos = strSet.indexOf("底皮");
            let nEnd = strSet.indexOf(" ", nPos);
            let strDi = strSet.substr(nPos, nEnd - nPos);

            nPos = strSet.indexOf("最小带入");
            nEnd = strSet.indexOf(" ", nPos);
            let strMin = strSet.substr(nPos, nEnd - nPos);
            strMin = strMin.replace("最小带入", "");

            let strMaxIn = strGold;

            let nCount = Number(strMaxIn) / Number(strMin);

            let slider = Tool.GetChild(this.node,"带入窗口/Slider").getComponent(SliderEx);              
            slider.maxValue = nCount-1;
            

            //找到自己的历史带入
            let nHisIn = 0;
            for (let one of this.gameLogic.arrayHisIn)
            {
                if (one.indexOf(strUserID) >= 0)
                {
                    nHisIn = Number(one.replace(strUserID + "@", ""));
                    break;
                }
            }

            Tool.GetChild(this.node,"带入窗口/gold").getComponent(cc.Label).string = strGold;
            Tool.GetChild(this.node,"带入窗口/已带入").getComponent(cc.Label).string = this.CheckSmallPlay(nHisIn.toString()) + "/" + strMaxIn;
            

            if (Number(strMaxIn) < Number(strMin))
            {
                Tool.GetChild(this.node,"带入窗口/余额不足提示").active = true;
                Tool.GetChild(this.node,"带入窗口/余额不足提示/txt").getComponent(cc.Label).string = "金币余额不足" + Number(strMin) + "，请先充值！";                
            }
            else
            {
                Tool.GetChild(this.node,"带入窗口/余额不足提示").active = false;                
            }

            Tool.GetChild(this.node,"带入窗口/msg").getComponent(cc.Label).string = strMin;
            
            
            slider.progress = 0;
            let callback = ()=>{                
                let nBei = slider.curValue + 1;
                let nNew = Number(strMin) * nBei;
                Tool.GetChild(this.node,"带入窗口/msg").getComponent(cc.Label).string = nNew.toString();
            };
            slider.node.off("onValueChange",callback,this);
            slider.node.on("onValueChange",callback,this);
    }
    //在位置上检查是否补芒
    public checkBuMang(strType:string = "补分"){
        let strParam = "{\"header\":\"玩家_补芒_查询\",\"context\":\""+strType+"\"}";
            GameDataManager.getAccount().reqGameCommand(strParam, "玩家_补芒_查询");  
    }
    private pospos = 0
    public onHallCommand(nCode:number,param:string)
    {
        if(param.indexOf("查询_奖池_信息") >= 0)
        {
            if(nCode == 0x200)
            {
                let json = JSON.parse(param);
                let data = json["result"];
                let strTotle = data["all_rewards"].toString();
                let jList = data["rewards"];

                let str02 = jList["底皮0.2/0.5"].toString();
                let str1 = jList["底皮1/3"].toString();
                let str2 = jList["底皮2/5"].toString();
                let str5 = jList["底皮5/10"].toString();
                let str10 = jList["底皮10/20"].toString();
                let str20 = jList["底皮20/40"].toString();
                let str50 = jList["底皮50/100"].toString();

                Tool.GetChild(this.node,"奖池面板/容器/奖池总览/总金额/num").getComponent(cc.Label).string = strTotle;

                Tool.GetChild(this.node,"奖池面板/容器/奖池总览/各级奖池奖励设定/底皮1-3").getComponent(cc.Label).string = str1;
                Tool.GetChild(this.node,"奖池面板/容器/奖池总览/各级奖池奖励设定/底皮2-5").getComponent(cc.Label).string = str2;
                Tool.GetChild(this.node,"奖池面板/容器/奖池总览/各级奖池奖励设定/底皮5-10").getComponent(cc.Label).string = str5;
                Tool.GetChild(this.node,"奖池面板/容器/奖池总览/各级奖池奖励设定/底皮10-20").getComponent(cc.Label).string = str10;
                Tool.GetChild(this.node,"奖池面板/容器/奖池总览/各级奖池奖励设定/底皮20-40").getComponent(cc.Label).string = str20;
                Tool.GetChild(this.node,"奖池面板/容器/奖池总览/各级奖池奖励设定/底皮50-100").getComponent(cc.Label).string = str50;

                let strSet:string = GameDataManager.getAccount().roomSetting;
                let nPos = strSet.indexOf("底皮");
                let nEnd = strSet.indexOf(" ", nPos);
                let strDi = strSet.substr(nPos, nEnd - nPos).replace("/", "-");

                let strCount = "0";
                if(Tool.GetChild(this.node,"奖池面板/容器/奖池总览/各级奖池奖励设定/"+strDi) != undefined)
                {
                    strCount = Tool.GetChild(this.node,"奖池面板/容器/奖池总览/各级奖池奖励设定/"+strDi).getComponent(cc.Label).string;
                }

                
               // Tool.GetChild(this.node,"奖池面板/容器/奖池/txt").getComponent(cc.Label).string = strDi+"奖池总金额";
                Tool.GetChild(this.node,"奖池面板/容器/奖池/金额/num").getComponent(cc.Label).string = strCount;
            }
        }
        else if(param.indexOf("举报_玩家_信息")>=0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "举报成功！");                
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("获取_玩家_抽奖_信息")>=0)
        {
            if (nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];          
                let GetPlayerChoujiangInfo = data["GetPlayerChoujiangInfo"]  
                let choujiang_count = GetPlayerChoujiangInfo["choujiang_count"]
                let last_progress = GetPlayerChoujiangInfo["last_progress"]
                let all_choujiangs = GetPlayerChoujiangInfo["all_choujiangs"]

                Tool.GetChild(this.node,"转盘/信息/抽奖次数/num").getComponent(cc.Label).string = choujiang_count;
                Tool.GetChild(this.node,"转盘/信息/距离下次抽奖/num").getComponent(cc.Label).string = last_progress+"%";

                Tool.GetChild(this.node,"转盘/信息/扩展").getComponent(cc.Label).string = all_choujiangs

                //刷新进度
                Tool.GetChild(this.node,"转盘/转盘0/进度").getComponent(cc.ProgressBar).progress = Number(last_progress)/100;

                if(Number(choujiang_count)>0) //可以抽奖
                {
                    Tool.GetChild(this.node,"转盘/转盘1").active = true;
                }
                else
                {
                    Tool.GetChild(this.node,"转盘/转盘1").active = false;   
                }
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("玩家_抽奖_命令")>=0)
        {
            if (nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                let PlayerChoujiangCommand = data["PlayerChoujiangCommand"]
                let prompt = PlayerChoujiangCommand["prompt"]
                let zhongjiang_gold = PlayerChoujiangCommand["zhongjiang_gold"].toString()

               // let array = ['5888','18888','25000','28888','38888','58888'];
                
                Tool.GetChild(this.node,"转盘/转盘动画").active = true;
                this.displayZPRun.removeEventListener(dragonBones.EventObject.COMPLETE)
                this.displayZPRun.addEventListener(dragonBones.EventObject.COMPLETE,()=>{
                    Tool.GetChild(this.node,"转盘/转盘动画").active = false;
                    // Tool.GetChild(this.node,"转盘/结果动画").active = true;
                    // Tool.GetChild(this.node,"转盘/结果动画/num").getComponent(cc.Label).string = prompt;
        
                    // this.displayZP.playAnimation("animation",1);
                    // //播放声音
                    // this.gameLogic.PlayAudio2("喜金");
                    this.GetZhuanPanInfo();
                    this.GetZhuanPanList();
                },this)
                if(zhongjiang_gold == '38')
                {
                    let random = Math.floor(Math.random()*4)+1;
                    Debug.Log("随机:"+random)
                    if(random == 2)
                    {
                        random = 3
                    }
                    zhongjiang_gold = 'dhq_'+random
                }
                if(zhongjiang_gold == '888')
                {
                    let random = Math.floor(Math.random()*3)+1;
                    Debug.Log("随机888:"+random)
                    zhongjiang_gold = zhongjiang_gold+'_'+random
                }
                this.displayZPRun.playAnimation(zhongjiang_gold,1)




                // Tool.GetChild(this.node,"转盘/转盘动画").active = true;
                // this.scheduleOnce(()=>{
                //     Tool.GetChild(this.node,"转盘/转盘动画").active = false;
                //     Tool.GetChild(this.node,"转盘/结果动画").active = true;
                //     Tool.GetChild(this.node,"转盘/结果动画/num").getComponent(cc.Label).string = prompt;
        
                //     this.displayZP.playAnimation("animation",1);
                //     //播放声音
                //     this.gameLogic.PlayAudio2("喜金");
                // },3);


            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("查询_抽奖_记录")>=0)
        {
            if (nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                let GetChoujiangRec = data["GetChoujiangRec"]
                let max_winner = GetChoujiangRec["max_winner"]
                if(max_winner.length>0)
                {
                    Tool.GetChild(this.node,"转盘/信息/幸运大使/name").getComponent(cc.Label).string = max_winner[0]+'\r\n'+max_winner[3]
                    Tool.GetChild(this.node,"转盘/信息/幸运大使/gold").getComponent(cc.Label).string = max_winner[1]
                    Tool.GetChild(this.node,"转盘/信息/幸运大使/time").getComponent(cc.Label).string = max_winner[2]
                }

                let transRoot = Tool.GetChild(this.node,"转盘/信息/转盘记录列表/view/content");
                transRoot.removeAllChildren();
        
                for(let one of GetChoujiangRec["history_list"])
                {
                    cc.loader.loadRes("Prefabs/转盘记录对象",(err,obj)=>{
                        if(err)
                        {
                            cc.error(err.message || err);
                            return null;
                        }
                        let node = cc.instantiate(obj);
                        node.parent = transRoot;
                        node.getChildByName("name").getComponent(cc.Label).string = one[0].toString()+'\r\n'+one[3].toString();                        
                        node.getChildByName("gold").getComponent(cc.Label).string = one[1].toString();
                        node.getChildByName("time").getComponent(cc.Label).string = one[2].toString();
                    });
                }
            }
        }
    }
    public RewardPoolRec(strMsg:string)
    {
        let data = JSON.parse(strMsg);

        let msg = data["RewardPoolRec"];
        let arrayWin = msg["max_winner"];
        if(arrayWin.length>0)
        {
            Tool.GetChild(this.node,"奖池面板/容器/奖池记录/最大赢家/name").getComponent(cc.Label).string = arrayWin[0].toString();
            Tool.GetChild(this.node,"奖池面板/容器/奖池记录/最大赢家/type").getComponent(cc.Label).string = arrayWin[1].toString();
            Tool.GetChild(this.node,"奖池面板/容器/奖池记录/最大赢家/gold").getComponent(cc.Label).string = arrayWin[2].toString();
            Tool.GetChild(this.node,"奖池面板/容器/奖池记录/最大赢家/time").getComponent(cc.Label).string = arrayWin[3].toString();
        }

        let transRoot = Tool.GetChild(this.node,"奖池面板/容器/奖池记录/记录列表/view/content");
        transRoot.removeAllChildren();

        for(let one of msg["history_list"])
        {
            cc.loader.loadRes("Prefabs/奖池记录对象",(err,obj)=>{
                if(err)
                {
                    cc.error(err.message || err);
                    return null;
                }
                let node = cc.instantiate(obj);
                node.parent = transRoot;
                node.getChildByName("name").getComponent(cc.Label).string = one[0].toString();
                node.getChildByName("type").getComponent(cc.Label).string = one[1].toString();
                node.getChildByName("gold").getComponent(cc.Label).string = one[2].toString();
                node.getChildByName("time").getComponent(cc.Label).string = one[3].toString();
            });
        }
    
    }
    public GetZhuanPanList()
    {
        let strParam = "{\"header\":\"查询_抽奖_记录\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_抽奖_记录");
    }

    public Paipu(strMsg:string)
    {
        // Tool.GetChild(this.node,"牌局回顾/平台").getComponent(cc.Label).string = "";
        let data = JSON.parse(strMsg);
        if(data == null)
            return;
        let jList = data["Paipu"];
        let jCurCount = [0,0,0,0]

        let completShow = [];
        completShow.push(null);
        completShow.push(Tool.GetChild(this.node,"牌局回顾/文字牌谱/view/content/1/list"));
        completShow.push(Tool.GetChild(this.node,"牌局回顾/文字牌谱/view/content/2/list"));
        completShow.push(Tool.GetChild(this.node,"牌局回顾/文字牌谱/view/content/3/list"));





        for(let item of jList)
        {
            let nLun = Number(item[4]) //轮数
            let curComplet = completShow[nLun];
            if(jCurCount[nLun]>=curComplet.childrenCount)
            {
                cc.loader.loadRes("Prefabs/文字牌谱对象",(err,obj)=>{
                    if(err)
                    {
                        cc.error(err.message || err);
                        return null;
                    }
                    let node = cc.instantiate(obj);
                    node.parent = curComplet;
                    this.setPaiPuItem(node,item);
                });
            }
            else
            {
                this.setPaiPuItem(curComplet.children[jCurCount[nLun]],item);
            }
            jCurCount[nLun]++
        }

        //多余的对象全部删除
        let arrayDel = new Array<cc.Node>();
        for(let i=jCurCount[1];i<completShow[1].childrenCount;i++)
        {
            arrayDel.push(completShow[1].children[i]);
        }
        for(let item of arrayDel)
        {
            item.destroy();
        }
        arrayDel = [];
        for(let i=jCurCount[2];i<completShow[2].childrenCount;i++)
        {
            arrayDel.push(completShow[2].children[i]);
        }
        for(let item of arrayDel)
        {
            item.destroy();
        }
        for(let i=jCurCount[3];i<completShow[3].childrenCount;i++)
        {
            arrayDel.push(completShow[3].children[i]);
        }
        for(let item of arrayDel)
        {
            item.destroy();
        }

    }
    public setPaiPuItem(objNew:cc.Node,one:any)
    {
        if(objNew == undefined)
        {
            console.log('null')
        }
        objNew.active = true;
        objNew.getChildByName("name").getComponent(cc.Label).string = one[1]+'('+one[2]+')'
        let img = objNew.getChildByName("决策").getComponent(cc.Sprite);
        Tool.LoadImg(img,"other/牌谱/"+one[5]);
        objNew.getChildByName("操作").getComponent(cc.Label).string = one[6];
        objNew.getChildByName("剩余").getComponent(cc.Label).string = one[7];

        if(one[5] == '挨')
        {
            objNew.setSiblingIndex(0)
        }
    }
}
