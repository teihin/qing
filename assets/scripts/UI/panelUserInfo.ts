import UIPanelViewBase from "../common/UIPanelViewBase";
import DrhPlayerLogic from "../logic/DrhPlayerLogic";
import UIManager from "../common/UIManager";
import { ClosePanelMode, ShowPanelMode } from "../common/GameDef";
import Tool from "../common/Tool";
import ImageManager from "../logic/ImageManager";
import GameDataManager from "../GameDataManager";
import Debug from "../common/Debug";
import WebLoadingManager from "../common/WebLoadingManager";
import MobileManager from "../mobile/MobileManager";
import ConfigManager from "../logic/ConfigManager";
import { normalizeRoomClubId, resolveMyRoomClubId } from "../logic/RoomClubContext";
var KBEngine = require("kbengine");
const {ccclass, property} = cc._decorator;

@ccclass
export default class panelUserInfo extends UIPanelViewBase {

    private player:DrhPlayerLogic = null;
    private bIsVip:boolean = false
    /** 输赢统计默认遮住，玩家确认扣钻后才显示本次面板内的 6 项数据。 */
    private statsUnlocked:boolean = false

    /** 牌局里的俱乐部以玩家自己的结算俱乐部为准；联盟共享房不能读房间归属的 club_id。 */
    private CurrentRoomClubId():string
    {
        const account:any = GameDataManager.getAccount();
        const reqClubId = this.player && this.player.info ? this.player.info.req_club_id : "";
        return resolveMyRoomClubId(account,reqClubId);
    }

    /** 资料卡/赠送按目标玩家在本房间的入口俱乐部优先，取不到再回退自己的结算俱乐部。 */
    private TargetClubId():string
    {
        const target = this.player && this.player.info ? normalizeRoomClubId(this.player.info.req_club_id) : "";
        const account:any = GameDataManager.getAccount();
        const isSelf = !!(this.player && this.player.info && account && this.player.info.strUserID == account.guuid);
        if(isSelf)
            return resolveMyRoomClubId(account,target);
        return target || this.CurrentRoomClubId();
    }

    onLoad () {
        super.onLoad();

        KBEngine.Event.register("onHallCommand", this, "onHallCommand");

        this.node.getChildByName("msk").on(cc.Node.EventType.TOUCH_START,()=>{
            UIManager.getInstance().closePanelByName(this.node.name,ClosePanelMode.Normal);
        },this);
    }

    start () {
        if(this.arrayEx.length>0)
        {
            this.player = this.arrayEx[0];
            const roomClubId = this.TargetClubId();

            if(this.player.info.strUserID == GameDataManager.getAccount().guuid) //自己显示充值
            {
                Tool.GetChild(this.node,"数据/赠送").active = false;
                // 俱乐部房间没有平台金币充值入口，积分不足应联系代理上分。
                Tool.GetChild(this.node,"数据/充值").active = roomClubId === "";
            }
            else
            {
                Tool.GetChild(this.node,"数据/赠送").active = roomClubId !== "";
                Tool.GetChild(this.node,"数据/充值").active = false;
            }
        }
        else
        {
            UIManager.getInstance().closePanelByName(this.node.name,ClosePanelMode.Normal);
        }

        Tool.GetChild(this.node,"数据/id").getComponent(cc.Label).string = this.player.info.strUserID;
        Tool.GetChild(this.node,"数据/name").getComponent(cc.Label).string = this.player.info.strUserName;
        let img = Tool.GetChild(this.node,"数据/头像/mask/img").getComponent(cc.Sprite);
        if (!ImageManager.getInstance().GetImageByName(this.player.info.strUserID, this.player.info.strPhoto, img))
        {
            ImageManager.getInstance().AddWaitFreshImage2Catch(this.player.info.strUserID, img);
        }

        Tool.GetChild(this.node,"数据/屏蔽语音").getComponent(cc.Toggle).isChecked = this.player.gameLogic.CheckNoAudio(this.player.info.strUserID)
        this.UpdateInfo();
        this.RefreshViewButton();

        this.RefreshPropPriceLabels();
        this.GetVipInfo()
    }

