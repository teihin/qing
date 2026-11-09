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
 * progress/remain 允许为负；target_value 正=让玩家赢，负=让玩家输。
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
    remain:number;
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
    /** 默认查 usr_opt_target_history（每次设置一条）；点「历史」切回当前目标。 */
    private historyMode:boolean = true;
    private historyPage:number = 0;
    private readonly historyPageSize:number = 20;
    private listTotal:number = 0;

    private selectedPlayerId:string = "";
    private selectedPlayerName:string = "";
    private selectedGroupId:number = 0;
    private selectedGroupName:string = "";

    private listBusy:boolean = false;
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
        if(!GameDataManager.IsBossAccount()) {
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
        this.RefreshModeButtons();
        this.RefreshDirectionButtons();
        this.RefreshFilterButtons();
        this.RefreshObjectLabel();
        this.ShowStatus("", false);
        this.SetPagerVisible(this.historyMode);
        this.QueryList(true);
        this.schedule(()=>{
            if(!this.listBusy)
                this.QueryList(false);
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
            this.ChangeHistoryPage(-1);
            return;
        }
        if(name === "历史下一页") {
            this.ChangeHistoryPage(1);
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
        if(this.filter === state)
            return;
        this.filter = state;
        this.historyPage = 0;
        this.RefreshFilterButtons();
        this.SetPagerVisible(this.historyMode);
        this.RefreshListNow();
    }

    /** 「历史」是独立维度：开启后状态筛选仍在历史表内生效；再点一次回到当前目标。 */
    private SetHistoryMode():void {
        this.historyMode = !this.historyMode;
        this.historyPage = 0;
        this.RefreshFilterButtons();
        this.SetPagerVisible(this.historyMode);
        this.RefreshListNow();
    }

    private ChangeHistoryPage(delta:number):void {
        if(!this.historyMode)
            return;
        const totalPages = this.HistoryTotalPages();
        const next = Math.max(0, Math.min(totalPages - 1, this.historyPage + delta));
        if(next === this.historyPage)
            return;
        this.historyPage = next;
        this.RefreshListNow();
    }

    private HistoryTotalPages():number {
        return Math.max(1, Math.ceil(Math.max(this.listTotal, 0) / this.historyPageSize));
    }

    private SetPagerVisible(show:boolean):void {
        this.SetActive("列表区/分页", show);
        const scrollNode = this.At("列表区/列表");
        const widget = scrollNode == null ? null : scrollNode.getComponent(cc.Widget);
        if(widget != null) {
            widget.bottom = show ? 66 : 10;
            widget.updateAlignment();
        }
    }

    private UpdatePager():void {
        if(!this.historyMode)
            return;
        const totalPages = this.HistoryTotalPages();
        const label = this.At("列表区/分页/历史页码");
        if(label != null) {
            const text = label.getComponent(cc.Label);
            if(text != null)
                text.string = "第 " + (this.historyPage + 1) + " / " + totalPages +
                    " 页 · 共 " + Math.max(this.listTotal, 0) + " 条";
        }
        this.SetPageButton("列表区/分页/历史上一页", this.historyPage > 0);
        this.SetPageButton("列表区/分页/历史下一页", this.historyPage < totalPages - 1);
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
        this.SetChipActive("列表区/筛选_全部", this.filter === "");
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
    private RefreshListNow():void {
        this.ClearListTimer();
        this.listBusy = false;
        this.listContext = "";
        this.listLoadingShown = false;
        this.QueryList(true);
    }

    private QueryList(showLoading:boolean):void {
        if(this.listBusy)
            return;
        const account:any = GameDataManager.getAccount();
        if(account == null) {
            this.ShowStatus("网络未就绪，请稍后重试", true);
            return;
        }
        this.listBusy = true;
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
            if(this.historyMode) {
                param.history = 1;
                param.count = this.historyPageSize;
                param.page = this.historyPage;
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
                        (this.filter === "" ? "暂无优化记录" : "当前筛选下没有记录");
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
        if(this.listScroll != null)
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

        let progress = "进度 " + this.Signed(row.progress) + " / " + (row.targetValue === 0 ? "—" : this.Signed(row.targetValue));
        if(row.state === "active") {
            if(row.remain > 0)
                progress += " · 剩 " + row.remain;
            else if(row.remain < 0)
                progress += " · 超 " + Math.abs(row.remain);
            progress += " · " + row.roundCount + "局";
            // 历史行是记录快照，不带在线/实时属性；只在当前目标里判断是否已生效。
            if(!this.historyMode) {
                if(!row.online)
                    progress += " · 离线";
                else if(row.curCount > 0)
                    progress += " · 已生效";
                else
                    progress += " · 待生效";
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
                const targetAbs = Math.abs(row.targetValue);
                const ratio = targetAbs > 0 ? Math.min(1, Math.abs(row.progress) / targetAbs) : 0;
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
                    label.string = "未达成";
                    stateText.color = cc.color(170, 202, 224, 255);
                }
                else {
                    label.string = "进行中";
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
            this.listTotal = Number(data.total) || 0;
            const rows:any[] = Array.isArray(data.list) ? data.list : [];
            this.RenderList(rows.map((raw:any)=>this.ParseRow(raw)));
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
            this.historyPage = 0;
            if(this.filter === "done" || this.filter === "stopped")
                this.filter = "";
            this.RefreshFilterButtons();
            this.SetPagerVisible(false);
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
        return {
            id:text(raw && raw.id),
            guuid:text(raw && raw.guuid),
            name:text(raw && raw.name),
            state:text(raw && raw.state),
            targetValue:number(raw && raw.target_value),
            chance:number(raw && raw.chance),
            progress:number(raw && raw.progress),
            remain:number(raw && raw.remain),
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
