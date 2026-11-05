import UIPanelViewBase from "../common/UIPanelViewBase";
import Tool from "../common/Tool";
import UIManager from "../common/UIManager";
import { ShowPanelMode } from "../common/GameDef";
import ImageManager from "../logic/ImageManager";
import DirectChatManager, { DirectChatError, DirectConversation, DirectHostingInfo } from "../logic/DirectChatManager";
import DirectChatTime from "../common/DirectChatTime";
import Debug from "../common/Debug";

const {ccclass} = cc._decorator;

/** 服务端全局会话分页固定 30 条；客户端只按页追加，避免一次拉全量。 */
const PAGE_SIZE = 30;
/** 本地缓存只保留第一页，进页面时先出列表；多页数据仍由服务端分页保证。 */
const LIST_CACHE_MAX = 30;
const LIST_CACHE_VERSION = 1;
/** 距离底部小于该高度时自动请求下一页。 */
const LOAD_MORE_DISTANCE = 260;
/** 顶部负向回弹超过该距离（设计像素）后松手触发刷新。 */
const PULL_REFRESH_DISTANCE = 40;

/**
 * 消息首页：当前账号所有俱乐部的会话列表。
 *
 * 全部节点来自 panelMessage.prefab（设计文档 10.5.7），脚本只做数据绑定和显隐，
 * 不在运行时拼装美术节点；请求、长连接、未读汇总统一由 DirectChatManager 负责。
 *
 * 列表按页加载：进入时只取第 1 页，滚动接近底部自动追加下一页；顶部下拉刷新回到第 1 页。
 * 实时消息只增量更新已加载行的文案/红点，不整表重建，也不重置滚动位置。
 */
@ccclass
export default class panelMessage extends UIPanelViewBase {

    private manager:DirectChatManager = null;
    private scroll:cc.ScrollView = null;
    private content:cc.Node = null;
    private itemTemplate:cc.Node = null;
    private items:cc.Node[] = [];

    private loadingNode:cc.Node = null;
    private emptyNode:cc.Node = null;
    private errorNode:cc.Node = null;
    private errorLabel:cc.Label = null;
    private pullTipNode:cc.Node = null;
    private pullTipLabel:cc.Label = null;
    private bottomTipNode:cc.Node = null;
    private bottomTipLabel:cc.Label = null;

    /** 右上角聊天托管开关：只对服务端判定符合身份的大群主/盟主显示。 */
    private hostingButton:cc.Node = null;
    private hostingLabel:cc.Label = null;
    private hostingInfo:DirectHostingInfo = null;
    private hostingBusy:boolean = false;

    private list:DirectConversation[] = [];
    private page:number = 0;
    private pageSize:number = PAGE_SIZE;
    private hasMore:boolean = false;
    private loadingFirst:boolean = false;
    private loadingMore:boolean = false;
    private refreshing:boolean = false;
    private listRequestSerial:number = 0;
    private moreRequestSerial:number = 0;
    private silentRefreshScheduled:boolean = false;

    private pullOffset:number = 0;
    private lastScrollOffset:number = 0;

    private busy:boolean = false;

    private onAllConversationsHandler:(page:any)=>void = null;
    private onConversationReadHandler:(conversationId:string)=>void = null;

    onLoad()
    {
        super.onLoad();
        this.manager = DirectChatManager.GetInstance();

        this.scroll = this.NodeOf("列表") != null ? this.NodeOf("列表").getComponent(cc.ScrollView) : null;
        this.content = this.NodeOf("列表/view/content");
        this.itemTemplate = this.NodeOf("列表/view/content/会话项");
        if(this.itemTemplate != null)
            this.itemTemplate.active = false;

        this.loadingNode = this.NodeOf("加载");
        this.emptyNode = this.NodeOf("空态");
        this.errorNode = this.NodeOf("错误");
        this.errorLabel = this.NodeOf("错误/文案") != null ?
            this.NodeOf("错误/文案").getComponent(cc.Label) : null;
        this.pullTipNode = this.NodeOf("下拉提示");
        this.pullTipLabel = this.pullTipNode == null ? null : this.pullTipNode.getComponent(cc.Label);
        this.bottomTipNode = this.NodeOf("底部提示");
        this.bottomTipLabel = this.bottomTipNode == null ? null : this.bottomTipNode.getComponent(cc.Label);
        this.hostingButton = this.NodeOf("聊天托管");
        let hostingText = this.hostingButton == null ? null : Tool.GetChild(this.hostingButton,"文字");
        this.hostingLabel = hostingText == null ? null : hostingText.getComponent(cc.Label);
        if(this.hostingButton != null)
            this.hostingButton.active = false;
        if(this.pullTipNode != null)
            this.pullTipNode.active = false;
        if(this.bottomTipNode != null)
            this.bottomTipNode.active = false;

        this.onAllConversationsHandler = (page:any)=>{ this.OnServerConversations(page); };
        this.onConversationReadHandler = ()=>{ this.ScheduleSilentRefresh(); };
        this.manager.On("allConversations",this.onAllConversationsHandler);
        this.manager.On("conversationRead",this.onConversationReadHandler);

        this.BindScrollEvents();
    }

