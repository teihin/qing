import Debug from "../common/Debug";
import MobileManager from "../mobile/MobileManager";
import GameDataManager from "../GameDataManager";

const {ccclass, property} = cc._decorator;

@ccclass
export default class GpsManager extends cc.Component {

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
            return true;
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
        {
            let strGps = "131.61969,204.0761";
            Debug.Log("gps:" + strGps);
            return strGps;
        }

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
        //启动GPS更新任务
        this.schedule(()=>{
            let gps = this.GetCurGps();
            if(GameDataManager.getAccount() != undefined && gps!= undefined)
                GameDataManager.getAccount().reqSetProperty("gps",gps);   
        },60,cc.macro.REPEAT_FOREVER,0.1);
    }
}
