import UIManager from "./common/UIManager";
import { ShowPanelMode } from "./common/GameDef";
import UIResize from "./common/UIResize";
import Debug from "./common/Debug";
import GameDataManager from "./GameDataManager";

const {ccclass, property} = cc._decorator;

@ccclass
export default class StartGameManager extends cc.Component {


    onLoad () {

        cc.debug.setDisplayStats(false);
        
        if(GameDataManager.getInstance().bLoginSuccess)
        {
            Debug.Log("11111111111");
            UIManager.getInstance().showPanel("panelMain",ShowPanelMode.CloseOther);
        }
        else
        {
            Debug.Log("2222222");
            //启动更新窗口
            UIManager.getInstance().showPanel("panelUpdate",ShowPanelMode.CloseOther);
        }

        Debug.Log("进来了！！！！！！！！");
    }

    start () {

    }

    // update (dt) {}
}
