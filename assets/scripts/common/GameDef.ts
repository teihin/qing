export const enum ShowPanelMode
{
    CloseOther=0,  //关闭其他
    Cover,         //层叠
    Top            //置顶 
}

export const enum ClosePanelMode
{
    Normal=0, //普通层
    Top       //Top层
}

export const enum ScrollEvent
{
    Normal = 0,
    ToTop,
    ToBottom
}

export const enum RoomType
{
    Custom = "Custom", //自定义
    Easy = "Easy"
}

export const enum PlayerPos
{
    self = 0,
    other
}

//203.107.62.30

export const WEB_TX_IP:string = "154.37.155.17:803";    //支付成功推送    
export const WEB_IP:string = "154.37.155.17";       //
export const WEB_PORT:number = 9000; //WEB端口
export const SERVER_IP:string = "154.37.155.17";  //
export const SERVER_PORT:string = "20013";
export const BASE_SERVER_IP:string = "154.37.155.17"  //BASE服务器地址  
export const LOGIN_BY_IP:boolean = true;
export const IS_USE_WSS:boolean = false;
export const SERVER_URL:string = "";

// Web Mobile/浏览器专用的KB WSS入口。原生客户端继续使用上面的IP、端口和WS配置。
// BaseApp端口来自登录服下发，只允许连接服务器已明确开放的代理端口。
export const WEB_PUBLIC_HOST:string = "154-37-155-17.sslip.io";
export const WEB_PUBLIC_HTTPS_ORIGIN:string = "https://" + WEB_PUBLIC_HOST;
export const WEB_PUBLIC_WSS_ORIGIN:string = "wss://" + WEB_PUBLIC_HOST;
export const WEB_KB_WSS_PROXY_BASE_URL:string = WEB_PUBLIC_WSS_ORIGIN + "/ws/";
export const WEB_KB_WSS_ALLOWED_PORTS:number[] = [20013, 20015, 20016, 20017, 20018, 20019];

// 自研语音和客服：Native继续使用原IP配置，浏览器固定使用sslip HTTPS/WSS域名。
export const AUDIO_SERVER_HTTP_BASE:string = "http://154.37.155.17/audio";
export const AUDIO_SERVER_WS_URL:string = "ws://154.37.155.17/audio/v1/stream";
export const AUDIO_SERVER_PROXY_PATH:string = "/audio";
export const WEB_AUDIO_SERVER_HTTP_BASE:string = WEB_PUBLIC_HTTPS_ORIGIN + AUDIO_SERVER_PROXY_PATH;
export const WEB_AUDIO_SERVER_WS_URL:string = WEB_PUBLIC_WSS_ORIGIN + AUDIO_SERVER_PROXY_PATH + "/v1/stream";
export const WEB_CUSTOMER_SERVICE_URL:string = WEB_PUBLIC_HTTPS_ORIGIN + "/chattool/player?d={info}";


export const SERVER_IP_TEST:string = "192.168.2.96";
export const LOCAL_HOT_UPDATE:string = "192.168.2.250";

export enum PlayerState
{
    init,       //进入房间还没按准备
    ready,      //已经准备
    running,    //游戏中
    offline,     //已经断线
    leave       //已经离开游戏
}

const {ccclass, property} = cc._decorator;

@ccclass
export default class GameDef extends cc.Component {

}

@ccclass
export class CardInfo
{
    public nType:number = 0;
    public nNum:number = 0;
    public nCheck:number = -1;
    public nHideType:number = 0;
    public nHideNum:number = 0;
    public nCount:number = 0; //张数
    constructor(type:number,index:number,check:number = 0,hidetype:number = 0,hidenum:number = 0,count:number = 0)
    {
        this.nType = type;
        this.nNum = index;
        this.nCheck = check;
        this.nHideType = hidetype;
        this.nHideNum = hidenum;
        this.nCount = count;
    }

    public Reset()
    {
        this.nType = 0;
        this.nNum = 0;
        this.nCheck = -1;
        this.nHideType = 0;
        this.nHideNum = 0;
        this.nCount = 0;
    }
}


@ccclass
export class PlayerInfoBase
{
    public strUserID = "init";
    public nSitNum = -1;                    //座位号
    public strUserName = "";
    public strSex = "male";           //性别
    public strLang = "pt";          //语言
    public strPhoto = "";            //头像
    public strIP = "0.0.0.0";        //IP
    public nGoldNum = 0;
    public nTableNum = 0;                   //桌面上的金币数
    public nDiamondNum = 0;
    public emState:PlayerState;
    public emStateSave:PlayerState; //结算缓存
    public strDeadState = "False";   //控制显示在线离线的标志

    public bBanker:boolean;    //做庄

    //游戏状态相关定义
    public strServerState = "";
    public strServerStatePre = "";   //上一个服务器状态

