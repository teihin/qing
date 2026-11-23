import Debug from "../common/Debug";
import GameDataManager from "../GameDataManager";
import Tool from "../common/Tool";


var KBEngine = require("kbengine");
const {ccclass} = cc._decorator;

@ccclass
export default class ImageManager extends cc.Component {

    // Creator 2.4.13快速编译对已注册ccclass新增静态成员可能保留旧构造器，
    // 因此除既有getInstance外，头像工具统一使用组件实例成员。
    public readonly AVATAR_COUNT:number = 100;
    private readonly AVATAR_ROOT:string = "avatars/头像";

    // 服务端批量头像接口：单次最多 100 个，超出由客户端分片串行发送。
    // 只给排行榜这类大列表用；其它入口保持原来的单查，不动。
    private readonly AVATAR_BATCH_COMMAND:string = "查询_用户_头像_批量";
    private readonly AVATAR_BATCH_SIZE:number = 100;
    /** 同一帧内连续绑定（排行榜整页）合并成一次请求。 */
    private readonly AVATAR_BATCH_DELAY:number = 50;
    /** 批量回包迟迟不来时的兜底时间，超时按失败收尾，不阻塞列表。 */
    private readonly AVATAR_BATCH_TIMEOUT:number = 5000;
    /** 批量连续失败到该次数就认为服务端没有该接口，退回老的逐条查询。 */
    private readonly AVATAR_BATCH_MAX_FAIL:number = 2;

    // 本地头像只按序号缓存；用户ID只保存其当前头像序号，不再缓存网络图片。
    private mapAvatar2Sprite = new Map<string, cc.SpriteFrame>();
    private mapAvatar2Wait = new Map<string, Array<cc.Sprite>>();
    // 同一个Sprite可能先等头像1、随后又等真实头像；只允许最新请求写回。
    private mapSprite2Avatar = new Map<cc.Sprite, string>();
    private mapID2Avatar = new Map<string, string>();
    private mapID2ImageSave = new Map<string, Array<cc.Sprite>>();

