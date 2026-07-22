import GameDataManager from "../GameDataManager";
import UIManager from "../common/UIManager";
import { ShowPanelMode } from "../common/GameDef";
import Tool from "../common/Tool";
import Debug from "../common/Debug";

const {ccclass, property} = cc._decorator;

@ccclass
export default class UpdateManager extends cc.Component {
    private _storagePath = "";
    private _am = null;
    private _updating = false;
    private mainifestUrl: cc.RawAsset= null;


    static instance: UpdateManager
    static getInstance() {
        if (!UpdateManager.instance) {            
            let node = new cc.Node("UpdateManager");
            cc.game.addPersistRootNode(node);
            this.instance = node.addComponent(UpdateManager);  
            this.instance.InitManager();     
        }
        return UpdateManager.instance;
    }

    onDestroy(){
        UpdateManager.instance = null;
    }
    // onLoad () {}

    start () {

    }

    public InitManager()
    {
        if(!cc.sys.isNative)
        {
            return;
        }
        this._storagePath = jsb.fileUtils.getWritablePath()+"Remote";
        console.log("本地缓存目录:"+this._storagePath);


        this._am = new jsb.AssetsManager('', this._storagePath, this.versionCompareHanle.bind(this));
                let self = this;
                this._am.setVerifyCallback( function(path , asset) {
                        let compressed = asset.compressed;
                        let expectedMD5 = asset.md5;
                        let relativePath = asset.path;
                        let size = asset.size;
                        if( compressed ){
                            console.log("Verification passed : " + relativePath);
                            return true;
                        }
                        else{
                            console.log("Verification passed : " + relativePath + "(" + expectedMD5 + ")");
                            return true;
                        }
                    });
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
    // update (dt) {}
    //检查更新
    public checkUpdate(checkUrl:cc.RawAsset)
    {
        console.log("开始检查更新");

        if(!cc.sys.isNative)
        {
            return;
        }


        this.mainifestUrl = checkUrl;
        //读取本地配置
        if ( this._am.getState() == jsb.AssetsManager.State.UNINITED){
                let url = this.mainifestUrl;    
                cc.log(`mainifestUrl : ${this.mainifestUrl}`);    
                this._am.loadLocalManifest(url);    
        }

        if ( !this._am.getLocalManifest() || !this._am.getLocalManifest().isLoaded()){    
            let strMsg = "解析本地 manifest 文件失败! ....";    
            console.log(strMsg);
            return;    
        }

    
        this._updating = true;    
        this._am.setEventCallback(this.checkCb.bind(this));    
        this._am.checkUpdate();
    }
    //检测更新回调
    public checkCb( event ){
            let needRestart = false;    
            let failed = false;    
            let bNeedReUpdate = false;
            cc.log(`checkCb event code : ${event.getEventCode()}`); 
            let strMsg = "";   
            switch (event.getEventCode())    
            {    
                case jsb.EventAssetsManager.ERROR_NO_LOCAL_MANIFEST:    
                    strMsg = "未找到本地mainfest配置文件!";    
                    console.log(strMsg);
                    break;    
                case jsb.EventAssetsManager.ERROR_DOWNLOAD_MANIFEST:    
                case jsb.EventAssetsManager.ERROR_PARSE_MANIFEST:    
                    strMsg = "下载mainfest文件失败";    
                    console.log(strMsg);
                    bNeedReUpdate = true;
                    break;    
                case jsb.EventAssetsManager.ALREADY_UP_TO_DATE:    
                    strMsg = "当前已经是最新版本！";    
                    console.log(strMsg);
    
                    break;    
                case jsb.EventAssetsManager.NEW_VERSION_FOUND:    
                    strMsg = '发现新版本，准备更新';    
                    console.log(strMsg);   
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
                if(vL[0]<vR[1])
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
                    cc.game.restart();
                }
    
    
            }
            else if(event.getEventCode() === jsb.EventAssetsManager.ALREADY_UP_TO_DATE)
            {
          
            }
        }
}
