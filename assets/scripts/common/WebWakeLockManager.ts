import Debug from "./Debug";

export default class WebWakeLockManager {
    private static initialized:boolean = false;
    private static enabled:boolean = false;
    private static wakeLock:any = null;
    private static requestPromise:Promise<void> = null;
    private static lastFailureLogAt:number = 0;

    private static onUserActivation = ()=>{
        WebWakeLockManager.request();
    };

    private static onVisibilityChange = ()=>{
        if(typeof document === "undefined")
            return;
        if(document.visibilityState === "visible")
            WebWakeLockManager.request();
        else
            WebWakeLockManager.release();
    };

    private static onPageHide = ()=>{
        WebWakeLockManager.release();
    };

    private static onWakeLockReleased = ()=>{
        WebWakeLockManager.wakeLock = null;
    };

    public static init() {
        if(this.initialized)
            return;
        this.initialized = true;
        this.enabled = this.isAppleInstalledWebApp();
        if(!this.enabled || typeof document === "undefined")
            return;

        document.addEventListener("touchend", this.onUserActivation, true);
        document.addEventListener("click", this.onUserActivation, true);
        document.addEventListener("visibilitychange", this.onVisibilityChange, true);
        if(typeof window !== "undefined")
            window.addEventListener("pagehide", this.onPageHide, true);

        // 新版iOS通常允许直接申请；若要求用户激活，首次触摸监听会立即补申请。
        this.request();
    }

    public static shutdown() {
        this.enabled = false;
        if(typeof document !== "undefined")
        {
            document.removeEventListener("touchend", this.onUserActivation, true);
            document.removeEventListener("click", this.onUserActivation, true);
            document.removeEventListener("visibilitychange", this.onVisibilityChange, true);
        }
        if(typeof window !== "undefined")
            window.removeEventListener("pagehide", this.onPageHide, true);
        this.release();
        this.requestPromise = null;
        this.initialized = false;
    }

    private static request():Promise<void> {
        if(!this.enabled || typeof document === "undefined" ||
            document.visibilityState !== "visible" || typeof navigator === "undefined")
        {
            return Promise.resolve();
        }
        if(this.wakeLock != null && this.wakeLock.released !== true)
            return Promise.resolve();
        if(this.requestPromise != null)
            return this.requestPromise;

        let wakeLockAPI:any = (navigator as any).wakeLock;
        if(wakeLockAPI == null || typeof wakeLockAPI.request !== "function")
        {
            this.logFailure("当前苹果系统不支持网页屏幕常亮");
            return Promise.resolve();
        }

        let promise:Promise<void> = Promise.resolve(wakeLockAPI.request("screen")).then((sentinel:any)=>{
            if(!this.enabled || document.visibilityState !== "visible")
            {
                try { sentinel.release(); } catch(e) {}
                return;
            }
            this.wakeLock = sentinel;
            if(sentinel != null && typeof sentinel.addEventListener === "function")
                sentinel.addEventListener("release", this.onWakeLockReleased);
        }).catch((error:any)=>{
            let text = error == null ? "未知错误" :
                (error.message == null ? error.toString() : error.message.toString());
            this.logFailure("苹果网页屏幕常亮申请失败:" + text);
        }).then(()=>{
            if(this.requestPromise === promise)
                this.requestPromise = null;
        });
        this.requestPromise = promise;
        return promise;
    }

    private static release() {
        let sentinel = this.wakeLock;
        this.wakeLock = null;
        if(sentinel == null)
            return;
        try {
            let result:any = sentinel.release();
            if(result != null && typeof result.catch === "function")
                result.catch((error:any)=>{});
        } catch(e) {}
    }

    private static isAppleInstalledWebApp():boolean {
        if(!cc.sys.isBrowser || typeof navigator === "undefined")
            return false;
        let userAgent = navigator.userAgent == null ? "" : navigator.userAgent;
        let platform = (navigator as any).platform == null ? "" :
            (navigator as any).platform.toString();
        let maxTouchPoints = Number((navigator as any).maxTouchPoints || 0);
        let isAppleMobile = /iPhone|iPad|iPod/i.test(userAgent) ||
            (platform === "MacIntel" && maxTouchPoints > 1);
        if(!isAppleMobile)
            return false;

        let standalone = (navigator as any).standalone === true;
        if(!standalone && typeof window !== "undefined" &&
            typeof window.matchMedia === "function")
        {
            standalone = window.matchMedia("(display-mode: standalone)").matches ||
                window.matchMedia("(display-mode: fullscreen)").matches;
        }
        return standalone;
    }

    private static logFailure(message:string) {
        let now = new Date().getTime();
        if(now - this.lastFailureLogAt < 30000)
            return;
        this.lastFailureLogAt = now;
        Debug.Log(message);
    }
}
