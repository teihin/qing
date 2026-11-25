import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import { ShowPanelMode } from "../common/GameDef";
import GameDataManager from "../GameDataManager";
import Tool from "../common/Tool";
import DrhLogicMgr from "../logic/DrhLogicMgr";
import panelPlayerPicker from "./panelPlayerPicker";
import { resolveMyRoomClubId, resolveRoomSettingClubId } from "../logic/RoomClubContext";

var KBEngine = require("kbengine");

const {ccclass} = cc._decorator;

/**
 * 胜率目标列表一行：对应《胜率目标控制-客户端与后台接口文档》§3.2 list[]。
 * progress 允许为负；target_value 正=让玩家赢，负=让玩家输。
 * 剩余值不直接用服务端 remain（= |目标| - |进度|，异号时偏小），由 FillRow 按方向重算。
 */
interface OptimizeRow {
    /** 历史记录 ID，仅 history=1 时下发；当前目标为空。 */
    id:string;
    guuid:string;
    name:string;
    state:string;
    targetValue:number;
    chance:number;
    progress:number;
    roundCount:number;
    peerCount:number;
    groupName:string;
    online:boolean;
    curChance:number;
    curCount:number;
    setTime:string;
    finishTime:string;
    finishReason:string;
}

/**
 * 牌桌内 BOSS「牌局优化」全屏面板。
 * 当前只实现第一个页签「运维优化」：上方设置个人/分组的优化概率与目标金额，
 * 下方展示已配置目标及达成情况（列表轮询，服务端不推送进度）。
 *
 * 服务端接口（全部走 reqHallCommand）：
 *   异步_设置_胜率目标 / 异步_查询_胜率目标_列表 / 异步_停止_胜率目标
 * 分组选择复用 查询_俱乐部_分组列表（推送 ClubPlayerGroupList）。
 * 列表区勾选「只看当前房间」后查询带 room_id（按查询时实时所在房间过滤），默认不勾。
 */
@ccclass
export default class panelGameOptimize extends UIPanelViewBase {

    private static serial:number = 0;

    public static Open():void {
        UIManager.getInstance().showPanel("panelGameOptimize", ShowPanelMode.Cover);
    }

    private static readonly LIST_HEADER:string = "异步_查询_胜率目标_列表";
    private static readonly SET_HEADER:string = "异步_设置_胜率目标";
    private static readonly STOP_HEADER:string = "异步_停止_胜率目标";
    private static readonly GROUP_HEADER:string = "查询_俱乐部_分组列表";
    private static readonly POLL_SECONDS:number = 10;

    private mode:string = "player";          // player / group
    private direction:number = 1;            // 1=赢，-1=输
    private filter:string = "";              // ""=全部 / active / done / stopped
    /** 默认查当前目标；点「历史」才查 usr_opt_target_history 快照。 */
    private historyMode:boolean = false;
    /** 勾选「只看当前房间」：查询带 room_id，服务端按查询时实时所在房间过滤（历史表没有房间列）。 */
    private roomOnly:boolean = false;
    private roomToggle:cc.Toggle = null;
    /** 代码里改勾选状态时置位，避免 toggle 回调重入。 */
    private roomSyncing:boolean = false;
    private listPage:number = 0;
    private readonly pageSize:number = 20;
    private listTotal:number = 0;

    private selectedPlayerId:string = "";
    private selectedPlayerName:string = "";
    private selectedGroupId:number = 0;
    private selectedGroupName:string = "";

    private listBusy:boolean = false;
    /** 本次列表请求回包后是否滚回顶部（切筛选/翻页要回顶，轮询刷新不能动用户位置）。 */
    private listScrollTop:boolean = false;
    private listContext:string = "";
    private listTimer:any = null;
    private listLoadingShown:boolean = false;

    private setBusy:boolean = false;
    private setContext:string = "";
    private setTimer:any = null;

    private stopContext:string = "";
    private stopTimer:any = null;

    private rowTemplate:cc.Node = null;
    private rowContent:cc.Node = null;
    private listScroll:cc.ScrollView = null;

    onLoad () {
        super.onLoad();
        KBEngine.Event.register("onHallCommand", this, "OnHallCommand");
    }