    /**
     * 十个道具按钮下面的价签：Prefab 里写死的是「0.1」（原金币元价），
     * 道具改成扣钻石后必须按后台配置刷新，否则显示的价格与实际扣费对不上。
     * 面板每次打开都会新建，进大厅时价格已下发，所以这里刷一次就够。
     */
    private RefreshPropPriceLabels()
    {
        let nCost = ConfigManager.getInstance().GetConsumeStone(ConfigManager.CONSUME_PROP);
        let box = Tool.GetChild(this.node,"数据/道具");
        if(box == null)
            return;
        for(let one of box.children)
        {
            let priceNode = Tool.GetChild(one,"label copy");
            let label = priceNode == null ? null : priceNode.getComponent(cc.Label);
            if(label != null)
                label.string = String(nCost);
        }
    }

    // update (dt) {}
    public onButtonClick(button:cc.Button)
    {
        if(button.node.name === "关闭")
        {
            UIManager.getInstance().closePanelByName(this.node.name,ClosePanelMode.Normal);
        }
        else if(button.node.name === "复制ID")
        {
            let strID = Tool.GetChild(this.node,"数据/id").getComponent(cc.Label).string.trim();
            if(strID === "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"玩家ID为空，暂时无法复制！");
                return;
            }
            let copied = MobileManager.getInstance().CopyToPhone(strID);
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,copied ? "玩家ID复制成功！" : "玩家ID复制失败，请稍后重试！");
        }
        else if(button.node.name === "查看")
        {
            this.OnClickViewStats();
        }
        else if(button.node.parent.name === "道具")
        {
            let nCost = ConfigManager.getInstance().GetConsumeStone(ConfigManager.CONSUME_PROP);
            if(Number(GameDataManager.getAccount().stone) < nCost)
            {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "钻石不足，无法使用道具!");
                return;
            }

            let strParam = ConfigManager.getInstance().BuildConsumeStoneParam(ConfigManager.CONSUME_PROP);
            GameDataManager.getAccount().reqGameCommand(strParam, "玩家_消费_命令");
            GameDataManager.getAccount().reqSay("@@道具@@" + button.node.name + "@" + this.player.info.strUserID, GameDataManager.getInstance().nSelfPlayerSit);

