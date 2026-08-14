import Debug from "../common/Debug";
import MobileManager from "../mobile/MobileManager";
import GameDataManager from "../GameDataManager";

const {ccclass, property} = cc._decorator;

@ccclass
export default class GpsManager extends cc.Component {

    private static webGpsCache:string = "";
    private webGps:string = "";
    private webGpsRequesting:boolean = false;
    private webAutoNotifyStarted:boolean = false;
    private webActivationListening:boolean = false;
    private webLastErrorCode:number = -1;

    private onWebUserActivation = ()=>{
        if(this.webGpsRequesting)
            return;
        // 苹果若不允许自动触发权限弹窗，只在首次真实触摸时补试一次。
        this.RemoveWebActivationListeners();
        this.RequestWebGpsAndSubmit();
    };

    private onWebVisibilityChange = ()=>{
        if(typeof document !== "undefined" && document.visibilityState === "visible")
            this.RequestWebGpsAndSubmit();
    };

    private RequestWebGpsAndSubmit = ()=>{
        if(!cc.sys.isBrowser || !this.IsAppleMobileWeb() || this.webGpsRequesting ||
            typeof navigator === "undefined")
        {
            return;
        }
        if(typeof window !== "undefined" && window.isSecureContext === false)
        {
            this.LogWebGpsError(1,"网页版定位必须通过HTTPS访问");
            return;
        }
        if(navigator.geolocation == null ||
            typeof navigator.geolocation.getCurrentPosition !== "function")
        {
            this.LogWebGpsError(2,"当前浏览器不支持定位功能");
            return;
        }

        this.webGpsRequesting = true;
        navigator.geolocation.getCurrentPosition((position:Position)=>{
            this.webGpsRequesting = false;
            let latitude = Number(position.coords.latitude);
            let longitude = Number(position.coords.longitude);
            if(!isFinite(latitude) || !isFinite(longitude) ||
                latitude < -90 || latitude > 90 ||
                longitude < -180 || longitude > 180)
            {
                this.LogWebGpsError(2,"浏览器返回了无效的定位信息");
                return;
            }

            // 服务端和Native客户端现有协议均为“纬度,经度”。
            this.webGps = latitude.toFixed(6) + "," + longitude.toFixed(6);
            GpsManager.webGpsCache = this.webGps;
            this.webLastErrorCode = 0;
            this.RemoveWebActivationListeners();
            this.SubmitGps(this.webGps);
        },(error:PositionError)=>{
            this.webGpsRequesting = false;
            let code = error == null ? 2 : Number(error.code || 2);
            if(code === 1)
            {
                this.webGps = "";
                GpsManager.webGpsCache = "";
            }
            let message = code === 1 ? "网页定位权限未开启" :
                (code === 3 ? "网页定位获取超时" : "网页定位暂时不可用");
            this.LogWebGpsError(code,message);
        },{
            enableHighAccuracy:true,
            maximumAge:30000,
            timeout:15000
        });
    };

    static instance: GpsManager
    static getInstance() {
        if (!GpsManager.instance) {            
            let node = new cc.Node("GpsManager");
            cc.game.addPersistRootNode(node);
            this.instance = node.addComponent(GpsManager);            
        }

        return GpsManager.instance;
    }
    onDestroy()
    {
        this.RemoveWebActivationListeners();
        if(typeof document !== "undefined")
            document.removeEventListener("visibilitychange",this.onWebVisibilityChange,true);
        this.unschedule(this.RequestWebGpsAndSubmit);
        GpsManager.instance = null;
    }

    onLoad () {

    }

    start () {

    }

    // update (dt) {}