    //申请或者表决
    public game_command = "";

    public is_win = ""; //结算中是否获胜

    public is_proxy = ""; //是否托管

    public is_exit = ""; //是否结束游戏
    //public string over_type = ""; //结束类型
    public game_over_type = ""; //游戏结束状态
    public player_over_type = ""; //玩家结束状态

    //决策内容
    public role = "";
    public is_action = "";  //当前操作对象
    public strCurCountDown:string; //当前倒计时
    public strCountDownAll:string; //当前倒计时总
    public take = "无";    //自动操作字段

    public bClone = false;    //数据是否来自克隆
    public totale_win = "0"; //      大赢家

    public auto_ready = ""; //下局是否自动准备
    public fapai_info = ""; //用于校验的发牌信息   True,Count

    public BaseClone(src:PlayerInfoBase)
    {
        this.strUserID = src.strUserID;
        this.nSitNum = src.nSitNum;
        this.strUserName = src.strUserName;
        this.strSex = src.strSex;
        this.strLang = src.strLang;
        this.strPhoto = src.strPhoto;
        this.strIP = src.strIP;
        this.nGoldNum = src.nGoldNum;
        this.nTableNum = src.nTableNum;
        this.nDiamondNum = src.nDiamondNum;
        this.emState = src.emState;
        this.strDeadState = src.strDeadState;
        this.auto_ready = src.auto_ready;
    }

    public ResetAll(bFull:boolean = true)
    {
        this.strUserID = "init";
        //nSitNum = -1;
        this.strUserName = "";
        this.strSex = "male";
        this.strLang = "pt";
        this.strPhoto = "";
        this.nGoldNum = 0;
        this.nTableNum = 0;
        this.nDiamondNum = 0;
        this.emState = PlayerState.init;
        this.bBanker = false;
        //strServerState = "";
    }
    public ResetGameInfo(){};
}

@ccclass
export class DrhPlayerInfo extends PlayerInfoBase
{
    public handCardEx = new Array<CardInfo>(); //手牌列表
    public huoCard:CardInfo = new CardInfo(0,0,0,0,0,0); //一张活牌存储
    public nHandCount:number;
    public index:number;
    public beicount = "0"; //倍数
    public one_bei_shu = 0; //本轮下注
    public begin_score = ""; //开局积分
    public table_times = ""; //桌面上的分
    public take_all_score = ""; //总资产
    public cur_buy = "0"; //当前买入
    public bj_score = "0"; //当前用户设置的簸箕
    public min_score = ""; //当前最低下注
    public bei_shu_type = "";   //下注类型 0:正常 -1：跟    -3：敲    -6：滚
    public oney_score = "";  //簸箕外资产
    public gen_score = "0"; //跟得分
    public mang_pi_times = ""; //芒皮
    public xiu_mang_times = ""; //休芒
    public xiu_mang_count = "";// 几芒
    public last_add_xiazhu_score = "0"; //本轮最近一次下注分数

    //结算信息消息
    public round_score = "";   //本局积分
    public total_score = ""; //总分
    public is_poker_win = ""; //扑克大小

    public first_deal_name = "";


    public is_qiang_over = ""; //本局是否有敲牌的操作
    public is_shuffled = ""; //是否已经错过牌了
    public is_chepai = ""; //是否扯过牌
    public player_setting = "" //用户设置，目前只保存是否开启搓牌开关

    public remark = ""; //用户扩展信息
    public site_countdown = "0";
    public is_can_return = ""; //是否能够回坐

    public bei_shu_unit = "";  //下的倍数列表
    public count_times = ""; //剩余可延时次数

    public bei_shu_max = ""; //倍数需要加上的底分

    public req_club_id = ""; //这个人在这个房间已经申请过的俱乐部ID

    public turn_pai = ""; //是否已经秀牌

    public handSave = new Array<CardInfo>(); //手牌列表

    public strLastSay = "";


    public strGps = "";

    public is_qiepai = ""; //本局是否切牌
    public qiepai_status = "";
    public all_start_player_name = ""; //本局参与了游戏需要发牌的所欲人


    public no_used_pai = []; //剩余拍

    public is_show_tou_pai = ""; //是否能看第一二张牌

    public BaseClone(src:PlayerInfoBase)
    {
        super.BaseClone(src);
        let srctemp:DrhPlayerInfo = <DrhPlayerInfo>src;
        if (srctemp != null)
        {
            this.site_countdown = srctemp.site_countdown;
            this.is_can_return = srctemp.is_can_return;
            this.begin_score = srctemp.begin_score;
            this.strLastSay = srctemp.strLastSay;
        }
        this.bClone = true;
    }

    public ResetAll(bFull:boolean = true)
    {
        super.ResetAll(bFull);
    }
    public ResetGameInfo()
    {
        super.ResetGameInfo();    
    }
}
