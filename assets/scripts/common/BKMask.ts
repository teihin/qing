const {ccclass, property} = cc._decorator;

@ccclass
export default class BKMask extends cc.Component {


    onLoad () {
        //拦截穿越的所有消息
        this.node.on(cc.Node.EventType.TOUCH_START,(event:cc.Event.EventTouch)=>{
            event.stopPropagation();
        },this);
        this.node.on(cc.Node.EventType.TOUCH_END,(event:cc.Event.EventTouch)=>{
            event.stopPropagation();
        },this);
        this.node.on(cc.Node.EventType.TOUCH_CANCEL,(event:cc.Event.EventTouch)=>{
            event.stopPropagation();
        },this);
        this.node.on(cc.Node.EventType.TOUCH_MOVE,(event:cc.Event.EventTouch)=>{
            event.stopPropagation();
        },this);
    }

    start () {

    }

    // update (dt) {}
}
