import GameDataManager from "../GameDataManager";
import Debug from "../common/Debug";
import Tool from "../common/Tool";
var KBEngine = require("kbengine");
//配置管理

const {ccclass, property} = cc._decorator;

@ccclass
export default class ConfigManager extends cc.Component {

    /**
     * 消费项 key。三端必须完全一致：
     * 客户端调用点 → 后台「钻石消费价格」页 → 服务端 `玩家_消费_命令` 的 consume_type。
     * 改名/新增都要三端同批，否则后台配的价格客户端取不到、会退回默认值。
     */
    public static readonly CONSUME_AVATAR:string = "换头像";
    public static readonly CONSUME_LOOK_DATA:string = "看数据";
    public static readonly CONSUME_PROP:string = "道具";
    public static readonly CONSUME_FORCE_SHOW:string = "强制秀牌";
    public static readonly CONSUME_LOOK_NEXT:string = "看下一张牌";
    public static readonly CONSUME_CUT_CARD:string = "切牌";
    // 注：`延时` 不进这张价格表——接口文档 v1.2 §3.7 规定加时价格由服务端固定档位决定
    //     （第 2 次 200 钻 / 第 3 次 400 钻 / 第 1 次免费），客户端只做提示和拦截。
    public static readonly CONSUME_REPORT:string = "举报";
    /** 创建俱乐部收一次费，默认 10000 钻；成功受理后才扣，见 panelMain.CreateClub。 */
    public static readonly CONSUME_CREATE_CLUB:string = "创建俱乐部";
    // 注：VIP 三档（购买VIP月卡/半年卡/年卡）已停用，2026-10-26 起没有 VIP 消费，
    //     后台配置页也不再维护这三项；客户端 VIP 面板只保留信息展示。

    /** usr_hash_info 里存钻石价格 JSON 的 key（后台「钻石消费价格」页读写的就是这条）。 */
    public static readonly CONSUME_PRICE_HASH_KEY:string = "消费钻石价格";

    /**
     * 后台未配置时的兜底价格，口径按 1 钻 ≈ 1 元折算原金币价。
     * 只用于「后台配置没下发」这一种情况，日常以服务端下发的为准。
     */
    private static readonly CONSUME_STONE_DEFAULT:{[type:string]:number} = {
        "换头像":10,
        "看数据":1,
        "道具":1,
        "强制秀牌":5,
        "看下一张牌":1,
        "切牌":1,
        "举报":50,
        "创建俱乐部":10000
    };

    /** 后台下发的钻石单价，key 为消费项名。 */
    private consumeStonePrice:{[type:string]:number} = {};

    public android_down_url:string = "";
    public ios_down_url:string = "";
    public enalbe_gps:string = "True"; 
    public user_promission:string = "";
    public downloadurl:string = "http://www.baidu.com";
    public resetPwdUrl:string = "http://www.163.com";
    public kefuUrl:string = "http://154.37.155.17/chattool/player?d={info}";
    public registrationUrl:string = "http://154.37.155.17/xuanmanager/api/game/registrations";
    public changeLoginPasswordUrl:string = "http://154.37.155.17/xuanmanager/api/game/change-login-password";

    static instance: ConfigManager
    static getInstance() {
        if (!ConfigManager.instance) {            
            let node = new cc.Node("ConfigManager");
            cc.game.addPersistRootNode(node);
            this.instance = node.addComponent(ConfigManager);   
            
            KBEngine.Event.register("UserHashInfo", this.instance, "OnUserHashInfo"); 
        }

        return ConfigManager.instance;
    }
    public onDestroy()
    {
        KBEngine.Event.deregisterAll(this);
        ConfigManager.instance = null;
    }
 
    public GetDownLoadUrl()
    {
        if(cc.sys.os === cc.sys.OS_ANDROID)
        {
            return this.android_down_url;
        }
        else if(cc.sys.os === cc.sys.OS_IOS)
        {
            return this.ios_down_url;
        }
    }

    //更新默认配置
    public UpdateDefConfig()
    {
       this.GetOneHashKey("强制GPS");
       this.GetOneHashKey("下载url");
       // this.GetOneHashKey("用户权限");
       this.GetOneHashKey("客服2","客服地址");
       // 各消费项扣多少钻石，后台「钻石消费价格」页维护
       this.GetOneHashKey(ConfigManager.CONSUME_PRICE_HASH_KEY,ConfigManager.CONSUME_PRICE_HASH_KEY);
    }