    start () {
        // 入口口径与电量三连击一致：当前俱乐部的管理员；服务端仍按自己的名单鉴权。
        if(!GameDataManager.IsCurrentClubAdmin()) {
            this.ShowStatus("当前账号没有牌局优化权限", true);
            UIManager.getInstance().closePanelByName(this.node.name);
            return;
        }

        const content = this.At("列表区/列表/view/content");
        this.listScroll = this.At("列表区/列表") != null ?
            this.At("列表区/列表").getComponent(cc.ScrollView) : null;
        if(content != null) {
            this.rowContent = content;
            this.rowTemplate = content.getChildByName("行模板");
            if(this.rowTemplate != null)
                this.rowTemplate.active = false;
        }
        // 房间勾选项默认不勾：只有勾上才把 room_id 带进查询。
        const roomNode = this.At("列表区/筛选_当前房间");
        this.roomToggle = roomNode == null ? null : roomNode.getComponent(cc.Toggle);
        this.roomOnly = false;
        if(this.roomToggle != null)
            this.roomToggle.isChecked = false;
        this.RefreshRoomLabel();
        this.RefreshModeButtons();
        this.RefreshDirectionButtons();
        this.RefreshFilterButtons();
        this.RefreshObjectLabel();
        this.ShowStatus("", false);
        this.LayoutList();
        this.QueryList(true, true);
        this.schedule(()=>{
            // 历史表是静态快照，不需要轮询；轮询还会把用户滚动/翻页位置打回顶部。
            if(this.historyMode)
                return;
            if(!this.listBusy)
                this.QueryList(false, false);
        }, panelGameOptimize.POLL_SECONDS);
    }

    onDestroy () {
        this.ClearListTimer();
        this.ClearSetTimer();
        this.ClearStopTimer();
        super.onDestroy();
    }

    // ------------------------------------------------------------------
    // 按钮
    // ------------------------------------------------------------------
    public onButtonClick(button:cc.Button):void {
        const name = button.node.name;
        if(name === "返回") {
            UIManager.getInstance().closePanelByName(this.node.name);
            return;
        }
        if(name === "范围_个人") {
            this.SetMode("player");
            return;
        }
        if(name === "范围_分组") {
            this.SetMode("group");
            return;
        }
        if(name === "对象选择") {
            this.OpenPicker();
            return;
        }
        if(name === "目标_赢") {
            this.SetDirection(1);
            return;
        }
        if(name === "目标_输") {
            this.SetDirection(-1);
            return;
        }
        if(name === "提交") {
            this.Submit();
            return;
        }
        if(name === "筛选_历史") {
            this.SetHistoryMode();
            return;
        }
        if(name === "历史上一页") {
            this.ChangeListPage(-1);
            return;
        }
        if(name === "历史下一页") {
            this.ChangeListPage(1);
            return;
        }
        if(name.indexOf("筛选_") === 0) {
            this.SetFilter(name === "筛选_全部" ? "" :
                (name === "筛选_进行中" ? "active" : (name === "筛选_已达成" ? "done" : "stopped")));
            return;
        }
        super.onButtonClick(button);
    }

    private SetMode(mode:string):void {
        if(this.mode === mode)
            return;
        this.mode = mode;
        this.RefreshModeButtons();
        this.RefreshObjectLabel();
        this.ShowStatus("", false);
    }

    private SetDirection(direction:number):void {
        this.direction = direction === -1 ? -1 : 1;
        this.RefreshDirectionButtons();
    }

    private SetFilter(state:string):void {
        // 状态筛选只作用于当前目标表：点任一状态 chip 就退出历史表。
        if(this.filter === state && !this.historyMode)
            return;
        // 勾了「只看当前房间」时服务端对空 state 一律按 active 处理（正在优化），
        // 让「全部」保持高亮会和实际数据不一致，这里直接提示。
        if(this.roomOnly && state === "") {
            this.ShowStatus("勾选「只看当前房间」时只查进行中的目标", true);
            return;
        }
        this.filter = state;
        this.historyMode = false;
        this.listPage = 0;
        this.RefreshFilterButtons();
        this.LayoutList();
        this.RefreshListNow();
    }

    /** 五个 chip 互斥：进历史查历史表（全部状态），再点一次回到当前目标表的「全部」。 */
    private SetHistoryMode():void {
        const next = !this.historyMode;
        // 历史表没有房间列，服务端 history=1 时拒绝 room_id；进历史顺带把房间勾选取消。
        if(next && this.roomOnly) {
            this.roomOnly = false;
            this.SetRoomToggle(false);
            this.ShowStatus("历史记录不支持按当前房间筛选，已取消勾选", false);
        }
        this.historyMode = next;
        this.filter = "";
        this.listPage = 0;
        this.RefreshFilterButtons();
        this.LayoutList();
        this.RefreshListNow();
    }

    // ------------------------------------------------------------------
    // 只看当前房间
    // ------------------------------------------------------------------
    /** Toggle 由 UIBase 统一注册（onButtonClickVirtual 走这条回调），不重复挂 click。 */
    public onToggleClick(toggle:cc.Toggle):void {
        if(toggle != null && toggle.node != null && toggle.node.name === "筛选_当前房间") {
            if(this.roomSyncing)
                return;
            this.ApplyRoomOnly(toggle.isChecked);
            return;
        }
        super.onToggleClick(toggle);
    }

    private SetRoomToggle(checked:boolean):void {
        if(this.roomToggle == null || this.roomToggle.isChecked === checked)
            return;
        this.roomSyncing = true;
        this.roomToggle.isChecked = checked;
        this.roomSyncing = false;
    }

