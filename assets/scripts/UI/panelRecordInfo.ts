import UIPanelViewBase from "../common/UIPanelViewBase";
import GameDataManager from "../GameDataManager";
import ScrollViewEx from "../common/ScrollViewEx";
import Tool from "../common/Tool";
import ImageManager from "../logic/ImageManager";
import UIManager from "../common/UIManager";
import { CardInfo, ShowPanelMode } from "../common/GameDef";
import PKCardInfoScript from "../logic/PKCardInfoScript";
import DrhNameManager from "../logic/DrhNameManager";
import DrhLogicMgr from "../logic/DrhLogicMgr";
import Debug from "../common/Debug";
import MobileManager from "../mobile/MobileManager";
import { resolve } from "path";

var KBEngine = require("kbengine");
const {ccclass, property} = cc._decorator;

@ccclass
export default class panelRecordInfo extends UIPanelViewBase {

    private PAGE_PER_COUNT:string = "50";
    private strRoomID:string = "";
    private scrollRecordList:ScrollViewEx = null;
    private scrollRecordPlays:ScrollViewEx = null;
    private strCurDi:string = ""; //当前底皮

    private strGameTime:string = "";
    private strGameJiangChi:string = "";
    private strGameName:string = "";
    private strGameDipi:string = "";
    private strGameTimeDef:string = "";
    private strPlayMode:string = "";
    private strRound:string = "";
    private nTotleIn:number = 0;
    private nMaxWin:number = -9999999; //赢最多的人          
    private nMinWin:number = 99999999;     //输最多的人
    private nMaxIn:number = -1;            //最多带入的人
    private strMaxWinID:string = "";
    private strMinWinID:string = "";
    private strMaxInID:string = "";
    private strMaxWinName:string = "";
    private strMinWinName:string = "";
    private strMaxInName:string = "";

    private nLaoMo:number = 999999999;
    private strLaoMoID:string = "";
    private strLaoMoName:string = "";

    private strPingtai:string = "0"; //平台得到的奖励

    private nCurPage = 1;

    onLoad () {
        super.onLoad();

        this.scrollRecordList = Tool.GetChild(this.node,"战绩列表").getComponent(ScrollViewEx);
        this.scrollRecordPlays = Tool.GetChild(this.node,"牌局回顾/回顾列表").getComponent(ScrollViewEx);
        KBEngine.Event.register("ClubRoomPlayedScore", this, "OnClubRoomPlayedScore");
        KBEngine.Event.register("RoundScore", this, "OnRoundScore");
        KBEngine.Event.register("Paipu", this, "Paipu"); //文字牌谱
    }

    start () {
        this.strRoomID = this.strUserData;

        this.GetCreateRecord();
    }

    // update (dt) {}

    public onButtonClick(button:cc.Button)
    {
        if(button.node.name === "关闭")
        {
            if(cc.director.getScene().name == "drh8")
            {
                const roomLogic = cc.director.getScene().getComponentInChildren(DrhLogicMgr);
                if(roomLogic != null)
                    roomLogic.PrepareLeaveRoom();
                GameDataManager.getAccount().reqStopGame();
                GameDataManager.getAccount().reqLeaveRoom();
    
                UIManager.getInstance().showPanel("panelLoading",ShowPanelMode.Top);
                MobileManager.getInstance().OnTalkingEvent("退出房间","退出房间");
            }
            UIManager.getInstance().closePanelByName(this.node.name);
        }
        else if(button.node.name === "牌局回顾")
        {
            this.node.getChildByName("牌局回顾").active = true;
            Tool.GetChild(this.node,"牌局回顾/title/地九王").active = this.strPlayMode === "地方"?true:false;
            Tool.GetChild(this.node,"牌局回顾/操作/牌局回顾").getComponent(cc.Toggle).isChecked = true;
            this.ShowHistoryInfo(1);
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
            if(this.nCurPage+1 > Number(this.strRound))
                return;
            this.ShowHistoryInfo(this.nCurPage+1);
        }
        else if(button.node.name === "尾页")
        {
            if(Number(this.strRound)<=1)
                return;
            this.ShowHistoryInfo(Number(this.strRound));
        }
    }

