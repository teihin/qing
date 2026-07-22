import DrhLogicMgr from "./DrhLogicMgr";
import { PlayerPos, DrhPlayerInfo, PlayerState, CardInfo } from "../common/GameDef";
import Tool from "../common/Tool";
import PKCardInfoScript from "./PKCardInfoScript";
import GameDataManager from "../GameDataManager";
import Debug from "../common/Debug";
import DrhNameManager from "./DrhNameManager";
import UIManager from "../common/UIManager";
import MobileManager from "../mobile/MobileManager";
import DaojuManager from "./DaojuManager";

var KBEngine = require("kbengine");

const {ccclass, property} = cc._decorator;

@ccclass
export default class DrhPlayerLogic extends cc.Component {

    gameLogic:DrhLogicMgr = null;
    playerPos:PlayerPos = null;

    info:DrhPlayerInfo = new DrhPlayerInfo();
    private transHand:cc.Node;    //手牌控件
    private arrayHand:PKCardInfoScript[];   //手牌组件列表
    private transHandEnd:cc.Node; //比牌是显示的手牌控件
    private transZhuang:cc.Node;
    private transOffline:cc.Node;
    private transCardUP:cc.Node;
    private transCardDown:cc.Node;
    private arrayShow:PKCardInfoScript[] = null;

    private transLightBK:cc.Node;

    //决策倒计时相关
    private transLightBKBar:cc.ProgressBar;
    private transLigtBKBlackBKBar:cc.ProgressBar;
    private txtActionTime:cc.Label;

    //扯牌倒计时相关
    private transCheTimeBar:cc.ProgressBar;
    private txtCheTime:cc.Label



    public transAnimateOut:cc.Node;  //动画显示控件
    private vcStopPos:cc.Vec2 = cc.Vec2.ZERO;
    private transPlayerInfo:cc.Node;

    //策略消息ID
    private nCaptureID = 100;    //策略编号
    private transName:cc.Node;
    private transScore:cc.Node;

    private nTableNum = 0;      //缓存的桌面分数

    public moveAction:cc.Action = null; //状态动画action
    public moveActionTar:cc.Action = null;

    // onLoad () {}

    private transOverCount:cc.Node = null; //小节分
    onLoad(){
        this.transOverCount = Tool.GetChild(this.node,"PlayerInfo/小结分");
    }
    start () {
        this.ShowHideLightBK(false);
        this.ShowHideZhuang(false);

        let move = cc.moveTo(0.3,cc.v2(0,58));
        this.moveAction = move.easing(cc.easeBounceOut());


    }

    
    // update (dt) {}
   //消息处理
   public DeelMsg(data:any)
   {
       let strEvent = data["event"].toString();
       let strState = data["state"].toString();
       let strMsg = data["msg"].toString();
       //修改状态
       this.info.strServerStatePre = this.info.strServerState;
       this.info.strServerState = strState;

       //参数解析
       this.MsgJieXi(strEvent, strMsg, data);
       this.DeelState(strState, data);
       this.ModifyNotifyTxt(this.info.strServerState,"", strMsg);

       if(this.playerPos == PlayerPos.self)
       {
           if(strState.indexOf("已经_弃牌_状态")<0)
           {
            //    if(this.arrayHand == null)
            //        this.arrayHand =  this.transHand.getComponentsInChildren(PKCardInfoScript);
                this.GetArrayHandList();
           }

           if(strState.indexOf("决策")<0 || this.info.role != "搓牌")
           {
               if(this.gameLogic.node.getChildByName("搓牌窗口").active)
                this.gameLogic.node.getChildByName("搓牌窗口").active = false;
           }
       }

       if(this.info.is_action != "True")
       {
           this.ShowCuoPaiZhong(false,false);
       }

       if (strState.indexOf("已经_弃牌_状态") < 0 && strState.indexOf("_结算_状态")<0)
       {
           if (this.arrayShow == null)
               this.arrayShow = this.node.getChildByName("展示牌").getComponentsInChildren(PKCardInfoScript);

           this.node.getChildByName("展示牌").active = false;
           
           for(let one of this.arrayShow)
           {
               one.node.active = false;;
           }
       }



       //事件分类处理
       if (strEvent == "开始_发牌_事件")
       {

       }
       else if(strEvent == "玩家_开局_事件")
       {
           //投钱入芒池
           this.ThrowGold2Mang();
       }
       else if(strEvent == "玩家_带分_事件")
       {           
           if (strMsg == "当前_玩家_消息")
           {
               this.ShowDaiRu(true);
           }
       }
       else if(strEvent == "带分_结束_事件")
       {

            //this.UpdateFenAnimate(true, this.info.beicount,true,true);
       }
       else if(strEvent == "东家_下注_事件")
       {           
           this.UpdateFenAnimate(true, this.info.beicount);
           this.ShowCurState();
       }
       else if(strEvent == "东家_自动_下注_事件")
       {
        this.UpdateFenAnimate(false, this.info.beicount);
        this.ShowCurState();
       }
       else if(strEvent == "东家_过牌_事件")
       {
           this.ShowCurState();
       }
       else if (strEvent == "大家_押完_事件")
       {
           if (strMsg == "一张_活牌_消息")
           {
               this.SetOneCardInfo(this.info.index);
           }
           if(strMsg == "当前_玩家_消息" && strState.indexOf("决策_看牌_状态")>=0)
           {
                //显示已分牌中
                this.ShowKanPaiZhong(true,true)
                Debug.Error("已显示");
           }
       }
       else if(strEvent == "倒计时_玩家_看牌_事件")
       {
            //显示已分牌中
            this.ShowKanPaiZhong(true,true)
            Debug.Error("已显示");
       }
       else if(strEvent.indexOf("强制")>=0)
       {
           if (strMsg == "一张_活牌_消息")
           {
               this.SetOneCardInfo(this.info.index);
           }
       }
       else if (strEvent == "玩家_有花_事件")
       {
           if (strMsg == "一张_活牌_消息")
           {
               this.SetOneCardInfo(this.info.index);
           }
       }
       else if (strEvent == "玩家_没花_事件")
       {
           if (strMsg == "一张_活牌_消息")
           {
               this.SetOneCardInfo(this.info.index);
           }
       }
       else if (strEvent == "玩家_看牌_事件")
       {
           if(this.playerPos == PlayerPos.self && strMsg == "持有_手牌_消息")
           {
               let strUserID = GameDataManager.getAccount().guuid;
               if (this.gameLogic.GetPlayerCtlByID(0).info.strUserID == strUserID)
               {
                   //修改手牌顺序
                   this.UpdateChePaiHand();
                   this.ShowCardType(0, Tool.GetArrayRange(this.info.handCardEx,0,2), true, 2, true);
                   this.ShowCardType(1, Tool.GetArrayRange(this.info.handCardEx,2,2), true, 2, true);
               }
               else
               {
                   this.ShowHideHandshow(false);
                   this.ShowCardType(0, null, false);
                   this.ShowCardType(1, null, false);
               } 
           }
           if(strMsg == "当前_玩家_消息")
           {
              // this.ShowKanPaiZhong(false);
           }
       }
       else if (strEvent == "获取_全量_状态_事件")
       {
           //gameLogic.transform.Find("扯牌提示").gameObject.SetActive(false);
           //发出4张手牌
           if (strMsg == "持有_手牌_消息")
           {
               if(strState.indexOf("等待_结算_状态")>0)
               {
                   if(this.playerPos == PlayerPos.self)
                   {
                       let strUserID = GameDataManager.getAccount().guuid;
                       if(this.gameLogic.GetPlayerCtlByID(0).info.strUserID == strUserID)
                       {
                           this.UpdateChePaiHand(0, false);
                           this.ShowCardType(0, Tool.GetArrayRange(this.info.handCardEx,0,2), true, 2, false);
                           this.ShowCardType(1,Tool.GetArrayRange(this.info.handCardEx,2,2), true, 2, false);
                       }
                       else
                       {
                           this.ShowHideHandshow(false);
                           this.ShowCardType(0, null, false);
                           this.ShowCardType(1, null, false);
                       }

                       if(strUserID != this.info.strUserID)
                           this.UpdateHandCard(false, false, strState.indexOf("结算_状态") < 0 ? 1 : 0);

                   }
                   else
                   {
                       this.UpdateHandCard(false, false, strState.indexOf("结算_状态") < 0 ? 1 : 0);
                   }
                //    if(this.info.is_chepai == "True")
                //        this.ShowYiKanPai(true, false);
               }
               else
               {
                   this.UpdateHandCard(false, false, strState.indexOf("结算_状态") < 0 ? 1 : 0);
               }

               if(this.info.role == "看牌" && this.info.player_setting == "True" && this.info.is_shuffled != "True")
               {
                    this.ShowCuoPaiZhong(true,false);
               }
           }
           if (strMsg == "一张_活牌_消息")
           {
               this.UpdateLastCard(false);
           }
           if (strMsg == "当前_玩家_消息")
           {
               
               this.ShowHideZhuang(this.info.bBanker);

               if(this.transPlayerInfo == null)
                this.transPlayerInfo = this.node.getChildByName("PlayerInfo");
               let bNoKan = strState.indexOf("看牌") >= 0|| strState.indexOf("结算") >= 0 ? false : true;
               
               this.ClearCoin();

               //if(strState.indexOf("弃牌_状态")<0)
                   this.UpdateFenAnimate(true, this.info.beicount, false, bNoKan);
 
               if(this.info.is_action == "True")
               {
                   this.ShowCurState(false);
                   if(this.info.role == "搓牌" && this.info.strServerState.indexOf("决策")>=0)
                   {
                       this.ShowCuoPaiZhong(true,false);
                   }
               }
               else
               {
                   if (strState.indexOf("等待_结算_状态") < 0)
                   {
                       if (strState.indexOf("已经_带分_状态") >= 0)
                           this.ShowDaiRu(true);
                       else
                           this.ShowCurState(true, false);
                   }
                //    else
                //        this.ShowYiKanPai(true, false);
               }

               if(strState.indexOf("决策_看牌_状态")>=0)
               {
                   this.ShowKanPaiZhong(true,false);
               }
               else if(strState.indexOf("等待_结算_状态")>=0)
               {
                    this.ShowKanPaiZhong(true,false);
               }
               else
               {
                   
               }
           }
       }
       else if (strEvent == "玩家_结算_事件")
       {
           if(strMsg == "持有_手牌_消息" && this.playerPos == PlayerPos.self)
           {
               if(this.info.player_over_type != "荒" && this.info.player_over_type != "弃" && this.info.player_over_type != "花")
               {
                   if(this.info.handCardEx.length >4)
                   {
                       //刷新手牌到正确顺序
                       this.UpdateChePaiHand();
                       this.ShowCardType(0, Tool.GetArrayRange(this.info.handCardEx,0,2), true, 2, false);
                       if (this.info.handCardEx.length < 4)
                       {
                           this.ShowCardType(1, null, false);
                       }
                       else
                           this.ShowCardType(1, Tool.GetArrayRange(this.info.handCardEx,2,2), true, 2, false);
                   }
               }

               this.info.emStateSave = this.info.emState; //缓存游戏结束状态

           }
           if(strMsg == "持有_手牌_消息")
           {
               if(this.info.player_over_type == "花")
               {
                   this.UpdateHandCard(false, false,  0);
                   this.node.getChildByName("三花").active = true;
               }
               else
               {
                   this.node.getChildByName("三花").active = false;
               }
           }

           if(strMsg == "结算_结束_消息")  //启动比牌
           {
               this.gameLogic.bGuanzhanFirst = false;
               this.gameLogic.StartGameCompare(this.info.game_over_type);
           }
       }
       else if(strEvent == "大家_搓完_事件")
       {

       }
       else if(strEvent == "显示_头牌_事件")
       {
           this.PlayCover12();
       }


       if(strState.indexOf("搓牌_等待")>=0&&this.info.player_setting=="True")
       {
           if(strEvent == "玩家_搓牌_事件")
           {
             this.PlayCoverLast();
           }
           else
            this.UpdateHandCard(false,false,0);
       }


   }
   public PlayCoverLast()
   {
        this.GetArrayHandList();
        //刷新所有牌
        for (let i = 0; i < this.info.handCardEx.length; i++)
        {
            let card = this.info.handCardEx[i];
            let one = this.arrayHand[i];

            let nShowCover = 0;
            if (i == 3)
                nShowCover = 1;

            one.SetCardValue(card.nType, card.nNum, this.playerPos == PlayerPos.self ? 0 : 1, nShowCover);
            //翻最后一张
            if(i == 3)
            {
                one.PlayCoverAnimate((this.playerPos == PlayerPos.self&&one.node.parent.name!="handcardlist2")?1:0.8);
            }
        }

   }

   public PlayCover12()
   {
        if(this.playerPos != PlayerPos.self)
            return;

        this.GetArrayHandList();
        //刷新所有牌
        for (let i = 0; i < this.info.handCardEx.length; i++)
        {
            let card = this.info.handCardEx[i];
            let one = this.arrayHand[i];

            let nShowCover = 0;
            if (i <2)
                nShowCover = 1;

            one.SetCardValue(card.nType, card.nNum, this.playerPos == PlayerPos.self ? 0 : 1, nShowCover);
            //翻最后一张
            if(i <2)
            {
                one.PlayCoverAnimate((this.playerPos == PlayerPos.self&&one.node.parent.name!="handcardlist2")?1:0.8);
            }
        }

   }


