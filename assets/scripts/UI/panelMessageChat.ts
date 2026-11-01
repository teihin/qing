import UIPanelViewBase from "../common/UIPanelViewBase";
import Tool from "../common/Tool";
import UIManager from "../common/UIManager";
import Debug from "../common/Debug";
import GameDataManager from "../GameDataManager";
import { ShowPanelMode } from "../common/GameDef";
import ImageManager from "../logic/ImageManager";
import DirectChatManager, {
    DirectChatError, DirectAttachment, DirectMessage, DirectMessagePage, DirectPeer, DirectPickedImage,
    DirectImageSource
} from "../logic/DirectChatManager";
import DirectChatTime from "../common/DirectChatTime";

const KBEngine = require("kbengine");

const {ccclass, property} = cc._decorator;

/** 消息节点池里的一个渲染单元。 */
interface BubbleUnit
{
    node:cc.Node;
    divider:boolean;
    messageId:string;
    height:number;
    /** 图片/语音/文字共用同一套子节点，靠 active 切换。 */
    bubble:cc.Node;
    bubbleSprite:cc.Sprite;
    text:cc.Label;
    image:cc.Sprite;
    voice:cc.Label;
    avatar:cc.Sprite;
    status:cc.Label;
    dividerLabel:cc.Label;
    /** 系统通报条（上下分成功）的两行文字。 */
    systemTime:cc.Label;
    systemText:cc.Label;
}

/**
 * 聊天详情页。
 *
 * 分页、锚点保持、新消息提示、发送重试、图片与语音链路都按设计文档 10.4 实现：
 * 首次只加载最新一页，上滑到顶部附近才请求 beforeCursor，插入后按内容高度差恢复
 * 滚动位置，保证用户看到的内容不跳动。
 */
@ccclass
export default class panelMessageChat extends UIPanelViewBase {

    private manager:DirectChatManager = null;
    private clubId:string = "";
    private conversationId:string = "";
    private peer:DirectPeer = null;

    private scroll:cc.ScrollView = null;
    private content:cc.Node = null;
    private dividerTemplate:cc.Node = null;
    private leftTemplate:cc.Node = null;
    private rightTemplate:cc.Node = null;
    private systemTemplate:cc.Node = null;

    private dividerUnits:BubbleUnit[] = [];
    private leftUnits:BubbleUnit[] = [];
    private rightUnits:BubbleUnit[] = [];
    private systemUnits:BubbleUnit[] = [];
    private poolCursor:{[kind:string]:number} = {divider:0,left:0,right:0,system:0};
    private loadBeforeFailed:boolean = false;
    private messages:DirectMessage[] = [];
    private beforeCursor:string = "";
    private hasMoreBefore:boolean = true;
    private loadingBefore:boolean = false;
    private initialLoading:boolean = true;
    private nearBottom:boolean = true;
    private pendingNewCount:number = 0;
    private canSend:boolean = true;
    private canDelete:boolean = false;
    private role:string = "member";
    private readOnlyReason:string = "";
    private lastRenderedId:string = "";
    private localSeq:number = 0;
    private playingVoiceId:string = "";
    private uploading:boolean = false;

    private inputBox:cc.EditBox = null;
    private topTip:cc.Label = null;
    private newTipNode:cc.Node = null;
    private newTipLabel:cc.Label = null;
    private deleteButton:cc.Node = null;
    private voiceButton:cc.Node = null;
    private recordOverlay:cc.Node = null;
    private recordLabel:cc.Label = null;
    private recordCancelLabel:cc.Label = null;
    private previewNode:cc.Node = null;
    private previewSprite:cc.Sprite = null;
    private previewMask:cc.Node = null;
    private clubGoldButton:cc.Node = null;
    private clubGiveButton:cc.Node = null;
    private photoButton:cc.Node = null;
    private imageButton:cc.Node = null;
    private clubGoldQuotaRequested:boolean = false;
    private clubGoldQuotaContext:string = "";
    private clubGoldQuotaFen:number = 0;
    /** 额度回包是否已到；没到之前不猜，两个入口都先不显示。 */
    private clubGoldQuotaKnown:boolean = false;
    private clubGoldQuotaGranted:boolean = false;

    private recordStartY:number = 0;
    private recordCancelling:boolean = false;
    private recordTimer:any = null;
    private recordSeconds:number = 0;
    private realtimeHandler:(event:any)=>void = null;
    private realtimeStateHandler:(state:any)=>void = null;
    private realtimeCatchupBusy:boolean = false;
    private realtimeCatchupQueued:boolean = false;
    private imageTextureCache:{[url:string]:cc.SpriteFrame} = {};
    private disposed:boolean = false;
    private scrollLayoutReady:boolean = false;

    onLoad()
    {
        super.onLoad();
        this.manager = DirectChatManager.GetInstance();

        let scrollNode = Tool.GetChild(this.node,"列表");
        this.scroll = scrollNode == null ? null : scrollNode.getComponent(cc.ScrollView);
        this.content = Tool.GetChild(this.node,"列表/view/content");
        this.dividerTemplate = Tool.GetChild(this.node,"列表/view/content/时间条");
        this.leftTemplate = Tool.GetChild(this.node,"列表/view/content/消息-左");
        this.rightTemplate = Tool.GetChild(this.node,"列表/view/content/消息-右");
        this.systemTemplate = Tool.GetChild(this.node,"列表/view/content/消息-系统");
        if(this.dividerTemplate != null)
            this.dividerTemplate.active = false;
        if(this.systemTemplate != null)
            this.systemTemplate.active = false;
        KBEngine.Event.register("ClubGoldNotice",this,"OnClubGoldNotice");
        if(this.leftTemplate != null)
            this.leftTemplate.active = false;
        if(this.rightTemplate != null)
            this.rightTemplate.active = false;

        let inputNode = Tool.GetChild(this.node,"输入");
        this.inputBox = inputNode == null ? null : inputNode.getComponent(cc.EditBox);
        if(this.inputBox != null)
        {
            // 聊天输入必须允许中英文、数字、空格和符号；Prefab 也保持 ANY，
            // 这里再设一次是为了兼容旧 library 缓存没有及时重导入的情况。
            this.inputBox.inputMode = cc.EditBox.InputMode.ANY;
            this.inputBox.string = "";
        }

        let tipNode = Tool.GetChild(this.node,"顶部提示");
        this.topTip = tipNode == null ? null : tipNode.getComponent(cc.Label);
        if(this.topTip != null)
            this.topTip.string = "";

        this.newTipNode = Tool.GetChild(this.node,"新消息");
        let newTipLabelNode = Tool.GetChild(this.node,"新消息/文案");
        this.newTipLabel = newTipLabelNode == null ? null : newTipLabelNode.getComponent(cc.Label);
        if(this.newTipNode != null)
            this.newTipNode.active = false;

        this.deleteButton = Tool.GetChild(this.node,"删除");
        if(this.deleteButton != null)
            this.deleteButton.active = false;

        this.clubGoldButton = Tool.GetChild(this.node,"上下分");
        this.photoButton = Tool.GetChild(this.node,"拍照上传");
        this.imageButton = Tool.GetChild(this.node,"发送图片");
        this.clubGiveButton = Tool.GetChild(this.node,"赠送积分");
        // 先按预制体里的可见状态排一次，避免俱乐部信息回来前按钮位置是错的。
        this.LayoutBottomEntries();
        if(this.clubGiveButton != null)
            this.clubGiveButton.active = false;
        if(this.clubGoldButton != null)
            this.clubGoldButton.active = false;

        this.voiceButton = Tool.GetChild(this.node,"语音");
        this.recordOverlay = Tool.GetChild(this.node,"录音浮层");
        let recordLabelNode = Tool.GetChild(this.node,"录音浮层/文案");
        this.recordLabel = recordLabelNode == null ? null : recordLabelNode.getComponent(cc.Label);
        let cancelLabelNode = Tool.GetChild(this.node,"录音浮层/取消提示");
        this.recordCancelLabel = cancelLabelNode == null ? null : cancelLabelNode.getComponent(cc.Label);
        if(this.recordOverlay != null)
            this.recordOverlay.active = false;

        this.previewNode = Tool.GetChild(this.node,"大图预览");
        let previewSpriteNode = Tool.GetChild(this.node,"大图预览/图片");
        this.previewSprite = previewSpriteNode == null ? null : previewSpriteNode.getComponent(cc.Sprite);
        this.PreparePreviewMask();
        if(this.previewNode != null)
            this.previewNode.active = false;

        if(this.scroll != null)
        {
            this.PrepareScrollLayout();
            this.scroll.node.on("scrolling",()=>{
                this.nearBottom = this.IsNearBottom();
                this.CheckLoadBefore();
            },this);
            this.scroll.node.on("scroll-to-top",()=>{ this.CheckLoadBefore(); },this);
        }

        this.BindVoiceButton();
        this.realtimeHandler = (event:any)=>{ this.OnRealtimeMessage(event); };
        this.realtimeStateHandler = (state:any)=>{ this.OnRealtimeState(state); };
        this.manager.On("realtimeMessage",this.realtimeHandler);
        this.manager.On("realtimeState",this.realtimeStateHandler);
        KBEngine.Event.register("GetClubQuota",this,"OnClubGoldQuota");
        KBEngine.Event.register("onHallCommand",this,"OnClubGoldQuotaCommand");
    }

