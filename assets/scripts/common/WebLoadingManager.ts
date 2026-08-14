interface WebLoadingTask {
    id:string;
    title:string;
    detail:string;
    completed:number;
    total:number;
    determinate:boolean;
    errorMessage:string;
    retry:()=>void;
    delayTimer:any;
    startedAt:number;
}

/**
 * 网页专用的跨场景加载层。
 *
 * DOM 节点挂在 GameCanvas 外，不会随着 Cocos 场景销毁；Native 分支不会创建
 * 任何节点或计时器。百分比只来自 Cocos 的 completedCount / totalCount，进入
 * JSON 解析、Prefab 实例化和首帧阶段后改用不定进度，避免伪造 90%～99%。
 */
export default class WebLoadingManager {
    private static tasks:{[id:string]:WebLoadingTask} = {};
    private static nextTaskID:number = 1;
    private static overlay:HTMLElement = null;
    private static titleLabel:HTMLElement = null;
    private static detailLabel:HTMLElement = null;
    private static percentLabel:HTMLElement = null;
    private static progressFill:HTMLElement = null;
    private static retryButton:HTMLButtonElement = null;
    private static hideTimer:any = null;
    private static visible:boolean = false;

    public static isEnabled():boolean {
        return !cc.sys.isNative && cc.sys.isBrowser && typeof document !== "undefined";
    }

    public static begin(title:string = "正在加载游戏资源", detail:string = "正在准备所需内容…", delayMs:number = 150):string {
        if(!this.isEnabled())
            return "";

        this.ensureDOM();
        if(this.hideTimer != null)
        {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }

        let taskID = "qing-web-load-" + this.nextTaskID++;
        let task:WebLoadingTask = {
            id: taskID,
            title: title,
            detail: detail,
            completed: 0,
            total: 0,
            determinate: false,
            errorMessage: "",
            retry: null,
            delayTimer: null,
            startedAt: Date.now()
        };
        this.tasks[taskID] = task;
        task.delayTimer = setTimeout(()=>{
            if(this.tasks[taskID] == null)
                return;
            this.show();
            this.render();
        }, Math.max(0, delayMs));
        return taskID;
    }

    public static update(taskID:string, completedCount:number, totalCount:number, detail:string = ""):void {
        if(taskID == "")
            return;
        let task = this.tasks[taskID];
        if(task == null || task.errorMessage != "")
            return;

        task.completed = Math.max(0, Number(completedCount) || 0);
        task.total = Math.max(0, Number(totalCount) || 0);
        task.determinate = task.total > 0;
        if(detail != "")
            task.detail = detail;
        this.render();
    }

    /**
     * 用户主动打开的内容Prefab统一入口。Native仍使用原来的二参数loadRes；
     * Web才增加进度回调、失败重试和实例化阶段提示。
     */
    public static loadBlockingRes(url:string, title:string, completeCallback:(error:Error,resource:any)=>void):void {
        if(!this.isEnabled())
        {
            cc.loader.loadRes(url,completeCallback);
            return;
        }

        let taskID = this.begin(title || "正在加载界面内容","正在下载所需资源…",150);
        let retry = ()=>this.loadBlockingRes(url,title,completeCallback);
        cc.loader.loadRes(url,
            (completedCount:number,totalCount:number,item:any)=>{
                this.update(taskID,completedCount,totalCount,"正在下载所需资源…");
            },
            (error:Error,resource:any)=>{
                if(error)
                {
                    completeCallback(error,resource);
                    this.fail(taskID,"内容加载失败，请检查网络后重试",retry);
                    return;
                }

                this.setPreparing(taskID,"资源下载完成，正在生成内容…");
                try
                {
                    completeCallback(null,resource);
                    this.finishAfterFrame(taskID);
                }
                catch(callbackError)
                {
                    cc.error(callbackError);
                    this.fail(taskID,"内容生成失败，请重新加载",retry);
                }
            });
    }

    public static setPreparing(taskID:string, detail:string = "资源下载完成，正在打开界面…"):void {
        let task = this.tasks[taskID];
        if(task == null)
            return;
        task.determinate = false;
        task.detail = detail;
        this.render();
    }

    public static finishAfterFrame(taskID:string):void {
        if(taskID == "")
            return;
        if(typeof window !== "undefined" && window.requestAnimationFrame != null)
        {
            window.requestAnimationFrame(()=>{
                window.requestAnimationFrame(()=>this.finish(taskID));
            });
            return;
        }
        setTimeout(()=>this.finish(taskID), 50);
    }

