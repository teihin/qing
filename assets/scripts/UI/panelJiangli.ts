import UIPanelViewBase from "../common/UIPanelViewBase";
import GameDataManager from "../GameDataManager";
import UIManager from "../common/UIManager";
import { ShowPanelMode } from "../common/GameDef";
import Tool from "../common/Tool";
import ScrollViewEx from "../common/ScrollViewEx";
import Debug from "../common/Debug";

var KBEngine = require("kbengine");
const {ccclass, property} = cc._decorator;

@ccclass
export default class panelJiangli extends UIPanelViewBase {

    private PAGE_PER_COUNT:number = 15;
    private role:string = "";

    private scrollHuodongHistory:ScrollViewEx = null; //活动详细记录
    private scrollJiangliHistory:ScrollViewEx = null; //奖励详细记录
    private scrollZongcaiList:ScrollViewEx = null; //总裁列表
    private scrollHehuorenList:ScrollViewEx = null; //合伙人列表
    private scrollMengzhuList:ScrollViewEx = null; //盟主列表
    private scrollFenxi:ScrollViewEx = null; //数据分析
    private scrollToday:ScrollViewEx = null; //今日详情

    onLoad () {
        super.onLoad();

        KBEngine.Event.register("GetBossShareGold", this, "OnGetBossShareGold");
        KBEngine.Event.register("GetYuJiangliByDate", this, "OnGetYuJiangliByDate");
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
        KBEngine.Event.register("ListBossShareGoldInfo", this, "OnListBossShareGoldInfo");
        KBEngine.Event.register("ListYuJiangliInfo", this, "OnListYuJiangliInfo");
        KBEngine.Event.register("ListTiquJiangliInfo", this, "OnListYuJiangliInfo");
        //KBEngine.Event.register("JiangliList", this, "OnJiangliList");
        KBEngine.Event.register("GetChiefAgentList", this, "OnGetChiefAgentList");
        KBEngine.Event.register("onAccountCommand", this, "onAccountCommand");
        KBEngine.Event.register("set_jiangli", this, "set_jiangli"); //总裁未提取
        KBEngine.Event.register("GetSupperAgentList", this, "OnGetSupperAgentList");
        KBEngine.Event.register("ListPlayerProxyInfo", this, "OnListPlayerProxyInfo");
        KBEngine.Event.register("ListAllocJiangliInfo", this, "OnListAllocJiangliInfo");
        KBEngine.Event.register("ListProxyHongliByDate", this, "OnListProxyHongliByDate");

        KBEngine.Event.register("ChuanXiaoPlayerTodayTaxRecord", this, "OnChuanXiaoPlayerTodayTaxRecord"); //今日
        KBEngine.Event.register("ChuanXiaoPlayerTotalTaxRecord", this, "OnChuanXiaoPlayerTotalTaxRecord"); //累计

        KBEngine.Event.register("GetLoseJiangliByDate", this, "GetLoseJiangliByDate");

        this.scrollHuodongHistory = Tool.GetChild(this.node,"活动详细记录/列表").getComponent(ScrollViewEx);
        this.scrollHuodongHistory.callBackFresh = this.GetHuoDongHistory.bind(this);

        this.scrollJiangliHistory = Tool.GetChild(this.node,"奖励提取详细记录/列表").getComponent(ScrollViewEx);
        this.scrollJiangliHistory.callBackFresh = this.GetJiangliHistory.bind(this);

        this.scrollZongcaiList = Tool.GetChild(this.node,"我的伙伴/伙伴列表").getComponent(ScrollViewEx);
        this.scrollZongcaiList.callBackFresh = this.GetZhongCaiList.bind(this);

        this.scrollHehuorenList = Tool.GetChild(this.node,"合伙人/合伙人列表").getComponent(ScrollViewEx);
        this.scrollHehuorenList.callBackFresh = this.GetHehuorenList.bind(this);

        this.scrollMengzhuList = Tool.GetChild(this.node,"盟主/盟主列表").getComponent(ScrollViewEx);
        this.scrollMengzhuList.callBackFresh = this.GetProxyList.bind(this);

        this.scrollFenxi = Tool.GetChild(this.node,"数据分析/列表").getComponent(ScrollViewEx);
        this.scrollFenxi.callBackFresh = this.GetDataFenxiAll.bind(this);

        this.scrollToday = Tool.GetChild(this.node,"今日详情/列表").getComponent(ScrollViewEx);
        this.scrollToday.callBackFresh = this.GetTodayList.bind(this);

        this.node.on(cc.Node.EventType.TOUCH_START,()=>{
            let arrayTemp = this.node.children;
            for(let item of arrayTemp)
            {
                if(item.name === "董事长" || item.name === "总裁")
                    continue;
                item.active = false;
            }
        },this);
    }