    start()
    {
        // UIManager 在 instantiate 之后才注入 strUserData；onLoad 时读取会拿到空字符串，
        // 导致后续请求拼成 /conversations//messages。
        this.ParseParam();
        this.RefreshHeader();
        this.LoadLatest();
    }

    onDestroy()
    {
        this.disposed = true;
        this.StopRecordTimer();
        this.manager.Off("realtimeMessage",this.realtimeHandler);
        this.manager.Off("realtimeState",this.realtimeStateHandler);
        this.manager.OffAll(this);
        super.onDestroy();
    }

    private ParseParam():void
    {
        let raw = this.strUserData == null ? "" : String(this.strUserData);
        let data:any = null;
        if(raw !== "")
        {
            try { data = JSON.parse(raw); }
            catch(error) { data = null; }
        }
        if(data != null && typeof data === "object")
        {
            this.clubId = String(data.clubId || "");
            this.conversationId = String(data.conversationId || "");
            if(data.peer != null)
            {
                this.peer = {
                    guuid:String(data.peer.guuid || ""),
                    name:String(data.peer.name || ""),
                    note:String(data.peer.note || ""),
                    avatar:String(data.peer.avatar || ""),
                    role:String(data.peer.role || "member")
                };
            }
        }
        else
        {
            this.conversationId = raw.trim();
        }
        if(this.clubId === "")
            this.clubId = this.manager.CurrentClubId();
    }

    private RefreshHeader():void
    {
        let titleNode = Tool.GetChild(this.node,"标题");
        if(titleNode != null)
        {
            let label = titleNode.getComponent(cc.Label);
            if(label != null)
            {
                let name = this.peer == null ? "" : this.peer.name;
                let role = this.peer == null ? "" : DirectChatManager.RoleName(this.peer.role);
                label.string = name === "" ? "聊天" : name + " · " + role;
            }
        }
        let avatarNode = Tool.GetChild(this.node,"头像");
        if(avatarNode != null && this.peer != null)
        {
            let sprite = avatarNode.getComponent(cc.Sprite);
            if(sprite != null)
                ImageManager.getInstance().SetLocalAvatar(sprite,this.peer.avatar,this.peer.guuid);
        }
    }

    // ================= 加载 =================

    private LoadLatest():void
    {
        if(this.conversationId === "")
        {
            this.SetTopTip("会话不存在，请返回消息列表重试");
            return;
        }
        this.initialLoading = true;
        this.SetTopTip("加载中…");
        this.manager.LoadLatestMessages(this.conversationId).then((page)=>{
            if(this.disposed)
                return;
            this.initialLoading = false;
            this.ApplyPageMeta(page);
            this.messages = page.items.slice(0);
            this.beforeCursor = page.beforeCursor;
            this.hasMoreBefore = page.hasMoreBefore;
            this.Render(true,false);
            this.SetTopTip(page.hasMoreBefore ? "" : "没有更多消息");
            // 首次进入定位到底部并提交已读。
            this.ScrollToBottom(true);
            this.MarkLatestRead();
            let last = this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
            if(last != null)
                this.manager.SetMessageCursor(this.conversationId,last.id);
            if(this.realtimeCatchupQueued)
            {
                this.realtimeCatchupQueued = false;
                this.CatchUpRealtimeMessages();
            }
        }).catch((error:any)=>{
            if(this.disposed)
                return;
            this.initialLoading = false;
            this.SetTopTip("加载失败，点击重试");
            this.ShowErrorToast(error);
        });
    }

    private ApplyPageMeta(page:DirectMessagePage):void
    {
        this.canSend = page.canSend;
        this.canDelete = page.canDelete;
        this.role = page.role;
        this.readOnlyReason = page.readOnlyReason;
        if(page.peer != null)
            this.peer = page.peer;
        if(this.inputBox != null)
            this.inputBox.enabled = this.canSend;
        if(this.deleteButton != null)
            // 服务端会对直属上级固定会话返回 canDelete=false；必须以该结果为准，
            // 不能只按角色放开，否则代理/盟主仍会看到固定会话的删除按钮。
            this.deleteButton.active = this.canDelete;
        if(this.voiceButton != null)
            this.voiceButton.opacity = this.canSend ? 255 : 120;
        this.RefreshClubGoldButton();
        this.RefreshHeader();
        if(!this.canSend && this.readOnlyReason !== "")
            this.SetTopTip(this.readOnlyReason);
    }

    private LoadBefore():void
    {
        if(this.loadingBefore || !this.hasMoreBefore || this.beforeCursor === "")
            return;
        this.loadingBefore = true;
        this.ShowTopLoading();
        let anchorOffset = this.scroll != null ? this.scroll.getScrollOffset().y : 0;
        let oldHeight = this.content == null ? 0 : this.content.height;
        this.manager.LoadBeforeMessages(this.conversationId,this.beforeCursor).then((page)=>{
            // 切会话/退出页面后到达的旧回包必须丢弃，不能插进新页面。
            if(this.disposed)
                return;
            if(page.conversationId !== "" && page.conversationId !== this.conversationId)
                return;
            this.loadingBefore = false;
            this.loadBeforeFailed = false;
            let older = page.items;
            this.beforeCursor = page.beforeCursor;
            this.hasMoreBefore = page.hasMoreBefore;
            if(older.length === 0)
            {
                this.hasMoreBefore = false;
                this.SetTopTip("没有更多消息");
                return;
            }
            // 旧消息插到数组前面，先记高度差再重绘，重绘后按差值恢复滚动位置。
            this.messages = older.concat(this.messages);
            this.Render(true,false);
            let newHeight = this.content == null ? oldHeight : this.content.height;
            let delta = newHeight - oldHeight;
            if(this.scroll != null && delta > 0)
                this.scroll.scrollToOffset(cc.v2(0,anchorOffset + delta),0);
            this.SetTopTip(this.hasMoreBefore ? "" : "没有更多消息");
        }).catch((error:any)=>{
            if(this.disposed)
                return;
            this.loadingBefore = false;
            this.loadBeforeFailed = true;
            this.UpdateTopTipState();
            this.ShowErrorToast(error);
        });
    }

    private ShowTopLoading():void
    {
        if(this.topTip != null)
            this.topTip.string = "加载更早消息…";
    }

    private SetTopTip(text:string):void
    {
        if(this.topTip == null)
            return;
        this.topTip.string = text == null ? "" : text;
    }