    public IsGpsOpen():boolean
    {
        if(cc.sys.isBrowser)
            return this.IsAppleMobileWeb() ? this.IsValidGps(this.GetWebGps()) : true;
        if(cc.sys.os === cc.sys.OS_ANDROID || cc.sys.os === cc.sys.OS_IOS)
        {
            let gps = this.GetCurGps();
            if(gps.length<8)
                return false;
            else
                return true;
        }
        else
        {
            return true;
        }
    }
    public GetCurGps():string
    {
        if(cc.sys.isBrowser)
            return this.IsAppleMobileWeb() ? this.GetWebGps() : "";

        if(cc.sys.os === cc.sys.OS_ANDROID || cc.sys.os === cc.sys.OS_IOS)
        {
            return MobileManager.getInstance().GetCurGps();
        }
        else
        {
            let strGps = "131.61969,204.0761";
            Debug.Log("gps:" + strGps);
            return strGps;
        }
    }
    public GetLengthGPS(strSrc:string,strDes:string):string
    {
        if(strSrc == "0,0" || strDes == "0,0" || strSrc=="" || strDes == ""||strSrc == "0.0,0.0" || strDes == "0.0,0.0")
        {
            return "";
        }

        let arraySrc = strSrc.split(',');
        let arrayDes = strDes.split(',');

        return this.GetDistance(Number(arraySrc[0]), Number(arraySrc[1]), Number(arrayDes[0]), Number(arrayDes[1])).toString();
    }
    private EARTH_RADIUS = 6378137;
    public GetDistance(lat1:number, lng1:number, lat2:number, lng2:number):number
    {
        let radLat1 = this.Rad(lat1);
        let radLng1 = this.Rad(lng1);
        let radLat2 = this.Rad(lat2);
        let radLng2 = this.Rad(lng2);
        let a = radLat1 - radLat2;
        let b = radLng1 - radLng2;
        let result = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin(a / 2), 2) + Math.cos(radLat1) * Math.cos(radLat2) * Math.pow(Math.sin(b / 2), 2))) * this.EARTH_RADIUS;
        return result;
    }
    /// <summary>
    /// 经纬度转化成弧度
    /// </summary>
    /// <param name="d"></param>
    /// <returns></returns>
    private Rad(d:number):number
    {
        return d * Math.PI / 180;
    }

    public StartAutoNotifyGps()
    {
        if(cc.sys.isBrowser)
        {
            // 仅苹果移动网页版提交真实定位，其他网页版不申请也不提交。
            if(!this.IsAppleMobileWeb())
                return;
            if(!this.webAutoNotifyStarted)
            {
                this.webAutoNotifyStarted = true;
                if(typeof document !== "undefined")
                    document.addEventListener("visibilitychange",this.onWebVisibilityChange,true);
                this.schedule(this.RequestWebGpsAndSubmit,60,cc.macro.REPEAT_FOREVER,60);
            }
            this.AddWebActivationListeners();
            // 首次进入大厅立即申请定位；成功回调直接提交，不必再等一分钟。
            this.RequestWebGpsAndSubmit();
            return;
        }

        //启动GPS更新任务
        this.schedule(()=>{
            let gps = this.GetCurGps();
            if(GameDataManager.getAccount() != undefined && gps!= undefined)
                GameDataManager.getAccount().reqSetProperty("gps",gps);   
        },60,cc.macro.REPEAT_FOREVER,0.1);
    }

    private SubmitGps(gps:string)
    {
        if(!this.IsAppleMobileWeb() || !this.IsValidGps(gps))
            return;
        let account = GameDataManager.getAccount();
        if(account != undefined && typeof account.reqSetProperty === "function")
        {
            account.reqSetProperty("gps",gps);
            Debug.Log("网页版GPS已提交");
        }
    }

    private IsValidGps(gps:string):boolean
    {
        if(gps == null || gps === "")
            return false;
        let values = gps.split(',');
        if(values.length !== 2)
            return false;
        let latitude = Number(values[0]);
        let longitude = Number(values[1]);
        return isFinite(latitude) && isFinite(longitude) &&
            latitude >= -90 && latitude <= 90 &&
            longitude >= -180 && longitude <= 180 &&
            !(latitude === 0 && longitude === 0);
    }

    private GetWebGps():string
    {
        if(this.IsValidGps(this.webGps))
            return this.webGps;
        return GpsManager.webGpsCache;
    }

    private IsAppleMobileWeb():boolean
    {
        if(!cc.sys.isBrowser || typeof navigator === "undefined")
            return false;
        let userAgent = navigator.userAgent == null ? "" : navigator.userAgent;
        let platform = (navigator as any).platform == null ? "" :
            (navigator as any).platform.toString();
        let maxTouchPoints = Number((navigator as any).maxTouchPoints || 0);
        return /iPhone|iPad|iPod/i.test(userAgent) ||
            (platform === "MacIntel" && maxTouchPoints > 1);
    }

    private AddWebActivationListeners()
    {
        if(this.webActivationListening || typeof document === "undefined")
            return;
        this.webActivationListening = true;
        document.addEventListener("touchend",this.onWebUserActivation,true);
        document.addEventListener("click",this.onWebUserActivation,true);
    }

    private RemoveWebActivationListeners()
    {
        if(!this.webActivationListening || typeof document === "undefined")
            return;
        this.webActivationListening = false;
        document.removeEventListener("touchend",this.onWebUserActivation,true);
        document.removeEventListener("click",this.onWebUserActivation,true);
    }

    private LogWebGpsError(code:number,message:string)
    {
        if(this.webLastErrorCode === code)
            return;
        this.webLastErrorCode = code;
        Debug.Error(message);
    }
}
