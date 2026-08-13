import Debug from "./Debug";
import UIManager from "./UIManager";
import { ShowPanelMode, WEB_TX_IP } from "./GameDef";
var CryptoJS = require("core")

const {ccclass, property} = cc._decorator;

@ccclass
export default class Tool extends cc.Component{
    public static PrefixNumber(num, length) 
    {
        return (Array(length).join('0') + num).slice(-length);
    }

    public static GetChild(root:cc.Node,strName:string):cc.Node
    {
        if(root == null || root == undefined)
            return null
        if(root.childrenCount<=0)
            return null;
        let arrayAll = strName.split("/",100);
        let find = root; 
        for(let item of arrayAll)
        {
            find = find.getChildByName(item);
            if(find == null)
            break;
        }
        return find;
    }

    public static LoadImg(img:cc.Sprite,strPath:string,action:Function = null)
    {
        cc.loader.loadRes(strPath,cc.SpriteFrame,(err,obj)=>{
            if(err)
            {
                cc.error(err.message || err);
                return null;
            }
            if(img == null )
                return null
            img.spriteFrame = obj;
            if(action!= null)
            {
                action();
            }
        });
    }

    public static ClearArray(array:Array<any>)
    {
        while(array.length>0)
        {
            array.pop();
        }
    }

    public static GetArrayRange(array:Array<any>,index:number,count:number):Array<any>
    {
        let arrayReturn  = new Array<any>();
        if(index>=array.length || (index+count)>array.length)
            return arrayReturn;


        for(let i=0;i<count;i++)
        {
            arrayReturn.push(array[i+index]);
        }

        return arrayReturn;
    }

