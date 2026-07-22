import ScrollViewEx from "./ScrollViewEx";

const {ccclass, property} = cc._decorator;

@ccclass
export default class PageEx extends cc.Component {

    @property(ScrollViewEx)
    scrollView:ScrollViewEx = null; //分页绑定的滚动条对象

    onLoad () {
        this.scrollView = this.node.parent.getComponentInChildren(ScrollViewEx);       

        this.node.getChildByName("首页").on("click",()=>{
            if(this.scrollView.callBackFresh == null)
                return;
            this.scrollView.callBackFresh(0);
        },this);
        this.node.getChildByName("上一页").on("click",()=>{
            if(this.scrollView.callBackFresh == null)
                return;
            if(this.scrollView.nCurPage == 0)
                return;
            this.scrollView.callBackFresh(this.scrollView.nCurPage-1);
        },this);
        this.node.getChildByName("下一页").on("click",(event:cc.Event.EventTouch)=>{
            if(this.scrollView.callBackFresh == null)
                return;
            if(this.scrollView.nCurPage+1>=this.scrollView.nTotlePage)
                return;
            this.scrollView.callBackFresh(this.scrollView.nCurPage+1);
        },this);
        this.node.getChildByName("尾页").on("click",(event:cc.Event.EventTouch)=>{
            if(this.scrollView.callBackFresh == null)
                return;
            if(this.scrollView.nTotlePage == 0)
                return;
            this.scrollView.callBackFresh(this.scrollView.nTotlePage-1);
        },this);
    }

    start () {

    }

    // update (dt) {}
}
