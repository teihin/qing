import{ShowPanelMode, ClosePanelMode} from "./GameDef"
import UIPanelViewBase from "./UIPanelViewBase";
import UIViewBase from "./UIViewBase";
import Debug from "./Debug";
import WebLoadingManager from "./WebLoadingManager";

const {ccclass, property} = cc._decorator;

//窗口管理类
@ccclass
export default class UIManager extends cc.Component {
    
    strPreScense:string  = ""; //上次调用场景名
    root: cc.Node = null;      //场景UI根节点 
    top: cc.Node = null;       //成绩置顶UI根节点

    strCashPanelName: string = ""; //正在等待加载的窗口名称
    cashPanelScene: cc.Scene = null; //异步窗口请求所属场景

    static instance: UIManager
    static getInstance() {
        if (!UIManager.instance) {            
            let node = new cc.Node("UIManager");
            cc.game.addPersistRootNode(node);
            this.instance = node.addComponent(UIManager);            
        }

        Debug.Log("上一个场景名:"+UIManager.instance.strPreScense);
        Debug.Log("场景名称:"+cc.director.getScene().name);

        if(UIManager.instance.strPreScense != cc.director.getScene().name)
        {
            console.log("场景已经切换，需要复位根节点");
            UIManager.instance.root = null;
            UIManager.instance.top = null;
            UIManager.instance.strPreScense = cc.director.getScene().name;
            

            console.log("尺寸变化1!"+cc.view.getCanvasSize());
            let can = cc.find("Canvas").getComponent(cc.Canvas);
            //IOS屏蔽调整下
            let nW = cc.view.getCanvasSize().width;
            let nH = cc.view.getCanvasSize().height;    
            let nDefH = 1334;    
            let nHTest = nW * nDefH / 750;
            let nWTest = nH * 750 / nDefH;
            if (nHTest > nH) //需要高适配
            {
                can.fitWidth = true;
                can.fitHeight = true;
                Debug.Log("PAD调整为高适配！！！");
            }
            else
            {
                Debug.Log("正常分辨率，宽度适配！");
            }
        }

        if(UIManager.instance.root === null)
        {
            UIManager.instance.root = cc.find("Canvas/Normal");
            if(UIManager.instance.root === null)
            {
                console.error("找不到Canvas根节点！");
            }
            else
            {
                console.log("找到Canvas的根节点！");
            }
        }

        if(UIManager.instance.top === null)
        {
            UIManager.instance.top = cc.find("Canvas/Top");
            if(UIManager.instance.top === null)
            {
                console.error("找不到Top根节点！");
            }
            else
            {
                console.log("找到Top的根节点！");
            }
        }

        return UIManager.instance;
    }
    onDestroy()
    {
        UIManager.instance = null;
    }

    public ResetBase()
    {
        this.root = cc.find("Canvas/Normal");
        this.top = cc.find("Canvas/Top");
    }

    private ClearPanelLoadRequest(strName:string,requestScene:cc.Scene)
    {
        //只清理当前这一次请求，不能让旧场景迟到回调覆盖新场景的同名加载状态。
        if(this.strCashPanelName == strName && this.cashPanelScene === requestScene)
        {
            this.strCashPanelName = "";
            this.cashPanelScene = null;
        }
    }

    private CloseOtherPanels(optRoot:cc.Node,strName:string)
    {
        if(!cc.isValid(optRoot) || optRoot.childrenCount <= 0)
            return;
        optRoot.children.forEach((item,idx,array)=>{
            //只删除绑定有UI组件的对象
            let comp = item.getComponent(UIPanelViewBase);
            if(comp != null && comp.node.name != strName) //不能删除自己
                item.destroy();
        });
    }

    private WebPanelLoadingTitle(strName:string):string
    {
        if(strName == "panelGameView")
            return "正在打开牌桌";
        if(strName == "panelMain")
            return "正在打开游戏大厅";
        if(strName == "panelLogin")
            return "正在打开登录界面";
        return "正在打开游戏界面";
    }

