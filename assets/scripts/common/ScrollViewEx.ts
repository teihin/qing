import { ScrollEvent } from "./GameDef";
import Debug from "./Debug";
import PageEx from "./PageEx";


const {ccclass, property} = cc._decorator;

@ccclass
export default class ScrollViewEx extends cc.ScrollView {
    @property
    nCurPage:number = 0;

    @property
    nTotlePage:number = 0;

    @property
    nCount:number = 0;

    @property
    LastEvent:ScrollEvent = ScrollEvent.Normal;

    @property(PageEx)
    page:PageEx = null;

    public callBackFresh:Function = null; //列表刷新方法
    

    private nOldPadBottom:number = 0;

    start () {

        //找到Page控件
        this.page = this.node.parent.getComponentInChildren(PageEx);

        this.node.on(cc.Node.EventType.TOUCH_START,()=>{
            //this.nOldPadBottom = this.content.getComponent(cc.Layout).paddingBottom;
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
                // Debug.Log("当前pad:"+this.content.getComponent(cc.Layout).paddingBottom);
            }
        },this);

        this.node.on(cc.Node.EventType.TOUCH_END,()=>{
           // this.content.getComponent(cc.Layout).paddingBottom = this.nOldPadBottom;
        },this);

        this.node.on(cc.Node.EventType.TOUCH_CANCEL,()=>{
          //  this.content.getComponent(cc.Layout).paddingBottom = this.nOldPadBottom;
        },this);
    }


    modifyScrollPos(pos:cc.Vec2)
    {        
        Debug.Log("LastEvent:"+this.LastEvent);
        if(this.LastEvent === ScrollEvent.Normal && this.nCurPage === 0)
        {
            this.scrollToTop();
            return;
        }
        
        if(this.LastEvent == ScrollEvent.Normal)
            this.scrollTo(pos);
        else if(this.LastEvent === ScrollEvent.ToTop)
        {
            this.scrollToTop();
        }
        else if(this.LastEvent === ScrollEvent.ToBottom)
        {
            this.scrollToBottom();
        }                    
    }
    //兼容新服务器返回方式 ON回调
    public UpdateListEx(strMsg:string,strKey:string,strPreName:string,nPageLen:number,actionSetInfo:Function)
    {
        
    }

    public UpdateList(strMsg:string,strKey:string,strPreName:string,nPageLen:number,actionSetInfo:Function)
    {
        let data = JSON.parse(strMsg);
        if(data == null)
            return;

        let jList = data[strKey];
        if(jList == null)
            return;
        for(let i=0;i<jList.length;i++)
        {
            let jItem = jList[i];
            if(jItem.hasOwnProperty("number"))
            {
                this.nCurPage = Number(jItem["number"]);
            }
            if(jItem.hasOwnProperty("count"))
            {
                this.nTotlePage = Math.ceil(Number(jItem["count"])/Number(nPageLen));
                this.nCount = Number(jItem["count"]);
            }        

            if(i>=this.content.childrenCount)
            {
                cc.loader.loadRes("Prefabs/"+strPreName,(err,obj)=>{
                    if(err)
                    {
                        cc.error(err.message || err);
                        return null;
                    }
                    let node:cc.Node = cc.instantiate(obj);
                    node.parent = this.content;
                    actionSetInfo(node,jItem);  
                    node.setSiblingIndex(i);                  
                });
            }
            else
            {
                actionSetInfo(this.content.children[i],jItem);
            }
        }

        //如果分页在外面
        if(data.hasOwnProperty("number"))
        {
            this.nCurPage = Number(data["number"]);
        }
        if(data.hasOwnProperty("count"))
        {
            this.nTotlePage = Math.ceil(Number(data["count"])/Number(nPageLen));
            this.nCount = Number(data["count"]);
        }    


        //兼容cs系统
        if(data.hasOwnProperty("pageIndex"))
        {
            this.nCurPage = Number(data["pageIndex"]);
        }
        if(data.hasOwnProperty("pageNum"))
        {
            this.nTotlePage = data["pageNum"]
        }  
        if(data.hasOwnProperty("rowsTotal"))
        {
            this.nCount = Number(data["rowsTotal"]);
        }


        //多余的对象全部删除
        let arrayDel = new Array<cc.Node>();
        for(let i=jList.length;i<this.content.childrenCount;i++)
        {
            arrayDel.push(this.content.children[i]);
        }
        for(let item of arrayDel)
        {
            item.destroy();
        }
        if(this.page != null)
        {
            if(this.nTotlePage>0)
                this.page.node.getChildByName("页码").getComponent(cc.Label).string =  (data.hasOwnProperty("pageIndex")?this.nCurPage.toString():(this.nCurPage+1).toString())+"/"+this.nTotlePage.toString();
            else
                this.page.node.getChildByName("页码").getComponent(cc.Label).string = "0";
        }
            
    }
}