    private ApplyRoomOnly(on:boolean):void {
        if(on) {
            if(this.historyMode) {
                this.SetRoomToggle(false);
                this.ShowStatus("历史记录不支持按当前房间筛选", true);
                return;
            }
            if(this.CurrentRoomId() <= 0) {
                this.SetRoomToggle(false);
                this.ShowStatus("当前不在房间内，无法按房间筛选", true);
                return;
            }
            this.roomOnly = true;
            // room_id>0 且 state 为空时服务端按 active 处理，这里同步把筛选切成「进行中」，
            // 避免「全部」高亮但只回来进行中的目标。
            if(this.filter === "") {
                this.filter = "active";
                this.RefreshFilterButtons();
                this.LayoutList();
            }
            this.ShowStatus("", false);
        }
        else {
            this.roomOnly = false;
            this.ShowStatus("", false);
        }
        this.listPage = 0;
        this.RefreshListNow();
    }

    private CurrentRoomId():number {
        const account:any = GameDataManager.getAccount();
        if(account == null)
            return 0;
        const roomId = Number(account.roomID);
        return isFinite(roomId) && roomId > 0 ? Math.floor(roomId) : 0;
    }

    /** 勾选项文字带上当前房号，勾之前就能确认筛的是哪一间。 */
    private RefreshRoomLabel():void {
        const node = this.At("列表区/筛选_当前房间/文字");
        if(node == null)
            return;
        const label = node.getComponent(cc.Label);
        if(label == null)
            return;
        const roomId = this.CurrentRoomId();
        label.string = roomId > 0 ? "只看当前房间 · " + roomId : "只看当前房间";
    }

    private ChangeListPage(delta:number):void {
        const totalPages = this.TotalPages();
        const next = Math.max(0, Math.min(totalPages - 1, this.listPage + delta));
        if(next === this.listPage)
            return;
        this.listPage = next;
        // 翻页不显示加载态，但要把列表滚回顶部。
        this.RefreshListNow(false);
    }

    private TotalPages():number {
        return Math.max(1, Math.ceil(Math.max(this.listTotal, 0) / this.pageSize));
    }

    /** 分页条常显（四个状态筛选和历史都有页码）：列表底边固定让出 66，切换时列表高度不跳变。 */
    private LayoutList():void {
        this.SetActive("列表区/分页", true);
        const scrollNode = this.At("列表区/列表");
        const widget = scrollNode == null ? null : scrollNode.getComponent(cc.Widget);
        if(widget != null) {
            widget.bottom = 66;
            widget.updateAlignment();
        }
        // 子节点 view 的 Widget 不会随父节点改高自动重排：不同步的话 view 仍按旧高度
        // 溢出「列表」，把列表内容顶到筛选栏上面（分页条出现时错位）。
        const view = scrollNode == null ? null : scrollNode.getChildByName("view");
        const viewWidget = view == null ? null : view.getComponent(cc.Widget);
        if(viewWidget != null)
            viewWidget.updateAlignment();
        // content 锚点贴顶，view 高度变了要重新贴回顶部，否则首行会被裁掉半行。
        if(view != null && this.rowContent != null)
            this.rowContent.setPosition(0, view.height / 2);
    }

    private UpdatePager():void {
        const totalPages = this.TotalPages();
        const label = this.At("列表区/分页/历史页码");
        if(label != null) {
            const text = label.getComponent(cc.Label);
            if(text != null)
                text.string = "第 " + (this.listPage + 1) + " / " + totalPages +
                    " 页 · 共 " + Math.max(this.listTotal, 0) + " 条";
        }
        this.SetPageButton("列表区/分页/历史上一页", this.listPage > 0);
        this.SetPageButton("列表区/分页/历史下一页", this.listPage < totalPages - 1);
    }

    private SetPageButton(path:string, enabled:boolean):void {
        const node = this.At(path);
        if(node == null)
            return;
        const button = node.getComponent(cc.Button);
        if(button != null)
            button.interactable = enabled;
        node.opacity = enabled ? 255 : 110;
    }

    private RefreshModeButtons():void {
        this.SetChipActive("设置区/范围_个人", this.mode === "player");
        this.SetChipActive("设置区/范围_分组", this.mode === "group");
        const note = this.At("设置区/说明");
        if(note != null) {
            const label = note.getComponent(cc.Label);
            if(label != null)
                label.string = this.mode === "player" ? "可选本房玩家或手动输入ID" : "按俱乐部分组成员批量生成";
        }
    }

    private RefreshDirectionButtons():void {
        this.SetChipActive("设置区/目标_赢", this.direction === 1);
        this.SetChipActive("设置区/目标_输", this.direction === -1);
    }

