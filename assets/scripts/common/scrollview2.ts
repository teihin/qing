import UIPanelViewBase from "./UIPanelViewBase";
import ScrollItemBase from "./ScrollItemBase";
import ScrollViewNoEnd from "./ScrollViewNoEnd";
import Debug from "./Debug";


const { ccclass, property } = cc._decorator;

/**
 * 目前该脚本只支持从上到下ScrollView
 * 同时还起到排版布局的作用，content节点上，无需再附加layout组件，否则会有冲突
 */
@ccclass
export default class scrollview2 extends cc.Component {
    /**
     * view裁剪节点，根据view尺寸，计算可视区域可以显示多少个item
     */
    @property(cc.Node)
    view: cc.Node;
    /**
     * 充当items的父物体
     */
    @property(cc.Node)
    content: cc.Node;
    @property(cc.Node)
    itemPrefab: cc.Node;
    @property(Number)
    itemHeight: number = 0;


    @property(Number)
    paddingTop: number = 10;
    @property(Number)
    paddingBottom: number = 10;
    @property(Number)
    spaceY: number = 20;

    public main:UIPanelViewBase = null;


    private viewItemsCount: number = 0;//view区域能填充的物体数
    private dataCount: number = 0;
    private cacheItems: cc.Node[] = [];
    private cacheCount: number = 0;


    private contentYMin: number = 0;
    private contentYMax: number = 0;

    //子物体Y坐标转换到view节点下的阈值
    //上滑的时候，若子物体y坐标大于topValue，则把上面的item移到下面
    //下滑的时候，若子物体y坐标小于bottomValue，则把下面的item移到上面
    private topValue: number = 0;
    private bottomValue: number = 0;

    private data: any[] = [];



    //初始数据
    private selfViewNoEnd:ScrollViewNoEnd = null;
    private arrayRoomData:any[]; //房间滚动列表数据缓存
    private bEnableScroll2Top = false; //刷新列表后滚动到第一行
    private nExCount = 10;


    public InitScrollInfo(panelBase:UIPanelViewBase,updateFunc:Function){
        this.selfViewNoEnd = this.node.getComponent(ScrollViewNoEnd);
        this.main = panelBase;
        this.node.on(cc.Node.EventType.TOUCH_END,()=>{
            //结束的时候如果发现列表是空的则需要获取一次
            let bFind = false;
            for(let one of this.content.children)
            {
                if(one.active)
                {
                    bFind = true;
                    break;
                }
            }
            if(!bFind)
            {            
                updateFunc(0);
            }
        },this);
        this.node.on("bounce-top",()=>{
            updateFunc(0);
        },this);
        this.node.on("bounce-bottom",()=>{
           // updateFunc(Number(temp.nCurPage)+1);
        },this);

        let temp = this.node.getComponent(ScrollViewNoEnd);

        this.node.on("scrolling",()=>{
            //计算滚到百分比
            let nTotle = this.content.height-this.node.height;
            let nPer = this.content.y/nTotle;
            if(nPer>0.7)
            {
                updateFunc(Number(temp.nCurPage)+1);
            }
        },this);
    }

    public UpdateList(strMsg:string,strName:string){

        this.nExCount = 20;
        let msg = JSON.parse(strMsg);
        if(msg == null)
        {
            Debug.Log("解析内容失败！");
            return;
        }
        let data = msg[strName];

        let nCount = 0;
        let nCurPage = 0;
        if(msg.hasOwnProperty("count"))
        {
            nCount = msg.count;
            nCurPage = msg.number;
            if(msg[strName].length>0)
            {
                this.selfViewNoEnd.nCurPage = nCurPage;
            }
        }

        let temp = [];
        for(let i=0;i<data.length;i++)
        {
            let objRoom:cc.Node = null;
            let jRoom = data[i];
            temp.push(jRoom);
        }
        if(nCurPage == 0)
        {
            this.arrayRoomData = [];
            this.arrayRoomData.push(...temp);
            this.Init(this.arrayRoomData,true);
            //if(this.bEnableScroll2Top)
            {
                this.selfViewNoEnd.scrollToTop();
                this.bEnableScroll2Top = false;
            }
            
        }
        else
        {
            if(temp.length>0)
            {
                this.arrayRoomData.push(...temp);
                this.Init(this.arrayRoomData,false);
            }

        }

    }


