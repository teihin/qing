import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import { ShowPanelMode } from "../common/GameDef";
import Tool from "../common/Tool";
import ScrollViewEx from "../common/ScrollViewEx";
import GameDataManager from "../GameDataManager";
import ConfigManager from "../logic/ConfigManager";
import Debug from "../common/Debug";
import ScrollViewNoEnd from "../common/ScrollViewNoEnd";
import scrollview2 from "../common/scrollview2";

var KBEngine = require("kbengine");
const {ccclass, property} = cc._decorator;

@ccclass
export default class panelPaihangbang extends UIPanelViewBase {

    private PAGE_PER_COUNT:number = 30;
    private scrollShoushu:ScrollViewNoEnd = null; //手数榜
    private scrollShoushuEx:scrollview2 = null
    private dtLast_Shoushu:number = new Date().getTime()-10000;


    
    private scrollWin:ScrollViewEx = null; //赢分榜

    private scrollHongli:ScrollViewNoEnd = null; //红利榜
    private scrollHongliEx:scrollview2 = null
    private dtLast_Hongli:number = new Date().getTime()-10000;
    

    onLoad () {
        super.onLoad();

        KBEngine.Event.register("ListActivityPlayedcount", this, "OnListActivityPlayedcount");
        KBEngine.Event.register("ListActivitySelfPlayedcount", this, "OnListActivitySelfPlayedcount");

        KBEngine.Event.register("ListActivityUserScore", this, "OnListActivityUserScore");
        KBEngine.Event.register("ListActivitySelfUserScore", this, "OnListActivitySelfUserScore");

        KBEngine.Event.register("ListActivityProxyHongli", this, "ListActivityProxyHongli");
        KBEngine.Event.register("ListActivitySelfProxyHongli", this, "ListActivitySelfProxyHongli");

        KBEngine.Event.register("UserHashInfo",this, "OnUserHashInfo");
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");

        
        this.scrollShoushu = Tool.GetChild(this.node,"容器/玩家手数榜/列表").getComponent(ScrollViewNoEnd);
        this.scrollShoushuEx = this.scrollShoushu.getComponent(scrollview2);
        this.scrollShoushuEx.InitScrollInfo(this,(nPage:number)=>{
            this.GetShouShuList(nPage);
        });



        this.scrollWin = Tool.GetChild(this.node,"容器/玩家赢分榜/列表").getComponent(ScrollViewEx);
        this.scrollWin.callBackFresh = this.GetWinList.bind(this);

        this.scrollHongli = Tool.GetChild(this.node,"容器/代理红利榜/列表").getComponent(ScrollViewNoEnd);
        this.scrollHongliEx = this.scrollHongli.getComponent(scrollview2);
        this.scrollHongliEx.InitScrollInfo(this,(nPage:number)=>{
            this.GetHongliList(nPage);
        });
    }

    start () {


    }
    onEnable(){
        //默认显示手数榜
        let toggle = Tool.GetChild(this.node,"条件/玩家手数榜").getComponent(cc.Toggle);
        this.onToggleClick(toggle);
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
        else if(button.node.name === "客服")
        {
            UIManager.getInstance().showPanel("panelKefu",ShowPanelMode.Cover);            
        }
        else if(button.node.name === "领取奖励")
        {
            let arrayToggle = Tool.GetChild(this.node,"条件").getComponentsInChildren(cc.Toggle);
            let strName = "";
            for(let item of arrayToggle)
            {
                if(item.isChecked)
                {
                    strName = item.node.name;
                    break;
                }
            }
            if(strName == "玩家手数榜")
            {
                this.LingquShoushu();
            }
            else if(strName == "玩家赢分榜")    
            {
                this.LingquWin();
            }
            else if(strName == "代理红利榜")
            {
                this.LingquHongli();
            }
        }
        
    }

