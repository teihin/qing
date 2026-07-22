import GameDataManager from "../GameDataManager";
import Debug from "../common/Debug";


const {ccclass, property} = cc._decorator;

@ccclass
export default class test extends cc.Component {

    onDisable()
    {
        Debug.Log("被隐藏！");
    }
}
