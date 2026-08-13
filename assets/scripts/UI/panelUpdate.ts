import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import GameDef, { ShowPanelMode, SERVER_IP, LOCAL_HOT_UPDATE } from "../common/GameDef";
import UIViewBase from "../common/UIViewBase";
import GameDataManager from "../GameDataManager";
import Debug from "../common/Debug";
import ConfigManager from "../logic/ConfigManager";
import ObjPoolManager from "../logic/ObjPoolManager";
import Tool from "../common/Tool";

const {ccclass, property} = cc._decorator;

@ccclass
export default class panelUpdate extends UIPanelViewBase {

    @property(cc.Label)
    fileLabel : cc.Label = null;

    @property(cc.Label)
    byteLabel : cc.Label = null;

    @property(cc.Label)
    info: cc.Label = null;

    @property(cc.Node)
    fileProgressNode : cc.Node = null;

    @property(cc.Node)
    byteProgressNode : cc.Node = null;

    @property(cc.RawAsset)
    mainifestUrl: cc.RawAsset= null;

    @property(cc.Label)
    savepath:cc.Label = null;

    private fileProgressBar : cc.ProgressBar = null;
    private byteProgressBar : cc.ProgressBar = null;
    private _storagePath = "";
    private _am = null;
    private _updating = false;

    private nWebLoadCount = 1;
    private isWebLoginLoading = false;

    public startAnimate:dragonBones.ArmatureDisplay = null; //启动动画
    
     onLoad () {

        cc.debug.setDisplayStats(false);

        super.onLoad();

        // let nLastTime = Tool.GetConfigNumber("ggtime",0)

        // let nSpan = new Date().getTime() - nLastTime
        // Debug.Error("时间差:"+nSpan)
        // cc.sys.localStorage.setItem("ggtime",new Date().getTime())

        // if( nSpan>600000 && !cc.sys.isBrowser) //!cc.sys.isBrowser &&
        // {
        //     this.startAnimate = this.node.getChildByName("启动动画").getComponent(dragonBones.ArmatureDisplay);
        //     this.startAnimate.addEventListener(dragonBones.EventObject.COMPLETE,()=>{
        //         this.node.getChildByName("启动动画").active = false;            
        //         this.CheckLocalConfig();
        //         //初始化热更新
        //         this.initHotFix();
        //         if(cc.sys.isNative)
        //         {
        //             var searchPaths = jsb.fileUtils.getSearchPaths();
        //             console.log(searchPaths);
        //         }            
        //         console.log("加载updaste完成！！！");
        //     },this);
        //     this.startAnimate.playAnimation("newAnimation",1);
        // }
        // else
        // {
            this.node.getChildByName("启动动画").active = false;            
            this.CheckLocalConfig();
            //初始化热更新
            this.initHotFix();
            if(cc.sys.isNative)
            {
                var searchPaths = jsb.fileUtils.getSearchPaths();
                console.log(searchPaths);
            }            
            console.log("加载updaste完成！！！");
        //}








     }