    private RefreshFilterButtons():void {
        // 「历史」与四个状态 chip 互斥：进历史时「全部」不能跟着亮。
        this.SetChipActive("列表区/筛选_全部", this.filter === "" && !this.historyMode);
        this.SetChipActive("列表区/筛选_进行中", this.filter === "active");
        this.SetChipActive("列表区/筛选_已达成", this.filter === "done");
        this.SetChipActive("列表区/筛选_已停止", this.filter === "stopped");
        this.SetChipActive("列表区/筛选_历史", this.historyMode);
    }

    private SetChipActive(path:string, active:boolean):void {
        const chip = this.At(path);
        if(chip == null)
            return;
        const on = chip.getChildByName("底激活");
        const off = chip.getChildByName("底非激活");
        if(on != null) on.active = active;
        if(off != null) off.active = !active;
        const text = chip.getChildByName("文字");
        if(text != null)
            text.color = active ? cc.color(48, 30, 8, 255) : cc.color(169, 192, 214, 255);
    }

    private RefreshObjectLabel():void {
        const node = this.At("设置区/对象选择/文字");
        if(node == null)
            return;
        const label = node.getComponent(cc.Label);
        if(label == null)
            return;
        if(this.mode === "player") {
            if(this.selectedPlayerId === "")
                label.string = "选择玩家";
            else if(this.selectedPlayerName !== "")
                label.string = this.selectedPlayerName + " (" + this.selectedPlayerId + ")";
            else
                label.string = "ID " + this.selectedPlayerId;
        }
        else
            label.string = this.selectedGroupId > 0 ? this.selectedGroupName : "选择分组";
    }

    // ------------------------------------------------------------------
    // 个人 / 分组选择（通用弹窗）
    // ------------------------------------------------------------------
    private OpenPicker():void {
        if(this.mode === "player") {
            panelPlayerPicker.Open({
                title:"选择玩家",
                mode:"player",
                presetId:this.selectedPlayerId,
                onPick:(item)=>{
                    this.selectedPlayerId = item.id;
                    this.selectedPlayerName = item.name;
                    this.RefreshObjectLabel();
                    this.ShowStatus(item.name !== "" ? "已选择玩家：" + item.name :
                        "已选择玩家ID：" + item.id + "（离线玩家停止后不恢复原优化）", false);
                }
            });
            return;
        }
        panelPlayerPicker.Open({
            title:"选择分组",
            mode:"group",
            clubId:this.GroupClubId(),
            onPick:(item)=>{
                this.selectedGroupId = Number(item.id);
                this.selectedGroupName = item.name;
                this.RefreshObjectLabel();
                this.ShowStatus("已选择分组：" + item.name, false);
            }
        });
    }

    private GroupClubId():string {
        const account:any = GameDataManager.getAccount();
        return resolveRoomSettingClubId(account) || resolveMyRoomClubId(account, "");
    }

    // ------------------------------------------------------------------
    // 列表
    // ------------------------------------------------------------------
    /** 用户主动切筛选/翻页/设置后：放弃在途的旧查询，避免旧模式回包覆盖新列表。 */
    private RefreshListNow(showLoading:boolean = true):void {
        this.ClearListTimer();
        this.listBusy = false;
        this.listContext = "";
        this.listLoadingShown = false;
        this.QueryList(showLoading, true);
    }

    private QueryList(showLoading:boolean, scrollTop:boolean = false):void {
        if(this.listBusy)
            return;
        const account:any = GameDataManager.getAccount();
        if(account == null) {
            this.ShowStatus("网络未就绪，请稍后重试", true);
            return;
        }
        this.listBusy = true;
        this.listScrollTop = scrollTop;
        this.listContext = "optlist:" + Date.now() + ":" + (++panelGameOptimize.serial);
        this.ClearListTimer();
        if(showLoading && this.listLoadingShown === false) {
            this.listLoadingShown = true;
            this.SetActive("列表区/加载", true);
            this.SetActive("列表区/空状态", false);
        }
        this.listTimer = setTimeout(()=>{
            if(this.listContext === "")
                return;
            this.listBusy = false;
            this.listContext = "";
            this.listLoadingShown = false;
            this.SetActive("列表区/加载", false);
            this.ShowStatus("目标列表查询超时，请稍后重试", true);
        }, 8000);
        try {
            const param:any = {
                header:panelGameOptimize.LIST_HEADER,
                guuids:"",
                scope_type:"",
                scope_id:"",
                group_id:0,
                state:this.filter,
                context:this.listContext
            };
            // 勾了「只看当前房间」才带 room_id；服务端按查询时实时所在房间过滤（不是设置时快照）。
            if(this.roomOnly && !this.historyMode) {
                const roomId = this.CurrentRoomId();
                if(roomId > 0)
                    param.room_id = roomId;
            }
            if(this.historyMode) {
                param.history = 1;
                param.count = this.pageSize;
                param.page = this.listPage;
            }
            account.reqHallCommand(JSON.stringify(param), "P@" + this.listContext);
        }
        catch(error) {
            this.ClearListTimer();
            this.listBusy = false;
            this.listContext = "";
            this.listLoadingShown = false;
            this.SetActive("列表区/加载", false);
            this.ShowStatus("目标列表请求发送失败，请稍后重试", true);
        }
    }

