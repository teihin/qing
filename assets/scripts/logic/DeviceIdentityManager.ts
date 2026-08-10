import Debug from "../common/Debug";

export interface DeviceIdentity {
    available:boolean;
    deviceId:string;
    platform:"android"|"ios"|"web";
    version:number;
    persistent:boolean;
    message:string;
}

const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,255}$/;
const WEB_STORAGE_KEY = "qing_device_id_v1";
const WEB_DB_NAME = "qing_device_identity";
const WEB_STORE_NAME = "identity";
const WEB_RECORD_KEY = "device_id";

/**
 * 防盗号设备标识的唯一入口。
 *
 * Android/iOS 只调用项目级 QingDeviceBridge；Web 以 IndexedDB 为主存储，
 * localStorage 为镜像。完整设备 ID 不写日志，也不暴露给界面。
 */
export default class DeviceIdentityManager {
    private static instance:DeviceIdentityManager = null;
    private _preparePromise:Promise<DeviceIdentity> = null;
    private _identity:DeviceIdentity = null;

    public static getInstance():DeviceIdentityManager
    {
        if(DeviceIdentityManager.instance == null)
            DeviceIdentityManager.instance = new DeviceIdentityManager();
        return DeviceIdentityManager.instance;
    }

    public prepare():Promise<DeviceIdentity>
    {
        if(this._identity != null)
            return Promise.resolve(this._identity);
        if(this._preparePromise == null)
        {
            this._preparePromise = this.loadIdentity().then((identity:DeviceIdentity)=>{
                this._identity = identity;
                return identity;
            }).catch((error:any)=>{
                Debug.Error("设备标识初始化失败:" + this.errorText(error));
                this._identity = this.unavailableIdentity("当前设备信息获取失败，请重启游戏后再试");
                return this._identity;
            });
        }
        return this._preparePromise;
    }

    public getCachedIdentity():DeviceIdentity
    {
        return this._identity;
    }

    public async createLoginData(scene:string):Promise<string>
    {
        let identity = await this.prepare();
        if(!identity.available)
            return "登陆";
        return JSON.stringify({
            version:identity.version,
            platform:identity.platform,
            device_id:identity.deviceId,
            scene:scene === "reconnect" ? "reconnect" : "login"
        });
    }

    public createRequestId():string
    {
        let uuid = this.secureUUID();
        if(uuid != "")
            return uuid;
        return "request-" + new Date().getTime().toString(36) + "-" + Math.floor(Math.random() * 0x100000000).toString(36);
    }

    public isValidDeviceId(value:any):boolean
    {
        return typeof value === "string" && DEVICE_ID_PATTERN.test(value);
    }

    private async loadIdentity():Promise<DeviceIdentity>
    {
        if(cc.sys.isBrowser)
            return this.loadWebIdentity();
        if(cc.sys.os === cc.sys.OS_ANDROID)
            return this.loadNativeIdentity("android");
        if(cc.sys.os === cc.sys.OS_IOS)
            return this.loadNativeIdentity("ios");
        return this.unavailableIdentity("当前平台暂不支持设备绑定");
    }

    private loadNativeIdentity(platform:"android"|"ios"):DeviceIdentity
    {
        let deviceId = "";
        try
        {
            if(platform === "android")
            {
                deviceId = jsb.reflection.callStaticMethod(
                    "org/cocos2dx/javascript/QingDeviceBridge",
                    "GetDeviceId",
                    "()Ljava/lang/String;"
                );
            }
            else
            {
                deviceId = jsb.reflection.callStaticMethod("QingDeviceBridge", "GetDeviceId");
            }
        }
        catch(error)
        {
            Debug.Error(platform + "设备标识桥调用失败:" + this.errorText(error));
        }
        if(!this.isValidDeviceId(deviceId))
            return this.unavailableIdentity("当前设备信息获取失败，请安装包含防盗号支持的最新版客户端",platform);
        return {
            available:true,
            deviceId:deviceId,
            platform:platform,
            version:1,
            persistent:true,
            message:""
        };
    }

