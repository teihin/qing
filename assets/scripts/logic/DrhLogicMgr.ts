import panelGameView from "../UI/panelGameView";
import DrhPlayerLogic from "./DrhPlayerLogic";
import { PlayerPos, DrhPlayerInfo, ShowPanelMode, PlayerState } from "../common/GameDef";
import Debug from "../common/Debug";
import GameDataManager from "../GameDataManager";
import Tool from "../common/Tool";
import UIManager from "../common/UIManager";
import ImageManager from "./ImageManager";
import GpsManager from "./GpsManager";
import MobileManager from "../mobile/MobileManager";
import ScrollViewEx from "../common/ScrollViewEx";

var KBEngine = require("kbengine");

const {ccclass, property} = cc._decorator;

Array.prototype["Clear"] = function(){

}

@ccclass
export default class DrhLogicMgr extends cc.Component {

    MAX_PLAYER = 8; //房间最大人数

    public playingView:panelGameView = null;
    arrayPlayer = new Array<DrhPlayerLogic>();
    arrayInfo = new Array<DrhPlayerInfo>();

    public nSelfIndex = 0; //自己所在房间位置
    public strGameState = ""; //当前房间状态
    public strCreatorID = ""; //创建者ID
    public strCreatorName = ""; //创建者名字
    public strMsgRoomID = ""; //消息来源房间号
    public strClubID = ""; //俱乐部ID

    public game_round = "0";
    public round_count = "0";
    public txtTime:cc.Label;

    strRoomDipi:string = "";
    strRoomName:string = "";
    strRoomTime:string = "";

    public strStartTime = ""; //开始时间
    public strEndTime = ""; //结束时间
    private nCloseRoomTime:number; //关闭房间倒计时
    public bShowOverAnimate = false;  //结算动画进行中
    public strLastDelayMsg = "";  //动画过程中延迟的消息
    private  nLastPlayerCount = 0; //上一次playlist人数

    public  arraySited = new Array<string>(); //已经坐下过的用户
    public  arrayHisIn = new Array<string>(); //已经打过并且需要带入且不是0分的人

    public mapID2DismisInfo = new Map<string, string>();
    

    public mapID2PlayerCtl = new Map<number, DrhPlayerLogic>();    //座位号到用户组件的映射关系

    public _CloseRoomTimmerCallBack = null;
    private bIsGamePlaying = false;    //玩家是非已经在游戏中
    private bLeavingRoom = false;      //退出流程开始后停止房间动画和延迟回调
    public nTimeLeft = 0;  //时间倒计时

    public bGuanzhanFirst = false;
    public bGuanzhanMode = false;

    public arraySaySave = new Array<string>(); //语音队列缓存
    public bSaying = false; //是否正在播放语音

    public game_end_time = 1800; //房间剩余时间

    public self;

    public arrayTalkMsg = new Array<string>(); //聊天缓存

    public mapID2LastSay = new Map<string,string>();  //用户id到最后语音缓存

