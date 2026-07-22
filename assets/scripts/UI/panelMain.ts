import UIPanelViewBase from "../common/UIPanelViewBase";
import Debug from "../common/Debug";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import ScrollViewEx from "../common/ScrollViewEx";
import { ScrollEvent, ShowPanelMode, RoomType, ClosePanelMode, WEB_IP, SERVER_IP, PIC_UPDATE_URL, WEB_PORT, WEB_IP_PIC, WEB_PORT_PIC, WEB_TX_IP } from "../common/GameDef";
import UIManager from "../common/UIManager";
import ImageManager from "../logic/ImageManager";
import MobileManager from "../mobile/MobileManager";
import ConfigManager from "../logic/ConfigManager";
import GpsManager from "../logic/GpsManager";
import UpdateManager from "../logic/UpdateManager";
import ScrollViewNoEnd from "../common/ScrollViewNoEnd";
import ObjPoolManager from "../logic/ObjPoolManager";
import scrollview2 from "../common/scrollview2";

var KBEngine = require("kbengine");

const {ccclass, property} = cc._decorator;

@ccclass
export default class panelMain extends UIPanelViewBase {

    private PAGE_PER_COUNT:number = 15;
    private IMG_URL:string = WEB_IP_PIC+":"+WEB_PORT_PIC+"/server/pp/";
    
    @property(ScrollViewNoEnd)
    scrollRoom:ScrollViewNoEnd = null; //房间列表控件
    @property(cc.RawAsset)
    mainifestUrl: cc.RawAsset= null;

    strPreRoomParam:string = ""; 
    strCurRoomParam:string = ""; //最后一次请求参数

    private scrollExchangeInfo:ScrollViewEx = null;
    private scrollLiushui:ScrollViewEx = null;

    private txtInputRoomid:cc.Label = null; //房号

    private dtLastGetAllRoom:number = new Date().getTime()-10000;


    private scrollRoom2:scrollview2 = null;
    private arrayRoomData:any[] //房间滚动列表数据缓存

    private bEnableScroll2Top = false; //刷新列表后滚动到第一行

    private listSet = ['战绩','代理','资金明细','赠送','设置'];

    private animateSet:dragonBones.ArmatureDisplay = null;

    private bNeedInitJYPwd:boolean = false;  //是否需要初始化交易密码
    private scrollCFNotify:ScrollViewEx = null; //惩罚公告列表

    private strFirstModifyName = "" //是否修改过头像名字
    onLoad () {
        super.onLoad();
        
        KBEngine.Event.register("set_gold", this, "set_gold");
        KBEngine.Event.register("set_gold2", this, "set_gold");
        KBEngine.Event.register("set_name", this, "set_name");
        KBEngine.Event.register("set_guuid", this, "set_guuid");
        KBEngine.Event.register("set_level", this, "set_level");
        KBEngine.Event.register("set_role", this, "set_role");
        KBEngine.Event.register("set_photo", this, "set_photo");

        
        
        

        KBEngine.Event.register("ClubRoomInfo", this, "OnClubRoomInfo");
        KBEngine.Event.register("AllClubRoomInfo", this, "OnClubRoomInfo");
        KBEngine.Event.register("AllSelfRoomInfo", this, "OnClubRoomInfo");
        KBEngine.Event.register("AllFubenRoomInfo", this, "OnClubRoomInfo");

        KBEngine.Event.register("onEnterRoom", this, "onEnterRoom");
        KBEngine.Event.register("onGetReturnedRoom", this, "onGetReturnedRoom");

        KBEngine.Event.register("onExChange", this, "onExChange");
        KBEngine.Event.register("onExChange2", this, "onExChange");

        KBEngine.Event.register("ExchangeInfo", this, "OnGetExchangeList");
        KBEngine.Event.register("ListPlayerCashWater", this, "ListPlayerCashWater");
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");

        KBEngine.Event.register("UserHashInfo",this, "OnUserHashInfo");
        KBEngine.Event.register("UserHash2Info",this, "UserHash2Info");
        KBEngine.Event.register("set_client_status", this, "set_client_status");

        KBEngine.Event.register("AccountProp", this, "AccountProp"); //查询玩家属性
        KBEngine.Event.register("onGetPic", this, "onGetPic"); //图片选择返回
        KBEngine.Event.register("openGG8", this, "openGG8");
        this.initUserInfo();

        if(this.scrollRoom === null)
        {
            this.scrollRoom = Tool.GetChild(this.node,"Main/发现/房间列表").getComponent(ScrollViewNoEnd);
        }
        this.scrollRoom2 = this.scrollRoom.getComponent(scrollview2);
        this.scrollRoom2.main = this;
        this.scrollRoom.node.on("scroll-to-top",()=>{
            //this.scrollRoom.LastEvent = ScrollEvent.ToTop;
               // this.getAllRooms(0);

        },this);
        this.scrollRoom.node.on("scroll-to-bottom",()=>{
            //this.scrollRoom.LastEvent = ScrollEvent.ToBottom;
            //this.getAllRooms(this.scrollRoom.nCurPage+1);

            //console.log("到底了");

        },this);
        this.scrollRoom.node.on(cc.Node.EventType.TOUCH_END,()=>{
            //结束的时候如果发现列表是空的则需要获取一次
            let bFind = false;
            for(let one of this.scrollRoom.content.children)
            {
                if(one.active)
                {
                    bFind = true;
                    break;
                }
            }
            if(!bFind)
            {            
                this.getAllRooms(0);

            }
            Debug.Log("结束");
        },this);

        this.scrollRoom.node.on("bounce-bottom",()=>{
            Debug.Log("进入bounce-bottom");
          //  this.getAllRooms(this.scrollRoom.nCurPage+1);
        },this);
        this.scrollRoom.node.on("bounce-top",()=>{
            Debug.Log("进入bounce-top");
            this.getAllRooms(0);
        },this);

        this.scrollRoom.node.on("scrolling",()=>{
            //计算滚到百分比
            let nTotle = this.scrollRoom.content.height-this.scrollRoom.node.height;
            let nPer = this.scrollRoom.content.y/nTotle;
            //Debug.Error("当前比例："+nPer);
            if(nPer>0.7)
            {
                this.getAllRooms(this.scrollRoom.nCurPage+1);
            }
        },this);

        this.switchTabSel("发现");
        this.getAllRooms();


        //检测是否有需要返回的房间
        GameDataManager.getAccount().reqGetReturnedRoom();

        //更新HASH数据
        ConfigManager.getInstance().UpdateDefConfig();

        GpsManager.getInstance().StartAutoNotifyGps();

        this.set_role(null);
        this.set_level(null);

        this.node.getChildByName("加入房间").on(cc.Node.EventType.TOUCH_START,()=>{
            this.node.getChildByName("加入房间").active = false;
        },this);

        if(cc.sys.isBrowser)
        {
            Tool.GetChild(this.node,"Main/我的/信息/测试").active = true;
        }
        else
        {
            Tool.GetChild(this.node,"Main/我的/信息/测试").active = false;
        }

        if(GameDataManager.instance.nShowNotify)
        {
            ConfigManager.getInstance().GetOneHashKey("系统公告","大厅查询公告");
            ConfigManager.getInstance().GetOneHashKey("充值公告","充值公告");
            ConfigManager.getInstance().GetOneHashKey("活动公告","活动公告");
            GameDataManager.instance.nShowNotify = false;
        }
        //ConfigManager.getInstance().SetOneHashKey("世界杯2","暂未开放")
        

        this.set_client_status()
       // this.set_paper()

        //检查下更新
        //UpdateManager.getInstance().checkUpdate(this.mainifestUrl);

        //修复下声音默认
        let audioeff = Tool.GetConfigNumber("AudioEff",100);
        if(audioeff>0)
        {
            cc.sys.localStorage.setItem("AudioEff",100);
        }

        this.scrollCFNotify = Tool.GetChild(this.node,"惩罚列表/list").getComponent(ScrollViewEx);
        this.scrollCFNotify.callBackFresh = this.GetCFNotifyInfo.bind(this);
    }

    onEnable(){
        GameDataManager.getInstance().dtLastSend = new Date().getTime();
        GameDataManager.getInstance().dtLastSuccess = new Date().getTime();
    }

    start () {

        this.scrollExchangeInfo = Tool.GetChild(this.node,"赠送/赠送记录列表").getComponent(ScrollViewEx);
        this.scrollExchangeInfo.callBackFresh = this.GetAllExchangeInfo.bind(this);

        this.scrollLiushui = Tool.GetChild(this.node,"资金明细/资金明细列表").getComponent(ScrollViewEx);
        this.scrollLiushui.callBackFresh = this.GetLiuShuiInfo.bind(this);


        //
    }

    initUserInfo()
    {
 
        //新用户弹出设置信息界面
        if(GameDataManager.getAccount().photo === "")
        {
            // this.node.getChildByName("修改个人信息").active = true;
            // this.RandHeadList();
            //没有头像的给他设置默认头像
            GameDataManager.getAccount().reqSetProperty("photo",this.IMG_URL+"001.jpg");
        }
        

        this.set_gold(0);
        this.set_name("");
        this.set_guuid("");

        this.set_photo(null);
    }
    private nCurPageHead:number = 0;
    private MAX_PAGE:number = 22;  //从0开始需要比真实扫一夜
    private MAX_COUNT:number = 367;
    public RandHeadList()
    {
        return
        let headList = null;
        if(this.nCurPageHead>this.MAX_PAGE)
        {
            this.nCurPageHead = this.MAX_PAGE;
        }

        if(Tool.GetChild(this.node,"修改个人信息").active)
        {
            headList = Tool.GetChild(this.node,"修改个人信息/头像列表/view/content1");
            Tool.GetChild(this.node,"修改个人信息/分页/页码").getComponent(cc.Label).string = (this.nCurPageHead+1).toString();
        }
        else
        {
            headList = Tool.GetChild(this.node,"修改个人信息2/头像列表/view/content1");
            Tool.GetChild(this.node,"修改个人信息2/分页/页码").getComponent(cc.Label).string = (this.nCurPageHead+1).toString();
        }



        

        let start = 100+(this.nCurPageHead)*12;
        for(let i=0;i<12;i++)
        {
            let strRand = "";
            let strUrl = "";

            strRand =(start++).toString();//this.GetRandImgID();
            strUrl = this.IMG_URL+strRand+".jpg";

            if(Number(strRand)>this.MAX_COUNT)
            {
                if(i<headList.childrenCount)
                {
                    headList.children[i].active = false;
                }
                continue;
            }
        
            if(i>=headList.childrenCount)
            {
                cc.loader.loadRes("Prefabs/头像",(err,obj)=>{
                    if(err)
                    {
                        cc.error(err.message || err);
                        Debug.Log("错误！！！！！！！！！");
                        return null;
                    }
                    let node = cc.instantiate(obj);
                    node.active = true;
                    node.name = strRand;
                    node.parent =headList;
                    //设置图片
                    let img = Tool.GetChild(node,"mask/img").getComponent(cc.Sprite);
                    node.getComponent(cc.Sprite).enabled = false;
                    cc.loader.load({url:strUrl},function (err,tex) {
                        var spriteFrame = new cc.SpriteFrame(tex);
                        if(cc.isValid(img))
                            img.spriteFrame = spriteFrame;
                    });
                    let btn = node.getComponent(cc.Button);
                    btn.node.on("click",()=>{
                        this.onButtonClick(btn);
                    })
                });
            }
            else
            {
                let node = headList.children[i];
                node.active = true;
                node.name = strRand;
                //设置图片
                let img = Tool.GetChild(node,"mask/img").getComponent(cc.Sprite);
                node.getComponent(cc.Sprite).enabled = false;
                Tool.LoadImg(img,"other/head",()=>{
                    cc.loader.load({url:strUrl},function (err,tex) {
                        var spriteFrame = new cc.SpriteFrame(tex);
                        if(cc.isValid(img))
                            img.spriteFrame = spriteFrame;
                    });
                });
                

            }
        }
    }
    public GetRandImgID():string
    {
        let strPass = "";
        let max:number = 5800;
        let min:number = 1001;

        let x = Math.floor(Math.random() * (max - min + 1)) + min;
         
        strPass = x.toString().padStart(4,"0");

        return strPass;
    }

