import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import { ShowPanelMode } from "../common/GameDef";
import GameDataManager from "../GameDataManager";
import Tool from "../common/Tool";
import DrhLogicMgr from "../logic/DrhLogicMgr";

var KBEngine = require("kbengine");

const {ccclass} = cc._decorator;

export interface PlayerPickerItem {
    /** 玩家 guuid 或俱乐部 group_id。 */
    id:string;
    /** 玩家昵称或分组名；手动输入 ID 时为空串，由调用方回退显示 ID。 */
    name:string;
    extra?:any;
}

export interface PlayerPickerOptions {
    title?:string;
    /** player=玩家（本房在座 + 手动输入 ID）；group=俱乐部分组。 */
    mode?:string;
    /** 分组模式必传：用于解析管理域并加载分组。 */
    clubId?:string;
    /** 打开时预填的手动玩家 ID。 */
    presetId?:string;
    onPick?:(item:PlayerPickerItem)=>void;
}

/**
 * 通用「选择玩家 / 选择分组」弹窗。
 *
 * 其他界面直接调用：
 *   panelPlayerPicker.Open({title:"选择玩家", onPick:(item)=>{ ... }});
 *   panelPlayerPicker.Open({title:"选择分组", mode:"group", clubId:"775447", onPick:(item)=>{ ... }});
 *
 * 玩家模式：本房在座玩家列表 + 手动输入数字 ID；分组模式：查询_俱乐部_分组列表。
 * 选择后先关闭弹窗，再把结果回调给调用方，调用方面板不会被关掉。
 */
@ccclass
export default class panelPlayerPicker extends UIPanelViewBase {

    private static serial:number = 0;

    public static Open(options:PlayerPickerOptions):void {
        UIManager.getInstance().showPanel("panelPlayerPicker", ShowPanelMode.Cover, "", [options]);
    }

    private options:PlayerPickerOptions = {};
    private mode:string = "player";
    private onPick:(item:PlayerPickerItem)=>void = null;

    private rowTemplate:cc.Node = null;
    private rowContent:cc.Node = null;
    private listScroll:cc.ScrollView = null;

    private groups:{id:string;name:string;memberCount:number}[] = [];
    private groupBusy:boolean = false;
    private groupContext:string = "";
    private groupTimer:any = null;

    onLoad () {
        super.onLoad();
        KBEngine.Event.register("ClubPlayerGroupList", this, "OnGroupList");
        KBEngine.Event.register("onHallCommand", this, "OnHallCommand");

        const mask = this.At("遮罩");
        if(mask != null) {
            mask.on(cc.Node.EventType.TOUCH_END, ()=>{
                UIManager.getInstance().closePanelByName(this.node.name);
            }, this);
        }

        const content = this.At("面板/列表/view/content");
        if(content != null) {
            this.rowContent = content;
            this.rowTemplate = content.getChildByName("选项行");
            if(this.rowTemplate != null)
                this.rowTemplate.active = false;
        }
        const scrollNode = this.At("面板/列表");
        this.listScroll = scrollNode == null ? null : scrollNode.getComponent(cc.ScrollView);
    }

    start () {
        this.options = this.arrayEx != null && this.arrayEx.length > 0 ? this.arrayEx[0] : {};
        if(this.options == null)
            this.options = {};
        this.mode = this.options.mode === "group" ? "group" : "player";
        this.onPick = this.options.onPick != null ? this.options.onPick : null;

        const title = this.At("面板/标题");
        if(title != null) {
            const label = title.getComponent(cc.Label);
            if(label != null)
                label.string = this.options.title != null && this.options.title !== "" ?
                    this.options.title : (this.mode === "group" ? "选择分组" : "选择玩家");
        }

        this.SetActive("面板/手动区", this.mode === "player");
        this.SetActive("面板/手动提示", false);
        this.SetScrollTop(this.mode === "player" ? 180 : 100);

        if(this.mode === "player" && this.options.presetId != null &&
            String(this.options.presetId) !== "") {
            const input = this.At("面板/手动区/ID输入");
            const edit = input == null ? null : input.getComponent(cc.EditBox);
            if(edit != null)
                edit.string = String(this.options.presetId);
        }

        if(this.mode === "group")
            this.LoadGroups();
        else
            this.RenderPlayers();
    }

    onDestroy () {
        this.ClearGroupTimer();
        super.onDestroy();
    }

    // ------------------------------------------------------------------
    // 按钮
    // ------------------------------------------------------------------
    public onButtonClick(button:cc.Button):void {
        const name = button.node.name;
        if(name === "确定ID") {
            this.ConfirmManualId();
            return;
        }
        if(name === "关闭" || name === "返回") {
            UIManager.getInstance().closePanelByName(this.node.name);
            return;
        }
        super.onButtonClick(button);
    }