   //根据服务器传递的结构体名字解析对应参数
   public MsgJieXi(strEvent:string, strMsg:string, data:any)
   {
        if (strMsg == "持有_手牌_消息")
        {
            if (data.hasOwnProperty("game_over_type"))
            {
                this.info.game_over_type = data["game_over_type"].toString();
            }
            if (data.hasOwnProperty("player_over_type"))
            {
                this.info.player_over_type = data["player_over_type"].toString();
            }
            if(data.hasOwnProperty("player_setting"))
            {
                this.info.player_setting = data["player_setting"];
                //Debug.Error("搓牌开关状态:"+this.info.strUserName+":"+this.info.player_setting);
            }
            if (data.hasOwnProperty("is_shuffled"))
            {
                this.info.is_shuffled = data["is_shuffled"].toString();
                //Debug.Error("搓牌状态:"+this.info.strUserName+":"+this.info.is_shuffled);
            }
            if (data.hasOwnProperty("is_chepai"))
            {
                this.info.is_chepai = data["is_chepai"].toString();
            }

            if (data.hasOwnProperty("is_qiang_over"))
            {
                // let strUserID = GameDataManager.getAccount().guuid;
                // if (this.playerPos == PlayerPos.self && strUserID != this.info.strUserID) //观战玩家不搓牌
                // {

                // }
                // else
                // {                    
                 this.info.is_qiang_over = data["is_qiang_over"];
                // }
            }

            if (data.hasOwnProperty("now_pai"))
            {
                let now_pai = data["now_pai"];
                Tool.ClearArray(this.info.handCardEx);                
                for (let i = 0; i < now_pai.length; i++)
                {
                    let oneCard = now_pai[i];
                    let card = new CardInfo(Number(oneCard[0]), Number(oneCard[1]));
                    this.info.handCardEx.push(card);
                }
            }
            if (data.hasOwnProperty("now_pai_count"))
            {
                this.info.nHandCount = Number(data["now_pai_count"]);
            }
            if (data.hasOwnProperty("first_deal_name"))
            {
                this.info.first_deal_name = data["first_deal_name"].toString();
            }
        }
        else if (strMsg == "一张_活牌_消息") //摸的最后一张牌
        {
            if (data.hasOwnProperty("pai"))
            {
                let pai = data["pai"];
                if (pai.length > 0)
                {
                    this.info.huoCard.nType = Number(pai[0].toString());
                    this.info.huoCard.nNum = Number(pai[1].toString());
                }
            }
            if(data.hasOwnProperty("index"))
            {
                this.info.index = Number(data["index"]);
            }
        }
        else if (strMsg == "决策_信息_消息")
        {
            if (this.playerPos == PlayerPos.self) //真人才更新策略ID，其他人的不管
            {
                //策略ID更新
                this.nCaptureID++;
            }
        }
        else if (strMsg == "决策_倒计时_消息")
        {

        }
        else if (strMsg == "结算_信息_消息")
        {
            if (data.hasOwnProperty("no_used_pai"))
            {
                this.info.no_used_pai = data["no_used_pai"];
            }
            if (data.hasOwnProperty("round_score"))
            {
                this.info.round_score = data["round_score"].toString();
            }
            if (data.hasOwnProperty("table_times"))
            {
                this.info.table_times = data["table_times"].toString();
                this.info.beicount = data["table_times"].toString();
            }
            if (data.hasOwnProperty("total_score"))
            {
                this.info.nGoldNum = Number(data["total_score"]);
                this.UpdateUserBaseInfo();
            }
            if (data.hasOwnProperty("is_win"))
            {
                this.info.is_win = data["is_win"].toString();
            }
            if(data.hasOwnProperty("is_poker_win"))
            {
                this.info.is_poker_win = data["is_poker_win"].toString();
            }
            if (data.hasOwnProperty("game_over_type"))
            {
                this.info.game_over_type = data["game_over_type"].toString();
            }
            if(data.hasOwnProperty("player_over_type"))
            {
                this.info.player_over_type = data["player_over_type"].toString();
            }
            if(data.hasOwnProperty("take_pai"))
            {
                let take_pai = data["take_pai"];
                Tool.ClearArray(this.info.handSave);
                
                for (let i = 0; i < take_pai.length; i++)
                {
                    let oneCard = take_pai[i];
                    let card = new CardInfo(Number(oneCard[0]), Number(oneCard[1]));
                    this.info.handSave.push(card);
                }
            }
            if (data.hasOwnProperty("turn_pai"))
            {
                this.info.turn_pai = data["turn_pai"];

                let arrayTemp = new Array<CardInfo>();
                if(this.info.turn_pai[0].toString() == "1")
                {
                    arrayTemp.push(this.info.handSave[0]);
                }
                if (this.info.turn_pai[1].toString() == "1")
                {
                    arrayTemp.push(this.info.handSave[1]);
                }
                if (this.arrayShow == null)
                this.arrayShow = this.node.getChildByName("展示牌").getComponentsInChildren(PKCardInfoScript);
                if (arrayTemp.length==2)
                {
                    this.node.getChildByName("展示牌").active = true;
                    this.arrayShow[0].SetCardValue(arrayTemp[0].nType, arrayTemp[0].nNum, 1, 1);
                    this.arrayShow[1].SetCardValue(arrayTemp[1].nType, arrayTemp[1].nNum, 1, 1);
                    this.arrayShow[0].node.active = true;
                    this.arrayShow[1].node.active = true;
                    this.arrayShow[0].PlayCoverAnimate();
                    this.arrayShow[1].PlayCoverAnimate();

                    this.arrayHand[0].node.active = false;
                    this. arrayHand[1].node.active = false;
                }
                else if(arrayTemp.length == 1)
                {
                    this.node.getChildByName("展示牌").active = true;
                    this.arrayShow[0].SetCardValue(arrayTemp[0].nType, arrayTemp[0].nNum, 1, 1);
                    this.arrayShow[0].node.active = true;
                    this.arrayShow[1].node.active = false;
                    this.arrayShow[0].PlayCoverAnimate();
                    this.arrayHand[0].node.active = false;
                    
                }
                else
                {
                    this.node.getChildByName("展示牌").active = false;
                    this.arrayShow[1].node.active = false;
                    this.arrayShow[0].node.active = false;
                }
            }
        }
        else if (strMsg == "结算_结束_消息")
        {
            this.gameLogic.node.getChildByName("搓牌窗口").active = false;
            if (data.hasOwnProperty("is_exit"))
            {
                this.info.is_exit = data["is_exit"].toString();
                if (this.info.is_exit == "True" && this.playerPos == PlayerPos.self)
                {
                    
                }

            }
            if (data.hasOwnProperty("game_over_type"))
            {
                this.info.game_over_type = data["game_over_type"].toString();
            }
            if (data.hasOwnProperty("player_over_type"))
            {
                this.info.player_over_type = data["player_over_type"].toString();
            }
            if (data.hasOwnProperty("money_score"))
            {
                this.info.nGoldNum = Number(data["money_score"]);
                this.UpdateUserBaseInfo();
            }
        }
        else if (strMsg == "当前_玩家_消息")
        {            
            if(data.hasOwnProperty("is_show_tou_pai")) //是否能看第一二张牌
            {
                this.info.is_show_tou_pai = data["is_show_tou_pai"]
            }
            if (data.hasOwnProperty("is_zhuang"))
            {
                this.info.bBanker = data["is_zhuang"] == "True" ? true : false;

                this.ShowHideZhuang(this.info.bBanker);
            }
            if(data.hasOwnProperty("fapai_info"))
            {
                this.info.fapai_info = data ["fapai_info"];
                let strState = data["state"].toString();
                //if (strEvent.indexOf("全量")<0 && strState.indexOf("决策")>=0)
                //{
                //    StopCoroutine("DelayCheckCard");
                //    StartCoroutine("DelayCheckCard");
                //}

            }
            if(data.hasOwnProperty("total_reward_money"))
            {
                if(this.info.bBanker)
                {
                    this.gameLogic.UpdateCurJiangChi(data["total_reward_money"].toString());
                }
            }

            if(data.hasOwnProperty("turn_pai"))
            {
                this.info.turn_pai = data["turn_pai"].toString();
                if(this.playerPos == PlayerPos.self)
                {
                    if (this.info.turn_pai == "")
                        this.info.turn_pai = "00"; 

                    // if(this.arrayHand == null)
                    //     this.arrayHand = this.transHand.getComponentsInChildren(PKCardInfoScript);
                    this.GetArrayHandList();
                    if(this.info.strUserID == GameDataManager.getAccount().guuid)
                    {
                        if (this.info.turn_pai[0].toString() == "0")
                        {
                            Tool.GetChild(this.arrayHand[0].node,"秀牌/眼睛").active = false;                        
                        }
                        else
                        {
                            Tool.GetChild(this.arrayHand[0].node,"秀牌/眼睛").active = true;
                        }
                        if(this.info.turn_pai[1].toString() == "0")
                        {
                            Tool.GetChild(this.arrayHand[1].node,"秀牌/眼睛").active = false;
                        }
                        else
                        {
                            Tool.GetChild(this.arrayHand[1].node,"秀牌/眼睛").active = true;
                        }
                    }

                }
            }


            if(data.hasOwnProperty("count_times"))
            {
            
                
            }
            if(data.hasOwnProperty("round_counttimes_money"))
            {
                this.info.count_times = data["round_counttimes_money"].toString();

                if (this.playerPos == PlayerPos.self)
                {

                    if (this.playerPos == PlayerPos.self)
                    {
                        let strUserID = GameDataManager.getAccount().guuid;
                        if (this.gameLogic.GetPlayerCtlByID(0).info.strUserID == strUserID && Number(this.info.count_times)>=0)
                            this.node.getChildByName("延时").active = true;
                        else
                            this.node.getChildByName("延时").active = false;
                    }
                    else
                    {
                        this.node.getChildByName("延时").active = false;
                    }
                }
            }

            if (data.hasOwnProperty("game_end_time"))
            {
                this.gameLogic.game_end_time = data["game_end_time"];
            }

            if (data.hasOwnProperty("table_times"))
            {
                this.info.table_times = data["table_times"].toString();
                this.nTableNum = Number(data["table_times"]);
            }
            if(data.hasOwnProperty("all_bei_shu")) //当前底分
            {
                this.info.table_times = data["all_bei_shu"].toString();
                this.UpdateDiFenShow(true);
            }
            if(data.hasOwnProperty("bei_shu_unit")) //显示可下分列表
            {
                this.info.bei_shu_unit = data["bei_shu_unit"].toString();
            }
            if (data.hasOwnProperty("bei_shu_max")) //显示可下分列表
            {
                this.info.bei_shu_max = data["bei_shu_max"].toString();
            }
            if (data.hasOwnProperty("bj_score"))
            {
                this.info.bj_score = data["bj_score"].toString();
                //UpdateUserBaseInfo();
            }
            if (data.hasOwnProperty("gold"))
            {
                //info.nGoldNum = Convert.ToInt32(temp.toString()); 
            }

            if(data.hasOwnProperty("min_bj"))
            {
                this.info.begin_score = data["min_bj"].toString();
            }
            if (data.hasOwnProperty("init_money"))   //新版本修复上面 min_bj带入错误，同时兼容老版本
            {
                this.info.begin_score = data["init_money"].toString();
            }
            if (data.hasOwnProperty("max_bj"))
            {
                this.info.take_all_score = data["max_bj"].toString();
            }
            if(data.hasOwnProperty("min_score"))
            {
                this.info.min_score = data["min_score"].toString();
            }
            if(data.hasOwnProperty("bei_shu_type"))
            {
                this.info.bei_shu_type = data["bei_shu_type"];
                if(this.info.bei_shu_type != "-3")
                {
                    Tool.GetChild(this.node,"PlayerInfo/Head/敲").active = false;
                }
            }
            if(data.hasOwnProperty("money_score"))
            {
                this.info.nGoldNum = Number(data["money_score"]);
                this.UpdateUserBaseInfo();
            }
            if(data.hasOwnProperty("gen_score"))
            {
                this.info.gen_score = data["gen_score"].toString();
            }
            if(data.hasOwnProperty("mang_pi_times"))
            {
                this.info.mang_pi_times = data["mang_pi_times"].toString();
            }
            if(data.hasOwnProperty("xiu_mang_times"))
            {
                this.info.xiu_mang_times = data["xiu_mang_times"].toString();
                
            }
            if(data.hasOwnProperty("xiu_mang_count"))
            {
                this.info.xiu_mang_count = data["xiu_mang_count"].toString();
                this.UpdateMangpiXiumang();
            }
            if(data.hasOwnProperty("last_add_xiazhu_score"))
            {
                this.info.last_add_xiazhu_score = data["last_add_xiazhu_score"].toString();

            }
            if(data.hasOwnProperty("player_setting"))
            {
                this.info.player_setting = data["player_setting"];
                //Debug.Error("搓牌开关状态:"+this.info.strUserName+":"+this.info.player_setting);
            }
            if (data.hasOwnProperty("is_qiang_over"))
            {
                // let strUserID = GameDataManager.getAccount().guuid;
                // if (this.playerPos == PlayerPos.self && strUserID != this.info.strUserID) //观战玩家不搓牌
                // {

                // }
                // else
                // {

                 this.info.is_qiang_over = data["is_qiang_over"].toString();
                // }
            }
            
            if (data.hasOwnProperty("is_shuffled"))
            {
                this.info.is_shuffled = data["is_shuffled"].toString();
                //Debug.Error("搓牌状态:"+this.info.strUserName+":"+this.info.is_shuffled);
            }

            if (data.hasOwnProperty("proxy_countdown"))
            {
                this.info.strCurCountDown = data["proxy_countdown"].toString();
            }
            if (data.hasOwnProperty("proxy_allcount"))
            {
                this.info.strCountDownAll = data["proxy_allcount"].toString();
            }

            if (data.hasOwnProperty("role"))
            {
                this.info.role = data["role"].toString();
                let  strState:string = data["state"].toString();

                if (this.info.role == "带分")
                {
                    this.ShowCmdPad(true, 4, strEvent.indexOf("全量") < 0?true:false);
                }
                else if(this.info.role == "搓牌")
                {
                    if (strEvent.indexOf("全量")<0)
                    {
                        if(this.info.is_action == "True" && this.info.strServerState.indexOf("决策")>=0)
                        {
                            this.DelayShowCuo(1);
                        }
                    }
                    else{
                        if(this.info.is_action == "True" && this.info.strServerState.indexOf("决策")>=0)
                        {
                            this.DelayShowCuo(0.2);
                        }
                    }
                }
                else if (this.info.role == "看牌")
                {
                    if (strEvent.indexOf("全量")<0)
                    {
                        //有敲，并且打开了搓牌开关才搓牌
                        // if(this.info.is_qiang_over == "True" && this.info.player_setting === "True")
                        // {
                        //     this.DelayShowCuo(1);                            
                        // }
                        // else
                        {
                            this.DelayShowCmd(2);                     
                        }
                        
                    }
                    else
                    {
                        if(this.info.is_shuffled == "True")
                        {
                            this.ShowCmdPad(true, 2);

                            if (this.playerPos == PlayerPos.self)
                            {
                                if (strState.indexOf("等待_结算_状态") < 0)
                                    this.ShowHideHandshow(false);
                                let strUserID = GameDataManager.getAccount().guuid;
                                if(strUserID == this.info.strUserID)
                                    this.transHand.opacity = 0;
                            }
                        }
                        else
                        {
                            // if(this.info.is_qiang_over == "True" && this.info.player_setting === "True")
                            // {
                            //     this.DelayShowCuo(0.2);  
                            // }          
                            if(this.info.player_setting != "True")                
                            {
                                this.ShowCmdPad(true, 2);
                            }
                        }


                    }
                    
                }
                else if(this.info.role == "敲牌")
                {
                    //if (strEvent.indexOf("全量") >= 0)
                        this.ShowCmdPad(true, 5, strEvent.indexOf("全量") >= 0?false:true);
                }
                if(strState.indexOf("决策") > 0 && this.info.role.length == 6 && this.info.role != "")
                {
                    //if(strEvent != "大家_押完_事件" && strEvent != "带分_结束_事件")
                    if (strEvent.indexOf("全量") >= 0)
                        this.ShowCmdPad(true, 1,false);
                    if (strEvent == "上家_已押_事件" || strEvent == "大家_搓完_事件")
                    {
                        this.ShowCmdPad(true, 1);
                    }
                }
                if(strState == "东家_决策_第一次_下注_状态")
                {
                    
                }
                if (strState.indexOf("决策") < 0)
                {

                    this.ShowCmdPad(false, 0);
                    
                }
                
                if(strState.indexOf("看牌")>=0)
                {
                    Tool.GetChild(this.node,"PlayerInfo/Head/敲").active = false;                    
                }

            }

            if (data.hasOwnProperty("is_action"))
            {
                this.info.is_action = data["is_action"].toString();
                if (this.info.is_action == "True")
                {
                    this.ShowHideLightBK(true);
                }
                else
                {
                    this.ShowHideLightBK(false);
                }
            }

            if(data.hasOwnProperty("take"))
            {
                let strState:string = data["state"].toString();
                this.info.take = data["take"].toString();
                if (strState.indexOf("决策") < 0)
                {
                    if (this.info.take == "无")
                    {
                        this.ShowCmdPad(false, 0);
                    }
                    else
                    {
                        if(strEvent.indexOf("全量") >= 0)
                        {
                            this.ShowCmdPad(true, 3,false);
                        }
                        else
                        {
                            
                            this.scheduleOnce(()=>{
                                if (this.info.strServerState.indexOf("决策") < 0)
                                {
                                    if (this.info.take == "无")
                                    {
                                        this.ShowCmdPad(false, 0);
                                    }
                                    else
                                    {
                                        this.ShowCmdPad(true, 3, true);
                                    }
                                }
                            },0.5);                       
                        }
                        
                    }
                }

                if(strState.indexOf("决策")>=0 && this.info.role == "" && this.info.take == "无")
                {
                    this.ShowCmdPad(false, 0);
                }


            }



 
            if (data.hasOwnProperty("bei_shu"))
            {
                this.info.beicount = data["bei_shu"].toString();
                this.UpdatePlayerTotleFen();
            }
            if(data.hasOwnProperty("one_bei_shu"))
            {
                this.info.one_bei_shu = Number(data["one_bei_shu"]);
            }
            if (data.hasOwnProperty("is_proxy"))
            {
                this.info.is_proxy = data["is_proxy"].toString();

            }
            //本局自己是否切牌
            if(data.hasOwnProperty("is_qiepai"))
            {
                this.info.is_qiepai = data["is_qiepai"].toString();
                

                let strUserID = GameDataManager.getAccount().guuid;
                if (this.playerPos == PlayerPos.self)
                {
                    if(this.info.strUserID == strUserID)
                    {
                        Tool.GetChild(this.gameLogic.node,"RoomFrame/切牌").active = true;
                        
                        if (this.info.is_qiepai == "True")
                        {
                            Tool.GetChild(this.gameLogic.node,"RoomFrame/切牌").getComponent(cc.Button).interactable = false;                            
                        }
                        else
                        {
                            Tool.GetChild(this.gameLogic.node,"RoomFrame/切牌").getComponent(cc.Button).interactable = true;                            
                        }
                    }
                    else
                    {
                        Tool.GetChild(this.gameLogic.node,"RoomFrame/切牌").active = false;                        
                    }

                }
            }

        }
        else if(strMsg == "玩家_切牌_消息")
        {
            //本局自己是否切牌
            if (data.hasOwnProperty("is_qiepai"))
            {
                this.info.is_qiepai = data["is_qiepai"].toString();
                if (this.playerPos == PlayerPos.self)
                {
                    if (this.info.is_qiepai == "True")
                    {
                        Tool.GetChild(this.gameLogic.node,"RoomFrame/切牌").getComponent(cc.Button).interactable = false;
                        
                    }
                    else
                    {
                        Tool.GetChild(this.gameLogic.node,"RoomFrame/切牌").getComponent(cc.Button).interactable = true;
                        
                    }
                }
            }
        }

        else if(strMsg == "发牌_结束_消息")
        {             
            if(data.hasOwnProperty("qiepai_status")) //本局切牌状态
            {
                this.info.qiepai_status = data["qiepai_status"].toString();
            }


            if(data.hasOwnProperty("is_qiang_over"))
            {
                // let strUserID = GameDataManager.getAccount().guuid;
                // if (this.playerPos == PlayerPos.self && strUserID != this.info.strUserID) //观战玩家不搓牌
                // {

                // }
                // else
                // {
                    
                this.info.is_qiang_over = data["is_qiang_over"].toString();
                // }
            }
            if(data.hasOwnProperty("all_start_player_name"))
            {
                if(data["all_start_player_name"].length>0)
                    this.info.all_start_player_name = JSON.stringify(data["all_start_player_name"]);
            }

            if(data.hasOwnProperty("pai_number"))
            {
                //Debug.Error("发牌结束隐藏！");
                //Tool.GetChild(this.node,"PlayerInfo/小结分").active = false;
                this.transOverCount.active = false;
                let jList = data["pai_number"];
                let arrayGet = new Array<number>();
                for(let i=0;i<jList.length;i++)
                {
                    arrayGet.push(Number(jList[i].toString()));
                }
                if(arrayGet[0] == 0)
                {
                    //检测是否有人切牌， 如果有则先动画
                    if(this.info.qiepai_status == "self" || this.info.qiepai_status == "other")
                        //    StartCoroutine(DelayThrowFirstCard(arrayGet,true));
                        this.DelayThrowFirstCard(arrayGet,true);
                    else
                        //StartCoroutine(DelayThrowFirstCard(arrayGet, false));
                        this.DelayThrowFirstCard(arrayGet,false);
                }
                else
                {
                    this.gameLogic.ThrowCard2Player(this, arrayGet);
                }
                
            }
        }
   }
   

