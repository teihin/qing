import UIPanelViewBase from "../common/UIPanelViewBase";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import UIManager from "../common/UIManager";
import ScrollViewEx from "../common/ScrollViewEx";
import { ShowPanelMode, ClosePanelMode } from "../common/GameDef";
import WebLoadingManager from "../common/WebLoadingManager";

var KBEngine = require("kbengine");

const {ccclass, property} = cc._decorator;

/**
 * 玩家战绩面板（BOSS 数据统计 → 玩家信息行 / 代理链行「战绩」）。
 *
 * 版式照「我的战绩」做，但去掉了顶部盾牌统计区：标题下一行就是今日/昨日/前天，
 * 列表吃满剩余高度。
 *
 * 打开方式：
 *   panelPlayerRecord.Open("121500", "昵称");
 *
 * 接口口径（`服务器文档整理/俱乐部俱乐部联盟模式V2方案-客户端接口文档.md` §1.7，v2.20）：
 * - 用 `查询_玩家_所有的牌局_信息` + `user_id`（2026-11-06 新增，缺省=自己），
 *   回包路由仍是 `PlayerAllScore`；
 * - **只有本人或平台 boss 能指定 `user_id`**，俱乐部创建者/联盟总群主会被服务端拒绝
 *   （`无权查询该玩家战绩`）。数据统计面板本身只对 `IsBossAccount()` 开放，所以走这条是对的；
 * - 它是**全局战绩**：不按 `club_guuid` 过滤，玩家在大厅/其它俱乐部的记录也会返回。
 *   要「只看本俱乐部内的战绩」得用 `查询_俱乐部_玩家_参与的牌局_信息`（`club_id`+`user_id`，
 *   没有 `date`，按 `club_guuid` 隔离），**两套接口不要混用**。
 */
@ccclass
export default class panelPlayerRecord extends UIPanelViewBase {

    /** 战绩行的行高 + 间距，用来按列表高度换算一页能放几条。 */
    private static ROW_PITCH:number = 108;

    private scrollRecordList:ScrollViewEx = null;
    private userId:string = "";
    private userName:string = "";
    /** 只在「按俱乐部口径」时才用得上；全局战绩不按 club_guuid 过滤，请求里不带它。 */
    private clubId:string = "";
    private pageCount:number = 9;
    /** 请求在途：只有自己发起的回包才渲染，避免和「我的战绩」的推送互相顶替。 */
    private pending:boolean = false;
    private timeoutTimer:any = null;

    public static Open(userId:string, userName:string = "", clubId:string = ""):void {
        UIManager.getInstance().showPanel("panelPlayerRecord", ShowPanelMode.Cover,
            JSON.stringify({userId:userId, name:userName, clubId:clubId}));
    }

    onLoad () {
        super.onLoad();
        // 从数据统计（基准 0 或牌桌里的 1）里点开，压在它和玩家资料之上即可。
        // 写死 220 之类的绝对层级会把大厅里后开的弹窗全压到它下面。
        this.node.zIndex = Tool.PanelBaseZ(this.node) + 2;
        const list = Tool.GetChild(this.node, "战绩列表");
        this.scrollRecordList = list ? list.getComponent(ScrollViewEx) : null;
        KBEngine.Event.register("PlayerAllScore", this, "OnPlayerAllScore");
        // 被服务端拒绝（无权查询该玩家战绩 / 参数错误）时会有 0x3xx 回执，认掉它就不用干等超时。
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
    }

    start () {
        this.ReadInput();
        this.RefreshTitle();
        this.pageCount = this.PageCapacity();
        this.GetAllRecord(0);
    }

    onDestroy () {
        this.ClearTimeout();
        super.onDestroy();
    }

    // ------------------------------------------------------------------
    // 入参
    // ------------------------------------------------------------------
    private ReadInput():void {
        try {
            const data:any = JSON.parse(this.strUserData || "{}");
            this.userId = String(data.userId || data.user_id || "").trim();
            this.userName = String(data.name || data.userName || "").trim();
            this.clubId = String(data.clubId || data.club_id || "").trim();
        }
        catch(error) {
            this.userId = "";
        }
    }