    private started:boolean = false;

    start()
    {
        this.started = true;
        this.Refresh(true);
        this.LoadHostingStatus(false);
    }

    onEnable()
    {
        // 常驻在 Main 下，切页回来时只刷新第一页并合并，保留已加载的后续页和滚动位置。
        if(!this.started || !this.node.activeInHierarchy)
            return;
        // 身份或托管状态可能在别处变化（入盟、换俱乐部、客服关闭），切回消息页时重查一次。
        this.LoadHostingStatus(true);
        if(this.list.length === 0)
        {
            let restored = this.RestoreManagerCache() || this.RestoreCachedList();
            this.LoadFirstPageMode(!restored,false);
        }
        else
            this.ScheduleSilentRefresh();
    }

    onDisable()
    {
        if(this.started)
            this.SaveCachedList();
        super.onDisable();
    }

    onDestroy()
    {
        this.manager.Off("allConversations",this.onAllConversationsHandler);
        this.manager.Off("conversationRead",this.onConversationReadHandler);
        if(this.scroll != null && cc.isValid(this.scroll.node))
        {
            this.scroll.node.off("scrolling",this.OnScrolling,this);
            this.scroll.node.off("bounce-top",this.OnBounceTop,this);
            this.scroll.node.off("scroll-ended",this.OnScrollEnded,this);
        }
        super.onDestroy();
    }

    private NodeOf(path:string):cc.Node
    {
        return Tool.GetChild(this.node,path);
    }

    private BindScrollEvents():void
    {
        if(this.scroll == null)
            return;
        this.scroll.node.on("scrolling",this.OnScrolling,this);
        // 与大厅房间列表一致：短列表也保留 1px 滚动余量，由 ScrollView 自己完成回弹，
        // 拉过顶部松手时派发 bounce-top，用来触发下拉刷新；脚本不再自己移动 content。
        this.scroll.node.on("bounce-top",this.OnBounceTop,this);
        this.scroll.node.on("scroll-ended",this.OnScrollEnded,this);
    }

    // ================= 数据 =================

    /** 进入页面：force 为 true 时显示居中加载并回到第 1 页；否则静默刷新第一页。 */
    public Refresh(force:boolean = false):void
    {
        if(this.manager.CurrentGuuid() === "")
        {
            this.ShowError("请先登录游戏");
            return;
        }
        if(this.list.length === 0)
        {
            // 先用大厅启动时预取的会话或本地缓存把界面填上，服务端第一页回来时整表替换。
            let restored = this.RestoreManagerCache() || this.RestoreCachedList();
            this.LoadFirstPageMode(!restored && force,false);
            return;
        }
        this.LoadFirstPageMode(force,!force);
    }

    /** 大厅启动时已经预取过第一页，进消息页直接复用，避免首次请求卡在打开动作上。 */
    private RestoreManagerCache():boolean
    {
        let page = this.manager.CachedAllConversations();
        if(page == null || page.items == null || page.items.length === 0)
            return false;
        this.list = page.items.slice(0);
        this.page = page.page > 0 ? Number(page.page) : 1;
        this.pageSize = page.pageSize > 0 ? Number(page.pageSize) : PAGE_SIZE;
        this.hasMore = page.hasMore === true;
        this.RenderFull(true,0);
        return true;
    }

    private CacheKey():string
    {
        let guuid = this.manager.CurrentGuuid();
        return guuid === "" ? "" : "direct_chat_list_v" + LIST_CACHE_VERSION + "_" + guuid;
    }