    Init(_data: any[],bNew:boolean=true) {
        this.data = _data;
        this.dataCount = this.data.length;
        this.itemHeight = this.itemPrefab.getContentSize().height;
        this.viewItemsCount = Math.ceil(this.view.height / (this.itemHeight + this.spaceY));
      //  console.log("dataCount:" + this.dataCount + ",viewItemsCount:" + this.viewItemsCount + "， view.height:" + this.view.height);


        if(bNew)
        {
            this.lastYPos = 0;
            //存在对象，需要复位
            if(this.content.childrenCount>0)
            {
                for (let i = 0; i < this.viewItemsCount + this.nExCount; i++)
                {
                    if(i>=this.data.length)
                    {
                        if(i<this.content.childrenCount)
                            this.content.children[i].active = false;
                        continue;
                    }
                    this.content.children[i].getComponent(ScrollItemBase).Refresh(this.data[i]);
                    this.content.children[i].getComponent(ScrollItemBase).DataIndex = i;
                    //根据自己的锚点情况来设置x,y坐标
                    let x = 0;
                    let y = -((i + 1) * this.itemHeight - this.itemHeight * 0.5) - this.spaceY * i - this.paddingTop;
                    this.content.children[i].position = new cc.Vec2(x, y)
                }
            }
            else
            {
                //最多加载viewItemsCount+10个Item作为缓冲数据
                this.cacheItems = [];
                for (let i = 0; i < this.viewItemsCount + this.nExCount; i++) {
                    if (typeof this.data[i] == 'undefined')
                    {
                        let tmp = cc.instantiate(this.itemPrefab);
                        tmp.active = false;
                        tmp.setParent(this.content);
                        tmp.getComponent(ScrollItemBase).main = this.main;
                        continue;
                    }

                    let tmp = cc.instantiate(this.itemPrefab);
                    tmp.active = true;
                    tmp.getComponent(ScrollItemBase).Refresh(this.data[i]);
                    tmp.getComponent(ScrollItemBase).DataIndex = i;
                    this.cacheItems.push(tmp);
                    tmp.setParent(this.content);
                    
                    tmp.getComponent(ScrollItemBase).main = this.main;
                    //根据自己的锚点情况来设置x,y坐标
                    let x = 0;
                    let y = -((i + 1) * this.itemHeight - this.itemHeight * 0.5) - this.spaceY * i - this.paddingTop;
                    tmp.position = new cc.Vec2(x, y)
                }
                this.cacheCount = this.cacheItems.length;
            }
            
        }
        


        //根据数据总数，以及锚点设置情况来设置content的高度     
        this.contentYMin = 0;
        this.contentYMax = this.dataCount * (this.itemHeight + this.spaceY) - this.spaceY + this.paddingTop + this.paddingBottom;
        this.content.height = this.contentYMax;
        this.topValue = 5 * this.itemHeight + 4 * this.spaceY;
        this.bottomValue = -(this.topValue + this.view.height);
    }




    private lastYPos: number = 0;
    update(dt) {
        //  console.log("content pos:" + this.content.position);
        if (this.content.position.y == this.lastYPos) {
            return;
        }
        if (this.content.position.y < this.contentYMin) {//向下滑动到顶部了            
            return
        }
        if (this.content.position.y > this.contentYMax) {//向上滑动到底部了            
            return;
        }

        if (this.content.position.y > this.lastYPos) {
          //  console.log("向上");
            this.updateItems(false);
        }
        else {
          //  console.log("向下");
            this.updateItems(true);
        }
        this.lastYPos = this.content.position.y;

    }

    private updateItems(isDown: boolean) {
        for (let i = 0; i < this.cacheItems.length; i++) {
            const element = this.cacheItems[i];
            let scrollItem = element.getComponent(ScrollItemBase);
            //item坐标转换到view节点坐标
            let pos = this.view.convertToNodeSpaceAR(this.content.convertToWorldSpaceAR(element.position));
            if (isDown) {
                if (pos.y < this.bottomValue) {
                    let newId = scrollItem.DataIndex - this.cacheCount;
                    if (newId < 0) {
                        return;
                    }
                    scrollItem.DataIndex = newId;
                    element.y = element.y + this.cacheCount * this.itemHeight + this.cacheCount * this.spaceY;
                    scrollItem.Refresh(this.data[newId]);
                }
            }
            else {
                if (pos.y > this.topValue) {
                    let newId = scrollItem.DataIndex + this.cacheCount;
                    if (newId > this.dataCount - 1) {
                        return;
                    }
                    scrollItem.DataIndex = newId;
                    element.y = element.y - this.cacheCount * this.itemHeight - this.cacheCount * this.spaceY;
                    scrollItem.Refresh(this.data[newId]);
                }
            }
        }

    }
}