    set_gold(num:number)
    {
        Tool.GetChild(this.node,"Main/我的/信息/gold").getComponent(cc.Label).string = GameDataManager.getAccount().gold.toString()+(GameDataManager.getAccount().gold2==0?"":("."+GameDataManager.getAccount().gold2.toString().padStart(2,"0")));
    }
    set_name(name:string)
    {
        Tool.GetChild(this.node,"Main/我的/信息/name").getComponent(cc.Label).string = KBEngine.app.player().name;
        MobileManager.getInstance().SetAccount();
    }
    set_guuid(id:string)
    {
        Tool.GetChild(this.node,"Main/我的/信息/id").getComponent(cc.Label).string = KBEngine.app.player().guuid;
        MobileManager.getInstance().SetAccount();
    }
    set_level(id:string)
    {
        let strLevel =GameDataManager.getAccount().level;
        // if (Number(strLevel) > 50)
        // {
        //     Tool.GetChild(this.node,"Main/我的/操作/推广二维码").active = true;
        //     Tool.GetChild(this.node,"Main/我的/操作/代理").active = true;
        // }
        // else
        // {
        //     Tool.GetChild(this.node,"Main/我的/操作/推广二维码").active = false;
        //     Tool.GetChild(this.node,"Main/我的/操作/代理").active = false;
        // }

        // if(Number(strLevel)>50)
        // {
        //     Tool.GetChild(this.node,"Main/我的/转盘1").active = true;
        //     Tool.GetChild(this.node,"Main/我的/转盘2").active = false;
        //     Tool.GetChild(this.node,"Main/我的/转盘1").rotation = 0
        //     Tool.GetChild(this.node,"Main/我的/转盘2").rotation = 0
        // }
        // else
        // {
        //     Tool.GetChild(this.node,"Main/我的/转盘1").active = false;
        //     Tool.GetChild(this.node,"Main/我的/转盘2").active = true; 
        //     Tool.GetChild(this.node,"Main/我的/转盘1").rotation = 0
        //     Tool.GetChild(this.node,"Main/我的/转盘2").rotation = 0
        // }

        
        if(GameDataManager.getAccount().role == "老板")
        {
            Tool.GetChild(this.node,"Main/我的/信息/管理").active = true;
        }
        else
        {
            Tool.GetChild(this.node,"Main/我的/信息/管理").active = false;
        }
    }
    public set_role(old)
    {
        // let nShowJL = Tool.GetConfigNumber("特殊开关",1);
        // if((GameDataManager.getAccount().role == "董事长" || GameDataManager.getAccount().role == "总裁") && nShowJL == 1)
        // {
        //     Tool.GetChild(this.node ,"Main/我的/操作/奖励").active = true;
        // }
        // else
        // {
        //     Tool.GetChild(this.node ,"Main/我的/操作/奖励").active = false;
        // }

        // if(cc.sys.isBrowser)
        // {
        //     Tool.GetChild(this.node ,"Main/我的/操作/奖励").active = true;
        // }

    }
    public set_photo(old)
    {
        //Debug.Error("进入更新头像");
        let img = Tool.GetChild(this.node,"Main/我的/信息/头像/mask/img").getComponent(cc.Sprite);
        //if(!ImageManager.getInstance().GetImageByName(KBEngine.app.player().guuid,"",img))
        //{
            ImageManager.getInstance().AddWaitFreshImage2Catch(KBEngine.app.player().guuid, img);
        //}
    }

    //代金券
    // public set_paper(old = 0)
    // {
    //     Tool.GetChild(this.node,"Main/兑换/金币券/num").getComponent(cc.Label).string = GameDataManager.getAccount().paper;
    // }

    // update (dt) {}
    onButtonClick(button:cc.Button)
    {
        Debug.Log("消息:"+button.node.name);
        if(button.node.parent.name === "content")
        {
            //占位房间不能进入
            if(button.node.name == '-999')
            {
                return;
            }

            //私密房并且没有进入过则需要输入房号
            if(button.node.getChildByName("私密房").active && GameDataManager.getAccount().role !="老板")
            {
                let strState = button.node.getChildByName("状态").getComponent(cc.Sprite).spriteFrame.name
                if(strState != "状态_参与过")
                {
                    Tool.GetChild(this.node,"加入房间/bk/房号").getComponent(cc.Label).string = "";
                    this.node.getChildByName("加入房间").active = true;
                    return;
                }
            }

            if(!GpsManager.getInstance().IsGpsOpen()&&ConfigManager.getInstance().enalbe_gps=="True")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"未打开GPS不能进入房间！")
                return;
            }

            UIManager.getInstance().showPanel("panelLoading",ShowPanelMode.Top);
            GameDataManager.getAccount().reqEnterRoom(RoomType.Custom,Number(button.node.name),"{{\"special_rule\": \"观战\"}}");