    public onToggleClick(toggle:cc.Toggle)
    {
        if(toggle.node.name === "牌局回顾" || toggle.node.name === "文字牌谱")
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

    public GetCreateRecord(nPage:number = 0)
    {
        let strParam:string = "{\"header\":\"查询_俱乐部_房间_参与的牌局_信息\",\"room_id\":\"" + this.strRoomID + "\",\"page\":\"" + nPage.toString() + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_俱乐部_房间_参与的牌局_信息");
    }

    
    public OnClubRoomPlayedScore(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        if(data == null)
            return;
        let jList = data["ClubRoomPlayedScore"];
        let arrayTask = []
        for(let i=0;i<jList.length;i++)
        {
            let jItem = jList[i];
            if(i>=this.scrollRecordList.content.childrenCount)
            {
                let task = new Promise((resolve,reject)=>{
                    cc.loader.loadRes("Prefabs/战绩玩家对象",(err,obj)=>{
                        if(err)
                        {
                            cc.error(err.message || err);
                            return reject;
                        }
                        let node = cc.instantiate(obj);
                        // node.parent = this.scrollRecordList.content;
                        // node.setSiblingIndex(i);
                        //this.setRecordItemInfo(node,jItem,i,i==jList.length-1?this.UpdateMainShowInfo.bind(this):null);
                        resolve([node,jItem])
                    });
                })
                arrayTask.push(task)
            }
            else
            {
                let task = new Promise((resolve,reject)=>{
                    return resolve([this.scrollRecordList.content.children[i],jItem])
                })
               // this.setRecordItemInfo(this.scrollRecordList.content.children[i],jItem,i==jList.length-1?this.UpdateMainShowInfo.bind(this):null);
            }
        }


        Promise.all(arrayTask).then((ret)=>{
            for(var i=0;i<ret.length;i++)
            {
                let one = ret[i]
                let node = one[0]
                let jItem = one[1]
                node.parent = this.scrollRecordList.content;
                node.setSiblingIndex(i);
                this.setRecordItemInfo(node,jItem,i,i==ret.length-1?this.UpdateMainShowInfo.bind(this):null);
            }
        }).catch((err)=>{
            Debug.Log("有问题！")
        })



        //多余的对象全部删除
        let arrayDel = new Array<cc.Node>();
        for(let i=jList.length;i<this.scrollRecordList.content.childrenCount;i++)
        {
            arrayDel.push(this.scrollRecordList.content.children[i]);
        }
        for(let item of arrayDel)
        {
            item.destroy();
        }

 
    }

    public UpdateMainShowInfo()
    {
       //更新总体数据
       Tool.GetChild(this.node,"基本/房间名").getComponent(cc.Label).string = this.strGameName;
       Tool.GetChild(this.node,"基本/时长").getComponent(cc.Label).string = this.strGameTime;
       Tool.GetChild(this.node,"扩展/底皮").getComponent(cc.Label).string = this.strGameDipi;
       Tool.GetChild(this.node,"扩展/总手数").getComponent(cc.Label).string = this.strRound;
       Tool.GetChild(this.node,"扩展/总带入").getComponent(cc.Label).string = this.nTotleIn.toString();

       Tool.GetChild(this.node,"扩展/奖池").getComponent(cc.Label).string = this.strGameJiangChi;

       if(Number(this.strGameJiangChi)>0)
       {
            Tool.GetChild(this.node,"扩展/奖池").color = cc.Color.RED;
       }
       else if(Number(this.strGameJiangChi) == 0)
       {
            Tool.GetChild(this.node,"扩展/奖池").color = cc.Color.WHITE;
       }
       else{
            Tool.GetChild(this.node,"扩展/奖池").color = cc.Color.GREEN;
       }
       
       //更新排行
       Tool.GetChild(this.node,"排行/土豪/name").getComponent(cc.Label).string = this.strMaxInName;
       let imgth = Tool.GetChild(this.node,"排行/土豪/mask/img").getComponent(cc.Sprite);
       if (!ImageManager.getInstance().GetImageByName(this.strMaxInID, "", imgth))
       {
           ImageManager.getInstance().AddWaitFreshImage2Catch(this.strMaxInID, imgth);
       }

       Tool.GetChild(this.node,"排行/MVP/name").getComponent(cc.Label).string = this.strMaxWinName;
       let imgmvp = Tool.GetChild(this.node,"排行/MVP/mask/img").getComponent(cc.Sprite);
       if (!ImageManager.getInstance().GetImageByName(this.strMaxWinID, "", imgmvp))
       {
           ImageManager.getInstance().AddWaitFreshImage2Catch(this.strMaxWinID, imgmvp);
       }

       Tool.GetChild(this.node,"排行/大鱼/name").getComponent(cc.Label).string = this.strMinWinName;
       let imgdy = Tool.GetChild(this.node,"排行/大鱼/mask/img").getComponent(cc.Sprite);
       if (!ImageManager.getInstance().GetImageByName(this.strMinWinID, "", imgdy))
       {
           ImageManager.getInstance().AddWaitFreshImage2Catch(this.strMinWinID, imgdy);
       }

       Tool.GetChild(this.node,"排行/劳模/name").getComponent(cc.Label).string = this.strLaoMoName;
       let imglm = Tool.GetChild(this.node,"排行/劳模/mask/img").getComponent(cc.Sprite);
       if (!ImageManager.getInstance().GetImageByName(this.strLaoMoID, "", imglm))
       {
           ImageManager.getInstance().AddWaitFreshImage2Catch(this.strLaoMoID, imglm);
       }

       Tool.GetChild(this.node,"基本/地九王").active = this.strPlayMode === "地方"?true:false;

        //平台奖励
        // Tool.GetChild(this.node,"扩展/平台").getComponent(cc.Label).string = this.strPingtai;
        // if(Number(this.strPingtai)>0)
        // {
        //     Tool.GetChild(this.node,"扩展/平台").color = cc.Color.RED; 
        // }
        // else 
        // {
        // Tool.GetChild(this.node,"扩展/平台").color = cc.Color.WHITE; 
        // }
    }


    public setRecordItemInfo(node:cc.Node,jItem:any,index:number,action:Function = null)
    {
        node.active = true;

        let strID:string = jItem["user_guuid"].toString();
        let strName:string = jItem["user_name"].toString();
        let strIn:string = jItem["remark"].toString();
        let strEx:string = jItem["remark2"].toString();
        let strTemp:string = jItem["all_remark"].toString();
        this.strRound = jItem["rounds"].toString();
        let strScore:string = jItem["score"].toString();

        let arrayTemp = strTemp.split(',');

        let arrayEx = strEx.split(',');
        this.strGameTime = arrayEx[0] + "  " + arrayEx[1];
        this.strGameJiangChi = arrayEx[2];
        let strShou:string = arrayEx[3];
        this.strGameName = arrayEx[4];
        this.strGameDipi = arrayEx[5];
        this.strGameTimeDef = arrayEx[6];
        this.strPingtai = arrayEx[7];

        this.strPlayMode = arrayTemp.length <= 10 ? "" : arrayTemp[10];
        this.strCurDi = this.strGameDipi;

        let nScore = Number(strScore);
        let nIn = Number(strIn);
        if (nScore > this.nMaxWin)
        {
            this.nMaxWin = nScore;
            this.strMaxWinID = strID;
            this.strMaxWinName = strName;
        }
        if (nScore < this.nMinWin)
        {
            this.nMinWin = nScore;
            this.strMinWinID = strID;
            this.strMinWinName = strName;
        }
        if (nIn > this.nMaxIn)
        {
            this.nMaxIn = nIn;
            this.strMaxInID = strID;
            this.strMaxInName = strName;
        }
        this.nTotleIn += nIn;


        if (Math.abs(nScore) <= this.nLaoMo)
        {
            this.nLaoMo = Math.abs(nScore);
            this.strLaoMoID = strID;
            this.strLaoMoName = strName;
        }

        
        node.getChildByName("名字").getComponent(cc.Label).string = jItem["user_name"];
        node.getChildByName("id").getComponent(cc.Label).string = "ID:"+strID;
        node.getChildByName("带入").getComponent(cc.Label).string = "带入:"+ this.CheckSmallPlay(strIn);
        node.getChildByName("手数").getComponent(cc.Label).string = "手数:"+ strShou;
        

        if (Number(strScore) > 0)
        {
            node.getChildByName("输赢").getComponent(cc.Label).string = "+" + this.CheckSmallPlay(strScore);
            node.getChildByName("输赢").color = cc.Color.RED;            
        }
        else if (Number(strScore) < 0)
        {
            node.getChildByName("输赢").getComponent(cc.Label).string = this.CheckSmallPlay(strScore);;
            node.getChildByName("输赢").color = cc.color(21, 255, 139, 255);
        }
        else
        {
            node.getChildByName("输赢").getComponent(cc.Label).string = this.CheckSmallPlay(strScore);;            
        }

        //惩罚问题
        if (arrayTemp[9] != "0" && arrayTemp[9] != "")
        {
            node.getChildByName("惩罚").active = true;           
            

            if(arrayTemp[9].indexOf("-")>=0) 
            {
                node.getChildByName("惩罚").getComponent(cc.Label).string = "逃跑被惩罚" + this.CheckSmallPlay(arrayTemp[9]);
                node.getChildByName("惩罚").color = cc.color(97,255,58,255);
            }
            else
            {
                node.getChildByName("惩罚").getComponent(cc.Label).string = "赢得逃跑惩罚" + this.CheckSmallPlay(arrayTemp[9]);
                node.getChildByName("惩罚").color = cc.Color.RED;
            }
        }
        //头像
        let img = Tool.GetChild(node,"头像/mask/img").getComponent(cc.Sprite);
        if (!ImageManager.getInstance().GetImageByName(strID, "", img))
        {
            ImageManager.getInstance().AddWaitFreshImage2Catch(strID, img);
        }

        //索引
        let idx:number = index+1;
        if(idx<=3) //显示图片
        {
            node.getChildByName("idx").active = true;            
            node.getChildByName("idx2").active = false;
            node.getChildByName("idx").getComponent(cc.Label).string = idx.toString();
        }
        else
        {
            node.getChildByName("idx").active = false;            
            node.getChildByName("idx2").active = true;  
            node.getChildByName("idx2").getComponent(cc.Label).string = idx.toString();
        }
        
        if(action)
        {
            action();
        }

    }

    //检测是否小皮玩法,
    public CheckSmallPlay(strNum:string):string
    {        
        if ((this.strCurDi.indexOf("0.1/0.3") >= 0 || this.strCurDi.indexOf("0.2/0.5") >= 0) && strNum != "敲" && strNum != "")
        {

            let fOut =  Number(strNum) / 10;
            return parseInt(fOut.toString()).toString();
        }
        else
        {
            return strNum;
        }
    }

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
            Tool.GetChild(this.node,"牌局回顾/分页/页码").getComponent(cc.Label).string = nRound.toString()+"/"+this.strRound;
            let strParam = "{\"header\":\"查询_房间_玩家_战绩_信息\",\"room_id\":\"" + this.strRoomID + "\",\"round_id\":\"" + nRound.toString() + "\"}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "@查询_房间_玩家_战绩_信息");
        }
    }
    public ShowHistoryPaiPuInfo(nRound:number)
    {
        if (nRound > 0)
        {
            this.nCurPage = nRound;
            Tool.GetChild(this.node,"牌局回顾/分页/页码").getComponent(cc.Label).string = nRound.toString()+"/"+this.strRound;
            let strParam = "{\"header\":\"查询_房间_玩家_牌谱_信息\",\"room_id\":\"" + this.strRoomID + "\",\"round_id\":\"" + nRound.toString() + "\"}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "@查询_房间_玩家_牌谱_信息");
        }
    }


    private strOther9:string = "";
    private strShowPai:string = "";
    public OnRoundScore(strMsg:string)
    {
        Tool.GetChild(this.node,"牌局回顾/title/平台").getComponent(cc.Label).string = "";
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
                if(i>=this.scrollRecordPlays.content.childrenCount)
                {
                    cc.loader.loadRes("Prefabs/回顾对象2",(err,obj)=>{
                        if(err)
                        {
                            cc.error(err.message || err);
                            return null;
                        }
                        let node = cc.instantiate(obj);
                        node.parent = this.scrollRecordPlays.content;
                        this.setItemInfo(node,jItem);
                    });
                }
                else
                {
                    this.setItemInfo(this.scrollRecordPlays.content.children[i],jItem);
                }
            }
            //多余的对象全部删除
            let arrayDel = new Array<cc.Node>();
            for(let i=jPlayers.length;i<this.scrollRecordPlays.content.childrenCount;i++)
            {
                arrayDel.push(this.scrollRecordPlays.content.children[i]);
            }
            for(let item of arrayDel)
            {
                item.destroy();
            }
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
        this.strOther9 = arrayAll[9]; //奖池

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
                        one.node.color = cc.Color.GREEN//cc.color(21, 255, 139, 255);
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
               }
               else 
               {
                    one.node.active = true;
               }
               let nP = strTxt.indexOf(":");
              // one.node.color = cc.Color.WHITE;
               if(nP>0)
               {
                    if(strTxt.indexOf(',')>=0) //有喜金
                    {
                        let arrayTemp = strTxt.split(",");
                        strTxt = arrayTemp[0];
                        let strPing = arrayTemp[1];
                        Tool.GetChild(this.node,"牌局回顾/title/平台").getComponent(cc.Label).string = strPing;
                    }

                   let strSub1 = strTxt.substr(0, nP+1);
                   let strSub2 = strTxt.substr(nP + 1);
                   strSub2 = this.CheckSmallPlay(strSub2);
                   one.string = strSub1 + strSub2;
                   if(strTxt.indexOf("喜金")>=0)
                   {
                       if(Number(strSub2)>=0)
                       {
                           one.node.color = cc.Color.RED;
                       }
                       else if(Number(strSub2)<0)
                       {
                           one.node.color = cc.Color.GREEN;
                       }
                   }
               }
               else
               {
                   one.string = this.CheckSmallPlay(strTxt);
               }

               
           }

        //    if (strShowScore.indexOf("-") >= 0)
        //    {
        //        objNew.getChildByName("score").color = cc.color(21, 255, 139, 255);
        //    }
        //    else if (strShowScore.indexOf("+") >= 0)
        //    {
        //        objNew.getChildByName("score").color = cc.Color.RED;
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
                            let imgLine = handCard[nPos].node.getChildByName("line")
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
                cc.loader.loadRes("Prefabs/文字牌谱对象2",(err,obj)=>{
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