    private ConfirmManualId():void {
        const input = this.At("面板/手动区/ID输入");
        const edit = input == null ? null : input.getComponent(cc.EditBox);
        const value = edit == null ? "" : String(edit.string == null ? "" : edit.string).trim();
        if(!/^\d{1,20}$/.test(value)) {
            this.SetManualHint("请输入正确的数字玩家ID", true);
            return;
        }
        this.SetManualHint("", false);
        this.Pick({id:value, name:""});
    }

    private Pick(item:PlayerPickerItem):void {
        const callback = this.onPick;
        this.onPick = null;
        UIManager.getInstance().closePanelByName(this.node.name);
        if(callback != null)
            callback(item);
    }

    // ------------------------------------------------------------------
    // 玩家列表
    // ------------------------------------------------------------------
    private RenderPlayers():void {
        if(this.rowContent == null || this.rowTemplate == null) {
            this.ShowMessage("界面资源缺失，请重新打开");
            return;
        }
        this.ClearRows();
        const players = this.SeatedPlayers();
        if(players.length === 0) {
            this.ShowMessage("本房暂无可选玩家，可直接输入ID");
            return;
        }
        this.SetActive("面板/空状态", false);
        this.SetActive("面板/加载", false);
        this.ShowContent(true);
        players.forEach((player, index)=>{
            const row = this.CreateRow();
            if(row == null)
                return;
            row.setPosition(0, -(42 + index * 92));
            this.SetLabel(row, "文字", player.name + "  (" + player.id + ")");
            this.BindRow(row, ()=>{
                this.Pick({id:player.id, name:player.name, extra:{seat:player.seat}});
            });
        });
        this.ResizeContent(players.length);
    }

    private SeatedPlayers():{id:string;name:string;seat:number}[] {
        const result:{id:string;name:string;seat:number}[] = [];
        const parent = this.node.parent;
        const view = parent == null ? null : parent.getChildByName("panelGameView");
        const logic:DrhLogicMgr = view == null ? null : view.getComponent(DrhLogicMgr);
        if(logic == null)
            return result;
        const seen:any = {};
        for(let i = 0; i < 8; i++) {
            const ctl = logic.GetPlayerCtlByID(i);
            const info:any = ctl == null ? null : ctl.info;
            if(info == null)
                continue;
            const id = String(info.strUserID == null ? "" : info.strUserID).trim();
            if(id === "" || id === "init" || seen[id] === true)
                continue;
            seen[id] = true;
            result.push({
                id:id,
                name:String(info.strUserName == null || info.strUserName === "" ? id : info.strUserName),
                seat:Number(info.nSitNum)
            });
        }
        result.sort((a, b)=>a.seat - b.seat);
        return result;
    }

    // ------------------------------------------------------------------
    // 分组列表
    // ------------------------------------------------------------------
    private LoadGroups():void {
        if(this.groupBusy)
            return;
        const clubId = this.options.clubId != null ? String(this.options.clubId).trim() : "";
        if(clubId === "") {
            this.ShowMessage("缺少俱乐部信息，无法加载分组");
            return;
        }
        const account:any = GameDataManager.getAccount();
        if(account == null) {
            this.ShowMessage("网络未就绪，请稍后重试");
            return;
        }
        this.groupBusy = true;
        this.groupContext = "pickgrp:" + Date.now() + ":" + (++panelPlayerPicker.serial);
        this.ClearGroupTimer();
        this.ShowLoading("加载中…");
        this.groupTimer = setTimeout(()=>{
            if(this.groupContext === "")
                return;
            this.groupBusy = false;
            this.groupContext = "";
            this.ShowMessage("分组数据加载超时，请重试");
        }, 8000);
        try {
            account.reqHallCommand(JSON.stringify({
                header:"查询_俱乐部_分组列表",
                club_id:clubId,
                context:this.groupContext
            }), "P@" + this.groupContext);
        }
        catch(error) {
            this.ClearGroupTimer();
            this.groupBusy = false;
            this.groupContext = "";
            this.ShowMessage("分组请求发送失败，请重试");
        }
    }

    public OnGroupList(raw:any):void {
        const data = this.Unwrap(raw);
        if(data == null || !Array.isArray(data.groups))
            return;
        const ctx = String(data.context == null ? "" : data.context);
        if(ctx !== "" && this.groupContext !== "" && ctx !== this.groupContext)
            return;
        this.ApplyGroups(data.groups);
    }

    private ApplyGroups(list:any[]):void {
        this.ClearGroupTimer();
        this.groupBusy = false;
        this.groupContext = "";
        this.groups = list.map((item:any)=>{
            const text = (value:any):string => String(value == null ? "" : value).trim();
            return {
                id:text(item && item.group_id),
                name:text(item && item.group_name),
                memberCount:Number(item && item.member_count) || 0
            };
        }).filter((group)=>group.id !== "" && group.name !== "");
        if(this.mode === "group")
            this.RenderGroups();
    }