   public DeelState(strState:string, data:any)
   {
       let strEvent = data["event"].toString();
       if(strState.indexOf("带分_状态")>=0 || strState.indexOf("等待_结算") >= 0)
       {
           //带分需要隐藏手牌
           this.GetTransHand();//Tool.GetChild(this.node,"handstop/handcardlist");
           let strUserID = GameDataManager.getAccount().guuid;
           if (this.playerPos == PlayerPos.self && strEvent != "玩家_流局_事件" && this.info.strUserID == strUserID)
               this.transHand.opacity = 0;
       }
   }

   public ModifyNotifyTxt(strState:string,strEvent:string = "",strMsg:string = "")
    {
        if (strState.indexOf("弃牌") >= 0)
        {
            this.ModifyNodeOp(170);
            if (this.playerPos != PlayerPos.self)
            {
                this.GetTransHand();//Tool.GetChild(this.node,"handstop/handcardlist");
                this.transHand.opacity = 0;
                
            }
        }
        else
        {
            this.ModifyNodeOp(255);
        }
        
        this.UpdateDiuLeftCard(strMsg);

        if (strState.indexOf("看牌") < 0 && strState.indexOf("结算") < 0)
        {
            this.ShowHideHandshow(false);
            this.ShowCardType(0, null, false);
            this.ShowCardType(1, null, false);
        }

        this.GetTransHand();//Tool.GetChild(this.node,"handstop/handcardlist");
        this.transHand.position = cc.Vec2.ZERO;
    }




    //更新用户信息
    UpdateUserInfo()
    {
        if(this.info.strUserID == "init")
        {
            this.node.active = false;
            return;
        }
        else
        {
            this.node.active = true;
            Tool.GetChild(this.node,"PlayerInfo/name").getComponent(cc.Label).string = this.info.strUserName;
            Tool.GetChild(this.node,"PlayerInfo/score").getComponent(cc.Label).string = this.info.nGoldNum.toString();
            //显示留坐
            if (this.info.site_countdown != "0" && this.info.site_countdown != "")
            {
                Tool.GetChild(this.node,"handstop/丢牌余牌").active = false;
                Tool.GetChild(this.node,"PlayerInfo/Head/留坐").active = true;
                //启动留坐倒计时定时器
                this.unschedule(this.showLiuZuoCount);
                this.schedule(this.showLiuZuoCount,1,cc.macro.REPEAT_FOREVER,0.1);

                this.ShowCmdPad(false, 0);
                let strUserID = GameDataManager.getAccount().guuid;
                //只有自己能回坐
                if (this.playerPos == PlayerPos.self && this.info.strUserID == strUserID)
                {
                    Tool.GetChild(this.node,"PlayerInfo/回坐").active = true;
                }
                this.node.getChildByName("展示牌").active = false;
                if(this.arrayShow === null)
                {
                    this.arrayShow = this.node.getChildByName("展示牌").getComponentsInChildren(PKCardInfoScript);
                }
                this.arrayShow.forEach((item,idx,array)=>{
                    if(item.node.active)
                        item.node.active = false;
                },this);
                this.info.round_score = " , , , , ";
                this.UpdateRoundScore(false);
                this.GetTransHand();//Tool.GetChild(this.node,"handstop/handcardlist");
                this.transHand.opacity = 0;
                this.ShowHideHandshow(false);
                Tool.GetChild(this.node,"PlayerInfo/Head/敲").active = false;
                this.ModifyNodeOp(255);
                

                this.ClearCoin(true);

                if (this.info.emState == PlayerState.offline)
                    this.ShowHideOffline(true);
                else
                    this.ShowHideOffline(false);

                
                this.ShowHideZhuang(false);
                Tool.GetChild(this.node,"PlayerInfo/扩展状态").active = false;
                Tool.GetChild(this.node,"PlayerInfo/animateOut").opacity = 0;
                //Tool.GetChild(this.node,"PlayerInfo/小结分").active = false;           
                this.transOverCount.active = false;

                this.node.getChildByName("三花").active = false;
                return;
            }
            else
            {
                this.unschedule(this.showLiuZuoCount);

                Tool.GetChild(this.node,"PlayerInfo/Head/留坐").active = false;
                if(this.playerPos === PlayerPos.self)
                    Tool.GetChild(this.node,"PlayerInfo/回坐").active = false;
            }

            if(this.info.strServerState.indexOf("看牌")<0&&this.info.strServerState.indexOf("结算")<0)
            {
                this.ShowHideHandshow(false);
                this.ShowCardType(0, null, false);
                this.ShowCardType(1, null, false);
            }

            if (this.gameLogic.strGameState == "init")
            {

                this.ShowHideZhuang(false);
                this.UpdateDiFenShow(false);
                this.UpdateRoundScore(false);
                Tool.GetChild(this.node,"PlayerInfo/Head/敲").active = false;                
            }
            else if(this.gameLogic.strGameState == "ready")
            {

                this.info.round_score = " , , , , ";
                this.UpdateDiFenShow(false);
                this.UpdateRoundScore(false);
                this.GetTransHand();//Tool.GetChild(this.node,"handstop/handcardlist");
                this.transHand.opacity = 0;
                this.ShowHideHandshow(false);
                Tool.GetChild(this.node,"PlayerInfo/Head/敲").active = false;
                Tool.GetChild(this.node,"handstop/丢牌余牌").active = false;
            }


            if(this.gameLogic.strGameState == "running")
            {
                //Debug.Error("关闭小机房！！！");
                //Tool.GetChild(this.node,"PlayerInfo/小结分").active = false;
                this.transOverCount.active = false;
                Tool.GetChild(this.node,"三花").active = false;

                Tool.GetChild(this.gameLogic.node,"cmd6").active = false;
                
                if (this.arrayShow == null)
                   this.arrayShow = this.node.getChildByName("展示牌").getComponentsInChildren(PKCardInfoScript);
                


                this.node.getChildByName("展示牌").active = false;
                this.arrayShow.forEach((one,idx,array)=>{
                    if(one.node.active)
                        one.node.active = false;
                },this);



                if (this.info.emState == PlayerState.leave)
                {
                    this.ModifyNodeOp(255);
                    Tool.GetChild(this.node,"PlayerInfo/扩展状态").active = true;
                    Tool.LoadImg(Tool.GetChild(this.node,"PlayerInfo/扩展状态").getComponent(cc.Sprite),"other/观众");
                    Tool.GetChild(this.node,"PlayerInfo/animateOut").opacity = 0;

                    this.ShowHideZhuang(false,true);

                    Tool.GetChild(this.node,"handstop/丢牌余牌").active = false;
                }
                else if (this.info.emState == PlayerState.init)
                {
                    this.ModifyNodeOp(255);
                    Tool.GetChild(this.node,"PlayerInfo/扩展状态").active = true;
                    Tool.LoadImg(Tool.GetChild(this.node,"PlayerInfo/扩展状态").getComponent(cc.Sprite),"other/观战");
                    Tool.GetChild(this.node,"PlayerInfo/animateOut").opacity = 0;

                    this.ShowHideZhuang(false);
                    Tool.GetChild(this.node,"handstop/丢牌余牌").active = false;
                }
                else
                {
                    Tool.GetChild(this.node,"PlayerInfo/扩展状态").active = false;
                }
            }
            else
            {
                Tool.GetChild(this.node,"PlayerInfo/扩展状态").active = false;                
            }



            if (this.info.emState == PlayerState.leave)
            {
                this.ShowCmdPad(false, 0);
                this.info.beicount = "";
                
                this.ClearCoin(true);
                this.GetTransHand();//Tool.GetChild(this.node,"handstop/handcardlist"); 
                this.transHand.opacity = 0;

                this.ShowHideZhuang(false,true);
                this.ShowHidePrepare();
                this.ShowHideHandshow(false);
                this.ShowCardType(0, null, false);
                this.ShowCardType(1, null, false);
                //Tool.GetChild(this.node,"PlayerInfo/小结分").active = false;             
                this.transOverCount.active = false;
                Tool.GetChild(this.node,"三花").active = false;
                Tool.GetChild(this.node,"PlayerInfo/Head/敲").active = false;
                return;
            }



            if (this.info.emState == PlayerState.init)
            {                
                this.ShowCmdPad(false, 0);
                this.info.beicount = "";
                
                this.ClearCoin();

                this.GetTransHand();//Tool.GetChild(this.node,"handstop/handcardlist");

                if(this.gameLogic.round_count == "0")
                {
                    this.transHand.opacity = 0;
                    this.ShowHideHandshow(false);
                    this.ShowCardType(0, null, false);
                    this.ShowCardType(1, null, false);
                }


                if (this.gameLogic.strGameState == "running")
                {
                    this.ShowHideHandshow(false);
                    this.ShowCardType(0, null, false);
                    this.ShowCardType(1, null, false);
                    //
                }
                
            }
            else
            {
                
            }
            if (this.info.emState == PlayerState.ready)
            {

                this.ShowHideZhuang(false);
                this.info.beicount = "";
                
                this.ClearCoin();                
                this.GetTransHand();//Tool.GetChild(this.node,"handstop/handcardlist");
                if (this.gameLogic.round_count == "0")
                {
                    this.transHand.opacity = 0;
                    this.ShowHideHandshow(false);
                }
                this.ShowCardType(0, null, false);
                this.ShowCardType(1, null, false);
            }

            //显示隐藏准备
            this.ShowHidePrepare();

            if (this.info.emState == PlayerState.offline)
                this.ShowHideOffline(true);
            else
            {
                if (this.info.strDeadState == "True")
                    this.ShowHideOffline(true);
                else
                    this.ShowHideOffline(false);

            }


            if ((this.info.bClone && this.info.emState == PlayerState.init) || (this.info.bClone && this.info.emState == PlayerState.ready)) //下一局的等待准备状态不用刷新之前内容
            {
                this.GetTransHand();//Tool.GetChild(this.node,"handstop/handcardlist");
                if (this.gameLogic.round_count == "0")
                    this.transHand.opacity = 0;
                this.ShowCmdPad(false, 0);

                this.ModifyNodeOp(255);               
                return;
            }



            if (this.info.emState == PlayerState.ready || this.info.emState == PlayerState.init)
            {
                this.GetTransHand();//Tool.GetChild(this.node,"handstop/handcardlist");
                this.transHand.opacity = 0;
                //所有手牌显示背面
                this.ResetHandCard();
            }
        }
    }
    showLiuZuoCount()
    {
        this.GetTransHand();//Tool.GetChild(this.node,"handstop/handcardlist");
        if(this.transHandEnd === null)
            this.transHandEnd = Tool.GetChild(this.node,"handstop/handshow");

        let nCount = Number(this.info.site_countdown);
        if(nCount>=0)
        {
            Tool.GetChild(this.node,"PlayerInfo/Head/留坐/time").getComponent(cc.Label).string = nCount.toString();
            if (this.info.emState == PlayerState.init || this.info.emState == PlayerState.leave || this.info.emState == PlayerState.ready || this.info.site_countdown != "0")
            {
                if(this.transHand.opacity = 255)
                    this.transHand.opacity = 0;
                if(this.transHandEnd.active)
                    this.transHandEnd.active = false;


                this.ShowHideZhuang(false,true);
            }
            this.info.site_countdown = (Number(this.info.site_countdown)-1).toString();
        }
        else
        {
            Tool.GetChild(this.node,"PlayerInfo/Head/留坐").active = false;
            if(this.playerPos === PlayerPos.self)
            {
                Tool.GetChild(this.node,"PlayerInfo/回坐").active = false;
            }
            //停止任务
            this.unschedule(this.showLiuZuoCount);
        }
    }
    ShowHideZhuang(bShow:boolean = true,bFouce:boolean = false)
    {
        if (bShow == false && this.info.bBanker && !bFouce && (this.info.strServerState.indexOf("带分_状态") >= 0 || this.info.strServerState.indexOf("押牌_状态") >= 0 || this.info.strServerState.indexOf("下注_状态") >= 0))
        {
            return;
        }

        if (bShow == false)
        {
            if (bShow == false && this.info.bBanker && !bFouce)
            {
                return;
            }
        }
        if (this.transZhuang == null)
            this.transZhuang = Tool.GetChild(this.node,"PlayerInfo/zhuang");
        this.transZhuang.active = bShow;
    }