     initHotFix()
     {
        this.fileProgressBar = this.fileProgressNode.getComponent(cc.ProgressBar);
        this.byteProgressBar = this.byteProgressNode.getComponent(cc.ProgressBar);
        this.fileProgressBar.progress = 0;
        this.byteProgressBar.progress = 0;

        //初始化对象池
        //ObjPoolManager.getInstance().addObj2Pool('房间对象',60);

        
        if(!cc.sys.isNative)
        {
            console.log("不是NATIVE项目，跳过热更检查");
            this.LoadWebLogin();
            return;
        }
        this.UpdateWebConfig();
        

        this._storagePath = jsb.fileUtils.getWritablePath()+"Remote";
        console.log("本地缓存目录:"+this._storagePath);

        let real = cc.sys.localStorage.getItem("realPath");
        if(real === null || real === "")
            cc.sys.localStorage.setItem("realPath",this._storagePath);


        




        this._am = new jsb.AssetsManager('', this._storagePath, this.versionCompareHanle.bind(this));
        let self = this;
        this._am.setVerifyCallback( function(path , asset) {
                let compressed = asset.compressed;
                let expectedMD5 = asset.md5;
                let relativePath = asset.path;
                let size = asset.size;
                if( compressed ){
                    self.info.string = "Verification passed : " + relativePath;
                    console.log(self.info.string);
                    return true;
                }
                else{
                    self.info.string = "Verification passed : " + relativePath + "(" + expectedMD5 + ")";
                    console.log(self.info.string);
                    return true;
                }
            });
        

        // Debug.Log("进入测试！~~~~~~~~~~~~");
        // let file = this._storagePath+"/project.manifest";
        // if(jsb.fileUtils.isFileExist(file))
        // {
        //     Debug.Log("找到文件:project");
        //     let strContent:string = jsb.fileUtils.getStringFromFile(file);
        //     Debug.Log(strContent);
        // }

        this.savepath.string = this._storagePath;
        

        //自动检测是否需要更新
        //this.checkUpdate();
     }

    // start () {
    //     super.start();
    // }

    // update (dt) {}

