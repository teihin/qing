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

        let confirmButton = this.node.getChildByName("bk").getChildByName("确定");
        let cancelButton = this.node.getChildByName("bk").getChildByName("取消");
        let isConfirmation = this.arrayEx != null && typeof this.arrayEx[0] === "function";
        cancelButton.active = isConfirmation;
        if(isConfirmation)
        {
            confirmButton.x = 155;
            confirmButton.y = -150;
            cancelButton.x = -155;
            cancelButton.y = -150;
        }

    }

    // update (dt) {}

    onButtonClick(button:cc.Button)
    {
        if(button.node.name == "取消" || button.node.name == "确定")
        {
            let callback = this.arrayEx != null && typeof this.arrayEx[0] === "function" ? this.arrayEx[0] : null;
            let confirmed = button.node.name == "确定";
            UIManager.getInstance().closePanelByName(this.node.name);
            if(callback != null)
                callback(confirmed);
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
