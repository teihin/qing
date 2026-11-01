import UIPanelViewBase from "../common/UIPanelViewBase";
import Tool from "../common/Tool";
import UIManager from "../common/UIManager";
import { ShowPanelMode } from "../common/GameDef";
import ImageManager from "../logic/ImageManager";
import DirectChatManager, { DirectChatError, DirectConversation, DirectMember } from "../logic/DirectChatManager";

const {ccclass, property} = cc._decorator;

/**
 * 成员选择页：只展示当前俱乐部成员。
 *
 * 「聊天」按钮只在服务端返回 canChat=true 时显示（群主/盟主/代理），
 * 点击后调用创建/获取会话接口再进入详情；该按钮不负责删除（设计文档 10.3）。
 */
@ccclass
export default class panelMessageMembers extends UIPanelViewBase {

    private manager:DirectChatManager = null;
    private clubId:string = "";
    private scroll:cc.ScrollView = null;
    private content:cc.Node = null;
    private template:cc.Node = null;
    private items:cc.Node[] = [];
    private editBox:cc.EditBox = null;

    private loadingNode:cc.Node = null;
    private emptyNode:cc.Node = null;
    private errorNode:cc.Node = null;
    private errorLabel:cc.Label = null;

    private page:number = 1;
    private hasMore:boolean = false;
    private keyword:string = "";
    private loading:boolean = false;
    private opening:boolean = false;
    private members:DirectMember[] = [];

    onLoad()
    {
        super.onLoad();
        this.manager = DirectChatManager.GetInstance();
        this.clubId = this.strUserData == null ? "" : String(this.strUserData).trim();
        if(this.clubId === "")
            this.clubId = this.manager.CurrentClubId();

        let scrollNode = Tool.GetChild(this.node,"列表");
        this.scroll = scrollNode == null ? null : scrollNode.getComponent(cc.ScrollView);
        this.content = Tool.GetChild(this.node,"列表/view/content");
        this.template = Tool.GetChild(this.node,"列表/view/content/成员项");
        if(this.template != null)
            this.template.active = false;

        let editNode = Tool.GetChild(this.node,"搜索");
        this.editBox = editNode == null ? null : editNode.getComponent(cc.EditBox);
        if(this.editBox != null)
        {
            this.editBox.string = "";
            this.editBox.node.on("editing-did-ended",()=>{ this.Search(this.editBox.string); },this);
        }

        this.loadingNode = Tool.GetChild(this.node,"加载");
        this.emptyNode = Tool.GetChild(this.node,"空态");
        this.errorNode = Tool.GetChild(this.node,"错误");
        let errorLabelNode = Tool.GetChild(this.node,"错误/文案");
        this.errorLabel = errorLabelNode == null ? null : errorLabelNode.getComponent(cc.Label);

        if(this.scroll != null)
            this.scroll.node.on("scroll-to-bottom",()=>{ this.LoadMore(); },this);
    }

    start()
    {
        let title = Tool.GetChild(this.node,"标题");
        if(title != null)
        {
            let label = title.getComponent(cc.Label);
            if(label != null)
            {
                let club = this.manager.CurrentClub();
                label.string = club == null ? "选择聊天对象" : "选择聊天对象 · " + club.clubName;
            }
        }
        this.Reload();
    }

    private Reload():void
    {
        this.page = 1;
        this.members = [];
        this.Load();
    }

    private Search(keyword:string):void
    {
        this.keyword = keyword == null ? "" : String(keyword).trim();
        this.Reload();
    }

    private LoadMore():void
    {
        if(!this.hasMore || this.loading)
            return;
        this.page++;
        this.Load();
    }

    private Load():void
    {
        if(this.clubId === "")
        {
            this.ShowError("当前账号还没有俱乐部");
            return;
        }
        this.loading = true;
        this.ShowLoading();
        this.manager.LoadMembers(this.clubId,this.keyword,this.page).then((page)=>{
            this.loading = false;
            if(this.page === 1)
                this.members = [];
            for(let member of page.items)
                this.members.push(member);
            this.hasMore = page.hasMore;
            this.Render();
        }).catch((error:any)=>{
            this.loading = false;
            this.ShowError(this.ErrorText(error));
        });
    }

    private ErrorText(error:any):string
    {
        if(error instanceof DirectChatError && error.code === "NOT_CLUB_MEMBER")
            return "你已不在该俱乐部";
        if(error instanceof DirectChatError && error.code === "DIRECT_RELATION_UNAVAILABLE")
            return "俱乐部关系服务暂时不可用，请稍后重试";
        return error != null && error.message != null ? String(error.message) : "网络异常，请稍后重试";
    }