    /** 读取上次成功加载的会话列表；只做本地展示，服务端回包会覆盖。 */
    private RestoreCachedList():boolean
    {
        let key = this.CacheKey();
        if(key === "")
            return false;
        try
        {
            let raw = cc.sys.localStorage.getItem(key);
            if(raw == null || raw === "")
                return false;
            let data:any = JSON.parse(raw);
            if(data == null || !Array.isArray(data.items))
                return false;
            let items:DirectConversation[] = [];
            for(let one of data.items)
            {
                if(one == null || one.peer == null)
                    continue;
                items.push({
                    conversationId:String(one.conversationId || ""),
                    isDefaultTarget:one.isDefaultTarget === true,
                    clubId:String(one.clubId || ""),
                    clubName:String(one.clubName || ""),
                    peer:{
                        guuid:String(one.peer.guuid || ""),
                        name:String(one.peer.name || ""),
                        note:String(one.peer.note || ""),
                        avatar:String(one.peer.avatar || ""),
                        role:String(one.peer.role || "member")
                    },
                    lastMessage:String(one.lastMessage || ""),
                    lastMessageType:String(one.lastMessageType || ""),
                    lastMessageAt:String(one.lastMessageAt || ""),
                    unread:Number(one.unread || 0),
                    canSend:one.canSend !== false
                });
            }
            if(items.length === 0)
                return false;
            this.list = items;
            this.page = 1;
            this.pageSize = data.pageSize > 0 ? Number(data.pageSize) : PAGE_SIZE;
            this.hasMore = false;
            this.RenderFull(true,0);
            return true;
        }
        catch(error)
        {
            return false;
        }
    }

    private SaveCachedList():void
    {
        let key = this.CacheKey();
        if(key === "" || this.list.length === 0)
            return;
        try
        {
            cc.sys.localStorage.setItem(key,JSON.stringify({
                savedAt:Date.now(),
                pageSize:this.pageSize,
                items:this.list.slice(0,LIST_CACHE_MAX)
            }));
        }
        catch(error) {}
    }

    /**
     * 拉取第一页。
     * merge 为 true 时把第一页合并进已加载的后续页（实时更新、已读回刷、切页回来），
     * 否则重置为第 1 页（首次进入、下拉刷新、重试）。
     */
    private LoadFirstPageMode(showLoading:boolean,merge:boolean):void
    {
        if(this.loadingFirst)
            return;
        let serial = ++this.listRequestSerial;
        this.moreRequestSerial++;
        this.loadingFirst = true;
        this.loadingMore = false;
        if(showLoading)
            this.ShowLoading();
        let requestStartedAt = Date.now();
        this.manager.LoadAllConversations(1).then((page)=>{
            if(serial !== this.listRequestSerial || !cc.isValid(this.node))
                return;
            this.loadingFirst = false;
            this.refreshing = false;
            this.HidePullTip();
            if(!merge)
                Debug.Log("消息列表第一页耗时 " + (Date.now() - requestStartedAt) + "ms");
            if(merge)
                this.MergeFirstPage(page.items,page.hasMore,page.pageSize);
            else
                this.ApplyFirstPage(page);
        }).catch((error:any)=>{
            if(serial !== this.listRequestSerial)
                return;
            this.loadingFirst = false;
            this.refreshing = false;
            this.loadingMore = false;
            this.HidePullTip();
            if(merge || this.list.length > 0)
            {
                this.ShowToast(this.ErrorText(error));
                this.UpdateBottomTip();
            }
            else
                this.ShowError(this.ErrorText(error));
        });
    }

    /** 已读回刷、切页回来使用的轻量刷新，合并短时间内的重复请求。 */
    private ScheduleSilentRefresh():void
    {
        if(this.loadingFirst || this.refreshing || this.silentRefreshScheduled)
            return;
        this.silentRefreshScheduled = true;
        this.scheduleOnce(()=>{
            this.silentRefreshScheduled = false;
            if(!cc.isValid(this.node) || !this.started || !this.node.activeInHierarchy)
                return;
            this.LoadFirstPageMode(false,true);
        },0.2);
    }

    /** 实时推送触发的全局会话首页；只合并，不重置分页和滚动。 */
    private OnServerConversations(page:any):void
    {
        if(!this.started || page == null || !cc.isValid(this.node))
            return;
        if(page.page !== 1 || !this.node.activeInHierarchy)
            return;
        if(this.loadingFirst || this.refreshing)
            return;
        this.MergeFirstPage(page.items,page.hasMore,page.pageSize);
    }

    private ApplyFirstPage(page:any):void
    {
        this.list = page.items == null ? [] : page.items.slice(0);
        this.page = 1;
        this.pageSize = page.pageSize > 0 ? Number(page.pageSize) : PAGE_SIZE;
        this.hasMore = page.hasMore === true;
        this.RenderFull(true,0);
        this.SaveCachedList();
        this.CheckFillViewport();
    }

