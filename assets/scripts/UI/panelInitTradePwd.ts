import UIPanelViewBase from "../common/UIPanelViewBase";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import UIManager from "../common/UIManager";
import {ShowPanelMode, ClosePanelMode} from "../common/GameDef";

const {ccclass} = cc._decorator;

/**
 * 初始化交易密码独立 Prefab。
 * 从「玩家信息 - 上下分」等深层弹窗进入时，挂在 Canvas/Top，
 * 避免原来作为 panelMain 子节点被上层界面盖住。
 */
@ccclass
export default class panelInitTradePwd extends UIPanelViewBase {

    onButtonClick(button:cc.Button):void {
        const name = button == null || button.node == null ? "" : button.node.name;
        if(name === "关闭上上层") {
            this.Close();
            return;
        }
        if(name === "确定初始化交易密码") {
            this.Submit();
            return;
        }
        super.onButtonClick(button);
    }

    private Submit():void {
        const newPwd1 = Tool.GetChild(this.node,"列表/新密码1/txt");
        const newPwd2 = Tool.GetChild(this.node,"列表/新密码2/txt");
        const strNewPwd1 = newPwd1 == null ? "" : newPwd1.getComponent(cc.EditBox).string;
        const strNewPwd2 = newPwd2 == null ? "" : newPwd2.getComponent(cc.EditBox).string;
        if(strNewPwd1 === "") {
            this.Show("请输入新密码");
            return;
        }
        if(strNewPwd2 === "") {
            this.Show("请再次输入新密码");
            return;
        }
        if(strNewPwd1 !== strNewPwd2) {
            this.Show("两次密码输入不一致");
            return;
        }
        const account:any = GameDataManager.getAccount();
        if(account == null || typeof account.reqHallCommand !== "function") {
            this.Show("游戏连接尚未就绪，请稍后再试");
            return;
        }
        const strParam = JSON.stringify({header:"修改_玩家_交易密码",old_pwd:"",new_pwd:strNewPwd1});
        account.reqHallCommand(strParam,"P@修改_玩家_交易密码");
    }

    /** 「修改_玩家_交易密码」回包由 panelMain 统一接收后转发到这里收尾。 */
    public OnSubmitResult(nCode:number,param:string):void {
        if(nCode === 0x200) {
            this.Close();
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Top,"交易密码设置成功！");
            return;
        }
        this.Show(this.ParseError(param));
    }

    private ParseError(param:string):string {
        try {
            const msg:any = JSON.parse(param);
            const result:any = msg == null ? null : msg["result"];
            if(result != null && result["error"] != null && result["error"].toString().trim() !== "")
                return result["error"].toString();
            if(msg != null && msg["error"] != null && msg["error"].toString().trim() !== "")
                return msg["error"].toString();
        }
        catch(error) {}
        return "设置失败，请稍后再试";
    }

    private Show(message:string):void {
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Top,message);
    }

    private Close():void {
        UIManager.getInstance().closePanelByName(this.node.name,ClosePanelMode.Top);
    }
}