    private async loadWebIdentity():Promise<DeviceIdentity>
    {
        let mirror = this.readLocalStorage();
        let primary = "";
        try
        {
            primary = await this.readIndexedDB();
        }
        catch(error)
        {
            Debug.Log("浏览器设备主存储暂不可用:" + this.errorText(error));
        }

        let deviceId = this.isValidDeviceId(primary) ? primary : (this.isValidDeviceId(mirror) ? mirror : "");
        if(deviceId == "")
            deviceId = this.secureUUID();
        if(!this.isValidDeviceId(deviceId))
            return this.unavailableIdentity("浏览器无法生成安全的设备标识","web");

        let primaryOK = false;
        let mirrorOK = false;
        try
        {
            await this.writeIndexedDB(deviceId);
            primaryOK = (await this.readIndexedDB()) === deviceId;
        }
        catch(error)
        {
            Debug.Log("浏览器设备主存储写入自检失败:" + this.errorText(error));
        }
        try
        {
            cc.sys.localStorage.setItem(WEB_STORAGE_KEY,deviceId);
            mirrorOK = cc.sys.localStorage.getItem(WEB_STORAGE_KEY) === deviceId;
        }
        catch(error)
        {
            Debug.Log("浏览器设备镜像存储写入自检失败:" + this.errorText(error));
        }

        return {
            available:primaryOK || mirrorOK,
            deviceId:deviceId,
            platform:"web",
            version:1,
            persistent:primaryOK && mirrorOK,
            message:primaryOK && mirrorOK ? "" : "浏览器存储不稳定，当前不能开启防盗号"
        };
    }

    private readLocalStorage():string
    {
        try
        {
            let value = cc.sys.localStorage.getItem(WEB_STORAGE_KEY);
            return typeof value === "string" ? value : "";
        }
        catch(error)
        {
            return "";
        }
    }

    private openDatabase():Promise<IDBDatabase>
    {
        return new Promise<IDBDatabase>((resolve,reject)=>{
            if(typeof window === "undefined" || window.indexedDB == null)
            {
                reject(new Error("IndexedDB unavailable"));
                return;
            }
            let request = window.indexedDB.open(WEB_DB_NAME,1);
            request.onupgradeneeded = ()=>{
                let db = request.result;
                if(!db.objectStoreNames.contains(WEB_STORE_NAME))
                    db.createObjectStore(WEB_STORE_NAME);
            };
            request.onsuccess = ()=>resolve(request.result);
            request.onerror = ()=>reject(request.error || new Error("open IndexedDB failed"));
            request.onblocked = ()=>reject(new Error("IndexedDB blocked"));
        });
    }

    private async readIndexedDB():Promise<string>
    {
        let db = await this.openDatabase();
        return new Promise<string>((resolve,reject)=>{
            let transaction = db.transaction(WEB_STORE_NAME,"readonly");
            let request = transaction.objectStore(WEB_STORE_NAME).get(WEB_RECORD_KEY);
            request.onsuccess = ()=>{
                db.close();
                resolve(typeof request.result === "string" ? request.result : "");
            };
            request.onerror = ()=>{
                db.close();
                reject(request.error || new Error("read IndexedDB failed"));
            };
            transaction.onabort = ()=>{
                db.close();
                reject(transaction.error || new Error("IndexedDB transaction aborted"));
            };
        });
    }

    private async writeIndexedDB(deviceId:string):Promise<void>
    {
        let db = await this.openDatabase();
        return new Promise<void>((resolve,reject)=>{
            let transaction = db.transaction(WEB_STORE_NAME,"readwrite");
            transaction.objectStore(WEB_STORE_NAME).put(deviceId,WEB_RECORD_KEY);
            transaction.oncomplete = ()=>{
                db.close();
                resolve();
            };
            transaction.onerror = ()=>{
                db.close();
                reject(transaction.error || new Error("write IndexedDB failed"));
            };
            transaction.onabort = ()=>{
                db.close();
                reject(transaction.error || new Error("IndexedDB transaction aborted"));
            };
        });
    }

    private secureUUID():string
    {
        try
        {
            if(typeof window === "undefined" || window.crypto == null || window.crypto.getRandomValues == null)
                return "";
            let bytes = new Uint8Array(16);
            window.crypto.getRandomValues(bytes);
            bytes[6] = (bytes[6] & 0x0f) | 0x40;
            bytes[8] = (bytes[8] & 0x3f) | 0x80;
            let hex = "";
            for(let index = 0; index < bytes.length; index++)
                hex += (bytes[index] + 0x100).toString(16).substr(1);
            return hex.substr(0,8) + "-" + hex.substr(8,4) + "-" + hex.substr(12,4) + "-" + hex.substr(16,4) + "-" + hex.substr(20);
        }
        catch(error)
        {
            return "";
        }
    }

    private unavailableIdentity(message:string,platform:"android"|"ios"|"web" = "web"):DeviceIdentity
    {
        return {available:false,deviceId:"",platform:platform,version:1,persistent:false,message:message};
    }

    private errorText(error:any):string
    {
        if(error == null)
            return "unknown";
        return error.message == null ? error.toString() : error.message;
    }
}