    private CheckLoadBefore():void
    {
        if(this.scroll == null || this.initialLoading || this.loadingBefore)
            return;
        if(!this.hasMoreBefore)
            return;
        // 距离顶部小于 80 像素才请求上一页，避免连续触顶重复请求。
        let offset = this.scroll.getScrollOffset();
        if(offset.y < 80)
            this.LoadBefore();
    }

    private IsNearBottom(threshold:number = 80):boolean
    {
        if(this.scroll == null || this.content == null)
            return true;
        let viewHeight = this.scroll.node.height;
        let offset = this.scroll.getScrollOffset().y;
        let maxOffset = Math.max(0,this.content.height - viewHeight);
        return maxOffset - offset < threshold;
    }

    /**
     * 长连接收到新消息后，只补偿新增内容的高度。
     * 直接调用 scrollToBottom 会让 ScrollView 重新跑完整段内容的缓动，
     * 在消息较多时表现为整屏抖动；按高度差滚动时，视觉上只会上移新增的一行。
     */
    private ScrollForAppendedMessages(oldMaxOffset:number,oldOffset:number):void
    {
        if(this.scroll == null || this.content == null)
            return;
        this.scheduleOnce(()=>{
            if(this.disposed || this.scroll == null || this.content == null)
                return;
            this.PrepareScrollLayout();
            let viewHeight = this.scroll.node.height;
            let newMaxOffset = this.scroll.getMaxScrollOffset != null ?
                Math.max(0,this.scroll.getMaxScrollOffset().y) :
                Math.max(0,this.content.height - viewHeight);
            let addedHeight = Math.max(0,newMaxOffset - oldMaxOffset);
            let targetOffset = Math.min(newMaxOffset,Math.max(0,oldOffset + addedHeight));
            // 新消息只需要补一行高度，直接定位可以避免 ScrollView 的回弹动画先把内容拉下去。
            this.scroll.stopAutoScroll();
            this.scroll.scrollToOffset(cc.v2(0,targetOffset),0,false);
            this.nearBottom = true;
        },0);
    }

    private ScrollToBottom(animate:boolean):void
    {
        if(this.scroll == null)
            return;
        // ScrollView 在 content.height 刚更新的同一帧可能还没刷新边界，
        // 立即 scrollToBottom 会被下一次布局覆盖，表现为消息停在屏幕下方。
        this.scheduleOnce(()=>{
            if(this.disposed || this.scroll == null)
                return;
            this.PrepareScrollLayout();
            let currentOffset = Math.max(0,this.scroll.getScrollOffset().y);
            let maxOffset = this.scroll.getMaxScrollOffset != null ?
                Math.max(0,this.scroll.getMaxScrollOffset().y) :
                Math.max(0,(this.content == null ? 0 : this.content.height) - this.scroll.node.height);
            let distance = Math.max(0,maxOffset - currentOffset);
            this.scroll.stopAutoScroll();
            if(distance <= 180)
                this.scroll.scrollToOffset(cc.v2(0,maxOffset),0,false);
            else
                this.scroll.scrollToBottom(animate ? 0.2 : 0);
            this.nearBottom = true;
        },0);
    }

    /**
     * 统一维护列表与 ScrollView 的几何关系。
     * content 使用顶部锚点向下排布；Prefab 中的 Widget 只适合固定稿尺寸，
     * 在长短屏上会把动态 content 高度重新压回视口，导致既不能滚动也不能定位到底部。
     * 动态列表由脚本按当前 view 尺寸维护，保留模板和用户的美术调整不变。
     */
    private PrepareScrollLayout():void
    {
        if(this.scroll == null || this.content == null)
            return;
        let viewNode = this.scroll.node.getChildByName("view");
        if(viewNode == null)
            return;
        let widget = this.content.getComponent(cc.Widget);
        if(widget != null)
            widget.enabled = false;
        this.content.anchorX = 0.5;
        this.content.anchorY = 1;
        this.content.width = viewNode.width;
        this.content.x = 0;
        // 只在首次建立列表时放到视口顶部。重绘消息时必须保留 ScrollView 当前的 content.y，
        // 否则 content.height 改变后会先被重置到初始位置，再被 ScrollView 拉到底部造成跳跃。
        if(!this.scrollLayoutReady)
            this.content.y = viewNode.height * (1 - viewNode.anchorY);
        this.scrollLayoutReady = true;
    }

    private MarkLatestRead():void
    {
        if(this.messages.length === 0)
            return;
        let last = this.messages[this.messages.length - 1];
        if(last == null || last.id === "" || last.id === this.lastRenderedId)
            return;
        this.lastRenderedId = last.id;
        this.manager.MarkRead(this.conversationId,last.id).catch(()=>{});
        this.pendingNewCount = 0;
        if(this.newTipNode != null)
            this.newTipNode.active = false;
    }

    // ================= 增量 =================

    /** 长连接只推送消息游标提示；这里用当前用户身份走 REST after 补齐完整消息和媒体签名。 */
    private OnRealtimeMessage(event:any):void
    {
        if(this.disposed || event == null || String(event.conversationId || "") !== this.conversationId)
            return;
        this.CatchUpRealtimeMessages();
    }

    /** 重连成功时没有对应的 message.new 事件，仍按最后游标补齐断线期间的消息。 */
    private OnRealtimeState(state:any):void
    {
        if(this.disposed || String(state || "") !== "open")
            return;
        this.CatchUpRealtimeMessages();
    }

    private CatchUpRealtimeMessages():void
    {
        if(this.initialLoading)
        {
            this.realtimeCatchupQueued = true;
            return;
        }
        if(this.realtimeCatchupBusy)
        {
            this.realtimeCatchupQueued = true;
            return;
        }
        let last = this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
        if(last == null || last.id === "")
        {
            this.LoadLatest();
            return;
        }
        this.realtimeCatchupBusy = true;
        let afterId = last.id;
        this.manager.LoadMessagesAfter(this.conversationId,afterId).then((page:DirectMessagePage)=>{
            if(this.disposed)
                return;
            this.OnPolledMessages(page.items,page);
        }).catch(()=>{}).then(()=>{
            this.realtimeCatchupBusy = false;
            if(this.realtimeCatchupQueued)
            {
                this.realtimeCatchupQueued = false;
                this.CatchUpRealtimeMessages();
            }
        });
    }

    private OnPolledMessages(items:DirectMessage[],page:DirectMessagePage):void
    {
        if(this.disposed)
            return;
        this.ApplyPageMeta(page);
        this.AppendToTail(items);
    }

    /** 把新消息追加到列表尾部并跟随滚动；实时推送与系统通报共用同一套逻辑。 */
    private AppendToTail(items:DirectMessage[]):void
    {
        if(this.disposed || items == null || items.length === 0)
            return;
        let added = 0;
        for(let item of items)
        {
            if(item == null || this.IndexOfMessage(item.id) >= 0)
                continue;
            this.messages.push(item);
            added++;
        }
        if(added === 0)
            return;
        // 只有真正贴近底部才自动跟随；用户正在看上方内容时保留当前位置并显示新消息提示。
        let atBottom = this.IsNearBottom(12);
        let oldOffset = this.scroll == null ? 0 : this.scroll.getScrollOffset().y;
        let oldMaxOffset = this.scroll != null && this.scroll.getMaxScrollOffset != null ?
            Math.max(0,this.scroll.getMaxScrollOffset().y) :
            Math.max(0,(this.content == null ? 0 : this.content.height) - (this.scroll == null ? 0 : this.scroll.node.height));
        this.Render(false,true);
        let last = this.messages[this.messages.length - 1];
        if(last != null)
            this.manager.SetMessageCursor(this.conversationId,last.id);
        if(atBottom)
        {
            this.ScrollForAppendedMessages(oldMaxOffset,oldOffset);
            this.MarkLatestRead();
        }
        else
        {
            // 用户正在看旧消息：不强制跳到底部，只提示有新消息。
            this.pendingNewCount += added;
            if(this.newTipNode != null)
            {
                this.newTipNode.active = true;
                if(this.newTipLabel != null)
                    this.newTipLabel.string = this.pendingNewCount.toString() + " 条新消息";
            }
        }
    }

