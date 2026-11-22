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
        if(this.transBK0 == null || !cc.isValid(this.transBK0))
            this.transBK0 = this.FindFaceNode();
        if(this.transBK1 == null || !cc.isValid(this.transBK1))
            this.transBK1 = this.FindBackNode();

        if (this.transBK0)
            this.imgBk0 = this.transBK0.getComponent(cc.Sprite);

        if (this.transBK0 != null)
        {
            this.transBK0.active = true;
            this.transBK0.opacity = 0;
        }
        if (this.transBK1 != null)
            this.transBK1.active = true;
        // 无条件走一次：找不到 transBK1 时 ApplyCardBack 内部也会再找一遍
        this.ApplyCardBack();
    }

    /** 找背面节点。编辑器复制出来的节点可能叫「BK1 copy」，
     *  getChildByName("BK1") 是精确匹配，遇到这种名字会一直找不到。 */
    private FindBackNode():cc.Node
    {
        if(this.node == null)
            return null;
        let arrayChild = this.node.children;
        for(let i = 0; i < arrayChild.length; i++)
        {
            let strName = arrayChild[i].name;
            if(strName.indexOf("BK1") == 0 || strName.indexOf("ZBK1") == 0)
                return arrayChild[i];
        }
        return null;
    }

    /** 找正面节点，同样兼容「BK0 copy」。 */
    private FindFaceNode():cc.Node
    {
        if(this.node == null)
            return null;
        let arrayChild = this.node.children;
        for(let i = 0; i < arrayChild.length; i++)
        {
            if(arrayChild[i].name.indexOf("BK0") == 0)
                return arrayChild[i];
        }
        return null;
    }

    /**
     * 牌的背面贴图统一按「设置 → 牌背」走。
     *
     * 判据是「当前 spriteFrame 是不是目标图」，任何显示背面的时机都会自愈：
     *   · panelGameView.UpdateBackImg()（切换牌背时全量刷）
     *   · Init() / ShowFace()（点亮、翻牌）
     *   · ShowHideBK(true)（发牌飞行，这条不经过 SetCardValue/ShowFace）
     *
     * 不直接用 Tool：这个脚本处在 panelGameView ↔ DrhPlayerLogic 的循环引用里，
     * Tool 的加载顺序不可靠，读配置和加载贴图都内联。
     */
    private static s_cardBackFrames:{[key:string]:cc.SpriteFrame} = {};

    public ApplyCardBack():void
    {
        // 每次都重新取节点：缓存的 transBK1 一旦失效（节点被重建/替换），
        // 只判空就 return 会导致这张牌再也不刷新，表现就是「必须退出场景重进才对」。
        let transBK1 = this.FindBackNode();
        if (transBK1 == null)
            return;
        this.transBK1 = transBK1;
        let spr = transBK1.getComponent(cc.Sprite);
        if (spr == null)
            return;

        let strName = this.GetCardBackName();
        let strKey = "zuotype/牌背" + strName;
        let frame = PKCardInfoScript.s_cardBackFrames[strKey];
        if (frame != null && !cc.isValid(frame))
        {
            PKCardInfoScript.s_cardBackFrames[strKey] = null;
            frame = null;
        }
        if (frame != null)
        {
            if (spr.spriteFrame !== frame)
                spr.spriteFrame = frame;
            this.ApplyBackFrameToPlaceholderFace(frame);
            return;
        }

        cc.loader.loadRes(strKey, cc.SpriteFrame, (err,obj)=>{
            if (err || obj == null)
            {
                cc.error("[CardBack] 加载 " + strKey + " 失败：" + (err == null ? "空资源" : err.message));
                return;
            }
            PKCardInfoScript.s_cardBackFrames[strKey] = obj;
            let transBK1Now = this.FindBackNode();
            if (transBK1Now == null)
                return;
            let s = transBK1Now.getComponent(cc.Sprite);
            if (s != null)
                s.spriteFrame = obj;
            this.ApplyBackFrameToPlaceholderFace(obj);
        });
    }

    /** 还没发过牌面的牌，BK0（正面）里放的是占位牌背（prefab 静态图）。
     *  不跟着设置走，就会出现「一张红一张蓝」；有真牌面之后不能动。 */
    private ApplyBackFrameToPlaceholderFace(frame:cc.SpriteFrame):void
    {
        if (frame == null || this.nType != null)
            return;
        let transBK0 = this.FindFaceNode();
        if (transBK0 == null)
            return;
        let spr = transBK0.getComponent(cc.Sprite);
        if (spr != null && spr.spriteFrame !== frame)
            spr.spriteFrame = frame;
    }

    /** 与 Tool.GetCardBackIndex() 同一口径（0/1/2，越界归 0），避免依赖 Tool 的加载顺序。 */
    private GetCardBackName():string
    {
        let strItem = cc.sys.localStorage.getItem("牌背");
        if (strItem == null || ["0","1","2"].indexOf(strItem) < 0)
        {
            strItem = "0";
            cc.sys.localStorage.setItem("牌背", strItem);
        }
        return strItem;
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
            this.faceReady = true;
            this.FlushFaceWait();
            this.ShowFace(1);
            return;
        }

        this.Init();

        // 牌面是异步加载的。翻牌动画只等 0.15s，首次加载（冷启动/新牌面）往往赶不上，
        // 一翻就露出 BK0 里上一次的图（占位牌背），看起来就是「翻错了」。
        // 这里记一个就绪标记，PlayCoverAnimate 等它就绪再翻。
        this.faceReady = false;
        let strPath = "pk2/"+nInType+"_"+nInNum+(nInImageType == 0 ? "a" : "b");
        cc.loader.loadRes(strPath,cc.SpriteFrame,(err,obj)=>{
            if(err||obj==null||obj==undefined)
            {
                cc.error(err.message || err);
                this.faceReady = true;
                this.FlushFaceWait();
                return null;
            }
            if(this.imgBk0!=null)
            {
                this.imgBk0.spriteFrame = obj;
                this.imgBk0.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            }
            this.faceReady = true;
            this.FlushFaceWait();
        });
        

        this.ShowFace(nShowFace);
    }

    /** 牌面是否已加载到位（翻牌动画要等它） */
    private faceReady:boolean = true;
    private faceWait:Array<Function> = null;

    private FlushFaceWait():void
    {
        if(this.faceWait == null || this.faceWait.length <= 0)
            return;
        let arrayWait = this.faceWait;
        this.faceWait = null;
        for(let fun of arrayWait)
        {
            if(fun != null)
                fun();
        }
    }
    public ShowFace(nType:number)
    {
        this.Init();
        // 「显示_头牌_事件」→ PlayCover12 → SetCardValue(...,1) → 这里，翻头两张牌时
        // 背面会先露一下再翻正面；只在 Init 里对一次不够（牌背被设成默认值后不会再纠正），
        // 每次切正反面都对齐一次，静态缓存命中时只做一次引用比较。
        this.ApplyCardBack();
        // 空牌（含从未设过牌面的）没有正面：别把 BK0 里的占位牌背亮出来
        if(nType == 0 && (this.nType == null || this.nType == 0) && (this.nNum == null || this.nNum == 0))
            nType = 1;
        if(nType == 0)
        {
            if(this.transBK0 != null)
                this.transBK0.opacity = 255;
            if(this.transBK1 != null)
                this.transBK1.opacity = 0;
        }
        else
        {
            if(this.transBK0 != null)
                this.transBK0.opacity = 0;
            if(this.transBK1 != null)
                this.transBK1.opacity = 255;
        }
    }
    //播放翻牌动画
    public PlayCoverAnimate(scale:number = 0.8)
    {
        scale = 1; //锁定一倍
        //如果当前为翻开状态则不动画翻拍
        if(this.transBK0 != null && this.transBK0.opacity == 255)
        {
            return;
        }

        // 空牌（nType/nNum 为 0 或没设过，服务端没下发牌面）没有正面可翻。
        // 硬翻会把 BK0 里的占位牌背露出来，看着就是「翻出一张牌背、还是默认那张」。
        // 观众位 handcardlist2 收到的头两张就常常是空牌。
        if((this.nType == null || this.nType == 0) && (this.nNum == null || this.nNum == 0))
            return;

        // 牌面还没加载好就翻，会把 BK0 里的占位图（牌背）翻出来，看着像翻错牌。
        // 等加载回调再翻；最多等 0.6s，避免资源异常时牌永远停在背面。
        if(!this.faceReady)
        {
            // 只保留最后一次请求：同一张牌短时间多次触发时不重复播动画
            this.faceWait = [()=>{ this.PlayCoverAnimate(scale); }];
            this.scheduleOnce(()=>{
                this.faceReady = true;
                this.FlushFaceWait();
            },0.6);
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
        if (this.transBK1 == null || !cc.isValid(this.transBK1))
            this.transBK1 = this.FindBackNode();
        if (this.transBK1 == null)
            return;
        // 发牌飞行只走这里把背面亮出来（AnimateMove），不经过 SetCardValue/ShowFace，
        // 不在这里对齐就会一直显示 prefab 里的默认牌背。
        if (bShow)
            this.ApplyCardBack();
        // ApplyCardBack 可能刚换过节点引用，这里重新取一次，避免对旧节点改 opacity
        if (this.transBK1 != null && cc.isValid(this.transBK1))
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

            //单张牌飞行动画时长；与 DrhLogicMgr.ThrowCard2Player 的 fOneTime 配合决定发牌节奏
            let action = cc.moveTo(0.26,cc.Vec2.ZERO);
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