    public static GetConfigString(strKey:string,strDef:string = "")
    {
        let item = cc.sys.localStorage.getItem(strKey);
        if(item == null)
        {
            cc.sys.localStorage.setItem(strKey,strDef);
            return strDef;
        }
        else
        {
            return item;
        }
    }
    public static GetConfigNumber(strKey:string,nDef:number=0)
    {
        let item = cc.sys.localStorage.getItem(strKey);
        if(item == null)
        {
            cc.sys.localStorage.setItem(strKey,nDef);
            return nDef;
        }
        else
        {
            return item;
        }
    }
    public static SendMMS(strPhone:string):string
    {
        let mobile = strPhone; 
        let strPass = Tool.GetRandPass();
        let strUrl = "http://"+WEB_TX_IP+"/api/Verification?phone="+mobile+"&code="+strPass
        Debug.Log(strUrl)
        Tool.HTTP_GET(strUrl,(ret)=>{
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"验证码发送成功！") 
        },(err)=>{
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"获取验证码失败！") 
        })
        return strPass;
    }
    public static SendMMS2(strPhone:string):string
    {
        let encode = "UTF-8";
        let username = "";  //用户名
        let password_md5 = "";
        let mobile = strPhone;  
        let apikey = "";
        let strPass = Tool.GetRandPass();
        let content = "【安全码】验证码:" + strPass + "，请尽快验证登录。";
        Debug.Log(content);
        let content2 = encodeURIComponent(content);
        let sbTemp = "username=" + username + "&password_md5=" + password_md5 + "&mobile=" + mobile + "&apikey=" + apikey + "&content=" + content2 + "&encode=" + encode;
        Debug.Log("发送内容:" + sbTemp);


        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4 ) {
                if(xhr.status === 200){    
                    if(xhr.responseText.indexOf("succe")>=0)
                    {
                        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"验证码发送成功！") 
                    }
                    else
                    {
                        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"获取验证码失败！") 
                    }
                                  
                }
            }
            console.log(xhr);
        }.bind(this);
        //responseType一定要在外面设置

        xhr.open("POST","http://m.5c.com.cn/api/send/?", true);
        xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
        xhr.send(sbTemp);

        return strPass;
    }
    private static GetRandPass()
    {
        let strPass = "";

        let max:number = 9;
        let min:number = 1;

        for(let i = 0; i<4; i++) {
            let x = Math.floor(Math.random() * (max - min + 1)) + min;
            strPass += x.toString();
         }


        return strPass;
    }

    public static Base64Encode(str:string):string
    {
        return btoa(encodeURIComponent(str));
    }
    public static Base64Decode(str:string):string
    {
        return decodeURIComponent(atob(str));
    }
    /** 公告等多行纯文本统一使用 LF，保留空行、缩进和连续空格。 */
    public static NormalizeMultilineText(str:string):string
    {
        if(str == null)
            return "";
        return str.replace(/\r\n/g,"\n").replace(/\r/g,"\n");
    }
    //复位并重启游戏
    public static RestartGame()
    {
        //清理所有全局节点
        let all = cc.director.getScene().children;
        Debug.Log("节点数:"+all.length)
        for(let one of all)
        {
            Debug.Log(one.name);
            if(one.name === "Canvas")
                continue;
            one.destroy();
        }

        cc.game.restart();
    }
    //中文判断
    public static IsAllChinese(strMsg:string):boolean
    {
       var pattern=/^[\u4E00-\u9FA5]+$/;
       if (!pattern.test(strMsg)) 
        { 
            console.log("还有其他字符");
            return false;
        }else{ 
            console.log("全是中文");
            return true;
        } 
    }
    public static aesKeyBytes(passkey = "") 
    {
        if(passkey == "")
        {
            passkey = "b2R1o7o3c5e23T48mRl2rhC9o5ao039F"
        }
        
        var keyBytes = CryptoJS.SHA1(passkey).toString().substring(0, 16);
        return keyBytes;
    }
    public static encrypt(str,passkey = "")  //passkey是密钥，不同平台密钥不一样
    {
        // 字符串类型的key用之前需要用uft8先parse一下才能用 
        var key = CryptoJS.enc.Utf8.parse(Tool.aesKeyBytes(passkey));
        // 加密
        var encryptedData = CryptoJS.AES.encrypt(str, key, { mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7
        });
        return encryptedData.ciphertext.toString();
    }

       //HTTP方法
       public static HTTP_POST(strUrl:string,msg:any,callback:any,error:any)
       {
   
           var xhr = new XMLHttpRequest();
           xhr.onreadystatechange = function () {
               if (xhr.readyState === 4 ) {
                   if(xhr.status === 200){    
                       //console.log(xhr);
                       callback(xhr)
                   }
               }
               
           }.bind(this);
   
           xhr.open("POST",strUrl, true);
           xhr.setRequestHeader("Content-Type", "application/jsons"); //application/jsons
           xhr.send(msg);  
   
           xhr.onabort = (event1:ProgressEvent<EventTarget>)=>{
               error()
           };
           xhr.onerror = (event1:ProgressEvent<EventTarget>)=>{
               error()
           };
           xhr.ontimeout = (event1:ProgressEvent<EventTarget>)=>{
               error()
           };
       }
       //HTTP方法
       public static HTTP_GET(strUrl:string,callback:any,error:any)
       {
   
           var xhr = new XMLHttpRequest();
           xhr.onreadystatechange = function () {
               if (xhr.readyState === 4 ) {
                   if(xhr.status === 200){    
                       //console.log(xhr);
                       callback(xhr)
                   }
               }
               
           }.bind(this);
   
           xhr.open("GET",strUrl, true);
   
           xhr.send(); 
            
           xhr.onabort = (event1:ProgressEvent<EventTarget>)=>{
               error()
           };
           xhr.onerror = (event1:ProgressEvent<EventTarget>)=>{
               error()
           };
           xhr.ontimeout = (event1:ProgressEvent<EventTarget>)=>{
               error()
           };
       }

    public static getDateFromString(str){
        var reg = /^(\d+)-(\d+)-(\d+) (\d+):(\d+):(\d+)/;
        var s  = str.match(reg);
        let result = null;
        if(s){
            result = new Date(s[1],s[2] - 1,s[3],s[4],s[5],s[6]);                              
        }
        return result ;
    } 
    public static getTimeSpan(begin,end){
        // var begin = Tool.getDateFromString("2019-06-11 16:18:15");
        // var end = Tool.getDateFromString("2019-06-13 16:18:15");
        var result = (end - begin) / (1000 * 60 * 60 * 24);    //计算天
        let nSpan = result.toFixed(0);
        return nSpan;
    }
}
