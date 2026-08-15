import UIPanelViewBase from "../common/UIPanelViewBase";
import GameDataManager from "../GameDataManager";
import UIManager from "../common/UIManager";
import { ClosePanelMode } from "../common/GameDef";
import Tool from "../common/Tool";
import ImageManager from "../logic/ImageManager";
import QueueMatchManager, { QueueMatchSnapshot } from "../logic/QueueMatchManager";
import PanelGameView from "./panelGameView";

var KBEngine = require("kbengine");

const {ccclass} = cc._decorator;

/**
 * 独立的顶层排队弹窗。界面与牌桌原排队弹窗保持一致，排队状态、服务器
 * 请求和跨房流程仍由常驻 QueueMatchManager 统一负责。
 */
@ccclass
export default class panelQueueMatch extends UIPanelViewBase {
    private queueStatusLabel:cc.Label = null;
    private queueActionLabel:cc.Label = null;
    private queueActionButton:cc.Button = null;
    private queueMemberRoot:cc.Node = null;
    private queueMemberTitle:cc.Node = null;
    private queueMemberContent:cc.Node = null;
    private queueMemberTemplate:cc.Node = null;
    private queueEmptyLabel:cc.Label = null;
    private queueMemberRows:cc.Node[] = [];
    private readonly queueListRefreshSeconds:number = 5;
    private referenceRoomID:number = 0;

    onLoad()
    {
        super.onLoad();

        this.queueStatusLabel = Tool.GetChild(this.node, "排队面板/排队状态").getComponent(cc.Label);
        this.queueMemberTitle = Tool.GetChild(this.node, "排队面板/人员标题");
        this.queueMemberRoot = Tool.GetChild(this.node, "排队面板/排队人员列表");
        this.queueMemberContent = Tool.GetChild(this.queueMemberRoot, "列表视口/列表内容");
        this.queueMemberTemplate = Tool.GetChild(this.queueMemberContent, "玩家行模板");
        let emptyNode = Tool.GetChild(this.queueMemberContent, "空状态");
        this.queueEmptyLabel = emptyNode == null ? null : emptyNode.getComponent(cc.Label);
        if(this.queueMemberTemplate != null)
            this.queueMemberTemplate.active = false;
        this.queueActionButton = Tool.GetChild(this.node, "排队面板/申请或取消排队").getComponent(cc.Button);
        this.queueActionLabel = Tool.GetChild(this.queueActionButton.node, "文字").getComponent(cc.Label);

        this.ResizeOverlay();
        KBEngine.Event.register("QueueMatchStateChanged", this, "OnQueueMatchStateChanged");
        KBEngine.Event.register("QueueMatchLeaveState", this, "OnQueueMatchLeaveState");

        let manager = QueueMatchManager.getInstance();
        this.OnQueueMatchStateChanged(manager.getSnapshot());
        let gameView = this.GetActiveGameView();
        if(gameView != null)
            this.referenceRoomID = gameView.GetQueueReferenceRoomID();
        if(gameView != null && gameView.IsPreparingQueueMatchAfterLeave())
            this.OnQueueMatchLeaveState(true, "正在退出当前房间，稍后自动申请排队…");
        let account = GameDataManager.getAccount();
        if(account != null)
        {
            if(this.referenceRoomID <= 0)
                this.referenceRoomID = Number(account.roomID);
            manager.requestQuery(false);
            manager.requestList(this.referenceRoomID);
        }
        this.StartListAutoRefresh();
    }

    onDestroy()
    {
        this.StopListAutoRefresh();
        super.onDestroy();
    }

    public onButtonClick(button:cc.Button)
    {
        if(button.node.name === "关闭排队")
        {
            UIManager.getInstance().closePanelByName(this.node.name, ClosePanelMode.Top);
        }
        else if(button.node.name === "申请或取消排队")
        {
            let manager = QueueMatchManager.getInstance();
            let snapshot = manager.getSnapshot();
            if(snapshot.queueActive)
                manager.requestCancel();
            else
            {
                let gameView = this.GetActiveGameView();
                if(gameView != null)
                    gameView.RequestQueueMatchFromPopup();
                else
                {
                    let account = GameDataManager.getAccount();
                    manager.requestApply(account == null ? 0 : account.roomID);
                }
            }
        }
    }

    private GetActiveGameView():PanelGameView
    {
        let scene = cc.director.getScene();
        if(scene == null || scene.name != "drh8")
            return null;
        return scene.getComponentInChildren(PanelGameView);
    }

    public OnQueueMatchLeaveState(preparing:boolean, message:string)
    {
        if(!cc.isValid(this.node))
            return;
        if(message != null && message != "")
            this.queueStatusLabel.string = message;
        this.queueActionButton.interactable = !preparing && !QueueMatchManager.getInstance().getSnapshot().busy;
    }

