import panelMain from "../UI/panelMain";
import UIPanelViewBase from "./UIPanelViewBase";

const { ccclass, property } = cc._decorator;

@ccclass
export default class ScrollItemBase extends cc.Component {
    public main:UIPanelViewBase = null;
    /**
     * DataIndex 从0开始，对应EndlessScrollView中Init函数传入的data[]数组的索引
     */
    public DataIndex: number = 0;
    public Refresh(jRoom:any){

    }
}

