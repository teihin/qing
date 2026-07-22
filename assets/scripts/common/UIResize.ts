import Debug from "./Debug";

const {ccclass, property} = cc._decorator;

@ccclass
export default class UIResize extends cc.Component {

    @property(cc.Canvas)
    canvas:cc.Canvas = null;

     onLoad () {
        // cc.view.setResolutionPolicy(cc.ResolutionPolicy.EXACT_FIT);
        // this.node.on(cc.Node.EventType.SIZE_CHANGED,()=>{
        //      console.log("尺寸变化!"+cc.view.getCanvasSize());
        //     // this.canvas.fitHeight = false;
        //     // this.canvas.fitWidth = false;
        //     // this.canvas.designResolution = cc.view.getCanvasSize();
        //     this.resize();
        // },this);
        //console.log("尺寸变化1!"+cc.view.getCanvasSize());

        //IOS屏蔽调整下
        // let nW = cc.view.getCanvasSize().width;
        // let nH = cc.view.getCanvasSize().height;

        // let nDefH = 1334;

        // let nHTest = nW * nDefH / 750;
        // let nWTest = nH * 750 / nDefH;

        /*
        if (nHTest > nH) //需要高适配
        {
            this.node.getComponent(cc.Canvas).fitWidth = false;
            this.node.getComponent(cc.Canvas).fitHeight = true;
            Debug.Log("PAD调整为高适配！！！");
        }
        else
        {
            Debug.Log("正常分辨率，宽度适配！");
        }
        */
        //Debug.Log("@@@@@@@@"+this.node.name);
     }

    start () {

    }

    // update (dt) {}
    
    // private curDR:cc.Size = null;
    // public resize() {
        

    // }
}


