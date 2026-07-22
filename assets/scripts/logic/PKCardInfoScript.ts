import Debug from "../common/Debug";
import DrhPlayerLogic from "./DrhPlayerLogic";
import { PlayerPos } from "../common/GameDef";
import GameDataManager from "../GameDataManager";

const {ccclass, property} = cc._decorator;

@ccclass
export default class PKCardInfoScript extends cc.Component {

    public nType:number;   //牌型
    public nNum:number;    //牌号
    public nImgType:number;    //0：大牌， 1：小牌

    public cardTypeBak:number; //缓存类型
    public cardIndexBak:number;//缓存牌索引

    public bSelect:boolean;    //选择标记

    private transBK0:cc.Node;  //正面
    private transBK1:cc.Node;  //背面
    private imgBk0:cc.Sprite;



    onLoad () {
        this.Init();
    }

    start () {

    }

    Init()
    {
        if(this.transBK0 == null)
            this.transBK0 = this.node.getChildByName("BK0");
        if(this.transBK1 == null)
            this.transBK1 = this.node.getChildByName("BK1");

        if (this.transBK1 == null)
            this.transBK1 = this.node.getChildByName("ZBK1");

        if (this.transBK0)
            this.imgBk0 = this.transBK0.getComponent(cc.Sprite);

        this.transBK0.active = true;
        this.transBK1.active = true;
        this.transBK0.opacity = 0;
    }

    // update (dt) {}

    public SetCardValue(nInType:number,nInNum:number,nInImageType:number,nShowFace:number = 0)
    {
        this.nType = nInType;
        this.nNum = nInNum;
        this.nImgType = nInImageType;

        this.cardTypeBak = this.nType;
        this.cardIndexBak = this.nNum;


        this.node.active = true;

        if (nInType == 0 && nInNum == 0)
        {
            this.ShowFace(1);
            return;
        }

        this.Init();

        let strPath = "pk2/"+nInType+"_"+nInNum+(nInImageType == 0 ? "a" : "b");
        cc.loader.loadRes(strPath,cc.SpriteFrame,(err,obj)=>{
            if(err||obj==null||obj==undefined)
            {
                cc.error(err.message || err);
                return null;
            }
            if(this.imgBk0!=null)
            {
                this.imgBk0.spriteFrame = obj;
                this.imgBk0.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            }

        });
        

        this.ShowFace(nShowFace);
    }
    public ShowFace(nType:number)
    {
        this.Init();
        if(nType == 0)
        {
            this.transBK0.opacity = 255;
            this.transBK1.opacity = 0;
        }
        else
        {
            this.transBK0.opacity = 0;
            this.transBK1.opacity = 255;
        }
    }
    //播放翻牌动画
    public PlayCoverAnimate(scale:number = 0.8)
    {
        scale = 1; //锁定一倍
        //如果当前为翻开状态则不动画翻拍
        if(this.transBK0.opacity == 255)
        {
            return;
        }

        
        Debug.Error("播放翻盘:"+scale)

        this.node.stopAllActions();
        let active = cc.scaleTo(0.1,0,scale);
        let callback = cc.callFunc(()=>{
            this.ShowFace(0);
        },this);
        let active2 = cc.scaleTo(0.1,scale,scale);
        let seq = cc.sequence(cc.delayTime(0.05),active,callback,active2,cc.callFunc(()=>{

        }));  
        
        this.node.runAction(seq);
    }
    public ShowHideBK(bShow:boolean = true)
    {
        if (this.transBK1 == null)
            this.transBK1 = this.node.getChildByName("BK1");
        this.transBK1.opacity = bShow?255:0;
    }
    
    lastAction:cc.Action;
    public AnimateMove(vcSource:cc.Vec2,callback:Function = null,bDelayShowCard:boolean = true,nPos:number = 0,src:DrhPlayerLogic = null)
    {
        this.ShowHideBK(false);
        if(this.node.active)
        {
            this.transBK1.stopAction(this.lastAction);
            this.transBK1.stopAllActions();
            //this.transBK1.position = this.node.convertToNodeSpaceAR(vcSource);            
            this.ShowHideBK(false);            

            let action = cc.moveTo(0.2,cc.Vec2.ZERO);
            let fun = cc.callFunc(()=>{
                if(bDelayShowCard)
                {
                    if(this.node.parent.name == "handcardlist2" && this.node.getSiblingIndex()<2)
                    {

                    }
                    else
                    {
                        this.PlayCoverAnimate((src.playerPos == PlayerPos.self&&this.node.parent.name != "handcardlist2")?1:0.8);                
                    }
                    
                }
                if (callback != null)
                {                
                    callback(nPos,src);
                }
            },this);

            this.lastAction = this.transBK1.runAction(cc.sequence(cc.delayTime(0.001),cc.callFunc(()=>{
                this.ShowHideBK(true); 
                this.transBK1.position = this.node.convertToNodeSpaceAR(vcSource);
            }),action,fun));
        }
    }
}