    ShowCmdPad(bShow:boolean, nType:number, bAnimate:boolean = true)
    {
        let strUserID:string = GameDataManager.getAccount().guuid;

        if(this.info.bBanker)
        {            
            this.gameLogic.node.getChildByName("cmd6").active = false;
        }

        if (this.playerPos != PlayerPos.self && this.info.strUserID != strUserID)
            return;

        if (this.info.strUserID != strUserID)
            return;
        
        
       // this.node.getChildByName("下一张牌").active = false;
        
        let transCmd1 = this.gameLogic.node.getChildByName("cmd1");     //下注
        let transCmd2 = this.gameLogic.node.getChildByName("cmd2");     //扯牌
        let transCmd3 = this.gameLogic.node.getChildByName("cmd3");     //自动操作
        
        let transCmd5 = this.gameLogic.node.getChildByName("cmd5");     //积分带入
        let transCmd6 = this.gameLogic.node.getChildByName("cmd6");     
        let transCmdCuo7 = this.gameLogic.node.getChildByName("搓牌窗口");



        if (bShow)
        {
            if(bAnimate)
            {
                for(let one of transCmd1.children)
                {
                    one.stopAllActions();
                }
                for(let one of transCmd3.children)
                {
                    one.stopAllActions();
                }
                for(let one of transCmd5.children)
                {
                    one.stopAllActions();
                }
            }

            //动态调整下调用的type ，如果是搓牌 
            if(this.info.role == "搓牌")
            {
                nType = 7;
            }


            if(nType == 3)
            this.node.getChildByName("延时").active = false;

            if (nType == 1)
            {
                if (this.info.role == "敲牌")
                    return;

                this.PlayAudio(0,"提醒");

                transCmd1.active = true;
                transCmd2.active = false;
                transCmd3.active = false;
                
                transCmd5.active = false;
                transCmd6.active = false;
                transCmdCuo7.active = false;

                if (this.info.role.length>=6)
                {
                    let str1 = this.info.role.substr(0, 1);
                    let str2 = this.info.role.substr(1, 1);
                    let str3 = this.info.role.substr(2, 1);
                    let str4 = this.info.role.substr(3, 1);
                    let str5 = this.info.role.substr(4, 1);
                    let str6 = this.info.role.substr(5, 1);

                    let transDD = transCmd1.getChildByName("丢");
                    let transX = transCmd1.getChildByName("休");
                    let transQ = transCmd1.getChildByName("敲");
                    let transD = transCmd1.getChildByName("大");
                    let transG = transCmd1.getChildByName("跟");

                    this.SetCmdBtnState(transCmd1.getChildByName("丢"), "丢" + str1);
                    this.SetCmdBtnState(transCmd1.getChildByName("休"), "休" + str2);

                    if(str4 == "不" && str3 != "不")
                    {
                        transCmd1.getChildByName("敲").active = true;
                    }
                    else
                    {
                        transCmd1.getChildByName("敲").active = false;
                    }
                    
                    this.SetCmdBtnState(transCmd1.getChildByName("大"), "大" + str4);
                    this.SetCmdBtnState(transCmd1.getChildByName("跟"), "跟" + str5);
                    //this.SetCmdBtnState(transCmd1.getChildByName("滚"), "滚" + str6);

                    //特殊处理跟
                    if (str5 == "跟")
                    {                        
                        Tool.GetChild(transCmd1,"跟/num").getComponent(cc.Label).string = this.CheckSmallPlay(this.info.gen_score);
                    }
                    else
                    {                        
                        Tool.GetChild(transCmd1,"跟/num").getComponent(cc.Label).string = "";
                    }

                    
                   // Tool.GetChild(transCmd1,"敲/num").getComponent(cc.Label).string = this.CheckSmallPlay( this.info.nGoldNum.toString());

                    if (bAnimate)
                    {
                        transDD.position =  cc.Vec2.ZERO;
                        transX.position = cc.Vec2.ZERO;
                        transD.position = cc.Vec2.ZERO;
                        transG.position = cc.Vec2.ZERO;
                        transQ.position = cc.Vec2.ZERO;

                        let actionDD = cc.moveTo(0.2,cc.v2(-131,0));
                        //actionDD.easing(cc.easeElasticOut(3.0));
                        transDD.runAction(actionDD);

                        let actionX = cc.moveTo(0.2,cc.v2(131,0));
                        //actionX.easing(cc.easeElasticOut(3.0));
                        transX.runAction(actionX);

                        let actionD = cc.moveTo(0.2,cc.v2(0,150));
                        //actionD.easing(cc.easeElasticOut(3.0));
                        transD.runAction(actionD);

                        let actionG = cc.moveTo(0.2,cc.v2(131,0));
                        //actionG.easing(cc.easeElasticOut(3.0));
                        transG.runAction(actionG);

                        let actionQ = cc.moveTo(0.2,cc.v2(0,150));
                        //actionQ.easing(cc.easeElasticOut(3.0));
                        transQ.runAction(actionQ);


                    }
                    else
                    {
                        transDD.position = cc.v2(-131,0);
                        transX.position = cc.v2(131,0);
                        transD.position = cc.v2(0,150);
                        transG.position = cc.v2(131,0);
                        transQ.position = cc.v2(0,150);
                    }

                    let allBei = this.info.bei_shu_unit.split(',');

                    //设置快捷下注
                    let nDi = Number(this.info.table_times);
                    let nHalf = nDi / 2;
                    let nBei = nDi * 2;

                    Tool.GetChild(transCmd1,"底池1/num").getComponent(cc.Label).string = this.CheckSmallPlay(allBei[0].trim());
                    Tool.GetChild(transCmd1,"底池2/num").getComponent(cc.Label).string = this.CheckSmallPlay(allBei[1].trim());
                    Tool.GetChild(transCmd1,"底池3/num").getComponent(cc.Label).string = this.CheckSmallPlay(allBei[2].trim());



                    let strSet:string = GameDataManager.getAccount().roomSetting;
                    let nMinLimi = 0;
                    if(strSet.indexOf("滚滚翻")>=0)
                    {
                        nMinLimi = (Number(this.info.beicount) + Number(this.info.gen_score))*2;
                    }


                    //有效性校验
                    if (this.info.nGoldNum < (Number(allBei[0])-Number(this.info.beicount)) || str4 == "不")
                    {
                        transCmd1.getChildByName("底池1").opacity = 100;
                        transCmd1.getChildByName("底池1").getComponent(cc.Button).interactable = false;
                    }
                    else
                    {
                        transCmd1.getChildByName("底池1").opacity = 255;
                        transCmd1.getChildByName("底池1").getComponent(cc.Button).interactable = true;
                    }
                    if (this.info.nGoldNum < (Number(allBei[1]) - Number(this.info.beicount)) || str4 == "不")
                    {
                        transCmd1.getChildByName("底池2").opacity = 100;
                        transCmd1.getChildByName("底池2").getComponent(cc.Button).interactable = false;
                    }
                    else
                    {
                        transCmd1.getChildByName("底池2").opacity = 255;
                        transCmd1.getChildByName("底池2").getComponent(cc.Button).interactable = true;
                    }
                    if (this.info.nGoldNum < (Number(allBei[2]) - Number(this.info.beicount)) || str4 == "不")
                    {
                        transCmd1.getChildByName("底池3").opacity = 100;
                        transCmd1.getChildByName("底池3").getComponent(cc.Button).interactable = false;
                    }
                    else
                    {
                        transCmd1.getChildByName("底池3").opacity = 255;
                        transCmd1.getChildByName("底池3").getComponent(cc.Button).interactable = true;
                    }
                }
                else
                {
                    Debug.Log("角色不全！！！");
                }


            }
            else if (nType == 2)
            {
                transCmd1.active = false;
                transCmd2.active = true;
                transCmd3.active = false;
                
                transCmd5.active = false;
                transCmd6.active = false;
                transCmdCuo7.active = false;

                if(this.info.strServerState == "旁家_等待_结算_状态")
                {
                    transCmd2.active = false;
                    return;
                }
                transCmd2.opacity = 0;
                //设置扯牌数据
                let arrayTar = transCmd2.getChildByName("目标").getComponentsInChildren(PKCardInfoScript);
                let arraySrc = transCmd2.getChildByName("手牌").getComponentsInChildren(PKCardInfoScript);
                arrayTar.forEach((one,idx,array)=>{
                    one.SetCardValue(0, 0, 0, 1);
                    one.node.active = false;
                },this);

                for(let i=0;i<this.info.handCardEx.length;i++)
                {
                    let card  = this.info.handCardEx[i];
                    let one = arraySrc[i];
                    one.SetCardValue(card.nType, card.nNum, 0 , 0);
                }

                transCmd2.getChildByName("牌型1").active = false;
                transCmd2.getChildByName("牌型2").active = false;


                //需要隐藏手牌

                this.scheduleOnce(()=>{
                    this.GetTransHand();
                    this.transHand.opacity = 0;
                    transCmd2.opacity = 255;
                },0.2);
                
            }
            else if(nType == 3)
            {
                transCmd1.active = false;
                transCmd2.active = false;
                transCmd3.active = true;
                
                transCmd5.active = false;
                transCmd6.active = false;
                transCmdCuo7.active = false;

                let trans1 = transCmd3.getChildByName("休或丢");
                let trans2 = transCmd3.getChildByName("自动休");

                if (bAnimate)
                {
                    trans1.position = cc.Vec2.ZERO;
                    trans2.position = cc.Vec2.ZERO;

                    let action1 = cc.moveTo(0.2,cc.v2(-131,0));
                    //action1.easing(cc.easeElasticOut(3.0));
                    trans1.stopAllActions();
                    trans1.runAction(action1);

                    let action2 = cc.moveTo(0.2,cc.v2(131,0));
                    //action2.easing(cc.easeElasticOut(3.0));
                    trans2.stopAllActions();
                    trans2.runAction(action2);

                }  
                else
                {
                    trans1.position = cc.v2(-131,0);
                    trans2.position = cc.v2(131,0);
                }

                if(this.info.take == "关闭")
                {
                    Tool.LoadImg(trans1.getComponent(cc.Sprite),"other/休或丢0");
                    Tool.LoadImg(trans2.getComponent(cc.Sprite),"other/自动休0");

                }
                else if(this.info.take == "休或丢")
                {
                    Tool.LoadImg(trans1.getComponent(cc.Sprite),"other/休或丢1");
                    Tool.LoadImg(trans2.getComponent(cc.Sprite),"other/自动休0");
                }
                else if(this.info.take == "自动休")
                {
                    Tool.LoadImg(trans1.getComponent(cc.Sprite),"other/休或丢0");
                    Tool.LoadImg(trans2.getComponent(cc.Sprite),"other/自动休1");
                }
            }
            else if(nType == 4)
            {
 

            }
            else if (nType == 5)
            {

                transCmd1.active = false;
                transCmd2.active = false;
                transCmd3.active = false;
                
                transCmd5.active = true;
                transCmd6.active = false;
                transCmdCuo7.active = false;

                let transDD = transCmd5.getChildByName("丢");
                let transQ = transCmd5.getChildByName("敲");
                

                // if (bAnimate)
                // {

                //     transDD.position = cc.Vec2.ZERO;
                //     transQ.position = cc.Vec2.ZERO;

                //     transDD.stopAllActions();
                //     let action1 = cc.moveTo(0.5,cc.v2(-105,0));                 
                //     transDD.runAction(action1);

                //     transDD.stopAllActions();
                //     let action2 = cc.moveTo(0.5,cc.v2(105,0));
                //     transQ.runAction(action2);
                // }
                // else
                // {
                    transDD.position = cc.v2(-131,0);
                    transQ.position = cc.v2(131,0);  
                //}
            }
            else if(nType == 7)
            {
                transCmd1.active = false;
                transCmd2.active = false;
                transCmd3.active = false;            
                transCmd5.active = false;
                transCmd6.active = false;
                transCmdCuo7.active = true;
            }

        }
 
        else
        {
            this.node.getChildByName("延时").active = false;
            transCmd1.active = false;
            transCmd2.active = false;
            transCmd3.active = false;            
            transCmd5.active = false;
            transCmd6.active = false;
            transCmdCuo7.active = false;
        }
    }
    public audio:cc.AudioSource = null;
    public PlayAudio(nType:number, strName:string)
    {
        
        let nEff =  Tool.GetConfigNumber("AudioEff",100);
        if (nEff > 0)
        {
            if (this.audio == null)
            {
                this.audio = this.node.getComponent(cc.AudioSource);
                if(this.audio == null)
                {
                    this.audio = this.node.addComponent(cc.AudioSource);       
                    this.audio.playOnLoad = false;             
                }
            }
            let strAuPath = "Audio/eff/"+strName;
            this.audio.volume = nEff / 100;

            cc.loader.loadRes(strAuPath,cc.AudioClip,(err,obj:cc.AudioClip)=>{
                if(err||obj==null||obj==undefined)
                {
                    Debug.Error(err.message+err);
                    return null;
                }
                
                //this.audio.stop();
                if(this.audio!=null)
                {
                    this.audio.clip = obj;
                    this.audio.play();
                }

            });
        }
    }
    SetCmdBtnState(transBtn:cc.Node,strName:string)
    {
        if(strName.indexOf("不")>=0)
        {
            transBtn.active = false;
        }
        else
        {
            transBtn.active = true;
        }
    }
    //检测是否小皮玩法,
    CheckSmallPlay(strNum:string):string
    {
        let strSet = GameDataManager.getAccount().roomSetting;
        if(strSet.indexOf("0.1/0.3")>=0 || strSet.indexOf("0.2/0.5") >= 0)
        {
            let fOut =  Number(strNum) / 10;
            return fOut.toString();
        }
        else
        {
            return strNum;
        }
    }
    public UpdateRoundScore(bShow:boolean)
    {
        let transRoundScore =  Tool.GetChild(this.node,"PlayerInfo/小结分"); 
        if(transRoundScore != null)
        {
            transRoundScore.active = bShow;
            if(bShow)
            {
                let arrayScore = this.info.round_score.split(',');
                if(arrayScore[3] == "0" || arrayScore[3] == "" || arrayScore[3].indexOf('-')>=0)
                {
                    transRoundScore.active = false;
                }
                else
                {
                    let txt = transRoundScore.getChildByName("num").getComponent(cc.Label);
                    let temp = this.CheckSmallPlay(arrayScore[3].trim());
                    txt.string = temp.indexOf("-")>=0?temp:("+"+temp);
                }  
                this.scheduleOnce(()=>{
                    transRoundScore.active = false;
                },2);              
            }
        }
    }
    //显示隐藏比牌面板
    public ShowHideHandshow(bShow:boolean)
    {
        //观战用户不能西安
        if (this.transHandEnd == null)
            this.transHandEnd =   Tool.GetChild(this.node,"handstop/handshow");

        if(this.info.strServerState.indexOf("结算")>=0 && this.info.player_over_type == "弃")
        {
            this.transHandEnd.active = false;
            return;
        }

        this.transHandEnd.active = bShow;

        if(bShow) //复位牌
        {
            let arrayAllEnd = this.transHandEnd.getComponentsInChildren(PKCardInfoScript);

            arrayAllEnd.forEach((one,idx,array)=>{
                one.ShowFace(this.info.strServerState.indexOf("等待_结算_状态")>=0&&this.playerPos == PlayerPos.self?0:1);
            },this);
        }
    }
    public ClearCoin(bFouce:boolean = false)
    {
        if(!bFouce &&( this.info.strServerState.indexOf("带分_状态")>=0 || this.info.strServerState.indexOf("押牌_状态") >= 0 || this.info.strServerState.indexOf("下注_状态") >= 0))
        {
            return;
        }

        let transGold = this.node.getChildByName("goldshow");

        transGold.active = false;
        transGold.getChildByName("count").getComponent(cc.Label).string = "0";

        return;

    }
    public ShowHideOffline(bShow:boolean)
    {
        if (this.transOffline == null)
            this.transOffline = Tool.GetChild(this.node,"PlayerInfo/offline");
        this.transOffline.active = bShow;
    }