    private IndexOfMessage(messageId:string):number
    {
        for(let i = 0;i < this.messages.length;i++)
        {
            if(this.messages[i].id === messageId)
                return i;
        }
        return -1;
    }

    // ================= 渲染 =================

    /** 四类模板各一个节点池，重绘时优先复用，避免历史较多时无限创建节点。 */
    private PoolOf(kind:"divider"|"left"|"right"|"system"):BubbleUnit[]
    {
        if(kind === "divider")
            return this.dividerUnits;
        if(kind === "system")
            return this.systemUnits;
        return kind === "left" ? this.leftUnits : this.rightUnits;
    }

    private CreateUnit(kind:"divider"|"left"|"right"|"system"):BubbleUnit
    {
        let template = kind === "divider" ? this.dividerTemplate
            : (kind === "system" ? this.systemTemplate
            : (kind === "left" ? this.leftTemplate : this.rightTemplate));
        if(template == null || this.content == null)
            return null;
        let node = cc.instantiate(template);
        node.parent = this.content;
        node.active = true;
        let unit:BubbleUnit = {
            node:node,
            divider:kind === "divider",
            messageId:"",
            height:0,
            bubble:Tool.GetChild(node,"气泡"),
            bubbleSprite:null,
            text:null,
            image:null,
            voice:null,
            avatar:null,
            status:null,
            dividerLabel:null,
            systemTime:null,
            systemText:null
        };
        unit.bubbleSprite = unit.bubble == null ? null : unit.bubble.getComponent(cc.Sprite);
        let textNode = Tool.GetChild(node,"文字");
        unit.text = textNode == null ? null : textNode.getComponent(cc.Label);
        let imageNode = Tool.GetChild(node,"图片");
        unit.image = imageNode == null ? null : imageNode.getComponent(cc.Sprite);
        let voiceNode = Tool.GetChild(node,"语音");
        unit.voice = voiceNode == null ? null : voiceNode.getComponent(cc.Label);
        let avatarNode = Tool.GetChild(node,"头像");
        unit.avatar = avatarNode == null ? null : avatarNode.getComponent(cc.Sprite);
        let statusNode = Tool.GetChild(node,"状态");
        unit.status = statusNode == null ? null : statusNode.getComponent(cc.Label);
        let dividerLabelNode = Tool.GetChild(node,"时间");
        unit.dividerLabel = dividerLabelNode == null ? null : dividerLabelNode.getComponent(cc.Label);
        let systemTextNode = Tool.GetChild(node,"内容");
        unit.systemText = systemTextNode == null ? null : systemTextNode.getComponent(cc.Label);
        unit.systemTime = kind === "system" ? unit.dividerLabel : null;
        return unit;
    }

    private TakeUnit(kind:"divider"|"left"|"right"|"system"):BubbleUnit
    {
        let pool = this.PoolOf(kind);
        if(this.poolCursor[kind] < pool.length)
            return pool[this.poolCursor[kind]];
        let created = this.CreateUnit(kind);
        if(created == null)
            return null;
        pool.push(created);
        return created;
    }

    /**
     * 重绘消息区。
     *
     * 从上往下按内容高度累加排布（content 锚点 y=1，向下为负），因此插入更早的消息
     * 后直接加高 content，再由调用方按高度差恢复滚动位置即可保持视觉不跳动。
     * `keepScroll` 为 false 时在渲染后自动跟到底部（自己发消息、首次加载）。
     */
    private Render(reset:boolean,keepScroll:boolean):void
    {
        if(this.content == null)
            return;
        this.PrepareScrollLayout();
        this.poolCursor = {divider:0, left:0, right:0, system:0};
        let cursor = 0;
        let previousTime = 0;
        for(let message of this.messages)
        {
            let time = DirectChatTime.Parse(message.createdAt);
            const isSystem = message.messageType === "system";
            // 系统通报条自带完整年月日时分秒，不再额外插“今天/昨天”分隔条。
            if(!isSystem && DirectChatTime.NeedDivider(previousTime,time))
            {
                let divider = this.TakeUnit("divider");
                if(divider != null)
                {
                    this.poolCursor.divider++;
                    divider.node.active = true;
                    if(divider.dividerLabel != null)
                        divider.dividerLabel.string = DirectChatTime.FormatDivider(message.createdAt);
                    let height = Math.max(40,divider.node.height);
                    divider.height = height;
                    divider.node.y = -(cursor + height / 2);
                    cursor += height;
                }
                previousTime = time;
            }
            if(isSystem)
            {
                let unit = this.TakeUnit("system");
                if(unit == null)
                    break;
                this.poolCursor.system++;
                unit.node.active = true;
                unit.messageId = message.id;
                // 通报条按自身 620 宽居中，不要跟着整行拉伸，否则底图会变形。
                // 服务端只回 createdAt，本地兜底消息自带 systemTime，两边都显示完整时间。
                if(unit.systemTime != null)
                    unit.systemTime.string = message.systemTime || DirectChatTime.FormatFull(message.createdAt);
                if(unit.systemText != null)
                    unit.systemText.string = message.text || "";
                // 模板高度固定，这里只在排布时上下各留 7px 间距，不拉伸节点。
                let height = Math.max(96,unit.node.height) + 14;
                unit.height = height;
                unit.node.y = -(cursor + height / 2);
                cursor += height;
                previousTime = time;
                continue;
            }
            let isSelf = message.senderGuuid === this.manager.CurrentGuuid();
            let unit = this.TakeUnit(isSelf ? "right" : "left");
            if(unit == null)
                break;
            this.poolCursor[isSelf ? "right" : "left"]++;
            unit.node.active = true;
            unit.messageId = message.id;
            unit.node.width = Math.max(320,this.content.width);
            let height = this.ApplyBubble(unit,message);
            unit.height = height;
            unit.node.height = height;
            unit.node.y = -(cursor + height / 2);
            cursor += height;
            previousTime = time;
        }
        // 未被使用的节点只隐藏，留在池里等下次复用。
        for(let kind of ["divider","left","right","system"])
        {
            let pool = this.PoolOf(kind as "divider"|"left"|"right"|"system");
            for(let i = this.poolCursor[kind];i < pool.length;i++)
            {
                if(cc.isValid(pool[i].node))
                    pool[i].node.active = false;
            }
        }
        // content 顶部由 Widget(TOP) 固定，这里只更新内容高度。
        this.content.height = Math.max(cursor,this.scroll != null ? this.scroll.node.height : cursor);
        this.UpdateTopTipState();
    }

    /** 上下分/下分成功：往当前会话插一条系统通报条（仅本机可见，不进服务端）。 */
    private OnClubGoldNotice(notice:any):void
    {
        if(notice == null || this.content == null || this.disposed)
            return;
        const clubId = String(notice.clubId || "");
        if(clubId !== "" && this.clubId !== "" && clubId !== this.clubId)
            return;
        // 只往「被操作的那个人的会话」里插，避免出现在别的聊天里。
        const peerId = this.peer == null ? "" : String(this.peer.guuid || "");
        const targetId = String(notice.userId || "");
        if(peerId !== "" && targetId !== "" && peerId !== targetId)
            return;
        const action = notice.action === "down" ? "down" : (notice.action === "give" ? "give" : "up");
        const amount = Math.abs(Number(notice.amount));
        if(!isFinite(amount) || amount <= 0)
            return;
        const text = this.BuildGoldNoticeText(notice,action,amount);
        // 和文字/图片/语音消息一样落服务端：重进聊天、换设备、对方都看得到。
        const clientMessageId = "n" + Date.now().toString(36)
            + Math.floor(Math.random() * 0xFFFFFF).toString(36);
        this.manager.SendSystemNotice(this.conversationId,text,clientMessageId)
            .then((message:DirectMessage)=>{
                if(this.disposed || message == null)
                    return;
                this.AppendToTail([message]);
            })
            .catch(()=>{
                // 服务端拒绝或断网时至少在本机留一条，避免操作成功却没有任何反馈。
                if(!this.disposed)
                    this.AppendToTail([this.MakeLocalNotice(text)]);
            });
    }