    public static finish(taskID:string):void {
        this.removeTask(taskID);
        if(this.hasTasks())
        {
            this.render();
            return;
        }
        this.showCompleteThenHide();
    }

    public static cancel(taskID:string):void {
        this.removeTask(taskID);
        if(this.hasTasks())
        {
            this.render();
            return;
        }
        this.hideNow();
    }

    public static fail(taskID:string, message:string, retry:()=>void = null):void {
        let task = this.tasks[taskID];
        if(task == null)
            return;
        if(task.delayTimer != null)
        {
            clearTimeout(task.delayTimer);
            task.delayTimer = null;
        }
        task.errorMessage = message || "资源加载失败，请重试";
        task.retry = retry;
        task.determinate = false;
        this.show();
        this.render();
    }

    private static removeTask(taskID:string):void {
        let task = this.tasks[taskID];
        if(task == null)
            return;
        if(task.delayTimer != null)
            clearTimeout(task.delayTimer);
        delete this.tasks[taskID];
    }

    private static hasTasks():boolean {
        for(let key in this.tasks)
        {
            if(this.tasks.hasOwnProperty(key))
                return true;
        }
        return false;
    }

    private static currentTask():WebLoadingTask {
        let current:WebLoadingTask = null;
        for(let key in this.tasks)
        {
            if(!this.tasks.hasOwnProperty(key))
                continue;
            let task = this.tasks[key];
            if(current == null || (task.errorMessage != "" && current.errorMessage == "") ||
                (task.errorMessage == current.errorMessage && task.startedAt > current.startedAt))
                current = task;
        }
        return current;
    }

    private static ensureDOM():void {
        if(this.overlay != null || typeof document === "undefined")
            return;

        let old = document.getElementById("qing-web-loading");
        if(old != null)
            old.parentNode.removeChild(old);

        let style = document.createElement("style");
        style.id = "qing-web-loading-style";
        style.textContent =
            "#qing-web-loading{position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;"+
            "box-sizing:border-box;padding:24px;background:radial-gradient(circle at 50% 35%,rgba(24,74,92,.96),rgba(4,14,21,.985) 62%,rgba(2,8,13,.995));"+
            "font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:#eefaff;opacity:0;visibility:hidden;"+
            "transition:opacity .16s ease;pointer-events:auto;-webkit-user-select:none;user-select:none}"+
            "#qing-web-loading.qing-visible{opacity:1;visibility:visible}"+
            "#qing-web-loading .qing-card{width:min(560px,86vw);text-align:center}"+
            "#qing-web-loading .qing-mark{width:76px;height:76px;margin:0 auto 18px;border:1px solid rgba(166,224,240,.72);border-radius:22px;"+
            "display:flex;align-items:center;justify-content:center;background:linear-gradient(145deg,rgba(126,207,226,.26),rgba(25,70,87,.36));"+
            "box-shadow:0 12px 40px rgba(0,0,0,.34),inset 0 0 18px rgba(191,239,250,.12);font-size:28px;font-weight:800;letter-spacing:1px;color:#eafcff}"+
            "#qing-web-loading .qing-title{font-size:22px;font-weight:700;letter-spacing:1px;text-shadow:0 2px 8px rgba(0,0,0,.45)}"+
            "#qing-web-loading .qing-detail{min-height:22px;margin-top:9px;font-size:14px;color:rgba(224,246,252,.76)}"+
            "#qing-web-loading .qing-track{position:relative;height:12px;margin-top:20px;overflow:hidden;border-radius:999px;background:rgba(0,0,0,.42);"+
            "border:1px solid rgba(156,218,233,.28);box-shadow:inset 0 2px 5px rgba(0,0,0,.4)}"+
            "#qing-web-loading .qing-fill{height:100%;width:0;border-radius:inherit;background:linear-gradient(90deg,#49abc4,#9ceaff,#4eb0c8);"+
            "box-shadow:0 0 14px rgba(111,220,242,.7);transition:width .12s linear}"+
            "#qing-web-loading .qing-fill.qing-indeterminate{width:38%;animation:qing-web-loading-move 1.05s ease-in-out infinite;transition:none}"+
            "#qing-web-loading .qing-percent{height:25px;margin-top:8px;font-size:16px;font-variant-numeric:tabular-nums;color:#d9f8ff}"+
            "#qing-web-loading .qing-retry{display:none;margin:14px auto 0;padding:10px 30px;border:1px solid rgba(181,231,243,.72);border-radius:999px;"+
            "background:rgba(70,151,173,.28);color:#effcff;font-size:16px;outline:none}"+
            "#qing-web-loading.qing-error .qing-retry{display:block}"+
            "@keyframes qing-web-loading-move{0%{transform:translateX(-120%)}55%{transform:translateX(105%)}100%{transform:translateX(275%)}}"+
            "@media(max-height:500px){#qing-web-loading .qing-mark{width:58px;height:58px;margin-bottom:12px;border-radius:17px;font-size:22px}"+
            "#qing-web-loading .qing-title{font-size:19px}#qing-web-loading .qing-track{margin-top:14px}}";
        document.head.appendChild(style);

        let overlay = document.createElement("div");
        overlay.id = "qing-web-loading";
        overlay.innerHTML =
            '<div class="qing-card" role="status" aria-live="polite">' +
            '<div class="qing-mark">8L</div>' +
            '<div class="qing-title"></div>' +
            '<div class="qing-detail"></div>' +
            '<div class="qing-track"><div class="qing-fill qing-indeterminate"></div></div>' +
            '<div class="qing-percent"></div>' +
            '<button class="qing-retry" type="button">重新加载</button>' +
            '</div>';
        (document.body || document.documentElement).appendChild(overlay);

        this.overlay = overlay;
        this.titleLabel = overlay.querySelector(".qing-title") as HTMLElement;
        this.detailLabel = overlay.querySelector(".qing-detail") as HTMLElement;
        this.percentLabel = overlay.querySelector(".qing-percent") as HTMLElement;
        this.progressFill = overlay.querySelector(".qing-fill") as HTMLElement;
        this.retryButton = overlay.querySelector(".qing-retry") as HTMLButtonElement;
        this.retryButton.addEventListener("click", ()=>this.retryCurrentTask());
    }