    // 批量头像查询队列：去抖合并 -> 每片 100 个 -> 串行发送。
    private setWaitAvatarIDs = new Set<string>();
    private setSendingAvatarIDs = new Set<string>();
    private bAvatarBatchSending:boolean = false;
    private bAvatarBatchEnabled:boolean = true;
    private nAvatarBatchFail:number = 0;
    private hAvatarBatchDelay:any = null;
    private hAvatarBatchTimeout:any = null;

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
        if(this.hAvatarBatchDelay != null)
        {
            clearTimeout(this.hAvatarBatchDelay);
            this.hAvatarBatchDelay = null;
        }
        this.ClearAvatarTimeout();
        ImageManager.instance = null;
    }

    intiEvent()
    {
        KBEngine.Event.register("UserList", this, "OnAccountList");
        // 批量头像的同步回包（0x200 成功 / 0x301 失败）走大厅命令事件。
        KBEngine.Event.register("onHallCommand", this, "OnHallCommand");
    }

    /** 只有纯数字1～100才是新头像字段；旧网址、文件名和其他字符串都视为无效。 */
    public IsAvatarIndex(value:any):boolean
    {
        if(value === null || value === undefined)
            return false;
        let text = value.toString().trim();
        if(!text.match(/^\d+$/))
            return false;
        let index = Number(text);
        return index >= 1 && index <= this.AVATAR_COUNT;
    }

    /** 显示层的兼容规则：任何无效值统一回退头像1。 */
    public NormalizeAvatarIndex(value:any):string
    {
        if(!this.IsAvatarIndex(value))
            return "1";
        return Number(value.toString().trim()).toString();
    }

    public RandomAvatarIndex():string
    {
        return (Math.floor(Math.random() * this.AVATAR_COUNT) + 1).toString();
    }

    /**
     * 返回不重复的随机头像批次。刷新时可传入上一批序号，优先做到整批不重复；
     * 当排除后的可选数量不足时，再从完整头像池补齐。
     */
    public RandomAvatarBatch(count:number = 20, exclude:Array<string> = []):Array<string>
    {
        let targetCount = Math.max(0,Math.min(Math.floor(count),this.AVATAR_COUNT));
        let excluded = new Set<string>();
        for(let value of exclude)
        {
            if(this.IsAvatarIndex(value))
                excluded.add(this.NormalizeAvatarIndex(value));
        }

        let candidates:Array<string> = [];
        for(let index = 1; index <= this.AVATAR_COUNT; index++)
        {
            let avatarIndex = index.toString();
            if(!excluded.has(avatarIndex))
                candidates.push(avatarIndex);
        }
        if(candidates.length < targetCount)
        {
            for(let index = 1; index <= this.AVATAR_COUNT; index++)
            {
                let avatarIndex = index.toString();
                if(excluded.has(avatarIndex))
                    candidates.push(avatarIndex);
            }
        }

        for(let index = candidates.length - 1; index > 0; index--)
        {
            let randomIndex = Math.floor(Math.random() * (index + 1));
            let temp = candidates[index];
            candidates[index] = candidates[randomIndex];
            candidates[randomIndex] = temp;
        }
        return candidates.slice(0,targetCount);
    }

    public GetAvatarResourcePath(value:any):string
    {
        let index = this.NormalizeAvatarIndex(value).padStart(2,"0");
        return this.AVATAR_ROOT + index;
    }

    /**
     * 直接把头像序号对应的resources本地图片设置到Sprite。
     * userID非空时同时刷新“用户 -> 头像序号”缓存，供后续界面复用。
     */
    public SetLocalAvatar(img:cc.Sprite, avatarValue:any, userID:string = ""):string
    {
        let avatarIndex = this.NormalizeAvatarIndex(avatarValue);
        if(userID != null && userID != "")
            this.mapID2Avatar.set(userID, avatarIndex);

        if(img == null || !cc.isValid(img))
            return avatarIndex;

        this.mapSprite2Avatar.set(img, avatarIndex);

        if(this.mapAvatar2Sprite.has(avatarIndex))
        {
            let frame = this.mapAvatar2Sprite.get(avatarIndex);
            if(frame != null && this.mapSprite2Avatar.get(img) == avatarIndex)
                img.spriteFrame = frame;
            return avatarIndex;
        }

        let waitList:Array<cc.Sprite> = null;
        if(this.mapAvatar2Wait.has(avatarIndex))
        {
            waitList = this.mapAvatar2Wait.get(avatarIndex);
            if(waitList.indexOf(img) < 0)
                waitList.push(img);
            return avatarIndex;
        }

        waitList = new Array<cc.Sprite>();
        waitList.push(img);
        this.mapAvatar2Wait.set(avatarIndex, waitList);

        cc.loader.loadRes(this.GetAvatarResourcePath(avatarIndex), cc.SpriteFrame, (err,frame:cc.SpriteFrame)=>{
            let targets = this.mapAvatar2Wait.get(avatarIndex) || [];
            this.mapAvatar2Wait.delete(avatarIndex);
            if(err || frame == null)
            {
                Debug.Error("本地头像加载失败:" + this.GetAvatarResourcePath(avatarIndex));
                targets.forEach((target)=>{
                    if(target == null || !cc.isValid(target))
                    {
                        this.mapSprite2Avatar.delete(target);
                        return;
                    }
                    if(this.mapSprite2Avatar.get(target) != avatarIndex)
                        return;
                    if(avatarIndex != "1")
                        this.SetLocalAvatar(target, "1");
                    else
                        Tool.LoadImg(target,"other/Default_Man_Head");
                });
                return;
            }

            this.mapAvatar2Sprite.set(avatarIndex, frame);
            targets.forEach((target)=>{
                if(target != null && cc.isValid(target) &&
                    this.mapSprite2Avatar.get(target) == avatarIndex)
                    target.spriteFrame = frame;
            });
        });

        return avatarIndex;
    }

    /**
     * 保留旧方法签名以兼容所有现有头像显示入口。
     * 第二个参数现在是头像序号，不再接受或下载URL。
     */
    public GetImageByName(strImgName:string,strAvatarValue:string,imgSrc:cc.Sprite):boolean
    {
        if(imgSrc == null || !cc.isValid(imgSrc))
            return false;

        if(strAvatarValue != null && strAvatarValue.toString().trim() != "")
        {
            this.SetLocalAvatar(imgSrc, strAvatarValue, strImgName);
            return true;
        }

        if(strImgName != null && this.mapID2Avatar.has(strImgName))
        {
            this.SetLocalAvatar(imgSrc, this.mapID2Avatar.get(strImgName), strImgName);
            return true;
        }

        return false;
    }

    /** 未拿到序号时先显示头像1，只向服务器查询字段值，不请求任何图片。 */
    public AddWaitFreshImage2Catch(strID:string, img:cc.Sprite)
    {
        // 已有缓存时保留当前头像等待服务端刷新；只有完全没有缓存时
        // 才先显示头像1，避免新入座查询期间把旧头像闪回默认图。
        if(img != null && cc.isValid(img) && !this.mapID2Avatar.has(strID))
            this.SetLocalAvatar(img, "1");

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

        if(img != null && cc.isValid(img) && arrayList.indexOf(img) < 0)
            arrayList.push(img);

        if(bNeedGet)
        {
            let strParam = "{\"header\":\"查询_用户_头像\",\"user_id\":\"" + strID + "\"}";
            GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_用户_头像");
        }
    }

    /**
     * 排行榜专用：整页头像合并成一次批量查询（服务端 查询_用户_头像_批量）。
     * 已有缓存的行直接显示，不参与批量；回包按 id 回填等待中的Sprite。
     * 单查入口 AddWaitFreshImage2Catch 保持原样，其它界面不受影响。
     */
    public BindBatchListAvatar(userID:string, img:cc.Sprite)
    {
        // 分页列表复用Sprite时，先摘掉上一玩家的待回包引用，避免头像串行。
        this.mapID2ImageSave.forEach((sprites) => {
            const index = sprites.indexOf(img);
            if (index >= 0) sprites.splice(index, 1);
        });
        if (this.GetImageByName(userID, "", img))
            return;
        this.AddWaitBatchAvatar(userID, img);
    }

    private AddWaitBatchAvatar(strID:string, img:cc.Sprite)
    {
        if(strID == null)
            return;
        strID = strID.toString().trim();
        if(strID == "")
            return;

        if(img != null && cc.isValid(img) && !this.mapID2Avatar.has(strID))
            this.SetLocalAvatar(img, "1");

        let arrayList:Array<cc.Sprite> = null;
        if (!this.mapID2ImageSave.has(strID))
        {
            arrayList = new Array<cc.Sprite>();
            this.mapID2ImageSave.set(strID, arrayList);
        }
        else
        {
            arrayList = this.mapID2ImageSave.get(strID);
        }

        if(img != null && cc.isValid(img) && arrayList.indexOf(img) < 0)
            arrayList.push(img);

        this.QueueAvatarQuery(strID);
    }

    /** 待查询ID进队并触发去抖；已在队列或已在途的ID不重复加入。 */
    private QueueAvatarQuery(strID:string)
    {
        if(strID == null || strID == "")
            return;
        if(this.setWaitAvatarIDs.has(strID) || this.setSendingAvatarIDs.has(strID))
            return;
        this.setWaitAvatarIDs.add(strID);
        this.ScheduleAvatarFlush(this.AVATAR_BATCH_DELAY);
    }

    private ScheduleAvatarFlush(nDelay:number)
    {
        // 已排期或已有分片在途：等这次回包/定时器处理完会继续清队列。
        if(this.hAvatarBatchDelay != null || this.bAvatarBatchSending)
            return;
        this.hAvatarBatchDelay = setTimeout(()=>{
            this.hAvatarBatchDelay = null;
            this.FlushAvatarQueries();
        }, nDelay);
    }

    /** 取队首一片（最多100个）发出；剩余部分在回包后再继续，保证串行。 */
    private FlushAvatarQueries()
    {
        if(this.bAvatarBatchSending)
            return;

        let arrayIDs:Array<string> = [];
        this.setWaitAvatarIDs.forEach((strID:string)=>{
            if(arrayIDs.length < this.AVATAR_BATCH_SIZE)
                arrayIDs.push(strID);
        });
        if(arrayIDs.length == 0)
            return;
        arrayIDs.forEach((strID:string)=>{
            this.setWaitAvatarIDs.delete(strID);
        });
        this.SendAvatarQueries(arrayIDs);
    }

    private SendAvatarQueries(arrayIDs:Array<string>)
    {
        let account = GameDataManager.getAccount();
        if(account == null || typeof account.reqHallCommand !== "function")
        {
            // 未登录/断线重连期间查不了：直接收尾，等界面下次绑定再查。
            this.ReleaseAvatarWaiters(arrayIDs);
            return;
        }

        arrayIDs.forEach((strID:string)=>{
            this.setSendingAvatarIDs.add(strID);
        });
        this.StartAvatarTimeout();

        if(this.bAvatarBatchEnabled)
        {
            this.bAvatarBatchSending = true;
            let strParam = JSON.stringify({
                header:this.AVATAR_BATCH_COMMAND,
                user_ids:arrayIDs
            });
            account.reqHallCommand(strParam, "P@" + this.AVATAR_BATCH_COMMAND);
            return;
        }

        // 降级：服务端没有批量接口时沿用老的逐条查询，回包走 UserList 推送。
        arrayIDs.forEach((strID:string)=>{
            let strParam = "{\"header\":\"查询_用户_头像\",\"user_id\":\"" + strID + "\"}";
            account.reqHallCommand(strParam, "P@查询_用户_头像");
        });
    }

    private StartAvatarTimeout()
    {
        this.ClearAvatarTimeout();
        this.hAvatarBatchTimeout = setTimeout(()=>{
            this.hAvatarBatchTimeout = null;
            this.OnAvatarQueryFailed();
        }, this.AVATAR_BATCH_TIMEOUT);
    }

    private ClearAvatarTimeout()
    {
        if(this.hAvatarBatchTimeout != null)
        {
            clearTimeout(this.hAvatarBatchTimeout);
            this.hAvatarBatchTimeout = null;
        }
    }

    /** 批量命令回包：成功按 id 回填，失败/超时统一走失败收尾。 */
    public OnHallCommand(nCode:number, param:string)
    {
        if(param == null || param.indexOf(this.AVATAR_BATCH_COMMAND) < 0)
            return;

        let msg:any = null;
        try
        {
            msg = JSON.parse(param);
        }
        catch(err)
        {
            // 命令层还会额外回一条非法 JSON 的空壳，丢掉，等真正的结果包或超时兜底。
            return;
        }
        if(msg == null || msg["result"] == null)
            return;

        if(nCode == 0x200)
        {
            let list:any = msg["result"]["list"];
            if(!Array.isArray(list))
                return;
            this.OnAvatarBatchResult(list);
            return;
        }

        this.OnAvatarQueryFailed();
    }

    private OnAvatarBatchResult(list:Array<any>)
    {
        this.ClearAvatarTimeout();
        this.bAvatarBatchSending = false;
        this.nAvatarBatchFail = 0;

        let setSent = this.setSendingAvatarIDs;
        this.setSendingAvatarIDs = new Set<string>();
        let setFilled = new Set<string>();

        for(let index = 0; index < list.length; index++)
        {
            let item:any = list[index];
            if(item == null)
                continue;
            let strID = item["id"] == null ? "" : item["id"].toString().trim();
            if(strID == "")
                continue;
            setFilled.add(strID);
            this.ApplyAvatarValue(strID, this.NormalizeAvatarIndex(item["photo"]));
        }

        // 正常情况回包覆盖全部去重ID；万一漏了，也要收尾，不能让列表一直等。
        let arrayMissed:Array<string> = [];
        setSent.forEach((strID:string)=>{
            if(!setFilled.has(strID))
                arrayMissed.push(strID);
        });
        if(arrayMissed.length > 0)
            this.ReleaseAvatarWaiters(arrayMissed);

        this.ScheduleAvatarFlush(0);
    }

    private OnAvatarQueryFailed()
    {
        let arrayIDs:Array<string> = [];
        this.setSendingAvatarIDs.forEach((strID:string)=>{
            arrayIDs.push(strID);
        });
        this.setSendingAvatarIDs = new Set<string>();
        this.bAvatarBatchSending = false;
        this.ClearAvatarTimeout();
        if(arrayIDs.length == 0)
            return;

        if(!this.bAvatarBatchEnabled)
        {
            // 已经是逐条查询还失败：直接收尾，等界面下次绑定重试，不能反复发。
            this.ReleaseAvatarWaiters(arrayIDs);
            return;
        }

        this.nAvatarBatchFail++;
        if(this.nAvatarBatchFail < this.AVATAR_BATCH_MAX_FAIL)
        {
            // 首次失败先整片重试一次，避免网络抖动直接退化成逐条查询。
            arrayIDs.forEach((strID:string)=>{
                this.setWaitAvatarIDs.add(strID);
            });
            this.ScheduleAvatarFlush(600);
            return;
        }

        // 连续失败：判断为服务端未部署批量接口，本次会话退回老的逐条查询。
        this.bAvatarBatchEnabled = false;
        this.SendAvatarQueries(arrayIDs);
    }

    /** 写完缓存并把等待该ID的Sprite刷成新头像。 */
    private ApplyAvatarValue(strID:string, avatarIndex:string)
    {
        if(strID == null || strID == "")
            return;
        this.mapID2Avatar.set(strID, avatarIndex);

        if (this.mapID2ImageSave.has(strID))
        {
            let arrayList:Array<cc.Sprite> = this.mapID2ImageSave.get(strID);
            arrayList.forEach((img)=>{
                if (img != null && cc.isValid(img))
                    this.SetLocalAvatar(img, avatarIndex, strID);
            });
            Tool.ClearArray(arrayList);
            this.mapID2ImageSave.delete(strID);
        }
    }

    /** 查不到/查不了时放弃等待：不写缓存，列表先显示当前头像，下次绑定还能重查。 */
    private ReleaseAvatarWaiters(arrayIDs:Array<string>)
    {
        arrayIDs.forEach((strID:string)=>{
            this.mapID2ImageSave.delete(strID);
        });
    }

    /** 逐条查询（降级路径）的回包结算。 */
    private OnAvatarLegacySettled()
    {
        if(this.bAvatarBatchSending)
            return;
        if(this.setSendingAvatarIDs.size > 0)
            return;
        this.ClearAvatarTimeout();
        this.ScheduleAvatarFlush(0);
    }

    /** 分页列表复用Sprite时，移除上一玩家的待回包引用，避免头像串行。 */
    public BindPlayerListAvatar(userID:string, img:cc.Sprite)
    {
        this.mapID2ImageSave.forEach((sprites) => {
            const index = sprites.indexOf(img);
            if (index >= 0) sprites.splice(index, 1);
        });
        if (!this.GetImageByName(userID, "", img))
            this.AddWaitFreshImage2Catch(userID, img);
    }

    public OnAccountList(strMsg:string)
    {
        Debug.Log("avatar field:"+strMsg);
        let data:any = null;
        try
        {
            data = JSON.parse(strMsg);
        }
        catch(err)
        {
            Debug.Error("头像字段解析失败");
            return;
        }
        if(data == null || !data.hasOwnProperty("id"))
            return;

        let strID = data["id"].toString();
        let strPhoto = data.hasOwnProperty("photo") ? data["photo"] : "";
        let avatarIndex = this.NormalizeAvatarIndex(strPhoto);
        this.ApplyAvatarValue(strID, avatarIndex);

        // 逐条查询（降级路径）的结算：整片都回来后继续清队列。
        if(this.setSendingAvatarIDs.has(strID))
        {
            this.setSendingAvatarIDs.delete(strID);
            this.OnAvatarLegacySettled();
        }
    }

    /**
     * 场景切换后保留已经加载的头像SpriteFrame和用户头像序号，
     * 只清理指向已销毁场景Sprite的等待及写回引用。
     */
    public ReleaseInvalidSceneReferences()
    {
        this.mapSprite2Avatar.forEach((avatarIndex:string, sprite:cc.Sprite)=>{
            if(sprite == null || !cc.isValid(sprite) || sprite.node == null || !cc.isValid(sprite.node))
                this.mapSprite2Avatar.delete(sprite);
        });

        this.mapAvatar2Wait.forEach((sprites:Array<cc.Sprite>, avatarIndex:string)=>{
            let validSprites = sprites.filter((sprite:cc.Sprite)=>{
                return sprite != null && cc.isValid(sprite) && sprite.node != null && cc.isValid(sprite.node);
            });
            if(validSprites.length == 0)
                this.mapAvatar2Wait.delete(avatarIndex);
            else
                this.mapAvatar2Wait.set(avatarIndex, validSprites);
        });

        this.mapID2ImageSave.forEach((sprites:Array<cc.Sprite>, userID:string)=>{
            let validSprites = sprites.filter((sprite:cc.Sprite)=>{
                return sprite != null && cc.isValid(sprite) && sprite.node != null && cc.isValid(sprite.node);
            });
            if(validSprites.length == 0)
                this.mapID2ImageSave.delete(userID);
            else
                this.mapID2ImageSave.set(userID, validSprites);
        });
    }
}
