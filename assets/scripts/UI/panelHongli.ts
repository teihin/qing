import UIPanelViewBase from "../common/UIPanelViewBase";
import GameDataManager from "../GameDataManager";
import Tool from "../common/Tool";
import Debug from "../common/Debug";
import UIManager from "../common/UIManager";
import ScrollViewEx from "../common/ScrollViewEx";
import { ShowPanelMode, RoomType } from "../common/GameDef";
import ImageManager from "../logic/ImageManager";
import GpsManager from "../logic/GpsManager";
import ConfigManager from "../logic/ConfigManager";
import panelMain from "./panelMain";

var KBEngine = require("kbengine");
const {ccclass, property} = cc._decorator;

@ccclass
export default class panelHongli extends UIPanelViewBase {

    private jackpotSequence: number = 0;
    private jackpotRequests: {[key: string]: string} = {};
    private jackpotPage: number = 0;
    private jackpotPages: number = 1;

    private jackpotLabel(path: string, value: string) {
        Tool.GetChild(this.node, path).getComponent(cc.Label).string = value;
    }

    private jackpotRatio(value: number, total: number): string {
        return (total > 0 ? value * 100 / total : 0).toFixed(2) + "%";
    }

    private requestJackpot(kind: string, page: number = 0) {
        if (GameDataManager.getAccount().client_prop !== "True") return;
        const context = "jackpot-" + kind + "-" + Date.now() + "-" + (++this.jackpotSequence);
        this.jackpotRequests[kind] = context;
        const params: any = {header: kind === "info" ? "异步_查询_代理_奖池业绩_信息" : "异步_查询_代理_奖池业绩_列表", date: -1};
        if (kind === "list") {
            params.page = page; params.count = 10;
            this.jackpotLabel("奖池业绩/状态", "正在加载…");
            this.jackpotLabel("奖池业绩/汇总/数据", "我：—    下发：—    剩：—");
            Tool.GetChild(this.node, "奖池业绩/列表/view/content").children.forEach(row => row.active = false);
            this.setJackpotPaging(false);
        }
        GameDataManager.getAccount().reqHallCommand(JSON.stringify(params), "p@" + context);
        this.scheduleOnce(() => {
            if (this.jackpotRequests[kind] !== context) return;
            delete this.jackpotRequests[kind];
            if (kind === "list") this.jackpotLabel("奖池业绩/状态", "加载超时，请点击刷新重试");
            else this.jackpotLabel("操作/业绩比例/比例", "暂不可用");
        }, 15);
    }

    private setJackpotPaging(ready: boolean) {
        Tool.GetChild(this.node, "奖池业绩/分页/业绩首页").getComponent(cc.Button).interactable = ready && this.jackpotPage > 0;
        Tool.GetChild(this.node, "奖池业绩/分页/业绩尾页").getComponent(cc.Button).interactable = ready && this.jackpotPage + 1 < this.jackpotPages;
        Tool.GetChild(this.node, "奖池业绩/分页/业绩上一页").getComponent(cc.Button).interactable = ready && this.jackpotPage > 0;
        Tool.GetChild(this.node, "奖池业绩/分页/业绩下一页").getComponent(cc.Button).interactable = ready && this.jackpotPage + 1 < this.jackpotPages;
    }

    private handleJackpotResponse(code: number, raw: string): boolean {
        let msg: any;
        try { msg = JSON.parse(raw); } catch (_) { return false; }
        const context = msg && msg.context;
        if (typeof context !== "string" || context.indexOf("jackpot-") !== 0) return false;
        const kind = context.indexOf("jackpot-info-") === 0 ? "info" : "list";
        if (GameDataManager.getAccount().client_prop !== "True" || this.jackpotRequests[kind] !== context) return true;
        delete this.jackpotRequests[kind];
        const data = msg.result;
        const info = data && data[kind === "info" ? "ListJackpotPerformanceInfo" : "ListJackpotPerformanceList"];
        const keys = ["all_performance", "my_performance", "granted_performance", "proxy_performance"];
        const valid = info && keys.every(key => typeof info[key] === "number" && isFinite(info[key]));
        const validList = kind !== "list" || (Array.isArray(info && info.list) && info.list.length <= 10 && info.list.every(row => Array.isArray(row) && row.length >= 3 && typeof row[2] === "number" && isFinite(row[2])) && /^\d+$/.test(String(data && data.number)) && /^\d+$/.test(String(data && data.count)));
        if (code !== 0x200 || !valid || !validList) {
            if (kind === "list") this.jackpotLabel("奖池业绩/状态", "业绩数据暂不可用，请点击刷新重试");
            else this.jackpotLabel("操作/业绩比例/比例", "暂不可用");
            return true;
        }
        this.jackpotLabel("操作/业绩比例/比例", this.jackpotRatio(info.proxy_performance, info.all_performance));
        if (kind === "info") return true;
        this.jackpotPage = Number(data.number);
        this.jackpotPages = Math.max(1, Math.ceil(Number(data.count) / 10));
        this.jackpotLabel("奖池业绩/统计日", "统计日：" + String(info.date || "昨日"));
        this.jackpotLabel("奖池业绩/分页/页码", (this.jackpotPage + 1) + " / " + this.jackpotPages);
        this.jackpotLabel("奖池业绩/汇总/数据", "我：" + this.jackpotRatio(info.my_performance, info.all_performance) + "    下发：" + this.jackpotRatio(info.granted_performance, info.all_performance) + "    剩：" + this.jackpotRatio(info.proxy_performance, info.all_performance));
        this.jackpotLabel("奖池业绩/状态", info.list.length ? "" : "暂无已开通业绩的下级代理");
        const rows = Tool.GetChild(this.node, "奖池业绩/列表/view/content").children;
        rows.forEach((row, index) => {
            row.active = index < info.list.length;
            if (!row.active) return;
            const item = info.list[index];
            row.getChildByName("昵称").getComponent(cc.Label).string = String(item[1] || "未设置昵称");
            row.getChildByName("ID").getComponent(cc.Label).string = "ID：" + item[0];
            row.getChildByName("比例").getComponent(cc.Label).string = this.jackpotRatio(item[2], info.all_performance);
            ImageManager.getInstance().BindPlayerListAvatar(String(item[0]), Tool.GetChild(row, "头像/mask/img").getComponent(cc.Sprite));
        });
        Tool.GetChild(this.node, "奖池业绩/列表").getComponent(cc.ScrollView).scrollToTop();
        this.setJackpotPaging(true);
        return true;
    }

    onEnable() {
        // Also refresh when a cached panel is reopened after a permission change.
        this.set_client_prop();
    }

    onDisable() {
        this.jackpotRequests = {};
    }

    private PAGE_PER_COUNT:number = 15;

    private scrollMyPlayers:ScrollViewEx = null; //我的玩家
    private scrollYeji:ScrollViewEx = null; //业绩列表
    private scrollHongliList:ScrollViewEx = null; //红利提取记录
    private scrollMengzhuList:ScrollViewEx = null;

    private scrollFenhongList:ScrollViewEx = null; //分红列表
    private scrollHehuorenList:ScrollViewEx = null; //合伙人列表

    private scrollFenhongHis:ScrollViewEx = null; //分红领取记录

    private scrollHongli2List:ScrollViewEx = null; //奖池收益提取记录
    private scrollYeji2:ScrollViewEx = null; //奖池业绩列表

    private scrollPlayerGX:ScrollViewEx = null; //玩家奖池贡献列表

    private scrollZhongZhanji:ScrollViewEx = null; //玩家总战绩授权列表

    private strPTGuuid:string = ''; //平台GUUID

    // The V8 summary repeats existing server-backed values in other views.
    // Only text is synchronized here; all artwork and layout live in the Prefab.
    private refreshAgentSummary()
    {
        const copyValue = (from:string, to:string) => {
            const source = Tool.GetChild(this.node, from);
            const target = Tool.GetChild(this.node, to);
            if (cc.isValid(source) && cc.isValid(target))
                target.getComponent(cc.Label).string = source.getComponent(cc.Label).string;
        };
        copyValue("数据/今日新增", "我的玩家/V8今日新增");
        copyValue("红利统计/今日红利", "统计/V8今日红利");
        copyValue("统计/累计总提取/num", "提取记录/V8累计提取");
        copyValue("红利余额/num", "提取记录/V8可提取红利");
        copyValue("奖池收益/bk/奖池收益余额", "奖池提取记录/V8奖池余额");
        copyValue("奖池收益/bk/累计提取", "奖池提取记录/V8累计提取");
        copyValue("我的盟主/统计/今日贡献/num", "盟主收益/bk/今日收益");
        copyValue("我的盟主/统计/累计贡献/num", "盟主收益/bk/累计收益");
        const account = GameDataManager.getAccount();
        for (const entry of [
            ["提取红利面板", Math.trunc(Number(account.hongli) / 100)],
            ["提取奖池收益面板", Math.trunc(Number(account.hongli2) / 100)],
            ["提取分红面板", Number(account.fenhong)]
        ]) {
            const target = Tool.GetChild(this.node, entry[0]+"/bk/V8可提取金额");
            if (cc.isValid(target))
                target.getComponent(cc.Label).string = "可提取金额："+(isFinite(Number(entry[1])) ? entry[1] : "—");
        }
    }