    public ShowCardType(nPos:number, arrayCard:Array<CardInfo>,bShow:boolean = true, nWin:number = 1,bAnimate:boolean = true)   //nWin 1:赢  2：输
    {

        if (this.transCardUP == null)
            this.transCardUP =  Tool.GetChild(this.node,"handstop/handshow/牌型1/label");
        if (this.transCardDown == null)
            this.transCardDown = Tool.GetChild(this.node,"handstop/handshow/牌型2/label");

        let transTar = nPos == 0 ? this.transCardUP : this.transCardDown;

        if (!bShow || (this.info.strServerState.indexOf("结算")>=0 && this.info.player_over_type == "弃"))
        {
            transTar.parent.active = false;
            return;
        }

        let strCardName = DrhNameManager.getInstance().GetDrhNameByCard(arrayCard);
        if(strCardName != "")
        {
            transTar.getComponent(cc.Label).string = strCardName;
            transTar.parent.active = true;
        }
        else
        {
            Debug.Log("@@@@@@@@@@@@@@没有找到牌对应的名称@@@@@@@@:"+ arrayCard[0].nType+ arrayCard[0].nNum+"   "+ arrayCard[1].nType + arrayCard[1].nNum);
        }
    }
    public UpdateDiFenShow(bShow:boolean)
    {
        let transFen =  Tool.GetChild(this.gameLogic.node,"RoomFrame/底分");
        if(transFen != null)
        {
            transFen.active = bShow;
            if(bShow)
            {
                if(this.info.table_times == "" || this.info.table_times == "0")
                {
                    transFen.active = false;
                }
                else
                {
                    transFen.getChildByName("num").getComponent(cc.Label).string = this.CheckSmallPlay( this.info.table_times);
                }
            }
        }
    }
    // 显示隐藏准备
    public ShowHidePrepare()
    {

    }
    //复位手牌
    public ResetHandCard()
    {
        // if(this.arrayHand == null)
        //     this.arrayHand =  this.transHand.getComponentsInChildren(PKCardInfoScript);
        this.GetArrayHandList();
        let nIndex = 0;

        this.arrayHand.forEach((one,idx,array)=>{
            one.ShowFace(1);
            if(nIndex++ <this.info.nHandCount)
            {
                one.node.active = true;
            }
            else
            {
                one.node.active = false;
            }
        },this);
    }
    public GetImgCtl():cc.Sprite
    {
        return Tool.GetChild(this.node,"PlayerInfo/Head/img/img").getComponent(cc.Sprite);
    }
    //显示隐藏头像背景亮框
    public ShowHideLightBK(bShow:boolean = true)
    {
        //处理看牌的时候继续显示倒计时
        if(this.info.strServerState.indexOf("等待_结算_状态")>=0 || this.info.strServerState.indexOf("决策_看牌_状态")>=0)
        {
            bShow = true
        }


        if(bShow) //保护
        {
            this.ModifyNodeOp(255);
        }

        if (this.transLightBK == null)
            this.transLightBK = Tool.GetChild(this.node,"PlayerInfo/lightBK"); 

        if(this.transLightBK == null)
        {
            Debug.Log("->>>is null"+this.node.name);
        }

        this.transLightBK.active = bShow;

        if(bShow)
        {
            this.unschedule(this.UpdateActionTimmer);
            this.schedule(this.UpdateActionTimmer,0.1,cc.macro.REPEAT_FOREVER,0.1);

            if (this.transAnimateOut == null)
                this.transAnimateOut = Tool.GetChild(this.node,"PlayerInfo/animateOut"); 
            //搓牌中的时候可以显示状态
            if(this.info.role == '看牌' && this.info.player_setting == "True" && this.info.is_shuffled != "True")
            {

            }
            else
            {
                if(this.info.strServerState.indexOf("等待_结算_状态")<0 && this.info.strServerState.indexOf("决策_看牌_状态")<0)  //结算状态也需要显示倒计时
                {
                    this.transAnimateOut.opacity = 0;
                }
                
            }


            if(this.info.strServerState.indexOf("决策_看牌_状态")>=0 && this.info.role == "看牌" && this.playerPos == PlayerPos.self)
            {
                this.unschedule(this.UpdateCmd2Timmer);
                this.schedule(this.UpdateCmd2Timmer,0.1,cc.macro.REPEAT_FOREVER,0.1);
            }
            

        }
        else
        {
            this.unschedule(this.UpdateActionTimmer);
            Tool.GetChild(this.node,"PlayerInfo/Head/txt").active = false;
            Tool.GetChild(this.node,"PlayerInfo/Head/倒计时").active = false;

            this.unschedule(this.UpdateCmd2Timmer);
            
        }

    }

    
    UpdateActionTimmer()
    {
        if (this.transLightBKBar == null)
            this.transLightBKBar = Tool.GetChild(this.node,"PlayerInfo/lightBK").getComponent(cc.ProgressBar); 
        if (this.transLigtBKBlackBKBar == null)
            this.transLigtBKBlackBKBar = Tool.GetChild(this.node,"PlayerInfo/Head/倒计时").getComponent(cc.ProgressBar);
        if (this.txtActionTime == null)
            this.txtActionTime = Tool.GetChild(this.node,"PlayerInfo/Head/txt").getComponent(cc.Label);
        
        let nTotle = Number(this.info.strCountDownAll)*10;
        let nCount = Number(this.info.strCurCountDown)*10;
        let nCur = nCount;
        if(nCur>0)
        {
            this.transLigtBKBlackBKBar.node.active = true;
            this.transLigtBKBlackBKBar.node.opacity = 178;
            this.txtActionTime.node.active = true;
            this.txtActionTime.string = parseInt((nCur/10).toString()).toString();
            if (nCount == 5 && this.playerPos == PlayerPos.self)
                this.PlayAudio(0, "时间到");

            if (this.info.emState == PlayerState.init || this.info.emState == PlayerState.leave || this.info.site_countdown != "0")
            {
                this.transLightBKBar.node.active = false;
                this.transLigtBKBlackBKBar.node.active = false;
                this.txtActionTime.node.active = false;
                this.unschedule(this.UpdateActionTimmer);
                return;
            }

            this.transLightBKBar.progress = nCur/nTotle;
            this.transLigtBKBlackBKBar.progress = nCur/nTotle;

            //更新时间
            this.info.strCurCountDown = (--nCur/10).toString(); 
            //Debug.Log("更新倒计时:"+this.info.strCurCountDown);

            if(this.transLightBKBar.progress>0.6)
            {
                this.transLightBK.color = cc.color(51,255,0,255);
            }
            else if(this.transLightBKBar.progress>0.4)
            {
                this.transLightBK.color = cc.color(255,117,9,255);
            }
            else
            {
                this.transLightBK.color = cc.Color.RED;
            }
        }
        else
        {
            this.transLightBKBar.progress =0;
            this.transLigtBKBlackBKBar.progress = 0;
            this.txtActionTime.string = "0";
            this.transLightBKBar.node.active = false;
            this.transLigtBKBlackBKBar.node.active = false;
            this.txtActionTime.node.active = false;
            this.unschedule(this.UpdateActionTimmer);
        }
    }

    UpdateCmd2Timmer()
    {
        if (this.transCheTimeBar == null)
            this.transCheTimeBar = Tool.GetChild(this.gameLogic.node,"cmd2/扯牌进度/进度").getComponent(cc.ProgressBar);
        if (this.txtCheTime == null)
            this.txtCheTime = Tool.GetChild(this.gameLogic.node,"cmd2/扯牌进度/txt").getComponent(cc.Label);
        
        let nTotle = Number(this.info.strCountDownAll);
        let nCount = Number(this.info.strCurCountDown);

        if(nCount>0)
        {
            this.txtCheTime.string = "扯牌倒计时:"+ parseInt(nCount.toString()) + "s";
            this.transCheTimeBar.progress = nCount/nTotle;
        }
        else
        {
            this.txtCheTime.string = "扯牌倒计时:0s";
            this.transCheTimeBar.progress = 0;
        }
    }

