import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import GameDataManager from "../GameDataManager";
import Tool from "../common/Tool";

const {ccclass, property} = cc._decorator;

@ccclass
export default class panelMsgView extends UIPanelViewBase {


    // onLoad () {}

    start () {
        super.start();

        if(this.node.name.indexOf("panelNotifyView")>=0)
            this.strUserData = Tool.Base64Decode(this.strUserData);
        this.node.getChildByName("bk").getChildByName("msg").getComponent(cc.Label).string = this.strUserData;

    }

    // update (dt) {}

    onButtonClick(button:cc.Button)
    {
        if(button.node.name == "取消" || button.node.name == "确定")
        {
            UIManager.getInstance().closePanelByName(this.node.name); 
        }
        else if(button.node.name === "切换账号")
        {
            cc.sys.localStorage.setItem("unionid","");
            cc.sys.localStorage.setItem("pass","");
            GameDataManager.getInstance().bLoginSuccess = false;
            cc.game.restart();
        }
    }
}