    /**
     * 取某项消费要扣的钻石数量。
     * 顺序：后台下发值 → 内置默认值 → 0。返回 0 表示免费，调用方不要再拦「余额不足」。
     */
    public GetConsumeStone(strType:string):number
    {
        let nPrice = this.consumeStonePrice[strType];
        if(nPrice === undefined || nPrice === null)
            nPrice = ConfigManager.CONSUME_STONE_DEFAULT[strType];
        if(nPrice === undefined || nPrice === null)
            nPrice = 0;
        return Math.max(0,Math.floor(nPrice));
    }

    /** 测试/切号时清掉已下发的价格，回到默认表。 */
    public ResetConsumeStonePrice()
    {
        this.consumeStonePrice = {};
    }

    /**
     * 生成钻石消费报文，价格自动从配置取。
     * ⚠️ `money` 在钻石消费下是**钻石个数**（金币消费才是"分"），`money_type` 必须是 `stone`。
     */
    public BuildConsumeStoneParam(strType:string):string
    {
        let nStone = this.GetConsumeStone(strType);
        return "{\"header\":\"玩家_消费_命令\",\"consume_type\":\"" + strType
            + "\",\"money\":" + nStone + ",\"money_type\":\"stone\"}";
    }

    /**
     * 解析后台下发的价格 JSON。容忍三种形态：
     * `{"看数据":1,...}`、`{"items":{"看数据":1}}`、`[{"type":"看数据","stone":1}]`。
     * 单条非法只跳过该条，不影响其他项。
     */
    private ParseConsumeStonePrice(strContent:string)
    {
        if(strContent == null || strContent.trim() === "")
            return;

        let data:any = null;
        try
        {
            data = JSON.parse(strContent);
        }
        catch(error)
        {
            Debug.Log("消费钻石价格解析失败：" + strContent);
            return;
        }

        if(data == null || typeof data !== "object")
            return;

        let source:any = Array.isArray(data) ? data : (data["items"] != null ? data["items"] : data);
        let result:{[type:string]:number} = {};

        if(Array.isArray(source))
        {
            for(let one of source)
            {
                if(one == null)
                    continue;
                let key = one["type"] != null ? one["type"] : one["key"];
                let value = one["stone"] != null ? one["stone"] : one["price"];
                if(key != null && value != null)
                    result[String(key)] = value;
            }
        }
        else
        {
            for(let key in source)
            {
                if(typeof source[key] === "object")
                    continue;
                result[key] = source[key];
            }
        }

        for(let key in result)
        {
            let nValue = Number(result[key]);
            if(!isFinite(nValue) || nValue < 0)
            {
                Debug.Log("消费钻石价格非法，已忽略：" + key + "=" + result[key]);
                continue;
            }
            this.consumeStonePrice[key] = Math.floor(nValue);
        }

        // 已打开的界面（如 VIP 面板）据此刷新价格文案
        KBEngine.Event.fire("ConsumeStonePriceUpdated");
    }
    public GetOneHashKey(strKey:string,strEx:string = "")
    {
        let strTemp = strEx==""?"查询哈希_"+strKey:strEx;
        let strParam = "{\"header\":\"查询_哈希_信息\",\"key\":\""+strKey+"\",\"context\":\""+strTemp+"\"}";
        GameDataManager.getAccount().reqAccountCommand(strParam, "P@"+strEx);
    }
    public SetOneHashKey(strkey:string,strValue:string)
    {
        let strParam = "{\"header\":\"设置_哈希_信息\",\"key\":\""+strkey+"\",\"content\":\"" + strValue + "\",\"context\":\"设置哈希_"+strkey+"\"}";
        GameDataManager.getAccount().reqAccountCommand(strParam, "");
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

        if(context == "查询哈希_强制GPS")
        {
            this.enalbe_gps = strContent;
        }
        else if(context == "查询哈希_用户权限")
        {
            this.user_promission = strContent;
        }
        else if(context == "查询哈希_下载url")
        {
            this.downloadurl = strContent;
        }
        else if(context === "客服地址")
        {
            this.kefuUrl = strContent
        }
        else if(context === ConfigManager.CONSUME_PRICE_HASH_KEY)
        {
            // 服务端把 JSON 先 URL 编码再 base64，这里解回来再解析。
            let strJson = strContent;
            try
            {
                strJson = Tool.Base64Decode(strContent);
            }
            catch(error)
            {
                Debug.Log("消费钻石价格解码失败，按明文解析");
            }
            this.ParseConsumeStonePrice(strJson);
        }
    }
}