    public onToggleClick(toggle:cc.Toggle)
    {
        if(toggle.node.name === "玩家手数榜")
        {
            this.SwitchTab(toggle.node.name);
            this.GetShouShuList();
            ConfigManager.getInstance().GetOneHashKey("活动文本_玩家手数榜","活动文本_玩家手数榜");

            Tool.GetChild(this.node,"广告/开始时间").getComponent(cc.Label).string = "-";
            Tool.GetChild(this.node,"广告/结束时间").getComponent(cc.Label).string = "-";
            Tool.GetChild(this.node,"广告/我的信息").getComponent(cc.Label).string = "";
            Tool.GetChild(this.node,"广告/领取奖励").active = false;
            Tool.GetChild(this.node,"广告/已领取").active = false;
        }
        else if(toggle.node.name === "玩家赢分榜")
        {
            this.SwitchTab(toggle.node.name);
            this.GetWinList();
            ConfigManager.getInstance().GetOneHashKey("活动文本_玩家赢分榜","活动文本_玩家赢分榜");

            Tool.GetChild(this.node,"广告/开始时间").getComponent(cc.Label).string = "-";
            Tool.GetChild(this.node,"广告/结束时间").getComponent(cc.Label).string = "-";
            Tool.GetChild(this.node,"广告/我的信息").getComponent(cc.Label).string = "";
            Tool.GetChild(this.node,"广告/领取奖励").active = false;
            Tool.GetChild(this.node,"广告/已领取").active = false;
        }
        else if(toggle.node.name === "代理红利榜")
        {
            this.SwitchTab(toggle.node.name);
            this.GetHongliList();
            ConfigManager.getInstance().GetOneHashKey("活动文本_代理红利榜","活动文本_代理红利榜");

            Tool.GetChild(this.node,"广告/开始时间").getComponent(cc.Label).string = "-";
            Tool.GetChild(this.node,"广告/结束时间").getComponent(cc.Label).string = "-";
            Tool.GetChild(this.node,"广告/我的信息").getComponent(cc.Label).string = "";
            Tool.GetChild(this.node,"广告/领取奖励").active = false;
            Tool.GetChild(this.node,"广告/已领取").active = false;
        }
        else if(toggle.node.parent.name === "选择手数")
        {
            if(toggle.isChecked)
            {
                this.GetShouShuList(0,true);
            }
        }

    }
    public SwitchTab(strName:string)
    {
        let arrayTemp = this.node.getChildByName("容器").children;
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
    }

