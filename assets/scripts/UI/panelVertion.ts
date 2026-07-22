import UIPanelViewBase from "../common/UIPanelViewBase";
import ConfigManager from "../logic/ConfigManager";

const {ccclass, property} = cc._decorator;

@ccclass
export default class panelVertion extends UIPanelViewBase {

    public onButtonClick(button:cc.Button)
    {
        if(button.node.name == "确定")
        {
            cc.sys.openURL(ConfigManager.getInstance().GetDownLoadUrl());
        }
        else if(button.node.name == "取消")
        {
            cc.game.end();
        }
    }
}