    private RenderList(rows:OptimizeRow[]):void {
        if(this.rowContent == null || this.rowTemplate == null) {
            this.ShowStatus("界面资源缺失，请重新打开", true);
            return;
        }
        for(const child of this.rowContent.children.slice()) {
            if(child.name.indexOf("目标行_") === 0)
                child.destroy();
        }
        this.rowTemplate.active = false;
        this.SetActive("列表区/加载", false);
        this.listLoadingShown = false;
        this.SetActive("列表区/空状态", rows.length === 0);
        this.UpdatePager();
        if(rows.length === 0) {
            const empty = this.At("列表区/空状态");
            if(empty != null) {
                const label = empty.getComponent(cc.Label);
                if(label != null)
                    label.string = this.historyMode ? "暂无历史记录" :
                        (this.roomOnly ? "本房当前没有进行中的目标" :
                            (this.filter === "" ? "暂无优化记录" : "当前筛选下没有记录"));
            }
            this.ResizeListContent(0);
            return;
        }

        const rowHeight = 104;
        const gap = 8;
        rows.forEach((row, index)=>{
            const item = cc.instantiate(this.rowTemplate);
            item.active = true;
            item.parent = this.rowContent;
            item.name = "目标行_" + (row.id !== "" ? row.id : row.guuid) + "_" + index;
            item.setPosition(0, -(rowHeight / 2 + index * (rowHeight + gap)));
            this.FillRow(item, row);
        });
        const total = rows.length * (rowHeight + gap) - gap;
        this.ResizeListContent(total);
        if(this.listScrollTop && this.listScroll != null)
            this.listScroll.scrollToTop(0.05);
    }

    /** 内容锚点在上边：高度变化后仍要把顶边贴回 view 顶部，长屏不会从中间开始。 */
    private ResizeListContent(contentHeight:number):void {
        if(this.rowContent == null)
            return;
        const view = this.rowContent.parent;
        const viewHeight = view == null ? 0 : view.height;
        if(view != null)
            this.rowContent.setPosition(0, viewHeight / 2);
        this.rowContent.setContentSize(this.rowContent.width, Math.max(contentHeight, viewHeight));
    }

    private FillRow(item:cc.Node, row:OptimizeRow):void {
        const loseBg = item.getChildByName("背景_输");
        if(loseBg != null)
            loseBg.active = row.targetValue < 0;

        this.SetLabel(item, "名字", row.name !== "" ? row.name : row.guuid);
        let sub = "ID " + row.guuid;
        if(row.groupName !== "")
            sub += " · " + row.groupName;
        if(this.historyMode && row.setTime !== "")
            sub += " · 设置 " + this.ShortTime(row.setTime);
        this.SetLabel(item, "副标题", sub);

        const target = row.targetValue === 0 ? "—" :
            (row.targetValue > 0 ? "赢 " : "输 ") + Math.abs(row.targetValue);
        this.SetLabel(item, "目标", "目标 " + target);
        this.SetLabel(item, "概率", "概率 " + Math.abs(row.chance) + "%");

        // 朝目标方向推进的部分：目标赢(+200)时 -50 一分没推进；目标输(-200)时 +50 同理。
        // 服务端 remain = |目标| - |进度| 在异号时会把「还差 250」算成「剩余 150」，这里统一按方向重算。
        const direction = row.targetValue < 0 ? -1 : 1;
        const gained = row.progress * direction;
        const targetAbs = Math.abs(row.targetValue);
        const remain = targetAbs - gained;

        let progress = "进度 " + this.Signed(row.progress) + " / " + (row.targetValue === 0 ? "—" : this.Signed(row.targetValue));
        if(row.state === "active") {
            if(targetAbs > 0 && remain > 0)
                progress += " · 剩余 " + Math.round(remain);
            else if(targetAbs > 0 && remain < 0)
                progress += " · 超 " + Math.round(Math.abs(remain));
            progress += " · " + row.roundCount + "局";
            // 历史行是记录快照，不带在线/实时属性；只在当前目标里判断是否已生效。
            if(!this.historyMode) {
                if(!row.online)
                    progress += " · 离线";
                else if(row.curCount > 0)
                    progress += " · 已生效";
            }
        }
        else {
            if(row.finishReason !== "")
                progress += " · " + this.ReasonText(row.finishReason);
            if(row.finishTime !== "")
                progress += " · " + this.ShortTime(row.finishTime);
        }
        this.SetLabel(item, "进度", progress);

        const barNode = item.getChildByName("进度条");
        if(barNode != null) {
            const bar = barNode.getComponent(cc.ProgressBar);
            if(bar != null) {
                // 只有朝目标方向推进才走进度条：负数进度（反向）一律 0，不能按绝对值铺满。
                const ratio = targetAbs > 0 ? Math.max(0, Math.min(1, gained / targetAbs)) : 0;
                bar.progress = ratio;
            }
        }

        const stateText = item.getChildByName("状态");
        if(stateText != null) {
            const label = stateText.getComponent(cc.Label);
            if(label != null) {
                if(row.state === "done") {
                    label.string = "已达成";
                    stateText.color = cc.color(120, 235, 150, 255);
                }
                else if(row.state === "stopped") {
                    label.string = "未完成";
                    stateText.color = cc.color(170, 202, 224, 255);
                }
                else {
                    label.string = "未完成";
                    stateText.color = cc.color(255, 227, 117, 255);
                }
            }
        }

        const stop = item.getChildByName("停止");
        if(stop != null) {
            stop.active = row.state === "active";
            const button = stop.getComponent(cc.Button);
            if(button != null) {
                button.node.on("click", ()=>{
                    this.StopTarget(row.guuid, row.name);
                }, this);
            }
        }
    }

