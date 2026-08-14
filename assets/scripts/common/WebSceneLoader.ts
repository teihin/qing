import WebLoadingManager from "./WebLoadingManager";

/** 网页先预载场景并显示真实进度；Native 完整保留原 loadScene 调用。 */
export default class WebSceneLoader {
    private static loadingScenes:{[sceneName:string]:boolean} = {};

    public static loadScene(sceneName:string, onLaunched:Function = null, stillValid:()=>boolean = null):boolean {
        if(!WebLoadingManager.isEnabled())
        {
            // Native连调用签名也保持原样，避免给无回调场景额外传入null。
            if(onLaunched == null)
                return cc.director.loadScene(sceneName);
            return cc.director.loadScene(sceneName, onLaunched);
        }

        if(this.loadingScenes[sceneName])
            return false;
        this.loadingScenes[sceneName] = true;

        let taskID = WebLoadingManager.begin(this.sceneTitle(sceneName), "正在下载场景资源…", 80);
        let retry = ()=>this.loadScene(sceneName, onLaunched, stillValid);
        let fail = (error:any)=>{
            delete this.loadingScenes[sceneName];
            if(onLaunched != null)
            {
                WebLoadingManager.cancel(taskID);
                onLaunched(error);
            }
            else
            {
                let message = error == null ? "场景加载失败，请检查网络后重试" : (error.message || error).toString();
                WebLoadingManager.fail(taskID, message, retry);
            }
        };

        try
        {
            cc.director.preloadScene(sceneName,
                (completedCount:number, totalCount:number, item:any)=>{
                    WebLoadingManager.update(taskID, completedCount, totalCount, "正在下载场景资源…");
                },
                (error:Error)=>{
                    if(error)
                    {
                        fail(error);
                        return;
                    }
                    if(stillValid != null && !stillValid())
                    {
                        delete this.loadingScenes[sceneName];
                        WebLoadingManager.cancel(taskID);
                        return;
                    }

                    WebLoadingManager.setPreparing(taskID, "场景资源已就绪，正在打开…");
                    let started = cc.director.loadScene(sceneName, (launchError:any)=>{
                        delete this.loadingScenes[sceneName];
                        if(launchError)
                            WebLoadingManager.cancel(taskID);
                        else
                            WebLoadingManager.finishAfterFrame(taskID);
                        if(onLaunched != null)
                            onLaunched(launchError);
                    });
                    if(!started)
                        fail(new Error("场景正在加载，请稍后重试"));
                });
        }
        catch(error)
        {
            fail(error);
        }
        return true;
    }

    private static sceneTitle(sceneName:string):string {
        if(sceneName == "drh8")
            return "正在进入牌桌";
        if(sceneName == "roomTransition")
            return "正在准备快速换房";
        if(sceneName == "login")
            return "正在返回大厅";
        return "正在切换游戏场景";
    }
}