    private ResizeOverlay()
    {
        let visibleSize = cc.view.getVisibleSize();
        let width = Math.max(750, visibleSize.width + 20);
        let height = Math.max(1334, visibleSize.height + 20);
        let rootWidget = this.node.getComponent(cc.Widget);
        if(rootWidget != null)
            rootWidget.enabled = false;
        this.node.setContentSize(width, height);

        let mask = Tool.GetChild(this.node, "遮罩");
        if(mask != null)
        {
            let maskWidget = mask.getComponent(cc.Widget);
            if(maskWidget != null)
                maskWidget.enabled = false;
            mask.setContentSize(width, height);
            mask.setPosition(0, 0);
        }
    }

    private StartListAutoRefresh()
    {
        this.StopListAutoRefresh();
        this.schedule(this.OnListSecondTick, 1);
        this.schedule(this.OnListServerRefresh, this.queueListRefreshSeconds);
    }

    private StopListAutoRefresh()
    {
        this.unschedule(this.OnListSecondTick);
        this.unschedule(this.OnListServerRefresh);
    }

    private OnListSecondTick()
    {
        if(!cc.isValid(this.node) || !this.node.active)
            return;
        this.RefreshMemberTimes(QueueMatchManager.getInstance().getSnapshot());
    }

    private OnListServerRefresh()
    {
        if(!cc.isValid(this.node) || !this.node.active)
            return;
        let account = GameDataManager.getAccount();
        if(account != null)
            QueueMatchManager.getInstance().requestList(this.referenceRoomID, true);
    }

    private GetListElapsedSeconds(snapshot:QueueMatchSnapshot):number
    {
        if(snapshot == null || snapshot.listUpdatedAt <= 0)
            return 0;
        return Math.max(0, Math.floor((Date.now() - snapshot.listUpdatedAt) / 1000));
    }

    private FormatDuration(seconds:number):string
    {
        let total = Math.max(0, Math.floor(seconds));
        let minutes = Math.floor(total / 60);
        let remain = total % 60;
        return minutes.toString() + ":" + (remain < 10 ? "0" : "") + remain.toString();
    }

    private FormatMemberStatus(status:string):string
    {
        let value = status == null ? "" : status.toString().trim();
        let lower = value.toLowerCase();
        if(lower == "queued" || lower == "waiting")
            return "排队中";
        if(lower == "assigning" || lower == "matched" || lower == "seating")
            return "入座中";
        return value == "" ? "排队中" : value;
    }

    private RefreshMemberTimes(snapshot:QueueMatchSnapshot)
    {
        if(snapshot == null)
            return;
        let members = snapshot.members || [];
        let elapsedSeconds = this.GetListElapsedSeconds(snapshot);
        let count = Math.min(members.length, this.queueMemberRows.length);
        for(let index = 0; index < count; index++)
        {
            let row = this.queueMemberRows[index];
            if(row == null || !cc.isValid(row) || !row.active)
                continue;
            let timeNode = Tool.GetChild(row, "排队时长");
            if(timeNode != null)
                timeNode.getComponent(cc.Label).string =
                    this.FormatDuration(members[index].queueSeconds + elapsedSeconds);
        }
    }

    public OnQueueMatchStateChanged(snapshot:QueueMatchSnapshot)
    {
        if(snapshot == null || !cc.isValid(this.node))
            return;
        if(snapshot.status == "assigning" || snapshot.status == "switching" || snapshot.status == "pre_sitting")
        {
            UIManager.getInstance().closePanelByName(this.node.name, ClosePanelMode.Top);
            return;
        }

        let gameView = this.GetActiveGameView();
        let preparingRoomLeave = gameView != null && gameView.IsPreparingQueueMatchAfterLeave();
        let statusText = preparingRoomLeave ? "正在退出当前房间，稍后自动申请排队…" : "当前未申请排队";
        if(!preparingRoomLeave && snapshot.status == "applying")
            statusText = "正在申请排队…";
        else if(!preparingRoomLeave && snapshot.status == "cancelling")
            statusText = "正在取消排队…";
        else if(!preparingRoomLeave && snapshot.status == "queued")
        {
            statusText = "排队中";
            if(snapshot.queueCount > 0)
                statusText += "　当前人数：" + snapshot.queueCount.toString();
            if(snapshot.rank > 0)
                statusText += "　我的顺位：" + snapshot.rank.toString();
            if(snapshot.assignFailCount > 0)
                statusText += "　已重新匹配 " + snapshot.assignFailCount.toString() + " 次";
        }
        else if(!preparingRoomLeave && snapshot.status == "failed")
            statusText = snapshot.message == "" ? "排队失败，请重新申请" : snapshot.message;
        else if(!preparingRoomLeave && snapshot.message != "")
            statusText = snapshot.message;
        this.queueStatusLabel.string = statusText;

        this.queueActionLabel.string = snapshot.queueActive ? "取消排队" : "申请排队";
        this.queueActionButton.interactable = !snapshot.busy && !preparingRoomLeave;
        this.RefreshMemberList(snapshot);
    }