    public UpdateDiuLeftCard(strMsg:string)
    {
        let transRoot = Tool.GetChild(this.node,"handstop/丢牌余牌");
        let arrayTemp = transRoot.getComponentsInChildren(PKCardInfoScript);
        if(this.info.handCardEx.length == 3 && this.info.strServerState.indexOf("弃牌")>=0 && this.playerPos != PlayerPos.self)
        {
            transRoot.active = true;
            //Debug.Log("count:"+ arrayTemp.Length+"    array:"+info.handCardEx.len);
            arrayTemp[0].SetCardValue(this.info.handCardEx[2].nType, this.info.handCardEx[2].nNum, 0);
            arrayTemp[1].node.active = false;
        }
        else if(this.info.handCardEx.length == 4 && this.info.strServerState.indexOf("弃牌") >= 0 && this.playerPos != PlayerPos.self)
        {
            transRoot.active = true;
            //Debug.Log("count:" + arrayTemp.Length + "    array:" + info.handCardEx.len);
            arrayTemp[0].SetCardValue(this.info.handCardEx[2].nType, this.info.handCardEx[2].nNum, 0);
            arrayTemp[1].SetCardValue(this.info.handCardEx[3].nType, this.info.handCardEx[3].nNum, 0);
        }
        else
        {
            transRoot.active = false;
        }
    }
    public ShowDaiRu(bShow:boolean = true, bAnimate:boolean = true)
    {

    }
    //更新个人分数动画
    public UpdateFenAnimate(bShow:boolean, strBei:string, bAnimate:boolean = true, bNew:boolean = true,nDelay:number = 0)
    {
        let transGold = this.node.getChildByName("goldshow");
        let transBei = Tool.GetChild(this.node,"goldshow/count");

        if (bShow)
        {
            transGold.active = true;
            Tool.GetChild(this.node,"goldshow/coin").active = true;
        }
        else
        {
            transGold.active = false;
            return;
        }

        if (strBei == "0" || strBei == "")
        {
            transGold.active = false;
            return;
        }

        let strOldBei = "0";

        if (transBei != null)
        {
            strOldBei = transBei.getComponent(cc.Label).string;
            transBei.getComponent(cc.Label).string = this.CheckSmallPlay(strBei);
        }

        if(bNew)
        {
             if (this.info.bei_shu_type == "-5")
                return;

            this.ThrowCoinAnimate("", bAnimate,nDelay);
        }
    }
    public ThrowCoinAnimate(strPath:string,bAnimate:boolean = true,nDelay:number=0)
    {
        if (!bAnimate)
        {
            return;
        }

        strPath = "Prefabs/drh/coin";

        let trasnTemp = this.node.getChildByName("goldshow");
        let trasnCoinTar = Tool.GetChild(this.node,"goldshow/coin");
        let transHead = this.node.getChildByName("PlayerInfo");

        let bPlayAudio = this.info.bei_shu_type == "-3"?false:true;

        cc.loader.loadRes(strPath,(err,obj)=>{
            if(err||obj==null||obj==undefined)
            {
                cc.error(err.message || err);
                return null;
            }
            if(this.node == null)
                return
            let add:cc.Node = cc.instantiate(obj);
            add.parent = trasnCoinTar;
            add.position = trasnCoinTar.convertToNodeSpaceAR(transHead.convertToWorldSpaceAR(cc.v2(0,0)));
            let delay = cc.delayTime(nDelay);
            let move = cc.moveTo(0.2,cc.Vec2.ZERO);
            let end = cc.callFunc(()=>{
                add.destroy();
            },this);
            let action = cc.sequence(delay,move,end);
            add.runAction(action);
            if(bPlayAudio)
                this.PlayAudio(0,"下注");
        });
    
    }
    public ShowCurState(bShow:boolean = true,bAnimate:boolean = true)       
    {
        if (this.transAnimateOut == null)
            this.transAnimateOut = Tool.GetChild(this.node,"PlayerInfo/animateOut");

        if(!bShow)
        {
            //搓牌中的时候可以显示状态
            if(this.info.role == '看牌' && this.info.player_setting == "True" && this.info.is_shuffled != "True")
            {

            }
            else
            {
                if(this.info.strServerState.indexOf("等待_结算_状态")>=0 || this.info.strServerState.indexOf("决策_看牌_状态")>=0)
                {
                    
                }
                else
                {
                    this.transAnimateOut.opacity = 0
                }
                
            }
            if(this.playerPos == PlayerPos.self)
            {
                //丢牌之后显示眼睛
               // arrayHand[0].transform.Find("秀牌").gameObject.SetActive(false);
              //  arrayHand[1].transform.Find("秀牌").gameObject.SetActive(false);
            }

            return;
        }

        this.transAnimateOut.active = true;
        this.transAnimateOut.opacity = 255;
        
        let strName = "";
        if (this.info.bei_shu_type == "0")
            strName = "大";
        else if (this.info.bei_shu_type == "-1")
            strName = "跟";
        else if (this.info.bei_shu_type == "-3")
        {
            strName = "敲";
        }
        else if (this.info.bei_shu_type == "-5")
            strName = "休";
        else if (this.info.bei_shu_type == "-6")
            strName = "滚";
        else if (this.info.bei_shu_type == "-7")
        {
            strName = "丢";
            if (this.playerPos == PlayerPos.self &&( this.info.turn_pai == "00" || this.info.turn_pai == "" || this.info.turn_pai == "0"))
            {
                //丢牌之后显示眼睛
                //arrayHand[0].transform.Find("秀牌").gameObject.SetActive(true);
                //arrayHand[1].transform.Find("秀牌").gameObject.SetActive(true);
            }
        }
        else if (this.info.bei_shu_type == "-999") //初始
        {
            this.transAnimateOut.opacity = 0;
            return;
        }

        if(strName == "敲")
        {
            Tool.GetChild(this.node,"PlayerInfo/Head/敲").active = true;
        }
        else
        {
            Tool.GetChild(this.node,"PlayerInfo/Head/敲").active = false;
        }

        let strImgPath = "other/drh/"+strName;

        let img = this.transAnimateOut.getComponent(cc.Sprite);
        Tool.LoadImg(img,strImgPath);       
        

        if(bAnimate)
        {
            this.transAnimateOut.stopAction(this.moveActionTar);
            this.transAnimateOut.position = cc.Vec2.ZERO;
            // let move = cc.moveTo(0.3,cc.v2(0,0));
            // let action = move.easing(cc.easeBounceOut());
            this.moveActionTar = this.transAnimateOut.runAction(this.moveAction);

            if(this.info.bei_shu_type == "-7")
            {
                this.PlayAudio(0, "丢牌");

                //丢牌动画
                let transEnd = this.gameLogic.node.getChildByName("发牌点");
                let transSrc = this.node.getChildByName("PlayerInfo");

                cc.loader.loadRes("Prefabs/丢牌对象",(err,obj)=>{
                    if(err||obj==null||obj==undefined)
                    {
                        cc.error(err.message || err);
                        return null;
                    }
                    if(this.node == null)
                        return
                    let add:cc.Node = cc.instantiate(obj);
                    add.parent = transSrc;
                    add.position = cc.Vec2.ZERO;
                    let strName = Tool.GetConfigString("牌背","1");
                    for(let one of add.children)
                    {
                        let img = one.getChildByName("BK1").getComponent(cc.Sprite);
                        Tool.LoadImg(img,"zuotype/牌背"+strName);
                    }

                    //let move = cc.moveTo(0.3,transSrc.convertToNodeSpaceAR(transEnd.convertToWorldSpaceAR(cc.v2(0,0))));
                    //let rotate = cc.rotateBy(0.3,180);
                    // let end = cc.callFunc(()=>{
                    //     add.destroy();
                    // },this);

                    // let dismiss = 

                    // let spawn = cc.spawn(move);
                    // let action = cc.sequence(spawn,end);
                    // add.runAction(action);
                    cc.tween(add)
                    .to(0.3,{position:transSrc.convertToNodeSpaceAR(transEnd.convertToWorldSpaceAR(cc.v2(0,0)))})
                    .to(0.3,{opacity:0})
                    .call(()=>{
                        add.destroy();
                    })
                    .start();
                });

            }
            else if(this.info.bei_shu_type == "-3")
            {
                this.PlayAudio(0,"敲");
            }
            else if(this.info.bei_shu_type == "-5")
            {
                this.PlayAudio(0, "休牌");
            }
        }
        else
        {
            this.transAnimateOut.position = cc.v2(0,58);
        }
    }
    public SetOneCardInfo(nPos:number)
    {
        //添加到手牌缓存
        if (nPos >= this.info.handCardEx.length)
        {
            this.info.handCardEx.push(new CardInfo(this.info.huoCard.nType, this.info.huoCard.nNum));  
        }
        else
        {
            this.info.handCardEx[nPos] = new CardInfo(this.info.huoCard.nType, this.info.huoCard.nNum);
        }
    }
    //刷新扯牌结果
    public UpdateChePaiHand(nType:number = 0,bAnimate:boolean = true) //nType: 0:所有   1:上2张   2:下2张
    {
        
        if (this.transHandEnd == null)
            this.transHandEnd = Tool.GetChild(this.node,"handstop/handshow");

        if (this.info.player_over_type == "弃" && this.info.strServerState.indexOf("结算")>=0)
        {
            this.transHandEnd.active  = false;
            return;
        }



        this.transHandEnd.active = true;

        if (this.transHand.opacity = 255)
            this.transHand.opacity = 0;

        let nStart = 0;
        let nLen = 0;
        if(nType == 0)
        {
            nStart = 0;
            nLen = 4;
        }
        else if(nType == 1)
        {
            nStart = 0;
            nLen = 2;
        }
        else if(nType == 2)
        {
            nStart = 2;
            nLen = 2;
        }


        let arrayAllEnd = this.transHandEnd.getComponentsInChildren(PKCardInfoScript);
        for(let i=nStart;i< nStart+nLen; i++)
        {
            let one = arrayAllEnd[i];

            //如没有这张牌则隐藏
            if(i>=this.info.nHandCount)
            {
                one.node.active = false;
                continue;
            }
            else
            {
                one.node.active = true;
            }

            one.SetCardValue(this.info.handCardEx[i].nType, this.info.handCardEx[i].nNum,0, bAnimate?1:0);
            if(bAnimate)
                one.PlayCoverAnimate();
        }

    }
    public ShowYiKanPai(bShow:boolean = true,bAnimate:boolean = true)
    {
        if (this.transAnimateOut == null)
            this.transAnimateOut = Tool.GetChild(this.node,"PlayerInfo/animateOut");
        if (!bShow)
        {
            this.transAnimateOut.opacity = 0;
            return;
        }
        this.transAnimateOut.active = true;
        this.transAnimateOut.opacity = 255;
        let strImgPath = "other/drh/分";
        Tool.LoadImg(this.transAnimateOut.getComponent(cc.Sprite),strImgPath);

        if (bAnimate)
        {

            this.transAnimateOut.stopAction(this.moveActionTar);
            this.transAnimateOut.position = cc.Vec2.ZERO;
            let move = cc.moveTo(0.3,cc.v2(0,58));
            let action = move.easing(cc.easeBounceOut());
            this.moveActionTar = this.transAnimateOut.runAction(this.moveAction);


            this.PlayAudio(0, "扯牌");
        }
        else
        {
            this.transAnimateOut.position = cc.v2(0,58);
        }
    }
    public ShowKanPaiZhong(bShow:boolean = true,bAnimate:boolean = true)
    {
        if (this.transAnimateOut == null)
            this.transAnimateOut = Tool.GetChild(this.node,"PlayerInfo/animateOut");
        if (!bShow)
        {
            this.transAnimateOut.opacity = 0;
            return;
        }
        this.transAnimateOut.active = true;
        this.transAnimateOut.opacity = 255;
        let strImgPath = "other/drh/分";
        Tool.LoadImg(this.transAnimateOut.getComponent(cc.Sprite),strImgPath);

        if (bAnimate)
        {

            this.transAnimateOut.stopAction(this.moveActionTar);
            this.transAnimateOut.position = cc.Vec2.ZERO;
            let move = cc.moveTo(0.3,cc.v2(0,58));
            let action = move.easing(cc.easeBounceOut());
            this.moveActionTar = this.transAnimateOut.runAction(this.moveAction);


            this.PlayAudio(0, "扯牌");
        }
        else
        {
            this.transAnimateOut.position = cc.v2(0,58);
        }


        //看牌中显示倒计时
        this.ShowHideLightBK(true)
    }


    public ShowCuoPaiZhong(bShow:boolean = true,bAnimate:boolean = true)
    {
        if (this.transAnimateOut == null)
            this.transAnimateOut = Tool.GetChild(this.node,"PlayerInfo/animateOut");
        if (!bShow)
        {

            if(this.info.strServerState.indexOf("等待_结算_状态")>=0 || this.info.strServerState.indexOf("决策_看牌_状态")>=0)
            {
                
            }
            else
            {
                this.transAnimateOut.opacity = 0;
            }
            
            return;
        }
        this.transAnimateOut.active = true;
        this.transAnimateOut.opacity = 255;
        let strImgPath = "other/drh/搓牌中";
        Tool.LoadImg(this.transAnimateOut.getComponent(cc.Sprite),strImgPath);

        if (bAnimate)
        {
            this.transAnimateOut.stopAction(this.moveActionTar);
            this.transAnimateOut.position = cc.Vec2.ZERO;
            let move = cc.moveTo(0.3,cc.v2(0,58));
            let action = move.easing(cc.easeBounceOut());
            this.moveActionTar = this.transAnimateOut.runAction(this.moveAction);


            this.PlayAudio(0, "扯牌");
        }
        else
        {
            this.transAnimateOut.position = cc.v2(0,58);
        }
    }