    private RefreshTitle():void {
        const title = Tool.GetChild(this.node, "标题栏/标题文字");
        if(title && title.getComponent(cc.Label))
            title.getComponent(cc.Label).string = "玩家战绩";
        const who = Tool.GetChild(this.node, "标题栏/玩家");
        const label = who ? who.getComponent(cc.Label) : null;
        if(label == null)
            return;
        if(this.userName !== "")
            label.string = this.userName + "  ID:" + this.userId;
        else
            label.string = this.userId !== "" ? "ID:" + this.userId : "";
    }

    /** 一页放几条：按列表实际高度换算，长屏自动多放几行。 */
    private PageCapacity():number {
        const list = Tool.GetChild(this.node, "战绩列表");
        const height = list ? list.height : 0;
        if(height <= 0)
            return 9;
        const count = Math.floor((height + 12) / panelPlayerRecord.ROW_PITCH);
        return Math.max(6, Math.min(15, count));
    }

    // ------------------------------------------------------------------
    // 请求
    // ------------------------------------------------------------------
    public GetAllRecord(nPage:number = 0):void {
        const account:any = GameDataManager.getAccount();
        if(account == null) {
            this.ShowState("error", "网络未就绪，请稍后重试");
            return;
        }
        // 文档里 user_id 可选、缺省=自己：没带玩家ID就退回查本人，不把面板卡成错误态。
        if(this.userId === "") {
            this.userId = String(account.guuid == null ? "" : account.guuid).trim();
            this.RefreshTitle();
        }
        if(this.userId === "") {
            this.ShowState("error", "缺少玩家ID，无法查询战绩");
            return;
        }
        const container = Tool.GetChild(this.node, "条件");
        const toggles:cc.Toggle[] = container && container.getComponent(cc.ToggleContainer) ?
            container.getComponent(cc.ToggleContainer).toggleItems : [];
        let date:string = "0";
        for(const item of toggles) {
            if(item == null)
                continue;
            if(item.isChecked) {
                date = item.node.name;
                break;
            }
        }

        this.pending = true;
        this.ShowState("loading", "正在查询战绩…");
        this.StartTimeout();

        const param:any = {
            header:"查询_玩家_所有的牌局_信息",
            date:date,
            page:String(nPage),
            count:String(this.pageCount),
            user_id:this.userId
        };
        try {
            account.reqHallCommand(JSON.stringify(param), "P@查询_玩家_所有的牌局_信息");
        }
        catch(error) {
            this.pending = false;
            this.ClearTimeout();
            this.ShowState("error", "请求发送失败，请稍后重试");
        }
    }

    private StartTimeout():void {
        this.ClearTimeout();
        this.timeoutTimer = setTimeout(()=>{
            if(!this.pending)
                return;
            this.pending = false;
            this.ShowState("error", "查询超时，请稍后重试");
        }, 12000);
    }

    private ClearTimeout():void {
        if(this.timeoutTimer != null) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
    }

    /** 结束这次请求：清 in-flight 标记 + 清超时定时器。 */
    private FinishPending():void {
        this.pending = false;
        this.ClearTimeout();
    }

    // ------------------------------------------------------------------
    // 回包
    // ------------------------------------------------------------------
    /**
     * 命令回执。数据本身走 `PlayerAllScore` 推送，这里只处理失败：
     * 指定 `user_id` 时服务端只放行本人/平台 boss，被拒会回「无权查询该玩家战绩」，
     * 认掉它就地显示，不必干等到 12s 超时。
     */
    public onHallCommand(nCode:number, param:string):void {
        if(!this.pending)
            return;
        const text = param == null ? "" : String(param);
        // 0x200 只代表命令已受理，数据在推送里；推送迟到时由超时兜底。
        if(nCode === 0x200)
            return;
        // 下层的「数据统计」面板也在收自己的回执（分组/代理链），别把它的错误算到自己头上。
        if(text.indexOf("查询_玩家_所有的牌局_信息") < 0 &&
            /查询_俱乐部|设置_俱乐部|创建_俱乐部|删除_俱乐部|添加_俱乐部|修改_俱乐部|代理链路/.test(text))
            return;
        this.FinishPending();
        const error = this.ErrorText(text);
        if(error.indexOf("无权查询该玩家战绩") >= 0)
            this.ShowState("error", "无权查询该玩家战绩（仅本人或平台 boss 可查）");
        else
            this.ShowState("error", error);
    }