    onLoad () {
        super.onLoad();

        KBEngine.Event.register("set_role", this, "set_role");
        KBEngine.Event.register("set_hongli", this, "set_hongli");
        KBEngine.Event.register("set_all_hongli", this, "set_all_hongli");
        KBEngine.Event.register("set_use_hongli", this, "set_use_hongli");

        KBEngine.Event.register("set_fenhong", this, "set_fenhong");
        KBEngine.Event.register("set_use_fenhong", this, "set_fenhong");
        KBEngine.Event.register("set_use_all_fenhong", this, "set_fenhong");

        KBEngine.Event.register("set_big_percent", this, "set_big_percent");
        KBEngine.Event.register("set_client_prop", this, "set_client_prop"); //业绩权限

        KBEngine.Event.register("onHallCommand", this, "onHallCommand");

        KBEngine.Event.register("GetAllLowerCount", this, "OnGetAllLowerCount");
        KBEngine.Event.register("GetTodayLowerCount", this, "OnGetTodayLowerCount");
        KBEngine.Event.register("ListLowerLevelAccountInfo", this, "OnListLowerLevelAccountInfo"); //我的玩家列表

        KBEngine.Event.register("ChuanXiaoPlayerTaxRecord", this, "OnChuanXiaoPlayerTaxRecord"); //业绩列表
        KBEngine.Event.register("ChuanXiaoPlayerTodayTaxRecord", this, "OnChuanXiaoPlayerTodayTaxRecord"); //今日
        KBEngine.Event.register("ChuanXiaoPlayerTotalTaxRecord", this, "OnChuanXiaoPlayerTotalTaxRecord"); //累计

        KBEngine.Event.register("HongliList", this, "OnHongliList");
        KBEngine.Event.register("onAccountCommand", this, "onAccountCommand");
        KBEngine.Event.register("ListPlayerProxyInfo", this, "OnListPlayerProxyInfo");

        KBEngine.Event.register("UserHashInfo",this, "OnUserHashInfo"); 
        KBEngine.Event.register("GetSupperAgentList", this, "OnGetSupperAgentList");

        KBEngine.Event.register("set_hongli2", this, "set_hongli2");
        KBEngine.Event.register("set_all_hongli2", this, "set_all_hongli2");
        KBEngine.Event.register("set_use_hongli2", this, "set_use_hongli2");

        KBEngine.Event.register("ListPlayUpperHongliOutcomeInfo", this, "OnListPlayUpperHongliOutcomeInfo");

        KBEngine.Event.register("AccountProp", this, "AccountProp"); //查询玩家属性

        this.scrollMyPlayers = Tool.GetChild(this.node,"我的玩家/列表").getComponent(ScrollViewEx);
        this.scrollMyPlayers.callBackFresh = this.GetMyPlayer.bind(this);

        this.scrollYeji = Tool.GetChild(this.node,"我的业绩/列表").getComponent(ScrollViewEx);
        this.scrollYeji.callBackFresh = this.GetYeji.bind(this);

        this.scrollHongliList = Tool.GetChild(this.node,"提取记录/列表").getComponent(ScrollViewEx);
        this.scrollHongliList.callBackFresh = this.GetHongliList.bind(this);

        this.scrollMengzhuList = Tool.GetChild(this.node,"我的盟主/列表").getComponent(ScrollViewEx);
        this.scrollMengzhuList.callBackFresh = this.GetProxyList.bind(this);

        this.scrollHongli2List = Tool.GetChild(this.node,"奖池提取记录/列表").getComponent(ScrollViewEx);
        this.scrollHongli2List.callBackFresh = this.GetHongli2List.bind(this);

        // this.scrollYeji2 = Tool.GetChild(this.node,"奖池贡献详情/列表").getComponent(ScrollViewEx);
        // this.scrollYeji2.callBackFresh = this.GetYeji2.bind(this);

        // this.scrollPlayerGX = Tool.GetChild(this.node,"玩家奖池贡献详情/列表").getComponent(ScrollViewEx);
        // this.scrollPlayerGX.callBackFresh = this.GetPlayerJCSYList.bind(this);

        this.scrollZhongZhanji = Tool.GetChild(this.node,"总业绩/列表").getComponent(ScrollViewEx);
        this.scrollZhongZhanji.callBackFresh = this.GetYejiUserList.bind(this);

        // this.scrollFenhongList = Tool.GetChild(this.node,"分红领取记录/列表").getComponent(ScrollViewEx);
        // this.scrollFenhongList.callBackFresh = this.GetFenhongList.bind(this);

        // this.scrollHehuorenList = Tool.GetChild(this.node,"合伙人/列表").getComponent(ScrollViewEx);
        // this.scrollHehuorenList.callBackFresh = this.GetFenhongList.bind(this);

        // this.scrollFenhongHis = Tool.GetChild(this.node,"分红领取记录/分红领取列表").getComponent(ScrollViewEx);
        // this.scrollFenhongHis.callBackFresh = this.GetFenHongHis.bind(this);


        let strParam = "{\"header\":\"获取_大厅_配置数据\",\"param_name\":\"cover_proxy_guuid_list\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据");


