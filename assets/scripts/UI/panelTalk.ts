import UIPanelViewBase from "../common/UIPanelViewBase";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import UIManager from "../common/UIManager";
import DrhLogicMgr from "../logic/DrhLogicMgr";
import ScrollViewEx from "../common/ScrollViewEx";
import { ShowPanelMode } from "../common/GameDef";
import WebLoadingManager from "../common/WebLoadingManager";

var KBEngine = require("kbengine");
const {ccclass, property} = cc._decorator;

@ccclass
export default class panelTalk extends UIPanelViewBase {


    private gameLogic:DrhLogicMgr = null;
    private scrollMsg:ScrollViewEx = null;
    onLoad () {
        super.onLoad();
        KBEngine.Event.register("set_gold", this, "set_gold");
        KBEngine.Event.register("set_gold2", this, "set_gold");

        KBEngine.Event.register("SayInfo", this, "OnPlayerSay"); //语音

        this.node.on(cc.Node.EventType.TOUCH_START,()=>{
            UIManager.getInstance().closePanelByName(this.node.name);
        },this);
    }

    start () {
        
        this.set_gold(0);
        this.InitMsgList();
    }

    // update (dt) {}
    set_gold(num:number)
    {
        let item =  Tool.GetChild(this.node,"bk/gold");
        if(item != null)
            item.getComponent(cc.Label).string = GameDataManager.getAccount().gold.toString()+(GameDataManager.getAccount().gold2==0?"":("."+GameDataManager.getAccount().gold2.toString().padStart(2,"0")));
    }
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
        else if(button.node.parent.name === "list")
        {
            //获取表情图片名
            let strMsg = "@BQ" + button.node.name;
            GameDataManager.getAccount().reqSay(strMsg, GameDataManager.getInstance().nSelfPlayerSit);
            UIManager.getInstance().closePanelByName(this.node.name);
        }
        else if(button.node.name === "发送")
        {
            let strMsg = Tool.GetChild(this.node,"文本").getComponent(cc.EditBox).string;
            if(strMsg == "")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入文本！");
                return;
            }
            //校验文本内容
            var check = /[0-9a-zA-Z]/;
            if(check.test(strMsg))
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"聊天不能包含非中文内容！");
                return;
            }

            strMsg = this.CheckMsg(strMsg);

            GameDataManager.getAccount().reqSay("@SS"+ GameDataManager.getAccount().name+":"+ strMsg, GameDataManager.getAccount().nSelfPlayerSit);
            Tool.GetChild(this.node,"文本").getComponent(cc.EditBox).string = "";
        }
    }
    private CheckMsg(strMsg:string):string
    {
        strMsg = strMsg.replace(RegExp(" ",'g'),"");
        strMsg = strMsg.replace(RegExp("微信",'g'),"*");
        strMsg = strMsg.replace(RegExp("威信",'g'),"*");
        strMsg = strMsg.replace(RegExp("某信",'g'),"*");
        strMsg = strMsg.replace(RegExp("某微",'g'),"*");
        strMsg = strMsg.replace(RegExp("扣扣",'g'),"*");
        strMsg = strMsg.replace(RegExp("某扣",'g'),"*");
        strMsg = strMsg.replace(RegExp("加扣",'g'),"*");
        strMsg = strMsg.replace(RegExp("红利",'g'),"*");
        strMsg = strMsg.replace(RegExp("返利",'g'),"*");
        strMsg = strMsg.replace(RegExp("全返",'g'),"*");
        strMsg = strMsg.replace(RegExp("加微",'g'),"*");
        strMsg = strMsg.replace(RegExp("微",'g'),"*");
        strMsg = strMsg.replace(RegExp("信",'g'),"*");
        strMsg = strMsg.replace(RegExp("扣",'g'),"*");
        return strMsg;
    }

    private InitMsgList()
    {
        this.gameLogic = this.node.parent.getChildByName("panelGameView").getComponent(DrhLogicMgr);

        if(Tool.GetChild(this.node ,"聊天") == null)
            return;

        this.scrollMsg = Tool.GetChild(this.node ,"聊天").getComponent(ScrollViewEx);

        for (let one of this.gameLogic.arrayTalkMsg)
        {
            WebLoadingManager.loadBlockingRes("Prefabs/聊天对象","正在加载聊天记录",(err,obj)=>{
                if(err)
                {
                    cc.error(err.message || err);
                    return null;
                }
                let add:cc.Node = cc.instantiate(obj);
                add.parent = this.scrollMsg.content;
                add.getComponent(cc.Label).string = one;
                add.getComponent(cc.Label).fontSize = 25;
                if(this.scrollMsg.content.childrenCount>10)
                {
                    this.scrollMsg.content.children[0].destroy();
                }
                this.scrollMsg.scrollToBottom(0.3);
            });
        }
    }
    public OnPlayerSay(strMsg:string)
    {
        if (this.node.name != "panelTalkMsg")
            return;

        
        let data = JSON.parse(strMsg);
        let nSitNum = Number(data["number"].toString());
        let strWord:string = data["word"].toString();
        let nPos = strWord.indexOf(":");
        if (nPos > 0 && nPos < 4)
        {
            let strRealSit = strWord.substr(0, nPos);
            nSitNum = Number(strRealSit);
            strWord = strWord.substr(nPos + 1);
        }



        //处理文字消息
        if (strWord.indexOf("@SS") != 0)
            return;

        strWord = strWord.replace("@SS","");

        WebLoadingManager.loadBlockingRes("Prefabs/聊天对象","正在加载聊天记录",(err,obj)=>{
            if(err)
            {
                cc.error(err.message || err);
                return null;
            }
            let add:cc.Node = cc.instantiate(obj);
            add.parent = this.scrollMsg.content;
            add.getComponent(cc.Label).string = strWord;
            add.getComponent(cc.Label).fontSize = 25;
            if(this.scrollMsg.content.childrenCount>10)
            {
                this.scrollMsg.content.children[0].destroy();
            }
            this.scrollMsg.scrollToBottom(0.3);
        });
    
    }
}
