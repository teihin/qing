import Debug from "../common/Debug";
import GameDataManager from "../GameDataManager";
import Tool from "../common/Tool";
import GameDef, { SERVER_IP, WEB_IP, WEB_PORT, WEB_IP_PIC, WEB_PORT_PIC } from "../common/GameDef";


var KBEngine = require("kbengine");
const {ccclass, property} = cc._decorator;

@ccclass
export default class ImageManager extends cc.Component {

    private mapID2Sprite = new Map<string, cc.SpriteFrame>();  //名字到图片缓存
    private mapID2ImageSave = new Map<string, Array<cc.Sprite>>();   //缓存等待刷新图片结果返回的控件
    //private mapID2Url = new Map<string, string>(); //ID到URL缓存

    static instance: ImageManager
    static getInstance() {
        if (!ImageManager.instance) {            
            let node = new cc.Node("ImageManager");
            cc.game.addPersistRootNode(node);
            this.instance = node.addComponent(ImageManager);       
            
            this.instance.intiEvent();
        }
        return ImageManager.instance;
    }

    onDestroy(){
        KBEngine.Event.deregisterAll(this);
        ImageManager.instance = null;
    }

    intiEvent()
    {
        KBEngine.Event.register("UserList", this, "OnAccountList"); 
    }

    public GetImageByName(strImgName:string,strImgUrl:string,imgSrc:cc.Sprite):boolean
    {
        // if(cc.sys.isBrowser)
        //     return true;

        
        if(strImgName.length>4 && cc.isValid(imgSrc))
        {
            //先找缓存
            if(this.mapID2Sprite.has(strImgName) && !cc.sys.isBrowser)
            {
                let cash = this.mapID2Sprite.get(strImgName);
                if(cash != null)
                {
                    imgSrc.spriteFrame = cash;
                }
                else
                {
                    Debug.Log("@@@@@@@@@@@@@@@@@@@@@@@找到头像问题！！！！！：" + strImgName);
                }
            }
            else
            {
                //缓存没有尝试打开文件
                if(!cc.sys.isBrowser) //缓存只支持移动平台
                {
                    var writeable_path = jsb.fileUtils.getWritablePath();
                    Debug.Log("缓存路径:"+writeable_path);
                    let filePath = writeable_path +"Image/"+strImgName+".png";

                    //校验文件是否存在
                    if( !jsb.fileUtils.isFileExist(filePath)){                        
                        Debug.Log("本地图片不存在!");
                    }
                    else
                    {
                        cc.loader.load(filePath,(err,texture)=>{
                            if(err)
                            {
                                cc.error(err.message || err);
                                return null;
                            }
                            let frame = new cc.SpriteFrame(texture);
                            imgSrc.spriteFrame = frame;
    
                            this.mapID2Sprite.set(strImgName,frame);
                        });
                    }


                }
            }
            

            if (strImgUrl.indexOf("http")<0||strImgUrl == "")
            {
                return false;                
            }

            

            //重新获取下网络图片文件
            var xhr = new XMLHttpRequest();
            xhr.onreadystatechange = function () {
                if (xhr.readyState === 4 ) {
                    if(xhr.status === 200){    

                        if(!cc.sys.isBrowser)
                        {
                            var writeable_path = jsb.fileUtils.getWritablePath();
                            Debug.Log("缓存路径:"+writeable_path);
                            let dirpath = writeable_path+"Image";
                            let filePath = writeable_path +"Image/"+strImgName+".png";
                            if( !jsb.fileUtils.isDirectoryExist(dirpath) ){                        
                                jsb.fileUtils.createDirectory(dirpath);
                            }
        
                            if( jsb.fileUtils.writeDataToFile( new Uint8Array(xhr.response) , filePath) )
                            {
                                Debug.Log('Remote write file succeed.');
                                cc.loader.load({url:strImgUrl,type:"png"},function (err,tex) {
                                    var spriteFrame = new cc.SpriteFrame(tex);
                                    this.mapID2Sprite.set(strImgName,spriteFrame);
                                    if(cc.isValid(imgSrc))
                                        imgSrc.spriteFrame = spriteFrame;
                                }.bind(this));
                            }else{
                                Debug.Log('Remote write file failed.');
                            }
                        }
                        else
                        {
                            cc.loader.load({url:strImgUrl,type:"png"},function (err,tex) {
                                var spriteFrame = new cc.SpriteFrame(tex);
                                if(cc.isValid(imgSrc))
                                    imgSrc.spriteFrame = spriteFrame;
                            });
                        }

                    }
                }
            }.bind(this);
            //responseType一定要在外面设置

            xhr.onerror = ()=>{
                Debug.Log("异常！！！！onerror")
                if(cc.isValid(imgSrc))
                {
                    Tool.LoadImg(imgSrc,"other/Default_Man_Head"); 
                }
            };
            xhr.ontimeout = ()=>{
                Debug.Log("异常！！！！ontimeout")
                if(cc.isValid(imgSrc))
                {
                    Tool.LoadImg(imgSrc,"other/Default_Man_Head"); 
                }
            };
            
           // xhr.setRequestHeader("Access-Control-Allow-Origin", "*");
            xhr.responseType = 'arraybuffer';
            xhr.open("GET", strImgUrl, true);
            xhr.send();

            return true;
        }
        return false;
    }

    public AddWaitFreshImage2Catch(strID:string, img:cc.Sprite)
    {
        let bNeedGet = false;
        let arrayList:Array<cc.Sprite> = null;
        if (!this.mapID2ImageSave.has(strID))
        {
            arrayList = new Array<cc.Sprite>();
            this.mapID2ImageSave.set(strID, arrayList);
            bNeedGet = true;
        }
        else
        {
            arrayList = this.mapID2ImageSave.get(strID);
        }
        let bFind = false;
        for (let i = 0; i < arrayList.length; i++)
        {
            if (img === arrayList[i])
            {
                bFind = true;
                break;
            }
        }
        if (!bFind)
        {
            arrayList.push(img);
        }
        if(bNeedGet)
        {
            let strParam = "{\"header\":\"查询_用户_头像\",\"user_id\":\"" + strID + "\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_用户_头像");
        }
    }

    public OnAccountList(strMsg:string)
    {
        Debug.Log("img"+strMsg);
        let data = JSON.parse(strMsg);        

        let strID = data["id"].toString();
        let strPhoto:string = data["photo"].toString();

        if (this.mapID2ImageSave.has(strID))
        {
            let arrayList:Array<cc.Sprite> = this.mapID2ImageSave.get(strID);
            if (strPhoto != "")
            {
                //处理带本地的特殊图片地址
                if(strPhoto.indexOf("localhost")>=0)
                {
                   strPhoto = strPhoto.replace("localhost",WEB_IP_PIC+":"+WEB_PORT_PIC);
                }
                
                arrayList.forEach((img,idx,array)=>{
                    if (img != null && cc.isValid(img))
                    {
                        ImageManager.getInstance().GetImageByName(strID, strPhoto, img);
                    }
                },this);

            }
            Tool.ClearArray(arrayList);
            this.mapID2ImageSave.delete(strID);           
        }
        
    }
}
