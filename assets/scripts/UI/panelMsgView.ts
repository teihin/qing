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
        this.SetMessage(this.strUserData);

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

    /**
     * 普通提示框仍使用固定 Label；大厅“游戏公告”Prefab 使用可滚动内容区。
     * 统一在这里赋值并刷新实际文本高度，避免长公告被固定高度裁掉。
     */
    private SetMessage(message:string)
    {
        let messageRoot = this.node.getChildByName("bk").getChildByName("msg");
        let label = messageRoot.getComponent(cc.Label);
        let scrollView = messageRoot.getComponent(cc.ScrollView);
        if(label == null)
        {
            let content = Tool.GetChild(messageRoot,"view/content/msg");
            label = content == null ? null : content.getComponent(cc.Label);
        }
        if(label == null)
            return;

        message = Tool.NormalizeMultilineText(message);
        label.string = message;
        if(scrollView == null || scrollView.content == null)
            return;

        this.scheduleOnce(() =>
        {
            if(!cc.isValid(this.node) || !cc.isValid(label.node) || !cc.isValid(scrollView.node))
                return;
            let forceUpdate = (label as any)._forceUpdateRenderData;
            if(typeof forceUpdate === "function")
                forceUpdate.call(label, true);
            let explicitLineHeight = Math.max(label.lineHeight, message.split("\n").length * label.lineHeight);
            label.node.height = Math.max(label.node.height, explicitLineHeight);
            scrollView.content.height = Math.max(scrollView.node.height, label.node.height + 40);
            scrollView.stopAutoScroll();
            scrollView.scrollToTop(0);
        },0);
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