        ConfigManager.getInstance().GetOneHashKey("推广二维码","推广二维码");
    }

    start () {

        this.set_role();
        this.set_hongli();
        this.set_all_hongli();
        this.set_use_hongli();
        this.set_big_percent();

        this.set_hongli2();
        this.set_all_hongli2();
        this.set_use_hongli2();
        this.set_client_prop();
        
        //底部基本信息
        //Tool.GetChild(this.node,"数据/上级ID").getComponent(cc.Label).string = GameDataManager.getAccount().agentID;
        Tool.GetChild(this.node,"数据/我的ID").getComponent(cc.Label).string = GameDataManager.getAccount().guuid;

        let strParam = "{\"header\":\"查询_所有_下级总数\",\"user_id\":\"" + GameDataManager.getAccount().guuid + "\"}";
        GameDataManager.getAccount().reqAccountCommand(strParam, "P@查询_所有_下级总数");

        strParam = "{\"header\":\"查询_今日_下级总数\",\"user_id\":\"" + GameDataManager.getAccount().guuid + "\"}";
        GameDataManager.getAccount().reqAccountCommand(strParam, "P@获取_今日新增玩家_数量");

        strParam = "{\"header\":\"异步_查询_红利_信息\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@异步_查询_红利_信息");

        
        //查询上级ID
        strParam = "{\"header\":\"查询_用户_属性\",\"prop_name\":\"sm_guuid\",\"prop_value\":\""+GameDataManager.getAccount().guuid+"\",\"result_name\":\"sm_agentID\",\"context\":\"查询上级ID\"}";
        GameDataManager.getAccount().reqHallCommand(strParam,"查询上级ID");
    }

    // update (dt) {}

    // Permission changes compact the existing Prefab buttons in reading order.
    // Up to seven actions occupy three rows; native Layout owns positions and spacing.
    private refreshAgentActions()
    {
        const actions = Tool.GetChild(this.node, "操作");
        const names = ["我的玩家", "我的业绩", "我的盟主", "提取记录", "推广", "总业绩", "业绩比例"];
        const count = names.filter(name => actions.getChildByName(name).active).length;
        const columns = count <= 4 ? 2 : 3;
        actions.width = columns * 204 + (columns - 1) * 14;
        const layout = actions.getComponent(cc.Layout);
        if (layout) layout.updateLayout();
    }

    public set_role(old = null)
    {
        let role = GameDataManager.getAccount().role;
        let level = GameDataManager.getAccount().level;
        if(GameDataManager.getAccount().role.indexOf("盟主")>=0 || GameDataManager.getAccount().role.indexOf("老板")>=0)
        {
            Tool.GetChild(this.node,"操作/我的盟主").active = true;
        }
        else
        {
            Tool.GetChild(this.node,"操作/我的盟主").active = false;
        }
        // if(GameDataManager.getAccount().role.indexOf("合伙人")>=0)
        // {
        //     Tool.GetChild(this.node,"操作/大区收益").active = true;
        // }
        // else
        // {
        //     Tool.GetChild(this.node,"操作/大区收益").active = false;
        // }

        if(level.toString() === "99")
        {
            Tool.GetChild(this.node,"总业绩/标题").active = true
            Tool.GetChild(this.node,"总业绩/分页").active = true
            Tool.GetChild(this.node,"总业绩/列表").active = true
        }
        else
        {
            Tool.GetChild(this.node,"总业绩/标题").active = false
            Tool.GetChild(this.node,"总业绩/分页").active = false
            Tool.GetChild(this.node,"总业绩/列表").active = false
        }

        this.refreshAgentActions();
    }
    public set_hongli(old = null)
    {
        Tool.GetChild(this.node,"红利余额/num").getComponent(cc.Label).string = parseInt((Number(GameDataManager.getAccount().hongli)/100).toString()).toString();
        this.refreshAgentSummary();
    }
    public set_all_hongli(old = null)
    {
        Tool.GetChild(this.node,"统计/累计总红利/num").getComponent(cc.Label).string = parseInt((Number(GameDataManager.getAccount().all_hongli)/100).toString()).toString();
    }
    public set_use_hongli(old = null)
    {
        Tool.GetChild(this.node,"统计/累计总提取/num").getComponent(cc.Label).string = parseInt((Number(GameDataManager.getAccount().use_hongli)/100).toString()).toString();
        this.refreshAgentSummary();
    }

    public set_big_percent(old = null)
    {
        Tool.GetChild(this.node,"操作/我的盟主/我的比例").getComponent(cc.Label).string = GameDataManager.getAccount().big_percent + "%";
    }

    public set_hongli2(old = null)
    {
        Tool.GetChild(this.node,"奖池收益/bk/奖池收益余额").getComponent(cc.Label).string = parseInt((Number(GameDataManager.getAccount().hongli2)/100).toString()).toString();
        this.refreshAgentSummary();
    }
    public set_all_hongli2(old = null)
    {
       // Tool.GetChild(this.node,"奖池收益/统计/累计领取奖池收益/num").getComponent(cc.Label).string = parseInt((Number(GameDataManager.getAccount().all_hongli2)/100).toString()).toString();
    }
    public set_use_hongli2(old = null)
    {
        Tool.GetChild(this.node,"奖池收益/bk/累计提取").getComponent(cc.Label).string = parseInt((Number(GameDataManager.getAccount().use_hongli2)/100).toString()).toString();
        this.refreshAgentSummary();
    }
    public set_client_prop(old = null)
    {
        const granted = GameDataManager.getAccount().client_prop === "True";
        Tool.GetChild(this.node, "操作/业绩比例").active = granted;
        this.jackpotRequests = {};
        this.jackpotLabel("操作/业绩比例/比例", "—");
        if (granted) this.requestJackpot("info");
        else Tool.GetChild(this.node, "奖池业绩").active = false;
        let strProp = GameDataManager.getAccount().client_prop
        let strLevel = GameDataManager.getAccount().level
        if(strProp == "True" || strLevel == "99")
        {
            Tool.GetChild(this.node,"操作/总业绩").active = true;
        }
        else
        {
            Tool.GetChild(this.node,"操作/总业绩").active = false;
        }
        this.refreshAgentActions();
    }

    public onButtonClick(button:cc.Button)
    {
        this.refreshAgentSummary();
        if (["业绩比例", "业绩刷新", "业绩首页", "业绩尾页", "业绩上一页", "业绩下一页"].indexOf(button.node.name) >= 0) {
            if (GameDataManager.getAccount().client_prop !== "True") return;
            const name = button.node.name;
            if (name === "业绩比例") {
                Tool.GetChild(this.node, "奖池业绩").active = true;
                this.jackpotPage = 0;
            }
            const page = name === "业绩首页" ? 0 : name === "业绩尾页" ? this.jackpotPages - 1 : name === "业绩上一页" ? this.jackpotPage - 1 : name === "业绩下一页" ? this.jackpotPage + 1 : this.jackpotPage;
            if (page < 0 || page >= this.jackpotPages) return;
            this.requestJackpot("list", page);
            return;
        }
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
        else if(button.node.name === "我的玩家")
        {
            this.node.getChildByName("我的玩家").active = true;
            this.GetMyPlayer();
        }
        else if(button.node.name === "授权代理")
        {
            let strID = button.node.parent.getChildByName("id").getComponent(cc.Label).string;
            let strName = button.node.parent.getChildByName("name").getComponent(cc.Label).string;

            this.node.getChildByName("添加代理面板").active = true;
            Tool.GetChild(this.node,"添加代理面板/bk/msg").getComponent(cc.Label).string = "是否确认将以下玩家添加为代理?\r\n\r\n" + strName + "  [" + strID + "]";
            Tool.GetChild(this.node,"添加代理面板/bk/id").getComponent(cc.Label).string = strID;
        }
        else if(button.node.name === "确认添加代理")
        {
            this.node.getChildByName("添加代理面板").active = false;
            let strID = button.node.parent.getChildByName("id").getComponent(cc.Label).string;
            if (strID.length != 6)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"玩家ID异常！");                
                return;
            }

            let strParam = "{\"header\":\"设置_玩家_代理\",\"user_id\":\"" + strID + "\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_玩家_代理");
        }
        else if(button.node.name === "提取红利")
        {
            let strHongli = GameDataManager.getAccount().hongli;
            if(strHongli == "0")
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "当前没有红利！");
                return;
            }

            this.node.getChildByName("提取红利面板").active = true;
        }
        else if(button.node.name === "确认提取红利")
        {
            this.node.getChildByName("提取红利面板").active = false;
            let strParam = "{\"header\":\"提取_玩家_红利\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@提取_玩家_红利");
        }
        else if(button.node.name === "我的业绩")
        {
            this.node.getChildByName("我的业绩").active = true;
            let arrayAll = Tool.GetChild(this.node,"我的业绩/条件").getComponent(cc.ToggleContainer).toggleItems;
            let strName = "";
            for(let item of arrayAll)
            {
                if(item.isChecked)
                {
                    strName = item.node.name;
                    break;
                }
            }
            let nLevel = 1;
            if(strName === "我的玩家")
            {
                nLevel = 1;
            }
            else if(strName === "二级代理")
            {
                nLevel = 2;
            }
            else if(strName === "三级代理")
            {
                nLevel = 3;
            }
            this.GetYeji();
            this.GetYejiTodayTotlle(nLevel);
            this.GetYejiAlllTotlle(nLevel);
        }
        else if(button.node.name === "盟主收益")
        {
            this.node.getChildByName("盟主收益").active = true;
            this.GetYejiTodayTotlle(99,"区域");
            this.GetYejiAlllTotlle(99, "区域");
        }
        else if(button.node.name === "大区收益")
        {
            this.node.getChildByName("大区收益").active = true;
            this.GetYejiTodayTotlle(100, "合伙人");
            this.GetYejiAlllTotlle(100, "合伙人");
        }
        else if(button.node.name === "提取记录")
        {
            this.node.getChildByName("提取记录").active = true;
            this.GetHongliList();
        }
        else if(button.node.name === "我的盟主")
        {
            this.node.getChildByName("我的盟主").active = true;
            this.GetYejiTodayTotlle(99,"区域");
            this.GetYejiAlllTotlle(99, "区域");
            this.GetProxyList();
        }
        else if(button.node.name === "授权盟主")
        {
            let strID = button.node.parent.getChildByName("id").getComponent(cc.Label).string;
            let strName = button.node.parent.getChildByName("name").getComponent(cc.Label).string;

            this.node.getChildByName("添加盟主面板").active = true;
            Tool.GetChild(this.node,"添加盟主面板/bk/msg").getComponent(cc.Label).string = "是否确认将以下玩家添加为盟主?\r\n\r\n" + strName + "   [" + strID + "]";
            Tool.GetChild(this.node,"添加盟主面板/bk/id").getComponent(cc.Label).string = strID;
            Tool.GetChild(this.node,"添加盟主面板/bk/比例").getComponent(cc.EditBox).string = "";
        }
        else if(button.node.name === "确认添加盟主")
        {
            this.node.getChildByName("添加盟主面板").active = false;
            let strID = button.node.parent.getChildByName("id").getComponent(cc.Label).string;
            if (strID.length != 6)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"玩家ID异常！");                
                return;
            }

            let nMyPer = GameDataManager.getAccount().role.indexOf("老板")>=0?20:GameDataManager.getAccount().big_percent;

            let per = button.node.parent.getChildByName("比例").getComponent(cc.EditBox).string.replace("%","");
            if(per == ""|| Number(per)<0 || Number(per)>nMyPer)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入0到"+nMyPer+"之间的比例");
                return;
            }

            let strParam = "{\"header\":\"设置_玩家_属性\",\"target_guuid\":\"" + strID + "\",\"big_agentid_percent\":\"" + strID+","+per + "\"}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "P@设置_玩家_属性_盟主");
        }
        else if(button.node.name === "设置盟主")
        {
            this.node.getChildByName("修改盟主面板").active = true;
            let strID = button.node.parent.getChildByName("id").getComponent(cc.Label).string;
            let strName = button.node.parent.getChildByName("name").getComponent(cc.Label).string;
            let strPer = button.node.parent.getChildByName("比例").getComponent(cc.Label).string.replace("%","");
            Tool.GetChild(this.node,"修改盟主面板/bk/id").getComponent(cc.Label).string = strID;
            Tool.GetChild(this.node,"修改盟主面板/bk/name").getComponent(cc.Label).string = strName;
            Tool.GetChild(this.node,"修改盟主面板/bk/比例").getComponent(cc.EditBox).string = strPer;
            Tool.GetChild(this.node,"修改盟主面板/bk/old").getComponent(cc.Label).string = strPer;
        }
        else if(button.node.name === "确认修改盟主")
        {
            this.node.getChildByName("修改盟主面板").active = false;
            let strID = button.node.parent.getChildByName("id").getComponent(cc.Label).string;
            let strPer = button.node.parent.getChildByName("比例").getComponent(cc.EditBox).string;
            let strOld = button.node.parent.getChildByName("old").getComponent(cc.Label).string;

            let nMyPer = GameDataManager.getAccount().role.indexOf("老板")>=0?20:GameDataManager.getAccount().big_percent;
            if(strPer == ""|| Number(strPer)<Number(strOld) || Number(strPer)>nMyPer)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入"+strOld+"到"+nMyPer+"之间的比例");
                return;
            }

            let strParam = "{\"header\":\"设置_玩家_属性\",\"target_guuid\":\"" + strID + "\",\"big_agentid_percent\":\"" + strID+","+strPer + "\"}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "P@设置_玩家_属性_盟主");
        }
        else if(button.node.name == "我的分红")
        {
            // This build uses the compact share dialog; the legacy full-page
            // node is absent. Reuse the existing guarded withdrawal flow.
            if (!cc.isValid(this.node.getChildByName("我的分红")))
            {
                if (!(Number(GameDataManager.getAccount().fenhong) > 0))
                {
                    UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"没有分红，不能提取！");
                    return;
                }
                this.node.getChildByName("提取分红面板").active = true;
                return;
            }
            this.node.getChildByName("我的分红").active = true;
            this.GetTodayFenhong();
            Tool.GetChild(this.node,"我的分红/分红余额/num").getComponent(cc.Label).string = GameDataManager.getAccount().fenhong;
            Tool.GetChild(this.node,"我的分红/统计/累计分红/num").getComponent(cc.Label).string = GameDataManager.getAccount().all_fenhong;
            Tool.GetChild(this.node,"我的分红/统计/累计提取/num").getComponent(cc.Label).string = GameDataManager.getAccount().use_fenhong;

            //分红说明
            ConfigManager.getInstance().GetOneHashKey("分红说明","分红说明");
        }
        else if(button.node.name === "一周领取分红记录")
        {
            this.node.getChildByName("分红领取记录").active = true;
            this.GetFenhongList();
            this.GetFenHongHis();
        }
        else if(button.node.name === "领取奖励")
        {
            let time = button.node.parent.getChildByName("time").getComponent(cc.Label).string;
            let strParam = "{\"header\":\"异步_领取_玩家_分红\",\"date\":\""+time+"\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@异步_领取_玩家_分红");
            
        }
        else if(button.node.name === "确认提取分红")
        {
            this.node.getChildByName("提取分红面板").active = false;
            if(GameDataManager.getAccount().fenhong<=0)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"没有分红，不能提取！");
                return;
            }
            let strParam = "{\"header\":\"提取_玩家_分红\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@提取_玩家_分红"); 
        }
        else if(button.node.name === "提取分红")
        {
            if(GameDataManager.getAccount().fenhong<=0)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"没有分红，不能提取！");
                return;
            }

            this.node.getChildByName("提取分红面板").active = true;
        }
        else if(button.node.name === "合伙人")
        {
            Tool.GetChild(this.node,"合伙人").active = true;
            this.GetHehuorenList();
        }
        else if(button.node.name === "添加合伙人")
        {
            let strID = button.node.parent.getChildByName("用户id").getComponent(cc.EditBox).string;
            if(strID.length != 6)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"用户ID不正确")
                return;
            }
            let strParam = "{\"header\":\"设置_玩家_属性\",\"target_guuid\":\"" + strID + "\",\"supper_agentid\":\""+strID+"\"}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "P@设置_玩家_属性_合伙人");
        }
        else if(button.node.name === "设置合伙人")
        {
            let strID = button.node.parent.getChildByName("id").getComponent(cc.Label).string;
            this.node.getChildByName("合伙人调整").active = true;
            Tool.GetChild(this.node,"合伙人调整/bk/比例").getComponent(cc.EditBox).string = "";
            Tool.GetChild(this.node,"合伙人调整/bk/id").getComponent(cc.Label).string = strID;
        }
        else if(button.node.name === "确认调整合伙人")
        {
            this.node.getChildByName("合伙人调整").active = false;
            let strID = button.node.parent.getChildByName("id").getComponent(cc.Label).string;
            let per = Tool.GetChild(this.node,"合伙人调整/bk/比例").getComponent(cc.EditBox).string;
            if(Number(per)<0 || Number(per)>10)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"合伙人比例应该在0-10之间!")
                return;
            }
            let strParam = "{\"header\":\"设置_玩家_属性\",\"target_guuid\":\"" + strID + "\",\"super_percent\":\"" + per + "\"}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "P@设置_玩家_属性_合伙人属性");
        }
        else if(button.node.name === "红利说明")
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"只有有效代理才能提取红利，成为有效代理的条件为：最少拥有5个打满100手的直属玩家。");
        }
        else if(button.node.name === "奖池说明")
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"只有有效代理才能提取奖池收益，成为有效代理的条件为：最少拥有5个打满100手的直属玩家。");
        }
        else if(button.node.name === "奖池收益")
        {
            Tool.GetChild(this.node,"奖池收益").active = true;
            this.GetJiangChiToday();
            this.GetJiangChiTotle();
        }
        else if(button.node.name === "提取奖池收益")
        {
            let strHongli2 = GameDataManager.getAccount().hongli2;
            if(strHongli2 == "0")
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "当前没有奖池收益！");
                return;
            }

            this.node.getChildByName("提取奖池收益面板").active = true;
        }
        else if(button.node.name === "确认提取奖池收益")
        {
            this.node.getChildByName("提取奖池收益面板").active = false;
            let strParam = "{\"header\":\"提取_玩家_红利\",\"money_type\":\"2\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@提取_玩家_奖池收益");
        }
        else if(button.node.name === "我的奖池收益详情")
        {
            this.node.getChildByName("奖池贡献详情").active = true;

            let arrayAll = Tool.GetChild(this.node,"奖池贡献详情/条件").getComponent(cc.ToggleContainer).toggleItems;
            let strName = "";
            for(let item of arrayAll)
            {
                if(item.isChecked)
                {
                    strName = item.node.name;
                    break;
                }
            }
            let nLevel = 1;
            if(strName === "直属玩家")
            {
                nLevel = 1;
            }
            else if(strName === "二级玩家")
            {
                nLevel = 2;
            }
            else if(strName === "三级玩家")
            {
                nLevel = 3;
            }
            else if(strName === "盟主")
            {
                nLevel = 99;
            }
            this.GetYeji2();
            this.GetYejiTodayTotlle2(nLevel);
            this.GetYejiAlllTotlle2(nLevel);


        }
        else if(button.node.name === "提取奖池记录")
        {
            Tool.GetChild(this.node,"奖池提取记录").active = true;
            this.GetHongli2List();
        }
        else if(button.node.name === "玩家奖池贡献详情")
        {
            let strID = button.node.parent.getChildByName("id").getComponent(cc.Label).string;
            let strName = button.node.parent.getChildByName("name").getComponent(cc.Label).string;

            this.node.getChildByName("玩家奖池贡献详情").active = true;
            Tool.GetChild(this.node,"玩家奖池贡献详情/title/info").getComponent(cc.Label).string = strName+"的贡献";
            Tool.GetChild(this.node,"玩家奖池贡献详情/id").getComponent(cc.Label).string = strID;

            this.GetPlayerJCSYList();
        }
        else if(button.node.name == "推广")
        {
            const mainNode = this.node.parent && this.node.parent.getChildByName("panelMain");
            const main = cc.isValid(mainNode) ? mainNode.getComponent(panelMain) : null;
            if(!main || !main.OpenPromotionPanel(this.node))
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"推广页面暂未就绪，请返回大厅后重试！");
        }
        else if(button.node.name === "总业绩")
        {
            let strLevel = GameDataManager.getAccount().level
            if(strLevel == '99')
            {
                this.node.getChildByName("总业绩").active = true;
            }
            else
            {
                this.node.getChildByName("总业绩2").active = true;
            }
            
            this.GetDailiZhongYeji();
            //查询总业绩
            //this.GetProxyList();
            this.GetYejiUserList()
        }
        // else if(button.node.name === "授权总业绩")
        // {
        //     let strID = button.node.parent.getChildByName("id").getComponent(cc.Label).string;
        //     let strName = button.node.parent.getChildByName("name").getComponent(cc.Label).string;

        //     Tool.GetChild(this.node,"添加总业绩对象面板").active = true;
        //     Tool.GetChild(this.node,"添加总业绩对象面板/bk/msg").getComponent(cc.Label).string = "是否确认授权用户: "+strName+" ?"
        //     Tool.GetChild(this.node,"添加总业绩对象面板/bk/id").getComponent(cc.Label).string = strID;
        // }
        else if(button.node.name === "授权总业绩")
        {
            let strID = button.node.parent.getChildByName("用户ID").getComponent(cc.EditBox).string;
            if(strID.length != 6)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "请输入正确的用户ID");
                return
            }
            button.node.parent.getChildByName("用户ID").getComponent(cc.EditBox).string = ""
            let strParam = "{\"header\":\"设置_玩家_属性\",\"target_guuid\":\"" + strID + "\",\"client_prop\":\"True\"}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "P@设置_玩家_业绩_权限");
        }
        else if(button.node.name === "确认删除总业绩对象")
        {
            Tool.GetChild(this.node,"删除总业绩对象面板").active = false;
            let strID = button.node.parent.getChildByName("id").getComponent(cc.Label).string
            let strParam = "{\"header\":\"设置_玩家_属性\",\"target_guuid\":\"" + strID + "\",\"client_prop\":\"False\"}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "P@设置_玩家_业绩_权限");
        }
        else if(button.node.name === "删除授权总业绩")
        {
            let strID = button.node.parent.getChildByName("id").getComponent(cc.Label).string;
            let strName = button.node.parent.getChildByName("name").getComponent(cc.Label).string;

            Tool.GetChild(this.node,"删除总业绩对象面板").active = true;
            Tool.GetChild(this.node,"删除总业绩对象面板/bk/msg").getComponent(cc.Label).string = "是否确认删除用户: "+strName+" ?"
            Tool.GetChild(this.node,"删除总业绩对象面板/bk/id").getComponent(cc.Label).string = strID;

            // let strParam = "{\"header\":\"设置_玩家_属性\",\"target_guuid\":\"" + strID + "\",\"client_prop\":\"False\"}";
            // GameDataManager.getAccount().reqAccountCommand(strParam, "P@设置_玩家_业绩_权限");
        }
    }
    public onToggleClick(toggle:cc.Toggle)
    {
        if(toggle.node.parent.name === "条件")
        {
            if(toggle.node.parent.parent.name === "我的业绩" && toggle.isChecked)
            {

                let nLevel = 1;            
                if(toggle.node.name === "我的玩家")
                {
                    nLevel = 1;
                }
                else if(toggle.node.name === "二级代理")
                {
                    nLevel = 2;
                }
                else if(toggle.node.name === "三级代理")
                {
                    nLevel = 3;
                }
                this.GetYeji();
                this.GetYejiTodayTotlle(nLevel);
                this.GetYejiAlllTotlle(nLevel);
                
            }
            else if(toggle.node.parent.parent.name === "奖池贡献详情" && toggle.isChecked)
            {
                let nLevel = 1;
                if(toggle.node.name === "直属玩家")
                {
                    nLevel = 1;
                }
                else if(toggle.node.name === "二级玩家")
                {
                    nLevel = 2;
                }
                else if(toggle.node.name === "三级玩家")
                {
                    nLevel = 3;
                }
                else if(toggle.node.name === "盟主")
                {
                    nLevel = 99;
                }
                this.GetYeji2();
                this.GetYejiTodayTotlle2(nLevel);
                this.GetYejiAlllTotlle2(nLevel);
            }
            else if(toggle.node.parent.parent.name === "玩家奖池贡献详情" && toggle.isChecked)
            {
                this.GetPlayerJCSYList();
            }

        }
    }
    //代理列表
    public GetProxyList(nPage:number = 0)
    {
        let strParam = "{\"header\":\"查询_玩家_代理列表\",\"user_id\":\"" + GameDataManager.getAccount().guuid + "\",\"page\":\"" + nPage + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_玩家_代理列表");
    }

    public GetMyPlayer(nPage:number = 0)
    {
        let strParam = "{\"header\":\"查询_下级玩家_信息\",\"user_id\":\"" + GameDataManager.getAccount().guuid + "\",\"page\":\"" + nPage.toString() + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_下级玩家_信息");
    }

    public GetYejiUserList(nPage:number = 0)
    {
        let strParam = "{\"header\":\"异步_查询_总业绩授权_列表\",\"context\":\"异步_查询_总业绩授权_列表\",\"page\":\"" + nPage + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam,"P@异步_查询_总业绩授权_列表");
    }

    public OnGetAllLowerCount(strMsg:string)
    {
        let data = JSON.parse(strMsg);

        if (data == null)
        {
            Debug.Error("json格式异常！");
            return;
        }

        let msg = data["GetAllLowerCount"];
        Tool.GetChild(this.node,"数据/下级玩家").getComponent(cc.Label).string = msg["all_lower_count"];        

    }
    public OnGetTodayLowerCount(strMsg:string)
    {
        let data = JSON.parse(strMsg);

        if (data == null)
        {
            Debug.Error("json格式异常！");
            return;
        }
        let msg = data["GetTodayLowerCount"];
        Tool.GetChild(this.node,"数据/今日新增").getComponent(cc.Label).string = msg["today_lower_count"];
        this.refreshAgentSummary();
    }

    public onHallCommand(nCode:number, param:string)
    {
        if (this.handleJackpotResponse(nCode, param)) return;
        if (param.indexOf("设置_玩家_代理") >= 0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "添加代理成功！");
                this.scheduleOnce(()=>{
                    this.GetMyPlayer(this.scrollMyPlayers.nCurPage);
                },0.3);      
                
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("提取_玩家_红利")>=0 || param.indexOf("提取_玩家_奖池收益")>=0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "操作成功！");                
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("异步_查询_分红_详细信息")>=0)
        {
            if (nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                if(param.indexOf("今日")>=0)
                {
                    let info = data["ListFenhongInfo"];
                    if(info.length>0)
                    {
                        let today = info[0];
                        Tool.GetChild(this.node,"我的分红/今日分红/num").getComponent(cc.Label).string = today["tiqu_hongli"];
                        Tool.GetChild(this.node,"我的分红/今日分红/今日手数").getComponent(cc.Label).string = today["played_count"];
                        Tool.GetChild(this.node,"我的分红/今日分红/条件").getComponent(cc.Label).string = today["status"];
                        Tool.GetChild(this.node,"我的分红/今日分红/比例").getComponent(cc.Label).string = "分红比例:"+today["tiqu_rate"]+"%";
                        Tool.GetChild(this.node,"我的分红/今日红利/num").getComponent(cc.Label).string = today["all_hongli"];

                        if(today["status"] == "已满足")
                        {
                            Tool.GetChild(this.node,"我的分红/今日分红/条件").color = cc.Color.RED;
                        }
                        else
                        {
                            Tool.GetChild(this.node,"我的分红/今日分红/条件").color = cc.Color.GREEN;
                        }
                    }
                }
                else
                {
                    this.scrollFenhongList.UpdateList(JSON.stringify(data),"ListFenhongInfo","分红提取记录",1000,this.setFenhongListItem.bind(this));
                }

            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                //UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("异步_领取_玩家_分红")>=0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "领取成功！");                
                this.GetFenhongList();
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("提取_玩家_分红")>=0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "提取成功！");                
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("异步_查询_红利_信息")>=0)
        {
            if(nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                Tool.GetChild(this.node,"红利统计/今日红利").getComponent(cc.Label).string = data[0];
                Tool.GetChild(this.node,"红利统计/昨日红利").getComponent(cc.Label).string = data[1];
                Tool.GetChild(this.node,"红利统计/前日红利").getComponent(cc.Label).string = data[2];
                this.refreshAgentSummary();
            }
        }
        else if(param.indexOf("异步_查询_提取分红_详细信息")>=0)
        {
            if(nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                this.scrollFenhongHis.UpdateList(JSON.stringify(data),"ListLetPFenhongInfo","红利提取记录对象",this.PAGE_PER_COUNT,this.setFenHongHisItem.bind(this));
            }
        }
        else if(param.indexOf("异步_查询_玩家_分级_红利贡献_信息")>=0)
        {
            if(nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                this.scrollPlayerGX.UpdateList(JSON.stringify(data),"ListPlayUpperHongliOutcomeInfo","玩家奖池贡献明细对象",this.PAGE_PER_COUNT,this.setPlayerGXItem.bind(this));
            }
        }
        else if(param.indexOf("查询_玩家_所有_今日_红利收益_信息")>=0)
        {
            if(nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                
            }
        }
        else if(param.indexOf("查询_玩家_所有_累计_红利收益_信息")>=0)
        {
            if(nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                
            }
        }
        else if(param.indexOf("异步_查询_代理_业绩_信息")>=0)
        {
            if(nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                let info = data["ListProxyPerformanceInfo"];
                let all_performance = info["all_performance"]
                let proxy_performance = info["proxy_performance"]

                Tool.GetChild(this.node,"总业绩/统计/昨日贡献/num").getComponent(cc.Label).string = proxy_performance.toString();
                Tool.GetChild(this.node,"总业绩/统计/所占比例/num").getComponent(cc.Label).string = all_performance == 0?"0%":((proxy_performance*100/all_performance).toFixed(2)+"%")
                Tool.GetChild(this.node,"总业绩2/bk/所占比例").getComponent(cc.Label).string = all_performance == 0?"0%":((proxy_performance*100/all_performance).toFixed(2)+"%")
            }
        }
        else if(param.indexOf("异步_查询_总业绩授权_列表")>=0)
        {
            if (nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                this.scrollZhongZhanji.UpdateList(JSON.stringify(data),"ListPerformanceList","总业绩对象",this.PAGE_PER_COUNT,this.setZhongZhanjiItem.bind(this));

                // if(param.indexOf("今日")>=0)
                // {
                //     let info = data["ListFenhongInfo"];
                //     if(info.length>0)
                //     {
                //         let today = info[0];
                //         Tool.GetChild(this.node,"我的分红/今日分红/num").getComponent(cc.Label).string = today["tiqu_hongli"];
                //         Tool.GetChild(this.node,"我的分红/今日分红/今日手数").getComponent(cc.Label).string = today["played_count"];
                //         Tool.GetChild(this.node,"我的分红/今日分红/条件").getComponent(cc.Label).string = today["status"];
                //         Tool.GetChild(this.node,"我的分红/今日分红/比例").getComponent(cc.Label).string = "分红比例:"+today["tiqu_rate"]+"%";
                //         Tool.GetChild(this.node,"我的分红/今日红利/num").getComponent(cc.Label).string = today["all_hongli"];

                //         if(today["status"] == "已满足")
                //         {
                //             Tool.GetChild(this.node,"我的分红/今日分红/条件").color = cc.Color.RED;
                //         }
                //         else
                //         {
                //             Tool.GetChild(this.node,"我的分红/今日分红/条件").color = cc.Color.GREEN;
                //         }
                //     }
                // }
                // else
                // {
                //     this.scrollFenhongList.UpdateList(JSON.stringify(data),"ListFenhongInfo","分红提取记录",1000,this.setFenhongListItem.bind(this));
                // }

            }
        }
        else if(param.indexOf("获取_大厅_配置数据")>=0)
        {
            if(nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                let value = data["param_value"];

                this.strPTGuuid = value;
            }
        }
    }
    public setFenHongHisItem(node:cc.Node,jItem:any)
    {
        node.active = true;
        node.getChildByName("time").getComponent(cc.Label).string = jItem["date"]+" "+jItem["time"];
        node.getChildByName("count").getComponent(cc.Label).string = jItem["add_money"];
        node.getChildByName("state").getComponent(cc.Label).string = "成功";
    }


    public OnListLowerLevelAccountInfo(strMsg:string)
    {
        this.scrollMyPlayers.UpdateList(strMsg,"ListLowerLevelAccountInfo","玩家对象",this.PAGE_PER_COUNT,this.setMyPlayerItem.bind(this)); 
        Tool.GetChild(this.node,"我的玩家/统计/下级玩家数量/num").getComponent(cc.Label).string = this.scrollMyPlayers.nCount.toString();
    }
    public setMyPlayerItem(node:cc.Node,jItem:any)
    {
        node.active = true;
        
        let strMark:string = jItem["user_remark"];
        let arrayAll = strMark.split(',');
        let nTotleHand = 0;
        if(strMark != "")
        {
            nTotleHand = Number(arrayAll[0]) + Number(arrayAll[1]) + Number(arrayAll[2]);
        }

        node.getChildByName("id").getComponent(cc.Label).string = jItem["user_id"]
        node.getChildByName("name").getComponent(cc.Label).string = jItem["user_name"]
        node.getChildByName("count").getComponent(cc.Label).string = nTotleHand.toString();
        node.getChildByName("time").getComponent(cc.Label).string = jItem["date"];

        const avatar = Tool.GetChild(node, "头像/mask/img").getComponent(cc.Sprite);
        ImageManager.getInstance().BindPlayerListAvatar(String(jItem["user_id"]), avatar);

        const watch = node.getChildByName("观战");
        const roomValue = jItem["room_id"];
        const roomText = typeof roomValue === "string" || typeof roomValue === "number" ? String(roomValue).trim() : "";
        const roomID = Number(roomText);
        watch.targetOff(this);
        watch.active = /^\d+$/.test(roomText) && Number.isSafeInteger(roomID) && roomID > 0;
        if (watch.active)
        {
            watch.on("click", () => {
                if (!GpsManager.getInstance().IsGpsOpen() && ConfigManager.getInstance().enalbe_gps == "True")
                {
                    UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "未打开GPS不能进入房间！");
                    return;
                }
                UIManager.getInstance().showPanel("panelLoading", ShowPanelMode.Top);
                GameDataManager.getAccount().reqEnterRoom(RoomType.Custom, roomID, "{{\"special_rule\": \"观战\"}}");
            }, this);
        }

        let strUserID:string = jItem["user_id"];
        let big_agentid:string = jItem["big_agentid"];
        let supper_agentid:string = jItem["supper_agentid"];
        let big_agentid2:string = jItem["big_agentid2"];

        let strLevel:string = jItem["user_level"];

        let btn = node.getChildByName("授权代理").getComponent(cc.Button);
        if (strLevel == "98" || strLevel == "99")
        {

            if (strUserID == supper_agentid)
            {
                node.getChildByName("type").getComponent(cc.Label).string = "合伙人"   ;            
            }
            else if (strUserID == big_agentid)
            {
                node.getChildByName("type").getComponent(cc.Label).string = "盟主"  ;             
            }
            else if (strUserID == big_agentid2)
            {
                node.getChildByName("type").getComponent(cc.Label).string = "小盟主";                
            }
            else
            {
                node.getChildByName("type").getComponent(cc.Label).string = "代理";                
            }
            btn.node.active = false;
        }
        else
        {
            btn.node.active = true;
            node.getChildByName("type").getComponent(cc.Label).string = "";
            
            btn.node.targetOff(this);
            btn.node.on("click",()=>{
                this.onButtonClick(btn);
            },this);
        }
    }

    public GetYeji(nPage:number = 0)
    {      
        let arrayAll = Tool.GetChild(this.node,"我的业绩/条件").getComponent(cc.ToggleContainer).toggleItems;
        let strName = "";
        for(let item of arrayAll)
        {
            if(item.isChecked)
            {
                strName = item.node.name;
                break;
            }
        }
        let nLevel = 1;
        if(strName === "我的玩家")
        {
            nLevel = 1;
        }
        else if(strName === "二级代理")
        {
            nLevel = 2;
        }
        else if(strName === "三级代理")
        {
            nLevel = 3;
        }
        let strParam = "{\"header\":\"查询_玩家_分级_红利收益_信息\",\"upper_leve\":\""+nLevel+"\",\"user_id\":\"" + GameDataManager.getAccount().guuid + "\",\"page\":\"" + nPage.toString() + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_玩家_分级_红利收益_信息");
    }
    public GetYejiTodayTotlle(nLevel:number,strType:string = "")
    {        
        let strParam = "{\"header\":\"查询_玩家_分级_今日_红利收益_信息\",\"upper_leve\":\"" + nLevel+"\",\"user_id\":\"" + GameDataManager.getAccount().guuid + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_玩家_分级_今日_红利收益_信息"+strType);
    }
    public GetYejiAlllTotlle(nLevel:number,strType:string = "")
    {        
        let strParam = "{\"header\":\"查询_玩家_分级_累计_红利收益_信息\",\"upper_leve\":\"" + nLevel + "\",\"user_id\":\"" + GameDataManager.getAccount().guuid + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_玩家_分级_累计_红利收益_信息"+ strType);
    }

    //业绩列表刷新
    public OnChuanXiaoPlayerTaxRecord(strMsg:string)
    {
        if(strMsg.indexOf("查询_玩家_分级_红利收益_信息")>=0)
        {
            this.scrollYeji.UpdateList(strMsg,"ChuanXiaoPlayerTaxRecord","贡献对象",this.PAGE_PER_COUNT,this.setYejiItem.bind(this));
            Tool.GetChild(this.node,"我的业绩/统计/总人数/num").getComponent(cc.Label).string = this.scrollYeji.nCount.toString();
        }
        else //奖池业绩
        {
            this.scrollYeji2.UpdateList(strMsg,"ChuanXiaoPlayerTaxRecord","奖池贡献对象",this.PAGE_PER_COUNT,this.setYejiItem2.bind(this));
            Tool.GetChild(this.node,"奖池贡献详情/统计/总人数/num").getComponent(cc.Label).string = this.scrollYeji2.nCount.toString();
        }

    }
    public setYejiItem(node:cc.Node,jItem:any)
    {
        node.active = true;

        node.getChildByName("id").getComponent(cc.Label).string = jItem["player_guuid"];
        node.getChildByName("name").getComponent(cc.Label).string = jItem["player_wxname"];
        node.getChildByName("today").getComponent(cc.Label).string = jItem["upper_today_income"];
        node.getChildByName("all").getComponent(cc.Label).string = jItem["upper_total_income"];
        ImageManager.getInstance().BindPlayerListAvatar(String(jItem["player_guuid"]),
            Tool.GetChild(node, "头像/mask/img").getComponent(cc.Sprite));
    }
    public setYejiItem2(node:cc.Node,jItem:any) //奖池业绩对象
    {
        node.active = true;

        node.getChildByName("id").getComponent(cc.Label).string = jItem["player_guuid"];
        node.getChildByName("name").getComponent(cc.Label).string = jItem["player_wxname"];
        node.getChildByName("today").getComponent(cc.Label).string = jItem["upper_today_income"];
        node.getChildByName("all").getComponent(cc.Label).string = jItem["upper_total_income"];

        let btn = node.getChildByName("玩家奖池贡献详情").getComponent(cc.Button);
        btn.node.targetOff(this);
        btn.node.on("click",()=>{
            this.onButtonClick(btn);
        },this);
    }

    public OnChuanXiaoPlayerTodayTaxRecord(strMsg:string)
    {
        let data = JSON.parse(strMsg);

        if (data == null)
        {
            Debug.Error("json格式异常！");
            return;
        }
        let jItem = data["ChuanXiaoPlayerTodayTaxRecord"];
        let upper_today_income = jItem["upper_today_income"];

        if(strMsg.indexOf("查询_玩家_分级_今日_红利收益_信息")>=0)
        {
            if (strMsg.indexOf("区域") >= 0)
            {
                Tool.GetChild(this.node,"我的盟主/统计/今日贡献/num").getComponent(cc.Label).string = upper_today_income;            
            }
            else if(strMsg.indexOf("合伙人")>=0)
            {
                Tool.GetChild(this.node,"大区收益/bk/今日收益").getComponent(cc.Label).string = upper_today_income;            
            }
            else
                Tool.GetChild(this.node,"我的业绩/统计/今日总贡献/num").getComponent(cc.Label).string = upper_today_income;  
        }
        else//奖池
        {
            Tool.GetChild(this.node,"奖池收益/bk/今日收益").getComponent(cc.Label).string = upper_today_income;  
        }
        this.refreshAgentSummary();
    }
    public OnChuanXiaoPlayerTotalTaxRecord(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        if (data == null)
        {
            Debug.Error("json格式异常！");
            return;
        }

        let jItem = data["ChuanXiaoPlayerTotalTaxRecord"];      
        let upper_total_income = jItem["upper_total_income"];

        if(strMsg.indexOf("查询_玩家_分级_累计_红利收益_信息")>=0)
        {
            if (strMsg.indexOf("区域") >= 0)
            {
                Tool.GetChild(this.node,"我的盟主/统计/累计贡献/num").getComponent(cc.Label).string = upper_total_income;            
            }
            else if (strMsg.indexOf("合伙人") >= 0)
            {
                Tool.GetChild(this.node,"大区收益/bk/累计收益").getComponent(cc.Label).string = upper_total_income;            
            }
            else
            {
                Tool.GetChild(this.node,"我的业绩/统计/累计总贡献/num").getComponent(cc.Label).string = upper_total_income;           
            }   
        }
        else //奖池
        {
            Tool.GetChild(this.node,"奖池收益/bk/累计收益").getComponent(cc.Label).string = upper_total_income;           
        }
        this.refreshAgentSummary();
    }
    public GetHongliList(nPage:number = 0)
    {        
        let strParam = "{\"header\":\"查询_玩家_红利提取_记录\",\"user_id\":\"" + GameDataManager.getAccount().guuid + "\",\"count\":\""+this.PAGE_PER_COUNT+"\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_玩家_红利提取_记录");
    }
    //红利提取记录
    public OnHongliList(strMsg:string)
    {
        if(strMsg.indexOf("查询_玩家_红利提取_记录")>=0)
            this.scrollHongliList.UpdateList(strMsg,"HongliList","红利提取记录对象",this.PAGE_PER_COUNT,this.setHongliItem.bind(this));
        else
            this.scrollHongli2List.UpdateList(strMsg,"HongliList","红利提取记录对象",this.PAGE_PER_COUNT,this.setHongliItem.bind(this));
    }
    public setHongliItem(node:cc.Node,jItem:any)
    {
        node.active = true;

        node.getChildByName("time").getComponent(cc.Label).string = jItem["date"];
        node.getChildByName("count").getComponent(cc.Label).string = jItem["hongli_number"];
        node.getChildByName("state").getComponent(cc.Label).string = "成功";
    }

    //奖池提取记录
    public GetHongli2List(nPage:number = 0)
    {        
        let strParam = "{\"header\":\"查询_玩家_红利提取_记录\",\"money_type\":\"2\",\"user_id\":\"" + GameDataManager.getAccount().guuid + "\",\"count\":\""+this.PAGE_PER_COUNT+"\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_玩家_奖池收益提取_记录");
    }


    //更新盟主列表
    public OnListPlayerProxyInfo(strMsg:string)
    {
        if(this.node.getChildByName("我的盟主").active)
        {
            this.scrollMengzhuList.UpdateList(strMsg,"ListPlayerProxyInfo","盟主对象",this.PAGE_PER_COUNT,this.setMengzhuItem.bind(this));
        }
        else
        {
            this.scrollZhongZhanji.UpdateList(strMsg,"ListPlayerProxyInfo","总业绩对象",this.PAGE_PER_COUNT,this.setZhongZhanjiItem.bind(this))
        }
        
    }
    public setMengzhuItem(node:cc.Node,jItem:any)
    {
        node.active = true;
        node.getChildByName("id").getComponent(cc.Label).string = jItem["user_id"];
        node.getChildByName("name").getComponent(cc.Label).string = jItem["user_name"];
        node.getChildByName("玩家数").getComponent(cc.Label).string = jItem["all_lower_count"];
        ImageManager.getInstance().BindPlayerListAvatar(String(jItem["user_id"]),
            Tool.GetChild(node, "头像/mask/img").getComponent(cc.Sprite));
        

        if(jItem["big_agentid"] === jItem["user_id"])
        {
            node.getChildByName("type").active = true;
            node.getChildByName("授权盟主").active = false;
            node.getChildByName("设置盟主").active = true;
            node.getChildByName("比例").getComponent(cc.Label).string = jItem["big_percent"]+"%";

            let btn = node.getChildByName("设置盟主").getComponent(cc.Button);
            btn.node.targetOff(this);
            btn.node.on("click",()=>{
                this.onButtonClick(btn);
            },this);
        }
        else
        {
            node.getChildByName("type").active = false;
            node.getChildByName("授权盟主").active = true;
            node.getChildByName("设置盟主").active = false;
            node.getChildByName("比例").getComponent(cc.Label).string = "";
            let btn = node.getChildByName("授权盟主").getComponent(cc.Button);
            btn.node.targetOff(this);
            btn.node.on("click",()=>{
                this.onButtonClick(btn);
            },this);
        }
    }
    public setZhongZhanjiItem(node:cc.Node,jItem:any)
    {
        node.active = true;
        node.getChildByName("id").getComponent(cc.Label).string = jItem[0];
        node.getChildByName("name").getComponent(cc.Label).string = jItem[1];

        let btn = node.getChildByName("删除授权总业绩").getComponent(cc.Button);
        btn.node.targetOff(this);
        btn.node.on("click",()=>{
            this.onButtonClick(btn);
        },this)

    }
    public onAccountCommand(nCode:number, param:string)
    {
        if(param.indexOf("设置_玩家_属性")>=0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "操作成功！"); 
                 if(param.indexOf("盟主")>=0)
                {
                    this.scheduleOnce(()=>{
                        this.GetProxyList(this.scrollMengzhuList.nCurPage);
                    },0.3);
                    
                }
                else if(param.indexOf("合伙人属性")>=0)
                {
                    this.scheduleOnce(()=>{
                        this.GetHehuorenList(this.scrollHehuorenList.nCurPage);
                    },0.3);                    
                }
                else if(param.indexOf("合伙人")>=0)
                {
                    this.scheduleOnce(()=>{
                        this.GetHehuorenList(this.scrollHehuorenList.nCurPage);
                    },0.3);                    
                }
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("设置_玩家_业绩_权限")>=0)
        {
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "设置成功！"); 
            this.GetYejiUserList(this.scrollZhongZhanji.nCurPage);
        }
    }
    public GetTodayFenhong()
    {
        let strParam = "{\"header\":\"异步_查询_分红_详细信息\",\"date\":\"0\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@异步_查询_分红_详细信息_今日");
    }
    public GetFenhongList(nPage:number = 0)
    {
        let strParam = "{\"header\":\"异步_查询_分红_详细信息\",\"date\":\"-1\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@异步_查询_分红_详细信息");
    }
    //查询分红历史记录
    public GetFenHongHis(nPage:number = 0)
    {
        let strParam = "{\"header\":\"异步_查询_提取分红_详细信息\",\"page\":\"" + nPage.toString() + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@异步_查询_提取分红_详细信息");
    }
    public setFenhongListItem(node:cc.Node,jItem:any)
    {
        node.active = true;
        node.getChildByName("time").getComponent(cc.Label).string = jItem["date"];
        node.getChildByName("手数").getComponent(cc.Label).string = jItem["played_count"];
        node.getChildByName("红利").getComponent(cc.Label).string = jItem["all_hongli"];
        node.getChildByName("比例").getComponent(cc.Label).string = jItem["tiqu_rate"]+"%";
        node.getChildByName("金额").getComponent(cc.Label).string = jItem["tiqu_hongli"];
        node.getChildByName("操作").getComponent(cc.Label).string = jItem["status"];

        if(jItem["status"] == "已满足")
        {
            let btn = node.getChildByName("领取奖励").getComponent(cc.Button);
            btn.node.active = true;
            btn.node.targetOff(this);
            btn.node.on("click",()=>{
                this.onButtonClick(btn);
            });
            node.getChildByName("操作").active = false;
        }
        else
        {
            node.getChildByName("领取奖励").active = false;
            node.getChildByName("操作").active = true;
        }
    }
    public set_fenhong(old)
    {
        this.refreshAgentSummary();
        if(Tool.GetChild(this.node,"我的分红/分红余额/num") == undefined)
            return;
        Tool.GetChild(this.node,"我的分红/分红余额/num").getComponent(cc.Label).string = GameDataManager.getAccount().fenhong;
        Tool.GetChild(this.node,"我的分红/统计/累计分红/num").getComponent(cc.Label).string = GameDataManager.getAccount().all_fenhong;
        Tool.GetChild(this.node,"我的分红/统计/累计提取/num").getComponent(cc.Label).string = GameDataManager.getAccount().use_fenhong;
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
        if(context == "分红说明")
        {
            Tool.GetChild(this.node,"我的分红/分红说明").getComponent(cc.Label).string = strContent;
        }
        else if(context == "推广二维码")
        {
            if(strContent == '开')
            {
                Tool.GetChild(this.node,"操作/推广").active = true;
            }
            else
            {
                Tool.GetChild(this.node,"操作/推广").active = false;
            }
            this.refreshAgentActions();
        }
    }
    public GetHehuorenList(nPage:number = 0)
    {
        let strParam = "{\"header\":\"查询_所有_合伙人\",\"user_id\":\""+GameDataManager.getAccount().guuid+"\",\"page\":\"" + nPage.toString() + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_所有_合伙人");
    }
    //更新合伙人列表
    public OnGetSupperAgentList(strMsg:string)
    {
        this.scrollHehuorenList.UpdateList(strMsg,"GetSupperAgentList","合伙人对象",this.PAGE_PER_COUNT,this.setHehuorenItem.bind(this));
    }
    public setHehuorenItem(node:cc.Node,jItem:any)
    {
        node.active = true;

        node.getChildByName("id").getComponent(cc.Label).string = jItem["guuid"];
        node.getChildByName("name").getComponent(cc.Label).string = jItem["name"];
        node.getChildByName("授权").getComponent(cc.Label).string = jItem["super_percent"]+"%";

        let btn = node.getChildByName("设置合伙人").getComponent(cc.Button);
        btn.node.targetOff(this);
        btn.node.on("click",()=>{
            this.onButtonClick(btn);
        },this);
    }

    public GetYeji2(nPage:number = 0)
    {      
        let arrayAll = Tool.GetChild(this.node,"奖池贡献详情/条件").getComponent(cc.ToggleContainer).toggleItems;
        let strName = "";
        for(let item of arrayAll)
        {
            if(item.isChecked)
            {
                strName = item.node.name;
                break;
            }
        }
        let nLevel = 1;
        if(strName === "直属玩家")
        {
            nLevel = 1;
        }
        else if(strName === "二级玩家")
        {
            nLevel = 2;
        }
        else if(strName === "三级玩家")
        {
            nLevel = 3;
        }
        else if(strName === "盟主")
        {
            nLevel = 99;
        }
        let strParam = "{\"header\":\"查询_玩家_分级_红利收益_信息\",\"money_type\":\"2\",\"upper_leve\":\""+nLevel+"\",\"user_id\":\"" + GameDataManager.getAccount().guuid + "\",\"page\":\"" + nPage.toString() + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_玩家_分级_奖池收益_信息");
    }
    public GetYejiTodayTotlle2(nLevel:number,strType:string = "")
    {        
        let strParam = "{\"header\":\"查询_玩家_分级_今日_红利收益_信息\",\"money_type\":\"2\",\"upper_leve\":\"" + nLevel+"\",\"user_id\":\"" + GameDataManager.getAccount().guuid + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_玩家_分级_今日_奖池收益_信息"+strType);
    }
    public GetYejiAlllTotlle2(nLevel:number,strType:string = "")
    {        
        let strParam = "{\"header\":\"查询_玩家_分级_累计_红利收益_信息\",\"money_type\":\"2\",\"upper_leve\":\"" + nLevel + "\",\"user_id\":\"" + GameDataManager.getAccount().guuid + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_玩家_分级_累计_奖池收益_信息"+ strType);
    }

    //奖池收益
    public GetJiangChiToday()
    {        
        let strParam = "{\"header\":\"查询_玩家_所有_今日_红利收益_信息\",\"money_type\":\"2\",\"user_id\":\"" + GameDataManager.getAccount().guuid + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_玩家_所有_今日_红利收益_信息");
    }
    public GetJiangChiTotle()
    {        
        let strParam = "{\"header\":\"查询_玩家_所有_累计_红利收益_信息\",\"money_type\":\"2\",\"user_id\":\"" + GameDataManager.getAccount().guuid + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_玩家_所有_累计_红利收益_信息");
    }


    public GetPlayerJCSYList(nPage:number = 0)
    {
        let arrayAll = Tool.GetChild(this.node,"玩家奖池贡献详情/条件").getComponent(cc.ToggleContainer).toggleItems;
        let strName = "";
        for(let item of arrayAll)
        {
            if(item.isChecked)
            {
                strName = item.node.name;
                break;
            }
        }

        let strID = Tool.GetChild(this.node,"玩家奖池贡献详情/id").getComponent(cc.Label).string;

        let strParam = "{\"header\":\"异步_查询_玩家_分级_红利贡献_信息\",\"date\":\""+strName+"\",\"user_id\":\"" + strID + "\",\"page\":\"" + nPage.toString() + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@异步_查询_玩家_分级_红利贡献_信息");
    }
    public OnListPlayUpperHongliOutcomeInfo(strMsg:string)
    {
        this.scrollPlayerGX.UpdateList(strMsg,"ListPlayUpperHongliOutcomeInfo","玩家奖池贡献明细对象",this.PAGE_PER_COUNT,this.setPlayerGXItem.bind(this));
    }
    public setPlayerGXItem(node:cc.Node,jItem:any)
    {
        node.active = true;
        node.getChildByName("name").getComponent(cc.Label).string = jItem[0];
        node.getChildByName("奖池贡献").getComponent(cc.Label).string = jItem[1];
        node.getChildByName("共享奖池").getComponent(cc.Label).string = jItem[2];

        let arrayAll = jItem[3].toString().split(",");

        if(arrayAll[0]=="-1")
            node.getChildByName("info/0").active = false;
        else
            Tool.GetChild(node,"info/0").getComponent(cc.Label).string = "盟主:"+arrayAll[0];
        Tool.GetChild(node,"info/1").getComponent(cc.Label).string = "代理:"+arrayAll[1];
        Tool.GetChild(node,"info/2").getComponent(cc.Label).string = "总计:"+arrayAll[2];
    }
    //查询代理昨日总业绩
    public GetDailiZhongYeji()
    {
        let strParam:string = "{\"header\":\"异步_查询_代理_业绩_信息\",\"date\":-1,\"context\":\"异步_查询_代理_业绩_信息\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@异步_查询_代理_业绩_信息"); 
    }
    public AccountProp(strMsg:string)
    {
        let json = JSON.parse(strMsg);
        if(json == null)
            return;

        let context = json["context"];
        let result_name = json["result_name"];
        let result_value = json["result_value"];

        if(context === "查询上级ID")
        {
            Debug.Log(strMsg)
            Tool.GetChild(this.node,"数据/上级ID").getComponent(cc.Label).string = result_value.length>0?result_value[0]:"--"
        }
    }
}
