import UIPanelViewBase from "../common/UIPanelViewBase";

const {ccclass, property} = cc._decorator;

@ccclass
export default class panelVertion extends UIPanelViewBase {

    public onButtonClick(button:cc.Button)
    {
        if(button.node.name === "确定" || button.node.name === "取消")
            cc.game.end();
    }
}
