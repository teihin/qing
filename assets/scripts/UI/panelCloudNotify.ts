import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import { ClosePanelMode } from "../common/GameDef";
import Debug from "../common/Debug";
import Tool from "../common/Tool";

var KBEngine = require("kbengine");
const {ccclass, property} = cc._decorator;

@ccclass
export default class panelCloudNotify extends UIPanelViewBase {

    private arrayMsg = Array<string>();

    public startAnimate:dragonBones.ArmatureDisplay = null; //启动动画

    onLoad () {
        super.onLoad();

        KBEngine.Event.register("SystemInfo", this, "SystemInfo"); //全局通知
    }

    start () {

        this.arrayMsg.push(this.strUserData);
        this.ShowNextMsg();
    }

    // update (dt) {}

    public ShowNextMsg()
    {
        if(this.arrayMsg.length == 0)
        {
            UIManager.getInstance().closePanelByName(this.node.name, ClosePanelMode.Top);
            return;
        }
        let strMsg = this.arrayMsg[0];

        if(strMsg.indexOf("####")>=0)
        {
            strMsg = strMsg.replace("####","");
        }
        // 系统公告与普通通知统一使用相同背景，不再用橙色区分。
        this.node.getChildByName("msk").color = cc.color(0,0,0,145);

        //开始动画        
        let txtItem = this.node.getChildByName("txt").getComponent(cc.Label);
        txtItem.string = strMsg;  
        txtItem.node.x = 0;
        let width = cc.winSize.width; //屏幕宽度

        this.scheduleOnce(()=>{
            let nMove = width+txtItem.node.width;
            let nTime = (nMove/width)*5;
            txtItem.node.runAction(cc.sequence(cc.moveBy(nTime,cc.v2(-nMove,0)),cc.callFunc(()=>{
                this.ShowNextMsg();
            },this)));
        },0.3);


        if(this.startAnimate == null)
        {
            this.startAnimate = this.node.getChildByName("烟花").getComponent(dragonBones.ArmatureDisplay);
        }

        //烟花
        if(strMsg.indexOf("抽中")>=0 && strMsg.indexOf("抽中 888 金币")<0)
        {
            //准备播放烟花动画
            //获取上次播放时间
            let nLastTime = Tool.GetConfigNumber("lastbj",0)

            let nSpan = new Date().getTime() - nLastTime
            Debug.Error("时间差:"+nSpan)
            cc.sys.localStorage.setItem("lastbj",new Date().getTime())

            Tool.GetChild(this.node,"烟花/文本/txt").getComponent(cc.Label).string = strMsg

            if(nSpan>10000)
            {
                
                this.startAnimate.node.active = true;
                this.startAnimate.addEventListener(dragonBones.EventObject.COMPLETE,()=>{
                    this.node.getChildByName("烟花").active = false;            
                },this);
                this.startAnimate.playAnimation("newAnimation",1);
                this.PlayAudio("烟花");
            }
            else
            {
                this.startAnimate.node.active = false
            }
        }
        else
        {
            this.startAnimate.node.active = false
        }


        this.arrayMsg.shift();
    }

    public SystemInfo(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        if (data == null)
        {
            return;
        }
        let strContent:string = data["system_content"];
        let arrayAll = strContent.split(',');
        this.arrayMsg.push(arrayAll[4]);
    }
    public audio:cc.AudioSource = null;
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
            let strAuPath = "Audio/eff/"+strName;
            this.audio.volume = nEff / 100;

            cc.loader.loadRes(strAuPath,cc.AudioClip,(err,obj:cc.AudioClip)=>{
                if(err)
                {
                    Debug.Error(err.message+err);
                    return null;
                }
                
                //this.audio.stop();
                this.audio.clip = obj;
                this.audio.play();
            });
        }
    }
}