    //查询活动手数榜
    public GetShouShuList(nPage:number = 0,bFouce:boolean = false)
    {
        let span = new Date().getTime()-this.dtLast_Shoushu;
        if(span<1000 && !bFouce)
        {
            return;
        }
        this.dtLast_Shoushu = new Date().getTime();

        let arrayAll = Tool.GetChild(this.node,"容器/玩家手数榜/选择手数").getComponentsInChildren(cc.Toggle);
        let strType = "全";
        for(let one of arrayAll)
        {
            if(one.isChecked)
            {
                strType = one.node.name;
            }
        }


        
        let strParam = "{\"header\":\"查询_活动_玩家手数\",\"is_zip_result\":\"0\",\"play_type\":\""+strType+"\",\"page\":\"" + nPage + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_活动_玩家手数");

        if(nPage == 0)
            this.GetShouShuSelf();
    }
    public GetShouShuSelf(nPage:number = 0)
    {
        let arrayAll = Tool.GetChild(this.node,"容器/玩家手数榜/选择手数").getComponentsInChildren(cc.Toggle);
        let strType = "全";
        for(let one of arrayAll)
        {
            if(one.isChecked)
            {
                strType = one.node.name;
            }
        }
        let strParam = "{\"header\":\"查询_活动_自己手数\",\"play_type\":\""+strType+"\",\"page\":\"" + nPage + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_活动_自己手数");

        Tool.GetChild(this.node,"广告/我的信息").getComponent(cc.Label).string = "";
    }
    public LingquShoushu(nPage:number = 0)
    {
        let arrayAll = Tool.GetChild(this.node,"容器/玩家手数榜/选择手数").getComponentsInChildren(cc.Toggle);
        let strType = "全";
        for(let one of arrayAll)
        {
            if(one.isChecked)
            {
                strType = one.node.name;
            }
        }
        let strParam = "{\"header\":\"领取_活动_自己手数\",\"play_type\":\""+strType+"\",\"page\":\"" + nPage + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@领取_活动_自己手数");
    }
    //刷新手数榜
    public OnListActivityPlayedcount(strMsg:string)
    {
        //this.scrollShoushu.UpdateList(strMsg,"ListActivityPlayedcount","排行榜对象",this.PAGE_PER_COUNT,this.setShoushuItem.bind(this));
        let data = JSON.parse(strMsg);
        if(data == null)
        {
            Debug.Log("解析OnClubRoomInfo内容失败！");
            return;
        }

        this.scrollShoushuEx.UpdateList(strMsg,"ListActivityPlayedcount");

        //更新开始结束时间
        //let data = JSON.parse(strMsg);
        let strStart = data["start_date"];
        let strEnd = data["end_date"];
        Tool.GetChild(this.node,"广告/开始时间").getComponent(cc.Label).string = strStart == ""?"":""+strStart;
        Tool.GetChild(this.node,"广告/结束时间").getComponent(cc.Label).string = strStart == ""?"":""+strEnd;
    }
    public setShoushuItem(node:cc.Node,jItem:any)
    {
        node.active = true;
        node.getChildByName("idx").getComponent(cc.Label).string = jItem["user_no"];
        node.getChildByName("name").getComponent(cc.Label).string = jItem["user_name"]+"\r\n"+jItem["user_guuid"];
        node.getChildByName("played_count").getComponent(cc.Label).string = jItem["activity_num"];
        node.getChildByName("user_reward").getComponent(cc.Label).string = jItem["user_reward"];
    }
    //更新我的手数
    public OnListActivitySelfPlayedcount(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        if(data == null)
            return;
        if(data.hasOwnProperty("ListActivitySelfPlayedcount"))
        {
            let item = data["ListActivitySelfPlayedcount"];
            if(item.length>0)
            {
                let one = item[0];

                let strPaiMing = one["user_no"];
                if(strPaiMing == "" || strPaiMing == "0")
                {
                    strPaiMing = "未上榜";
                }


                Tool.GetChild(this.node,"广告/我的信息").getComponent(cc.Label).string = "有效手数:"+one["activity_num"]+ "    当前排名:"+strPaiMing +(one["user_reward"]=="0"?"":("    (奖励:"+one["user_reward"]+")")) ;
                
                Tool.GetChild(this.node,"广告/已领取").active = Number(one["lingqu_count"])>0?true:false;
                Tool.GetChild(this.node,"广告/领取奖励").active = (one["lingqu_on"]=="True"&&one["is_reward"]=="True"&& Number(one["lingqu_count"])<=0)?true:false;
            }
        }

        let strStart = data["start_date"];
        let strEnd = data["end_date"];
        Tool.GetChild(this.node,"广告/开始时间").getComponent(cc.Label).string = strStart == ""?"":""+strStart;
        Tool.GetChild(this.node,"广告/结束时间").getComponent(cc.Label).string = strStart == ""?"":""+strEnd;
    }
    //查询赢分榜
    public GetWinList(nPage:number = 0)
    {
        let strParam = "{\"header\":\"查询_活动_玩家输赢\",\"page\":\"" + nPage + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_活动_玩家输赢");

        if(nPage == 0)
            this.GetWinSelf();
    }
    public GetWinSelf(nPage:number = 0)
    {
        let strParam = "{\"header\":\"查询_活动_自己输赢\",\"page\":\"" + nPage + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_活动_自己输赢");

        Tool.GetChild(this.node,"广告/我的信息").getComponent(cc.Label).string = "";
    }
    public LingquWin(nPage:number = 0)
    {
        let strParam = "{\"header\":\"领取_活动_自己输赢\",\"page\":\"" + nPage + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@领取_活动_自己输赢");

        
    }
    //刷新赢分榜
    public OnListActivityUserScore(strMsg:string)
    {
        this.scrollWin.UpdateList(strMsg,"ListActivityUserScore","排行榜对象",this.PAGE_PER_COUNT,this.setWinItem.bind(this));

        //更新开始结束时间
        let data = JSON.parse(strMsg);
        let strStart = data["start_date"];
        let strEnd = data["end_date"];
        Tool.GetChild(this.node,"广告/开始时间").getComponent(cc.Label).string = strStart == ""?"":""+strStart;
        Tool.GetChild(this.node,"广告/结束时间").getComponent(cc.Label).string = strStart == ""?"":""+strEnd;
    }
    public setWinItem(node:cc.Node,jItem:any)
    {
        node.active = true;
        node.getChildByName("idx").getComponent(cc.Label).string = jItem["user_no"];
        node.getChildByName("name").getComponent(cc.Label).string = jItem["user_name"]+"\r\n"+jItem["user_guuid"];
        node.getChildByName("played_count").getComponent(cc.Label).string = jItem["activity_num"];
        node.getChildByName("user_reward").getComponent(cc.Label).string = jItem["user_reward"];
    }
    //更新我的赢分
    public OnListActivitySelfUserScore(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        if(data == null)
            return;
        if(data.hasOwnProperty("ListActivitySelfUserScore"))
        {
            let item = data["ListActivitySelfUserScore"];
            if(item.length>0)
            {
                let one = item[0];

                let strPaiMing = one["user_no"];
                let strWin:string = one["activity_num"];
                if(strPaiMing == "" || strPaiMing == "0" || strWin == "" || strWin == "0" || strWin.indexOf("-")>=0)
                {
                    strPaiMing = "未上榜";
                }

                Tool.GetChild(this.node,"广告/我的信息").getComponent(cc.Label).string = "我的赢分:"+one["activity_num"]+"    当前排名:"+strPaiMing +(one["user_reward"]=="0"?"":("    (奖励:"+one["user_reward"]+")"));
                Tool.GetChild(this.node,"广告/已领取").active = Number(one["lingqu_count"])>0?true:false;
                Tool.GetChild(this.node,"广告/领取奖励").active = (one["lingqu_on"]=="True"&&one["is_reward"]=="True"&& Number(one["lingqu_count"])<=0)?true:false;
            }
        }
        let strStart = data["start_date"];
        let strEnd = data["end_date"];
        Tool.GetChild(this.node,"广告/开始时间").getComponent(cc.Label).string = strStart == ""?"":""+strStart;
        Tool.GetChild(this.node,"广告/结束时间").getComponent(cc.Label).string = strStart == ""?"":""+strEnd;
    }

