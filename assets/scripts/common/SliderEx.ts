import { prototype } from "events";
import Debug from "./Debug";

const {ccclass, property} = cc._decorator;

enum Direction{
    Horizontal = 0,
    Vertical
}

@ccclass
export default class SliderEx extends cc.Slider {

    @property
    _minValue = 0;
    @property
    get minValue()
    {
        return this._minValue;
    }
    set minValue(value)
    {
        this._minValue = value;
        this.resetCurValue();
    }

    @property
    _maxValue = 5;
    @property
    get maxValue()
    {
        return this._maxValue;
    }
    set maxValue(value)
    {
        this._maxValue = value;
        this.resetCurValue();
    }

    @property
    _curValue = 0;
    @property
    get curValue()
    {
        return this._curValue;
    }
    set curValue(value)
    {        
        this._curValue = value<this.minValue?this.minValue:(value>this.maxValue?this.maxValue:value);
        this.resetHanlePos();
    }   
  
  

    @property
    bUserNumber = true; //是否使用整数步进


    _updateHandlePosition(){        
        if (!this.handle) { return; }

        if(!this.bUserNumber)
        {
            var handlelocalPos;
            if (this.direction === Direction.Horizontal) {
                handlelocalPos = cc.v2(-this.node.width * this.node.anchorX + this.progress * this.node.width, 0);
            }
            else {
                handlelocalPos = cc.v2(0, -this.node.height * this.node.anchorY + this.progress * this.node.height);
            }
            var worldSpacePos = this.node.convertToWorldSpaceAR(handlelocalPos);
            this.handle.node.position = this.handle.node.parent.convertToNodeSpaceAR(worldSpacePos);
        }
        else
        {
            //计算当前真实位置;
            let real = (this.curValue-this.minValue)/(this.maxValue-this.minValue);

            var handlelocalPos;
            if (this.direction === Direction.Horizontal) {
                handlelocalPos = cc.v2(-this.node.width * this.node.anchorX + real * this.node.width, 0);
            }
            else {
                handlelocalPos = cc.v2(0, -this.node.height * this.node.anchorY + real * this.node.height);
            }
            var worldSpacePos = this.node.convertToWorldSpaceAR(handlelocalPos);
            this.handle.node.position = this.handle.node.parent.convertToNodeSpaceAR(worldSpacePos);
        }
    } 

     onLoad () {
        this.bUserNumber = true;

        this.node.on("slide",()=>{
            //拖拽过程中实时计算当前值
            this.curValue = parseInt(((this.maxValue-this.minValue)*this.progress).toString());
            this.notifyEvent();
        },this);

        this.node.on(cc.Node.EventType.TOUCH_END,()=>{
            //拖拽结束时，跳动滑块到指定位置
            this.resetHanlePos();
        },this);

        this.node.on(cc.Node.EventType.TOUCH_CANCEL,()=>{
            this.resetHanlePos();
        },this);

        this.handle.node.on(cc.Node.EventType.TOUCH_END,()=>{
            //拖拽结束时，跳动滑块到指定位置
            this.resetHanlePos();
        },this);

        this.handle.node.on(cc.Node.EventType.TOUCH_CANCEL,()=>{
            this.resetHanlePos();
        },this);
     }

    start () {

    }

    resetHanlePos()
    {
        let value = (this.curValue-this.minValue)/(this.maxValue-this.minValue);
        this.progress = value<0?0:(value>1?1:value);

        this.notifyEvent();
    }

    resetCurValue()
    {
        let value = this.progress<=0?0:this.progress;
        this.curValue = parseInt(((this.maxValue-this.minValue)*this.progress).toString());
        //this.test = this.maxValue.toString()+"-"+this.minValue+"-"+value+"@@@@@"+this.progress; 
    }

    notifyEvent()
    {
        this.node.emit("onValueChange",this);
    }

    // update (dt) {}
}