    public arrayNoAudio = new Array<string>(); //禁用语音列表
    public strAccountUserID = ""; //当前用户ID
    onLoad () {        
        this.playingView = this.getComponent(panelGameView);
        this.strAccountUserID = GameDataManager.getAccount().guuid;

        this.initLogic();
        this.UpdateAllUserShowInfo();

        let strSet = GameDataManager.getAccount().roomSetting;
        let json = JSON.parse(strSet);
        this.MAX_PLAYER = json["max_number"];

        this.node.getChildByName("坐下控制").active = true;

        GameDataManager.getAccount().reqPlayerList();
        GameDataManager.getAccount().reqExec("查询_解散_事件")

        this.txtTime = Tool.GetChild(this.node,"BK/time").getComponent(cc.Label);

        this.self = this;

        //注册程序切换后台前台消息
        cc.game.on(cc.game.EVENT_HIDE,()=>{
            //程序进入后台            
            KBEngine.Event.deregister("状态鸡", this, "OnServerPlayEvent");
        },this);
        cc.game.on(cc.game.EVENT_SHOW,()=>{
            //程序进入前台            
            KBEngine.Event.register("状态鸡", this, "OnServerPlayEvent");
            KBEngine.Event.fire("OnPlayNextAudio"); 

            GameDataManager.getAccount().reqGetFullMessage();

            //如果自己在座位上打如果关闭了GPS则提示并留坐
            let strSelfID = GameDataManager.getAccount().guuid;
            if(this.GetPlayerCtlByID(0).info.strUserID == strSelfID && this.GetPlayerCtlByID(0).info.site_countdown =="0")
            {
                //校验下GPS，如果没有打开则提示并留坐
                if (!GpsManager.getInstance().IsGpsOpen())
                {
                    UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"检测到GPS未打开，即将自动留坐!");                    
                    GameDataManager.getAccount().reqRoomCommand("{\"header\":\"留座_事件\"}", "留座_事件");
                }
            }

        },this);


    }

    start () {

    }

    onDestroy(){
        this.PrepareLeaveRoom();
        if(MobileManager.instance != null)
            MobileManager.instance.LeaveVoiceRoom();
        cc.game.targetOff(this);
        KBEngine.Event.deregisterAll(this);
        this.unscheduleAllCallbacks();
        this.node.stopAllActions();
    }

    public IsLeavingRoom():boolean
    {
        return this.bLeavingRoom;
    }

    public PrepareLeaveRoom()
    {
        if(this.bLeavingRoom)
            return;
        this.bLeavingRoom = true;
        this.unscheduleAllCallbacks();
        if(cc.isValid(this.node))
            this.node.stopAllActions();
        for(const player of this.arrayPlayer)
        {
            if(player != null)
                player.PrepareLeaveRoom();
        }
    }

    update (dt) {
        if(this.txtTime != null)
        {
            let time = new Date();
            this.txtTime.string = time.getHours().toString().padStart(2,"0")+":"+time.getMinutes().toString().padStart(2,"0");
        }
    }

    initLogic()
    {
        this.arrayPlayer = this.node.getComponentsInChildren(DrhPlayerLogic);
        this.arrayPlayer.forEach((item,idx,array)=>{
            item.gameLogic = this;
        },this);

        this.arrayPlayer[0].playerPos = PlayerPos.self;

        //初始化用户数据
        for(let i=0;i<this.MAX_PLAYER;i++)
        {
            let item = new DrhPlayerInfo();
            item.ResetAll(true);
            this.arrayInfo.push(item);            
        }
        //注册监听消息
        KBEngine.Event.register("PlayerList", this, "OnUpdatePlayerList");
        KBEngine.Event.register("状态鸡", this, "OnServerPlayEvent");
        KBEngine.Event.register("SayInfo", this, "OnPlayerSay");
        KBEngine.Event.register("ClientDeath", this, "OnClientDeath");
        KBEngine.Event.register("EntitiesEnabled", this, "OnClientActive");
        KBEngine.Event.register("OnPlayNextAudio", this, "OnPlayNextAudio");
        KBEngine.Event.register("DismissInfo", this, "OnDismissInfo");
    }

    public OnDismissInfo(strMsg:string)
    {      
        //解析并设置内容
        let data = JSON.parse(strMsg);
        let arrayDisList = data["DismissInfo"];
        for (let i = 0; i < arrayDisList.length; i++)
        {
            let one = arrayDisList[i];
            let nSitNum = Number(one["num"].toString());
            let strID = one["id"].toString();

            if (this.arrayInfo.length <= 0)
                break;
            if(nSitNum>8) //过滤掉999的人
                continue;
            //定位并设置内容
            let player = this.arrayInfo[nSitNum];
            player.game_command = one["status"].toString();
            this.mapID2DismisInfo[strID] = player.game_command;
        }

        //解析请求状态
        let strRootState = data["room_status"].toString();
        let countdown = data["countdown"].toString();
        if (strRootState == "要求_解散_状态") //弹出面板
        {

        }
        else if (strRootState == "游戏_状态" || strRootState == "有人_状态") //关闭面板继续游戏
        {

        }
        else if (strRootState == "关闭_状态")
        {
            //直接返回大厅了，不用等
            this.PrepareLeaveRoom();
            GameDataManager.getAccount().roomID = "";
            GameDataManager.getAccount().reqStopGame();
            GameDataManager.getAccount().reqLeaveRoom();

            UIManager.getInstance().showPanel("panelLoading",ShowPanelMode.Top);
            KBEngine.Event.fire("onGoToMain");
            //GameDataManager.Instance.curScenseCtl.ShowPanel("panelMain", ShowPanelMode.CloseOther);
        }
        else if (strRootState == "结算_状态")
        {
            //等待playlist进入结算
        }

    }

    OnUpdatePlayerList(strMsg:string)
    {
        if(this.bLeavingRoom)
            return;
        let maxWinPlayer:DrhPlayerInfo = null;
        let data = JSON.parse(strMsg)
        if(data === null)
        {
            Debug.Log("PlayList 解析失败！");
            return;
        }

        let nMaxNum = -99999;
        //房间游戏状态
        this.strGameState = data["GameStatus"].toString();
        if (data.hasOwnProperty("creater_id"))
        {
            this.strCreatorID = data["creater_id"].toString();
        }
        if (data.hasOwnProperty("club_id"))
        {
            this.strClubID = data["club_id"].toString();
        }

        let strSet = GameDataManager.getAccount().roomSetting;
        let strSelfID = GameDataManager.getAccount().guuid;


        if (data.hasOwnProperty("creator_name"))
        {
            this.strCreatorName = data["creator_name"];
        }
        //消息来源房间号；通过当前房间校验后再写入，避免迟到的旧房PlayerList污染上下文。
        let strPlayerListRoomID = "";
        if (data.hasOwnProperty("room_id"))
        {
            strPlayerListRoomID = data["room_id"].toString();
        }
        let nTimeCountDown = 0;
        if(data.hasOwnProperty("ready_countdown"))
        {
            nTimeCountDown = Number(data["ready_countdown"].toString())
        }

        if(data.hasOwnProperty("start_round_time"))
        {
            this.strStartTime = data["start_round_time"].toString();
        }
        if (data.hasOwnProperty("end_round_time"))
        {
            this.strEndTime = data["end_round_time"].toString();
        }
        if(data.hasOwnProperty("a_h_m_w"))
        {
            Tool.ClearArray(this.arraySited);            
            let jSitedList = data["a_h_m_w"];
            for(let i=0;i<jSitedList.length;i++)
            {
                this.arraySited.push(jSitedList[i].toString());
            }
        }
        if (data.hasOwnProperty("a_p_n_m"))
        {
            Tool.ClearArray(this.arrayHisIn);            
            let jSitedList = data["a_p_n_m"];
            for (let i = 0; i < jSitedList.length; i++)
            {
                this.arrayHisIn.push(jSitedList[i].toString());
            }
        }
        if (data.hasOwnProperty("game_end_time"))
        {
            this.game_end_time = data["game_end_time"];
        }

        if(data.hasOwnProperty("total_reward_money"))
        {
            let strJiang = data["total_reward_money"].toString();
            this.UpdateCurJiangChi(strJiang);
        }

        if(data.hasOwnProperty("closeroom_countdown"))
        {
            this.nCloseRoomTime = Number(data["closeroom_countdown"].toString());
        }

        let strRoomID = GameDataManager.getAccount().roomID;
        if (strRoomID != strPlayerListRoomID)
        {
            if(strRoomID == "0" && this.strGameState == "end")
            {
                this.GetPlayerCtlByID(0).ShowCmdPad(false, 0);

               // GameDataManager.getAccount().reqSetProperty("roomType", "");

                UIManager.getInstance().closePanelByName("panelDissolveDrh");
                UIManager.getInstance().closePanelByName("panelDrhOverView");

                let arrayParam = new Array<string>();
                arrayParam.push(strRoomID);
                arrayParam.push(this.strRoomName);
                arrayParam.push(this.strRoomDipi);
                arrayParam.push(this.strRoomTime);
                UIManager.getInstance().showPanel("panelDrhClubEnd",ShowPanelMode.Cover,"",arrayParam);                

                Tool.GetChild(this.node,"RoomFrame/ConfigMain").active = false;                
            }
            Debug.Log("跳出list1");
            return;
        }
        this.strMsgRoomID = strPlayerListRoomID;

        if (this.bShowOverAnimate) //动画过程中不处理内容
        {
            this.strLastDelayMsg = strMsg;
            Debug.Log("跳出list2");
            return;
        }

        let nRealPlayerCount = 0; //真实玩家(排除留坐玩家)
        let mapUpdateList = new Map<number, DrhPlayerInfo>();
        //用户信息处理
        let arrayJsonPlayer = data["Players"];
        if(arrayJsonPlayer.length!= this.nLastPlayerCount)
        {
            //玩家人数发生变化，重新校验下GPS信息
            this.playingView.UpdateGPSInfo();
        }
        this.nLastPlayerCount = arrayJsonPlayer.length;
        for (let i = 0; i < arrayJsonPlayer.length; i++)
        {
            let one = arrayJsonPlayer[i];
            let player = new DrhPlayerInfo();

            let nSitNum = Number(one["num"].toString());
            mapUpdateList.set(nSitNum, player);

            player.nSitNum = nSitNum;
            player.strUserID = one["id"].toString();
            if (player.strUserID == "init") //此位置当前没人
            {
                this.arrayInfo[player.nSitNum] = player;
                //复位当前个人信息(除座位号)
                player.ResetAll(true);
                continue;
            }

            //在线离线信息
            if (one.hasOwnProperty("client_death"))
            {
                player.strDeadState = one["client_death"].toString();
            }

            //用户当前游戏状态
            let strState = one["status"].toString();
            player.emState = this.GetStateFromString(strState);

            //解析基本用户信息
            player.strUserName = one["name"].toString();
            player.strSex = one["sex"].toString();
            if(one.hasOwnProperty("photo"))
            {
                player.strPhoto = ImageManager.getInstance().NormalizeAvatarIndex(one["photo"]);
            }
            player.nGoldNum = Number(one["gold"].toString());
            player.nDiamondNum = Number(one["stone"].toString());
            if (one.hasOwnProperty("ip"))
            {
                player.strIP = one["ip"];
            }

            if(one.hasOwnProperty("auto_ready"))
            {
                player.auto_ready = one["auto_ready"].toString();
            }

            if(one.hasOwnProperty("remark"))
            {
                player.remark = one["remark"];
            }

            if(one.hasOwnProperty("site_countdown"))
            {
                player.site_countdown = one["site_countdown"].toString();
            }
            if(one.hasOwnProperty("is_can_return"))
            {
                player.is_can_return = one["is_can_return"].toString();
            }
            if(one.hasOwnProperty("req_club_id"))
            {
                player.req_club_id = one["req_club_id"].toString();
            }


            //解析总结
            player.total_score = one["total_score"].toString();
            let nTotleScore = Number(player.total_score);
            if (nTotleScore > nMaxNum)
            {
                nMaxNum = nTotleScore;
                maxWinPlayer = player;
            }
            player.begin_score = one["init_money"].toString();
            player.nGoldNum = Number(one["money_score"].toString());

            //如果是本人，则更新自己所在位置
            if (player.strUserID == GameDataManager.getAccount().guuid)
            {
                this.nSelfIndex = nSitNum;
                GameDataManager.getInstance().nSelfPlayerSit = nSitNum;                
            }

            //设置解散信息
            if (this.mapID2DismisInfo.has(player.strUserID))
            {
                player.game_command = this.mapID2DismisInfo.get(player.strUserID);
            }

            //保存数据
            this.arrayInfo[nSitNum] = player;

            if(player.site_countdown == "0")
            {
                nRealPlayerCount++;
            }
        }

        //设置大赢家
        if (maxWinPlayer != null)
        {
            maxWinPlayer.totale_win = "1";
        }
        
        this.bGuanzhanMode = true;

        
        //绑定玩家数据到组件
        //PlayerList是座位关系的全量快照，重建前清理旧房或旧座位映射。
        this.mapID2PlayerCtl.clear();
        let nTemp = this.nSelfIndex;
        for (let i = 0; i < this.arrayPlayer.length; i++)
        {
            //如果已经绑定过数据且是同一个人则只更新基本信息
            if (this.arrayPlayer[i].info != null && this.arrayPlayer[i].info.strUserID == this.arrayInfo[nTemp].strUserID)
            {
                let oldAvatarIndex = this.arrayPlayer[i].info.strPhoto;
                //部分旧版PlayerList不带photo，保留已经查询到的头像序号。
                if(this.arrayInfo[nTemp].strPhoto == "")
                    this.arrayInfo[nTemp].strPhoto = oldAvatarIndex;
                this.arrayPlayer[i].info.BaseClone(this.arrayInfo[nTemp]);
                if(this.arrayPlayer[i].info.strPhoto != "" && this.arrayPlayer[i].info.strPhoto != oldAvatarIndex)
                {
                    ImageManager.getInstance().SetLocalAvatar(
                        this.arrayPlayer[i].GetImgCtl(),
                        this.arrayPlayer[i].info.strPhoto,
                        this.arrayPlayer[i].info.strUserID
                    );
                }
            }
            else
            {
                this.arrayPlayer[i].info = this.arrayInfo[nTemp];
                this.arrayPlayer[i].info.bClone = false;
                let img = this.arrayPlayer[i].GetImgCtl();

                //先显示本地头像1，收到字段序号后再切换到对应本地头像。
                ImageManager.getInstance().SetLocalAvatar(img,"1");
                
                let hasAvatar = ImageManager.getInstance().GetImageByName(
                    this.arrayPlayer[i].info.strUserID,
                    this.arrayPlayer[i].info.strPhoto,
                    img
                );
                if (this.arrayPlayer[i].info.strPhoto == "")
                {
                    // PlayerList没有photo时，即使本地缓存命中也必须刷新一次。
                    // 否则用户ID曾缓存为头像1后，新入座将永远跳过服务端查询。
                    ImageManager.getInstance().AddWaitFreshImage2Catch(this.arrayPlayer[i].info.strUserID, img);
                }
                else if (!hasAvatar)
                {
                    ImageManager.getInstance().AddWaitFreshImage2Catch(this.arrayPlayer[i].info.strUserID, img);
                }

                if (i == 0) //自己坐下了，需要更新全量
                {
                    GameDataManager.getAccount().reqGetFullMessage();
                    let strUserID = GameDataManager.getAccount().guuid;
                    if (this.arrayPlayer[i].info.strUserID == strUserID)
                        this.GetPlayerCtlByID(0).PlayAudio(0, "坐下");
                }
            }

            //检测玩家是否存在更新，如果不存了，需要复位玩家信息
            if (!mapUpdateList.has(nTemp))
            {
                this.arrayPlayer[i].info.strUserID = "init";
            }

            if (++nTemp >= this.MAX_PLAYER)
                nTemp -= this.MAX_PLAYER;

            //设置每个玩家的位置定义
            if (i == 0)
                this.arrayPlayer[i].playerPos = PlayerPos.self;
            else
                this.arrayPlayer[i].playerPos = PlayerPos.other;

            //更新座位映射
            if(this.arrayPlayer[i].info.strUserID != "init")
                this.mapID2PlayerCtl.set(this.arrayPlayer[i].info.nSitNum, this.arrayPlayer[i]);

            if (this.arrayPlayer[i].info.emState == PlayerState.ready/* || arrayPlayer[i].info.emState == PlayerState.init*/)
            {
                this.arrayPlayer[i].info.ResetGameInfo();
            }

            if (strSelfID == this.arrayPlayer[i].info.strUserID && this.arrayPlayer[i].info.emState != PlayerState.init)
                this.bGuanzhanMode = false;
        }


        this.game_round = data["game_round"].toString();
        this.round_count = data["round_count"].toString();

        
        this.playingView.setRoomInfo();


        if(arrayJsonPlayer.length <4 && this.round_count == "0")
        {
            this.node.getChildByName("等待开局提示").active = true;

            let txt = Tool.GetChild(this.node,"等待开局提示/开局倒计时").getComponent(cc.Label);            
            this.unschedule(this._CloseRoomTimmerCallBack);            
            this._CloseRoomTimmerCallBack = this.CloseRoomTimmer.bind(this,txt);
            this.schedule(this._CloseRoomTimmerCallBack,1,cc.macro.REPEAT_FOREVER,0.1);
        }
        else
        {
            this.node.getChildByName("等待开局提示").active = false;
            if(this._CloseRoomTimmerCallBack != null)
                this.unschedule(this._CloseRoomTimmerCallBack);
        }


        //更新当前玩家基本信息
        this.UpdateAllUserShowInfo();
        this.UpdateSitInfo();
        this.playingView.OnPlayerListUpdatedForPreSit();

        //准备阶段如果房间列表中没有自己则显示坐下
        let bFind = false;
        let nUserCount = 0;

        this.arrayPlayer.forEach((one,idx,array)=>{
            if (one.info.strUserID == strSelfID)
            {
                bFind = true;
            }
            if (one.info.strUserID != "init")
            {
                nUserCount++;
            }
        },this);

        //如果没有坐下则复位自己位置为旁观
        if (strSelfID != this.GetPlayerCtlByID(0).info.strUserID)
        {
            GameDataManager.getInstance().nSelfPlayerSit = 999;            
        }


        //处理房间状态，并做出对应动作
        if (this.strGameState == "init") //还有人没有准备
        {
            //复位游戏标记
            this.bIsGamePlaying = false;
            this.ClearCoin();
            
            this.nTimeLeft = nTimeCountDown;
        }
        else if (this.strGameState == "ready") //当前所有人都准备好了
        {
            this.strLastDelayMsg = "";
            this.StartGame();
        }
        else if (this.strGameState == "running" && this.bIsGamePlaying) //游戏中(自己已经进入)
        {

        }
        else if (this.strGameState == "running" && !this.bIsGamePlaying) //游戏中（自己还没进入）处理掉线恢复或者加入了已经开始游戏的房间
        {
            this.ClearCoin();
            //获取下全量
            if (!this.bIsGamePlaying)
                GameDataManager.getAccount().reqGetFullMessage();
            this.bIsGamePlaying = true;            
        }
        else if (this.strGameState == "end")
        {
            this.GetPlayerCtlByID(0).ShowCmdPad(false, 0);

           // GameDataManager.getAccount().setDefinedProperty("roomType", "");
            UIManager.getInstance().closePanelByName("panelDissolveDrh");
            UIManager.getInstance().closePanelByName("panelDrhOverView");

            let arrayParam = new Array<string>();
            arrayParam.push(strRoomID);
            arrayParam.push(this.strRoomName);
            arrayParam.push(this.strRoomDipi);
            arrayParam.push(this.strRoomTime);
            
            Tool.GetChild(this.node,"ConfigMain").active = false;            
            
            UIManager.getInstance().showPanel("panelRecordInfo",ShowPanelMode.Cover,strRoomID);
        }
    }

    //更新所有玩家基本信息
    UpdateAllUserShowInfo()
    {
        this.arrayPlayer.forEach((item,idx,array)=>{
            item.UpdateUserInfo();
        },this);
    }

    public GetPlayerCtlByID(nIndex:number):DrhPlayerLogic
    {
        return this.arrayPlayer[nIndex];
    }
   //转换字符串到玩家状态
   public GetStateFromString(strState:string):PlayerState
   {
       let psReturn = PlayerState.init;
       switch (strState)
       {
           case "init":
               psReturn = PlayerState.init;
               break;
           case "ready":
               psReturn = PlayerState.ready;
               break;
           case "running":
               psReturn = PlayerState.running;
               break;
           case "offline":
               psReturn = PlayerState.offline;
               break;
           case "leave":
               psReturn = PlayerState.leave;
               break;
       }
       return psReturn;
   }
   //关闭房间倒计时schedle方法
   public CloseRoomTimmer(txt:cc.Label)
   {
        if(this.nCloseRoomTime>=0)
        {
            let time = new Date(0,0,0,0,0,this.nCloseRoomTime--,0);
            txt.string = "房间2小时不开始将自动解散\r\n倒计时:"+time.getHours().toString().padStart(2,"0")+":"+time.getMinutes().toString().padStart(2,"0")+":"+time.getSeconds().toString().padStart(2,"0");
        }
        else
        {
            this.unschedule(this._CloseRoomTimmerCallBack);
        }
   }
   public UpdateSitInfo()
   {
       let transRoot = this.node.getChildByName("坐下控制");

        transRoot.children.forEach((one,nPos,array)=>{
            if (this.arrayPlayer[nPos].info.strUserID == "init")
            {
                one.active = true;
            }
            else
            {
                one.active = false;
            }
        },this);
   }
   public ClearCoin()
   {
       let transGold = this.node.getChildByName("goldshow");
       if (transGold != null)
       {
            transGold.removeAllChildren();
       }
   }
   public StartGame()
   {
       //进入游戏标记打开
       this.bIsGamePlaying = true;
       this.ClearCoin();
       
   }
    //状态机消息处理
    public OnServerPlayEvent(strMsg:string)
    {
        if(this.bLeavingRoom)
            return;
        let data = JSON.parse(strMsg);        
        //定位这消息给谁的
        let nSitNum = Number(data["player_number"].toString());
        if (nSitNum >= 0 && this.mapID2PlayerCtl.size > 0)
        {
            let one = this.mapID2PlayerCtl.get(nSitNum)
            if(one == null || one == undefined)
                return
            this.mapID2PlayerCtl.get(nSitNum).DeelMsg(data);
        }
    }

    //开始游戏结算前比牌
    public StartGameCompare(strOverType:string)
    {
        let strUserID = GameDataManager.getAccount().guuid;
        //显示结束看牌相关按钮
        
        if(this.GetPlayerCtlByID(0).info.strUserID == strUserID && !Tool.GetChild(this.GetPlayerCtlByID(0).node,"PlayerInfo/扩展状态").active && this.GetPlayerCtlByID(0).info.site_countdown == "0")
        {
            this.node.getChildByName("cmd6").active = true;
            let arrayBTN = this.node.getChildByName("cmd6").getComponentsInChildren(cc.Button);
            for(let btn of arrayBTN)
            {
                btn.interactable = true;  
                btn.node.opacity = 255;              
            }
        }

        this.bShowOverAnimate = true;
        let arrayEnd = new Array<cc.Vec2>();
        let arrayEndPlayer = new Array<DrhPlayerLogic>();
        //收钱到中间
        for (let player of this.arrayPlayer)
        {
            if (player.info.strUserID == "init" || player.info.emState != PlayerState.running)
                continue;
            player.Fly2MainAnimate();          
            player.ShowYiKanPai(false);
            if (player.info.is_win == "True")
            {
                arrayEnd.push(player.node.convertToWorldSpaceAR(player.node.getChildByName("PlayerInfo").position));
                arrayEndPlayer.push(player);
            }
        }
        this.PlayAudio("下注");

        this.scheduleOnce(()=>{
            if (arrayEndPlayer.length == 0)
            {            
                for (let player of this.arrayPlayer)
                {
                    if (player.info.strUserID == "init" || player.info.emState != PlayerState.running)
                        continue; 
                    arrayEnd.push(player.node.convertToWorldSpaceAR(player.node.getChildByName("PlayerInfo").position));
                    arrayEndPlayer.push(player);
                }
            }
            if(strOverType == "正")
            {
                //所有人翻牌
                for (let player of this.arrayPlayer)
                {
                    if (player.info.strUserID == "init" || player.info.emState != PlayerState.running || player.info.player_over_type == "弃" || player.info.player_over_type == "荒" || player.info.player_over_type == "花")
                        continue;
       
                    player.UpdateChePaiHand(1, false);
                    player.UpdateChePaiHand(2, false);   
                    player.ClearCoin();
                }
                //yield return new WaitForSeconds(0.4f);

                for (let player of this.arrayPlayer)
                {
                    if (player.info.strUserID == "init" || player.info.emState != PlayerState.running || player.info.player_over_type == "弃" || player.info.player_over_type == "荒" || player.info.player_over_type == "花")
                        continue;
                    player.ShowCardType(0, Tool.GetArrayRange(player.info.handCardEx,0,2), true, player.GetCardEndWinType(0), false);
                    
                }
                for (let player of this.arrayPlayer)
                {
                    if (player.info.strUserID == "init" || player.info.emState != PlayerState.running || player.info.player_over_type == "弃" || player.info.player_over_type == "荒" || player.info.player_over_type == "花")
                        continue;
                    if (player.info.handCardEx.length <= 2)
                    {
                        //异常情况
                        //如果有延迟消息，则处理下
                        if (this.strLastDelayMsg != "")
                        {
                            let strMsg = this.strLastDelayMsg;
                            this.strLastDelayMsg = "";
                            this.OnUpdatePlayerList(strMsg);
                        }
                        break;
                    }
                    player.ShowCardType(1,Tool.GetArrayRange(player.info.handCardEx,2,2), true, player.GetCardEndWinType(1), false);
                   
                }
            }   
    
      
            //飞金币到胜利方
            this.FlayCoin2Win2(arrayEnd);

            this.scheduleOnce(()=>{
                for(let one of arrayEndPlayer)
                {
                    if (one.info.strUserID == "init" || one.info.emState != PlayerState.running)
                        continue;
                    one.UpdateRoundScore(true);
                }       
        
                
                this.GetPlayerCtlByID(0).node.color = cc.color(255,255,255,255);
        
                this.scheduleOnce(()=>{
                    this.bShowOverAnimate = false;
                    //如果有延迟消息，则处理下
                    if (this.strLastDelayMsg != "")
                    {
                        let strMsg = this.strLastDelayMsg;
                        this.strLastDelayMsg = "";
                        this.OnUpdatePlayerList(strMsg);
                    }
                    this.node.getChildByName("cmd6").active = false;

                },2);
        
                

            },0.3);           
    


        },0.6);
        
    }
    public audio:cc.AudioSource = null;
    public audio2:cc.AudioSource = null;
    public PlayAudio(strName:string)
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
                if(!cc.isValid(this.node))
                    return;
                if(err)
                {
                    Debug.Error(err.message+err);
                    return null;
                }
                
                //this.audio.stop();
                this.audio.clip = obj;
                this.audio.play();
            });
        }
    }
    public PlayAudio2(strName:string)
    {
        
        let nEff =  Tool.GetConfigNumber("AudioEff",100);
        if (nEff > 0)
        {
            if (this.audio2 == null)
            {
                this.audio2 = this.node.getChildByName("BK").getComponent(cc.AudioSource);
                if(this.audio2 == null)
                {
                    this.audio2 = this.node.addComponent(cc.AudioSource);       
                    this.audio2.playOnLoad = false;             
                }
            }
            let strAuPath = "Audio/eff/"+strName;
            this.audio2.volume = nEff / 100;

            cc.loader.loadRes(strAuPath,cc.AudioClip,(err,obj:cc.AudioClip)=>{
                if(!cc.isValid(this.node))
                    return;
                if(err)
                {
                    Debug.Error(err.message+err);
                    return null;
                }
                
                //this.audio.stop();
                this.audio2.clip = obj;
                this.audio2.play();
            });
        }
    }
    //旋友圈模式飞金币
    public FlayCoin2Win2(arrayEnd:Array<cc.Vec2>)
    {
        let transSrc = Tool.GetChild(this.node,"RoomFrame/底分标记");
        transSrc.active = false;
        this.GetPlayerCtlByID(0).PlayAudio(0, "整理");
        for (let one of arrayEnd)
        {
            cc.loader.loadRes("Prefabs/drh/coin",(err,obj)=>{
                if(!cc.isValid(this.node))
                    return;
                if(err)
                {
                    cc.error(err.message || err);
                    return null;
                }
                let add:cc.Node = cc.instantiate(obj);
                add.parent = this.node;
                add.position = this.node.convertToNodeSpaceAR(transSrc.convertToWorldSpaceAR(cc.v2(0,0)));
                let move = cc.moveTo(0.3,this.node.convertToNodeSpaceAR(one));
                let end = cc.callFunc(()=>{
                    add.destroy();                    
                },this);
                let action = cc.sequence(move,end);
                add.runAction(action);
            });
            
        }

    }


    public ThrowCard2Player(item:DrhPlayerLogic,arrayGet:Array<number>,bQiao:boolean = false)
    {
        if(this.bLeavingRoom || item == null || !cc.isValid(item.node))
            return;
       
        let nPos = 0;
        let nAniCount = 0;
        //定位
        for (let i = 0; i < this.arrayPlayer.length; i++)
        {
            let one = this.arrayPlayer[i];
            if (one.info.strUserID == "init" || one.info.emState != PlayerState.running)
                continue;
            nAniCount++;
            if (one.info.strUserID == item.info.strUserID)
            {
                nPos = i;
            }
        }

        let fOneTime = 0.08;
        let arrayAction = Array<cc.ActionInstant>();
        //开始循环发牌(发几轮由服务器控制)
        for (let i=0;i<arrayGet.length;i++)
        {
            let nIndex = arrayGet[i];
            //开始发牌
            for (let j = nPos; j < this.arrayPlayer.length; j++)
            {
                let one = this.arrayPlayer[j];
                if (one.info.strUserID == "init" || (one.info.emState != PlayerState.running && one.info.emState != PlayerState.ready) || one.info.bei_shu_type == "-7" || one.info.site_countdown!="0")
                    continue;

                //额外校验是否需要发牌(避免给观战玩家发牌)
                if(item.info.all_start_player_name != "")
                {
                    if(item.info.all_start_player_name.indexOf(one.info.strUserID)<0)
                    {
                        continue;
                    }
                }
 
                arrayAction.push(cc.callFunc(()=>{
                    if(this.bLeavingRoom || one == null || !cc.isValid(one.node))
                        return;
                    const transHand = this.GetTransHand(one);
                    if(!cc.isValid(transHand))
                        return;
                    transHand.opacity = 255;
                    one.AnimateMoveOneCard(nIndex);                    
                    
                }));

                arrayAction.push(cc.delayTime(fOneTime));
            }
            for (let j = 0; j < nPos; j++)
            {
                let one = this.arrayPlayer[j];
                if (one.info.strUserID == "init" || (one.info.emState != PlayerState.running && one.info.emState != PlayerState.ready) || one.info.bei_shu_type == "-7" || one.info.site_countdown != "0")
                    continue;
                
                //额外校验是否需要发牌(避免给观战玩家发牌)
                if(item.info.all_start_player_name != "")
                {
                    if(item.info.all_start_player_name.indexOf(one.info.strUserID)<0)
                    {
                        continue;
                    }
                }

                arrayAction.push(cc.callFunc(()=>{
                    if(this.bLeavingRoom || one == null || !cc.isValid(one.node))
                        return;
                    const transHand = this.GetTransHand(one);
                    if(!cc.isValid(transHand))
                        return;
                    transHand.opacity = 255;
                    one.AnimateMoveOneCard(nIndex);                    
                    
                }));
                arrayAction.push(cc.delayTime(fOneTime));
            }
        }
        
        this.node.runAction(cc.sequence(arrayAction));

    }
    public OnClientDeath(strMsg:string)
    {
        this.ApplyClientConnectionState(strMsg, true);
    }
    public OnClientActive(strMsg:string)
    {
        this.ApplyClientConnectionState(strMsg, false);
    }
    private ApplyClientConnectionState(strMsg:string,bOffline:boolean)
    {
        if(this.bLeavingRoom)
            return;

        let data:any = null;
        try
        {
            data = JSON.parse(strMsg);
        }
        catch(e)
        {
            Debug.Log("忽略无法解析的玩家在线状态消息");
            return;
        }

        //新版增量消息必须带房间、玩家和座位上下文；旧格式直接忽略，等待PlayerList全量刷新。
        if(data == null || data["room_id"] == null || data["id"] == null || data["number"] == null)
            return;

        const account = GameDataManager.getAccount();
        if(account == null)
            return;

        const strEventRoomID = data["room_id"].toString();
        const strCurrentRoomID = account.roomID == null ? "" : account.roomID.toString();
        if(strEventRoomID == "" || strCurrentRoomID == "" || strEventRoomID != strCurrentRoomID)
            return;

        //牌桌必须已经收到过当前房间的PlayerList，避免切房期间用旧座位表处理新房消息。
        if(this.strMsgRoomID == "" || strEventRoomID != this.strMsgRoomID)
            return;

        //roomType为兼容扩展字段；服务端携带时只接受当前普通房类型。
        if(data["roomType"] != null && data["roomType"].toString() != "Custom")
            return;

        const nSitNum = Number(data["number"]);
        if(!isFinite(nSitNum) || Math.floor(nSitNum) != nSitNum || !this.mapID2PlayerCtl.has(nSitNum))
            return;

        const player = this.mapID2PlayerCtl.get(nSitNum);
        if(player == null || !cc.isValid(player.node) || player.info == null)
            return;

        const strPlayerID = data["id"].toString();
        if(strPlayerID == "" || player.info.strUserID != strPlayerID)
            return;

        //当前连接仍能收到消息时，本人不应被旧连接的ClientDeath标为离线。
        const strSelfID = account.guuid == null ? "" : account.guuid.toString();
        if(bOffline && strSelfID != "" && strPlayerID == strSelfID)
            return;

        player.info.strDeadState = bOffline ? "True" : "False";
        player.ShowHideOffline(bOffline);
    }
    public OnPlayerSay(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        let nSitNum = data["number"];
        let strWord:string = data["word"];
        let nPos = strWord.indexOf(":");
        if(nPos>0 && nPos<4)
        {
            let strRealSit = strWord.substr(0,nPos);
            nSitNum = Number(strRealSit);
            strWord = strWord.substr(nPos + 1);
        }

        if (strWord.indexOf("@@语音@@") >= 0) //语音需要排队
        {
            MobileManager.getInstance().PreloadRecord(strWord.substr(6));
            this.Add2SayTemp(strMsg);
            return;
        }


        //文本消息特殊处理
        //处理文字消息        
        if (strWord.indexOf("@SS") == 0)
        {
            strWord = strWord.replace("@SS", "");

            let scroll = Tool.GetChild(this.node,"BK/聊天").getComponent(ScrollViewEx);

            scroll.node.active = true;

            this.unschedule(this.DelayCloseTalk);
            this.scheduleOnce(this.DelayCloseTalk,5);

            this.arrayTalkMsg.push(strWord);

            cc.loader.loadRes("Prefabs/聊天对象",(err,obj)=>{
                if(!cc.isValid(this.node) || !cc.isValid(scroll.node))
                    return;
                if(err)
                {
                    cc.error(err.message || err);
                    return null;
                }
                let add:cc.Node = cc.instantiate(obj);
                add.parent = scroll.content;
                add.getComponent(cc.Label).string = strWord;
                
                if(scroll.content.childrenCount>10)
                {
                    scroll.content.children[0].destroy();
                    this.arrayTalkMsg.shift();
                }
                scroll.scrollToBottom(0.3);
            });
            return;
        }      
        if (nSitNum >= 0 && this.mapID2PlayerCtl.has(nSitNum))
        {

            this.mapID2PlayerCtl.get(nSitNum).OnChartMsg(strWord);
                     
        }
    }
    
    public DelayCloseTalk()
    {
        let scroll = Tool.GetChild(this.node,"BK/聊天").getComponent(ScrollViewEx);
        scroll.node.active = false;
    }

    public dtLastSay = new Date().getTime();
    //添加语音大缓存
    public Add2SayTemp(strMsg:string)
    {     
        this.arraySaySave.push(strMsg);
        let dtNow = new Date().getTime();

        //检查当前是否在录音，录音模式下GVOICE不允许下载
        if(this.node.getChildByName("TalkShow").active)
        {
            Debug.Log("正在录音，暂停播放");
            return;
        }

        if(!this.bSaying || (dtNow-this.dtLastSay)>10000)
        {
            this.OnePlaySay(this.arraySaySave.shift());
        }
        else
        {
            Debug.Log("有人在说话等待:"+(dtNow-this.dtLastSay).toString());
        }
    }
    public OnePlaySay(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        let nSitNum = data["number"];
        let strWord:string = data["word"];
        let nPos = strWord.indexOf(":");
        if (nPos > 0 && nPos < 4)
        {
            let strRealSit = strWord.substr(0,nPos);
            nSitNum = Number(strRealSit);
            strWord = strWord.substr(nPos + 1);
        }

        if (nSitNum >= 0 && this.mapID2PlayerCtl.has(nSitNum))
        {
//            nLastSaySit = nSitNum;
            this.bSaying = true;
            this.mapID2PlayerCtl.get(nSitNum).OnChartMsg(strWord);
            let strID:string = this.mapID2PlayerCtl.get(nSitNum).info.strUserID;

            this.mapID2LastSay.set(strID,strMsg);
            
            this.dtLastSay = new Date().getTime();
        }
        else //围观的人不允许说话
        {

        }
    }
    //获取没人最后一条语音
    public GetPlayerLastSay(strID:string)
    {
        let strMsg = "";
        if(this.mapID2LastSay.has(strID))
        {
            strMsg = this.mapID2LastSay.get(strID);
        }
        return strMsg;
    }
    public OnPlayNextAudio(strParam:string)
    {
        this.CloseAllTalkPad();
        this.bSaying = false;
        if(this.arraySaySave.length>0)
        {
            this.OnePlaySay(this.arraySaySave.shift());
        }
    }
    public CloseAllTalkPad()
    {
        for(let one of this.arrayPlayer)
        {
            one.callbackStopTalk();
        }
    }

    //根据用户ID获取头像所在坐标G
    public GetPlayerHeadPosG(strID:string):cc.Vec2
    {
        for(let one of this.arrayPlayer)
        {
            if(one != null)
            {
                if(one.info.strUserID == strID)
                {
                    let find = Tool.GetChild(one.node,"PlayerInfo/Head");
                    if(find != null)
                    {
                        return find.convertToWorldSpaceAR(cc.v2(0,0));
                    }
                }
            }
        }
        return cc.Vec2.ZERO;
    }

    //更新奖池数据
    public UpdateCurJiangChi(strNum:string)
    {
        Tool.GetChild(this.node,"奖池条/num").getComponent(cc.Label).string = strNum;
    }

    //增加屏蔽语音
    public AddNoAudio(strID:string)
    {
        let bFind:boolean = false;
        for(let one of this.arrayNoAudio)
        {
            if(one == strID)
            {
                bFind = true;
                break;
            }
        }
        if(!bFind)
        {
            this.arrayNoAudio.push(strID);
        }
    }
    //删除屏蔽语音
    public RemoveNoAudio(strID:string)
    {
        for(let i=0;i<this.arrayNoAudio.length;i++)
        {
            let one = this.arrayNoAudio[i];
            if(one == strID)
            {
                this.arrayNoAudio.splice(i,1);
                break;
            }
        }
    }
    //查看是否屏蔽语音
    public CheckNoAudio(strID:string):boolean
    {
        for(let one of this.arrayNoAudio)
        {
            if(one == strID)
            {
                return true;
            }
        }
        return false;
    }
    public GetTransHand(player:DrhPlayerLogic):cc.Node
    {
        if(this.bLeavingRoom || player == null || !cc.isValid(player.node))
            return null;
        let transFind = null;
        //根据观战或打牌切换手牌
        if(player.playerPos == PlayerPos.self)
        {
            //自己需要知道是在观战还是打牌
            if(player.info.strUserID == this.strAccountUserID) //自己打牌
            {
                transFind = Tool.GetChild(player.node,"handstop/handcardlist");
                const transWatchHand = Tool.GetChild(player.node,"handstop/handcardlist2");
                if(cc.isValid(transFind))
                    transFind.active = true;
                if(cc.isValid(transWatchHand))
                    transWatchHand.active = false;
            }
            else //自己观战
            {

                transFind = Tool.GetChild(player.node,"handstop/handcardlist2");
                const transPlayHand = Tool.GetChild(player.node,"handstop/handcardlist");
                if(cc.isValid(transFind))
                    transFind.active = true;
                if(cc.isValid(transPlayHand))
                    transPlayHand.active = false;
            }
        }
        else
        {
            transFind = Tool.GetChild(player.node,"handstop/handcardlist");
        }
        return transFind;
    }
    //校验是否显示金币
    public CheckCoinShow()
    {

    }
}