    start () {

        this.role = GameDataManager.getAccount().role;
        if(this.role == "董事长")
        {
            this.node.getChildByName("董事长").active = true;
            this.node.getChildByName("总裁").active = false;
            this.GetTotalJiangli();
        }
        else if(this.role == "总裁" || cc.sys.isBrowser)
        {
            this.node.getChildByName("董事长").active = false;
            this.node.getChildByName("总裁").active = true;
            this.set_jiangli();
        }
        else
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"权限不足操作失败！")
            UIManager.getInstance().closePanelByName(this.node.name);
            return;
        }

        this.GetTodayJiangli(); //查询今日奖励
        this.GetHuoDongGold();
    }

    // update (dt) {}

    public onButtonClick(button:cc.Button)
    {
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
        else if(button.node.name === "活动充值")
        {
            this.node.getChildByName("活动充值").active = true;
            Tool.GetChild(this.node,"活动充值/bk/gold").getComponent(cc.Label).string = GameDataManager.getAccount().gold;
            Tool.GetChild(this.node,"活动充值/bk/金额").getComponent(cc.EditBox).string = "";
        }
        else if(button.node.name === "确认充值活动金币")
        {
            let strNum = button.node.parent.getChildByName("金额").getComponent(cc.EditBox).string;
            
            if(strNum == "" || Number(strNum)<=0)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入正确的金额!");
                return;
            }
            
            if(Number(strNum)>GameDataManager.getAccount().gold)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"余额不足！")
                return;
            }

            this.node.getChildByName("活动充值").active = false;

            let strParam:string = "{\"header\":\"充值_老板_共享金币\",\"money\":"+strNum+"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@充值_老板_共享金币");            
        }
        else if(button.node.name === "活动记录")
        {
            this.node.getChildByName("活动详细记录").active = true;
            this.GetHuoDongHistory();
        }
        else if(button.node.name === "分配昨日")
        {
            this.node.getChildByName("分配昨日奖励面板").active = true;
        }
        else if(button.node.name === "确认分配昨日奖励")
        {
            this.node.getChildByName("分配昨日奖励面板").active = false;
            let strParam:string = "{\"header\":\"分配_按天_剩余总奖励\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@分配_按天_剩余总奖励");  
        }
        else if(button.node.name === "扣除奖励")
        {
            this.node.getChildByName("扣除奖励").active = true;
            Tool.GetChild(this.node,"扣除奖励/bk/gold").getComponent(cc.Label).string = Tool.GetChild(this.node,"董事长/昨日总奖励/num").getComponent(cc.Label).string;
            Tool.GetChild(this.node,"扣除奖励/bk/金额").getComponent(cc.EditBox).string = "";
        }
        else if(button.node.name === "确认扣除活动金币")
        {
            let check = Tool.GetChild(this.node,"董事长/昨日总奖励/num").getComponent(cc.Label).string;
            let strNum = button.node.parent.getChildByName("金额").getComponent(cc.EditBox).string;

            if(strNum === "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"金额不能为空！")
                return;
            }

            if(Number(strNum)>Number(check))
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"余额不足！")
                return;
            }

            this.node.getChildByName("扣除奖励").active = false;

            let strParam:string = "{\"header\":\"扣除_按天_剩余总奖励\",\"money\":"+strNum+"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@扣除_按天_剩余总奖励");
        }
        else if(button.node.name === "奖励记录")
        {
            this.node.getChildByName("奖励提取详细记录").active = true;
            this.GetJiangliHistory();
        }
        else if(button.node.name === "我的伙伴")
        {
            this.node.getChildByName("我的伙伴").active = true;
            this.GetZhongCaiList();
        }
        else if(button.node.name === "添加伙伴")
        {
            let strID = button.node.parent.getChildByName("用户id").getComponent(cc.EditBox).string;
            if(strID.length != 6)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"用户ID不正确")
                return;
            }
            let strParam = "{\"header\":\"设置_玩家_属性\",\"target_guuid\":\"" + strID + "\",\"chief_agentid\":\""+strID+"\"}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "P@设置_玩家_属性_总裁");

            button.node.parent.getChildByName("用户id").getComponent(cc.EditBox).string = "";
        }
        else if(button.node.name === "数据分析")
        {
            this.node.getChildByName("数据分析").active = true;
            this.GetDataFenxiSelf();
            this.GetDataFenxiAll();
            this.GetKouchuTotleToday();
            this.GetKouchuTotleYestoday();
        }
        else if(button.node.name === "提取奖励")
        {
            if(Number(GameDataManager.getAccount().jiangli)<=0)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"奖励余额不足！")
                return;
            }

            let strParam:string = "{\"header\":\"提取_玩家_奖励\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@提取_玩家_奖励");   
        }
        else if(button.node.name === "合伙人")
        {
            this.node.getChildByName("合伙人").active = true;
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

            button.node.parent.getChildByName("用户id").getComponent(cc.EditBox).string = "";
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
        else if(button.node.name === "盟主")
        {
            this.node.getChildByName("盟主").active = true;
            this.GetProxyList();
        }
        else if(button.node.name === "授权盟主")
        {
            let strID = button.node.parent.getChildByName("id").getComponent(cc.Label).string;
            let strName = button.node.parent.getChildByName("name").getComponent(cc.Label).string;

            this.node.getChildByName("添加盟主面板").active = true;
            Tool.GetChild(this.node,"添加盟主面板/bk/msg").getComponent(cc.Label).string = "是否确认将以下玩家添加为盟主?\r\n\r\n" + strName + "[" + strID + "]";
            Tool.GetChild(this.node,"添加盟主面板/bk/id").getComponent(cc.Label).string = strID;
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

            let strParam = "{\"header\":\"设置_玩家_属性\",\"target_guuid\":\"" + strID + "\",\"big_agentid\":\"" + strID + "\"}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "P@设置_玩家_属性_盟主");
        }
        else if(button.node.name === "今日详情")
        {
            this.node.getChildByName("今日详情").active = true;
            this.GetTodayList()
        }
        else if(button.node.name === "总裁收益")
        {
            this.node.getChildByName("总裁收益").active = true;
            //this.GetYejiTodayTotlle(101,"总裁");
            //this.GetYejiAlllTotlle(101, "总裁");
            this.GetDataFenxiSelfToday();
            this.GetDataFenxiSelfAll();
        }
        else if(button.node.name === "查询详情")
        {
            let strRoomID = button.node.parent.getChildByName("房间号").getComponent(cc.EditBox).string;
            if(strRoomID == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入房间号");                
                return;
            }
            let strParam = "{\"header\":\"查询_按天_代理红利\",\"room_id\":\""+strRoomID+"\",\"date\":\"\",\"page\":\"0\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_所有_区域代理");
        }
    }

    public onToggleClick(toggle:cc.Toggle)
    {
        if(toggle.node.parent.name === "条件")
        {
            this.GetTodayList();
            Tool.GetChild(this.node,"今日详情/统计/总局数").getComponent(cc.Label).string = "";
            Tool.GetChild(this.node,"今日详情/统计/总红利").getComponent(cc.Label).string = "";
            this.strTodayRounds = "";
            this.strTodayAll = "";
        }
    }

    public GetHuoDongGold()
    {
        let strParam:string = "{\"header\":\"查询_老板_共享金币\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_老板_共享金币");
    }
    public GetHuoDongHistory(nPage:number = 0)
    {
        let strParam:string = "{\"header\":\"查询_共享金币_详细记录\",\"page\":\"" + nPage.toString() + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_共享金币_详细记录");
    }
    public GetTotalJiangli()
    {
        let strParam:string = "{\"header\":\"查询_按天_剩余总奖励\"}";//date 0  -1
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_按天_剩余总奖励"); 
    }
    //查询今日奖励
    public GetTodayJiangli()
    {
        let strParam:string = "{\"header\":\"查询_按天_剩余总奖励\",\"date\":\"0\"}";//date 0  -1
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_按天_今日奖励"); 
    }
    public GetJiangliHistory(nPage:number = 0)
    {
        //if(GameDataManager.getAccount().role === "董事长")
        //{
            let strParam:string = "{\"header\":\"查询_剩余总奖励_详细记录\",\"page\":\"" + nPage.toString() + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_剩余总奖励_详细记录"); 
        // }
        // else if(GameDataManager.getAccount().role === "总裁")
        // {
        //     let strParam:string = "{\"header\":\"查询_提取奖励_记录\",\"page\":\"" + nPage.toString() + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        //     GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_提取奖励_记录"); 
        // }
    }

    //查询总裁
    public GetZhongCaiList(nPage:number = 0)
    {
        let strParam = "{\"header\":\"查询_所有_总裁\",\"page\":\"" + nPage.toString() + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_所有_总裁");
    }

    //总裁个人奖励
    public set_jiangli(old=null)
    {
        Tool.GetChild(this.node,"总裁/总的奖励/num").getComponent(cc.Label).string = GameDataManager.getAccount().jiangli;
    }

    //查询合伙人
    public GetHehuorenList(nPage:number = 0)
    {
        let strParam = "{\"header\":\"查询_所有_合伙人\",\"user_id\":\""+GameDataManager.getAccount().guuid+"\",\"page\":\"" + nPage.toString() + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_所有_合伙人");
    }
    //盟主列表
    public GetMengzhuList(nPage:number = 0)
    {               
        let strParam = "{\"header\":\"查询_所有_区域代理\",\"page\":\"" + nPage + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_所有_区域代理");
    }
    //代理列表
    public GetProxyList(nPage:number = 0)
    {
        let strParam = "{\"header\":\"查询_玩家_代理列表\",\"user_id\":\"" + GameDataManager.getAccount().guuid + "\",\"page\":\"" + nPage + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_玩家_代理列表");
    }

    public GetTodayList(nPage:number = 0)
    {
        let arrayTemp = Tool.GetChild(this.node,"今日详情/条件").getComponent(cc.ToggleContainer).toggleItems;
        let strName = "0";
        for(let item of arrayTemp)
        {
            if(item.isChecked)
            {
                strName = item.node.name;
                break;
            }
        }
        let strParam = "{\"header\":\"查询_按天_代理红利\",\"date\":\""+strName+"\",\"page\":\"" + nPage + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_所有_区域代理");
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

        
    public onHallCommand(nCode:number, param:string)
    {
        if(param.indexOf("充值_老板_共享金币")>=0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "充值成功！"); 
                this.GetHuoDongGold();               
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("分配_按天_剩余总奖励")>=0 || param.indexOf("扣除_按天_剩余总奖励")>=0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "操作成功！"); 
                this.GetTotalJiangli();      
                if(param.indexOf("扣除_按天_剩余总奖励")>=0)
                {
                    this.GetHuoDongGold();
                }         
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("提取_玩家_奖励")>=0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "操作成功！");   
                this.set_jiangli();          
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
    }
    public onAccountCommand(nCode:number, param:string)
    {
        if(param.indexOf("设置_玩家_属性")>=0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "操作成功！"); 
                if(param.indexOf("总裁")>=0)
                {
                    this.scheduleOnce(()=>{
                        this.GetZhongCaiList();
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
                else if(param.indexOf("盟主")>=0)
                {
                    this.scheduleOnce(()=>{
                        this.GetProxyList(this.scrollMengzhuList.nCurPage);
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
    }

    public DelayAction(action:Function,time:number)
    {
        this.scheduleOnce(()=>{
            action();
        },time);
    }

    public OnGetBossShareGold(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        if(data == null)
            return;
        let item = data["GetBossShareGold"];
        if(item != null && item.length>0)
        {
            let find = item[0];
            let gold:string = find["share_gold"];
            gold = gold.replace('-',':');
            Tool.GetChild(this.node,"董事长/活动奖励/num").getComponent(cc.Label).string = gold;
            Tool.GetChild(this.node,"总裁/活动奖励/num").getComponent(cc.Label).string = gold;
        }
    }
    public OnGetYuJiangliByDate(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        if(data == null)
            return;
        let item = data["GetYuJiangliByDate"];
        if(item != null && item.length>0)
        {
            let find = item[0];
            let gold = find["jiangli_number"];
            if(strMsg.indexOf("查询_按天_今日奖励")>=0)
            {
                Tool.GetChild(this.node,"董事长/今日总奖励/num").getComponent(cc.Label).string  = gold; 
                Tool.GetChild(this.node,"总裁/今日总奖励/num").getComponent(cc.Label).string  = gold; 
            }
            else //昨日
            {
                gold = gold.replace('-',':');
                Tool.GetChild(this.node,"董事长/昨日总奖励/num").getComponent(cc.Label).string  = gold;  
            }
          
        }
    }
    //更新活动详细记录列表
    public OnListBossShareGoldInfo(strMsg:string)
    {
        this.scrollHuodongHistory.UpdateList(strMsg,"ListBossShareGoldInfo","活动详细记录对象",this.PAGE_PER_COUNT,this.setHuoDongHistoryItem.bind(this));
    }
    public setHuoDongHistoryItem(node:cc.Node,jItem:any)
    { //option_type
        node.active = true;
        node.getChildByName("id").getComponent(cc.Label).string = jItem["remark2"];
        node.getChildByName("name").getComponent(cc.Label).string = jItem["remark1"];
        node.getChildByName("count").getComponent(cc.Label).string = jItem["add_money"];
        node.getChildByName("time").getComponent(cc.Label).string = jItem["date"];
        node.getChildByName("type").getComponent(cc.Label).string = jItem["option_type"];
    }
    //更新奖励提取详细记录
    public OnListYuJiangliInfo(strMsg:string)
    {
        this.scrollJiangliHistory.UpdateList(strMsg,"ListYuJiangliInfo","活动详细记录对象",this.PAGE_PER_COUNT,this.setJiangliHistoryItem.bind(this));
    }
    public setJiangliHistoryItem(node:cc.Node,jItem:any)
    {
        node.active = true;
        node.getChildByName("id").getComponent(cc.Label).string = jItem["user_guuid"];
        node.getChildByName("name").getComponent(cc.Label).string = jItem["user_name"];
        node.getChildByName("count").getComponent(cc.Label).string = jItem["add_money"];
        node.getChildByName("time").getComponent(cc.Label).string = jItem["date"];
        node.getChildByName("type").getComponent(cc.Label).string = jItem["option_type"];
    }
    //更新总裁列表
    public OnGetChiefAgentList(strMsg:string)
    {
        this.scrollZongcaiList.UpdateList(strMsg,"GetChiefAgentList","伙伴对象",this.PAGE_PER_COUNT,this.setChiefAgentItem.bind(this));
    }
    public setChiefAgentItem(node:cc.Node,jItem:any)
    {
        node.active = true;

        node.getChildByName("id").getComponent(cc.Label).string = jItem["guuid"];
        node.getChildByName("name").getComponent(cc.Label).string = jItem["name"];
        node.getChildByName("count").getComponent(cc.Label).string = jItem["xiaji_count"];
        node.getChildByName("type").getComponent(cc.Label).string = "总裁";
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
    //更新盟主列表
    public OnListPlayerProxyInfo(strMsg:string)
    {
        this.scrollMengzhuList.UpdateList(strMsg,"ListPlayerProxyInfo","盟主对象",this.PAGE_PER_COUNT,this.setMengzhuItem.bind(this));
    }
    public setMengzhuItem(node:cc.Node,jItem:any)
    {
        node.active = true;
        node.getChildByName("id").getComponent(cc.Label).string = jItem["user_id"];
        node.getChildByName("name").getComponent(cc.Label).string = jItem["user_name"];
        node.getChildByName("玩家数").getComponent(cc.Label).string = jItem["all_lower_count"];

        if(jItem["big_agentid"] === jItem["user_id"])
        {
            node.getChildByName("type").getComponent(cc.Label).string = "盟主";
            node.getChildByName("授权盟主").active = false;
        }
        else
        {
            node.getChildByName("type").getComponent(cc.Label).string = "";
            node.getChildByName("授权盟主").active = true;
            let btn = node.getChildByName("授权盟主").getComponent(cc.Button);
            btn.node.targetOff(this);
            btn.node.on("click",()=>{
                this.onButtonClick(btn);
            },this);
        }
    }
    //查询数据分析
    public GetDataFenxiSelf(nPage:number = 0)
    {
        let strParam:string = "{\"header\":\"查询_分配总奖励_详细记录\",\"is_self\":1,\"page\":\"" + nPage.toString() + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\",\"context\":\"查询_分配总奖励_详细记录_自己\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_分配总奖励_详细记录_自己"); 
    }
    //查询自己今日奖励
    public GetDataFenxiSelfToday(nPage:number = 0)
    {
        let strParam:string = "{\"header\":\"查询_分配总奖励_详细记录\",\"date\":\"0\",\"is_self\":1,\"page\":\"" + nPage.toString() + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\",\"context\":\"查询_总裁今日收益\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_总裁今日收益"); 
    }
    //查询自己所有奖励
    public GetDataFenxiSelfAll(nPage:number = 0)
    {
        let strParam:string = "{\"header\":\"查询_分配总奖励_详细记录\",\"is_all_day\":\"1\",\"is_self\":1,\"page\":\"" + nPage.toString() + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\",\"context\":\"查询_总裁累计收益\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_总裁累计收益"); 
    }

    public GetDataFenxiAll(nPage:number = 0)
    {
        let strParam:string = "{\"header\":\"查询_分配总奖励_详细记录\",\"is_self\":0,\"page\":\"" + nPage.toString() + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\",\"context\":\"查询_分配总奖励_详细记录_所有人\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_分配总奖励_详细记录_所有人"); 
    }
    public OnListAllocJiangliInfo(strMsg:string)
    {
        if(strMsg.indexOf("查询_分配总奖励_详细记录_自己")>=0)
        {
            let data = JSON.parse(strMsg);
            let item = data["ListAllocJiangliInfo"][0];

            Tool.GetChild(this.node,"数据分析/红利数据/昨日我的红利").getComponent(cc.Label).string = item["my_jiangli"];
            Tool.GetChild(this.node,"数据分析/红利数据/昨日总红利").getComponent(cc.Label).string = item["all_jiangli"];
        }
        else if(strMsg.indexOf("查询_总裁今日收益")>=0)
        {
            let data = JSON.parse(strMsg);
            let item = data["ListAllocJiangliInfo"][0];

            Tool.GetChild(this.node,"总裁收益/bk/今日收益").getComponent(cc.Label).string = item["my_jiangli"];
        }
        else if(strMsg.indexOf("查询_总裁累计收益")>=0)
        {
            let data = JSON.parse(strMsg);
            let item = data["ListAllocJiangliInfo"][0];

            Tool.GetChild(this.node,"总裁收益/bk/累计收益").getComponent(cc.Label).string = item["my_jiangli"];
        }
        else
        {
            this.scrollFenxi.UpdateList(strMsg,"ListAllocJiangliInfo","伙伴红利分配对象",this.PAGE_PER_COUNT,this.setDataFenxiItem.bind(this));
        }
    }
    public setDataFenxiItem(node:cc.Node,jItem:any)
    {
        node.active = true;

        node.getChildByName("id").getComponent(cc.Label).string = jItem["user_id"];
        node.getChildByName("name").getComponent(cc.Label).string = jItem["user_name"];
        node.getChildByName("name").getComponent(cc.Label).string = jItem["user_name"];
        node.getChildByName("per").getComponent(cc.Label).string = Number(jItem["alloc_bili"])/100 +"%";
        node.getChildByName("selftotle").getComponent(cc.Label).string = jItem["one_jiangli"];
        node.getChildByName("hongli").getComponent(cc.Label).string = jItem["my_jiangli"];
    }
    //刷新今日详情
    public OnListProxyHongliByDate(strMsg:string)
    {
        this.scrollToday.UpdateList(strMsg,"ListProxyHongliByDate","战绩红利对象",this.PAGE_PER_COUNT,this.setTodayItem.bind(this));

        this.scheduleOnce(()=>{
            Tool.GetChild(this.node,"今日详情/统计/总局数").getComponent(cc.Label).string = this.strTodayRounds;
            Tool.GetChild(this.node,"今日详情/统计/总红利").getComponent(cc.Label).string = this.strTodayAll;
        },0.2);
    }
    private strTodayRounds = "";
    private strTodayAll = "";
    public setTodayItem(node:cc.Node,jItem:any)
    {
        node.active = true;
        node.getChildByName("房间号").getComponent(cc.Label).string = jItem["room_id"];
        node.getChildByName("底皮").getComponent(cc.Label).string = jItem["dipi_times"];
        node.getChildByName("输赢").getComponent(cc.Label).string = jItem["win_score"];
        node.getChildByName("红利").getComponent(cc.Label).string = jItem["proxy_hongli"];

        this.strTodayRounds = jItem["rounds"];
        this.strTodayAll = jItem["all_hongli"];
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
        if (strMsg.indexOf("总裁") >= 0)
        {
            Tool.GetChild(this.node,"总裁收益/bk/今日收益").getComponent(cc.Label).string = upper_today_income;            
        }
         
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


        if (strMsg.indexOf("总裁") >= 0)
        {
            Tool.GetChild(this.node,"总裁收益/bk/累计收益").getComponent(cc.Label).string = upper_total_income;            
        }     

    }
    public GetKouchuTotleToday()
    {
        Tool.GetChild(this.node,"数据分析/红利数据/昨日我的红利").getComponent(cc.Label).string = "0";
        Tool.GetChild(this.node,"数据分析/红利数据/昨日总红利").getComponent(cc.Label).string = "0";
        
        Tool.GetChild(this.node,"数据分析/红利数据/今日奖金抵扣").getComponent(cc.Label).string = "0";
        let strParam:string = "{\"header\":\"查询_按天_扣除总奖励\",\"date\":\"0\",\"context\":\"查询_按天_扣除总奖励\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_按天_扣除总奖励_今日");      
    }
    public GetKouchuTotleYestoday()
    {
        Tool.GetChild(this.node,"数据分析/红利数据/昨日奖金抵扣").getComponent(cc.Label).string = "0";
        let strParam:string = "{\"header\":\"查询_按天_扣除总奖励\",\"date\":\"-1\",\"context\":\"查询_按天_扣除总奖励_昨日\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_按天_扣除总奖励_昨日");      
    }
    public GetLoseJiangliByDate(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        if (data == null)
        {
            Debug.Error("json格式异常！");
            return;
        }
        let context = data["context"];
        let msg = data["GetLoseJiangliByDate"];
        if(msg.length<=0)
            return;
        let totle = msg[0]["total_jiangli"];
        if(context == "查询_按天_扣除总奖励_今日")
        {
            Tool.GetChild(this.node,"数据分析/红利数据/今日奖金抵扣").getComponent(cc.Label).string = totle;
        }
        else if(context == "查询_按天_扣除总奖励_昨日")
        {
            Tool.GetChild(this.node,"数据分析/红利数据/昨日奖金抵扣").getComponent(cc.Label).string = totle;
        }
    }
}