            UIManager.getInstance().closePanelByName(this.node.name);
        }
        else if(button.node.name === "赠送")
        {
            const clubId = this.TargetClubId();
            if(clubId === "")
                return;
            const userData = JSON.stringify({userId:this.player.info.strUserID,clubId});
            UIManager.getInstance().showPanel("panelGivePad",ShowPanelMode.Cover,userData);
        }
        else if(button.node.name === "语音回放")
        {
            let strMsg = this.player.gameLogic.GetPlayerLastSay(this.player.info.strUserID);
            if(strMsg != "")
            {
                Debug.Log("开始回放"+strMsg);
                //替换座位号
                let json = JSON.parse(strMsg);
                let oldSit = json["number"];
                json["number"] = this.player.info.nSitNum;
                let temp:string = json["word"];
                temp = temp.replace(oldSit+":@@",this.player.info.nSitNum+":@@");
                json["word"] = temp;
                strMsg = JSON.stringify(json);
                Debug.Log("处理后"+strMsg);
                this.player.gameLogic.OnPlayerSay(strMsg);
                UIManager.getInstance().closePanelByName(this.node.name);
            }
            else
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"没有语音!");
            }
        }
        else if(button.node.name == "屏蔽语音")
        {

        }
        else if(button.node.name === "充值")
        {
            WebLoadingManager.loadBlockingRes("Prefabs/钱包","正在加载钱包",(err,obj)=>{
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
                node.parent =this.node.parent;
            });
        }
        else if(button.node.name == "开通VIP")
        {
            UIManager.getInstance().showPanel("panelVipInfo",ShowPanelMode.Cover)
        }
    }
    public onToggleClick(toggle:cc.Toggle)
    {
        if(toggle.node.name === "屏蔽语音" && toggle.isChecked)
        {
            this.player.gameLogic.AddNoAudio(this.player.info.strUserID);
        }
    }
    public UpdateInfo()
    {
        // 未付费时保持设计稿占位：上排 **、下排 -，避免先看到真实输赢。
        if(!this.statsUnlocked)
        {
            this.SetStatLabel("总手数","**");
            this.SetStatLabel("总胜率","**");
            this.SetStatLabel("失败率","**");
            this.SetStatLabel("胜利","-");
            this.SetStatLabel("平局","-");
            this.SetStatLabel("失败","-");
            return;
        }

        let strParam:string = this.player.info.remark;
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
        let nLosePer = nTotle > 0 ? nLose * 100 / nTotle : 0;

        let nFanWin = Number(arrayParam[3])>0?Number(arrayParam[5])*100/Number(arrayParam[3]):0;

        let nRuChi = nTotle > 0 ? nRu * 100 / nTotle : 0;

        this.SetStatLabel("总手数",nTotle.toString());
        this.SetStatLabel("总胜率",nWinPer.toFixed(0).toString()+"%");
        this.SetStatLabel("失败率",nLosePer.toFixed(0).toString()+"%");
        this.SetStatLabel("胜利",nWin.toString());
        this.SetStatLabel("平局",nHe.toString());
        this.SetStatLabel("失败",nLose.toString());

        // 以下三项在 Prefab 里隐藏，保留原有 VIP 逻辑，后续启用时直接显示。
        this.SetStatLabel("入池率",this.bIsVip?(nRuChi.toFixed(0).toString()+"%"):"*");
        this.SetStatLabel("翻牌率",this.bIsVip?(nFanPer.toFixed(0).toString()+"%"):"*");
        this.SetStatLabel("翻牌胜率",this.bIsVip?(nFanWin.toFixed(0).toString()+"%"):"*");
    }

    private SetStatLabel(strName:string,strValue:string)
    {
        let node = Tool.GetChild(this.node,"数据/统计/" + strName);
        let label = node == null ? null : node.getComponent(cc.Label);
        if(label != null)
            label.string = strValue;
    }

    /** 按钮文案跟随后台「看数据」价格；已查看后隐藏，避免重复扣费。 */
    private RefreshViewButton()
    {
        let btn = Tool.GetChild(this.node,"数据/统计/查看");
        if(btn == null)
            return;
        btn.active = !this.statsUnlocked;
        if(this.statsUnlocked)
            return;
        let labelNode = btn.getChildByName("V8文字");
        let label = labelNode == null ? null : labelNode.getComponent(cc.Label);
        if(label == null)
            return;
        let nCost = ConfigManager.getInstance().GetConsumeStone(ConfigManager.CONSUME_LOOK_DATA);
        label.string = nCost > 0 ? "查看（扣除" + nCost + "钻石）" : "查看输赢统计";
    }

    private OnClickViewStats()
    {
        if(this.statsUnlocked)
            return;
        let nCost = ConfigManager.getInstance().GetConsumeStone(ConfigManager.CONSUME_LOOK_DATA);
        if(nCost > 0 && Number(GameDataManager.getAccount().stone) < nCost)
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"钻石不足" + nCost + "，无法查看数据！");
            return;
        }
        if(nCost <= 0)
        {
            this.UnlockStats(0);
            return;
        }
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,
            "查看该玩家的输赢统计将扣除" + nCost + "钻石，是否继续？",[(confirmed:boolean)=>{
                if(confirmed)
                    this.UnlockStats(nCost);
            }]);
    }

    private UnlockStats(nCost:number)
    {
        if(this.statsUnlocked || !cc.isValid(this.node))
            return;
        this.statsUnlocked = true;
        this.UpdateInfo();
        this.RefreshViewButton();
        if(nCost > 0)
        {
            let strParam = ConfigManager.getInstance().BuildConsumeStoneParam(ConfigManager.CONSUME_LOOK_DATA);
            GameDataManager.getAccount().reqHallCommand(strParam, "玩家_消费_命令");
        }
    }

    public GetVipInfo()
    {
        //更新vip信息
        let strParam = "{\"header\":\"玩家_查询_VIP\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@玩家_查询_VIP");
    }

    public onHallCommand(nCode:number, param:string)
    {
        if (param.indexOf("玩家_查询_VIP") >= 0)
        {
            if (nCode == 0x200)
            {
                //更新vip信息
                let msg = JSON.parse(param);
                let data = msg["result"];
                if(data["is_vip"] == 1)
                {
                    this.bIsVip = true
                }
                else
                {
                    this.bIsVip = false
                }
                this.UpdateInfo()
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