    onButtonClick(button:cc.Button)
    {
        console.log("点击事件1:"+button.node.name);
        if(button.node.name === "检查更新")
        {
            this.checkUpdate();
        }
        else if(button.node.name === "开始更新")
        {
            this.hotUpdate();
        }
        else if(button.node.name === "切换")
        {
            UIManager.getInstance().showPanel("panelLogin",ShowPanelMode.CloseOther,"",null);
        }
        else if(button.node.name == "重启")
        {
            cc.game.restart();
        }
        else if(button.node.name === "重试")
        {
            if(!cc.sys.isNative)
            {
                this.node.getChildByName("网络异常").active = false;
                this.LoadWebLogin();
                return;
            }
            this.checkUpdate();
            this.node.getChildByName("网络异常").active = false;
        }
        else if(button.node.name === "内网登陆")
        {
            //切换更新配置并重置           
            
            Debug.Log("开始切换到内网更新");
            let path = jsb.fileUtils.getWritablePath()+"Remote";
            let pro = path+"/project.manifest";
            if(!this.MotifyConfigFile(pro,SERVER_IP,LOCAL_HOT_UPDATE))
            {
                Debug.Log("写入文件失败！");
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,'失败');
                return;
            }   
            
            pro = path+"/version.manifest";
            this.MotifyConfigFile(pro,SERVER_IP,LOCAL_HOT_UPDATE);
    
            //cc.sys.localStorage.setItem("登陆模式","内网");
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,'内更新成功');
            this.scheduleOnce((dt)=>{
                console.log("游戏复位！");
                cc.game.restart();
            },0.3);
        }
        else if(button.node.name === "外网登陆")
        {
            //切换更新配置并重置
        
 
            Debug.Log("开始切换到外网更新");
            let path = jsb.fileUtils.getWritablePath()+"Remote";
            let pro = path+"/project.manifest";
            if(!this.MotifyConfigFile(pro,LOCAL_HOT_UPDATE,SERVER_IP))
            {
                return;
            }
            
            pro = path+"/version.manifest";
            this.MotifyConfigFile(pro,LOCAL_HOT_UPDATE,SERVER_IP) //ver可以不用必须替换
  
            //cc.sys.localStorage.setItem("登陆模式","外网");
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,'外更新成功');
            this.scheduleOnce((dt)=>{
                console.log("游戏复位！");
                cc.game.restart();
            },0.3);
        }
    }

    /**
     * Web构建的首个Cocos进度只覆盖启动场景。登录面板及其图片、字体等依赖
     * 会在场景启动后继续异步下载；先预加载并显示第二段进度，避免启动页被
     * 提前关闭后留下长时间黑屏。原生热更新不进入这里。
     */
    private LoadWebLogin()
    {
        if(this.isWebLoginLoading || !cc.isValid(this.node))
            return;

        this.isWebLoginLoading = true;
        this.fileProgressNode.active = false;
        this.byteProgressNode.active = true;
        this.byteProgressBar.progress = 0;
        // Prefab中的fileLabel实际位于当前可见的“大小进度”节点上方；
        // byteLabel属于已隐藏的“文件进度”节点，网页版百分比必须写到这里。
        if(this.fileLabel != null)
            this.fileLabel.string = "0%";
        if(this.info != null)
            this.info.string = "正在加载登录资源";

        cc.loader.loadRes("UI/panelLogin",
            (completedCount:number,totalCount:number,item:any)=>{
                if(!cc.isValid(this.node))
                    return;

                let progress = totalCount > 0 ? completedCount / totalCount : 0;
                progress = Math.max(0,Math.min(1,progress));
                this.byteProgressBar.progress = progress;
                if(this.fileLabel != null)
                    this.fileLabel.string = Math.floor(progress * 100) + "%";
            },
            (err,prefab)=>{
                this.isWebLoginLoading = false;
                if(!cc.isValid(this.node))
                    return;

                if(err)
                {
                    if(this.info != null)
                        this.info.string = "登录资源加载失败，请重试";
                    this.node.getChildByName("网络异常").active = true;
                    cc.error(err.message || err);
                    return;
                }

                this.byteProgressBar.progress = 1;
                if(this.fileLabel != null)
                    this.fileLabel.string = "100%";
                if(this.info != null)
                    this.info.string = "登录资源加载完成";

                // 资源已进入缓存，再打开面板时不会产生长时间的黑屏下载阶段。
                UIManager.getInstance().showPanel("panelLogin",ShowPanelMode.CloseOther,"",null);
            });
    }
    public MotifyConfigFile(file:string,src:string,des:string):boolean
    {   
        Debug.Log(file)
        if(jsb.fileUtils.isFileExist(file))
        {
            Debug.Log("找到文件:"+file);
            let strContent:string = jsb.fileUtils.getStringFromFile(file);
            //修改文件
            strContent = strContent.replace(RegExp(src,'g'),des);   
            let out = jsb.fileUtils.writeStringToFile(strContent,file);
            return out;
        }
        else
        {
            Debug.Log("没有找到:"+file);
            return false;
        }
    }
    //检查是否有更新文件，没有则在资源目录中复制一份
    public CheckLocalConfig(){
        if(!cc.sys.isNative)
            return;
        let path = jsb.fileUtils.getWritablePath()+"Remote";
        let file = path+"/project.manifest";
        if(!jsb.fileUtils.isFileExist(file))
        {
            cc.loader.loadRes("project",(err,conf)=>{
                if(err)
                {
                    Debug.Log('加载资源project.manifest失败!!!')
                    cc.error(err.message || err);
                    return null;
                }
                let out = jsb.fileUtils.writeStringToFile(conf._nativeAsset,file);
            });
        }
        else
        {
            Debug.Error("更新文件project.manifest已存在!");
        }

        var verFile = path+"/version.manifest";
        if(!jsb.fileUtils.isFileExist(verFile))
        {
            Debug.Error("version.manifest不存在，自动创建");
            cc.loader.loadRes("version",(err,conf)=>{
                if(err)
                {
                    cc.error(err.message || err);
                    return null;
                }
                let out = jsb.fileUtils.writeStringToFile(conf._nativeAsset,verFile);
            });
        }
        else
        {
            Debug.Error("version.manifest已存在!");
        }

        let arrayAll:string[] = jsb.fileUtils.listFiles(path);
        for(var item of arrayAll)
        {
            Debug.Error(item);
        }
    }

    //检查更新
    private getLocalManifestUrl(): string
    {
        if(!this.mainifestUrl)
            return "";
        return (this.mainifestUrl as any).nativeUrl || (this.mainifestUrl as any).url || String(this.mainifestUrl);
    }

    checkUpdate()
    {
        console.log("开始检查更新");
        if(this._updating)
        {
            this.info.string = "检查更新中"
            console.log(this.info.string);
            return;
        }
        this.info.string = "开始检查更新";
        //读取本地配置
        if ( this._am.getState() == jsb.AssetsManager.State.UNINITED){
                let url = this.getLocalManifestUrl();
                cc.log(`mainifestUrl : ${url}`);
                this._am.loadLocalManifest(url);    
        }

        if ( !this._am.getLocalManifest() || !this._am.getLocalManifest().isLoaded()){    
            this.info.string = "解析本地 manifest 文件失败!";    
            console.log(this.info.string);
            return;    
        }

        //缓存本地版本号
        GameDataManager.getInstance().strLocalVertion = this._am.getLocalManifest().getVersion()
        this.node.getChildByName("ver").getComponent(cc.Label).string = GameDataManager.getInstance().strLocalVertion;

        this._updating = true;    
        this._am.setEventCallback(this.checkCb.bind(this));    
        this._am.checkUpdate();
    }
    //开始更新
    hotUpdate( ){
        if ( this._am && !this._updating ){    
            this._am.setEventCallback(this.updateCb.bind(this));    
            if ( this._am.getState() === jsb.AssetsManager.State.UNINITED){    
                this._am.loadLocalManifest(this.getLocalManifestUrl());
            }    
            //this._updating = true;    
            this._am.update();    
        }    
    }
    //更新回调
    private updateCb( event ){
        var needRestart = false;
        var failed = false;
        cc.log( `--update cb code : ${event.getEventCode()}`)
        let bNeedReUpdate = false;
        switch (event.getEventCode())
        {
            case jsb.EventAssetsManager.ERROR_NO_LOCAL_MANIFEST:
                this.info.string = '没找到本地mainfast文件';
                console.log(this.info.string);
                failed = true;
                bNeedReUpdate = true;
                break;
            case jsb.EventAssetsManager.UPDATE_PROGRESSION:
                this.byteProgressBar.progress = event.getPercent();
                this.fileProgressBar.progress = event.getPercentByFile();
                this.fileLabel.string = event.getDownloadedFiles() + ' / ' + event.getTotalFiles();
                this.byteLabel.string = event.getDownloadedBytes() + ' / ' + event.getTotalBytes();
                var msg = event.getMessage();
                if (msg) {
                    this.info.string = 'Updated file: ' + msg;
                    console.log(this.info.string);
                }
                break;
            case jsb.EventAssetsManager.ERROR_DOWNLOAD_MANIFEST:
            case jsb.EventAssetsManager.ERROR_PARSE_MANIFEST:
                this.info.string = '下载mainfest文件失败！';
                console.log(this.info.string);
                failed = true;
                bNeedReUpdate = true;
                break;
            case jsb.EventAssetsManager.ALREADY_UP_TO_DATE:
                this.info.string = '已经是最新版本！';
                console.log(this.info.string);
                failed = true;
                break;
            case jsb.EventAssetsManager.UPDATE_FINISHED:
                this.info.string = '更新完成！' + event.getMessage();
                console.log(this.info.string+"@@@@"+event.getTotalFiles());
                needRestart = true;
                break;
            case jsb.EventAssetsManager.UPDATE_FAILED:
                this.info.string = '更新失败! ' + event.getMessage();
                console.log(this.info.string);
                this._updating = false;
                bNeedReUpdate = true;
                break;
            case jsb.EventAssetsManager.ERROR_UPDATING:
                this.info.string = 'Asset update error: ' + event.getAssetId() + ', ' + event.getMessage();
                console.log(this.info.string);
                bNeedReUpdate = true;
                break;
            case jsb.EventAssetsManager.ERROR_DECOMPRESS:
                this.info.string = event.getMessage();
                console.log(this.info.string);
                bNeedReUpdate = true;
                break;
            default:
                break;
        }
        if (failed) {
            this._am.setEventCallback(null);
            this._updating = false;
        }
        if (needRestart) {
            this._am.setEventCallback(null);
            // Prepend the manifest's search path
            var searchPaths = jsb.fileUtils.getSearchPaths();
            var newPaths = this._am.getLocalManifest().getSearchPaths();
            Debug.Log("old:"+JSON.stringify(searchPaths));
            Debug.Log("add"+JSON.stringify(newPaths));


            //删除已经存在的PATH
            for(let i=(newPaths.length-1);i>=0;i--)
            {
                for(let j=0;j<searchPaths.length;j++)
                {
                    if(newPaths[i] === searchPaths[j])
                    {
                        console.log("存在删除:"+newPaths[i]);
                        newPaths.splice(i,1);
                        break;   
                    }
                }   
            }  
            Array.prototype.unshift.apply(searchPaths, newPaths);
            console.log("new:"+JSON.stringify(searchPaths)); 
            cc.sys.localStorage.setItem('HotUpdateSearchPaths', JSON.stringify(searchPaths));
            jsb.fileUtils.setSearchPaths(searchPaths);
            console.log("更新到新的PATH:"+searchPaths);
            this.byteProgressBar.progress = 1;
            this.fileProgressBar.progress = 1;
            this.fileLabel.string = "";
            this.byteLabel.string = "";


            Debug.Log("当前local版本:"+GameDataManager.getInstance().strLocalVertion);
            Debug.Log("当前Remote版本:"+GameDataManager.getInstance().strRemoteVertion);

            //更新完毕，记录下CACH中的版本号
            cc.sys.localStorage.setItem("tempver",GameDataManager.getInstance().strRemoteVertion)

            Debug.Log("????????????");  
 
           this.scheduleOnce((dt)=>{
               console.log("热更新完成，执行 Cocos 官方重启流程 v2");
               cc.game.restart();
           },0.3);
        }
        if(bNeedReUpdate)
        {
            Debug.Log("需要再次检车2222！！！！");
            //this.checkUpdate();
            this.node.getChildByName("网络异常").active = true;
        }
        else
        {
            Debug.Log("不需要继续检查！！");
            this.node.getChildByName("网络异常").active = false;
        }

    }


    //版本比较
    private versionCompareHanle( versionA : string , versionB : string ){

        GameDataManager.getInstance().strLocalVertion = versionA;

        Debug.Log(`JS Custom Version Compare : version A is ${versionA} , version B is ${versionB}`);
        let vA = versionA.split('.');
        let vB = versionB.split('.');
        Debug.Log(`version A ${vA} , version B ${vB}`);
        for( let i = 0 ; i < vA.length && i < vB.length ; ++i ){
            let a = parseInt(vA[i]);
            let b = parseInt(vB[i]);
            if ( a === b ){
                continue;
            }
            else{
                return a - b;
            }
        }
        if ( vB.length > vA.length){
            return -1;
        }
        return 0;        
    }
    //检测更新回调
    checkCb( event ){
        let needRestart = false;    
        let failed = false;    
        let bNeedReUpdate = false;
        cc.log(`checkCb event code : ${event.getEventCode()}`);    
        switch (event.getEventCode())    
        {    
            case jsb.EventAssetsManager.ERROR_NO_LOCAL_MANIFEST:    
                this.info.string = "未找到本地mainfest配置文件!";    
                console.log(this.info.string);
                break;    
            case jsb.EventAssetsManager.ERROR_DOWNLOAD_MANIFEST:    
            case jsb.EventAssetsManager.ERROR_PARSE_MANIFEST:    
                this.info.string = "下载mainfest文件失败";    
                console.log(this.info.string);
                bNeedReUpdate = true;
                break;    
            case jsb.EventAssetsManager.ALREADY_UP_TO_DATE:    
                this.info.string = "当前已经是最新版本！";    
                console.log(this.info.string);

                break;    
            case jsb.EventAssetsManager.NEW_VERSION_FOUND:    
                this.info.string = '发现新版本，准备更新';    
                console.log(this.info.string);
                //this.checkBtn.active = false;    
                this.fileProgressBar.progress = 0;    
                this.byteProgressBar.progress = 0;    
                break;    
            default:    
                return;    
        }  
        this._am.setEventCallback(null);    
        this._updating = false;   

        if(event.getEventCode() === jsb.EventAssetsManager.NEW_VERSION_FOUND)
        {
            //更新方式检测，大版本更新需要重新下载，小版本直接更新
            let local:string = this._am.getLocalManifest().getVersion();
            let remote:string = this._am.getRemoteManifest().getVersion()

            GameDataManager.getInstance().strRemoteVertion = remote;

            let vL = local.split('.');
            let vR = remote.split('.');
            let bNeedFoucrUpdate = false;
            if(vL[0]<vR[0])
            {
                bNeedFoucrUpdate = true;
            }
            else if(vL[0] === vR[0])
            {
                if(vL[1]<vR[1])
                {
                    bNeedFoucrUpdate = true;
                }
            }
            if(bNeedFoucrUpdate) //需要强制更新
            {
                UIManager.getInstance().showPanel("panelVertion",ShowPanelMode.Cover);
            }
            else
            {
                //开始启动自动更新
                this.hotUpdate();
            }


        }
        else if(event.getEventCode() === jsb.EventAssetsManager.ALREADY_UP_TO_DATE)
        {
            //检测缓存版本是不是低于安装版本
            let tempver:string = cc.sys.localStorage.getItem("tempver");
            let local:string = this._am.getLocalManifest().getVersion();


            Debug.Log("开始获取列表:temp:"+tempver +" local:"+local);

            if(tempver === null || tempver === "") //首次安装，没有旧热更新缓存
            {
                Debug.Log("首次安装，记录当前版本并进入登录页");
                cc.sys.localStorage.setItem("tempver",local);
                UIManager.getInstance().showPanel("panelLogin",ShowPanelMode.CloseOther);
            }
            else if(tempver != local) //缓存过旧，需要清除后重启
            {
                Debug.Log("缓存版本过旧，需要删除！");
                this.DeleteAllFiles(this._storagePath);
                //复位老版本号
                cc.sys.localStorage.setItem("tempver",local);

                //重启游戏
                this.scheduleOnce((dt)=>{
                    console.log("游戏复位11！");
                    cc.game.restart();
                },0.3);
            }
            else
            {
                this.ShowAllFiles(this._storagePath);
                //切换到登陆页面
                UIManager.getInstance().showPanel("panelLogin",ShowPanelMode.CloseOther);
            }            
        }
        if(bNeedReUpdate)
        {
            Debug.Log("a需要再次检车1111！！！！");
            //this.checkUpdate();
            this.node.getChildByName("网络异常").active = true;
        }
        else
        {
            Debug.Log("不需要继续检查！！");
            this.node.getChildByName("网络异常").active = false;
        }
    }

    public DeleteAllFiles(strPath:string)
    {
        let arrayAll:string[] = jsb.fileUtils.listFiles(strPath);
        for(let one of arrayAll)
        {
            if(one.indexOf("../")>=0 || one.indexOf("./")>=0)
            {
                Debug.Log("跳过:"+one);
                continue;
            }
            if(one.lastIndexOf("/") == one.length-1)
            {
                Debug.Log("目录:"+one);
                this.DeleteAllFiles(one);
            }
            else
            {
                Debug.Log("删除:"+one);
                jsb.fileUtils.removeFile(one);
            }
        }
    }

    public ShowAllFiles(strPath:string)
    {
        let arrayAll:string[] = jsb.fileUtils.listFiles(strPath);
        for(let one of arrayAll)
        {
            if(one.indexOf("../")>=0 || one.indexOf("./")>=0)
            {
                Debug.Log("跳过:"+one);
                continue;
            }
            if(one.lastIndexOf("/") == one.length-1)
            {
                Debug.Log("目录:"+one);
                this.ShowAllFiles(one);
            }
            else
            {
                Debug.Log("文件:"+one);
            }
        }
    }

    public UpdateWebConfig()
    {
        if(this.info != null)
            this.info.string = "开始同步服务器."+this.nWebLoadCount++;


        //解析更新配置

        this.scheduleOnce(()=>{
            ConfigManager.getInstance().ios_down_url = ""; 
            ConfigManager.getInstance().android_down_url = "";
            
            
            //解析游戏配置
            ConfigManager.getInstance().enalbe_gps = "True";
            ConfigManager.getInstance().resetPwdUrl = "";
            if(!cc.sys.isNative)
            {
                console.log("不是NATIVE项目，跳过热更检查");
                UIManager.getInstance().showPanel("panelLogin",ShowPanelMode.CloseOther,"",null);
                return;
            }
            else
            {
                this.checkUpdate()
            }
        },0.5)






        // //跳过检测原创配置
        // if(!cc.sys.isNative)
        // {
        //     console.log("不是NATIVE项目，跳过热更检查");
        //     UIManager.getInstance().showPanel("panelLogin",ShowPanelMode.CloseOther,"",null);
        //     return;
        // }
        // else
        // {
        //     this.checkUpdate()
        // }


        // //获取网络配置文件
        // let web = new XMLHttpRequest();
        // web.onreadystatechange = (event)=>{
        //     if (web.readyState == 4 && (web.status >= 200 && web.status < 400)) {
        //         var response = web.responseText;
        //         //解析服务器配置
        //         let json = JSON.parse(web.responseText);
        //         Debug.Log(web.responseText);
                
        //         let updateApp = json["updateApp"];
        //         //解析更新配置
        //         for(let i=0;i<updateApp.length;i++)
        //         {
        //             let one = updateApp[i];
        //             if(one["channelName"] == "iOS-AppStore")
        //             {
        //                 ConfigManager.getInstance().ios_down_url = one["url"];
        //             }
        //             else if(one["channelName"] == "android")
        //             {
        //                 ConfigManager.getInstance().android_down_url = one["url"];
        //             }
        //         }
        //         //解析游戏配置
        //         let gameConfig = json["gameConfig"];
        //         ConfigManager.getInstance().enalbe_gps = gameConfig["enable_gps"];
        //         ConfigManager.getInstance().resetPwdUrl = gameConfig["pwd_url"];
        //         //解析权限配置
        //         let levelConfig = json["levelConfig"];

        //         if(!cc.sys.isNative)
        //         {
        //             console.log("不是NATIVE项目，跳过热更检查");
        //             UIManager.getInstance().showPanel("panelLogin",ShowPanelMode.CloseOther,"",null);
        //             return;
        //         }
        //         else
        //         {
        //             this.checkUpdate()
        //         }

                
        //     }
        //     else
        //     {

        //     }
        //     console.log("WEB状态->readyState:"+web.readyState+" status:"+web.status);
        //     console.log("WEB返回22:"+web.responseText);           
        //    // this.checkUpdate()
        // };
        // web.onerror = (event1:ProgressEvent<EventTarget>)=>{
        //     console.log(event1);
        //     console.log("WEB状态->readyState:"+web.readyState+" status:"+web.status);
        //     console.log("WEB返回1:"+web.responseText); 

        //     this.scheduleOnce(()=>{
        //         this.UpdateWebConfig();
        //     },3);
              
        // };
        // web.ontimeout = (event)=>{
        //     console.log(event);
        //     console.log("1WEB状态->readyState:"+web.readyState+" status:"+web.status);
        //     console.log("1WEB返回:"+web.responseText);   
        //     this.scheduleOnce(()=>{
        //         this.UpdateWebConfig();
        //     },3);
        // };
        // let random = new Date().getTime();
        // let strUrl = "http://" + WEB_IP + ":" + WEB_PORT + "/"+ "server/game.config?v=" + random; 
        // console.log(strUrl);
        // web.open("GET",strUrl);
        // web.send();
    }


}