    /**
     * 把第一页合并进当前列表：第一页负责最新排序，已加载的后续页按原顺序保留，
     * 行数不变时只更新文案/红点，避免每条实时消息都整表重建。
     */
    private MergeFirstPage(items:DirectConversation[],hasMore:boolean,pageSize:number):void
    {
        let incoming = items == null ? [] : items;
        let incomingKeys:any = {};
        for(let item of incoming)
            incomingKeys[this.ConversationKey(item)] = true;

        let merged:DirectConversation[] = incoming.slice(0);
        for(let old of this.list)
        {
            if(incomingKeys[this.ConversationKey(old)] === true)
                continue;
            merged.push(old);
        }

        let addedAtTop = merged.length - this.list.length;
        this.list = merged;
        if(pageSize > 0)
            this.pageSize = Number(pageSize);
        // 已经加载到第 2 页以后时，不能用第一页的 hasMore 覆盖真实剩余页状态。
        if(this.page <= 1)
        {
            this.page = 1;
            this.hasMore = hasMore === true;
        }

        if(this.loadingNode != null)
            this.loadingNode.active = false;
        if(this.errorNode != null)
            this.errorNode.active = false;
        if(this.emptyNode != null)
            this.emptyNode.active = false;

        if(this.list.length === 0)
        {
            this.RenderFull(false,0);
            return;
        }

        // 行数不变时复用现有节点只重排/重绑数据，滚动位置不受影响。
        if(this.items.length === this.list.length)
        {
            let itemHeight = this.ItemHeight();
            for(let i = 0;i < this.list.length;i++)
            {
                this.items[i].y = -itemHeight / 2 - i * itemHeight;
                this.RenderItem(this.items[i],this.list[i]);
            }
            this.UpdateBottomTip();
            return;
        }

        this.RenderFull(false,Math.max(0,addedAtTop));
        this.CheckFillViewport();
    }

    private ConversationKey(item:DirectConversation):string
    {
        let conversationId = item == null ? "" : String(item.conversationId || "");
        if(conversationId !== "")
            return String(item.clubId || "") + "|" + conversationId;
        let peer = item == null || item.peer == null ? "" : String(item.peer.guuid || "");
        return String(item == null ? "" : item.clubId || "") + "|peer|" + peer;
    }

    private HasConversation(item:DirectConversation):boolean
    {
        let key = this.ConversationKey(item);
        for(let one of this.list)
        {
            if(this.ConversationKey(one) === key)
                return true;
        }
        return false;
    }

    /** 追加下一页；失败只提示，不打断已经加载的内容。 */
    private LoadNextPage():void
    {
        if(!this.hasMore || this.loadingMore || this.loadingFirst || this.refreshing)
            return;
        let token = ++this.moreRequestSerial;
        this.loadingMore = true;
        this.UpdateBottomTip();
        let nextPage = this.page + 1;
        this.manager.LoadAllConversations(nextPage).then((result)=>{
            if(token !== this.moreRequestSerial || !cc.isValid(this.node))
                return;
            this.loadingMore = false;
            this.page = result.page > 0 ? Number(result.page) : nextPage;
            if(result.pageSize > 0)
                this.pageSize = Number(result.pageSize);
            let additions = 0;
            for(let item of result.items)
            {
                if(this.HasConversation(item))
                    continue;
                this.list.push(item);
                additions++;
            }
            // 服务端按最新消息排序，翻页期间来的新会话会挤动分页；没有新增就停止继续请求。
            this.hasMore = result.hasMore === true && additions > 0;
            this.AppendRowsFrom(this.list.length - additions);
            this.UpdateBottomTip();
            this.CheckFillViewport();
        }).catch((error:any)=>{
            if(token !== this.moreRequestSerial)
                return;
            this.loadingMore = false;
            this.UpdateBottomTip();
            this.ShowToast(this.ErrorText(error));
        });
    }

    private CheckLoadMore():void
    {
        if(this.scroll == null || this.content == null)
            return;
        if(!this.hasMore || this.loadingMore || this.loadingFirst || this.refreshing)
            return;
        if(this.list.length === 0)
            return;
        let offset = Math.max(0,this.scroll.getScrollOffset().y);
        if(this.MaxScrollOffset() - offset < LOAD_MORE_DISTANCE)
            this.LoadNextPage();
    }

    /** 首页不足一屏时继续补页，避免长屏下只显示十几条就停住。 */
    private CheckFillViewport():void
    {
        if(this.scroll == null || this.content == null)
            return;
        if(!this.hasMore || this.loadingMore || this.loadingFirst || this.refreshing)
            return;
        if(this.list.length === 0)
            return;
        if(this.content.height <= this.ViewHeight() + 1)
            this.LoadNextPage();
    }

