//窗口对象基类

import GameDataManager from "../GameDataManager";
import Tool from "./Tool";
import Debug from "./Debug";
import UIManager from "./UIManager";

var KBEngine = require("kbengine");

const {ccclass, property} = cc._decorator;

@ccclass
export default class UIViewBase extends cc.Component {


    // LIFE-CYCLE CALLBACKS:

    onLoad () {

        console.log("进入BASE-onload");

        //给窗口下所有按钮绑定事件
        let arrayBtns = this.node.getComponentsInChildren(cc.Button);
        arrayBtns.forEach((value,idx,array)=>{
            let item:cc.Toggle = value.node.getComponent(cc.Toggle);
            if(item!=null && item.toggleGroup == null)                
                value.node.on("toggle",this.onButtonClickVirtual,this);
            else
            {
                //处理下按钮,避免按钮缩放
                value.transition = cc.Button.Transition.NONE
                value.node.on("click",this.onButtonClickVirtual,this);
            }
        });

        //给toggle绑定事件  (toogle 不支持重复点击，只能用button实现)
        // let arrayToggle = this.node.getComponentsInChildren(cc.Toggle);
        // arrayToggle.forEach((value,idx,array)=>{
        //     value.node.on("toggle",this.onToggleClick,this);
        // });


        if(this.node.name != "panelCloudNotify")
        {
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

    }

    start () {

    }

    update (dt) {

    }

    onEnable(){

    }

    onDisable(){

    }

    onDestroy(){
        KBEngine.Event.deregisterAll(this);
        this.unscheduleAllCallbacks()
    }

    private audio:cc.AudioSource = null;
    onButtonClickVirtual(button:cc.Button)
    {
        
        let toggle = button.getComponent(cc.Toggle);
        if(toggle === null)
        {
            this.onButtonClick(button);
            this.PlayAudio("按键");
        }
        else
        {                        
            this.onToggleClick(toggle);
            if(toggle.isChecked)
            {
                this.PlayAudio("按键");
            }
        }
    }

    onButtonClick(button:cc.Button)
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
    }

    onToggleClick(toggle:cc.Toggle)
    {

    }

    //---------------------------------------------
    public PlayAudio(strName:string)
    {
        let nEff =  Tool.GetConfigNumber("AudioEff",100);
        if (nEff > 0)
        {
            if (this.audio == null)
            {
                this.audio = this.node.getComponent(cc.AudioSource);
                if(this.audio == null)
                {
                    this.audio = this.node.addComponent(cc.AudioSource);       
                    this.audio.playOnLoad = false;             
                }
            }
            let strAuPath = "Audio/"+strName;
            this.audio.volume = nEff / 100;

            cc.loader.loadRes(strAuPath,cc.AudioClip,(err,obj:cc.AudioClip)=>{
                if(err||obj==null||obj==undefined)
                {
                    Debug.Error(err.message+err);
                    return null;
                }
                
                //this.audio.stop();
                if(this.audio!=null)
                {
                    this.audio.clip = obj;
                    this.audio.play();
                }

            });
        }
    }
}