    private ShowLoading():void
    {
        if(this.loadingNode != null)
            this.loadingNode.active = this.members.length === 0;
        if(this.emptyNode != null)
            this.emptyNode.active = false;
        if(this.errorNode != null)
            this.errorNode.active = false;
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

    private Render():void
    {
        if(this.loadingNode != null)
            this.loadingNode.active = false;
        if(this.errorNode != null)
            this.errorNode.active = false;
        this.ClearItems();
        if(this.members.length === 0)
        {
            if(this.emptyNode != null)
            {
                this.emptyNode.active = true;
                let label = this.emptyNode.getComponent(cc.Label);
                if(label != null)
                    label.string = this.keyword === "" ? "该俱乐部暂时没有其他成员" : "没有找到匹配的成员";
            }
            return;
        }
        if(this.emptyNode != null)
            this.emptyNode.active = false;
        if(this.template == null || this.content == null)
            return;

        let height = Math.max(96,this.template.height);
        for(let i = 0;i < this.members.length;i++)
        {
            let node = cc.instantiate(this.template);
            node.parent = this.content;
            node.active = true;
            node.y = -height / 2 - i * height;
            this.RenderItem(node,this.members[i]);
            this.items.push(node);
        }
        // 高度只改自身；纵向位置由 Widget(TOP) 负责。
        this.content.height = Math.max(height,height * this.members.length);
    }

    private RenderItem(node:cc.Node,member:DirectMember):void
    {
        let nameLabel = Tool.GetChild(node,"昵称");
        if(nameLabel != null)
        {
            let label = nameLabel.getComponent(cc.Label);
            if(label != null)
                label.string = member.note == null || member.note === "" ? member.name :
                    member.name + "（" + member.note + "）";
        }
        let idLabel = Tool.GetChild(node,"编号");
        if(idLabel != null)
        {
            let label = idLabel.getComponent(cc.Label);
            if(label != null)
                label.string = member.guuid;
        }
        let roleLabel = Tool.GetChild(node,"角色");
        if(roleLabel != null)
        {
            let label = roleLabel.getComponent(cc.Label);
            if(label != null)
                label.string = DirectChatManager.RoleName(member.role);
        }
        let onlineNode = Tool.GetChild(node,"在线");
        if(onlineNode != null)
        {
            onlineNode.active = true;
            let label = onlineNode.getComponent(cc.Label);
            if(label != null)
                label.string = member.online ? "在线" : "离线";
        }
        let avatarNode = Tool.GetChild(node,"头像");
        if(avatarNode != null)
        {
            let sprite = avatarNode.getComponent(cc.Sprite);
            if(sprite != null)
                ImageManager.getInstance().SetLocalAvatar(sprite,member.avatar,member.guuid);
        }
        let chatButton = Tool.GetChild(node,"聊天");
        if(chatButton != null)
        {
            // 在线状态只做展示，不作为发送门禁；按钮只看服务端下发的 canChat。
            chatButton.active = member.canChat;
            if(member.canChat)
            {
                let button = chatButton.getComponent(cc.Button);
                if(button != null)
                {
                    button.node.targetOff(this);
                    button.node.on("click",()=>{ this.StartChat(member); },this);
                }
            }
        }
        let rowButton = node.getComponent(cc.Button);
        if(rowButton != null)
        {
            rowButton.node.targetOff(this);
            rowButton.node.on("click",()=>{
                if(member.canChat)
                    this.StartChat(member);
            },this);
        }
    }

    private StartChat(member:DirectMember):void
    {
        if(this.opening || this.clubId === "")
            return;
        this.opening = true;
        this.manager.OpenConversation(this.clubId,member.guuid).then((conversation:DirectConversation)=>{
            this.opening = false;
            // 会话列表已因新会话/恢复被置为失效，返回时重新拉取。
            this.manager.InvalidateConversations(this.clubId);
            UIManager.getInstance().showPanel("panelMessageChat",ShowPanelMode.Cover,
                JSON.stringify({clubId:this.clubId,conversationId:conversation.conversationId,peer:conversation.peer}));
        }).catch((error:any)=>{
            this.opening = false;
            let text = error instanceof DirectChatError && error.code === "PEER_NOT_CLUB_MEMBER" ?
                "对方已退出该俱乐部" : this.ErrorText(error);
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Top,text);
        });
    }

    public onButtonClick(button:cc.Button)
    {
        let name = button.node.name;
        if(name === "关闭" || name === "返回")
            UIManager.getInstance().closePanelByName(this.node.name);
        else if(name === "搜索" || name === "搜索按钮")
            this.Search(this.editBox == null ? "" : this.editBox.string);
        else if(name === "重试")
            this.Reload();
        else if(name === "清空搜索")
        {
            if(this.editBox != null)
                this.editBox.string = "";
            this.Search("");
        }
        else
            super.onButtonClick(button);
    }
}