    //打开某个UI
    showPanel(strName:string,showMode:ShowPanelMode,strUserData:string = "",arrayEx:any[] = null):cc.Node
    {
        let requestScene = cc.director.getScene();
        if(!cc.isValid(requestScene))
            return;

        let optRoot:cc.Node = showMode === ShowPanelMode.Top?this.top:this.root;

        if(!cc.isValid(optRoot))
        {
            this.root = cc.find("Canvas/Normal");
            this.top = cc.find("Canvas/Top");
            optRoot = showMode === ShowPanelMode.Top?this.top:this.root;
            if(!cc.isValid(optRoot))
            {
                return;
            }
        }


        //同一场景的同名窗口已经在异步加载时才跳过；旧场景请求不能阻塞新场景。
        if(this.strCashPanelName == strName && this.cashPanelScene === requestScene)
        {
            Debug.Log("正在异步加载中，掉过:"+strName);
            return;
        }


        //Native维持原顺序；网页在新Prefab成功实例化前保留旧界面，由跨场景进度层遮罩。
        let deferWebCloseOther = WebLoadingManager.isEnabled() && showMode == ShowPanelMode.CloseOther;
        if(showMode == ShowPanelMode.CloseOther && !deferWebCloseOther)
            this.CloseOtherPanels(optRoot,strName);


        //检测是否已经存在
        let objItem:cc.Node = null;
        if(optRoot.childrenCount>0)
        {
            for(var item of optRoot.children)
            {
                if(item.name === strName)
                {
                    objItem = item;
                    break;
                }
            }
        }


        if(objItem === null)
        {
            this.strCashPanelName = strName;
            this.cashPanelScene = requestScene;
            let webTaskID = WebLoadingManager.isEnabled() ?
                WebLoadingManager.begin(this.WebPanelLoadingTitle(strName),"正在下载界面资源…",150) : "";
            let completeCallback = (err:any,prefab:any)=>{
                if(err)
                {
                    this.ClearPanelLoadRequest(strName,requestScene);
                    cc.error(err.message || err);
                    if(webTaskID != "")
                    {
                        WebLoadingManager.fail(webTaskID,"界面资源加载失败，请检查网络后重试",()=>{
                            this.showPanel(strName,showMode,strUserData,arrayEx);
                        });
                    }
                    return null;
                }

                //资源加载期间可能已经切换场景；旧场景弹窗必须丢弃，不能挂到新场景。
                if(!cc.isValid(requestScene) || cc.director.getScene() !== requestScene || !cc.isValid(optRoot))
                {
                    this.ClearPanelLoadRequest(strName,requestScene);
                    if(webTaskID != "")
                        WebLoadingManager.cancel(webTaskID);
                    return null;
                }

                if(webTaskID != "")
                    WebLoadingManager.setPreparing(webTaskID,"资源下载完成，正在生成界面…");

                //Native保持原来的实例化、挂载和异常行为，不进入网页保护逻辑。
                if(webTaskID == "")
                {
                    let nativeNode = cc.instantiate(prefab);
                    nativeNode.parent = optRoot;
                    this.ClearPanelLoadRequest(strName,requestScene);
                    return this.setPanelInfo(nativeNode,strUserData,arrayEx);
                }

                let node:cc.Node = null;
                try
                {
                    node = cc.instantiate(prefab);
                    if(deferWebCloseOther)
                        this.CloseOtherPanels(optRoot,strName);
                    node.parent = optRoot;
                    this.ClearPanelLoadRequest(strName,requestScene);
                    let result = this.setPanelInfo(node,strUserData,arrayEx);
                    if(webTaskID != "")
                        WebLoadingManager.finishAfterFrame(webTaskID);
                    return result;
                }
                catch(error)
                {
                    this.ClearPanelLoadRequest(strName,requestScene);
                    if(cc.isValid(node))
                        node.destroy();
                    cc.error(error);
                    if(webTaskID != "")
                    {
                        WebLoadingManager.fail(webTaskID,"界面生成失败，请重新加载",()=>{
                            this.showPanel(strName,showMode,strUserData,arrayEx);
                        });
                    }
                    return null;
                }
            };

            if(webTaskID != "")
            {
                cc.loader.loadRes("UI/"+strName,
                    (completedCount:number,totalCount:number,item:any)=>{
                        WebLoadingManager.update(webTaskID,completedCount,totalCount,"正在下载界面资源…");
                    },
                    completeCallback);
            }
            else
            {
                //Native保持原来的loadRes签名和加载时序。
                cc.loader.loadRes("UI/"+strName,completeCallback);
            }
        }
        else
        {
            if(deferWebCloseOther)
                this.CloseOtherPanels(optRoot,strName);
            objItem.parent = optRoot;
            return this.setPanelInfo(objItem,strUserData,arrayEx);
        }

        
    }
    //设置UI数据
    setPanelInfo(item:cc.Node,strUserData:string,arrayEx:string[]):cc.Node
    {
        // 原生 iOS 需要给刘海/状态栏预留顶部空间；Safari/Web Clip 的可视区域
        // 已由浏览器处理，再额外下移会在页面顶部形成一条黑色空白。
        if(cc.sys.isNative && cc.sys.os == cc.sys.OS_IOS)
        {
            item.getComponent(cc.Widget).top = 50
        }
        item.scale = 1;

        let one = item.getComponent(UIPanelViewBase);
        if(one != null)
        {
            one.strUserData = strUserData;
            one.arrayEx = arrayEx;
        }
        else
        {
            console.log("找不到挂载的UI组件！");
        }
        return item;
    }
    //关闭UI
    closePanelByName(strName:string,mode:ClosePanelMode = ClosePanelMode.Normal)
    {
        let optRoot:cc.Node = mode === ClosePanelMode.Top?this.top:this.root;

        if(!cc.isValid(optRoot))
            return;

        if(optRoot.childrenCount<=0)
            return;

        for(var item of optRoot.children)
        {
            if(item.name === strName)
            {
                item.destroy();
            }
        }
    }
    //关闭顶层
    closeTop(mode:ClosePanelMode = ClosePanelMode.Normal)
    {
        let optRoot:cc.Node = mode === ClosePanelMode.Top?this.top:this.root;

        if(!cc.isValid(optRoot))
            return;
        if(optRoot.childrenCount<=0)
            return;
       optRoot.children[optRoot.childrenCount-1].destroy();
    }

    //检测某个窗口是否存在
    checkPanelByName(strName:string):boolean
    {
        if(this.root.childrenCount>0)
        {
            for(var item of this.root.children)
            {
                if(item.name === strName)
                {
                    return true;
                }
            }
        }


        if(this.top.childrenCount>0)
        {
            for(var item of this.top.children)
            {
                if(item.name === strName)
                {
                    return true;
                }
            }
        }

    }

}