    private Signed(value:number):string {
        const number = Number(value);
        if(!isFinite(number))
            return "0";
        const rounded = Math.round(number);
        return (rounded > 0 ? "+" : "") + rounded;
    }

    private ReasonText(reason:string):string {
        if(reason === "stop")
            return "手动停止";
        if(reason === "replace")
            return "被新目标替换";
        if(reason === "done" || reason === "target")
            return "达标结束";
        return reason;
    }

    private ShortTime(text:string):string {
        const value = String(text == null ? "" : text);
        if(value.length >= 16)
            return value.substring(5, 16);
        return value;
    }

    // ------------------------------------------------------------------
    // 设置 / 停止
    // ------------------------------------------------------------------
    private Submit():void {
        if(this.setBusy)
            return;
        const chance = Number(this.InputText("设置区/概率输入"));
        const amount = Number(this.InputText("设置区/金额输入"));
        if(!isFinite(chance) || Math.floor(chance) !== chance || chance < 1 || chance > 100) {
            this.ShowStatus("优化概率必须是 1~100 的整数", true);
            return;
        }
        if(!isFinite(amount) || Math.floor(amount) !== amount || amount <= 0) {
            this.ShowStatus("目标金额必须是大于 0 的整数", true);
            return;
        }
        const account:any = GameDataManager.getAccount();
        if(account == null) {
            this.ShowStatus("网络未就绪，请稍后重试", true);
            return;
        }
        const target = this.direction * amount;
        const param:any = {
            header:panelGameOptimize.SET_HEADER,
            target_value:target,
            chance:chance,
            remark:"牌桌内运维优化"
        };
        if(this.mode === "player") {
            if(this.selectedPlayerId === "") {
                this.ShowStatus("请先选择本房玩家", true);
                return;
            }
            param.guuids = this.selectedPlayerId;
        }
        else {
            if(this.selectedGroupId <= 0) {
                this.ShowStatus("请先选择分组", true);
                return;
            }
            const clubId = this.GroupClubId();
            if(clubId === "") {
                this.ShowStatus("缺少俱乐部信息，无法按分组设置", true);
                return;
            }
            param.club_id = clubId;
            param.group_id = this.selectedGroupId;
        }

        this.setBusy = true;
        this.setContext = "optset:" + Date.now() + ":" + (++panelGameOptimize.serial);
        param.context = this.setContext;
        this.ClearSetTimer();
        this.setTimer = setTimeout(()=>{
            if(this.setContext === "")
                return;
            this.setBusy = false;
            this.setContext = "";
            this.ShowStatus("设置超时，请刷新列表确认结果", true);
        }, 12000);
        this.ShowStatus("正在提交…", false);
        try {
            account.reqHallCommand(JSON.stringify(param), "P@" + this.setContext);
        }
        catch(error) {
            this.ClearSetTimer();
            this.setBusy = false;
            this.setContext = "";
            this.ShowStatus("设置请求发送失败，请稍后重试", true);
        }
    }

    private StopTarget(guuid:string, name:string):void {
        if(this.stopContext !== "")
            return;
        const account:any = GameDataManager.getAccount();
        if(account == null) {
            this.ShowStatus("网络未就绪，请稍后重试", true);
            return;
        }
        this.stopContext = "optstop:" + Date.now() + ":" + (++panelGameOptimize.serial);
        this.ClearStopTimer();
        this.stopTimer = setTimeout(()=>{
            if(this.stopContext === "")
                return;
            this.stopContext = "";
            this.ShowStatus("停止超时，请刷新列表确认结果", true);
        }, 12000);
        this.ShowStatus("正在停止 " + (name !== "" ? name : guuid) + " …", false);
        try {
            account.reqHallCommand(JSON.stringify({
                header:panelGameOptimize.STOP_HEADER,
                guuids:guuid,
                remark:"牌桌内停止",
                context:this.stopContext
            }), "P@" + this.stopContext);
        }
        catch(error) {
            this.ClearStopTimer();
            this.stopContext = "";
            this.ShowStatus("停止请求发送失败，请稍后重试", true);
        }
    }