    private BuildGoldNoticeText(notice:any,action:string,amount:number):string
    {
        const name = String(notice.userName || notice.userId || "");
        const verb = action === "up" ? "上分" : (action === "down" ? "下分" : "赠送");
        let text = "玩家 " + name + " " + verb + " " + amount + " 成功";
        // 回包带了变更后积分才补「从多少变成多少」，查不到就不编造。
        const balance = Number(notice.balance);
        if(isFinite(balance))
        {
            const before = action === "down" ? balance + amount : balance - amount;
            text += "，积分 " + Math.max(0,before) + " → " + balance;
        }
        return text;
    }

    /** 服务端没发出去时的本机兜底，只在本机显示、不落库。 */
    private MakeLocalNotice(text:string):DirectMessage
    {
        const now = new Date();
        return {
            id:"sys-" + now.getTime(),
            messageType:"system",
            text:text,
            attachment:null,
            senderGuuid:"",
            senderName:"",
            senderRole:"",
            clientMessageId:"",
            createdAt:DirectChatTime.FormatFull(now.getTime()),
            pending:false,
            failed:false
        };
    }

    private UpdateTopTipState():void
    {
        if(this.topTip == null)
            return;
        if(this.loadingBefore)
            this.topTip.string = "加载更早消息…";
        else if(!this.hasMoreBefore && this.messages.length > 0)
            this.topTip.string = "没有更多消息";
        else if(this.loadBeforeFailed)
            this.topTip.string = "加载更早消息失败，点击重试";
        else
            this.topTip.string = "";
    }

    private ApplyBubble(unit:BubbleUnit,message:DirectMessage):number
    {
        let isSelf = message.senderGuuid === this.manager.CurrentGuuid();
        let hasText = message.messageType === "text";
        let hasImage = message.messageType === "image" && message.attachment != null;
        let hasVoice = message.messageType === "voice" && message.attachment != null;
        let rowWidth = this.content == null ? 750 : Math.max(320,this.content.width);
        let avatarSize = unit.avatar == null ? 76 : Math.max(64,unit.avatar.node.width);
        let sidePadding = Math.max(18,Math.min(32,rowWidth * 0.04));
        let avatarGap = 16;
        let maxBubbleWidth = Math.max(180,Math.min(520,
            rowWidth - avatarSize - avatarGap - sidePadding * 2));
        let height = avatarSize + 18;
        let bubbleWidth = 0;
        let bubbleHeight = 0;

        if(unit.text != null)
        {
            unit.text.node.active = hasText;
            if(hasText)
            {
                let text = message.text == null ? "" : message.text;
                let maxTextWidth = maxBubbleWidth - 36;
                let measuredWidth = this.EstimateTextWidth(text,unit.text.fontSize);
                let oneLine = text.indexOf("\n") < 0 && measuredWidth <= maxTextWidth;
                let textWidth = Math.min(maxTextWidth,Math.max(56,measuredWidth));
                // 单行消息统一使用同一高度，不能让数字/英文的宽度估算影响气泡高度。
                // 多行消息才按实际行数增高，保证背景完整包住文字。
                let textHeight = oneLine ?
                    Math.max(36,unit.text.lineHeight > 0 ? unit.text.lineHeight : unit.text.fontSize + 8) :
                    this.EstimateTextHeight(text,textWidth,unit.text.fontSize,unit.text.lineHeight);
                bubbleWidth = Math.max(78,textWidth + 36);
                bubbleHeight = oneLine ? 72 : Math.max(72,textHeight + 28);
                unit.text.node.width = bubbleWidth - 36;
                unit.text.node.height = textHeight;
                unit.text.overflow = cc.Label.Overflow.CLAMP;
                unit.text.enableWrapText = true;
                unit.text.string = text;
                height = Math.max(height,bubbleHeight);
            }
        }
        if(unit.image != null)
        {
            unit.image.node.active = hasImage;
            if(hasImage)
            {
                // 图片按缩略图比例缩进固定展示框，不在列表下载原图。
                let width = 240;
                let ratio = message.attachment.width > 0 && message.attachment.height > 0 ?
                    message.attachment.height / message.attachment.width : 1.2;
                let imageHeight = Math.max(120,Math.min(360,width * ratio));
                unit.image.node.width = width;
                unit.image.node.height = imageHeight;
                height = imageHeight + 20;
                bubbleWidth = width + 20;
                bubbleHeight = imageHeight;
                let url = message.attachment.thumbnailUrl !== "" ? message.attachment.thumbnailUrl : message.attachment.url;
                this.LoadImageInto(unit.image,url);
            }
        }
        if(unit.voice != null)
        {
            unit.voice.node.active = hasVoice;
            if(hasVoice)
            {
                let ms = message.attachment.durationMs;
                unit.voice.string = (this.playingVoiceId !== "" && this.playingVoiceId === message.attachment.id ?
                    "◀))  " : "◖))  ") + DirectChatTime.FormatDuration(ms).replace("'","″");
                bubbleWidth = Math.min(maxBubbleWidth,150 + 36);
                bubbleHeight = 64;
                unit.voice.node.width = bubbleWidth - 36;
                unit.voice.node.height = 36;
                height = Math.max(height,bubbleHeight);
            }
        }

        if(unit.bubble != null)
        {
            unit.bubble.active = hasText || hasVoice;
            if(unit.bubble.active && bubbleWidth > 0)
            {
                unit.bubble.width = bubbleWidth;
                unit.bubble.height = bubbleHeight;
            }
            if(unit.bubbleSprite != null)
                unit.bubbleSprite.enabled = true;
        }
        if(unit.avatar != null)
        {
            unit.avatar.node.active = true;
            unit.avatar.node.width = avatarSize;
            unit.avatar.node.height = avatarSize;
            ImageManager.getInstance().SetLocalAvatar(unit.avatar,
                message.senderGuuid === this.manager.CurrentGuuid() ?
                    this.manager.Me().avatar : (this.peer == null ? "" : this.peer.avatar),
                message.senderGuuid);
        }

        // 消息行在内容宽度变化时重新计算：对方头像和气泡在左侧，自己的头像和气泡在右侧。
        let avatarX = isSelf ? rowWidth / 2 - sidePadding - avatarSize / 2 :
            -rowWidth / 2 + sidePadding + avatarSize / 2;
        let bubbleEdge = isSelf ? avatarX - avatarSize / 2 - avatarGap :
            avatarX + avatarSize / 2 + avatarGap;
        if(unit.avatar != null)
            unit.avatar.node.setPosition(avatarX,0);
        if(unit.bubble != null)
        {
            unit.bubble.anchorX = isSelf ? 1 : 0;
            unit.bubble.setPosition(bubbleEdge,0);
        }
        if(unit.text != null)
        {
            unit.text.node.anchorX = isSelf ? 1 : 0;
            unit.text.node.setPosition(isSelf ? bubbleEdge - 18 : bubbleEdge + 18,0);
            unit.text.horizontalAlign = isSelf ? cc.Label.HorizontalAlign.RIGHT : cc.Label.HorizontalAlign.LEFT;
        }
        if(unit.voice != null)
        {
            unit.voice.node.anchorX = isSelf ? 1 : 0;
            unit.voice.node.setPosition(isSelf ? bubbleEdge - 18 : bubbleEdge + 18,0);
            unit.voice.horizontalAlign = isSelf ? cc.Label.HorizontalAlign.RIGHT : cc.Label.HorizontalAlign.LEFT;
        }
        if(unit.image != null)
        {
            unit.image.node.anchorX = isSelf ? 1 : 0;
            unit.image.node.setPosition(isSelf ? bubbleEdge : bubbleEdge,0);
        }
        if(unit.status != null)
        {
            let state = message.failed ? "发送失败，点击重试" : (message.pending ? "发送中…" : "");
            unit.status.node.active = state !== "";
            unit.status.string = state;
        }

        // 点击交互：图片看大图、语音播放、失败重试。
        let button = unit.node.getComponent(cc.Button);
        if(button != null)
        {
            button.node.targetOff(this);
            button.node.on("click",()=>{ this.OnBubbleClick(message); },this);
        }
        return Math.max(56,height);
    }

