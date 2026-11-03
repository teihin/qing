import UIPanelViewBase from "../common/UIPanelViewBase";
import Tool from "../common/Tool";
import UIManager from "../common/UIManager";
import { ShowPanelMode } from "../common/GameDef";
import ImageManager from "../logic/ImageManager";
import DirectChatManager, { DirectChatError, DirectConversation } from "../logic/DirectChatManager";
import DirectChatTime from "../common/DirectChatTime";

const {ccclass} = cc._decorator;

/**
 * 消息首页：当前账号所有俱乐部的会话列表。
 *
 * 全部节点来自 panelMessage.prefab（设计文档 10.5.7），脚本只做数据绑定和显隐，
 * 不在运行时拼装美术节点；请求、长连接、未读汇总统一由 DirectChatManager 负责。
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

    private list:DirectConversation[] = [];
    private busy:boolean = false;
    private listRequestSerial:number = 0;

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

        this.onAllConversationsHandler = (page:any)=>{
            if(!this.started || page == null || !cc.isValid(this.node))
                return;
            // 实时事件已经拿到最新的全局会话页，直接渲染，避免重复请求。
            this.listRequestSerial++;
            this.list = page.items == null ? [] : page.items.slice(0);
            this.RenderList();
        };
        this.onConversationReadHandler = ()=>{
            // 已读会影响列表红点；先刷新一次列表，再由服务端未读摘要校正总数。
            this.LoadAllConversations(false);
        };
        this.manager.On("allConversations",this.onAllConversationsHandler);
        this.manager.On("conversationRead",this.onConversationReadHandler);
    }

    private started:boolean = false;

    start()
    {
        this.started = true;
        this.Refresh(true);
    }

    onEnable()
    {
        // 常驻在 Main 下，切页回来时重新拉一次，避免显示旧数据。
        if(this.started)
            this.Refresh(false);
    }

    onDestroy()
    {
        this.manager.Off("allConversations",this.onAllConversationsHandler);
        this.manager.Off("conversationRead",this.onConversationReadHandler);
        super.onDestroy();
    }

    private NodeOf(path:string):cc.Node
    {
        return Tool.GetChild(this.node,path);
    }

    // ================= 数据 =================

    /** 进入页面：拉取当前账号所有已加入俱乐部的会话列表。 */
    public Refresh(force:boolean = false):void
    {
        if(this.manager.CurrentGuuid() === "")
        {
            this.ShowError("请先登录游戏");
            return;
        }
        this.LoadAllConversations(true);
    }

    private LoadAllConversations(showLoading:boolean = true):void
    {
        let serial = ++this.listRequestSerial;
        if(showLoading)
            this.ShowLoading();
        this.manager.LoadAllConversations().then((page)=>{
            if(serial !== this.listRequestSerial || !cc.isValid(this.node))
                return;
            this.list = page.items;
            this.RenderList();
        }).catch((error:any)=>{
            if(serial === this.listRequestSerial)
                this.ShowError(this.ErrorText(error));
        });
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

    // ================= 渲染 =================

    private ShowLoading():void
    {
        if(this.loadingNode != null)
            this.loadingNode.active = true;
        if(this.emptyNode != null)
            this.emptyNode.active = false;
        if(this.errorNode != null)
            this.errorNode.active = false;
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

    private RenderList():void
    {
        if(this.loadingNode != null)
            this.loadingNode.active = false;
        if(this.errorNode != null)
            this.errorNode.active = false;
        if(this.itemTemplate == null || this.content == null)
            return;
        this.ClearItems();
        if(this.list.length === 0)
        {
            this.ShowEmpty("暂时没有聊天记录");
            return;
        }
        if(this.emptyNode != null)
            this.emptyNode.active = false;

        let itemHeight = Math.max(96,this.itemTemplate.height);
        // content 使用顶部锚点，位置跟随 ScrollView 的实际 view 高度；不依赖
        // 1334 设计稿里的固定 y，长屏和短屏都从可视区域顶部开始排列。
        let viewNode = this.scroll == null ? null : this.scroll.node.getChildByName("view");
        if(viewNode != null)
        {
            this.content.anchorX = 0.5;
            this.content.anchorY = 1;
            this.content.x = 0;
            this.content.y = viewNode.height * (1 - viewNode.anchorY);
        }
        for(let i = 0;i < this.list.length;i++)
        {
            let node = cc.instantiate(this.itemTemplate);
            node.parent = this.content;
            node.active = true;
            node.x = 0;
            node.anchorX = 0.5;
            node.anchorY = 0.5;
            node.y = -itemHeight / 2 - i * itemHeight;
            this.RenderItem(node,this.list[i]);
            this.items.push(node);
        }
        // 高度只改自身；纵向位置由 Prefab 里的 Widget(TOP) 负责，脚本不要再写 y。
        this.content.height = Math.max(itemHeight,itemHeight * this.list.length);
        if(this.scroll != null)
        {
            // 新消息在第一位，进入页面默认展示最新会话。
            this.scroll.scrollToTop(0);
        }
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
            this.LoadAllConversations(false);
        }).catch((error:any)=>{
            this.busy = false;
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Top,this.ErrorText(error));
        });
    }

    public onButtonClick(button:cc.Button)
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
        else
        {
            super.onButtonClick(button);
        }
    }
}