    private OnScrolling():void
    {
        this.UpdatePullTip();
        this.CheckLoadMore();
        this.UpdateBottomTip();
    }

    // ================= 下拉刷新 =================

    /** 下拉位移由 ScrollView 自己完成，这里只按负向偏移显示提示并记录最大下拉量。 */
    private UpdatePullTip():void
    {
        if(this.scroll == null)
            return;
        let offset = this.scroll.getScrollOffset().y;
        let previous = this.lastScrollOffset;
        this.lastScrollOffset = offset;
        if(this.refreshing || this.loadingFirst)
            return;
        if(offset >= 0)
        {
            this.pullOffset = 0;
            this.HidePullTip();
            return;
        }
        // 回弹阶段 offset 在变大，不再显示“可刷新”，避免松手后又闪一次提示。
        if(offset > previous + 0.5)
        {
            this.pullOffset = 0;
            this.HidePullTip();
            return;
        }
        if(offset < this.pullOffset)
            this.pullOffset = offset;
        if(offset < -PULL_REFRESH_DISTANCE)
            this.ShowPullTip("松开刷新");
        else if(offset < -8)
            this.ShowPullTip("下拉刷新");
    }

    /** 与大厅房间列表相同的刷新入口：拉过顶部松手（bounce-top）即刷新第一页。 */
    private OnBounceTop():void
    {
        let pulled = -this.pullOffset;
        this.pullOffset = 0;
        if(pulled < PULL_REFRESH_DISTANCE)
        {
            this.HidePullTip();
            return;
        }
        this.RefreshFromTop();
    }

    private OnScrollEnded():void
    {
        if(this.refreshing)
            return;
        this.pullOffset = 0;
        this.HidePullTip();
    }

    /** 与下拉松手共用：大厅底栏「消息」按钮每次点击也走这里，重取第一页并回到顶部。 */
    public RefreshFromTop():void
    {
        if(this.manager == null || this.refreshing || this.loadingFirst || this.manager.CurrentGuuid() === "")
            return;
        this.refreshing = true;
        this.ShowPullTip("刷新中…");
        this.LoadFirstPageMode(false,false);
    }

    private ShowPullTip(text:string):void
    {
        if(this.pullTipNode == null)
            return;
        this.pullTipNode.active = true;
        if(this.pullTipLabel != null)
            this.pullTipLabel.string = text;
    }

    private HidePullTip():void
    {
        if(this.pullTipNode != null)
            this.pullTipNode.active = false;
    }

    private UpdateBottomTip():void
    {
        if(this.bottomTipNode == null)
            return;
        if(this.loadingMore)
        {
            this.bottomTipNode.active = true;
            if(this.bottomTipLabel != null)
                this.bottomTipLabel.string = "加载中…";
            return;
        }
        if(!this.hasMore && !this.loadingFirst && !this.refreshing &&
            this.list.length > 0 && this.list.length >= this.pageSize)
        {
            // 只有滚到底部附近才显示“没有更多了”，避免常驻遮住最后一行。
            if(this.scroll != null)
            {
                let offset = Math.max(0,this.scroll.getScrollOffset().y);
                if(this.MaxScrollOffset() - offset > 80)
                {
                    this.bottomTipNode.active = false;
                    return;
                }
            }
            this.bottomTipNode.active = true;
            if(this.bottomTipLabel != null)
                this.bottomTipLabel.string = "没有更多了";
            return;
        }
        this.bottomTipNode.active = false;
    }

    private ErrorText(error:any):string
    {
        if(error instanceof DirectChatError && error.code === "DIRECT_SERVICE_UNAVAILABLE")
            return "聊天服务尚未开通（服务端未更新），请联系管理员";
        if(error instanceof DirectChatError && error.status === 404)
            return "聊天服务尚未开通（服务端未更新），请联系管理员";
        if(error instanceof DirectChatError && error.code === "NOT_CLUB_MEMBER")
            return "你已不在该俱乐部，当前聊天不可用";
        if(error instanceof DirectChatError && error.code === "DIRECT_AUTH_REQUIRED")
            return "聊天登录已失效，请重新进入游戏";
        return error != null && error.message != null ? String(error.message) : "网络异常，请稍后重试";
    }