    public GetHongliList(nPage:number = 0,bFouce:boolean=false)
    {
        let span = new Date().getTime()-this.dtLast_Hongli;
        if(span<1000 && !bFouce)
        {
            return;
        }
        this.dtLast_Hongli = new Date().getTime();

        let strParam = "{\"header\":\"查询_活动_代理红利\",\"is_scale\":\"0\",\"is_self\":\"0\",\"page\":\"" + nPage + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_活动_代理红利");

        if(nPage == 0)
            this.GetHongliSelf();
    }
    public GetHongliSelf(nPage:number = 0)
    {
        let strParam = "{\"header\":\"查询_活动_自己红利\",\"page\":\"" + nPage + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_活动_自己红利");
        Tool.GetChild(this.node,"广告/我的信息").getComponent(cc.Label).string = "";
    }
    public LingquHongli(nPage:number = 0)
    {
        let strParam = "{\"header\":\"领取_活动_自己红利\",\"page\":\"" + nPage + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@领取_活动_自己红利");
    }
    public ListActivityProxyHongli(strMsg:string)
    {
        //this.scrollHongli.UpdateList(strMsg,"ListActivityProxyHongli","排行榜对象",this.PAGE_PER_COUNT,this.setHongliItem.bind(this));

        let data = JSON.parse(strMsg);
        if(data == null)
        {
            Debug.Log("解析OnClubRoomInfo内容失败！");
            return;
        }

        this.scrollHongliEx.UpdateList(strMsg,"ListActivityProxyHongli");

        //更新开始结束时间
        let strStart = data["start_date"];
        let strEnd = data["end_date"];
        Tool.GetChild(this.node,"广告/开始时间").getComponent(cc.Label).string = strStart == ""?"":""+strStart;
        Tool.GetChild(this.node,"广告/结束时间").getComponent(cc.Label).string = strStart == ""?"":""+strEnd;
    
    }
    public setHongliItem(node:cc.Node,jItem:any)
    {
        node.active = true;
        node.getChildByName("idx").getComponent(cc.Label).string = jItem["user_no"];
        node.getChildByName("name").getComponent(cc.Label).string = jItem["user_name"]+"\r\n"+jItem["user_guuid"];
        node.getChildByName("played_count").getComponent(cc.Label).string = jItem["activity_num"];
        node.getChildByName("user_reward").getComponent(cc.Label).string = jItem["user_reward"];
    }

