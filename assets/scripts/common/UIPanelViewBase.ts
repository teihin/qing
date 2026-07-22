import UIViewBase from "./UIViewBase";

const {ccclass, property} = cc._decorator;

@ccclass
export default class UIPanelViewBase extends UIViewBase {
    //页面扩展数据
    public strUserData:string  = "";
    public arrayEx:any[] = [];

}