    private RenderGroups():void {
        if(this.rowContent == null || this.rowTemplate == null) {
            this.ShowMessage("界面资源缺失，请重新打开");
            return;
        }
        this.ClearRows();
        if(this.groups.length === 0) {
            this.ShowMessage("当前俱乐部还没有分组");
            return;
        }
        this.SetActive("面板/空状态", false);
        this.SetActive("面板/加载", false);
        this.ShowContent(true);
        this.groups.forEach((group, index)=>{
            const row = this.CreateRow();
            if(row == null)
                return;
            row.setPosition(0, -(42 + index * 92));
            this.SetLabel(row, "文字", group.name + "  (" + group.memberCount + "人)");
            this.BindRow(row, ()=>{
                this.Pick({id:group.id, name:group.name, extra:{memberCount:group.memberCount}});
            });
        });
        this.ResizeContent(this.groups.length);
    }

    public OnHallCommand(nCode:number, param:any):void {
        if(this.groupContext === "")
            return;
        const data = this.ParseReply(param);
        if(data == null)
            return;
        const ctx = String(data.context == null ? "" : data.context);
        if(ctx !== "" && ctx !== this.groupContext)
            return;
        const error = this.ErrorText(data);
        if(error === "" && (nCode === 0x200 || nCode === 0x500)) {
            // 正常走 ClubPlayerGroupList 推送；兼容直接同步返回 groups 的版本。
            if(Array.isArray(data.groups))
                this.ApplyGroups(data.groups);
            return;
        }
        this.ClearGroupTimer();
        this.groupBusy = false;
        this.groupContext = "";
        this.ShowMessage(error !== "" ? error : "分组数据加载失败，请重试");
    }

    // ------------------------------------------------------------------
    // 行与提示
    // ------------------------------------------------------------------
    private CreateRow():cc.Node {
        if(this.rowTemplate == null || this.rowContent == null)
            return null;
        const row = cc.instantiate(this.rowTemplate);
        row.active = true;
        row.parent = this.rowContent;
        row.name = "选项行_" + (++panelPlayerPicker.serial);
        return row;
    }

    private BindRow(row:cc.Node, action:()=>void):void {
        const button = row.getComponent(cc.Button);
        if(button != null)
            button.node.on("click", action, this);
    }

    private ClearRows():void {
        if(this.rowContent == null)
            return;
        for(const child of this.rowContent.children.slice()) {
            if(child.name.indexOf("选项行_") === 0)
                child.destroy();
        }
        if(this.rowTemplate != null)
            this.rowTemplate.active = false;
    }

    private ResizeContent(count:number):void {
        if(this.rowContent == null)
            return;
        const view = this.rowContent.parent;
        if(view != null)
            this.rowContent.setPosition(0, view.height / 2);
        const height = Math.max(count * 92, view == null ? 0 : view.height);
        this.rowContent.setContentSize(620, height);
        if(this.listScroll != null)
            this.listScroll.scrollToTop(0.05);
    }

    private SetScrollTop(top:number):void {
        const node = this.At("面板/列表");
        const widget = node == null ? null : node.getComponent(cc.Widget);
        if(widget != null) {
            widget.top = top;
            widget.updateAlignment();
        }
    }

    private ShowContent(show:boolean):void {
        const view = this.At("面板/列表/view");
        if(view != null)
            view.active = show;
    }

    private ShowLoading(text:string):void {
        this.ShowContent(false);
        this.SetActive("面板/空状态", false);
        const node = this.At("面板/加载");
        if(node != null) {
            const label = node.getComponent(cc.Label);
            if(label != null) label.string = text;
        }
        this.SetActive("面板/加载", true);
    }

    private ShowMessage(text:string):void {
        this.ShowContent(false);
        this.SetActive("面板/加载", false);
        this.SetActive("面板/空状态", true);
        const node = this.At("面板/空状态");
        if(node != null) {
            const label = node.getComponent(cc.Label);
            if(label != null) label.string = text;
        }
    }

    private SetManualHint(text:string, isError:boolean):void {
        const node = this.At("面板/手动提示");
        if(node == null)
            return;
        const label = node.getComponent(cc.Label);
        if(label != null) label.string = text;
        node.active = text !== "";
        node.color = isError ? cc.color(255, 120, 110, 255) : cc.color(170, 202, 224, 255);
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
            else
                break;
        }
        if(data != null && typeof data === "object" && outerContext !== "" &&
            (data.context == null || data.context === ""))
            data.context = outerContext;
        return data != null && typeof data === "object" ? data : null;
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
            if(inner == null)
                break;
            data = inner;
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

    private ClearGroupTimer():void {
        if(this.groupTimer != null) {
            clearTimeout(this.groupTimer);
            this.groupTimer = null;
        }
    }
}