    //更新我的红利
    public ListActivitySelfProxyHongli(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        if(data == null)
            return;
        if(data.hasOwnProperty("ListActivitySelfProxyHongli"))
        {
            let item = data["ListActivitySelfProxyHongli"];
            if(item.length>0)
            {
                let one = item[0];

                let strPaiMing = one["user_no"];
                let strWin:string = one["activity_num"];
                if(strPaiMing == "" || strPaiMing == "0" || strWin == "" || strWin == "0" || strWin.indexOf("-")>=0)
                {
                    strPaiMing = "未上榜";
                }

                Tool.GetChild(this.node,"广告/我的信息").getComponent(cc.Label).string = "我的红利:"+one["activity_num"]+"    当前排名:"+strPaiMing +(one["user_reward"]=="0"?"":("    (奖励:"+one["user_reward"]+")"));
                Tool.GetChild(this.node,"广告/已领取").active = Number(one["lingqu_count"])>0?true:false;
                Tool.GetChild(this.node,"广告/领取奖励").active = (one["lingqu_on"]=="True"&&one["is_reward"]=="True"&& Number(one["lingqu_count"])<=0)?true:false;
            }
        }
        let strStart = data["start_date"];
        let strEnd = data["end_date"];
        Tool.GetChild(this.node,"广告/开始时间").getComponent(cc.Label).string = strStart == ""?"":""+strStart;
        Tool.GetChild(this.node,"广告/结束时间").getComponent(cc.Label).string = strStart == ""?"":""+strEnd;
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
        if(context === "活动文本_玩家手数榜")
        {
            Tool.GetChild(this.node,"容器/玩家手数榜/文本/txt").getComponent(cc.Label).string = strContent;
        }
        else if(context === "活动文本_玩家赢分榜")
        {
            Tool.GetChild(this.node,"容器/玩家赢分榜/文本/txt").getComponent(cc.Label).string = strContent;
        }
        else if(context === "活动文本_代理红利榜")
        {
            Tool.GetChild(this.node,"容器/代理红利榜/文本/txt").getComponent(cc.Label).string = strContent;
        }
    }
    public onHallCommand(nCode:number, param:string)
    {
        if(param.indexOf("领取_活动_自己输赢") >=0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover,"操作成功！");
                this.scheduleOnce(()=>{
                    this.GetWinSelf();
                },0.3);
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("领取_活动_自己手数") >=0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover,"操作成功！");
                this.scheduleOnce(()=>{
                    this.GetShouShuSelf();
                },0.3);
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("领取_活动_自己红利") >=0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover,"操作成功！");
                this.scheduleOnce(()=>{
                    this.GetHongliSelf();
                },0.3);
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
    }
}
