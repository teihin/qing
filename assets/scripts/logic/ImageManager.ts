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

    // 本地头像只按序号缓存；用户ID只保存其当前头像序号，不再缓存网络图片。
    private mapAvatar2Sprite = new Map<string, cc.SpriteFrame>();
    private mapAvatar2Wait = new Map<string, Array<cc.Sprite>>();
    // 同一个Sprite可能先等头像1、随后又等真实头像；只允许最新请求写回。
    private mapSprite2Avatar = new Map<cc.Sprite, string>();
    private mapID2Avatar = new Map<string, string>();
    private mapID2ImageSave = new Map<string, Array<cc.Sprite>>();

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
