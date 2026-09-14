import ScrollItemBase from "./ScrollItemBase";

const { ccclass, property } = cc._decorator;

@ccclass
export default class PaiHangScrollItem  extends ScrollItemBase {
    public static number(value:any, signed:boolean = false):string {
        if (value === null || value === undefined || value === "") return "—";
        let text = String(value).replace(/,/g, "");
        if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return "—";
        if (signed && Number(text) > 0 && text.charAt(0) !== "+") text = "+" + text;
        const parts = text.split(".");
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        return parts.join(".");
    }

    public Refresh(jRoom:any, signed:boolean = false){
        this.node.active = true;
        const rank = Number(jRoom.user_no);
        const medal = rank >= 1 && rank <= 3 && Math.floor(rank) === rank;
        const idx = this.node.getChildByName("idx");
        idx.active = !medal;
        idx.getComponent(cc.Label).string = PaiHangScrollItem.number(jRoom.user_no);
        for (let n = 1; n <= 3; n++) this.node.getChildByName("V8皇冠" + n).active = medal && rank === n;
        this.node.getChildByName("name").getComponent(cc.Label).string = String(jRoom.user_name || "—");
        const id = jRoom.user_guuid != null ? jRoom.user_guuid : jRoom.proxy_guuid;
        this.node.getChildByName("V8玩家ID").getComponent(cc.Label).string = "ID:" + (id == null || id === "" ? "—" : id);
        this.node.getChildByName("played_count").getComponent(cc.Label).string = PaiHangScrollItem.number(jRoom.activity_num, signed);
        this.node.getChildByName("user_reward").getComponent(cc.Label).string = PaiHangScrollItem.number(jRoom.user_reward);
        this.node.getChildByName("proxy_guuid").active = false;
        this.node.getChildByName("proxy_reward").active = false;
    }
}