    private ErrorText(param:string):string {
        try {
            const data:any = JSON.parse(param);
            const result:any = data && data.result !== undefined ? data.result : data;
            if(typeof result === "string")
                return result;
            if(result && result.error)
                return String(result.error);
        }
        catch(error) {}
        return "查询失败，请稍后重试";
    }

    public OnPlayerAllScore(strMsg:any):void {
        if(!this.pending)
            return;
        let data:any = strMsg;
        if(typeof data === "string") {
            try { data = JSON.parse(data); }
            catch(error) { return; }
        }
        if(data == null || typeof data !== "object")
            return;
        let jList:any = data["PlayerAllScore"];
        if(jList === undefined && data.result && typeof data.result === "object")
            jList = data.result["PlayerAllScore"];
        if(jList === undefined && typeof data.result === "string") {
            try {
                const inner:any = JSON.parse(data.result);
                jList = inner ? inner["PlayerAllScore"] : undefined;
            }
            catch(error) {}
        }
        if(!Array.isArray(jList)) {
            // 不是战绩列表（别的面板的推送）就交还原来的等待状态。
            return;
        }

        this.FinishPending();
        if(this.scrollRecordList == null) {
            this.ShowState("error", "界面资源缺失，请重新打开");
            return;
        }

        // 空列表也要清掉上一次页码状态，防止继续请求旧分页。
        this.scrollRecordList.nCurPage = 0;
        this.scrollRecordList.nTotlePage = 0;
        const content = this.scrollRecordList.content;
        for(let i=0;i<jList.length;i++) {
            const jItem = jList[i];
            this.scrollRecordList.nCurPage = Number(jItem["number"]);
            this.scrollRecordList.nTotlePage = Math.ceil(Number(jItem["count"]) /
                Math.max(1, Number(this.pageCount)));

            if(i >= content.childrenCount) {
                WebLoadingManager.loadBlockingRes("Prefabs/战绩对象", "正在加载战绩列表", (err,obj)=>{
                    if(err) {
                        cc.error(err.message || err);
                        return null;
                    }
                    const node = cc.instantiate(obj);
                    node.parent = content;
                    this.SetRecordItemInfo(node, jItem);
                });
            }
            else {
                this.SetRecordItemInfo(content.children[i], jItem);
            }
        }

        // 多出来的行删掉。
        const arrayDel:cc.Node[] = [];
        for(let i=jList.length;i<content.childrenCount;i++)
            arrayDel.push(content.children[i]);
        for(const item of arrayDel)
            item.destroy();

        const displayPageCount = Math.max(1, this.scrollRecordList.nTotlePage);
        this.SetPageLabel((this.scrollRecordList.nCurPage + 1).toString() + "/" +
            displayPageCount.toString());

        if(jList.length === 0)
            this.ShowState("empty", "该玩家暂无战绩");
        else
            this.ShowState("done");
        if(this.scrollRecordList.nCurPage === 0)
            this.scrollRecordList.scrollToTop(0);
    }