    private ShowToast(text:string):void
    {
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Top,text);
    }

    // ================= 渲染 =================

    private ShowLoading():void
    {
        if(this.loadingNode != null)
            this.loadingNode.active = true;
        if(this.emptyNode != null)
            this.emptyNode.active = false;
        if(this.errorNode != null)
            this.errorNode.active = false;
        if(this.bottomTipNode != null)
            this.bottomTipNode.active = false;
    }

    private ShowEmpty(text:string):void
    {
        if(this.loadingNode != null)
            this.loadingNode.active = false;
        if(this.errorNode != null)
            this.errorNode.active = false;
        if(this.emptyNode != null)
        {
            this.emptyNode.active = true;
            let label = this.emptyNode.getComponent(cc.Label);
            if(label == null)
                label = Tool.GetChild(this.emptyNode,"文案") != null ?
                    Tool.GetChild(this.emptyNode,"文案").getComponent(cc.Label) : null;
            if(label != null)
                label.string = text;
        }
    }

    private ShowError(text:string):void
    {
        if(this.loadingNode != null)
            this.loadingNode.active = false;
        if(this.emptyNode != null)
            this.emptyNode.active = false;
        if(this.errorNode != null)
        {
            this.errorNode.active = true;
            if(this.errorLabel != null)
                this.errorLabel.string = text;
        }
        this.ClearItems();
        if(this.content != null)
        {
            let viewNode = this.scroll == null ? null : this.scroll.node.getChildByName("view");
            if(viewNode != null)
            {
                this.AlignContentToViewTop(viewNode);
                this.content.height = Math.max(1,viewNode.height + 1);
            }
        }
        this.RestoreScrollOffset(0);
        this.UpdateBottomTip();
    }

    private ClearItems():void
    {
        for(let node of this.items)
        {
            if(cc.isValid(node))
                node.destroy();
        }
        this.items = [];
    }

    /**
     * 维护动态列表的几何关系：content 顶部锚点、宽度跟随 view，停用会把动态高度
     * 压回固定稿尺寸的 Widget。这里只调整尺寸，纵向位置在重绘时按是否位于顶部决定。
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
    }

    private AlignContentToViewTop(viewNode:cc.Node):void
    {
        this.content.y = viewNode.height * (1 - viewNode.anchorY);
    }

    private ItemHeight():number
    {
        return this.itemTemplate == null ? 118 : Math.max(96,this.itemTemplate.height);
    }

    private AppendRow(index:number,itemHeight:number):void
    {
        if(this.itemTemplate == null || this.content == null || index < 0 || index >= this.list.length)
            return;
        let node = cc.instantiate(this.itemTemplate);
        node.parent = this.content;
        node.active = true;
        node.x = 0;
        node.anchorX = 0.5;
        node.anchorY = 0.5;
        node.y = -itemHeight / 2 - index * itemHeight;
        this.RenderItem(node,this.list[index]);
        this.items.push(node);
    }

    /** 分页追加只创建新增行，已渲染的节点和高亮状态保持不变。 */
    private AppendRowsFrom(fromIndex:number):void
    {
        if(this.content == null || this.itemTemplate == null)
            return;
        let itemHeight = this.ItemHeight();
        for(let i = Math.max(0,fromIndex);i < this.list.length;i++)
            this.AppendRow(i,itemHeight);
        this.content.height = Math.max(itemHeight,itemHeight * this.list.length,this.ViewHeight() + 1);
    }

    /**
     * 整表重绘。insertedAtTop 用于合并第一页后插入新会话时补偿滚动位置，
     * 让用户正在看的行留在原位；位于顶部时仍然回到顶部。
     */
    private RenderFull(scrollToTop:boolean,insertedAtTop:number):void
    {
        if(this.loadingNode != null)
            this.loadingNode.active = false;
        if(this.errorNode != null)
            this.errorNode.active = false;
        if(this.itemTemplate == null || this.content == null)
            return;
        let viewNode = this.scroll == null ? null : this.scroll.node.getChildByName("view");
        let oldOffset = this.scroll == null ? 0 : Math.max(0,this.scroll.getScrollOffset().y);
        this.PrepareScrollLayout();
        this.ClearItems();
        let itemHeight = this.ItemHeight();
        if(this.list.length === 0)
        {
            this.ShowEmpty("暂时没有聊天记录");
            if(viewNode != null)
            {
                if(scrollToTop || oldOffset <= 2)
                    this.AlignContentToViewTop(viewNode);
                this.content.height = Math.max(1,viewNode.height + 1);
            }
            this.RestoreScrollOffset(0);
            this.UpdateBottomTip();
            return;
        }
        if(this.emptyNode != null)
            this.emptyNode.active = false;
        if(viewNode != null && (scrollToTop || oldOffset <= 2))
            this.AlignContentToViewTop(viewNode);
        // 与房间列表一致：content 至少比 view 高 1px，短列表也能进入 ScrollView 的
        // 弹性拖动/回弹流程，否则不足一屏时位移会被钳成 0。
        let viewHeight = viewNode == null ? 0 : viewNode.height;
        this.content.height = Math.max(itemHeight,itemHeight * this.list.length,viewHeight + 1);
        for(let i = 0;i < this.list.length;i++)
            this.AppendRow(i,itemHeight);
        this.RestoreScrollOffset(scrollToTop ? 0 : oldOffset + Math.max(0,insertedAtTop) * itemHeight);
        this.UpdateBottomTip();
    }

    private RestoreScrollOffset(offset:number):void
    {
        if(this.scroll == null)
            return;
        // content.height 刚更新的同一帧 ScrollView 边界可能还没刷新，延后一帧再定位。
        this.scheduleOnce(()=>{
            if(this.scroll == null || !cc.isValid(this.node))
                return;
            this.PrepareScrollLayout();
            let max = this.MaxScrollOffset();
            let target = Math.max(0,Math.min(max,offset));
            this.scroll.stopAutoScroll();
            this.scroll.scrollToOffset(cc.v2(0,target),0,false);
        },0);
    }

    private MaxScrollOffset():number
    {
        if(this.scroll == null || this.content == null)
            return 0;
        let max = this.scroll.getMaxScrollOffset != null ? this.scroll.getMaxScrollOffset().y : 0;
        if(max == null || isNaN(max))
            return Math.max(0,this.content.height - this.ViewHeight());
        return Math.max(0,max);
    }

    private ViewHeight():number
    {
        if(this.scroll == null)
            return 0;
        let viewNode = this.scroll.node.getChildByName("view");
        return viewNode == null ? this.scroll.node.height : viewNode.height;
    }

    private RenderItem(node:cc.Node,item:DirectConversation):void
    {
        let nameLabel = Tool.GetChild(node,"昵称") != null ? Tool.GetChild(node,"昵称").getComponent(cc.Label) : null;
        if(nameLabel != null)
        {
            let name = item.peer.name;
            if(item.peer.note != null && item.peer.note !== "")
                name += "（" + item.peer.note + "）";
            if(item.clubName !== "") {
                name += " [" + item.clubName + "]";
                // 俱乐部名称后明确标识老板/大群主，避免玩家只看到名字而不知道对方身份。
                let peerRole = item.peer == null ? "" : String(item.peer.role || "");
                if(peerRole === "owner" || peerRole === "union_owner")
                    name += "（" + DirectChatManager.RoleName(peerRole) + "）";
            }
            nameLabel.string = name;
        }

        let previewLabel = Tool.GetChild(node,"预览") != null ? Tool.GetChild(node,"预览").getComponent(cc.Label) : null;
        if(previewLabel != null)
        {
            previewLabel.string = this.PreviewText(item);
            // 预览是单行摘要。Prefab 中该 Label 原本是自动宽度，长文本会把右侧
            // 时间挤出卡片；这里只约束运行时实例的摘要区域，不改用户手动调整的 Prefab。
            previewLabel.enableWrapText = false;
            previewLabel.overflow = cc.Label.Overflow.CLAMP;
            let previewNode = previewLabel.node;
            let timeNode = Tool.GetChild(node,"时间");
            let left = previewNode.x - previewNode.anchorX * previewNode.width;
            let right = node.width * 0.5 - 16;
            if(timeNode != null)
                right = timeNode.x - timeNode.anchorX * timeNode.width - 16;
            previewNode.width = Math.max(96,right - left);
        }

        let timeLabel = Tool.GetChild(node,"时间") != null ? Tool.GetChild(node,"时间").getComponent(cc.Label) : null;
        if(timeLabel != null)
            timeLabel.string = DirectChatTime.FormatListTime(item.lastMessageAt);

        let redNode = Tool.GetChild(node,"红点");
        if(redNode != null)
        {
            redNode.active = item.unread > 0;
            let countLabel = Tool.GetChild(redNode,"数量") != null ?
                Tool.GetChild(redNode,"数量").getComponent(cc.Label) : null;
            if(countLabel != null)
                countLabel.string = item.unread > 99 ? "99+" : item.unread.toString();
        }

        let avatarNode = Tool.GetChild(node,"头像");
        if(avatarNode != null)
        {
            let sprite = avatarNode.getComponent(cc.Sprite);
            if(sprite != null)
                ImageManager.getInstance().SetLocalAvatar(sprite,item.peer.avatar,item.peer.guuid);
        }

        let button = node.getComponent(cc.Button);
        if(button != null)
        {
            button.node.targetOff(this);
            button.node.on("click",()=>{ this.OpenChat(item); },this);
        }
    }

    private PreviewText(item:DirectConversation):string
    {
        if(item.isDefaultTarget && (item.lastMessage == null || item.lastMessage === ""))
            return "开始聊天";
        if(item.lastMessageType === "image")
            return "[图片]";
        if(item.lastMessageType === "voice")
            return "[语音]";
        if(item.lastMessage == null || item.lastMessage === "")
            return "开始聊天";
        let value = String(item.lastMessage).replace(/[\r\n]+/g," ");
        // 消息列表只显示摘要，完整内容进入聊天页查看；用字符数截断保证中英文
        // 和不同手机宽度下都不会把卡片撑破。
        let maxRunes = 20;
        let runes = Array.from(value);
        return runes.length > maxRunes ? runes.slice(0,maxRunes).join("") + "…" : value;
    }

    // ================= 交互 =================

    private OpenChat(item:DirectConversation):void
    {
        if(this.busy)
            return;
        let clubId = String(item.clubId || "").trim();
        if(clubId === "")
            return;
        this.busy = true;
        // 默认上级入口可能对应一条已被当前用户隐藏的历史会话，必须先走幂等恢复接口；
        // 普通列表项则直接进入已有会话。
        if(item.conversationId !== "" && !item.isDefaultTarget)
        {
            this.busy = false;
            UIManager.getInstance().showPanel("panelMessageChat",ShowPanelMode.Cover,
                JSON.stringify({clubId:clubId,conversationId:item.conversationId,peer:item.peer}));
            return;
        }
        // 默认入口没有真实会话：先创建/恢复，再进入详情。
        this.manager.OpenConversation(clubId,item.peer.guuid).then((conversation)=>{
            this.busy = false;
            UIManager.getInstance().showPanel("panelMessageChat",ShowPanelMode.Cover,
                JSON.stringify({clubId:clubId,conversationId:conversation.conversationId,peer:conversation.peer}));
            this.ScheduleSilentRefresh();
        }).catch((error:any)=>{
            this.busy = false;
            this.ShowToast(this.ErrorText(error));
        });
    }

    public onButtonClick(button:cc.Button):void
    {
        let name = button.node.name;
        if(name === "关闭" || name === "返回")
        {
            UIManager.getInstance().closePanelByName(this.node.name);
        }
        else if(name === "重试")
        {
            this.Refresh(true);
        }
        else if(name === "聊天托管")
        {
            this.ToggleHosting();
        }
        else
        {
            super.onButtonClick(button);
        }
    }

    // ================= 聊天托管 =================

    private LoadHostingStatus(force:boolean):void
    {
        if(this.manager.CurrentGuuid() === "")
        {
            if(this.hostingButton != null)
                this.hostingButton.active = false;
            return;
        }
        this.manager.HostingStatus(force).then((info)=>{
            this.ApplyHostingInfo(info);
        }).catch(()=>{
            // 服务端未更新或网络异常时不显示入口，避免给出无法使用的开关。
            if(this.hostingButton != null)
                this.hostingButton.active = false;
        });
    }

    private ApplyHostingInfo(info:DirectHostingInfo):void
    {
        this.hostingInfo = info;
        if(this.hostingButton != null)
            this.hostingButton.active = info != null && info.eligible;
        if(this.hostingLabel != null)
            this.hostingLabel.string = info != null && info.enabled ? "聊天托管：已开启" : "聊天托管：未开启";
    }

    private ToggleHosting():void
    {
        if(this.hostingBusy)
            return;
        if(this.hostingInfo == null || !this.hostingInfo.eligible)
        {
            this.ShowToast("只有俱乐部群主、盟主或大盟主可以开启聊天托管");
            return;
        }
        let enabled = !this.hostingInfo.enabled;
        let message = enabled ?
            "开启后，客服可以查看你收到的私聊消息并代你回复，确定开启吗？" :
            "关闭后客服将立即无法查看和回复你的私聊，确定关闭吗？";
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,message,[(confirmed:boolean)=>{
            if(!confirmed || this.hostingBusy)
                return;
            this.hostingBusy = true;
            this.manager.SetHosting(enabled).then((info)=>{
                this.hostingBusy = false;
                this.ApplyHostingInfo(info);
                this.ShowToast(info != null && info.enabled ? "聊天托管已开启" : "聊天托管已关闭");
            }).catch((error:any)=>{
                this.hostingBusy = false;
                this.ShowToast(this.ErrorText(error));
            });
        }]);
    }
}