    /** 估算单行文字宽度，用于让短消息收缩成效果图中的紧凑气泡。 */
    private EstimateTextWidth(text:string,fontSize:number):number
    {
        let size = fontSize > 0 ? fontSize : 27;
        let max = 0;
        for(let part of (text == null ? "" : text).split("\n"))
        {
            let width = 0;
            for(let char of part)
                width += /[\x00-\xff]/.test(char) ? size * 0.58 : size;
            max = Math.max(max,width);
        }
        return max;
    }

    /** 文本高度估算：中文按字号宽度折行，避免依赖 Label 的异步刷新时序。 */
    private EstimateTextHeight(text:string,width:number,fontSize:number,lineHeight:number):number
    {
        let size = fontSize > 0 ? fontSize : 26;
        let line = lineHeight > 0 ? lineHeight : size + 6;
        let perLine = Math.max(4,Math.floor(width / (size * 1.05)));
        let lines = 0;
        for(let part of (text == null ? "" : text).split("\n"))
        {
            lines += Math.max(1,Math.ceil(part.length / perLine));
        }
        return Math.max(line,Math.min(lines,14) * line) + 8;
    }

    private LoadImageInto(sprite:cc.Sprite,url:string):void
    {
        if(sprite == null || url == null || url === "")
            return;
        let cached = this.imageTextureCache[url];
        if(cached != null)
        {
            sprite.spriteFrame = cached;
            return;
        }
        cc.loader.load({url:url,type:"image"},(err,texture:cc.Texture2D)=>{
            if(this.disposed || err != null || texture == null || !cc.isValid(sprite))
                return;
            let frame = new cc.SpriteFrame(texture);
            this.imageTextureCache[url] = frame;
            if(cc.isValid(sprite))
                sprite.spriteFrame = frame;
        });
    }

    // ================= 交互 =================

    private OnBubbleClick(message:DirectMessage):void
    {
        if(message.failed)
        {
            this.Resend(message);
            return;
        }
        if(message.messageType === "image" && message.attachment != null)
        {
            this.ShowPreview(message.attachment);
            return;
        }
        if(message.messageType === "voice" && message.attachment != null)
        {
            this.PlayVoice(message);
        }
    }

    /** 图片预览使用独立的运行时蒙版，避免依赖预览底图是否带有黑色透明层。 */
    private PreparePreviewMask():void
    {
        if(this.previewNode == null)
            return;
        let mask = this.previewNode.getChildByName("预览蒙版");
        if(mask == null)
        {
            mask = new cc.Node("预览蒙版");
            mask.parent = this.previewNode;
        }
        mask.anchorX = this.previewNode.anchorX;
        mask.anchorY = this.previewNode.anchorY;
        mask.setPosition(0,0);
        mask.width = this.previewNode.width;
        mask.height = this.previewNode.height;
        let graphics = mask.getComponent(cc.Graphics);
        if(graphics == null)
            graphics = mask.addComponent(cc.Graphics);
        graphics.clear();
        graphics.fillColor = cc.color(0,0,0,190);
        graphics.rect(-mask.width * mask.anchorX,-mask.height * mask.anchorY,mask.width,mask.height);
        graphics.fill();
        mask.setSiblingIndex(0);
        this.previewMask = mask;
    }

    private ShowPreview(attachment:DirectAttachment):void
    {
        if(this.previewNode == null || this.previewSprite == null)
            return;
        this.PreparePreviewMask();
        this.previewNode.active = true;
        this.previewSprite.spriteFrame = null;
        this.LoadImageInto(this.previewSprite,attachment.url);
    }

    /** 语音同一时间只播放一条，切换消息时先停上一条。 */
    private PlayVoice(message:DirectMessage):void
    {
        let voiceId = message.attachment.voiceId;
        if(voiceId === "")
            return;
        if(this.playingVoiceId === message.attachment.id)
        {
            this.playingVoiceId = "";
            this.Render(false,true);
            return;
        }
        this.playingVoiceId = message.attachment.id;
        this.manager.PlayVoice(voiceId);
        this.Render(false,true);
        // 原生/浏览器播放完成回调不区分来源，这里给一个保底恢复。
        setTimeout(()=>{
            if(this.disposed)
                return;
            if(this.playingVoiceId !== message.attachment.id)
                return;
            this.playingVoiceId = "";
            this.Render(false,true);
        },Math.max(1000,message.attachment.durationMs + 400));
    }

    private Resend(message:DirectMessage):void
    {
        if(message == null || !message.failed)
            return;
        // 重试必须复用原 clientMessageId，服务端才能幂等去重。
        message.failed = false;
        message.pending = true;
        this.Render(false,true);
        let resend:Promise<DirectMessage> = message.messageType === "text" ?
            this.manager.SendText(this.conversationId,message.text,message.clientMessageId) :
            this.manager.SendAttachmentMessage(this.conversationId,message.messageType,
                message.attachment == null ? "" : message.attachment.id,message.clientMessageId);
        resend.then((stored:DirectMessage)=>{
                this.ReplaceLocalMessage(message,stored);
            }).catch(()=>{
                message.pending = false;
                message.failed = true;
                this.Render(false,true);
            });
    }

    private ReplaceLocalMessage(local:DirectMessage,raw:any):void
    {
        let index = this.messages.indexOf(local);
        if(index >= 0 && raw != null)
        {
            let stored = this.manager.NormalizeMessageForPanel(raw);
            this.messages[index] = stored;
        }
        this.Render(false,true);
        let last = this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
        if(last != null)
            this.manager.SetMessageCursor(this.conversationId,last.id);
        this.ScrollToBottom(true);
    }

    public onButtonClick(button:cc.Button)
    {
        let name = button.node.name;
        if(name === "关闭" || name === "返回")
        {
            UIManager.getInstance().closePanelByName(this.node.name);
        }
        else if(name === "发送")
        {
            this.SendText();
        }
        else if(name === "拍照上传")
        {
            this.SendImage("camera");
        }
        else if(name === "图片" || name === "发送图片")
        {
            this.SendImage("library");
        }
        else if(name === "删除")
        {
            this.ConfirmDelete();
        }
        else if(name === "上下分")
        {
            this.OpenClubGoldPad("updown");
        }
        else if(name === "赠送积分")
        {
            this.OpenClubGoldPad("give");
        }
        else if(name === "新消息")
        {
            this.ScrollToBottom(true);
            this.MarkLatestRead();
            if(this.newTipNode != null)
                this.newTipNode.active = false;
        }
        else if(name === "顶部提示" || name === "重试历史")
        {
            if(!this.hasMoreBefore)
                return;
            this.LoadBefore();
        }
        else if(name === "预览关闭" || name === "大图预览")
        {
            if(this.previewNode != null)
                this.previewNode.active = false;
        }
        else if(name === "录音取消")
        {
            this.CancelRecord();
        }
        else
        {
            super.onButtonClick(button);
        }
    }

