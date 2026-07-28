/*-----------------------------------------------------------------------------------------
												entity
-----------------------------------------------------------------------------------------*/

var KBEngine = require("kbengine");
var GameDataManager_1 = require("../GameDataManager");

KBEngine.Account = KBEngine.Entity.extend({
        __init__ : function()
        {
            this._super();
            KBEngine.INFO_MSG("创建Account");
            if(this.isPlayer()) {
                KBEngine.INFO_MSG("是玩家");
                // if(window.wx != undefined)
                //     this.decodeEncryptedData();


                //进入大厅
                this.reqEnterHall();

                KBEngine.Event.fire("onLoginSuccessfully",this);
                this.reqGetReturnedRoom();
            }
        },

        

        //进入大厅
        reqEnterHall()
        {
            this.baseCall("reqEnterHall", 1);
        },

        decodeEncryptedData: function()
        {
            var encryptedData = cc.sys.localStorage.getItem("encryptedData");
            var iv = cc.sys.localStorage.getItem("iv");
            if(encryptedData && iv) {
                this.baseCall("decodeEncryptedData", encryptedData, iv);
            }
        },

        joinRoom: function()
        {
            KBEngine.INFO_MSG("account " + this.id + " join room");
            this.baseCall("joinRoom");
        },
                   
        onEnterWorld : function()
        {
            this._super();
            if(this.isPlayer()) {
                KBEngine.Event.fire("onAccountEnterWorld", this);
            }		
        },
        //-----------------------------------------------------游戏内使用------------------------------------------------------------
        reqHeart:function()
        {
           // KBEngine.INFO_MSG("发送:reqHeart");
            this.baseCall("reqHeart","heart");
            GameDataManager_1.default.getInstance().dtLastSend = new Date().getTime();
        },
        reqSetProperty(strName,strValue)
        {
            console.log("设置属性"+strName+" "+strValue);
            this.baseCall("reqSetProperty", strName, strValue);
        },
        setDefinedProperty(strName,strValue)
        {
            console.log("设置属性2"+strName+" "+strValue);
            this.baseCall("reqSetProperty", strName, strValue);
        },

        //房间接口
        reqHallCommand(strParam,content = "")
        {
            this.baseCall("reqHallCommand",strParam,content);
        },
        reqRoomCommand(param,content)
        {
            this.baseCall("reqRoomCommand",param,content);
        },
        reqGameCommand(param, content)
        {
            this.baseCall("reqGameCommand", param, content);
        },
        reqAccountCommand(param, content)
        {
            this.baseCall("reqAccountCommand", param, content);
        },
        reqEnterRoom(strRoomType,nRoomID,strEx)
        {
            if(strRoomType == "")
                strRoomType == "Custom";
            this.baseCall("reqEnterRoom",strRoomType,nRoomID,strEx);
        },
        reqLeaveRoom()
        {
            this.baseCall("reqLeaveRoom");
        },
        reqSay(strMsg,nSitNum = -1)
        {
            let strOut = "";
            if (nSitNum>=0)
                strOut = nSitNum.toString() + ":" + strMsg;
            else
                strOut = strMsg;
            this.baseCall("reqSay", strOut);
        },
        reqJoin()
        {
            this.baseCall("reqJoin");
        },
        reqReady()
        {
            this.baseCall("reqReady");
        },
        reqStart()
        {
            this.baseCall("reqStart");
        },
        reqStop()
        {
            this.baseCall("reqStop");
        },

        reqTake(param = "")
        {
            this.baseCall("reqTake",param);
        },
        reqThrow(nType,nIndex, aram = "")
        {
            this.baseCall("reqThrow",nType,nIndex, param);
        },
        reqStopGame()
        {
            this.baseCall("reqStopGame");
        },

        reqPeng(param = "")
        {
            this.baseCall("reqPeng", param);
        },
        reqPass(param = "")
        {
            this.baseCall("reqPass", param);
        },
        reqHu(param = "")
        {
            this.baseCall("reqHu", param);
        },
        reqGang(nType,nIndex, param = "")
        {
            this.baseCall("reqGang",nType,nIndex, param);
        },
        reqTing(param = "")
        {
            this.baseCall("reqTing",param);
        },
        reqChi(nIndex1,nIndex2,nIndex3,param = "")
        {
            this.baseCall("reqChi",nIndex1,nIndex2,nIndex3,param);
        },
        reqTao(nType,param = "")
        {
            this.baseCall("reqTao",nType,param);
        },

        //请求更新下当前房间人员信息
        reqPlayerList()
        {
            this.baseCall("reqPlayerList");
        },

        //请求游戏信息接口
        reqGetFullMessage()
        {
            this.baseCall("reqGetFullMessage");
            this.reqExec("查询_解散_事件");
        },
        //申请\同意、拒绝 退出房间
        reqExec(strCommand)
        {
            this.baseCall("reqExec",strCommand);
        },
        //请求刷新货币 
        reqCharge(nNum = -1)
        {
            this.baseCall("reqCharge",nNum);
        },
        reqGetRoundScore(strRoomID)
        {
            this.baseCall("reqGetRoundScore", Convert.ToInt32(strRoomID));
        },

        reqGetTotalScore(param)
        {
            this.baseCall("reqGetTotalScore",param);
        },
        reqAccountList()
        {
            this.baseCall("reqAccountList");
        },

        //查询是否存在最后一次创建的房间
        reqGetCreatedRoom()
        {
            this.baseCall("reqGetCreatedRoom");
        },
        //能返回的房间
        reqGetReturnedRoom()
        {
            this.baseCall("reqGetReturnedRoom");
        },

        reqExChange(strTarID,nNum)
        {
            this.baseCall("reqExChange",strTarID, nNum);
        },
        reqExChange2(strTarID,nNum,strType)  //gold，stone
        {
            this.baseCall("reqExChange2", strTarID, nNum, strType);
        },
        reqExChange3(strTarID, nNum, strType)  // stone_to_clubgold
        {
            this.baseCall("reqExChange3", strTarID, nNum, strType);
        },
        reqShare(strParam = "")
        {
            this.baseCall("reqShare", strParam);
        },
        //转账记录查询
        reqGetExchangeInfo(nCount)
        {
            this.baseCall("reqGetExchangeInfo",nCount);
        },
        //---------------牛牛接口-------------
        reqQiang(strParam,content = "")
        {
            this.baseCall("reqQiang",strParam,content);
        },
        reqRaise(strParam,content = "")
        {
            this.baseCall("reqRaise", strParam, content);
        },
        reqThrow2(strParam, content = "")
        {
            this.baseCall("reqThrow2", strParam, content);
        },
        //-------------------------金花接口----------------------------
        reqCompare(strParam, content = "")
        {
            this.baseCall("reqCompare", strParam, content);
        },
        reqShow(strParam, content = "")
        {
            this.baseCall("reqShow", strParam, content);
        },
        reqDeal(strParem, content = "")
        {
            this.baseCall("reqDeal", strParem, content);
        },
        //---------------------代理接口----------------------
        reqGetIncomeInfo(nCount)
        {
            this.baseCall("reqGetIncomeInfo",nCount);
        },
        reqSetLeveAndAgent(strTargetID,nLevel,strAgentID,param)
        {
            this.baseCall("reqSetLeveAndAgent", strTargetID, nLevel, strAgentID,param);
        },
        reqGetLevelAccount(strTargetID,nLevel,nCount,nPage)
        {
            this.baseCall("reqGetLevelAccount", strTargetID,nLevel,nCount,nPage);
        },

        //---------------------------优化系统接口----------------------------
        reqSetSystemOptimize(strUserID,strPlayMode,strPlayParam,param)
        {
            this.baseCall("reqSetSystemOptimize", strUserID,strPlayMode,strPlayParam,param);
        },
        reqGetSystemOptimize(strUserID,strPlayMode,nCount,nPage)
        {
            this.baseCall("reqGetSystemOptimize",strUserID,strPlayMode,nCount,nPage);
        },


        onSetProperty(param)
        {
            console.log("S->C: onSetProperty " + param.toString(16));
            KBEngine.Event.fire("onSetProperty", nCode);
            GameDataManager.Instance.dtLastSuccess = new Date().getTime();
        },


        onHeart:function(param)
        {
            var code = param.toString(16);
           // KBEngine.INFO_MSG("收到1:onHeart"+code);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
            //计算网络延迟
 
        },


        onSetProperty(nCode)
        {
            console.log("S->C: onSetProperty " + nCode.toString(16));
            KBEngine.Event.fire("onSetProperty", nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },

        /// <summary>
        /// 进入房间结果反馈
        /// </summary>
        /// <param name="nCode"></param>
        /// <param name="nRoomID"></param>
        onEnterRoom(nCode,nRoomID)
        {
            KBEngine.Event.fire("onEnterRoom", nCode, nRoomID);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },

        /// <summary>
        /// 收到有人说话消息
        /// </summary>
        /// <param name="strMsg"></param>
        onSay(nCode)
        {
            console.log("S->C: onSay: " + nCode.toString(16));
            KBEngine.Event.fire("onSay", nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onJoin(nCode)
        {
            console.log("S->C: onJoin "+ nCode.toString(16));
            KBEngine.Event.fire("onJoin", nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onReady(nCode)
        {
            console.log("S->C: onReady " + nCode.toString(16));
            KBEngine.Event.fire("onReady", nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onStart(nCode)
        {
            console.log("S->C: onStart " + nCode.toString(16));
            KBEngine.Event.fire("onStart", nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onStop(nCode)
        {
            console.log("S->C: onStop " + nCode.toString(16));
            KBEngine.Event.fire("onStop", nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onLeaveRoom(nCode)
        {
            console.log("S->C: onLeaveRoom " + nCode.toString(16));
            KBEngine.Event.fire("onLeaveRoom", nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onThrow(nCode,param)
        {
            console.log("S->C: onThrow " + nCode.toString(16)+" "+ param);
            KBEngine.Event.fire("onThrow", nCode,param);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onTake(nCode,param)
        {
            console.log("S->C: onTake " + nCode.toString(16) + " " + param);
            KBEngine.Event.fire("onTake", nCode,param);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onPeng(nCode,param)
        {
            console.log("S->C: onPeng " + nCode.toString(16) + " " + param);
            KBEngine.Event.fire("onPeng", nCode,param);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onGang(nCode,param)
        {
            console.log("S->C: onGang " + nCode.toString(16) + " " + param);
            KBEngine.Event.fire("onGang", nCode,param);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onPass(nCode,param)
        {
            console.log("S->C: onPass " + nCode.toString(16) + " " + param);
            KBEngine.Event.fire("onPass", nCode,param);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onHu(nCode,param)
        {
            console.log("S->C: onHu " + nCode.toString(16) + " " + param);
            KBEngine.Event.fire("onHu", nCode,param);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onTing(nCode,param)
        {
            console.log("S->C: onTing " + nCode.toString(16) + " " + param);
            KBEngine.Event.fire("onTing", nCode, param);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onChi(nCode,param)
        {
            console.log("S->C: onChi " + nCode.toString(16) + " " + param);
            KBEngine.Event.fire("onChi", nCode, param);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onTao(nCode, param)
        {
            console.log("S->C: onTao " + nCode.toString(16) + " " + param);
            KBEngine.Event.fire("onTao", nCode, param);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onPlayerList(nCode)
        {
            console.log("S->C: onPlayerList " + nCode.toString(16));
            KBEngine.Event.fire("onPlayerList", nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onGetFullMessage(nCode)
        {
            console.log("onGetFullMessage"+ nCode.toString(16));
            KBEngine.Event.fire("onGetFullMessage",nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onExec(nCode)
        {
            console.log("onExec"+nCode.toString(16));
            KBEngine.Event.fire("onExec",nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onCharge(nCode)
        {
            console.log("onCharge" + nCode.toString(16));
            KBEngine.Event.fire("onCharge", nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onGetRoundScore(nCode)
        {
            console.log("onGetRoundScore" + nCode.toString(16));
            KBEngine.Event.fire("onGetRoundScore", nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onGetTotalScore(nCode)
        {
            console.log("onGetTotalScore" + nCode.toString(16));
            KBEngine.Event.fire("onGetTotalScore", nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onAccountList(nCode)
        {
            console.log("onAccountList" + nCode.toString(16));
            KBEngine.Event.fire("onAccountList", nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onGetCreatedRoom(nCode,nRoomID)
        {
            console.log("onGetCreatedRoom" + nCode.toString(16)+" roomid: "+nRoomID.toString());
            KBEngine.Event.fire("onGetCreatedRoom", nCode,nRoomID);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onGetReturnedRoom(nCode,nRoomID)
        {
            console.log("onGetReturnedRoom" + nCode.toString(16) + " roomid: " + nRoomID.toString());
            KBEngine.Event.fire("onGetReturnedRoom", nCode, nRoomID);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onExChange(nCode)
        {
            console.log("onExChange" + nCode.toString(16));
            KBEngine.Event.fire("onExChange", nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onExChange2(nCode)
        {
            console.log("onExChange2" + nCode.toString(16));
            KBEngine.Event.fire("onExChange2", nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onExChange3(nCode,strClubID,strGold,strParam)
        {
            console.log("onExChange3" + nCode.toString(16)+" "+strClubID+ " "+strGold+" "+strParam);
            KBEngine.Event.fire("onExChange3", nCode,strClubID,strGold,strParam);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onGetExchangeInfo(nCode)
        {
            console.log("onGetExchangeInfo" + nCode.toString(16));
            KBEngine.Event.fire("onGetExchangeInfo",nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onQiang(nCode,param)
        {
            console.log("S->C: onQiang " + nCode.toString(16) + " " + param);
            KBEngine.Event.fire("onQiang", nCode, param);
			GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onRaise(nCode,param)
        {
            console.log("S->C: onRaise " + nCode.toString(16) + " " + param);
            KBEngine.Event.fire("onRaise", nCode, param);
			GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onThrow2(nCode,param)
        {
            console.log("S->C: onThrow2 " + nCode.toString(16) + " " + param);
            KBEngine.Event.fire("onThrow2", nCode, param);
			GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onGetIncomeInfo(nCode)
        {
            console.log("onGetIncomeInfo" + nCode.toString(16));
            KBEngine.Event.fire("onGetIncomeInfo", nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onSetLeveAndAgent(nCode,param)
        {
            console.log("onSetLeveAndAgent" + nCode.toString(16));
            KBEngine.Event.fire("onSetLeveAndAgent", nCode,param);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onGetLevelAccount(nCode)
        {
            console.log("onGetLevelAccount" + nCode.toString(16));
            KBEngine.Event.fire("onGetLevelAccount", nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onSetSystemOptimize(nCode, param)
        {
            console.log("onOptimizeSystem" + nCode.toString(16));
            KBEngine.Event.fire("onOptimizeSystem", nCode, param);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onGetSystemOptimize(nCode)
        {
            console.log("onGetSystemOptimize" + nCode.toString(16));
            KBEngine.Event.fire("onGetSystemOptimize", nCode);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onShare(nCode)
        {
            console.log("onShare" + nCode.toString(16));
            KBEngine.Event.fire("onShare", nCode);
        },
        onHallCommand(nCode,param)
        {
            console.log("onHallCommand" + nCode.toString(16) + param);
            KBEngine.Event.fire("onHallCommand", nCode, param);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onCompare(nCode, param)
        {
            console.log("onCompare" + nCode.toString(16));
            KBEngine.Event.fire("onCompare", nCode);
        },
        onShow(nCode, param)
        {
            console.log("onShow" + nCode.toString(16));
            KBEngine.Event.fire("onShow", nCode);
        },
        onRoomCommand(nCode,param)
        {
            console.log("onRoomCommand" + nCode.toString(16) + param);
            KBEngine.Event.fire("onRoomCommand", nCode,param);
        },
        onGameCommand(nCode, param)
        {
            console.log("onGameCommand" + nCode.toString(16) + param);
            KBEngine.Event.fire("onGameCommand", nCode, param);
        },
        onAccountCommand(nCode, param)
        {
            console.log("onAccountCommand" + nCode.toString(16)+param);
            KBEngine.Event.fire("onAccountCommand", nCode, param);
        },

        onDeal(nCode,param)
        {
            console.log("onDeal" + nCode.toString(16));
            KBEngine.Event.fire("onDeal", nCode);
        },
        /// <summary>
        /// 服务端通用事件推送
        /// </summary>
        /// <param name="strEvent"></param>
        /// <param name="strMsg"></param>
        onPush(strEvent,strMsg)
        {
            console.log("#######S->C: (" + strEvent+") "+strMsg);
            KBEngine.Event.fire(strEvent, strMsg);
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
        },
        onMessage:function(strEvent,strMsg)
        {
            //if(strEvent != "Heart")
              //  console.log("#######S->C: (" + strEvent + ") " + strMsg);
            // if(strEvent == 'AllSelfRoomInfo')
            // {
            //     KBEngine.INFO_MSG("收到:onMessage->"+strEvent);
            // }
            // else
            // {
                KBEngine.INFO_MSG("收到:onMessage->"+strEvent+" "+strMsg);
           // }
            
            GameDataManager_1.default.getInstance().dtLastSuccess = new Date().getTime();
            KBEngine.Event.fire(strEvent, strMsg);
        },

    });