    private static show():void {
        this.ensureDOM();
        if(this.overlay == null)
            return;
        this.visible = true;
        this.overlay.classList.add("qing-visible");
    }

    private static render():void {
        if(!this.visible || this.overlay == null)
            return;
        let current = this.currentTask();
        if(current == null)
            return;

        if(current.errorMessage != "")
        {
            this.overlay.classList.add("qing-error");
            this.titleLabel.textContent = "加载失败";
            this.detailLabel.textContent = current.errorMessage;
            this.percentLabel.textContent = "";
            this.progressFill.classList.add("qing-indeterminate");
            this.retryButton.textContent = current.retry == null ? "关闭" : "重新加载";
            return;
        }

        this.overlay.classList.remove("qing-error");
        this.titleLabel.textContent = current.title;
        this.detailLabel.textContent = current.detail;

        let completed = 0;
        let total = 0;
        let allDeterminate = true;
        for(let key in this.tasks)
        {
            if(!this.tasks.hasOwnProperty(key))
                continue;
            let task = this.tasks[key];
            if(!task.determinate || task.total <= 0)
            {
                allDeterminate = false;
                break;
            }
            completed += Math.min(task.completed, task.total);
            total += task.total;
        }

        if(allDeterminate && total > 0)
        {
            let percent = Math.max(0, Math.min(100, Math.floor(completed * 100 / total)));
            this.progressFill.classList.remove("qing-indeterminate");
            this.progressFill.style.width = percent + "%";
            this.percentLabel.textContent = percent + "%";
        }
        else
        {
            this.progressFill.style.width = "38%";
            this.progressFill.classList.add("qing-indeterminate");
            this.percentLabel.textContent = "";
        }
    }

    private static retryCurrentTask():void {
        let task = this.currentTask();
        if(task == null || task.errorMessage == "")
            return;
        let retry = task.retry;
        this.cancel(task.id);
        if(retry != null)
            setTimeout(()=>retry(), 0);
    }

    private static showCompleteThenHide():void {
        if(!this.visible || this.overlay == null)
            return;
        this.overlay.classList.remove("qing-error");
        this.titleLabel.textContent = "加载完成";
        this.detailLabel.textContent = "";
        this.progressFill.classList.remove("qing-indeterminate");
        this.progressFill.style.width = "100%";
        this.percentLabel.textContent = "100%";
        this.hideTimer = setTimeout(()=>{
            this.hideTimer = null;
            if(!this.hasTasks())
                this.hideNow();
        }, 180);
    }

    private static hideNow():void {
        if(this.hideTimer != null)
        {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
        if(this.overlay != null)
        {
            this.overlay.classList.remove("qing-visible");
            this.overlay.classList.remove("qing-error");
        }
        this.visible = false;
    }
}
