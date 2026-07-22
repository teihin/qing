import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import ConfigManager from "../logic/ConfigManager";
import { ShowPanelMode, ClosePanelMode } from "../common/GameDef";
import GameDataManager from "../GameDataManager";
import Tool from "../common/Tool";
import Debug from "../common/Debug";
import ScrollViewEx from "../common/ScrollViewEx";

var KBEngine = require("kbengine");

const {ccclass, property} = cc._decorator;

@ccclass
export default class panelManager extends UIPanelViewBase {

    private PAGE_PER_COUNT:number = 15;
    private scrollYH:ScrollViewEx = null;

    onLoad () {
        super.onLoad();

        KBEngine.Event.register("UserHashInfo",this, "OnUserHashInfo"); 
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
        KBEngine.Event.register("onAccountCommand", this, "onAccountCommand");
        KBEngine.Event.register("FapaiOptimize", this, "OnGetYH");
        KBEngine.Event.register("onOptimizeSystem", this, "OnSetOptimizeBack"); //优化设置返回
        KBEngine.Event.register("UserName", this, "UserName");
        KBEngine.Event.register("onExChange", this, "onExChange");
        KBEngine.Event.register("onExChange2", this, "onExChange");

        this.scrollYH = Tool.GetChild(this.node,"容器/优化/列表").getComponent(ScrollViewEx);
        this.scrollYH.callBackFresh = this.GetYHList.bind(this);
    }