    /**
     * 上下分入口只对当前俱乐部的群主、盟主，或已授信且仍有可用额度的代理显示。
     * 入口显示是体验层判断，真正的成员范围、余额和交易密码仍由大厅服务端校验。
     */
    private RefreshClubGoldButton():void
    {
        const role = String(this.role || "member");
        const hasPeer = this.clubId !== "" && this.peer != null && this.peer.guuid !== "";
        const hasQuota = this.clubGoldQuotaGranted && this.clubGoldQuotaFen > 0;
        // 代理的额度是异步查询出来的：回包到之前不能按「无额度」处理，
        // 否则有额度的代理会先闪一下「赠送」再跳成「上下分」。
        const quotaKnown = role !== "agent" || this.clubGoldQuotaKnown;
        // 赠送的对象范围：玩家、管理员，以及代理（下级代理/同级代理）。
        // 服务端「赠送_俱乐部_积分」只校验两人带入时扣同一个授信代理的额度，不按角色拦，
        // 所以给下级代理赠送同样成立；只有群主/盟主是对方的上级，不该出现赠送入口。
        const peerRole = this.peer == null ? "" : String(this.peer.role || "");
        const peerCanGift = peerRole === "" || peerRole === "member" || peerRole === "manager" || peerRole === "agent";

        if(this.clubGoldButton != null)
        {
            if(role === "owner" || role === "leader")
                this.clubGoldButton.active = hasPeer;
            else
                this.clubGoldButton.active = role === "agent" && quotaKnown && hasQuota && hasPeer;
        }
        // 自己是代理但没有可用额度（未授信或额度为 0）时，改为显示「赠送积分」：
        // 代理没有额度就发不出筹码，只能拿自己账户里的积分送人，走「赠送_俱乐部_积分」。
        if(this.clubGiveButton != null)
            this.clubGiveButton.active = role === "agent" && quotaKnown && !hasQuota && peerCanGift && hasPeer;

        this.LayoutBottomEntries();

        if(role === "agent")
            this.RequestClubGoldQuota();
    }

    /**
     * 底部入口的水平位置按「当前实际显示几个」重新均分。
     * 四个按钮的 Widget 只吃 BOTTOM，水平位置由这里给，隐藏掉一两个时不会留空洞。
     */
    private LayoutBottomEntries():void
    {
        const entries:cc.Node[] = [this.photoButton,this.imageButton,this.clubGiveButton,this.clubGoldButton];
        const visible:cc.Node[] = [];
        for(let node of entries)
        {
            if(node != null && node.active)
                visible.push(node);
        }
        if(visible.length === 0)
            return;
        const width = 108;
        const gap = 63;
        const total = visible.length * width + (visible.length - 1) * gap;
        let x = -total / 2 + width / 2;
        for(let node of visible)
        {
            node.x = x;
            x += width + gap;
        }
    }

    private RequestClubGoldQuota():void
    {
        if(this.clubGoldQuotaRequested || this.clubId === "")
            return;
        const account:any = GameDataManager.getAccount();
        const userId = account == null ? "" : String(account.guuid || "").trim();
        if(userId === "")
            return;
        this.clubGoldQuotaRequested = true;
        this.clubGoldQuotaContext = "chatgold:quota:" + this.clubId + ":" + userId;
        try
        {
            GameDataManager.getAccount().reqHallCommand(JSON.stringify({
                header:"查询_俱乐部_额度",
                club_id:this.clubId,
                user_id:userId,
                context:this.clubGoldQuotaContext
            }),"P@" + this.clubGoldQuotaContext);
        }
        catch(error)
        {
            this.clubGoldQuotaRequested = false;
        }
    }

    /** GetClubQuota 是异步推送，兼容旧服的同名包装、result 包装和 JSON 字符串包装。 */
    public OnClubGoldQuota(raw:any,secondaryRaw?:any):void
    {
        if(secondaryRaw !== undefined && (typeof raw === "number" || typeof raw === "boolean"))
            raw = secondaryRaw;
        let data:any = raw;
        if(typeof data === "string")
        {
            try { data = JSON.parse(data); }
            catch(error) { return; }
        }
        if(data == null || typeof data !== "object")
            return;
        let body:any = data;
        if(body.result != null)
            body = this.ParseObject(body.result);
        body = this.ParseObject(body);
        if(body != null && body.GetClubQuota != null)
            body = this.ParseObject(body.GetClubQuota);
        if(body == null || typeof body !== "object")
            return;
        const context = String(data.context || body.context || "");
        const sameContext = this.clubGoldQuotaContext !== "" &&
            (context === this.clubGoldQuotaContext || context.indexOf(this.clubGoldQuotaContext) >= 0);
        const returnedClub = String(body.club_id || data.club_id || "");
        if(!sameContext && returnedClub !== this.clubId)
            return;
        if(returnedClub !== "" && returnedClub !== this.clubId)
            return;
        const fen = Number(body.quota_fen);
        if(!Number.isFinite(fen))
        {
            this.clubGoldQuotaGranted = false;
            this.clubGoldQuotaFen = 0;
            this.clubGoldQuotaKnown = true;
            this.RefreshClubGoldButton();
            return;
        }
        this.clubGoldQuotaFen = fen;
        this.clubGoldQuotaKnown = true;
        this.clubGoldQuotaGranted = this.IsFlag(body.is_agent) && this.IsFlag(body.is_granted);
        this.RefreshClubGoldButton();
    }

    public OnClubGoldQuotaCommand(nCode:number,param:string):void
    {
        if(this.clubGoldQuotaContext === "" || param == null || String(param).indexOf(this.clubGoldQuotaContext) < 0)
            return;
        if(nCode !== 0x200)
        {
            this.clubGoldQuotaGranted = false;
            this.clubGoldQuotaFen = 0;
            if(this.clubGoldButton != null)
                this.clubGoldButton.active = false;
        }
    }

    private ParseObject(value:any):any
    {
        if(typeof value !== "string")
            return value;
        try { return JSON.parse(value); }
        catch(error) { return null; }
    }

    private IsFlag(value:any):boolean
    {
        if(value === true || value === 1)
            return true;
        const text = String(value == null ? "" : value).trim().toLowerCase();
        return text === "1" || text === "true" || text === "yes" || text === "是";
    }

    private OpenClubGoldPad(mode:"updown"|"give"):void
    {
        if(this.clubId === "" || this.peer == null || this.peer.guuid === "")
            return;
        const entry = mode === "give" ? this.clubGiveButton : this.clubGoldButton;
        if(entry == null || !entry.active)
            return;
        UIManager.getInstance().showPanel("panelClubGoldPad",ShowPanelMode.Top,JSON.stringify({
            clubId:this.clubId,
            userId:this.peer.guuid,
            userName:this.peer.name || this.peer.guuid,
            mode:mode
        }));
    }

    // ================= 发送 =================