    //更新手牌
    public UpdateHandCard(bAnimateMove:boolean = true, bAnimateCover:boolean = true, nShowFace:number = 0)
    {
        this.GetTransHand();//Tool.GetChild(this.node,"handstop/handcardlist");
        //this.arrayHand = this.transHand.getComponentsInChildren(PKCardInfoScript);
        this.GetArrayHandList();
        //this.GetTransHand();//Tool.GetChild(this.node,"handstop/handcardlist");


        if (this.vcStopPos == cc.Vec2.ZERO)
        {
            this.vcStopPos = this.transHand.position;
        }
        else
        {
            this.transHand.position = this.vcStopPos;
        }
        if (bAnimateMove)
        {
            return;              
        }
        else
        {
            if (!bAnimateCover)
                this.UpdateHandNoAnimate(nShowFace);
            else
                this.UpdateHandAnimate(nShowFace);
        }

        if(this.playerPos == PlayerPos.self && this.info.is_shuffled == "True")
        {
            Tool.GetChild(this.gameLogic.node,"搓牌窗口").active = false;
        }
    }
    public UpdateHandAnimate(nShowFace:number = 0)
    {
        this.ResetHandCard();

        for (let i = 0; i < this.info.handCardEx.length; i++)
        {
            let card = this.info.handCardEx[i];
            let one = this.arrayHand[i];
            one.SetCardValue(card.nType, card.nNum, this.playerPos == PlayerPos.self ? 0 : 1, 1);
        }


        
        let arrayTemp = new Array<cc.ActionInstant>();
        arrayTemp.push(cc.delayTime(0.5));

        for (let i = 0; i < this.info.handCardEx.length; i++)
        {
            if(this.info.handCardEx[i].nNum != 0)
            {
                arrayTemp.push(cc.callFunc(()=>{
                    this.arrayHand[i].PlayCoverAnimate();
                }));                
            }
            arrayTemp.push(cc.delayTime(0.1));            
        }
        arrayTemp.push(cc.callFunc(()=>{
            //如果当前状态为决策
            if(this.info.strServerState.indexOf("决策")>=0 && this.info.strServerState.indexOf("下注")>=0)
            {
                this.ShowCmdPad(true, 1);
            }
        }));        

        let seq = cc.sequence(arrayTemp);
        this.node.runAction(seq);

        if(this.info.role != "看牌")
        this.transHand.opacity = 255;
    }
    //无动画刷牌用于全量
    public UpdateHandNoAnimate(nShowFace:number = 0)
    {
        //Debug.Error('进入刷新');
        // if(this.arrayHand == null)
        //     this.arrayHand = this.transHand.getComponentsInChildren(PKCardInfoScript);
        this.GetArrayHandList();
        let nHandIndex = 0; //手牌指针索引

        for (let i = 0; i < this.info.handCardEx.length; i++)
        {
            let card = this.info.handCardEx[i];
            let one = this.arrayHand[i];

            let nShowCover = 0;
            if (i == 3 /*&& this.info.is_qiang_over == "True"*/ && this.info.is_shuffled != "True" && this.info.player_setting == "True")
                nShowCover = 1;

            if(this.info.handCardEx.length == 2 && this.info.is_show_tou_pai != "True" && i<2 && this.playerPos == PlayerPos.self) //前2张牌只有庄家和下家能看牌
            {
                nShowCover = 1;
            }

            one.SetCardValue(card.nType, card.nNum, this.playerPos == PlayerPos.self ? 0 : 1, nShowCover);
        }


        if (this.info.handCardEx.length == 0 && nShowFace == 0)
        {
            this.transHand.opacity = 0;
            return;
        }

        //其他人没有手牌需要设置为背面
        if(this.info.handCardEx.length == 0 && this.info.nHandCount >0)
        {
            for (let i = 0; i < this.info.nHandCount; i++)
            {
                let one = this.arrayHand[nHandIndex];
                one.SetCardValue(0, 0, 0, 1);

                //3-4张牌不可能看不到如果出现则隐藏
                if(i>=2)
                {
                    one.node.active = false;
                }
            }
        }


        //剩余的牌显示背面
        nHandIndex = this.info.nHandCount;
        for (; nHandIndex < 4; nHandIndex++)
        {
            let one = this.arrayHand[nHandIndex];
            if (one != null)
            {
                one.SetCardValue(0, 0, 0, 1);//显示背面
                one.node.active = false;
            }
        }
        if(this.info.role != "看牌")
            this.transHand.opacity = 255;
    }
    //显示最后一张牌
    public UpdateLastCard(bAnimate:boolean = true)
    {
        let card = this.arrayHand[4];
        if (card != null)
        {
            card.SetCardValue(this.info.huoCard.nType, this.info.huoCard.nNum, this.playerPos == PlayerPos.self ? 0 : 1, 0);

            if (bAnimate)
                card.PlayCoverAnimate();

        }
        this.ShowCmdPad(true, 1);
    }
    public Fly2MainAnimate()
    {
        let transTar = Tool.GetChild(this.gameLogic.node,"RoomFrame/底分标记");
        let trasnSrc = Tool.GetChild(this.node,"goldshow/coin");
        transTar.active = false;
        trasnSrc.active = false;

        cc.loader.loadRes("Prefabs/drh/coin",(err,obj)=>{
            if(err||obj==null||obj==undefined)
            {
                cc.error(err.message || err);
                return null;
            }
            if(this.node == null)
                return
            let add:cc.Node = cc.instantiate(obj);
            add.parent = this.node;
            add.position = this.node.convertToNodeSpaceAR(trasnSrc.convertToWorldSpaceAR(cc.v2(0,0)));
            let move = cc.moveTo(0.3,this.node.convertToNodeSpaceAR(transTar.convertToWorldSpaceAR(cc.v2(0,0))));
            let end = cc.callFunc(()=>{
                add.destroy();
                transTar.active = true;
            },this);
            let action = cc.sequence(move,end);
            add.runAction(action);
        });
    }
    public GetCardEndWinType(nType:number):number //nType 0:第一组  1：第二组
    {
        let strWin = this.info.is_poker_win.substr(nType, 1);
        return strWin == "大" ? 1 : 2;
    }
    public UpdateUserBaseInfo()
    {
        if (this.transName == null)
            this.transName = Tool.GetChild(this.node,"PlayerInfo/name");
        if (this.transScore == null)
            this.transScore = Tool.GetChild(this.node,"PlayerInfo/score");

        this.transName.getComponent(cc.Label).string = this.info.strUserName;
        this.transScore.getComponent(cc.Label).string =  this.CheckSmallPlay(this.info.nGoldNum.toString());
    }
    public UpdateMangpiXiumang()
    {
        let strMsg = "";
        let strSet:string = GameDataManager.getAccount().roomSetting;
        if (strSet.indexOf("没有休芒")>=0&&strSet.indexOf("没有芒皮")>=0)
        {
            Tool.GetChild(this.gameLogic.node,"ExShow/芒池").active = false;            
        }
        else
        {
            
            let nMangPi = Number(this.info.mang_pi_times);
            let nXiuMang = Number(this.info.xiu_mang_times);
            if (nMangPi == -1)
                nMangPi = 0;
            if (nXiuMang == -1)
                nXiuMang = 0;
            Tool.GetChild(this.gameLogic.node,"ExShow/芒池/num").getComponent(cc.Label).string = this.CheckSmallPlay((nMangPi + nXiuMang).toString());
            

            if((nMangPi+nXiuMang)>0)
                Tool.GetChild(this.gameLogic.node,"ExShow/芒池").active = true;                
            else
                Tool.GetChild(this.gameLogic.node,"ExShow/芒池").active = false;
        }


        if (Number(this.info.xiu_mang_count)>0)
        {
            let nNum = Number(this.info.xiu_mang_count);
            Tool.GetChild(this.gameLogic.node,"ExShow/芒池/几芒").getComponent(cc.Label).string = "x" + this.info.xiu_mang_count;  
        }
        else
        {
            Tool.GetChild(this.gameLogic.node,"ExShow/芒池/几芒").getComponent(cc.Label).string = "";            
        }
    }
    //延迟显示搓牌
    public DelayShowCuo(nTime:number)
    {


        let strUserID = GameDataManager.getAccount().guuid;
        if (this.playerPos != PlayerPos.self || this.info.strUserID != strUserID)
            return;

        //Debug.Error("进入延迟现实搓牌:"+nTime);

        this.scheduleOnce(()=>{

            if(this.info.handCardEx.length<4 || this.info.handCardEx[3] == undefined)
            {
                //GameDataManager.getAccount().reqGetFullMessage();
                return;
            }

            //设置牌
            let strPath = "pk2/"+this.info.handCardEx[3].nType+"_"+this.info.handCardEx[3].nNum+"d";

            //Debug.Error("开始加载图片");
            Tool.LoadImg(Tool.GetChild(this.gameLogic.node,"搓牌窗口/牌").getComponent(cc.Sprite),strPath,()=>{
                //Debug.Error("加载完成");
                Tool.GetChild(this.gameLogic.node,"搓牌窗口/遮罩").position = cc.Vec2.ZERO;
                Tool.GetChild(this.gameLogic.node,"搓牌窗口/遮罩").active = true;
                Tool.GetChild(this.gameLogic.node,"搓牌窗口").active = true;
                Tool.GetChild(this.gameLogic.node,"搓牌窗口/牌/手1").active = true;
                Tool.GetChild(this.gameLogic.node,"搓牌窗口/牌/手2").active = true;
            });



        },nTime);
        
    }
    public UpdatePlayerTotleFen()
    {
        let transAddTotle = Tool.GetChild(this.node,"PlayerInfo/bei");
        
        if (transAddTotle != null)
        {
            transAddTotle.active =true;
            transAddTotle.getComponent(cc.Label).string = this.info.beicount;
        }
    }
    //第一二张牌延迟发出
    public DelayThrowFirstCard(arrayGet:Array<number>,bQiePai:boolean)
    {
        this.scheduleOnce(()=>{
            if(bQiePai)
            {
                let strName = Tool.GetConfigString("牌背","1");
                if(strName == "1")
                {
                    this.gameLogic.playingView.displayQP1.node.active = true;
                    this.gameLogic.playingView.displayQP2.node.active = false;
                    this.gameLogic.playingView.displayQP3.node.active = false;
                    this.gameLogic.playingView.displayQP1.playAnimation("pai3",1);
                }
                else if(strName == "2")
                {
                    this.gameLogic.playingView.displayQP1.node.active = false;
                    this.gameLogic.playingView.displayQP2.node.active = true;
                    this.gameLogic.playingView.displayQP3.node.active = false;
                    this.gameLogic.playingView.displayQP2.playAnimation("pai1",1);
                }
                else if(strName == "3")
                {
                    this.gameLogic.playingView.displayQP1.node.active = false;
                    this.gameLogic.playingView.displayQP2.node.active = false;
                    this.gameLogic.playingView.displayQP3.node.active = true;
                    this.gameLogic.playingView.displayQP3.playAnimation("pai2",1);
                }

                this.gameLogic.PlayAudio("切牌");
                this.scheduleOnce(()=>{
                    this.gameLogic.ThrowCard2Player(this, arrayGet);
                },2.5);

                return;
            }     
    
            
    
            this.gameLogic.ThrowCard2Player(this, arrayGet);
        },1.05);

    }
    public AnimateMoveOneCard(nPos:number)
    {
        // if(this.arrayHand == null)
        //     this.arrayHand = this.transHand.getComponentsInChildren(PKCardInfoScript);
        this.GetArrayHandList();
        
        let card = this.arrayHand[nPos];
        

        //如果当前这个人没有这张牌则跳过
        if (nPos>=this.info.handCardEx.length)
            return;

        if (card != null)
        {            
            card.SetCardValue(this.info.handCardEx[nPos].nType, this.info.handCardEx[nPos].nNum, this.playerPos == PlayerPos.self ? 0 : 1, 1);
        }

        //找到初始位置
        let transStartPos = this.gameLogic.node.getChildByName("发牌点");
        let vcSrc = transStartPos.convertToWorldSpaceAR(cc.v2(0,0));

        this.PlayAudio(0, "发牌");

        for(let i=nPos+1;i<this.arrayHand.length;i++)
        {
            this.arrayHand[i].node.active = false;
            this.arrayHand[i].ShowHideBK(false);
        }

        let bPlayCover = (nPos <= 1 && this.playerPos != PlayerPos.self) ? false : true;

        if (/*this.info.is_qiang_over == "True" && */nPos == 3 && this.info.role != "敲牌" && this.info.player_setting == "True") //最后一张牌如果是敲牌则不自动翻牌
        {            
            bPlayCover = false;
            if(this.playerPos == PlayerPos.self  && this.info.strUserID == GameDataManager.getAccount().guuid)
            {
                //设置最后一张牌到搓牌界面
                let strPath = "pk2/"+this.info.handCardEx[nPos].nType+"_"+this.info.handCardEx[nPos].nNum+"d";    
                //Tool.LoadImg(Tool.GetChild(this.gameLogic.node,"搓牌窗口/牌").getComponent(cc.Sprite),strPath);
                Tool.LoadImg(Tool.GetChild(this.gameLogic.node,"搓牌窗口/牌").getComponent(cc.Sprite),strPath,()=>{

                    Tool.GetChild(this.gameLogic.node,"搓牌窗口/遮罩").position = cc.Vec2.ZERO;
                    Tool.GetChild(this.gameLogic.node,"搓牌窗口/遮罩").active = true;
                    Tool.GetChild(this.gameLogic.node,"搓牌窗口").active = true;
                    Tool.GetChild(this.gameLogic.node,"搓牌窗口/牌/手1").active = true;
                    Tool.GetChild(this.gameLogic.node,"搓牌窗口/牌/手2").active = true;
                });
            }
            
            //显示搓牌中
            this.ShowCuoPaiZhong(true,true);
            //没有敲的时候如果开了开关，也需要搓牌
            // if(this.info.is_qiang_over != "True" && this.playerPos == PlayerPos.self) 
            // {
            //     this.DelayShowCuo(1);
            // }
        }
        else    
        {
            if (this.transAnimateOut == null)
                this.transAnimateOut = Tool.GetChild(this.node,"PlayerInfo/animateOut");
            if(this.info.strServerState.indexOf("决策_看牌_状态")<0)
                this.transAnimateOut.opacity = 0;
        }

        if (this.info.handCardEx[nPos].nType == 0 && this.info.handCardEx[nPos].nNum == 0)
            bPlayCover = false;

        if(nPos == 3 && this.playerPos == PlayerPos.self)
        {
            //Debug.Error("最后张牌开放"+bPlayCover);
        }

        //第一二张牌需要单独处理，只有庄家的下家能看到
        if(nPos<2 && this.playerPos == PlayerPos.self)
        {
            if(this.info.is_show_tou_pai == "True")
            {
                bPlayCover = true;
            }
            else
            {
                bPlayCover = false;
            }
        }

        card.AnimateMove(vcSrc,this.DelayShowCmd2,bPlayCover,nPos,this);


        //隐藏type
        if (this.transAnimateOut == null)
            this.transAnimateOut = Tool.GetChild(this.node,"PlayerInfo/animateOut");
        
    }
    public DelayShowCmd(nCmdType:number)
    {
        this.scheduleOnce(()=>{

            this.ShowCmdPad(true,nCmdType);

            // if(nCmdType === 2)
            // {
            //     //更新手牌控件
            //     let strUserID = GameDataManager.getAccount().guuid;
            //     if (this.playerPos == PlayerPos.self &&  this.info.strUserID == strUserID)
            //         this.transHand.opacity = 0;
            // }
        },0.6);

    }
    public DelayShowCmd2(nPos:number,src:DrhPlayerLogic = null)
    {
        //回调过来this为空了
                
        if (src.info.is_action == "True" && src.info.strServerState.indexOf("看牌") < 0)
        {
            if (src.info.role == "敲牌")
                src.ShowCmdPad(true, 5);
            else
            {
                if(nPos != 1)
                    src.ShowCmdPad(true, 1);
            }
        }
    }
    public reqRaise(strBei:string)
    {
       
        if (this.playerPos != PlayerPos.self)
            return;

        GameDataManager.getAccount().reqRaise(strBei.indexOf("-")>=0?strBei:this.CheckReturn2Big(strBei), this.nCaptureID.toString());
    }
 
    public reqPass()
    {
        if (this.playerPos != PlayerPos.self)
            return;
        GameDataManager.getAccount().reqPass(this.nCaptureID.toString());
    }
    
    public reqSetBeginScore(strScroe:string)
    {
        if (this.playerPos != PlayerPos.self)
            return;
        GameDataManager.getAccount().reqGameCommand("{\"header\":\"玩家_带分_事件\",\"score\":\"" + strScroe + "\"}", "玩家_带分_事件");
    }