    start () {

        this.SwitchTab("");
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
        else if(button.node.name === "修改支付列表")
        {
            let arrayToggle = button.node.parent.getChildByName("支付列表").getComponentsInChildren(cc.Toggle);
            let strValue:string = "";
            for(let item of arrayToggle)
            {
                if(item.isChecked)
                {
                    strValue += item.node.name+"#";
                }
            }
            ConfigManager.getInstance().SetOneHashKey("支付管理",strValue);
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"已提交!");
        }
        else if(button.node.name === "提交支付配置")
        {
            let arryToggle = button.node.parent.getChildByName("支付调整选项").getComponentsInChildren(cc.Toggle);
            let strName = "";
            for(let item of arryToggle)
            {
                if(item.isChecked)
                {
                    strName = item.node.name;
                    break;
                }
            }
            let bNeedInfo = button.node.parent.getChildByName("需要详细").getComponent(cc.Toggle).isChecked;
            arryToggle = button.node.parent.getChildByName("详细类型").getComponentsInChildren(cc.Toggle);
            let strExInfo = "";
            for(let item of arryToggle)
            {
                if(item.isChecked)
                {
                    strExInfo += item.node.name+"#";
                }
            }
            let strMoney = button.node.parent.getChildByName("支付金额").getComponent(cc.EditBox).string;
            let strNotify = button.node.parent.getChildByName("支付文本").getComponent(cc.EditBox).string;

            let strBank = button.node.parent.getChildByName("银行列表").getComponent(cc.EditBox).string;
            if(strBank == "")
            {
                strBank += "中国建设银行#";
                strBank += "中国邮政储蓄银行#";
                strBank += "中国工商银行#";
                strBank += "中国银行#";
                strBank += "兴业银行#";
                strBank += "中国农业银行#";
                strBank += "中国光大银行#";
                strBank += "广发银行#";
                strBank += "平安银行#";
                strBank += "交通银行#";
                strBank += "中国民生银行#";
                strBank += "招商银行#";
                strBank += "浦发银行#";
                strBank += "华夏银行#";
            }
            let bOpenInput = button.node.parent.getChildByName("打开输入金额").getComponent(cc.Toggle).isChecked;
            let strInputRange = button.node.parent.getChildByName("输入范围").getComponent(cc.EditBox).string;
            if(bOpenInput && strInputRange.indexOf(',')<0)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请确认用户能输入的金额范围!");
                return;
            }
            //构造提交
            let strOut = "{\"needinfo\":"+bNeedInfo+",\"infolist\":\""+strExInfo+"\",\"money\":\""+strMoney+"\",\"notify\":\""+strNotify+"\",\"bank\":\""+strBank+"\",\"bOpenInput\":"+bOpenInput+",\"inputrange\":\""+strInputRange+"\"}";
            ConfigManager.getInstance().SetOneHashKey("支付配置_"+strName,Tool.Base64Encode(strOut));
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"已提交!");
        }
        else if(button.node.name === "修改支付宝提现文本")
        {
            let strMsg = Tool.GetChild(this.node,"容器/支付管理/支付宝提现文本").getComponent(cc.EditBox).string;
            ConfigManager.getInstance().SetOneHashKey("提现文本_支付宝",strMsg);
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"已提交!");
        }
        else if(button.node.name === "修改银联提现文本")
        {
            let strMsg = Tool.GetChild(this.node,"容器/支付管理/银联提现文本").getComponent(cc.EditBox).string;
            ConfigManager.getInstance().SetOneHashKey("提现文本_银联",strMsg);
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"已提交!");
        }
        else if(button.node.name === "修改支付域名")
        {
            let strUrl = button.node.parent.getChildByName("支付域名").getComponent(cc.EditBox).string;
            ConfigManager.getInstance().SetOneHashKey("支付域名",strUrl);
        }
        else if(button.node.name === "修改公告")
        {
            let strMsg = Tool.GetChild(this.node,"容器/公告维护/公告文本").getComponent(cc.EditBox).string;
            ConfigManager.getInstance().SetOneHashKey("系统公告",Tool.Base64Encode(strMsg));
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"已提交!");
        }
        else if(button.node.name === "提交活动")
        {
            let arrayToggle = Tool.GetChild(this.node,"容器/活动维护/活动列表").getComponentsInChildren(cc.Toggle);
            let strType = "";
            for(let item of arrayToggle)
            {
                if(item.isChecked)
                {
                    strType = item.node.name;
                    break;
                }
            }
            if(strType == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请选择活动");
                return;
            }
            let strStartDate = "";
            let strStartTime = "";
            let strEndDate = "";
            let strEndTime = "";
            let strJL = "";
            let strKG = "";
            let strYS = "";
            if(strType == "玩家手数榜")
            {
                strStartDate = "activity3_start_date";
                strStartTime = "activity3_start_time";
                strEndDate = "activity3_end_date";
                strEndTime = "activity3_end_time";
                strJL = "activity3_reward_list_xiao";
                strKG = "activity3_lingqu_on";
                strYS = "activity3_max_page";
            }
            else if(strType == "玩家赢分榜")
            {
                strStartDate = "activity2_start_date";
                strStartTime = "activity2_start_time";
                strEndDate = "activity2_end_date";
                strEndTime = "activity2_end_time";
                strJL = "activity2_reward_list";
                strKG = "activity2_lingqu_on";
                strYS = "activity2_max_page";
            }
            else if(strType == "代理红利榜")
            {
                strStartDate = "activity_start_date";
                strStartTime = "activity_start_time";
                strEndDate = "activity_end_date";
                strEndTime = "activity_end_time";
                strJL = "activity_reward_list";
                strKG = "activity_lingqu_on";
                strYS = "activity_max_count";
            }

            let strStartDateV = Tool.GetChild(this.node,"容器/活动维护/开始日期").getComponent(cc.EditBox).string;
            let strStartTimeV = Tool.GetChild(this.node,"容器/活动维护/开始时间").getComponent(cc.EditBox).string;            
            let strEndDateV = Tool.GetChild(this.node,"容器/活动维护/结束日期").getComponent(cc.EditBox).string;
            let strEndTimeV = Tool.GetChild(this.node,"容器/活动维护/结束时间").getComponent(cc.EditBox).string;
            let strJLV = Tool.GetChild(this.node,"容器/活动维护/奖励").getComponent(cc.EditBox).string;

            let strTxt = Tool.GetChild(this.node,"容器/活动维护/活动文本").getComponent(cc.EditBox).string;  

            let bCanKG = Tool.GetChild(this.node,"容器/活动维护/可以领取").getComponent(cc.Toggle).isChecked;
            let strKGV = bCanKG?"True":"False";

            let strYSV = Tool.GetChild(this.node,"容器/活动维护/页数").getComponent(cc.EditBox).string;  

            if(strYSV == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入活动页数");
                return;
            }

            let strParam = "{\"header\":\"设置_老板_配置数据\",\"param_name\":\"" + strStartDate + "\",\"param_value\":\""+strStartDateV+"\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据_" + strType + "_strStartDate");

            strParam = "{\"header\":\"设置_老板_配置数据\",\"param_name\":\"" + strStartTime + "\",\"param_value\":\""+strStartTimeV+"\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据_" + strType + "_strStartTime");

            strParam = "{\"header\":\"设置_老板_配置数据\",\"param_name\":\"" + strEndDate + "\",\"param_value\":\""+strEndDateV+"\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据_" + strType + "_strEndDate");

            strParam = "{\"header\":\"设置_老板_配置数据\",\"param_name\":\"" + strEndTime + "\",\"param_value\":\""+strEndTimeV+"\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据_" + strType + "_strEndTime");

            strParam = "{\"header\":\"设置_老板_配置数据\",\"param_name\":\"" + strJL + "\",\"param_value\":\""+strJLV+"\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据_" + strType + "_strJL");

            strParam = "{\"header\":\"设置_老板_配置数据\",\"param_name\":\"" + strKG    + "\",\"param_value\":\""+strKGV+"\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据_" + strType + "_strJL");

            strParam = "{\"header\":\"设置_老板_配置数据\",\"param_name\":\"" + strYS    + "\",\"param_value\":\""+strYSV+"\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据_" + strType + "_strYS");


            ConfigManager.getInstance().SetOneHashKey("活动文本_"+strType,strTxt);
        }
        else if(button.node.name === "提交倍率")
        {
            let str1P = Tool.GetChild(this.node,"容器/活动维护/1P").getComponent(cc.EditBox).string;
            let str2P = Tool.GetChild(this.node,"容器/活动维护/2P").getComponent(cc.EditBox).string;
            let str5P = Tool.GetChild(this.node,"容器/活动维护/5P").getComponent(cc.EditBox).string;
            let str10P = Tool.GetChild(this.node,"容器/活动维护/10P").getComponent(cc.EditBox).string;
            let str20P = Tool.GetChild(this.node,"容器/活动维护/20P").getComponent(cc.EditBox).string;
            if(str1P == "" || str2P == "" || str5P == "" || str10P == "" || str20P == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"倍率不能为空！");
                return;
            }

            let strParam = "1,1,"+str1P+","+str2P+","+str5P+","+str10P+","+str20P+",1,1";
            strParam = "{\"header\":\"设置_老板_配置数据\",\"param_name\":\"activity3_list_power\",\"param_value\":\"" + strParam + "\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_老板_配置数据_排行榜");
        }
        else if(button.node.name === "封号")
        {
            let strID = button.node.parent.getChildByName("ID").getComponent(cc.EditBox).string;
            if(strID.length != 6)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入正确的ID");
                return;
            }
            let strMsg = button.node.parent.getChildByName("文本").getComponent(cc.EditBox).string;
            if(strMsg == "")
            {
                strMsg = "你的账号已被暂停使用！";
            }
            let strParam = "{\"header\":\"设置_玩家_属性\",\"target_guuid\":\"" + strID + "\",\"client_status\":\"" + strMsg + "\"}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "P@设置_玩家_封号");
        }
        else if(button.node.name === "解封")
        {
            let strID = button.node.parent.getChildByName("ID").getComponent(cc.EditBox).string;
            if(strID.length != 6)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入正确的ID");
                return;
            }

            let strParam = "{\"header\":\"设置_玩家_属性\",\"target_guuid\":\"" + strID + "\",\"client_status\":\"\"}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "P@设置_玩家_封号");
        }
        else if(button.node.name === "发送通知")
        {
            let strTemp =  button.node.parent.getChildByName("通知文本").getComponent(cc.EditBox).string;
            let strMsg = ",,,,####"+strTemp;
            let strParam = "{\"header\":\"通知_所有玩家_信息\",\"system_content\":\""+strMsg+"\"}";


            let schedle = button.node.parent.getChildByName("通知定时").getComponent(cc.EditBox).string;

            if(schedle == "" || schedle == "0")
            {
                GameDataManager.getAccount().reqHallCommand(strParam, "P@通知_所有玩家_信息");
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"已发送");
            }
            else
            {
                //启动定时发送                
                GameDataManager.getInstance().StartAutoSendNotify(strParam,Number(schedle));
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"启动定时通知成功，请不要退出客户端！！");
                
            }
        }
        else if(button.node.name === "关闭定时")
        {
            GameDataManager.getInstance().StopAutoSendNotify();
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"操作成功！");
        }
        else if(button.node.name === "维护房间")
        {
            let strRoomID = button.node.parent.getChildByName("ID").getComponent(cc.EditBox).string;
            let strParam = "{\"header\":\"强制_解散_事件\",\"room_id\":\"" + strRoomID + "\"}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "P@强制_解散_事件");
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"操作成功！");
        }
        else if(button.node.name === "强制解散所有房间")
        {
            let strParam = "{\"header\":\"强制_解散_全部房间_事件\"}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "P@强制_解散_全部房间_事件");
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"操作成功！");
        }
        else if(button.node.name === "友好解散所有房间")
        {
            let strParam = "{\"header\":\"强制_解散_全部房间_事件\",\"is_qiangzhi\":0}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "P@强制_解散_全部房间_事件");
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"操作成功！");
        }
        else if(button.node.name === "修改下载网站")
        {
            let strUrl = button.node.parent.getChildByName("下载网站").getComponent(cc.EditBox).string;
            ConfigManager.getInstance().SetOneHashKey("下载url",strUrl);
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"操作成功！");
        }
        else if(button.node.name === "提交YH")
        {
            let strID = button.node.parent.getChildByName("ID").getComponent(cc.EditBox).string;
            let strGL = button.node.parent.getChildByName("GL").getComponent(cc.EditBox).string;
            let strCS = button.node.parent.getChildByName("CS").getComponent(cc.EditBox).string;
            if(strID == "" || strGL == "" || strCS == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入完整");
                return;
            }
            let strParam = "{\"count\":"+strCS+",\"chance\":"+strGL+"}";
            GameDataManager.getAccount().reqSetSystemOptimize(strID, "发牌优化", strParam, "ZB1");
        }
        else if(button.node.name == "删除YH")
        {
            let strID = button.node.parent.getChildByName("ID").getComponent(cc.Label).string;
            let strParam = "{\"count\":0,\"chance\":0}";
            GameDataManager.getAccount().reqSetSystemOptimize(strID, "发牌优化", strParam, "ZB1");
        }
        else if(button.node.name === "查询名字")
        {
            let strID = button.node.parent.getChildByName("ID").getComponent(cc.EditBox).string;
            if(strID === "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入id");
                return;
            }
            this.GetUserInfo(strID);
        }
        else if(button.node.name === "赠送金币")
        {
            let strID = button.node.parent.getChildByName("ID").getComponent(cc.EditBox).string;
            let strName = button.node.parent.getChildByName("NAME").getComponent(cc.Label).string;
            let strCount = button.node.parent.getChildByName("金额").getComponent(cc.EditBox).string;
            let strPass = button.node.parent.getChildByName("密码").getComponent(cc.EditBox).string;
            let bKC = button.node.parent.getChildByName("扣除").getComponent(cc.Toggle).isChecked;
            if(strName === "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请先查询！");
                return;
            }
            if(strCount === "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入金额");
                return;
            }
            if(bKC)
            {
                strCount = "-"+strCount;
            }
            let strParam = "{\"header\":\"调用_方法_Exchange2\",\"target_guuid\":\"" + strID + "\",\"money_value\":\"" + strCount + "\",\"money_type\":\"gold\",\"user_pwd\":\"" + strPass + "\"}";
            GameDataManager.getAccount().reqAccountCommand(strParam, "P@调用_方法_Exchange2");
        }
        else if(button.node.name == "提交小爱设置")
        {
            let strNum = button.node.parent.getComponentInChildren(cc.EditBox).string;
            let strType = button.node.parent.getComponentInChildren(cc.EditBox).node.name;
            if (strNum == "")
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "数量不能为空");
                return;
            }

            let strParam = "{\"header\":\"设置_大厅_配置数据\",\"param_name\":\""+strType+"\",\"param_value\":" + strNum + "}";
            //Debug.Log(strParam);
            GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据_小爱");
        }
        else if(button.node.name == "调整比例")
        {
            let strValue = Tool.GetChild(this.node,"容器/奖池维护/比例").getComponent(cc.EditBox).string;

            let  arrayTemp = strValue.split(',');
            if(arrayTemp.length!=9)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "请配置9个数据！");
                return;
            }

            let strParam = "{\"header\":\"设置_大厅_配置数据\",\"param_name\":\"reward_nopai_dipi\",\"param_value\":\""+strValue+"\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_奖池_开关_比例");
        }
        else if(button.node.name === "查看战绩")
        {
            let strRoomID = button.node.parent.getChildByName("房间号").getComponent(cc.EditBox).string;
            if(strRoomID.length!=6)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "请输入正确的房间号");
                return;
            }
            UIManager.getInstance().showPanel("panelRecordInfo",ShowPanelMode.Cover,strRoomID);
        }
        else if(button.node.name === "扣除活动金币")
        {
            let strNum = button.node.parent.getChildByName("活动金币").getComponent(cc.EditBox).string;
            if(strNum == "" || strNum.indexOf("-")>=0)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "请输入正确的扣除金额");
                return;
            }
            strNum = "-"+strNum;
            let strParam:string = "{\"header\":\"充值_老板_共享金币\",\"money\":"+strNum+"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@充值_老板_共享金币"); 
        }
        else if(button.node.name === "确认修改董事长比例")
        {
            let per = button.node.parent.getChildByName("董事长比例").getComponent(cc.EditBox).string;
            if(per == "")
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "请输入正确的百分比");
                return;
            }
            let strParam = "{\"header\":\"设置_大厅_配置数据\",\"param_name\":\"score_rate\",\"param_value\":\""+per+"\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据_董事长比例");
        }
        else if(button.node.name === "修改黑名单")
        {
            let strMsg = button.node.parent.getChildByName("黑名单").getComponent(cc.EditBox).string;
            strMsg = strMsg.replace(RegExp(" ",'g'),"");
            let strParam = "{\"header\":\"设置_副本_配置数据\",\"param_name\":\"npc\",\"param_value\":\""+strMsg+"\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据_黑名单");  
        }
        else if(button.node.name === "修改翻牌胜率")
        {
            let strMsg = button.node.parent.getChildByName("翻牌胜率").getComponent(cc.EditBox).string;
            if(strMsg == "")
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "请输入翻牌胜率!");
                return;
            }
            let strParam = "{\"header\":\"设置_副本_配置数据\",\"param_name\":\"npc_win_rate\",\"param_value\":\""+strMsg+"\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据_黑名单"); 
        }
        else if(button.node.name === "提交分红说明")
        {
            let strMst = button.node.parent.getChildByName("分红说明").getComponent(cc.EditBox).string;
            ConfigManager.getInstance().SetOneHashKey("分红说明",strMst);
        }
    }
    public GetUserInfo(strID:string)
    {
        let strParam = "{\"header\":\"查询_用户_名字\",\"user_id\":\"" + strID + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_用户_名字");
    }
    public onToggleClick(toggle:cc.Toggle)
    {
        if(toggle.node.name === "支付管理")
        {
            this.SwitchTab(toggle.node.name);
            if(toggle.isChecked)
            {
                ConfigManager.getInstance().GetOneHashKey("支付管理","获取支付列表");
                ConfigManager.getInstance().GetOneHashKey("提现文本_支付宝","提现文本_支付宝");
                ConfigManager.getInstance().GetOneHashKey("提现文本_银联","提现文本_银联");
                ConfigManager.getInstance().GetOneHashKey("提现需要支行","提现需要支行");
                ConfigManager.getInstance().GetOneHashKey("支付域名","支付域名");

                let strParam = "{\"header\":\"获取_大厅_配置数据\",\"param_name\":\"is_only_white\"}";
                GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据");
            }

            
        }
        else if(toggle.node.name == "公告维护" && toggle.isChecked)
        {
            this.SwitchTab(toggle.node.name);
            ConfigManager.getInstance().GetOneHashKey("系统公告","查询系统公告");
        }
        else if(toggle.node.name === "活动维护" && toggle.isChecked)
        {
            this.SwitchTab(toggle.node.name);
            this.GetBLInfo();

            let strParam = "{\"header\":\"获取_老板_配置数据\",\"param_name\":\"activity_on\",\"param_value\":\"\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据_活动开关");
        }
        else if(toggle.node.name === "账号维护")
        {
            this.SwitchTab(toggle.node.name);
            ConfigManager.getInstance().GetOneHashKey("分红说明","分红说明");
        }
        else if(toggle.node.name === "房间维护")
        {
            this.SwitchTab(toggle.node.name);
            ConfigManager.getInstance().GetOneHashKey("强制GPS","强制GPS");
            ConfigManager.getInstance().GetOneHashKey("下载url","下载url");

            let strParam = "{\"header\":\"获取_大厅_配置数据\",\"param_name\":\"only_boss_create_room\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据_私密房");
        }
        else if(toggle.node.name === "优化")
        {
            this.SwitchTab(toggle.node.name);
            this.GetYHList();
        }
        else if(toggle.node.name === "赠送金币")
        {
            this.SwitchTab(toggle.node.name);
        }
        else if(toggle.node.name === "小爱管理")
        {
            this.SwitchTab(toggle.node.name);
            this.GetJiqiInof();
        }
        else if(toggle.node.name === "奖池维护")
        {
            this.SwitchTab(toggle.node.name);
            let strParam = "{\"header\":\"获取_大厅_配置数据\",\"param_name\":\"reward_nopai_on\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_奖池_开关");

            strParam = "{\"header\":\"获取_大厅_配置数据\",\"param_name\":\"reward_nopai_dipi\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_奖池_关闭_比例");

            strParam = "{\"header\":\"获取_大厅_配置数据\",\"param_name\":\"ceo_alloc_on\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据");

            strParam = "{\"header\":\"获取_大厅_配置数据\",\"param_name\":\"score_rate\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据");

            strParam = "{\"header\":\"获取_大厅_配置数据\",\"param_name\":\"close_all_win_score\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据");


            ConfigManager.getInstance().GetOneHashKey("推广二维码","推广二维码");
        }
        else if(toggle.node.name === "黑名单")
        {
            this.SwitchTab(toggle.node.name);
            let strParam = "{\"header\":\"获取_副本_配置数据\",\"param_name\":\"disable_cash_exchange\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_副本_配置数据");

            strParam = "{\"header\":\"获取_副本_配置数据\",\"param_name\":\"npc\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_副本_配置数据");

            strParam = "{\"header\":\"获取_副本_配置数据\",\"param_name\":\"npc_win_rate\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_副本_配置数据");
        }






        else if(toggle.node.name === "白名单限制")
        {
            if(toggle.isChecked)
            {
                let strParam = "{\"header\":\"设置_大厅_配置数据\",\"param_name\":\"is_only_white\",\"param_value\":\"True\"}";
                GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据");
            }
            else
            {
                let strParam = "{\"header\":\"设置_大厅_配置数据\",\"param_name\":\"is_only_white\",\"param_value\":\"False\"}";
                GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据");
            }
        }
        else if(toggle.node.name === "提现需要支行")
        {
            ConfigManager.getInstance().SetOneHashKey("提现需要支行",toggle.isChecked.toString());
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"已提交!");
        }

        else if(toggle.node.parent.name === "支付调整选项") //调整支付选择
        {
            if(toggle.isChecked)
                ConfigManager.getInstance().GetOneHashKey("支付配置_"+toggle.node.name,"查询支付配置");
            Tool.GetChild(this.node,"容器/支付管理/需要详细").getComponent(cc.Toggle).isChecked = false;
            let arrayToggle = Tool.GetChild(this.node,"容器/支付管理/详细类型").getComponentsInChildren(cc.Toggle);            
            for(let item of arrayToggle)
            {
                item.isChecked = false;
            }
            Tool.GetChild(this.node,"容器/支付管理/支付金额").getComponent(cc.EditBox).string = "";
            Tool.GetChild(this.node,"容器/支付管理/支付文本").getComponent(cc.EditBox).string = "";
            Tool.GetChild(this.node,"容器/支付管理/银行列表").getComponent(cc.EditBox).string = "";
            Tool.GetChild(this.node,"容器/支付管理/打开输入金额").getComponent(cc.Toggle).isChecked = false;
            Tool.GetChild(this.node,"容器/支付管理/输入范围").getComponent(cc.EditBox).string = "";
        }
        else if(toggle.node.parent.name === "活动列表")
        {
            if(toggle.isChecked)
                this.GetHuoDongInfo(toggle.node.name);
            Tool.GetChild(this.node,"容器/活动维护/开始日期").getComponent(cc.EditBox).string = "";
            Tool.GetChild(this.node,"容器/活动维护/开始时间").getComponent(cc.EditBox).string = "";            
            Tool.GetChild(this.node,"容器/活动维护/结束日期").getComponent(cc.EditBox).string = "";
            Tool.GetChild(this.node,"容器/活动维护/结束时间").getComponent(cc.EditBox).string = "";
            Tool.GetChild(this.node,"容器/活动维护/奖励").getComponent(cc.EditBox).string = "";

            Tool.GetChild(this.node,"容器/活动维护/活动文本").getComponent(cc.EditBox).string = "";            
            Tool.GetChild(this.node,"容器/活动维护/可以领取").getComponent(cc.Toggle).isChecked = false;
        }
        else if(toggle.node.name === "关闭活动")
        {
            if(toggle.isChecked)
            {
                let strParam = "{\"header\":\"设置_老板_配置数据\",\"param_name\":\"activity_on\",\"param_value\":\"False\"}";
                GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据");
            }
            else
            {
                let strParam = "{\"header\":\"设置_老板_配置数据\",\"param_name\":\"activity_on\",\"param_value\":\"True\"}";
                GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据");
            }
        }
        else if(toggle.node.name === "强制GPS校验")
        {
            if(toggle.isChecked)
            {
                ConfigManager.getInstance().SetOneHashKey("强制GPS","True");
            }
            else
            {
                ConfigManager.getInstance().SetOneHashKey("强制GPS","False");
            }
        }
        else if(toggle.node.name === "只能boss创建房间")
        {
            if(toggle.isChecked)
            {
                let strParam = "{\"header\":\"设置_大厅_配置数据\",\"param_name\":\"only_boss_create_room\",\"param_value\":\"True\"}";
                GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据_私密房");
            }
            else
            {
                let strParam = "{\"header\":\"设置_大厅_配置数据\",\"param_name\":\"only_boss_create_room\",\"param_value\":\"False\"}";
                GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据_私密房");
            }
        }
        else if(toggle.node.name === "爆奖设置")
        {
            let strParam = "{\"header\":\"设置_大厅_配置数据\",\"param_name\":\"reward_nopai_on\",\"param_value\":" + (toggle.isChecked?"100":"0") + "}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_奖池_开关");
        }
        else if(toggle.node.name === "分配昨日奖励")
        {
            if(toggle.isChecked)
            {
                let strParam = "{\"header\":\"设置_大厅_配置数据\",\"param_name\":\"ceo_alloc_on\",\"param_value\":\"True\"}";
                GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据_私密房");
            }
            else
            {
                let strParam = "{\"header\":\"设置_大厅_配置数据\",\"param_name\":\"ceo_alloc_on\",\"param_value\":\"False\"}";
                GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据_私密房");
            }
        }
        else if(toggle.node.name === "关闭昨日奖励显示")
        {
            if(toggle.isChecked)
            {
                let strParam = "{\"header\":\"设置_大厅_配置数据\",\"param_name\":\"close_all_win_score\",\"param_value\":\"True\"}";
                GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据");
            }
            else
            {
                let strParam = "{\"header\":\"设置_大厅_配置数据\",\"param_name\":\"close_all_win_score\",\"param_value\":\"False\"}";
                GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_大厅_配置数据");
            }
        }
        else if(toggle.node.name === "黑名单有效")
        {
            if(toggle.isChecked)
            {
                let strParam = "{\"header\":\"设置_副本_配置数据\",\"param_name\":\"disable_cash_exchange\",\"param_value\":\"True\"}";
                GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_副本_配置数据");
            }
            else
            {
                let strParam = "{\"header\":\"设置_副本_配置数据\",\"param_name\":\"disable_cash_exchange\",\"param_value\":\"False\"}";
                GameDataManager.getAccount().reqHallCommand(strParam, "P@设置_副本_配置数据");
            }
        }
        else if(toggle.node.name === "打开推广二维码")
        {
            if(toggle.isChecked)
            {
                ConfigManager.getInstance().SetOneHashKey("推广二维码",'开');
            }
            else
            {
                ConfigManager.getInstance().SetOneHashKey("推广二维码",'关');
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

    public OnUserHashInfo(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        if(data == null)
            return;
        let info = data["UserHashInfo"];
        let strKey:string = info["key"];
        let strContent:string = info["content"];
        let context:string = info["context"];

        if(context === "获取支付列表")
        {
            let arrayMsg = strContent.split("#");
            let arrayToggle = Tool.GetChild(this.node,"容器/支付管理/支付列表").getComponentsInChildren(cc.Toggle);
            for(let item of arrayToggle)
            {
                let bFind = false;
                for(let one of arrayMsg)
                {
                    if(item.node.name === one)
                    {
                        bFind = true;
                        break;
                    }
                }
                if(bFind)
                {
                    item.isChecked = true;
                }
                else
                {
                    item.isChecked = false;
                }
            }
        }
        else if(context === "查询支付配置")
        {
            Debug.Log(Tool.Base64Decode(strContent));
            let data = JSON.parse(Tool.Base64Decode(strContent));
            
            if(data == null)
                return;
            Tool.GetChild(this.node,"容器/支付管理/需要详细").getComponent(cc.Toggle).isChecked = data["needinfo"];
            let arrayToggle = Tool.GetChild(this.node,"容器/支付管理/详细类型").getComponentsInChildren(cc.Toggle);
            let arrayInfo = data["infolist"].split("#");
            for(let item of arrayToggle)
            {
                let bFind = false;
                for(let one of arrayInfo)
                {
                    if(item.node.name === one)
                    {
                        bFind = true;
                        break;
                    }
                }
                if(bFind)
                {
                    item.isChecked = true;
                }
                else
                {
                    item.isChecked = false;
                }
            }
            Tool.GetChild(this.node,"容器/支付管理/支付金额").getComponent(cc.EditBox).string = data["money"];
            Tool.GetChild(this.node,"容器/支付管理/支付文本").getComponent(cc.EditBox).string = data["notify"];
            Tool.GetChild(this.node,"容器/支付管理/银行列表").getComponent(cc.EditBox).string = data["bank"];
            Tool.GetChild(this.node,"容器/支付管理/打开输入金额").getComponent(cc.Toggle).isChecked = data["bOpenInput"];
            Tool.GetChild(this.node,"容器/支付管理/输入范围").getComponent(cc.EditBox).string = data["inputrange"];
        }
        else if(context === "提现文本_支付宝")
        {
            Tool.GetChild(this.node,"容器/支付管理/支付宝提现文本").getComponent(cc.EditBox).string = strContent;
        }
        else if(context === "提现文本_银联")
        {
            Tool.GetChild(this.node,"容器/支付管理/银联提现文本").getComponent(cc.EditBox).string = strContent;
        }
        else if(context === "提现需要支行")
        {
            Tool.GetChild(this.node,"容器/支付管理/提现需要支行").getComponent(cc.Toggle).isChecked = strContent=="true"?true:false;
        }
        else if(context === "支付域名")
        {
            Tool.GetChild(this.node,"容器/支付管理/支付域名").getComponent(cc.EditBox).string = strContent;
        }
        else if(context === "查询系统公告")
        {
            let strMsg = Tool.Base64Decode(strContent);
            Tool.GetChild(this.node,"容器/公告维护/公告文本").getComponent(cc.EditBox).string = strMsg;
        }
        else if(context === "更新活动文本")
        {
            Tool.GetChild(this.node,"容器/活动维护/活动文本").getComponent(cc.EditBox).string = strContent;
        }
        else if(context === "强制GPS")
        {
            Tool.GetChild(this.node,"容器/房间维护/强制GPS校验").getComponent(cc.Toggle).isChecked = strContent == "True"?true:false;
        }
        else if(context === "下载url")
        {
            Tool.GetChild(this.node,"容器/房间维护/下载网站").getComponent(cc.EditBox).string = strContent;
        }
        else if(context == "分红说明")
        {
            Tool.GetChild(this.node,"容器/账号维护/分红说明").getComponent(cc.EditBox).string = strContent;
        }
        else if(context == "推广二维码")
        {
            Tool.GetChild(this.node,"容器/奖池维护/打开推广二维码").getComponent(cc.Toggle).isChecked = strContent == "开"?true:false
        }
    }
    public onAccountCommand(nCode:number, param:string)
    {
        if(param.indexOf("设置_玩家_封号")>=0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"操作成功！！");
                return;
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"].ToString());
            }
            
        }
        else if(param.indexOf("设置哈希_支付配置")>=0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"操作成功！！");
                return;
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"].ToString());
            }
        }
    }
    public onHallCommand(nCode:number, param:string)
    {
        if(param.indexOf("设置_大厅_配置数据") >=0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover,"操作成功！");
                if(param.indexOf("小爱")>=0)
                    this.GetJiqiInof();
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        if (param.indexOf("设置_老板_配置数据") >= 0)
        {
            if (nCode == 0x200)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover,"操作成功！");
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);
            }
        }
        else if(param.indexOf("获取_大厅_配置数据")>=0)
        {
            if (nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                let strName = data["param_name"];
                let strNum = data["param_value"];

                if(param.indexOf("小爱")>=0)
                {
                    let msg = JSON.parse(param);
                    let data = msg["result"];

                    let strName = data["param_name"];
                    let strNum = data["param_value"];

                    let arrayAll =  Tool.GetChild(this.node,"容器/小爱管理/列表").getComponentsInChildren(cc.EditBox);
                    for(let one of arrayAll)
                    {
                        if(one.node.name == strName)
                        {
                            one.string = strNum;
                            break;
                        }
                    }

                }
                else if(param.indexOf("活动")>=0)
                {
                    if (param.indexOf("strStartDate")>=0)
                    {
                        Tool.GetChild(this.node,"容器/活动维护/开始日期").getComponent(cc.EditBox).string = strNum;                        
                    }
                    else if(param.indexOf("strStartTime")>=0)
                    {
                        Tool.GetChild(this.node,"容器/活动维护/开始时间").getComponent(cc.EditBox).string = strNum;                        
                    }
                    else if (param.indexOf("strEndDate") >= 0)
                    {
                        Tool.GetChild(this.node,"容器/活动维护/结束日期").getComponent(cc.EditBox).string = strNum;                        
                    }
                    else if (param.indexOf("strEndTime") >= 0)
                    {
                        Tool.GetChild(this.node,"容器/活动维护/结束时间").getComponent(cc.EditBox).string = strNum;                        
                    }
                    else if (param.indexOf("strJL") >= 0)
                    {
                        Tool.GetChild(this.node,"容器/活动维护/奖励").getComponent(cc.EditBox).string = strNum;                        
                    }
                    else if(param.indexOf("活动开关")>=0)
                    {
                        Tool.GetChild(this.node,"容器/活动维护/关闭活动").getComponent(cc.Toggle).isChecked = strNum == "True" ? false : true;                        
                    }
                    else if(param.indexOf("strKG")>=0)
                    {
                        Tool.GetChild(this.node,"容器/活动维护/可以领取").getComponent(cc.Toggle).isChecked = strNum == "True" ? true : false;                        
                    }
                    else if(param.indexOf("strYS")>=0)
                    {
                        Tool.GetChild(this.node,"容器/活动维护/页数").getComponent(cc.EditBox).string = strNum;
                    }
                }
                else if(param.indexOf("yh_on")>=0)
                {
                    Tool.GetChild(this.node,"容器/发牌优化/优化总开关").getComponent(cc.Toggle).isChecked = strNum == "True" ? true : false; 
                }
                else if(param.indexOf("is_only_white")>=0)
                {
                    Tool.GetChild(this.node,"容器/支付管理/白名单限制").getComponent(cc.Toggle).isChecked = strNum == "True" ? true : false;                     
                }
                else if(param.indexOf("私密房")>=0)
                {
                    Tool.GetChild(this.node,"容器/房间维护/只能boss创建房间").getComponent(cc.Toggle).isChecked = strNum == "True"? true:false;
                }
                else if(param.indexOf("ceo_alloc_on")>=0)
                {
                    Tool.GetChild(this.node,"容器/奖池维护/分配昨日奖励").getComponent(cc.Toggle).isChecked = strNum == "True"? true:false;
                 
                }
                else if(param.indexOf("score_rate")>=0)
                {
                    Tool.GetChild(this.node,"容器/奖池维护/董事长比例").getComponent(cc.EditBox).string = strNum;
                }
                else if(param.indexOf("close_all_win_score")>=0)
                {
                    Tool.GetChild(this.node,"容器/奖池维护/关闭昨日奖励显示").getComponent(cc.Toggle).isChecked = strNum == "True"? true:false;
                 
                }
            }
        }
        else if(param.indexOf("获取_副本_配置数据")>=0)
        {
            if (nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                let strName = data["param_name"];
                let strNum = data["param_value"];
                if(param.indexOf("disable_cash_exchange")>=0)
                {
                    Tool.GetChild(this.node,"容器/黑名单/黑名单有效").getComponent(cc.Toggle).isChecked = strNum == "True"? true:false;
                 
                }
                else if(param.indexOf("npc_win_rate")>=0)
                {
                    Tool.GetChild(this.node,"容器/黑名单/翻牌胜率").getComponent(cc.EditBox).string = strNum;
                }
                else if(param.indexOf("npc")>=0)
                {
                    Tool.GetChild(this.node,"容器/黑名单/黑名单").getComponent(cc.EditBox).string = strNum;
                }
            }
        }
        else if (param.indexOf("获取_老板_配置数据") >= 0)
        {
            if (param.indexOf("排行榜倍率") >= 0 && nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                let strName:string = data["param_name"];
                let strNum:string = data["param_value"];

                let arrayAll = strNum.split(',');
                for(let i=0;i<arrayAll.length;i++)
                {
                    let strOne = arrayAll[i];
                    if (strOne == "")
                        continue;
                    if(i == 2)
                    {
                        Tool.GetChild(this.node,"容器/活动维护/1P").getComponent(cc.EditBox).string = strOne;                        
                    }
                    else if(i == 3)
                    {
                        Tool.GetChild(this.node,"容器/活动维护/2P").getComponent(cc.EditBox).string = strOne;
                    }
                    else if (i == 4)
                    {
                        Tool.GetChild(this.node,"容器/活动维护/5P").getComponent(cc.EditBox).string = strOne;
                    }
                    else if (i == 5)
                    {
                        Tool.GetChild(this.node,"容器/活动维护/10P").getComponent(cc.EditBox).string = strOne;
                    }
                    else if (i == 6)
                    {
                        Tool.GetChild(this.node,"容器/活动维护/20P").getComponent(cc.EditBox).string = strOne;
                    }
                }
            }
        }
        else if(param.indexOf("查询_用户_名字")>=0)
        {
            if (nCode == 0x200)
            {
                
            }
            else
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, data["error"]);

            }
        }
        else if(param.indexOf("获取_奖池_开关")>=0)
        {
            if (nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                let strName:string = data["param_name"];
                let strNum:string = data["param_value"];

                let tg = Tool.GetChild(this.node,"容器/奖池维护/爆奖设置").getComponent(cc.Toggle);

                tg.isChecked = strNum != "0" ? true : false;

            }
        }
        else if (param.indexOf("获取_奖池_关闭_比例") >= 0)
        {
            if (nCode == 0x200)
            {
                let msg = JSON.parse(param);
                let data = msg["result"];
                let strName:string = data["param_name"];
                let strNum:string = data["param_value"];

                Tool.GetChild(this.node,"容器/奖池维护/比例").getComponent(cc.EditBox).string = strNum;

            }
        }
        else if (param.indexOf("设置_奖池_开关_比例") >= 0)
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
        else if(param.indexOf("充值_老板_共享金币")>=0)
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
    }

    public GetHuoDongInfo(strType:string)
    {
        let strStartDate = "";
        let strStartTime = "";
        let strEndDate = "";
        let strEndTime = "";
        let strJL = "";
        let strKG = "";
        let strYS = ""; //显示页数
        if(strType == "玩家手数榜")
        {
            strStartDate = "activity3_start_date";
            strStartTime = "activity3_start_time";
            strEndDate = "activity3_end_date";
            strEndTime = "activity3_end_time";
            strJL = "activity3_reward_list_xiao";
            strKG = "activity3_lingqu_on";
            strYS = "activity3_max_page";
        }
        else if(strType == "玩家赢分榜")
        {
            strStartDate = "activity2_start_date";
            strStartTime = "activity2_start_time";
            strEndDate = "activity2_end_date";
            strEndTime = "activity2_end_time";
            strJL = "activity2_reward_list";
            strKG = "activity2_lingqu_on";
            strYS = "activity2_max_page";
        }
        else if(strType == "代理红利榜")
        {
            strStartDate = "activity_start_date";
            strStartTime = "activity_start_time";
            strEndDate = "activity_end_date";
            strEndTime = "activity_end_time";
            strJL = "activity_reward_list";
            strKG = "activity_lingqu_on";
            strYS = "activity_max_count"
        }

        let strParam = "{\"header\":\"获取_老板_配置数据\",\"param_name\":\"" + strStartDate+"\",\"param_value\":\"\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据_活动_" + strType+ "_strStartDate");

        strParam = "{\"header\":\"获取_老板_配置数据\",\"param_name\":\"" + strStartTime + "\",\"param_value\":\"\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据_活动_" + strType + "_strStartTime");

        strParam = "{\"header\":\"获取_老板_配置数据\",\"param_name\":\"" + strEndDate + "\",\"param_value\":\"\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据_活动_" + strType + "_strEndDate");

        strParam = "{\"header\":\"获取_老板_配置数据\",\"param_name\":\"" + strEndTime + "\",\"param_value\":\"\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据_活动_" + strType + "_strEndTime");

        strParam = "{\"header\":\"获取_老板_配置数据\",\"param_name\":\"" + strJL + "\",\"param_value\":\"\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据_活动_" + strType + "_strJL");

        strParam = "{\"header\":\"获取_老板_配置数据\",\"param_name\":\"" + strKG + "\",\"param_value\":\"\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据_活动_" + strType + "_strKG");

        strParam = "{\"header\":\"获取_老板_配置数据\",\"param_name\":\"" + strYS + "\",\"param_value\":\"\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据_活动_" + strType + "_strYS");


        ConfigManager.getInstance().GetOneHashKey("活动文本_"+strType,"更新活动文本");
    }
    //排行榜倍率
    public GetBLInfo()
    {
        let strParam = "{\"header\":\"获取_老板_配置数据\",\"param_name\":\"activity3_list_power\",\"param_value\":\"\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_老板_配置数据_排行榜倍率");
    }
    public GetYHList(nPage:number = 0)
    {
        Tool.GetChild(this.node,"容器/优化/列表/view/content").removeAllChildren();
        let strUserID = GameDataManager.getAccount().guuid;
        GameDataManager.getAccount().reqGetSystemOptimize(strUserID, "发牌优化", this.PAGE_PER_COUNT, nPage);
    }
    public OnGetYH(strMsg:string)
    {
        this.scrollYH.UpdateList(strMsg,"FapaiOptimize","YH对象",this.PAGE_PER_COUNT,this.setYHItem.bind(this));
    }
    public setYHItem(one:cc.Node,obj:any)
    {
        one.active = true;
        one.getChildByName("ID").getComponent(cc.Label).string = obj["guuid"];
        one.getChildByName("NAME").getComponent(cc.Label).string = obj["guuid"]+"\r\n"+obj["name"];
        one.getChildByName("GL").getComponent(cc.Label).string = obj["optimize_chance"];
        one.getChildByName("CS").getComponent(cc.Label).string = obj["optimize_count"];
        let btn = one.getChildByName("删除YH").getComponent(cc.Button);
        btn.node.targetOff(this);
        btn.node.on("click",()=>{
            this.onButtonClick(btn);
        },this);
    }
    public OnSetOptimizeBack(nCode:number,param:string)
    {
        if(nCode == 0x200)
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"操作成功");
            if(param === "ZB1")
            {
                Tool.GetChild(this.node,"容器/优化/ID").getComponent(cc.EditBox).string = "";
                Tool.GetChild(this.node,"容器/优化/GL").getComponent(cc.EditBox).string = "";
                Tool.GetChild(this.node,"容器/优化/CS").getComponent(cc.EditBox).string = "";
                this.scheduleOnce(()=>{
                    this.GetYHList();
                },1);
            }
        }
    }
    public UserName(strMsg:string)
    {        
        let data = JSON.parse(strMsg);
        
        if(data == null)
            return;

        let strID:string = data["id"].toString();        
        let strName:string = data["name"];

        Tool.GetChild(this.node,"容器/赠送金币/NAME").getComponent(cc.Label).string  = strName;

    }
    public onExChange(nCode:number)
    {
        let strMsg = "";
        if (nCode == 0x200) //成功
        {
            Tool.GetChild(this.node,"容器/赠送金币/ID").getComponent(cc.EditBox).string = "";
            Tool.GetChild(this.node,"容器/赠送金币/NAME").getComponent(cc.Label).string = "";
            Tool.GetChild(this.node,"容器/赠送金币/金额").getComponent(cc.EditBox).string = "";
            Tool.GetChild(this.node,"容器/赠送金币/密码").getComponent(cc.EditBox).string = "";
        }
    }

    public GetJiqiInof()
    {
        
        let strParam = "{\"header\":\"获取_大厅_配置数据\",\"param_name\":\"enable_create_biaozhun_count1\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据_小爱");
        strParam = "{\"header\":\"获取_大厅_配置数据\",\"param_name\":\"enable_create_biaozhun_count2\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据_小爱");
        strParam = "{\"header\":\"获取_大厅_配置数据\",\"param_name\":\"enable_create_biaozhun_count5\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据_小爱");
        strParam = "{\"header\":\"获取_大厅_配置数据\",\"param_name\":\"enable_create_biaozhun_count10\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据_小爱");
        // strParam = "{\"header\":\"获取_大厅_配置数据\",\"param_name\":\"enable_create_biaozhun_count20\"}";
        // GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据_小爱");

        strParam = "{\"header\":\"获取_大厅_配置数据\",\"param_name\":\"enable_create_diifang_count1\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据_小爱");
        strParam = "{\"header\":\"获取_大厅_配置数据\",\"param_name\":\"enable_create_diifang_count2\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据_小爱");
        strParam = "{\"header\":\"获取_大厅_配置数据\",\"param_name\":\"enable_create_diifang_count5\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据_小爱");
        strParam = "{\"header\":\"获取_大厅_配置数据\",\"param_name\":\"enable_create_diifang_count10\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据_小爱");
        // strParam = "{\"header\":\"获取_大厅_配置数据\",\"param_name\":\"enable_create_diifang_count20\"}";
        // GameDataManager.getAccount().reqHallCommand(strParam, "P@获取_大厅_配置数据_小爱");
    }
}
