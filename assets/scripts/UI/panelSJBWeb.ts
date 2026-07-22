import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import Debug from "../common/Debug";

const {ccclass, property} = cc._decorator;

@ccclass
export default class panelSJBWeb extends UIPanelViewBase {

    private strKF:string = ""
    private loading:cc.ProgressBar = null;

    

    private web:cc.WebView = null;
    onLoad () {
        super.onLoad();
    }

    start () {

        this.web = this.node.getChildByName("web").getComponent(cc.WebView);
 
        this.web.url = this.strUserData;

        //显示进度
        this.loading = Tool.GetChild(this.node,"进度/img").getComponent(cc.ProgressBar);
        this.loading.progress = 0;
        this.schedule(this.UpdateProgress,0.01,1000,0.1);


        
        this.scheduleOnce(()=>{
            this.loading.progress = 1;
            this.unschedule(this.UpdateProgress);
        },6);
        



    }
    public UpdateProgress()
    {
        this.loading.progress = this.loading.progress+0.001;
    }

    // update (dt) {}

    public onButtonClick(button:cc.Button)
    {
        if(button.node.name === "关闭上层")
        {
            button.node.parent.active = false;
        }
        else if(button.node.name === "关闭上上层")
        {
            button.node.parent.parent.active = false;
        }
        else if(button.node.name === "关闭")
        {
            UIManager.getInstance().closePanelByName(this.node.name);
        }
        else if(button.node.name === "弹出")
        {
            cc.sys.openURL(this.web.url);
        }
    }
}
