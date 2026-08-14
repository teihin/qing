import UIPanelViewBase from "../common/UIPanelViewBase";
import RoomInviteManager, { RoomInviteData } from "../logic/RoomInviteManager";
import Tool from "../common/Tool";

const {ccclass} = cc._decorator;

@ccclass
export default class panelRoomInvite extends UIPanelViewBase {
    private invite:RoomInviteData = null;
    private suppressToggle:cc.Toggle = null;

    start()
    {
        super.start();
        try
        {
            this.invite = JSON.parse(this.strUserData);
        }
        catch(error)
        {
            this.invite = null;
        }

        if(this.invite == null)
        {
            RoomInviteManager.getInstance().handleDialogAction(null, false, false);
            return;
        }
        if(Number(this.invite.expiresAt || 0) <= Date.now())
        {
            RoomInviteManager.getInstance().handleDialogAction(this.invite, false, false);
            return;
        }

        let inviter = this.invite.inviterName == null || this.invite.inviterName == "" ? "牌友" : this.invite.inviterName;
        let inviterID = this.invite.inviterID == null || this.invite.inviterID == "" ? "--" : this.invite.inviterID;
        Tool.GetChild(this.node, "卡片/邀请人").getComponent(cc.Label).string = inviter + "（ID：" + inviterID + "）邀请你加入";
        Tool.GetChild(this.node, "卡片/房间信息/房间号").getComponent(cc.Label).string = this.invite.roomID.toString();

        let people = "--";
        if(this.invite.maxPlayers > 0)
            people = this.invite.currentPlayers.toString() + "/" + this.invite.maxPlayers.toString();
        Tool.GetChild(this.node, "卡片/房间详情").getComponent(cc.Label).string = "底皮  " + (this.invite.bottom || "--") + "     当前人数  " + people;
        Tool.GetChild(this.node, "卡片/邀请文案").getComponent(cc.Label).string = this.invite.text || "房间正在等待玩家，点击前往即可加入";
        this.suppressToggle = Tool.GetChild(this.node, "卡片/本次登录不再弹出").getComponent(cc.Toggle);
        this.suppressToggle.isChecked = false;
        if(this.suppressToggle.checkMark != null && this.suppressToggle.checkMark.node != null)
            this.suppressToggle.checkMark.node.active = false;
    }

    onButtonClick(button:cc.Button)
    {
        if(button.node.name == "忽略")
        {
            RoomInviteManager.getInstance().handleDialogAction(this.invite, false, this.suppressToggle != null && this.suppressToggle.isChecked);
        }
        else if(button.node.name == "前往")
        {
            RoomInviteManager.getInstance().handleDialogAction(this.invite, true, this.suppressToggle != null && this.suppressToggle.isChecked);
        }
    }
}