            MobileManager.getInstance().OnTalkingEvent("加入房间","加入房间");
        }
        else if(button.node.name === "战绩")
        {
            UIManager.getInstance().showPanel("panelRecordList",ShowPanelMode.Cover);
        }
        else if(button.node.name === "查看数据")
        {
            if((GameDataManager.getAccount().gold+GameDataManager.getAccount().gold2/100)<0.5)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"余额不足！");
                return;
            }

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

            let nFanWin = Number(arrayParam[3])>0?Number(arrayParam[5])*100/Number(arrayParam[3]):0;

            let nRuChi = nTotle > 0 ? nRu * 100 / nTotle : 0;

            Tool.GetChild(this.node,"Main/我的/数据/总局数").getComponent(cc.Label).string = arrayParam[4];
            Tool.GetChild(this.node,"Main/我的/数据/总手数").getComponent(cc.Label).string = (Number(arrayParam[0])+ Number(arrayParam[1])+ Number(arrayParam[2])).toString();
            Tool.GetChild(this.node,"Main/我的/数据/翻牌率").getComponent(cc.Label).string = nFanPer.toFixed(0).toString()+"%";
            Tool.GetChild(this.node,"Main/我的/数据/翻牌胜率").getComponent(cc.Label).string = nFanWin.toFixed(0).toString()+"%";
            Tool.GetChild(this.node,"Main/我的/数据/获胜手数").getComponent(cc.Label).string = nWin.toString();
            Tool.GetChild(this.node,"Main/我的/数据/总胜率").getComponent(cc.Label).string =  nWinPer.toFixed(0).toString()+"%";
            Tool.GetChild(this.node,"Main/我的/数据/入池率").getComponent(cc.Label).string =  nRuChi.toFixed(0).toString()+"%";

            //扣费
            strParam = "{\"header\":\"玩家_消费_命令\",\"consume_type\":\"看数据\",\"money\":50}";
            GameDataManager.getAccount().reqHallCommand(strParam, "玩家_消费_命令");
        }
        else if(button.node.name == "推广二维码")
        {
            this.node.getChildByName("推广二维码").active = true;
            let img = Tool.GetChild(this.node ,"推广二维码/二维码/img").getComponent(cc.Graphics);
            this.createQR(img,ConfigManager.getInstance().downloadurl+"/zc?guuid="+GameDataManager.getAccount().guuid);
        }
        else if(button.node.name === "分享二维码")
        {
            MobileManager.getInstance().CaptureScreen();
        }
        else if(button.node.name === "赠送")
        {
            this.node.getChildByName("赠送").active = true;
            this.GetAllExchangeInfo(0);
        }
        else if(button.node.name === "提交赠送")
        {
            let strID = Tool.GetChild(button.node.parent,"用户id").getComponent(cc.EditBox).string;
            let strNum = Tool.GetChild(button.node.parent,"金额").getComponent(cc.EditBox).string;
            if(strID.length != 6)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入正确的用户ID！");
                return;
            }
            // if(strNum === "")
            // {
            //     UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入金额!");
            //     return;
            // }

            UIManager.getInstance().showPanel("panelGivePad",ShowPanelMode.Cover,strID+","+strNum);
        }
        else if(button.node.name === "关闭上层")
        {
            button.node.parent.active = false;
        }
        else if(button.node.name === "关闭上上层")
        {
            button.node.parent.parent.active = false;
        }
        else if(button.node.name === "设置")
        {
            this.node.getChildByName("设置").active = true;
            let nLiaoAudio = Tool.GetConfigNumber("AudioGCloud",1);
            let nGameAudio = Tool.GetConfigNumber("AudioEff",100);
           // let nSpecial = Tool.GetConfigNumber("特殊开关",1);

            Tool.GetChild(this.node,"设置/列表/item/聊天语音/聊天语音").getComponent(cc.Toggle).isChecked = nLiaoAudio == 1?true:false;
            Tool.GetChild(this.node,"设置/列表/item/游戏音效/游戏音效").getComponent(cc.Toggle).isChecked = nGameAudio >=1?true:false;
           // Tool.GetChild(this.node,"设置/列表/特殊开关/特殊开关").getComponent(cc.Toggle).isChecked = nSpecial == 1?true:false;
        
            // if(GameDataManager.getAccount().role == "董事长" || GameDataManager.getAccount().role == "总裁" || GameDataManager.getAccount().level == "99")
            // {
            //     Tool.GetChild(this.node,"设置/列表/特殊开关").active = true;
            // }
            // else
            // {
            //     Tool.GetChild(this.node,"设置/列表/特殊开关").active = false;
            // }
        }
        else if(button.node.name === "切换账号")
        {
            cc.sys.localStorage.setItem("unionid","");
            cc.sys.localStorage.setItem("pass","");
            GameDataManager.getInstance().bLoginSuccess = false;
            cc.game.restart();
            //Tool.RestartGame();
        }
        else if(button.node.name === "修改密码")
        {
            this.node.getChildByName("修改密码").active = true;
            let strAccount = Tool.GetConfigString("unionid","--");
            Tool.GetChild(this.node,"修改密码/列表/账号/账号").getComponent(cc.Label).string = strAccount;
        }
        else if(button.node.name === "获取验证码")
        {
            this.strLastMMSMask = Tool.SendMMS(Tool.GetConfigString("unionid","")); 

            Tool.GetChild(this.node,"修改密码/列表/验证码/time").active = true;
            Tool.GetChild(this.node,"修改密码/列表/验证码/获取验证码").active = false;
            let nCount = 60;
            this.schedule(()=>{
                Tool.GetChild(this.node,"修改密码/列表/验证码/time").getComponent(cc.Label).string = (nCount--).toString();
                if(nCount==0)
                {
                    Tool.GetChild(this.node,"修改密码/列表/验证码/time").active = false;
                    Tool.GetChild(this.node,"修改密码/列表/验证码/获取验证码").active = true; 
                }
            },1,nCount,0.1);
        }
        else if(button.node.name === "确定修改密码")
        {
            let strMask = Tool.GetChild(this.node,"修改密码/列表/验证码/验证码").getComponent(cc.EditBox).string;
            let strPass1 = Tool.GetChild(this.node,"修改密码/列表/新密码1/新密码1").getComponent(cc.EditBox).string;
            let strPass2 = Tool.GetChild(this.node,"修改密码/列表/新密码2/新密码2").getComponent(cc.EditBox).string;

            if(strMask.length != 4)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入验证码");
                return;
            }
            if(strPass1.length<6 || strPass1.length>12)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"密码必须为6到12位！");
                return; 
            }
            if(strPass2.length<6 || strPass2.length>12)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"密码必须为6到12位！");
                return; 
            }
            if(strPass2 !== strPass1)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"2次密码输入不相同！");
                return; 
            }
            if(strMask != this.strLastMMSMask)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"验证码输入不正确！");
                return; 
            }
            Tool.GetChild(this.node,"修改密码/列表/验证码/验证码").getComponent(cc.EditBox).string = "";
            Tool.GetChild(this.node,"修改密码/列表/新密码1/新密码1").getComponent(cc.EditBox).string = "";
            Tool.GetChild(this.node,"修改密码/列表/新密码2/新密码2").getComponent(cc.EditBox).string = "";

            let strParam = "{\"header\":\"修改_玩家_交易密码\",\"old_pwd\":\"000000\",\"new_pwd\":\"" + strPass1 + "\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@修改_玩家_交易密码");

        }
        else if(button.node.name === "资金明细")
        {
            this.node.getChildByName("资金明细").active = true;
            this.GetLiuShuiInfo();
        }
        else if(button.node.name === "奖励")
        {
            UIManager.getInstance().showPanel("panelJiangli",ShowPanelMode.Cover);
        }
        else if(button.node.name === "代理")
        {
            let strLevel = GameDataManager.getAccount().level;
            if(Number(strLevel)>50)
            {
                UIManager.getInstance().showPanel("panelHongli",ShowPanelMode.Cover);
            }
            else
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"你不是代理，没有权限操作！");
            }
            
        }
        else if(button.node.name === "换一批头像")
        {
            this.RandHeadList();
        }
        else if(button.node.name === "确认随机头像")
        {
            let strName = Tool.GetChild(this.node,"修改个人信息/昵称").getComponent(cc.EditBox).string;
            if(strName == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称不能为空！");
                return; 
            }

            //名字只能是中文数字英文
            if(!strName.match(new RegExp('^[A-Za-z0-9\u4E00-\u9FA5]+$')))
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称只能包含中英文和数字！");
                return; 
            }

            this.node.getChildByName("确定随机头像提示面板").active = false;
            this.node.getChildByName("修改个人信息").active = false;
            this.node.getChildByName("修改个人信息2").active = false;

            let random = Math.floor(Math.random() * (1012 - 1001 + 1)) + 1001;
            GameDataManager.getAccount().reqSetProperty("photo",this.IMG_URL+random+".jpg");
            GameDataManager.getAccount().reqSetProperty("name",strName);
        }
        else if(button.node.name === "修改个人信息")
        {

            let strName = Tool.GetChild(this.node,"修改个人信息/昵称").getComponent(cc.EditBox).string;
            if(strName == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称不能为空！");
                return; 
            }
            if(strName.length>10)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称太长！");
                return; 
            }


            //名字只能是中文数字英文
            if(!strName.match(new RegExp('^[A-Za-z0-9\u4E00-\u9FA5]+$')))
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称只能包含中英文和数字！");
                return; 
            }



            let strParam = "{\"header\":\"查询_用户_属性\",\"prop_name\":\"sm_name\",\"prop_value\":\""+strName+"\",\"result_name\":\"sm_guuid\",\"context\":\"名字查重\"}";
            GameDataManager.getAccount().reqHallCommand(strParam,"名字查重");
            
        }
        else if(button.node.name === "修改个人信息2")
        {
            let strName = Tool.GetChild(this.node,"修改个人信息2/昵称").getComponent(cc.EditBox).string;
            if(strName == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称不能为空！");
                return; 
            }
            if(strName.length>10)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称太长！");
                return; 
            }

            //名字只能是中文数字英文
            if(!strName.match(new RegExp('^[A-Za-z0-9\u4E00-\u9FA5]+$')))
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称只能包含中英文和数字！");
                return; 
            }

            let strParam = "{\"header\":\"查询_用户_属性\",\"prop_name\":\"sm_name\",\"prop_value\":\""+strName+"\",\"result_name\":\"sm_guuid\",\"context\":\"名字查重\"}";
            GameDataManager.getAccount().reqHallCommand(strParam,"名字查重");

            //this.node.getChildByName("确定修改个人信息").active = true;
        
            
        }
        else if(button.node.name === "确认修改个人信息")
        {
            if(GameDataManager.getAccount().gold<5)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"金币不足！");
                Tool.GetChild(this.node,"确定修改个人信息").active = false;
                return;
            }
            let strName = Tool.GetChild(this.node,"修改个人信息2/昵称").getComponent(cc.EditBox).string;
            //是否选择头像
            let imgName = Tool.GetChild(this.node,"修改个人信息2/头像/name").getComponent(cc.Label).string;
            if(imgName != "")
            {
                GameDataManager.getAccount().reqSetProperty("photo",this.IMG_URL+imgName+".jpg");
            }
            else
            {

            }
            
            GameDataManager.getAccount().reqSetProperty("name",strName);

            Tool.GetChild(this.node,"修改个人信息2").active = false;
            Tool.GetChild(this.node,"确定修改个人信息").active = false;
            let strParam = "{\"header\":\"玩家_消费_命令\",\"consume_type\":\"换头像\",\"money\":500}";
            GameDataManager.getAccount().reqHallCommand(strParam, "玩家_消费_命令");
            ConfigManager.getInstance().SetOneHashKey("免费头像_"+GameDataManager.getAccount().guuid,"ok")
        }
        else if(button.node.name === "创建房间")
        {
            if(Number(GameDataManager.getAccount().level)<50 && !cc.sys.isBrowser)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"只有代理才能创建私密房!");
                return; 
            }
            UIManager.getInstance().showPanel("panelCreateRoom",ShowPanelMode.Cover);
        }
        else if(button.node.name === "加入房间")
        {
            this.node.getChildByName("加入房间").active = true;
            Tool.GetChild(this.node,"加入房间/bk/房号").getComponent(cc.Label).string = "";
        }
        else if(button.node.name === "客服")
        {
           UIManager.getInstance().showPanel("panelKefu",ShowPanelMode.Cover);    
        }
        else if(button.node.name === "排行榜")
        {
            //UIManager.getInstance().showPanel("panelPaihangbang",ShowPanelMode.Cover);
            Debug.Log("进入");
            if(!Tool.GetChild(this.node,"排行榜"))
            {
                Debug.Log("没有！！！！！！！！");
                cc.loader.loadRes("Prefabs/排行榜",(err,obj)=>{
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
                    node.name = "排行榜";
                    node.parent = this.node;//this.node.getChildByName("Main");
                });
            }
            else
            {
                Debug.Log("有!!!!!!!!!!!!");
                Tool.GetChild(this.node,"排行榜").active = true
            }
        }
        else if(button.node.name === "管理")
        {
            UIManager.getInstance().showPanel("panelManager",ShowPanelMode.Cover);
        }





        else if(button.node.parent.name === "键盘")
        {
            if(this.txtInputRoomid === undefined || this.txtInputRoomid === null)
            {
                this.txtInputRoomid = Tool.GetChild(this.node,"加入房间/bk/房号").getComponent(cc.Label);
            }
            if(button.node.name === "重置")
            {
                this.txtInputRoomid.string = "";
            }
            else if(button.node.name === "删除")
            {
                if(this.txtInputRoomid.string.length>0)
                {
                    this.txtInputRoomid.string = this.txtInputRoomid.string.substr(0,this.txtInputRoomid.string.length-1);
                }
            }
            else
            {
                if(this.txtInputRoomid.string.length>=6)
                {
                    return;
                }
                this.txtInputRoomid.string += button.node.name;
                if(this.txtInputRoomid.string.length >=6)
                {
                    this.node.getChildByName("加入房间").active = false;
                    if(!GpsManager.getInstance().IsGpsOpen()&&ConfigManager.getInstance().enalbe_gps=="True")
                    {
                        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"未打开GPS不能进入房间！")
                        return;
                    }

                    UIManager.getInstance().showPanel("panelLoading",ShowPanelMode.Top);
                    GameDataManager.getAccount().reqEnterRoom(RoomType.Custom,Number(this.txtInputRoomid.string),"{{\"special_rule\": \"观战\"}}");
        
                    MobileManager.getInstance().OnTalkingEvent("加入房间","加入房间");
                }
            }
        }
        else if(button.node.parent.name === "content1")
        {
            let headList = null;
            if(Tool.GetChild(this.node,"修改个人信息").active)
            {
                headList = Tool.GetChild(this.node,"修改个人信息/头像列表/view/content1");
            }
            else
            {
                headList = Tool.GetChild(this.node,"修改个人信息2/头像列表/view/content1");
            }
            for(let item of headList.children)
            {
                if(button.node.name === item.name)
                {
                    item.getComponent(cc.Sprite).enabled = true;
                    Tool.GetChild(headList.parent.parent.parent,"头像/name").getComponent(cc.Label).string = item.name;
                    let img = Tool.GetChild(headList.parent.parent.parent,"头像/mask/img").getComponent(cc.Sprite);
                    let strUrl = this.IMG_URL+item.name+".jpg";
                    cc.loader.load({url:strUrl},function (err,tex) {
                        var spriteFrame = new cc.SpriteFrame(tex);
                        if(cc.isValid(img))
                            img.spriteFrame = spriteFrame;
                    });
                }
                else
                {
                    item.getComponent(cc.Sprite).enabled = false;
                }
            }
        }
        else if(button.node.name === "头像")
        {
            this.node.getChildByName("修改个人信息2").active = true;
            Tool.GetChild(this.node,"修改个人信息2/昵称").getComponent(cc.EditBox).string = GameDataManager.getAccount().name;
            let img = Tool.GetChild(this.node,"修改个人信息2/头像/mask/img").getComponent(cc.Sprite);
            
            cc.loader.load({url:GameDataManager.getAccount().photo},function (err,tex) {
                var spriteFrame = new cc.SpriteFrame(tex);
                if(cc.isValid(img))
                    img.spriteFrame = spriteFrame;
            });

           this.RandHeadList();

           //查询是否第一次修改
           ConfigManager.getInstance().GetOneHashKey("免费头像_"+GameDataManager.getAccount().guuid,"查询免费修改昵称")
        }
        else if(button.node.name.indexOf("公告")>=0)
        {
            this.node.getChildByName(button.node.name).active = true;
            if(button.node.name == "公告6")
            {
                ConfigManager.getInstance().GetOneHashKey("系统公告","公告6");
            }
            if(button.node.name == "公告7")
            {
                ConfigManager.getInstance().GetOneHashKey("惩罚公告","公告7");
            }
            if(button.node.name == "公告8")
            {
                ConfigManager.getInstance().GetOneHashKey("充值提现公告","公告8");
            }
            // else if(button.node.name == "公告6")
            // {
                
            //     let strParam = "{\"header\":\"设置_哈希2_信息\",\"key\":\"处罚记录\",\"content\":\""+Tool.Base64Encode("---")+"\",\"context\":\"设置_处罚记录\"}";
            //     GameDataManager.getAccount().reqAccountCommand(strParam, "P@设置_处罚记录"); 
            // }
        }
        else if(button.node.name == "选择头像")
        {
            if(cc.sys.os == cc.sys.OS_ANDROID)
            {
                jsb.reflection.callStaticMethod('org/cocos2dx/javascript/AppActivity', 'OpenGally', '()V');  
            } 
            else if(cc.sys.os == cc.sys.OS_IOS)
            {
                jsb.reflection.callStaticMethod("AppController","OpenGally");
            }
            else
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"只支持手机");
            }
        }
        else if(button.node.name == "上一页")
        {
            if(this.scrollCFNotify.nCurPage <= 1)
                return;
            this.GetCFNotifyInfo(this.scrollCFNotify.nCurPage-1);
        }
        else if(button.node.name == "下一页")
        {
            if(this.scrollCFNotify.nCurPage+1>this.scrollCFNotify.nTotlePage)
                return;
            this.GetCFNotifyInfo(this.scrollCFNotify.nCurPage+1);
        }
        else if(button.node.name == "尾页")
        {
            if(this.scrollCFNotify.nTotlePage == 0)
                return;
            this.GetCFNotifyInfo(this.scrollCFNotify.nTotlePage);
        }
        else if(button.node.name == "首页")
        {
            this.GetCFNotifyInfo();
        }

        else if(button.node.name === "测试绑定")
        {
            let strID = button.node.parent.getChildByName("id").getComponent(cc.EditBox).string;

            let strLogin = cc.sys.localStorage.getItem("unionid");

            let strParam = "{\"header\":\"设置_玩家上级_信息\",\"upper_guuid\":\"" + strID + "\",\"player_wxid\":\"" + strLogin + "\",\"player_wxname\":\"" + GameDataManager.getAccount().name + "\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_玩家上级_信息");
        }
        else if(button.node.name === "重新加载")
        {
            let strParam = "{\"header\":\"加载_玩家上级_信息\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@加载_玩家上级_信息");
        }
        else if(button.node.parent.name === "转盘1" || button.node.parent.name === "转盘2")
        {
            this.MoveItemPos(button.node)
        }
        else if(button.node.name === "兑换金币券")
        {
            if(Number(GameDataManager.getAccount().paper)<100)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"金币券不足一百张，不能兑换!")
                return;
            }
            let strParam = "{\"header\":\"提取_玩家_代金券\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@提取_玩家_代金券");
        }
        else if(button.node.name === "清除用户" || button.node.name === "清除密码")
        {
            button.node.parent.getComponent(cc.EditBox).string = ""
        }
        else if(button.node.name === '左箭头')
        {
            //拿到当前在哪
            let root = Tool.GetChild(this.node,"Main/我的/操作台/功能");
            let index = 0;
            for(let item of root.children)
            {
                if(item.active)
                {
                    index = item.getSiblingIndex();
                    break;
                }
            }
            index--;
            if(index<0)
            {
                index = root.children.length-1;
            }
            for(let i=0;i<root.children.length;i++)
            {
                if(i == index)
                {
                    root.children[i].active = true;
                }
                else
                {
                    root.children[i].active = false;
                }
            }
        }
        else if(button.node.name === '右箭头')
        {
           //拿到当前在哪
           let root = Tool.GetChild(this.node,"Main/我的/操作台/功能");
           let index = 0;
           for(let item of root.children)
           {
               if(item.active)
               {
                   index = item.getSiblingIndex();
                   break;
               }
           }
           index++;
           if(index>=root.children.length)
           {
               index = 0;
           }
           for(let i=0;i<root.children.length;i++)
           {
               if(i == index)
               {
                   root.children[i].active = true;
               }
               else
               {
                   root.children[i].active = false;
               }
           }
        }
        else if(button.node.name == "修改预留信息")
        {
            UIManager.getInstance().showPanel("修改预留信息",ShowPanelMode.Cover);
        }
        else if(button.node.name == "上一个")
        {
            this.nCurPosS++
            if(this.nCurPosS>=this.arrayDHS.length) //越界了，需要复位
            {
                this.nCurPosS = 0;
            }
            button.interactable = false;
            let anPos = this.nCurPosS-1
            if(anPos<0)
            {
                anPos = this.arrayDHS.length-1
            }
            Debug.Log("s位置:"+this.nCurPosS+" "+this.arrayDHS[anPos])
            this.animateSet.playAnimation(this.arrayDHS[anPos],1)
            this.animateSet.addEventListener(dragonBones.EventObject.COMPLETE,()=>{
                button.interactable = true;
            },this);
            //修复对象位置
            for(let i = 0;i<this.arrayDHN.length;i++)
            {
                let strNextName = this.arrayDHS[this.nCurPosS]
                if(this.arrayDHN[i].indexOf(strNextName)>=0)
                {
                    //找到
                    this.nCurPosN = i;
                    Debug.Log("n位置:"+this.nCurPosN+" "+this.arrayDHN[this.nCurPosN])
                }
            }
        }
        else if(button.node.name == "下一个")
        {
            this.nCurPosN++
            if(this.nCurPosN>=this.arrayDHN.length) //越界了，需要复位
            {
                this.nCurPosN = 0;
            }
            button.interactable = false;
            let anPos = this.nCurPosN-1
            if(anPos<0)
            {
                anPos = this.arrayDHN.length-1
            }
            Debug.Log("n位置:"+this.nCurPosN+" "+this.arrayDHN[anPos])
            this.animateSet.playAnimation(this.arrayDHN[anPos],1)
            this.animateSet.addEventListener(dragonBones.EventObject.COMPLETE,()=>{
                button.interactable = true;
            },this);
            
            //修复对象位置
            for(let i = 0;i<this.arrayDHS.length;i++)
            {
                let strNextName = this.arrayDHN[this.nCurPosN]
                strNextName = strNextName.replace("_1","")
                if(this.arrayDHS[i].indexOf(strNextName)>=0)
                {
                    //找到
                    this.nCurPosS = i;
                    Debug.Log("s位置:"+this.nCurPosS+" "+this.arrayDHS[this.nCurPosS])
                }
            }
        }
        else if(button.node.name == "动画选择")
        {
            let btn = Tool.GetChild(this.node,"Main/我的/操作动画/按钮/"+this.arrayBTNName[this.nCurPosS]).getComponent(cc.Button);

            this.onButtonClick(btn);
        }
        else if(button.node.name == "世界杯")
        {
            ConfigManager.getInstance().GetOneHashKey("世界杯2","世界杯2");
        }
        else if(button.node.name == "个人数据")
        {
            UIManager.getInstance().showPanel("panelVipInfo",ShowPanelMode.Cover);
        }
        else if(button.node.name == "修改登陆密码")
        {
            this.node.getChildByName("修改登陆密码").active = true;
        }
        else if(button.node.name == "确定修改登陆密码")
        {
            let strOldPwd = Tool.GetChild(this.node,"修改登陆密码/列表/原有密码/txt").getComponent(cc.EditBox).string
            let strNewPwd1 = Tool.GetChild(this.node,"修改登陆密码/列表/新密码1/txt").getComponent(cc.EditBox).string
            let strNewPwd2 = Tool.GetChild(this.node,"修改登陆密码/列表/新密码2/txt").getComponent(cc.EditBox).string
            if(strOldPwd == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入旧密码");
                return
            }
            if(strNewPwd1 == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入新密码");
                return
            }
            if(strNewPwd2 == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请再次输入新密码");
                return
            }
            if(strNewPwd1 != strNewPwd2)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"两次密码输入不一致");
                return
            }

            //开始修改
            let strParam = "{\"header\":\"修改_玩家_登录密码\",\"old_pwd\":\""+strOldPwd+"\",\"new_pwd\":\"" + strNewPwd1 + "\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@修改_玩家_登录密码");
        }
        else if(button.node.name == "修改交易密码")
        {
            if(this.bNeedInitJYPwd)
            {
                Tool.GetChild(this.node,"初始化交易密码").active = true
            }
            else
            {
                this.node.getChildByName("修改交易密码").active = true;
            }
            
        }
        else if(button.node.name == "确定修改交易密码")
        {
            let strOldPwd = Tool.GetChild(this.node,"修改交易密码/列表/原有密码/txt").getComponent(cc.EditBox).string
            let strNewPwd1 = Tool.GetChild(this.node,"修改交易密码/列表/新密码1/txt").getComponent(cc.EditBox).string
            let strNewPwd2 = Tool.GetChild(this.node,"修改交易密码/列表/新密码2/txt").getComponent(cc.EditBox).string
            if(strOldPwd == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入旧密码");
                return
            }
            if(strNewPwd1 == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入新密码");
                return
            }
            if(strNewPwd2 == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请再次输入新密码");
                return
            }
            if(strNewPwd1 != strNewPwd2)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"两次密码输入不一致");
                return
            }

            //开始修改
            let strParam = "{\"header\":\"修改_玩家_交易密码\",\"old_pwd\":\""+strOldPwd+"\",\"new_pwd\":\"" + strNewPwd1 + "\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@修改_玩家_交易密码");
        }
        else if(button.node.name == "确定初始化交易密码")
        {
            let strNewPwd1 = Tool.GetChild(this.node,"初始化交易密码/列表/新密码1/txt").getComponent(cc.EditBox).string
            let strNewPwd2 = Tool.GetChild(this.node,"初始化交易密码/列表/新密码2/txt").getComponent(cc.EditBox).string
            if(strNewPwd1 == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入新密码");
                return
            }
            if(strNewPwd2 == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请再次输入新密码");
                return
            }
            if(strNewPwd1 != strNewPwd2)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"两次密码输入不一致");
                return
            }
            //开始修改
            let strParam = "{\"header\":\"修改_玩家_交易密码\",\"old_pwd\":\"\",\"new_pwd\":\"" + strNewPwd1 + "\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@修改_玩家_交易密码");
        }
        else if(button.node.name == "惩罚列表")
        {
            Tool.GetChild(this.node,"惩罚列表").active = true
            this.GetCFNotifyInfo()
        }

    }

    private nCurPosS = 0; //当前动画位置
    private nCurPosN = 0; //当前动画位置
    private arrayDHS:string[] = ["Animation_MoneyFlow","Animation_Set","Animation_Agent","Animation_Record","Animation_Give"] //所有动画 顺时针
    private arrayDHN:string[] = ["Animation_MoneyFlow_1","Animation_Give_1","Animation_Record_1","Animation_Agent_1","Animation_Set_1"] //所有动画 逆时针
    private arrayBTNName:string[] = ["资金明细","设置","代理","战绩","赠送"]
    private strLastMMSMask:string = "";

    onToggleClick(toggle:cc.Toggle)
    {        
        if(toggle.node.name === "发现")
        {
            this.switchTabSel(toggle.node.name);
            //this.scrollRoom.LastEvent = ScrollEvent.Normal;
            this.bEnableScroll2Top = true;
            this.getAllRooms();
        }
        else if(toggle.node.name === "公告")
        {
            this.switchTabSel(toggle.node.name);
        }
        else if(toggle.node.name === "兑换")
        {
            this.switchTabSel(toggle.node.name);
        }
        else if(toggle.node.name === "约局")
        {
            this.switchTabSel(toggle.node.name);
        }
        else if(toggle.node.name === "排行榜")
        {
            Debug.Log("进入");
            this.switchTabSel(toggle.node.name);

            if(!Tool.GetChild(this.node,"排行榜"))
            {
                Debug.Log("没有！！！！！！！！");
                cc.loader.loadRes("Prefabs/排行榜",(err,obj)=>{
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
                    node.name = "排行榜";
                    node.parent =this.node.getChildByName("Main");
                });
            }
            else
            {
                Debug.Log("有!!!!!!!!!!!!");
            }
        }
        else if(toggle.node.name === "钱包")
        {
            Debug.Log("进入");
            this.switchTabSel(toggle.node.name);

            if(!Tool.GetChild(this.node,"Main/钱包"))
            {
                Debug.Log("没有！！！！！！！！");
                cc.loader.loadRes("Prefabs/钱包",(err,obj)=>{
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
                    node.parent =this.node.getChildByName("Main");
                });
            }
            else
            {
                Debug.Log("有!!!!!!!!!!!!");
            }


        }
        else if(toggle.node.name === "我的")
        {

            //更新vip信息
            let strParam = "{\"header\":\"玩家_查询_VIP\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@玩家_查询_VIP");

            strParam = "{\"header\":\"校验_玩家_交易密码\",\"old_pwd\":\"\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@校验_玩家_交易密码");


            // let strParam:string = GameDataManager.getAccount().remark;
            // if (strParam == "")
            //     strParam = "0,0,0,0,0,0,0";
            // let arrayParam = strParam.split(',');

            // let nWin = Number(arrayParam[0]);
            // let nLose = Number(arrayParam[1]);
            // let nHe = Number(arrayParam[2]);
            // let nRu = Number(arrayParam[6]); //入池次数

            // let nTotle = nWin + nLose + nHe;
            // let nFanPer = nTotle > 0 ? Number(arrayParam[3]) * 100 / nTotle : 0;
            // let nWinPer = nTotle > 0 ? nWin * 100 / nTotle : 0;

            // let nFanWin = Number(arrayParam[3])>0?Number(arrayParam[5])*100/Number(arrayParam[3]):0;

            // let nRuChi = nTotle > 0 ? nRu * 100 / nTotle : 0;



                    
            // Tool.GetChild(this.node,"Main/我的/数据/总手数").getComponent(cc.Label).string = (Number(arrayParam[0])+ Number(arrayParam[1])+ Number(arrayParam[2])).toString();
            // Tool.GetChild(this.node,"Main/我的/数据/总胜率").getComponent(cc.Label).string =  nWinPer.toFixed(0).toString()+"%";
            // Tool.GetChild(this.node,"Main/我的/数据/获胜手数").getComponent(cc.Label).string = nWin.toString();
            // Tool.GetChild(this.node,"Main/我的/数据/平局手数").getComponent(cc.Label).string = nHe.toString();
            // Tool.GetChild(this.node,"Main/我的/数据/失败手数").getComponent(cc.Label).string = nLose.toString();
            



            this.switchTabSel(toggle.node.name);
        }
        else if(toggle.node.name === "全" || toggle.node.name === "小" || toggle.node.name === "中" || toggle.node.name === "大" || toggle.node.name === "有空位")
        {
            if(toggle.node.parent.name === "过滤")
            {
                //this.scrollRoom.LastEvent = ScrollEvent.Normal;
                this.bEnableScroll2Top = true;
                this.getAllRooms(0,true);
            }
        }
        else if(toggle.node.parent.name === "过滤")
        {
           // this.scrollRoom.LastEvent = ScrollEvent.Normal;
            this.getAllRooms(0,true);
        }
        else if(toggle.node.name === "聊天语音")
        {
            cc.sys.localStorage.setItem("AudioGCloud",toggle.isChecked?1:0);
        }
        else if(toggle.node.name === "游戏音效")
        {
            cc.sys.localStorage.setItem("AudioEff",toggle.isChecked?100:0);
        }
        else if(toggle.node.name === "特殊开关")
        {
            cc.sys.localStorage.setItem("特殊开关",toggle.isChecked?1:0);
            // if(toggle.isChecked)
            // {
            //     if(GameDataManager.getAccount().role == "董事长" || GameDataManager.getAccount().role == "总裁" || GameDataManager.getAccount().level == "99")
            //     {
            //         Tool.GetChild(this.node ,"Main/我的/操作/奖励").active = true;
            //     }
            // }
            // else
            // {
            //     Tool.GetChild(this.node ,"Main/我的/操作/奖励").active = false;
            // }
        }
    }

    switchTabSel(strName:string)
    {
        let arrayTemp = this.node.getChildByName("Main").children;
        arrayTemp.forEach((item,idx,array)=>{
            if(item.name == strName)
            {
                item.active = true;
            }
            else
            {
                item.active = false;
            }
        });

        //复位Toggle
        let arrayToggle = this.node.getChildByName("Down").getComponentsInChildren(cc.Toggle);
        arrayToggle.forEach((item,idx,array)=>{
            if(item.node.name === strName)
            {
                if(!item.isChecked)
                {
                    item.isChecked = true;
                }
            }
            else
            {
                if(item.isChecked)
                {
                    item.isChecked = false;
                }
            }
        });
    }

    //获取房间列表
    getAllRooms(nPage:number = 0,bFouce:boolean = false)
    {
        let span = new Date().getTime()-this.dtLastGetAllRoom;
        if(span<1000 && !bFouce)
        {
            return;
        }
        this.dtLastGetAllRoom = new Date().getTime();

        let strRoomType:string = "";
        let nHaveFreeSit:number = 0;


        let arrayType = Tool.GetChild(this.node,"Main/发现/过滤").getComponentsInChildren(cc.Toggle);
        // arrayType.forEach((item,idx,array)=>{
        //     if(item.node.name === "有空位")
        //     {
        //         nHaveFreeSit = item.isChecked?1:0;
        //     }
        //     else
        //     {
        //         if(!item.isChecked)
        //             return;
        //         strRoomType += item.node.name;
        //         strRoomType += ",";
        //     }
        // });
        for(let one of arrayType)
        {
            if(one.isChecked)
            {
                strRoomType = one.node.name;
                break;
            }
        }

        this.strPreRoomParam = this.strCurRoomParam;
        this.strCurRoomParam = strRoomType+nHaveFreeSit.toString();


        //Debug.Log("查询列表");
        //return;
   
        let strParam = "{\"header\":\"查询_所有_自创_房间\",\"is_zip_result\":\"1\",\"page\":\"" + nPage + "\",\"count\":\"" + 200 + "\",\"fillter_01\":\"" + strRoomType + "\",\"is_have_site\":\"" + nHaveFreeSit + "\",\"fillter_02\":\"\",\"is_no_running\":\"0\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_所有_自创_房间");
    }

    //解析房间列表信息
    OnClubRoomInfo(strMsg:string)
    {
        let msg = JSON.parse(strMsg);
        if(msg == null)
        {
            Debug.Log("解析OnClubRoomInfo内容失败！");
            return;
        }
        let data = msg.result;


        //校验消息是否属实压缩消息，不是则抛弃
        if(data.length>0)
        {
            if(strMsg.indexOf("room_id")>=0)
            {
                //非压缩消息，丢弃
                Debug.Error("丢弃非压缩消息");
                return;
            }
        }


        let nCount = 0;
        let nCurPage = 0;
        if(msg.hasOwnProperty("count"))
        {
            nCount = msg.count;
            nCurPage = msg.number;
            if(msg.result.length>0)
            {
                this.scrollRoom.nCurPage = nCurPage;
            }
        }

        this.scrollRoom2 = this.scrollRoom.getComponent(scrollview2);
        let temp = [];
        for(let i=0;i<data.length;i++)
        {
            let objRoom:cc.Node = null;
            let jRoom = data[i];
            temp.push(jRoom);
        }
        if(nCurPage == 0)
        {
            //房间数小于8，需要补位到8
            if(temp.length<8&&temp.length>0)
            {
                let tt = []
                for(let i=0;i<8-temp.length;i++)
                {
                    let one = [];
                    one.push(...temp[0])
                    one[0] = '-999';
                    tt.push(one)
                }
                temp.push(...tt);
            }


            this.arrayRoomData = [];
            this.arrayRoomData.push(...temp);
            this.scrollRoom2.Init(this.arrayRoomData,true);
            //if(this.bEnableScroll2Top)
            {
                this.scrollRoom.scrollToTop();
                this.bEnableScroll2Top = false;
            }
            
        }
        else
        {
            if(temp.length>0)
            {
                this.arrayRoomData.push(...temp);
                this.scrollRoom2.Init(this.arrayRoomData,false);
            }

        }

     //   let cashItem = new Array<cc.Node>();
 

        //刷新界面
        /*
        for(let i=0;i<data.length;i++)
        {
            let objRoom:cc.Node = null;
            let jRoom = data[i];
            let room_id = jRoom.room_id;
            let room_status = jRoom.room_status;

            if(nCurPage == 0) 
            {
                
                
                
                
                
                let test = this.scrollRoom.content.childrenCount;
                if(i>=this.scrollRoom.content.childrenCount)
                {
                    // cc.loader.loadRes("Prefabs/房间对象",(err,obj)=>{
                    //     if(err)
                    //     {
                    //         cc.error(err.message || err);
                    //         return null;
                    //     }
                    //     let node = cc.instantiate(obj);
                    //     node.parent = this.scrollRoom.content;
                    //     this.setRoomItemInfo(node,jRoom,i==0&&nCurPage==0?true:false);
                    // });
                    ObjPoolManager.getInstance().getObj('房间对象',(err,node)=>{
                        if(err)
                        {
                            Debug.Log(err.message);
                            return null;
                        }
                        node.parent = this.scrollRoom.content;
                        this.setRoomItemInfo(node,jRoom,i==0&&nCurPage==0?true:false);
                    });
                }
                else
                {
                    this.setRoomItemInfo(this.scrollRoom.content.children[i],jRoom);
                }
            }
            else
            {
                //节点是否已经存在
                let arrayChild = this.scrollRoom.content.children; 
                for(let item of arrayChild)
                {
                    if(item.name == room_id)
                    {
                        objRoom = item;
                        break;
                    }
                }

                //结束状态的房间需要关闭
                if(room_status === "关闭" && objRoom!= null && cc.isValid(objRoom))
                {
                    //objRoom.destroy();
                    ObjPoolManager.getInstance().returnObj('房间对象',objRoom);
                    continue;
                }

                if(objRoom === null || !cc.isValid(objRoom) || !objRoom.active)
                {
                    // cc.loader.loadRes("Prefabs/房间对象",(err,obj)=>{
                    //     if(err)
                    //     {
                    //         cc.error(err.message || err);
                    //         return null;
                    //     }
                    //     let node = cc.instantiate(obj);
                    //     node.parent = this.scrollRoom.content;
                    //     this.setRoomItemInfo(node,jRoom,i==0&&nCurPage==0?true:false);
                    // });
                    ObjPoolManager.getInstance().getObj('房间对象',(err,node)=>{
                        if(err)
                        {
                            Debug.Log(err.message);
                            return null;
                        }
                        node.parent = this.scrollRoom.content;
                        this.setRoomItemInfo(node,jRoom,i==0&&nCurPage==0?true:false);
                    });
                }
                else
                {
                    this.setRoomItemInfo(objRoom,jRoom);
                }
            }
 
            
        }
       //如果是第一页，则清空
       if(nCurPage === 0)
       {      
           //多余的对象全部删除
           let arrayDel = new Array<cc.Node>();
           for(let i=data.length;i<this.scrollRoom.content.childrenCount;i++)
           {
               arrayDel.push(this.scrollRoom.content.children[i]);
           }
           for(let item of arrayDel)
           {
               //item.destroy();
               ObjPoolManager.getInstance().returnObj('房间对象',item);
           }
       }*/


        //let old = this.scrollRoom.getScrollOffset();

        // this.scheduleOnce(()=>{
           
        //     if((this.scrollRoom.content.height-this.scrollRoom.content.getComponent(cc.Layout).paddingBottom)<=this.scrollRoom.node.height)
        //     {
        //         this.scrollRoom.content.getComponent(cc.Layout).paddingBottom = this.scrollRoom.node.height - (this.scrollRoom.content.height-this.scrollRoom.content.getComponent(cc.Layout).paddingBottom) +100;
               
        //     }
        //     else
        //     {
        //         this.scrollRoom.content.getComponent(cc.Layout).paddingBottom = 100;            }

        // },0.1);
    }
    //设置房间信息
    setRoomItemInfo(node:cc.Node,jRoom:any,bToTop:boolean = false)
    {
        let room_id = jRoom.room_id;
        let creater_guuid = jRoom.creater_guuid;
        let room_status = jRoom.room_status;
        let remark = jRoom.remark;
        let is_sitedowned = jRoom.is_sitedowned;
        let inhold_count = jRoom.inhold_count;
        let play_mode = jRoom.play_mode;

        node.active = true;
        node.name = room_id.toString();
        return;

        let strRoomName = "";
        let strDiPi = "";
        let strMangGuo = "";
        let strDefTime = "";
        let strRule = "";
        let bSpecialMode = false;
        for(let i=0;i<jRoom.special_rule.length;i++)
        {
            let strTemp:string = jRoom.special_rule[i];
            if(strTemp.indexOf("房间名称:")>=0)
            {
                strRoomName = strTemp.replace("房间名称:","");
            }
            if (strTemp.indexOf("芒果") >= 0 && strTemp.indexOf("/") >= 0)
            {
                strMangGuo = strTemp;
            }
            if (strTemp.indexOf("底皮") >= 0)
            {
                strDiPi = strTemp;
            }
            if(strTemp.indexOf("分钟")>=0)
            {
                strDefTime = strTemp;
            }

            if(strTemp.indexOf("地九王")>=0)
            {
                bSpecialMode = true;
            }
        }
        if(strRoomName.indexOf("私密房")<0)
        {
            node.getChildByName("name").getComponent(cc.Label).string = strRoomName;
            node.getChildByName("私密房").active = false;
        }
        else
        {
            node.getChildByName("name").getComponent(cc.Label).string = "";
            node.getChildByName("私密房").active = true;
        }
        node.getChildByName("地九王").active = bSpecialMode;        
        node.getChildByName("底皮").getComponent(cc.Label).string = strDiPi.replace("底皮","");
        node.getChildByName("人数").getComponent(cc.Label).string = (jRoom.player_list.length+inhold_count).toString()+"/"+jRoom.max_number.toString();
        node.getChildByName("时间").getComponent(cc.Label).string = strDefTime;
        node.getChildByName("倒计时").getComponent(cc.Label).string = "剩余 "+remark+"";

        if(is_sitedowned === "True")
        {             
            cc.loader.loadRes("other/状态_参与过",cc.SpriteFrame,(err,obj)=>{
                if(err)
                {
                    cc.error(err.message || err);
                    return null;
                }
                if(cc.isValid(node))
                    node.getChildByName("状态").getComponent(cc.Sprite).spriteFrame = obj;
            });

            //更新背景
            cc.loader.loadRes("other/背景_参与过",cc.SpriteFrame,(err,obj)=>{
                if(err)
                {
                    cc.error(err.message || err);
                    return null;
                }
                if(cc.isValid(node))
                    node.getComponent(cc.Sprite).spriteFrame = obj;
            });
        }
        else
        {
            cc.loader.loadRes("other/状态_"+room_status,cc.SpriteFrame,(err,obj)=>{
                if(err)
                {
                    cc.error(err.message || err);
                    return null;
                }
                if(cc.isValid(node))
                    node.getChildByName("状态").getComponent(cc.Sprite).spriteFrame = obj;
            });     
            
            //更新背景
            cc.loader.loadRes("other/背景_"+room_status,cc.SpriteFrame,(err,obj)=>{
                if(err)
                {
                    cc.error(err.message || err);
                    return null;
                }
                if(cc.isValid(node))
                    node.getComponent(cc.Sprite).spriteFrame = obj;
            }); 
        }

        let btn = node.getComponent(cc.Button);
        
        btn.node.targetOff(this);
        btn.node.on("click",()=>{
            this.onButtonClick(btn);
        },this);
    }

    onEnterRoom(nCode:number,nRoomID:number)
    {
        //准备进入游戏
        if(nCode === 0x200) //进入房间成功！
        {
            cc.director.loadScene("drh8");    
        }
        else
        {
            let strMsg = "";
            if (nCode == 0x301)
            {
                strMsg = "进入房间失败!";
            }
            else if (nCode == 0x302)
            {
                strMsg = "房间不存在！";
            }
            else if (nCode == 0x303)
            {
                strMsg = "房间已满！";
            }
            else if (nCode == 0x304)
            {
                strMsg = "钱不够啦！";
            }
            else if (nCode == 0x305)
            {
                strMsg = "房间已经解散！";
            }
            else if (nCode == 0x306)
            {
                strMsg = "规则不允许相同IP客户端加入游戏！";
            }


            UIManager.getInstance().closePanelByName("panelLoading",ClosePanelMode.Top);
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,strMsg);
        }
    }

    //恢复房间
    onGetReturnedRoom(nCode:number,nRoomID:number)
    {
        UIManager.getInstance().closePanelByName("panelLoading",ClosePanelMode.Top);
        if(nCode === 0x200) //需要恢复房间
        {
            if(!GpsManager.getInstance().IsGpsOpen()&&ConfigManager.getInstance().enalbe_gps=="True")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"未打开GPS不能进入房间！")
                return;
            }
            GameDataManager.getAccount().reqEnterRoom(RoomType.Custom,nRoomID,"");
        }
    }
    public createQR(ctx:cc.Graphics,url:string) 
    {
        Debug.Log(url);
		let qrcode:QRCode = new QRCode(-1, QRErrorCorrectLevel.H);
		qrcode.addData(url);
		qrcode.make();

        ctx.fillColor = cc.Color.BLACK;  
        
		//块宽高
		let tileW = ctx.node.width / qrcode.getModuleCount();
		let tileH = ctx.node.height / qrcode.getModuleCount();

		// draw in the Graphics
		for (let row = 0; row < qrcode.getModuleCount(); row++) {
			for (let col = 0; col < qrcode.getModuleCount(); col++) {
				if (qrcode.isDark(row, col)) {
					// ctx.fillColor = cc.Color.BLACK;
					let w = (Math.ceil((col + 1) * tileW) - Math.floor(col * tileW));
					let h = (Math.ceil((row + 1) * tileW) - Math.floor(row * tileW));
					ctx.rect(Math.round(col * tileW)-ctx.node.width/2 , Math.round(row * tileH)-ctx.node.height/2, w, h);
					ctx.fill();
				}
			}
		}
    }
    
    public onExChange(nCode:number)
    {
        let strMsg = "";
        if (nCode == 0x200) //成功
        {
            strMsg = "交易成功！";
            this.GetAllExchangeInfo();
            Tool.GetChild(this.node,"赠送/操作/用户id").getComponent(cc.EditBox).string = "";
            Tool.GetChild(this.node,"赠送/操作/金额").getComponent(cc.EditBox).string = "";
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
    public GetAllExchangeInfo(nPage:number = 0)
    {
        GameDataManager.getAccount().reqGetExchangeInfo(nPage);
    }
    public OnGetExchangeList(strMsg:string)
    {
        this.scrollExchangeInfo.UpdateList(strMsg,"ExchangeInfo","赠送记录对象",this.PAGE_PER_COUNT,this.setExchangeItemInfo.bind(this));
    }
    public setExchangeItemInfo(node:cc.Node,objOne:any)
    {
        node.active = true;
        
        let strTarID = objOne["target_guuid"];
        let strTarName = objOne["target_name"];
        let strSrcID = objOne["user_guuid"];
        let strSrcName = objOne["user_name"];

        let strDate:string = objOne["date"];
        strDate  = strDate.replace(" ","\r\n");
        let strStoneNum = objOne["stone_number"];
        let strType = objOne["type"];

        //判断是转入还是转出
        let strUserID = GameDataManager.getAccount().guuid;

        if (strUserID == strSrcID) //转出
        {
            node.getChildByName("id").getComponent(cc.Label).string = strTarName+"\r\nID:"+strTarID;
            node.getChildByName("count").getComponent(cc.Label).string = strStoneNum;
            node.getChildByName("type").getComponent(cc.Label).string = "转出";
        }
        else
        {
            node.getChildByName("id").getComponent(cc.Label).string = strSrcName+"\r\nID:"+strSrcID;
            node.getChildByName("count").getComponent(cc.Label).string = strStoneNum;
            node.getChildByName("type").getComponent(cc.Label).string = "转入"
        }
        node.getChildByName("time").getComponent(cc.Label).string = strDate;        
    }
    
    public onHallCommand(nCode:number, param:string)
    {
        if(param.indexOf("修改_玩家_登录密码")>=0 || param.indexOf("修改_玩家_交易密码")>=0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "修改密码成功！");                
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("提取_玩家_代金券")>=0)
        {
            if (nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                let content = data["LetPaperToGold"]["prompt"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, content);                
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("玩家_查询_VIP")>=0)
        {
            if (nCode == 0x200)
            {
                
                //更新vip信息
                let msg = JSON.parse(param);
                let data = msg["result"];
                if(data["is_vip"] == 1)
                {
                    let level = data["vip_level"].toString()
                    Tool.GetChild(this.node,"Main/我的/信息/VIP").active = true
                    let arrayAll = Tool.GetChild(this.node,"Main/我的/信息/VIP/VIP类型").children
                    for(let one of arrayAll)
                    {
                        if(one.name == level)
                        {
                            one.active = true
                        }
                        else
                        {
                            one.active = false
                        }
                    }
                    Tool.GetChild(this.node,"Main/我的/信息/VIP/VIP到期时间").getComponent(cc.Label).string = data["vip_due_datetime"]+"到期"
                }
                else
                {
                    Tool.GetChild(this.node,"Main/我的/信息/VIP").active = false
                }
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("校验_玩家_交易密码")>=0)
        {
            if (nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
               
                this.bNeedInitJYPwd = true
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                this.bNeedInitJYPwd = false
            }
        }

    }
    //查询资金流水
    public GetLiuShuiInfo(nPage:number = 0)
    {        
        let strParam = "{\"header\":\"查询_玩家_现金流水\",\"user_id\":\"" + GameDataManager.getAccount().guuid + "\",\"page\":\"" + nPage.toString() + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_玩家_现金流水");
    }

    public ListPlayerCashWater(strMsg:string)
    {
        this.scrollLiushui.UpdateList(strMsg,"ListPlayerCashWater","资金明细对象",this.PAGE_PER_COUNT,this.setLiushuiItemInfo.bind(this));
    }
    public setLiushuiItemInfo(node:cc.Node,jItem:any)
    {
        node.active = true;

        node.getChildByName("type").getComponent(cc.Label).string = jItem["option_type"];
        node.getChildByName("count").getComponent(cc.Label).string = jItem["add_money"];
        node.getChildByName("now").getComponent(cc.Label).string = jItem["new_money"];
        node.getChildByName("time").getComponent(cc.Label).string = jItem["date"];

        if(Number(jItem["add_money"])>0)
        {
            node.getChildByName("count").color = cc.Color.RED;
        }
        else if(Number(jItem["add_money"])<0)
        {
            node.getChildByName("count").color = cc.Color.GREEN;
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
        if(context === "大厅查询公告")
        {
            if(strContent!="")
            {
                UIManager.getInstance().showPanel("panelNotifyView",ShowPanelMode.Cover,strContent);
            }
        }
        else  if(context === "充值公告")
        {
            if(strContent!="")
            {
                UIManager.getInstance().showPanel("panelNotifyViewCZ",ShowPanelMode.Cover,strContent);
            }
        }
        else  if(context === "活动公告")
        {
            if(strContent!="")
            {
                UIManager.getInstance().showPanel("panelNotifyViewHD",ShowPanelMode.Cover,strContent);
            }
        }
        else if(context === "公告6")
        {
            Tool.GetChild(this.node,"公告6/list/view/content/msg").getComponent(cc.Label).string = strContent==""?"":Tool.Base64Decode(strContent);;
        }
        else if(context === "公告7")
        {
            Tool.GetChild(this.node,"公告7/list/view/content/msg").getComponent(cc.Label).string = strContent==""?"":Tool.Base64Decode(strContent);;
        }
        else if(context === "公告8")
        {
            Tool.GetChild(this.node,"公告8/list/view/content/msg").getComponent(cc.Label).string = strContent==""?"":Tool.Base64Decode(strContent);;
        }
        else if(context === "世界杯2")
        {
            if(strContent == "1")
            {
                UIManager.getInstance().showPanel("panelSJB",ShowPanelMode.Cover);
            }
            else
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,strContent);
            }
        }
        else if(context === "查询免费修改昵称")
        {
            this.strFirstModifyName = strContent
        }
    }
    public UserHash2Info(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        if(data == null)
            return;
        let info = data["UserHash2Info"];
        let strKey:string = info["key"];
        let strContent:string = info["content"];
        let context:string = info["context"];
        if(context === "查询_处罚记录")
        {
            
            Tool.GetChild(this.node,"公告7/list/view/content/msg").getComponent(cc.Label).string = Tool.Base64Decode(strContent);
            
        }
    }
    public set_client_status()
    {
        let client_status = GameDataManager.getAccount().client_status;
        if(client_status == "")
        {
            UIManager.getInstance().closePanelByName("panelLoginErrorEx",ClosePanelMode.Top);            
        }
        else
        {
            UIManager.getInstance().showPanel("panelLoginErrorEx",ShowPanelMode.Top,client_status);          
            
        }
    }
    public AccountProp(strMsg:string)
    {
        let json = JSON.parse(strMsg);
        if(json == null)
            return;

        let context = json["context"];
        let result_name = json["result_name"];
        let result_value = json["result_value"];

        if(context === "名字查重")
        {
            let bCanChange = false;
            
            if(result_value.length <= 0)
            {
                bCanChange = true;
            }
            else if(result_value.length == 1)
            {
                if(result_value[0] == GameDataManager.getAccount().guuid)
                {
                    bCanChange = true;
                }
            }

            if(bCanChange)
            {
                if(Tool.GetChild(this.node,"修改个人信息").active)
                {
                    let strName = Tool.GetChild(this.node,"修改个人信息/昵称").getComponent(cc.EditBox).string;
                    if(strName == "")
                    {
                        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称不能为空！");
                        return; 
                    }
                    if(strName.length>10)
                    {
                        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称太长！");
                        return; 
                    }

                    //名字只能是中文数字英文
                    if(!strName.match(new RegExp('^[A-Za-z0-9\u4E00-\u9FA5]+$')))
                    {
                        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"昵称只能包含中英文和数字！");
                        return; 
                    }

                    //是否选择头像
                    let imgName = Tool.GetChild(this.node,"修改个人信息/头像/name").getComponent(cc.Label).string;

                    if(imgName == "")
                    {
                       //UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请选择头像");
                                   //是否选择头像
                        this.node.getChildByName("确定随机头像提示面板").active = true;
                        return; 
                    }
        
        
                    GameDataManager.getAccount().reqSetProperty("photo",this.IMG_URL+imgName+".jpg");
                    GameDataManager.getAccount().reqSetProperty("name",strName);
        
                    Tool.GetChild(this.node,"修改个人信息").active = false;

                    ConfigManager.getInstance().SetOneHashKey("免费头像_"+GameDataManager.getAccount().guuid,"ok")
                }
                else if(Tool.GetChild(this.node,"修改个人信息2").active)
                {
                   // this.node.getChildByName("确定修改个人信息").active = true;

                   if(this.strFirstModifyName !="") //是否是第一次设置头像
                   {
                        this.node.getChildByName("确定修改个人信息").active = true;
                        return;
                        // if(GameDataManager.getAccount().gold<5)
                        // {
                        //     UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"金币不足！");
                        //     Tool.GetChild(this.node,"确定修改个人信息").active = false;
                        //     return;
                        // }
                   }

                    let strName = Tool.GetChild(this.node,"修改个人信息2/昵称").getComponent(cc.EditBox).string;
                    //是否选择头像
                    let imgName = Tool.GetChild(this.node,"修改个人信息2/头像/name").getComponent(cc.Label).string;
                    if(imgName != "")
                    {
                        GameDataManager.getAccount().reqSetProperty("photo",this.IMG_URL+imgName+".jpg");
                    }
                    else
                    {

                    }
                    
                    GameDataManager.getAccount().reqSetProperty("name",strName);

                    Tool.GetChild(this.node,"修改个人信息2").active = false;
                    Tool.GetChild(this.node,"确定修改个人信息").active = false;
                    let strParam = "{\"header\":\"玩家_消费_命令\",\"consume_type\":\"换头像\",\"money\":500}";
                    GameDataManager.getAccount().reqHallCommand(strParam, "玩家_消费_命令");
                    ConfigManager.getInstance().SetOneHashKey("免费头像_"+GameDataManager.getAccount().guuid,"ok")
                }
            }
            else
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"名字已被占用！");
            }
        }
    }

    //图片选择返回
    public fileCut:string = "";
    public onGetPic(strMsg:string)
    {
        this.fileCut = strMsg;
       // UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,strMsg);
        cc.loader.load(strMsg,(err,texture)=>{
            if(err)
            {
                cc.error(err.message || err);
                return null;
            }
            let frame = new cc.SpriteFrame(texture);
            if(Tool.GetChild(this.node,"修改个人信息").active)
            {
                Tool.GetChild(this.node,"修改个人信息/头像/mask/img").getComponent(cc.Sprite).spriteFrame = frame;
            }
            if(Tool.GetChild(this.node,"修改个人信息2").active)
            {
                Tool.GetChild(this.node,"修改个人信息2/头像/mask/img").getComponent(cc.Sprite).spriteFrame = frame;
            }

            //上传头像
            this.uploadImage(strMsg);
        });

        
    }
    //图片上传
    public uploadImage(strPath:string)
    {
        let file = jsb.fileUtils.getDataFromFile(strPath);

        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4 ) {
                if(xhr.status === 200){    
                    Debug.Log("上传成功!");
                    console.log(xhr.response);

                    var json = JSON.parse(xhr.response);
                    if(json.msg == "OK")
                    {
                        let img:cc.Sprite = null;
                        if(Tool.GetChild(this.node,"修改个人信息").active)
                        {
                            Tool.GetChild(this.node,"修改个人信息/头像/name").getComponent(cc.Label).string = json.filename.replace(".jpg","");
                            img = Tool.GetChild(this.node,"修改个人信息/头像/mask/img").getComponent(cc.Sprite);
                        }
                        if(Tool.GetChild(this.node,"修改个人信息2").active)
                        {
                            Tool.GetChild(this.node,"修改个人信息2/头像/name").getComponent(cc.Label).string = json.filename.replace(".jpg","");
                            img = Tool.GetChild(this.node,"修改个人信息2/头像/mask/img").getComponent(cc.Sprite);
                        }

                        let strUrl = this.IMG_URL+json.filename;
                        cc.loader.load({url:strUrl},function (err,tex) {
                            var spriteFrame = new cc.SpriteFrame(tex);
                            if(cc.isValid(img))
                                img.spriteFrame = spriteFrame;
                        });
                       // UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"上传成功");
                    }



                    
                    // let json = JSON.parse(xhr.response);
                    // let strName = json["filename"];
                    // let random = new Date().getTime();
                    // let path = "http://47.108.130.105:8888/web/test.jpg?v="+random;
                    // cc.loader.load(path,(err,texture)=>{
                    //     if(err)
                    //     {
                    //         cc.error(err.message || err);
                    //         return null;
                    //     }
                    //     let frame = new cc.SpriteFrame(texture);
                    //     this.node.getChildByName("img2").getComponent(cc.Sprite).spriteFrame = frame;
                    // });
                }
            }
        }.bind(this);

        xhr.onabort = (event1:ProgressEvent<EventTarget>)=>{
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"上传头像异常1");
        };
        xhr.onerror = (event1:ProgressEvent<EventTarget>)=>{
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"上传头像异常2");
        };
        xhr.ontimeout = (event1:ProgressEvent<EventTarget>)=>{
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"上传头像超时");
        };
  
        //xhr.responseType = 'arraybuffer';
        let strFileName = GameDataManager.getAccount().guuid+"_"+new Date().getTime()+".jpg";
        xhr.open("POST", PIC_UPDATE_URL+"/upload?name="+strFileName, true);
        
        xhr.send(file)
    
    }

    //----------------------测试分布代码-------------------
    private MoveItemPos(item:cc.Node)
    {
        Tool.GetChild(this.node,"Main/我的/功能").active = false;

        let arrayPos = []
        //if(Number(strLevel)>=50)
       // {
            arrayPos = [[0,227],[215.88,70.14],[133.42,-183.64],[-133.42,-183.64],[-215.88,70.14]]
        // }
        // else
        // {
        //     arrayPos = [[0,227],[227,0],[0,-227],[-227,0]];
        // }
        let nPos = 0;
        for(let i=0;i<arrayPos.length;i++)
        {
            let one = arrayPos[i]
            if(Math.abs(one[0] - item.x)<=1 && Math.abs(one[1] - item.y)<=1)
            {
                nPos = i
                break;
            }
        }




        let nDir = 0; //方向
        if(nPos<=2)
        {
            nDir = 0
        }
        else
        {
            nDir = -1
        }
        if(arrayPos.length >4)
        {
            if(nPos == 3)
            nPos = 2
        }
        else
        {
            if(nPos == 3)
            nPos = 1
        }

        if(nPos == 4)
            nPos = 1

        let maxLen = arrayPos.length-1;

        //开始全体转
        for(let one of item.parent.children)
        {
            //找到one 的位置
            let nSelfPos = 0;
            for(let i=0;i<arrayPos.length;i++)
            {
                let temp = arrayPos[i]
                if(Math.abs(temp[0] - one.x)<=1 && Math.abs(temp[1] - one.y)<=1)
                {
                    nSelfPos = i
                    break;
                }
            }

            let arrayAction = [];
            let lastPos = [];
            let tempArray = []
            for(let i=1;i<=nPos;i++) //连续转几次
            {
                //下一个位置
                let nextPos = [];
                if(nDir == 0) //逆时针
                {
                    let nNextPos = nSelfPos-i;
                    if(nNextPos<0)
                    {
                        nNextPos = maxLen+nNextPos+1
                    }
                    nextPos = arrayPos[nNextPos];
                    tempArray.push(nNextPos)
                }
                else{ //顺时针
                    let nNextPos = nSelfPos+i;
                    if(nNextPos>maxLen)
                    {
                        if(nNextPos == 5)
                            nNextPos = 0
                        else if(nNextPos == 6)
                            nNextPos = 1
                        else if(nNextPos == 7)
                            nNextPos = 3
                        else if(nNextPos == 4)
                            nNextPos = 0
                        else 
                            nNextPos = 4
                    }
                    nextPos = arrayPos[nNextPos];
                    tempArray.push(nNextPos)
                }   
                arrayAction.push(cc.moveTo(0.3,cc.v2(nextPos[0],nextPos[1])))
                lastPos = nextPos;
                
            }
            arrayAction.push(cc.callFunc(()=>{
                one.x = lastPos[0];
                one.y = lastPos[1];
                //显示菜单  
                this.ShowToolMenu(item.name)
            }))
            if(arrayAction.length>1)
                one.runAction(cc.sequence(arrayAction));
            else
                this.ShowToolMenu(item.name)
            
        }
    }
    private ShowToolMenu(strName:string)
    {
        strName = strName.replace('a','');        
        Tool.GetChild(this.node,"Main/我的/功能").active = true;
        for(let one of Tool.GetChild(this.node,"Main/我的/功能").children)
        {
            if(one.name === strName)
            {
                one.active = true;
            }
            else
            {
                one.active = false
            }
        }
        
    }
    public openGG8()
    {
        this.node.getChildByName("公告8").active = true;

        ConfigManager.getInstance().GetOneHashKey("充值提现公告","公告8");
        
    }
    //查询惩罚公告
    public GetCFNotifyInfo(nPage:number = 1)
    {
        Tool.HTTP_GET("http://"+WEB_TX_IP+"/fmis/DataGamePunishs/getitems?pagetotal=10&pageindex="+nPage,(ret)=>{
            Debug.Log(ret)
            if(ret.status == 200)
            {
                let jRet = JSON.parse(ret.response)
                Debug.Log(jRet)
                this.OnCFNotifyReturn(ret.response)
            }
        },(err)=>{
            UIManager.getInstance().closePanelByName("panelLoading",ClosePanelMode.Top);
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"支付网络异常！")
        })
    }

    public OnCFNotifyReturn(strMsg:string)
    {
        this.scrollCFNotify.UpdateList(strMsg,"data","惩罚公告对象",this.PAGE_PER_COUNT,this.setCFNotifyItem.bind(this));
    }
    public setCFNotifyItem(node:cc.Node,jItem:any)
    {
        node.active = true
        //刷新数据
        let arrayAll = node.children

        let i =0
        for(;i<jItem["UUIDS"].length;i++)
        {
            arrayAll[i].active = true
            let one = jItem["UUIDS"][i]
            Tool.GetChild(arrayAll[i],"name").getComponent(cc.Label).string = one["UUID"]+" "+one["NAME"]
            Tool.GetChild(arrayAll[i],"type").getComponent(cc.Label).string = i==0?jItem["REASON_INFO"]:""
            Tool.GetChild(arrayAll[i],"result").getComponent(cc.Label).string = i==0?jItem["RESULT_INFO"]:""
        }

        Tool.GetChild(node,"时间/txt").getComponent(cc.Label).string = jItem["CREATE_TIME"]
        //多余的隐藏
        for(;i<arrayAll.length;i++)
        {
            if(arrayAll[i].name == "分隔线" || arrayAll[i].name == "时间")
                continue
            arrayAll[i].active = false
        }
    }
}