    // ------------------------------------------------------------------
    // 大厅命令回包
    // ------------------------------------------------------------------
    public OnHallCommand(nCode:number, param:any):void {
        const data = this.ParseReply(param);
        if(data == null)
            return;
        const ctx = String(data.context == null ? "" : data.context);

        if(this.listContext !== "" &&
            (ctx === this.listContext || (ctx === "" && (data.list !== undefined || data.total !== undefined)))) {
            this.ClearListTimer();
            this.listBusy = false;
            this.listContext = "";
            this.listLoadingShown = false;
            this.SetActive("列表区/加载", false);
            const error = this.ErrorText(data);
            if(error !== "" || (nCode !== 0x200 && nCode !== 0x500 && data.list === undefined)) {
                this.ShowStatus(error !== "" ? error : "目标列表查询失败，请稍后重试", true);
                return;
            }
            // 当前目标表接口没有 count/page（一次返回全量），这里按页切片；历史表由服务端分页。
            const rows:any[] = Array.isArray(data.list) ? data.list : [];
            this.listTotal = this.historyMode ? Math.max(Number(data.total) || 0, rows.length) : rows.length;
            const totalPages = this.TotalPages();
            if(this.listPage > totalPages - 1)
                this.listPage = totalPages - 1;
            const start = this.listPage * this.pageSize;
            const pageRows = this.historyMode ? rows : rows.slice(start, start + this.pageSize);
            this.RenderList(pageRows.map((raw:any)=>this.ParseRow(raw)));
            return;
        }

        if(this.setContext !== "" && (ctx === this.setContext ||
            (ctx === "" && (data.ok !== undefined || data.failed !== undefined)))) {
            this.ClearSetTimer();
            this.setBusy = false;
            this.setContext = "";
            const error = this.ErrorText(data);
            if(error !== "" || (nCode !== 0x200 && nCode !== 0x500 && data.ok === undefined)) {
                this.ShowStatus(error !== "" ? error : "设置失败，请稍后重试", true);
                this.RefreshListNow();
                return;
            }
            const ok:any[] = Array.isArray(data.ok) ? data.ok : [];
            const failed:any[] = Array.isArray(data.failed) ? data.failed : [];
            if(this.mode === "player" && ok.length > 0 && ok[0] != null &&
                String(ok[0].guuid) === this.selectedPlayerId && ok[0].name) {
                this.selectedPlayerName = String(ok[0].name);
                this.RefreshObjectLabel();
            }
            let message = "已设置 " + ok.length + " 个目标";
            if(ok.length > 0 && ok[0] != null && ok[0].warning)
                message += "（" + String(ok[0].warning) + "）";
            if(failed.length > 0) {
                const reason = failed[0] != null && failed[0].error ? String(failed[0].error) : "未知原因";
                this.ShowStatus(message + "；失败 " + failed.length + " 个：" + reason, true);
            }
            else
                this.ShowStatus(message, false);
            // 新目标一定是进行中：从历史/已结束筛选切回当前目标列表。
            this.historyMode = false;
            this.listPage = 0;
            if(this.filter === "done" || this.filter === "stopped")
                this.filter = "";
            this.RefreshFilterButtons();
            this.LayoutList();
            this.RefreshListNow();
            return;
        }

        if(this.stopContext !== "" && (ctx === this.stopContext ||
            (ctx === "" && (data.ok !== undefined || data.failed !== undefined)))) {
            this.ClearStopTimer();
            this.stopContext = "";
            const error = this.ErrorText(data);
            if(error !== "" || (nCode !== 0x200 && nCode !== 0x500 && data.ok === undefined)) {
                this.ShowStatus(error !== "" ? error : "停止失败，请稍后重试", true);
                this.RefreshListNow();
                return;
            }
            const ok:any[] = Array.isArray(data.ok) ? data.ok : [];
            const failed:any[] = Array.isArray(data.failed) ? data.failed : [];
            if(failed.length > 0) {
                const reason = failed[0] != null && failed[0].error ? String(failed[0].error) : "未知原因";
                this.ShowStatus("停止失败：" + reason, true);
            }
            else
                this.ShowStatus("已停止 " + ok.length + " 个目标", false);
            this.RefreshListNow();
        }
    }