    public reqShow(arrayCard:Array<CardInfo>)
    {
        if (this.playerPos != PlayerPos.self)
            return;
        let strMsg = "{\"showlist\": [";
        for(let i=0;i<arrayCard.length;i++)
        {
            if (i > 0)
                strMsg += ",";
            let one = arrayCard[i];
            strMsg += "["+ one.nType+","+one.nNum+"]";
        }
        strMsg += "]}";

        

        GameDataManager.getAccount().reqShow(strMsg, "");
    }

    //检测小皮玩法还原服务器数据
    public CheckReturn2Big(strNum:string)
    {
        let strSet:string = GameDataManager.getAccount().roomSetting;
        if (strSet.indexOf("0.1/0.3") >= 0 || strSet.indexOf("0.2/0.5") >= 0)
        {
            let nOut = Number(Number(strNum) * 10);
            return nOut.toString();
        }
        else
        {
            return strNum;
        }
    }
    public PlayCoverOneCard(nPos:number)
    {
        let card =  this.arrayHand[nPos];
        card.SetCardValue(this.info.handCardEx[3].nType, this.info.handCardEx[3].nNum, 0, 1);
        card.PlayCoverAnimate((this.playerPos == PlayerPos.self&&card.node.parent.name!="handcardlist2")?1:0.8);
    }

    public OnChartMsg(strMsg:string)
    {
        let strRealTalk:string = strMsg;
        //检测是否有常用语
        if (strMsg.indexOf("@YY") >= 0) //发现常用语
        {


        }
        else if (strMsg.indexOf("@BQ") >= 0) //发送表情
        {
            Debug.Log("收到表情:"+strMsg);
            // Tool.GetChild(this.node,"TalkPad").active = true;
            // Tool.GetChild(this.node,"TalkPad/BQ").active = true;
            // Tool.GetChild(this.node,"TalkPad/KJ").active = false;
            
            // let strTemp = "表情" + strMsg.substring(3);
            // let animate = Tool.GetChild(this.node,"TalkPad/BQ").getComponent(cc.Animation);
            // animate.play(strTemp);

            //删除之前的表情
            let old = this.node.getChildByName("表情");
            if(old != undefined)
            {
                old.destroy();
            }

            let strTemp = "表情2/" + strMsg.substring(3);
            Debug.Log(strTemp);
            cc.loader.loadRes(strTemp,(err,obj)=>{
                if(err)
                {
                    cc.error(err.message || err);
                    return null;
                }
                if(this.node == null)
                    return
                let node = cc.instantiate(obj);
                node.name = "表情";
                node.parent = this.node;

                this.scheduleOnce(()=>{
                    node.destroy()
                },2)
                // let animate = node.getComponent(dragonBones.ArmatureDisplay);
                // animate.addEventListener(dragonBones.EventObject.COMPLETE,()=>{
                //     node.destroy();
                // },this);
                // animate.playAnimation("newAnimation",1);
                // //播放表情声音
                // let nEff =  Tool.GetConfigNumber("AudioEff",100);
                // if (nEff > 0)
                // {
                //     if(this.node == undefined || this.node == node)
                //         return
  
                //     let audio = this.node.addComponent(cc.AudioSource);       
                //     audio.playOnLoad = false;             
                        
                    
                //     let strAuPath = "表情声音/"+strMsg.substring(3);
                //     audio.volume = nEff / 100;
        
                //     cc.loader.loadRes(strAuPath,cc.AudioClip,(err,obj:cc.AudioClip)=>{
                //         if(err||obj==null||obj==undefined)
                //         {
                //             Debug.Error(err.message+err);
                //             return null;
                //         }
                //         if(audio!=null)
                //         {
                //             audio.clip = obj;
                //             audio.play();
                //         }
        
                //     });



            });
        }
        else if (strMsg.indexOf("@@语音@@") >= 0) //语音
        {
            //如果禁用语音则跳过
            let nEffGCloud = Tool.GetConfigNumber("AudioGCloud",1);
            if(nEffGCloud<=0)
            {
                KBEngine.Event.fire("OnPlayNextAudio", "");
                return;
            }

            //校验当前用户是否背屏蔽语音
            if(this.gameLogic.CheckNoAudio(this.info.strUserID))
            {
                KBEngine.Event.fire("OnPlayNextAudio", "");
                return;
            }


            let strPlayPath = strMsg.substr(6);

            
            MobileManager.getInstance().DownLoadRecord(strPlayPath);
            
            Tool.GetChild(this.node,"TalkPad").active = true;
            Tool.GetChild(this.node,"TalkPad/BQ").active = false;
            Tool.GetChild(this.node,"TalkPad/KJ").active = true; 
        }
        else if (strMsg.indexOf("@@道具@@") >= 0) //使用道具
        {
           this.UseDaoju(strMsg.substr(6));
           return;
        }
        else 
        {

        }
        this.unschedule(this.callbackStopTalk);
        this.scheduleOnce(this.callbackStopTalk,strMsg.indexOf("@@语音@@")<0?2:10);

    }

    public UseDaoju(strInfo:string)
    {
        let nPos = strInfo.indexOf("@");
        let strTool = strInfo.substr(0,nPos);
        let  strTarID = strInfo.substr(nPos + 1);

        let desV = this.gameLogic.GetPlayerHeadPosG(strTarID);
        let srcV = this.gameLogic.GetPlayerHeadPosG(this.info.strUserID);

        DaojuManager.getInstance().UserDaoju(strTool,srcV,desV);
    }


    public callbackStopTalk()
    {
        this.node.getChildByName("TalkPad").active = false;
    }
    
    //强制看这人的牌
    public FourceLook()
    {
        let strUserID = GameDataManager.getAccount().guuid;
        if ((this.playerPos == PlayerPos.self && strUserID == this.info.strUserID) || this.info.strUserID == "init" || this.info.handSave.length <= 0 || (this.info.player_over_type == "正"&&this.info.game_over_type == "正") || Tool.GetChild(this.node,'PlayerInfo/扩展状态').active || this.info.site_countdown != "0")
            return;
        this.node.getChildByName("展示牌").active = true;

        this.arrayShow[0].SetCardValue(this.info.handSave[0].nType, this.info.handSave[0].nNum, 1, 1);
        this.arrayShow[1].SetCardValue(this.info.handSave[1].nType, this.info.handSave[1].nNum, 1, 1);
        this.arrayShow[0].node.active = true;
        this.arrayShow[1].node.active = true;
        this.arrayShow[0].PlayCoverAnimate(); 
        this.arrayShow[1].PlayCoverAnimate();

        this.arrayHand[0].node.active = false;
        this.arrayHand[1].node.active = false;
    }

    //开下一张牌
    public LookNextCard():boolean
    {
        if (this.info.strUserID == "init" || this.info.handSave.length <= 0 || this.playerPos != PlayerPos.self || Tool.GetChild(this.node,"PlayerInfo/扩展状态").active || this.info.site_countdown!="0")
            return false;
        //let nPos = this.info.handCardEx.length;

        let arrayTemp = this.node.getChildByName("下一张牌").getComponentsInChildren(PKCardInfoScript);
        // if (nPos >= 4)
        //     return false;


        // if(nPos == 2)
        // {
        //     this.node.getChildByName("下一张牌").active = true;
        //     arrayTemp[0].node.active = true;
        //     arrayTemp[1].node.active = true;
        //     arrayTemp[0].SetCardValue(this.info.handSave[nPos].nType, this.info.handSave[nPos].nNum, 1, 1);
        //     arrayTemp[0].PlayCoverAnimate();
        //     arrayTemp[1].SetCardValue(this.info.handSave[nPos+1].nType, this.info.handSave[nPos+1].nNum, 1, 1);
        //     arrayTemp[1].PlayCoverAnimate();
        // }
        // else if(nPos == 3)
        // {
        //     this.node.getChildByName("下一张牌").active = true;
        //     arrayTemp[0].node.active = true;
        //     arrayTemp[0].SetCardValue(this.info.handSave[nPos].nType, this.info.handSave[nPos].nNum, 1, 1);
        //     arrayTemp[0].PlayCoverAnimate();
        //     arrayTemp[1].node.active = false;
        // }

        //直接显示下2张牌
        this.node.getChildByName("下一张牌").active = true;
        if(this.info.no_used_pai.length == 0)
        {
            arrayTemp[0].node.active = false;
            arrayTemp[1].node.active = false;
        }
        else if(this.info.no_used_pai.length == 1)
        {
            arrayTemp[0].node.active = true;
            arrayTemp[0].SetCardValue(this.info.no_used_pai[0][0], this.info.no_used_pai[0][1], 1, 1);
            arrayTemp[0].PlayCoverAnimate();
            arrayTemp[1].node.active = false;
        }
        else if(this.info.no_used_pai.length == 2)
        {
            arrayTemp[0].node.active = true;
            arrayTemp[0].SetCardValue(this.info.no_used_pai[0][0], this.info.no_used_pai[0][1], 1, 1);
            arrayTemp[0].PlayCoverAnimate();
            arrayTemp[1].node.active = true; 
            arrayTemp[1].SetCardValue(this.info.no_used_pai[1][0], this.info.no_used_pai[1][1], 1, 1);
            arrayTemp[1].PlayCoverAnimate();
        }



        this.scheduleOnce(()=>{
            this.node.getChildByName("下一张牌").active = false;
        },2);
        return true;
    }



    public TestMove(nPos:number)
    {
        this.GetTransHand();//Tool.GetChild(this.node,"handstop/handcardlist");
        this.transHand.opacity = 55;


        // if(this.arrayHand == null)
        //     this.arrayHand = this.transHand.getComponentsInChildren(PKCardInfoScript);
        this.GetArrayHandList();

        let card = this.arrayHand[nPos];

        card.ShowFace(1);
        card.PlayCoverAnimate();
    }

    public ModifyNodeOp(op:number)
    {
        //修改透明度

        //如果是丢牌则修改颜色
        if(op == 170)
        {
            this.node.getChildByName("handstop").opacity = 255;
            let arrayAll = Tool.GetChild(this.node,"handstop/丢牌余牌").getComponentsInChildren(PKCardInfoScript);
            for(let one of arrayAll)
            {
                one.node.getChildByName("BK0").color = cc.color(111,111,111,255);
            }
        }
        else
        {
            let arrayAll = Tool.GetChild(this.node,"handstop/丢牌余牌").getComponentsInChildren(PKCardInfoScript);
            for(let one of arrayAll)
            {
                one.node.getChildByName("BK0").color = cc.color(255,255,125511,255);
            }
            this.node.getChildByName("handstop").opacity = op;
        }

        
        let arrayAll =  Tool.GetChild(this.node,"PlayerInfo").children;
        for(let one of arrayAll)
        {
            if(one.name == "animateOut")
            {
                continue;
            }
            one.opacity = op;
        }
    }
    //获取手牌控件根
    public GetTransHand():cc.Node
    {
        //根据观战或打牌切换手牌
        if(this.playerPos == PlayerPos.self)
        {
            //自己需要知道是在观战还是打牌
            if(this.info.strUserID == this.gameLogic.strAccountUserID) //自己打牌
            {
                if(this.transHand == null ||this.transHand.name != "handcardlist")
                {
                    this.transHand = Tool.GetChild(this.node,"handstop/handcardlist");
                    this.transHand.active = true;
                    Tool.GetChild(this.node,"handstop/handcardlist2").active = false;
                }

            }
            else //自己观战
            {
                if(this.transHand == null || this.transHand.name != "handcardlist2")
                {
                    this.transHand = Tool.GetChild(this.node,"handstop/handcardlist2");
                    this.transHand.active = true;
                    Tool.GetChild(this.node,"handstop/handcardlist").active = false;
                }

            }
        }
        else
        {
            if (this.transHand == null)
                this.transHand = Tool.GetChild(this.node,"handstop/handcardlist");
        }
        return this.transHand;
    }
    //获取手牌组件列表
    public GetArrayHandList()
    {
        //根据观战或打牌切换手牌
        if(this.playerPos == PlayerPos.self)
        {
            //自己需要知道是在观战还是打牌
            if(this.info.strUserID == this.gameLogic.strAccountUserID) //自己打牌
            {
                if(this.arrayHand == null || this.arrayHand[0].node.parent.name !="handcardlist")
                {
                    this.GetTransHand();
                    this.arrayHand =  this.transHand.getComponentsInChildren(PKCardInfoScript);
                }

            }
            else //自己观战
            {
                if(this.arrayHand == null || this.arrayHand[0].node.parent.name !="handcardlist2")
                {
                    this.GetTransHand();
                    this.arrayHand =  this.transHand.getComponentsInChildren(PKCardInfoScript);
                }
            }
        }
        else
        {
            if(this.arrayHand == null)
                this.arrayHand =  this.transHand.getComponentsInChildren(PKCardInfoScript);
        }
        return this.arrayHand;
    }
    //投钱入芒池动画
    public ThrowGold2Mang()
    {
        let trasnCoinTar = Tool.GetChild(this.node,"goldshow/coin");
        let transHead = this.node.getChildByName("PlayerInfo");
        let transTar = Tool.GetChild(this.gameLogic.node,"ExShow/芒果标记");
        cc.loader.loadRes("Prefabs/drh/coin",(err,obj)=>{
            if(err)
            {
                cc.error(err.message || err);
                return null;
            }
            if(this.node == null)
                return

            let call = cc.callFunc(()=>{
                this.PlayAudio(0,"下注");
            });
            //现在头像->金币池-桌面->金币池
            let add:cc.Node = cc.instantiate(obj);
            add.parent = this.node;
            add.position = this.node.convertToNodeSpaceAR(transHead.convertToWorldSpaceAR(cc.v2(0,0)));
            let move2Coin = cc.moveTo(0.32,this.node.convertToNodeSpaceAR(trasnCoinTar.convertToWorldSpaceAR(cc.v2(0,0))))

            let move2Desk = cc.moveTo(0.32,this.node.convertToNodeSpaceAR(transTar.convertToWorldSpaceAR(cc.v2(0,0))));
            let end2Desk = cc.callFunc(()=>{
                add.position = this.node.convertToNodeSpaceAR(transHead.convertToWorldSpaceAR(cc.v2(0,0)));
            });

            let end = cc.callFunc(()=>{
                add.destroy();
                transTar.active = true;
                this.UpdateFenAnimate(true,this.info.beicount,false);
            },this);
            let action = cc.sequence(call,move2Coin,cc.delayTime(0.3),move2Desk,end2Desk,call,move2Coin,end);
            add.runAction(action);
        });

        this.scheduleOnce(()=>{
            this.UpdateFenAnimate(true,this.info.beicount,false);
            //Debug.Error("显示金币");
        },1.5);
    }
}
