import Debug from "./Debug";

const {ccclass, property} = cc._decorator;

@ccclass
export default class ScrollViewNoEnd extends cc.ScrollView {

    @property
    nCurPage:number = 0;

    @property
    nTotlePage:number = 0;

    @property
    nCount:number = 0;

    private nOldPadBottom:number = 0;
    start () {
        this.node.on(cc.Node.EventType.TOUCH_START,()=>{
            // this.nOldPadBottom = this.content.getComponent(cc.Layout).paddingBottom;
            // Debug.Log("开始:"+this.content.height);
        },this);

        this.node.on(cc.Node.EventType.TOUCH_MOVE,(event:cc.Event.EventTouch)=>{
           // Debug.Log("总:"+this.node.height+" content:"+this.content.height);
            
            // if(this.node.height>this.content.height)
            // {
            //     this.content.getComponent(cc.Layout).paddingBottom = this.node.height;//this.node.height-this.content.height-100;
            //     Debug.Log("当前pad:"+this.content.getComponent(cc.Layout).paddingBottom);
            // }

            //实时处理内容高度
            if(this.content.height<this.node.height)
            {
                let span = this.node.height-this.content.height;
                Debug.Log("高度不够:高度差:"+span);
                //补上高度差
                this.content.getComponent(cc.Layout).paddingBottom = span+100;
               Debug.Log("当前pad:"+this.content.getComponent(cc.Layout).paddingBottom);
            }
            else{
                this.content.getComponent(cc.Layout).paddingBottom = 100;
            }

        },this);

        this.node.on(cc.Node.EventType.TOUCH_END,()=>{
           // this.content.getComponent(cc.Layout).paddingBottom = this.nOldPadBottom;
        },this);

        this.node.on(cc.Node.EventType.TOUCH_CANCEL,()=>{
            //this.content.getComponent(cc.Layout).paddingBottom = this.nOldPadBottom;
        },this);
    }

    // update (dt) {}
}
