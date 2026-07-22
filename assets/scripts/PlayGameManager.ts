import UIManager from "./common/UIManager";
import { ShowPanelMode } from "./common/GameDef";
import UIResize from "./common/UIResize";
import Debug from "./common/Debug";
import GameDataManager from "./GameDataManager";

const {ccclass, property} = cc._decorator;

@ccclass
export default class PlayGameManager extends cc.Component {


    onLoad () {

        
        Debug.Log("当前场景名:"+cc.director.getScene().name);

        //启动更新窗口
        UIManager.getInstance().showPanel("panelGameView",ShowPanelMode.CloseOther);
        

    }

    start () {

    }

    // update (dt) {}
}
