import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import GameDataManager from "../GameDataManager";
import Tool from "../common/Tool";
import ScrollViewEx from "../common/ScrollViewEx";
import { ClosePanelMode, ShowPanelMode } from "../common/GameDef";

var KBEngine = require("kbengine");
const {ccclass} = cc._decorator;

/**
 * 钻石消费流向（「我的 → 钻石流向」）。
 *
 * 布局沿用「资金明细（金币流向）」页的下半部分：标题栏 + 表头 + 列表 + 分页，
 * 上半部分的盾牌和资金概况卡都不做，单独成 prefab，避免 panelMain 继续变大。
 *
 * 协议见《俱乐部金币与钻石-客户端接口文档》§3.9：
 *   Hall 命令 `查询_玩家_钻石流水`，参数与金币流水一致（user_id / count / page / context），
 *   同步响应只是空壳，列表经 `ListPlayerStoneWater` 推送。
 *   行字段：date / option_type / remark1..5 / add_money（钻，负数=消耗） / new_money。
 */
@ccclass
export default class panelStoneWater extends UIPanelViewBase
{
    /** 与金币流水一致，一页 10 条。 */
    private static readonly PAGE_COUNT:number = 10;

    private scrollWater:ScrollViewEx = null;

    onLoad ()
    {
        super.onLoad();

        KBEngine.Event.register("ListPlayerStoneWater", this, "OnStoneWaterList");
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
    }

    start ()
    {
        super.start();

        let listNode = Tool.GetChild(this.node,"列表");
        this.scrollWater = listNode == null ? null : listNode.getComponent(ScrollViewEx);
        // 分页按钮由分页节点上的 PageEx 统一接管，这里只交出「翻页去取数」的回调。
        if(this.scrollWater != null)
            this.scrollWater.callBackFresh = this.GetStoneWater.bind(this);

        this.GetStoneWater(0);
    }

    //--------------------------------------------------------------------------
    // 请求 / 回包
    //--------------------------------------------------------------------------
    public GetStoneWater(nPage:number = 0)
    {
        let account:any = GameDataManager.getAccount();
        if(account == null)
            return;

        let strParam = "{\"header\":\"查询_玩家_钻石流水\",\"user_id\":\"" + account.guuid +
            "\",\"page\":\"" + nPage.toString() + "\",\"count\":\"" + panelStoneWater.PAGE_COUNT + "\"}";
        account.reqHallCommand(strParam, "查询_玩家_钻石流水");
    }

    public OnStoneWaterList(strMsg:string)
    {
        if(this.scrollWater == null)
            return;

        let payload = panelStoneWater.NormalizeList(strMsg);
        if(payload == null)
            return;

        this.scrollWater.UpdateList(payload,"ListPlayerStoneWater","资金明细对象",
            panelStoneWater.PAGE_COUNT,this.SetRowInfo.bind(this));
    }

    /**
     * 服务端既可能直接推 `{"ListPlayerStoneWater":[...]}`，也可能包一层 `result`，
     * 两种都收下来再交给 ScrollViewEx，避免因为一层壳导致列表空白。
     */
    private static NormalizeList(strMsg:string):string
    {
        if(strMsg == null || strMsg === "")
            return null;

        let data:any = null;
        try
        {
            data = JSON.parse(strMsg);
        }
        catch(e)
        {
            return null;
        }
        if(data == null)
            return null;

        if(data["ListPlayerStoneWater"] != null)
            return JSON.stringify(data);

        let result = data["result"];
        if(result != null && result["ListPlayerStoneWater"] != null)
            return JSON.stringify(result);

        return null;
    }

    //--------------------------------------------------------------------------
    // 列表行
    //--------------------------------------------------------------------------
    private SetRowInfo(node:cc.Node, jItem:any)
    {
        node.active = true;

        // remark4 才是消费类型（换头像 / 看数据 / 强制秀牌…），option_type 只是「消费 / 延长时间」。
        const strRemark4 = jItem["remark4"] == null ? "" : jItem["remark4"].toString().trim();
        const strOption = jItem["option_type"] == null ? "" : jItem["option_type"].toString();
        node.getChildByName("type").getComponent(cc.Label).string = strRemark4 !== "" ? strRemark4 : strOption;

        let change = Number(jItem["add_money"]);
        if(isNaN(change) || !isFinite(change))
            change = 0;
        let balance = Number(jItem["new_money"]);
        if(isNaN(balance) || !isFinite(balance))
            balance = 0;

        let countNode = node.getChildByName("count");
        let countText = panelStoneWater.FormatNumber(change);
        countNode.getComponent(cc.Label).string = change > 0 ? "+" + countText : countText;
        node.getChildByName("now").getComponent(cc.Label).string = panelStoneWater.FormatNumber(balance);

        const date = jItem["date"] == null ? "" : jItem["date"].toString();
        const match = date.match(/^\d{4}[-\/]([0-9]{2})[-\/]([0-9]{2})[ T]([0-9]{2}):([0-9]{2})/);
        node.getChildByName("time").getComponent(cc.Label).string = match ?
            match[1]+"/"+match[2]+" "+match[3]+":"+match[4] : date;

        // 钻石流水只有消费：带房间号（remark1）的是牌桌消费，其余算大厅支出。
        const strRoom = jItem["remark1"] == null ? "" : jItem["remark1"].toString().trim();
        const iconType = strRoom !== "" ? "game" : "out";
        for(const key of ["in","out","gift","game"])
        {
            const icon = node.getChildByName("V8类型图标_"+key);
            if(icon != null)
                icon.active = key === iconType;
        }

        if(change > 0)
            countNode.color = new cc.Color(167,231,29,255);
        else if(change < 0)
            countNode.color = new cc.Color(255,65,52,255);
        else
            countNode.color = new cc.Color(239,225,194,255);
    }

    /** 钻石是个数，不要沿用金币的两位小数。 */
    private static FormatNumber(value:number):string
    {
        if(isNaN(value) || !isFinite(value))
            return "--";
        let rounded = Math.round(value);
        if(rounded === 0)
            return "0";
        return rounded.toString();
    }

    //--------------------------------------------------------------------------
    // 其它
    //--------------------------------------------------------------------------
    public onHallCommand(nCode:number, param:string)
    {
        // 同步响应 0x200 只是空壳；失败（命令不存在 / 参数错）才需要提示。
        if(param == null || param.indexOf("查询_玩家_钻石流水") < 0 || nCode === 0x200)
            return;

        let msg:any = null;
        try
        {
            msg = JSON.parse(param);
        }
        catch(e)
        {
            return;
        }
        let data = msg == null ? null : msg["result"];
        if(data == null)
            return;
        let strError = data["error"] == null ? "" : data["error"].toString();
        if(strError !== "")
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,strError);
    }

    public onButtonClick(button:cc.Button)
    {
        if(button.node.name === "关闭" || button.node.name === "关闭上上层")
        {
            UIManager.getInstance().closePanelByName(this.node.name,ClosePanelMode.Normal);
        }
    }
}