    private RefreshMemberList(snapshot:QueueMatchSnapshot)
    {
        if(this.queueMemberRoot == null || this.queueMemberTitle == null ||
            this.queueMemberContent == null || this.queueMemberTemplate == null || this.queueEmptyLabel == null)
            return;
        let members = snapshot.members || [];
        let elapsedSeconds = this.GetListElapsedSeconds(snapshot);
        this.queueMemberRoot.active = true;
        this.queueMemberTitle.active = true;
        let count = Math.max(snapshot.listCount || 0, members.length);
        let playerHeader = Tool.GetChild(this.queueMemberTitle, "玩家信息");
        if(playerHeader != null)
            playerHeader.getComponent(cc.Label).string = "玩家信息（" + count.toString() + "）";

        let emptyText = "";
        if(snapshot.listLoading)
            emptyText = "正在加载排队名单…";
        else if(snapshot.listMessage != "")
            emptyText = snapshot.listMessage;
        else if(members.length == 0)
            emptyText = "当前暂无排队玩家";
        this.queueEmptyLabel.string = emptyText;
        this.queueEmptyLabel.node.active = emptyText != "";

        while(this.queueMemberRows.length < members.length)
        {
            let row = cc.instantiate(this.queueMemberTemplate);
            row.name = "玩家行" + (this.queueMemberRows.length + 1).toString();
            row.parent = this.queueMemberContent;
            row.active = true;
            this.queueMemberRows.push(row);
        }

        const rowHeight = 106;
        for(let index = 0; index < this.queueMemberRows.length; index++)
        {
            let row = this.queueMemberRows[index];
            if(index >= members.length)
            {
                row.active = false;
                continue;
            }
            let member = members[index];
            row.active = true;
            row.setPosition(0, -index * rowHeight);

            let background = Tool.GetChild(row, "卡片背景");
            if(background != null)
            {
                background.color = member.isSelf ? cc.color(47, 126, 139) : cc.color(52, 84, 103);
                background.opacity = member.isSelf ? 255 : 235;
            }

            Tool.GetChild(row, "序号").getComponent(cc.Label).string =
                (member.rank > 0 ? member.rank : index + 1).toString();
            let avatar = Tool.GetChild(row, "玩家信息/头像/头像图片").getComponent(cc.Sprite);
            ImageManager.getInstance().SetLocalAvatar(avatar, member.photo, member.id);

            let nicknameLabel = Tool.GetChild(row, "玩家信息/昵称").getComponent(cc.Label);
            nicknameLabel.string = member.name + (member.isSelf ? "（我）" : "");
            nicknameLabel.node.color = member.isSelf ? cc.color(244, 216, 142) : cc.color(234, 230, 215);
            Tool.GetChild(row, "玩家信息/玩家ID").getComponent(cc.Label).string =
                member.id == "" ? "ID:--" : "ID:" + member.id;
            Tool.GetChild(row, "排队时长").getComponent(cc.Label).string =
                this.FormatDuration(member.queueSeconds + elapsedSeconds);
            Tool.GetChild(row, "底皮").getComponent(cc.Label).string = member.bottom == "" ? "--" : member.bottom;

            let statusLabel = Tool.GetChild(row, "状态").getComponent(cc.Label);
            statusLabel.string = this.FormatMemberStatus(member.status);
            statusLabel.node.color = statusLabel.string.indexOf("排队") >= 0 ?
                cc.color(93, 219, 169) : cc.color(232, 205, 139);

            let onlineNode = Tool.GetChild(row, "在线状态");
            if(onlineNode != null)
            {
                let onlineLabel = onlineNode.getComponent(cc.Label);
                onlineLabel.string = member.online == 1 ? "在线" : (member.online == 0 ? "离线" : "未知");
                onlineNode.color = member.online == 1 ? cc.color(93, 219, 169) :
                    (member.online == 0 ? cc.color(154, 183, 191) : cc.color(232, 205, 139));
            }
        }

        let viewHeight = this.queueMemberRoot.height;
        let contentHeight = Math.max(viewHeight, members.length * rowHeight);
        this.queueMemberContent.setContentSize(this.queueMemberRoot.width, contentHeight);
        let scrollView = this.queueMemberRoot.getComponent(cc.ScrollView);
        if(scrollView != null)
        {
            scrollView.stopAutoScroll();
            scrollView.scrollToTop(0);
        }
    }
}
