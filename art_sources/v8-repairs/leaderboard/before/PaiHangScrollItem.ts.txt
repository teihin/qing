import panelMain from "../UI/panelMain";
import UIPanelViewBase from "./UIPanelViewBase";
import ScrollItemBase from "./ScrollItemBase";
import Debug from "./Debug";

const { ccclass, property } = cc._decorator;

@ccclass
export default class PaiHangScrollItem  extends ScrollItemBase {
    public Refresh(jRoom:any){

        this.node.active = true;
        Debug.Log(jRoom.toString());
        this.node.getChildByName("idx").getComponent(cc.Label).string = jRoom["user_no"];
        this.node.getChildByName("name").getComponent(cc.Label).string = jRoom["user_name"]+"\r\n"+jRoom["user_guuid"];
        this.node.getChildByName("played_count").getComponent(cc.Label).string = jRoom["activity_num"];
        this.node.getChildByName("user_reward").getComponent(cc.Label).string = jRoom["user_reward"];

        this.node.getChildByName("proxy_guuid").getComponent(cc.Label).string = jRoom["proxy_guuid"];
        this.node.getChildByName("proxy_reward").getComponent(cc.Label).string = jRoom["proxy_reward"];
    }
}