    private SetRecordItemInfo(node:cc.Node, jItem:any):void {
        node.active = true;
        const rawRemark = jItem["all_remark"];
        const remark:any[] = Array.isArray(rawRemark) ? rawRemark :
            (rawRemark == null ? [] : rawRemark.toString().split(','));
        let buyIn:string = "--";
        if(remark.length > 1 && remark[1] != null) {
            const rawBuyIn = remark[1].toString().trim();
            if(rawBuyIn !== "" && isFinite(Number(rawBuyIn)) && Number(rawBuyIn) >= 0)
                buyIn = rawBuyIn;
        }

        const room = node.getChildByName("房间号");
        if(room && room.getComponent(cc.Label))
            room.getComponent(cc.Label).string = String(jItem["room_id"] == null ? "" : jItem["room_id"]);
        const bring = node.getChildByName("带入");
        if(bring && bring.getComponent(cc.Label))
            bring.getComponent(cc.Label).string = buyIn;
        const base = node.getChildByName("底皮");
        if(base && base.getComponent(cc.Label))
            base.getComponent(cc.Label).string = remark.length > 5 && remark[5] != null ?
                remark[5].toString() : "--";
        const scoreNode = node.getChildByName("输赢");
        if(scoreNode && scoreNode.getComponent(cc.Label)) {
            scoreNode.getComponent(cc.Label).string = String(jItem["score"] == null ? "" : jItem["score"]);
            const score = Number(jItem["score"]);
            // 行是复用的，0 分要显式刷回默认色，否则会留着上一行的红/绿。
            if(score > 0)
                scoreNode.color = cc.color(246,63,54,255);
            else if(score < 0)
                scoreNode.color = cc.color(139,188,25,255);
            else
                scoreNode.color = cc.color(255,255,255,255);
        }

        // 点行看这局的牌局回顾（与「我的战绩」一致）。
        const btn = node.getComponent(cc.Button);
        if(btn) {
            btn.node.targetOff(this);
            btn.node.on("click", ()=>{
                const roomNode = node.getChildByName("房间号");
                const strRoomID = roomNode && roomNode.getComponent(cc.Label) ?
                    roomNode.getComponent(cc.Label).string : "";
                if(strRoomID === "" || strRoomID === "null")
                    return;
                // browse:true —— 这是数据统计里查别人的历史局，不是本局结算。
                // 带这个标记进去，结算详情的「关闭/返回」只关窗口，不退房回大厅。
                UIManager.getInstance().showPanel("panelRecordInfo", ShowPanelMode.Cover,
                    JSON.stringify({roomId:strRoomID, browse:true}));
            }, this);
        }
    }

    // ------------------------------------------------------------------
    // 状态
    // ------------------------------------------------------------------
    private SetPageLabel(text:string):void {
        const node = Tool.GetChild(this.node, "分页/页码");
        const label = node ? node.getComponent(cc.Label) : null;
        if(label)
            label.string = text;
    }

    private ShowState(kind:string, text:string = ""):void {
        const loading = Tool.GetChild(this.node, "加载");
        const empty = Tool.GetChild(this.node, "空状态");
        const error = Tool.GetChild(this.node, "错误");
        const write = (node:cc.Node, value:string)=>{
            const label = node ? node.getComponent(cc.Label) : null;
            if(label)
                label.string = value;
        };
        if(loading)
            loading.active = kind === "loading";
        if(empty)
            empty.active = kind === "empty";
        if(error)
            error.active = kind === "error";
        if(kind === "loading" && text !== "")
            write(loading, text);
        if(kind === "empty" && text !== "")
            write(empty, text);
        if(kind === "error")
            write(error, text !== "" ? text : "查询失败，请稍后重试");
        if(kind !== "done")
            return;
        for(const one of [loading, empty, error]) {
            if(one)
                one.active = false;
        }
    }

    // ------------------------------------------------------------------
    // 交互
    // ------------------------------------------------------------------
    public onButtonClick(button:cc.Button):void {
        const name = button.node.name;
        if(name === "返回" || name === "关闭") {
            UIManager.getInstance().closePanelByName(this.node.name, ClosePanelMode.Normal);
            return;
        }
        if(name === "首页") {
            this.GetAllRecord(0);
            return;
        }
        if(name === "上一页") {
            if(this.scrollRecordList == null || this.scrollRecordList.nCurPage <= 0)
                return;
            this.GetAllRecord(this.scrollRecordList.nCurPage - 1);
            return;
        }
        if(name === "下一页") {
            if(this.scrollRecordList == null ||
                this.scrollRecordList.nCurPage + 1 >= this.scrollRecordList.nTotlePage)
                return;
            this.GetAllRecord(this.scrollRecordList.nCurPage + 1);
            return;
        }
        if(name === "尾页") {
            if(this.scrollRecordList == null || this.scrollRecordList.nTotlePage === 0)
                return;
            this.GetAllRecord(this.scrollRecordList.nTotlePage - 1);
            return;
        }
    }

    public onToggleClick(toggle:cc.Toggle):void {
        if(toggle == null || toggle.node == null || toggle.node.parent == null)
            return;
        if(toggle.node.parent.name !== "条件")
            return;
        this.GetAllRecord(0);
    }
}