    private ParseReply(param:any):any {
        let data:any = param;
        let outerContext:string = "";
        for(let i = 0; i < 3; i++) {
            if(typeof data === "string") {
                try { data = JSON.parse(data); }
                catch(error) { return null; }
                continue;
            }
            if(data == null || typeof data !== "object")
                return null;
            if(outerContext === "" && data.context != null && data.context !== "")
                outerContext = String(data.context);
            let inner:any = null;
            if(typeof data.ret_result === "string")
                inner = data.ret_result;
            else if(typeof data.result === "string")
                inner = data.result;
            else if(data.result != null && typeof data.result === "object")
                inner = data.result;
            if(inner == null) {
                // 有些服务端版本按路由名包一层（{"异步_查询_胜率目标_列表":{...}}）。
                const keys = Object.keys(data).filter((key)=>key !== "context");
                if(keys.length === 1 && (typeof data[keys[0]] === "string" ||
                    (data[keys[0]] != null && typeof data[keys[0]] === "object" &&
                        !Array.isArray(data[keys[0]]))))
                    inner = data[keys[0]];
            }
            if(inner == null)
                break;
            data = inner;
        }
        if(data != null && typeof data === "object" && outerContext !== "" &&
            (data.context == null || data.context === ""))
            data.context = outerContext;
        return data != null && typeof data === "object" ? data : null;
    }

    private Unwrap(raw:any):any {
        let data:any = raw;
        let outerContext:string = "";
        for(let i = 0; i < 3; i++) {
            if(typeof data === "string") {
                try { data = JSON.parse(data); }
                catch(error) { return null; }
                continue;
            }
            if(data == null || typeof data !== "object")
                return null;
            if(Array.isArray(data))
                return null;
            if(outerContext === "" && data.context != null && data.context !== "")
                outerContext = String(data.context);
            if(data.groups === undefined && data.ClubPlayerGroupList !== undefined)
                data = data.ClubPlayerGroupList;
            else if(typeof data.result === "string")
                data = data.result;
            else if(data.result != null && typeof data.result === "object")
                data = data.result;
            else {
                const keys = Object.keys(data).filter((key)=>key !== "context");
                if(keys.length === 1 && (typeof data[keys[0]] === "string" ||
                    (data[keys[0]] != null && typeof data[keys[0]] === "object" &&
                        !Array.isArray(data[keys[0]]))))
                    data = data[keys[0]];
                else
                    break;
            }
        }
        if(data != null && typeof data === "object" && outerContext !== "" &&
            (data.context == null || data.context === ""))
            data.context = outerContext;
        return data != null && typeof data === "object" ? data : null;
    }

    private ErrorText(data:any):string {
        if(data == null)
            return "";
        if(data.error != null && data.error !== "")
            return String(data.error);
        if(data.result != null && typeof data.result === "object" && data.result.error != null)
            return String(data.result.error);
        return "";
    }

    private ParseRow(raw:any):OptimizeRow {
        const text = (value:any):string => String(value == null ? "" : value).trim();
        const number = (value:any):number => {
            const parsed = Number(value);
            return isFinite(parsed) ? parsed : 0;
        };
        const targetValue = number(raw && raw.target_value);
        const progress = number(raw && raw.progress);
        return {
            id:text(raw && raw.id),
            guuid:text(raw && raw.guuid),
            name:text(raw && raw.name),
            state:text(raw && raw.state),
            targetValue:targetValue,
            chance:number(raw && raw.chance),
            progress:progress,
            roundCount:number(raw && raw.round_count),
            peerCount:number(raw && raw.peer_count),
            groupName:text(raw && raw.group_name),
            online:number(raw && raw.online) === 1,
            curChance:number(raw && raw.cur_chance),
            curCount:number(raw && raw.cur_count),
            setTime:text(raw && raw.set_time),
            finishTime:text(raw && raw.finish_time),
            finishReason:text(raw && raw.finish_reason)
        };
    }

    // ------------------------------------------------------------------
    // 小工具
    // ------------------------------------------------------------------
    private At(path:string):cc.Node {
        return Tool.GetChild(this.node, path);
    }

    private SetActive(path:string, active:boolean):void {
        const node = this.At(path);
        if(node != null)
            node.active = active;
    }

    private SetLabel(root:cc.Node, name:string, text:string):void {
        if(root == null)
            return;
        const node = root.getChildByName(name);
        if(node == null)
            return;
        const label = node.getComponent(cc.Label);
        if(label != null)
            label.string = text;
    }

    private InputText(path:string):string {
        const node = this.At(path);
        if(node == null)
            return "";
        const edit = node.getComponent(cc.EditBox);
        return edit == null ? "" : String(edit.string == null ? "" : edit.string).trim();
    }

    private ShowStatus(text:string, isError:boolean):void {
        const node = this.At("设置区/提示");
        if(node == null)
            return;
        const label = node.getComponent(cc.Label);
        if(label == null)
            return;
        label.string = text;
        node.color = isError ? cc.color(255, 120, 110, 255) : cc.color(170, 202, 224, 255);
    }

    private ClearListTimer():void {
        if(this.listTimer != null) {
            clearTimeout(this.listTimer);
            this.listTimer = null;
        }
    }

    private ClearSetTimer():void {
        if(this.setTimer != null) {
            clearTimeout(this.setTimer);
            this.setTimer = null;
        }
    }

    private ClearStopTimer():void {
        if(this.stopTimer != null) {
            clearTimeout(this.stopTimer);
            this.stopTimer = null;
        }
    }
}