    private SendText():void
    {
        if(this.conversationId === "")
        {
            this.ShowErrorToast(new DirectChatError("会话尚未建立，请返回消息列表重新打开","CONVERSATION_NOT_FOUND"));
            return;
        }
        if(!this.canSend)
        {
            this.ShowErrorToast(new Error(this.readOnlyReason === "" ? "当前不能发送消息" : this.readOnlyReason));
            return;
        }
        if(this.inputBox == null)
            return;
        let text = String(this.inputBox.string == null ? "" : this.inputBox.string).replace(/^\s+|\s+$/g,"");
        if(text === "")
            return;
        if(text.length > 2000)
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Top,"消息不能超过 2000 个字符");
            return;
        }
        let clientMessageId = this.manager.NewClientMessageId();
        let local:DirectMessage = {
            id:"local-" + (++this.localSeq).toString(),
            messageType:"text",
            text:text,
            attachment:null,
            senderGuuid:this.manager.CurrentGuuid(),
            senderName:this.manager.Me().name,
            senderRole:this.role,
            clientMessageId:clientMessageId,
            createdAt:"",
            pending:true,
            failed:false
        };
        this.messages.push(local);
        this.Render(false,true);
        this.ScrollToBottom(true);
        if(this.inputBox != null)
            this.inputBox.string = "";

        this.manager.SendText(this.conversationId,text,clientMessageId).then((stored)=>{
            let index = this.messages.indexOf(local);
            if(index >= 0)
                this.messages[index] = stored;
            this.Render(false,true);
            this.manager.SetMessageCursor(this.conversationId,stored.id);
        }).catch((error:any)=>{
            // 失败保留气泡和原文，重试复用同一个 clientMessageId。
            local.pending = false;
            local.failed = true;
            if(this.inputBox != null && String(this.inputBox.string || "") === "")
                this.inputBox.string = text;
            this.Render(false,true);
            this.ShowErrorToast(error);
        });
    }

    private SendImage(source:DirectImageSource = "library"):void
    {
        if(!this.canSend)
        {
            this.ShowErrorToast(new Error(this.readOnlyReason === "" ? "当前不能发送消息" : this.readOnlyReason));
            return;
        }
        if(this.uploading)
            return;
        if(!this.manager.ImagePickSupported())
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Top,
                source === "camera" ? "当前版本不支持拍照，请更新客户端" : "当前版本不支持选择图片，请更新客户端");
            return;
        }
        this.manager.PickImage(source).then((image:DirectPickedImage)=>{
            if(this.disposed)
                return;
            this.uploading = true;
            this.SetTopTip("图片上传中…");
            return this.manager.SendImageMessage(this.conversationId,image).then((stored)=>{
                this.uploading = false;
                this.SetTopTip("");
                this.messages.push(stored);
                this.Render(false,true);
                this.ScrollToBottom(true);
                this.manager.SetMessageCursor(this.conversationId,stored.id);
            },(error:any)=>{
                this.uploading = false;
                this.SetTopTip("");
                this.ShowErrorToast(error);
            });
        },(error:any)=>{
            if(error != null && error.code === "ABORTED")
                return;
            this.ShowErrorToast(error);
        });
    }

    // ================= 语音 =================

    private BindVoiceButton():void
    {
        if(this.voiceButton == null)
            return;
        this.voiceButton.on(cc.Node.EventType.TOUCH_START,(event:cc.Event.EventTouch)=>{
            event.stopPropagation();
            this.StartRecord(event);
        },this);
        this.voiceButton.on(cc.Node.EventType.TOUCH_MOVE,(event:cc.Event.EventTouch)=>{
            event.stopPropagation();
            this.MoveRecord(event);
        },this);
        this.voiceButton.on(cc.Node.EventType.TOUCH_END,(event:cc.Event.EventTouch)=>{
            event.stopPropagation();
            this.FinishRecord();
        },this);
        this.voiceButton.on(cc.Node.EventType.TOUCH_CANCEL,(event:cc.Event.EventTouch)=>{
            event.stopPropagation();
            this.CancelRecord();
        },this);
    }

    private StartRecord(event:cc.Event.EventTouch):void
    {
        if(!this.canSend)
        {
            this.ShowErrorToast(new Error(this.readOnlyReason === "" ? "当前不能发送消息" : this.readOnlyReason));
            return;
        }
        if(!this.manager.VoiceSupported())
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Top,"当前版本不支持录音，请更新客户端");
            return;
        }
        this.recordStartY = event.getLocation().y;
        this.recordCancelling = false;
        if(this.recordOverlay != null)
            this.recordOverlay.active = true;
        if(this.recordCancelLabel != null)
            this.recordCancelLabel.string = "上滑取消";
        this.recordSeconds = 0;
        if(this.recordLabel != null)
            this.recordLabel.string = "0:00";
        this.StopRecordTimer();
        this.recordTimer = setInterval(()=>{
            this.recordSeconds++;
            if(this.recordLabel != null)
                this.recordLabel.string = DirectChatTime.FormatRecordSeconds(this.recordSeconds);
        },1000);

        let error = this.manager.StartVoiceRecord((voiceId:string,durationMs:number)=>{
            this.StopRecordTimer();
            this.HideRecordOverlay();
            this.SendVoice(voiceId,durationMs);
        },(message:string)=>{
            this.StopRecordTimer();
            this.HideRecordOverlay();
            if(message != null && message !== "")
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Top,message);
        });
        if(error !== "")
        {
            this.StopRecordTimer();
            this.HideRecordOverlay();
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Top,error);
        }
    }

    private MoveRecord(event:cc.Event.EventTouch):void
    {
        if(this.recordTimer == null)
            return;
        let delta = event.getLocation().y - this.recordStartY;
        let cancelling = delta < -80;
        if(cancelling === this.recordCancelling)
            return;
        this.recordCancelling = cancelling;
        if(this.recordCancelLabel != null)
            this.recordCancelLabel.string = cancelling ? "松开取消" : "上滑取消";
    }

    private FinishRecord():void
    {
        if(this.recordTimer == null)
            return;
        if(this.recordCancelling)
        {
            this.CancelRecord();
            return;
        }
        this.StopRecordTimer();
        if(this.recordLabel != null)
            this.recordLabel.string = "发送中…";
        this.manager.StopVoiceRecord();
    }

    private CancelRecord():void
    {
        this.StopRecordTimer();
        this.HideRecordOverlay();
        this.manager.CancelVoiceRecord();
    }

    private StopRecordTimer():void
    {
        if(this.recordTimer != null)
        {
            clearInterval(this.recordTimer);
            this.recordTimer = null;
        }
    }

    private HideRecordOverlay():void
    {
        if(this.recordOverlay != null)
            this.recordOverlay.active = false;
    }

    private SendVoice(voiceId:string,durationMs:number):void
    {
        if(this.disposed || voiceId == null || voiceId === "")
            return;
        if(this.conversationId === "")
        {
            this.ShowErrorToast(new DirectChatError("会话尚未建立，请返回消息列表重新打开","CONVERSATION_NOT_FOUND"));
            return;
        }
        this.SetTopTip("语音发送中…");
        this.manager.SendVoiceMessage(this.conversationId,voiceId,durationMs).then((stored)=>{
            this.SetTopTip("");
            this.messages.push(stored);
            this.Render(false,true);
            this.ScrollToBottom(true);
            this.manager.SetMessageCursor(this.conversationId,stored.id);
        }).catch((error:any)=>{
            this.SetTopTip("");
            this.ShowErrorToast(error);
        });
    }

    // ================= 删除 =================

    private ConfirmDelete():void
    {
        if(!this.canDelete)
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Top,"当前身份不能删除聊天");
            return;
        }
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Top,
            "删除后该聊天会从你的消息列表隐藏，聊天记录不会删除，可从成员列表重新打开。确定删除？",
            [(confirmed:boolean)=>{
                if(!confirmed)
                    return;
                this.DoDelete();
            }]);
    }

    private DoDelete():void
    {
        this.manager.HideConversation(this.conversationId).then(()=>{
            this.manager.InvalidateConversations(this.clubId);
            UIManager.getInstance().closePanelByName(this.node.name);
        }).catch((error:any)=>{
            // 删除失败留在当前页，不能先把本地会话永久移除。
            this.ShowErrorToast(error);
        });
    }

    private ShowErrorToast(error:any):void
    {
        let text = error != null && error.message != null ? String(error.message) : "网络异常，请稍后重试";
        if(error instanceof DirectChatError)
        {
            if(error.code === "DIRECT_SERVICE_UNAVAILABLE" || error.status === 404)
                text = "聊天服务尚未开通（服务端未更新），请联系管理员";
            else if(error.code === "PEER_NOT_CLUB_MEMBER")
                text = "对方已退出该俱乐部，暂时不能发送";
            else if(error.code === "NOT_CLUB_MEMBER")
                text = "你已不在该俱乐部";
            else if(error.code === "DIRECT_DELETE_FORBIDDEN")
                text = "当前身份不能删除聊天";
            else if(error.code === "MESSAGE_RATE_LIMITED")
                text = "发送过于频繁，请稍后再试";
            else if(error.code === "MEDIA_TOO_LARGE")
                text = "图片不能超过 10MB";
        }
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Top,text);
    }
}
