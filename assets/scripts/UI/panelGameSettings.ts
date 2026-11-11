import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import Debug from "../common/Debug";
import { ShowPanelMode } from "../common/GameDef";
import { resolveRoomClubId } from "../logic/RoomClubContext";
import ConfigManager from "../logic/ConfigManager";

var KBEngine = require("kbengine");

const { ccclass } = cc._decorator;

/** 服务端字典键；第 5 档服务端叫「丁二皇」，界面按用户要求显示「单独丁儿皇」。 */
const REWARD_TIER_KEYS: string[] = ["天皇", "地皇", "朵皇", "朵朵", "丁二皇"];
const REWARD_TIER_LABELS: string[] = ["天皇", "地皇", "朵皇", "朵朵", "单独丁儿皇"];
/** 底皮奖池余额：服务端按底皮全名返回/写入，单位分。 */
const DIPI_KEYS: string[] = ["底皮0.1/0.3", "底皮0.2/0.5", "底皮1/3", "底皮2/5",
    "底皮5/10", "底皮10/20", "底皮20/40", "底皮50/100"];
const DIPI_LABELS: string[] = ["0.1/0.3", "0.2/0.5", "1/3", "2/5",
    "5/10", "10/20", "20/40", "50/100"];
const BILI_QUICK: number[] = [5, 10, 20, 25];
const BALANCE_QUICK: number[] = [100, 500, 1000, 5000];
/** 与后台奖池金额上限同量级，避免输入异常值。 */
const MAX_BALANCE_FEN = 1000000000000;
/** 池级配置未设置时服务端返回 0（不派奖），界面初值一律 0；下面是开关打开时的兜底档位。 */
const FALLBACK_BILI: number[] = [20, 10, 10, 2, 2];
/** 牌型比例允许两位小数（如 0.5%），按百分比原值下发。 */
const BILI_DECIMALS = 2;

/** 创建游戏规则只开放 1/3 起的 5 档底皮；0.1/0.2、50/100 不在前台提供。 */
const RULE_DIPI_KEYS: string[] = ["1", "2", "5", "10", "20"];
const RULE_DIPI_LABELS: string[] = ["1/3", "2/5", "5/10", "10/20", "20/40"];
const RULE_DIPI_ADMIT: number[] = [50, 100, 250, 500, 1000];
const RULE_WATER_QUICK: number[] = [0, 2, 3, 5, 10];
const RULE_DARK_QUICK: number[] = [0, 1, 2, 3, 5];
const RULE_WATER_MAX = 20;
const RULE_ROW_HEIGHT = 250;
const RULE_ROW_GAP = 16;
/** 创建/删除要等服务端推送 ClubPlayList，超时后只提示重开查看，不重复提交。 */
const RULE_TIMEOUT = 6;

/** 后台按俱乐部放行的暗抽开关：usr_hash_info 的「暗抽_俱乐部_<clubId>」。 */
const DARK_HASH_KEY_PREFIX = "暗抽_俱乐部_";
const DARK_HASH_CONTEXT_PREFIX = "暗抽开关_";
/** 哈希查询超时按关闭处理，避免网络异常时一直停留在旧状态。 */
const DARK_HASH_TIMEOUT = 5;
/**
 * 关闭暗抽后整项隐藏，需要把创建规则弹窗收紧：
 * 顶部组下移 76、下方组上移 96，内容重新居中，面板高度保持 1080。
 * 数值按当前 Prefab（702x1080）推导；改布局后要同步复核。
 */
const DARK_COMPACT_TOP_SHIFT = -76;
const DARK_COMPACT_BOTTOM_SHIFT = 96;

const DARK_UI_NAMES: string[] = [
    "暗抽标题", "暗抽说明", "暗抽右侧",
    "暗抽减", "暗抽值", "暗抽加", "暗抽提示"
];
for (let i = 0; i < RULE_DARK_QUICK.length; i++)
    DARK_UI_NAMES.push("暗抽快捷_" + i);

const CREATE_TOP_NAMES: string[] = [
    "标题", "副标题", "底皮标题", "底皮说明", "地九王行",
    "抽水标题", "抽水说明", "抽水右侧",
    "抽水减", "抽水值", "抽水加", "抽水提示"
];
for (let i = 0; i < RULE_DIPI_KEYS.length; i++)
    CREATE_TOP_NAMES.push("底皮_" + i);
for (let i = 0; i < RULE_WATER_QUICK.length; i++)
    CREATE_TOP_NAMES.push("抽水快捷_" + i);

const CREATE_BOTTOM_NAMES: string[] = [
    "同步带入钻石行", "自动信息", "创建提示", "房费提示",
    "创建规则取消", "创建规则确认"
];

type ConfigKind = "bili" | "pool" | "balance";
type DialogKind = "bili" | "balance";

@ccclass
export default class panelGameSettings extends UIPanelViewBase {

    private bili: number[] = [0, 0, 0, 0, 0];
    private biliOn: boolean[] = [false, false, false, false, false];
    /** 关掉开关前的比例，重新打开时恢复。 */
    private lastBili: number[] = [0, 0, 0, 0, 0];
    /** 8 个底皮的奖池余额，单位分。 */
    private balance: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

    private editingIndex: number = -1;
    private editingKind: DialogKind = "bili";
    private editingBalanceIndex: number = -1;
    private poolType: string = "";

    private saving: boolean = false;
    private savingKind: ConfigKind = "bili";
    /** 本次保存使用的池键；回包池键不一致时拒绝应用。 */
    private savingPoolKey: string = "";
    /** 读取配置时使用的俱乐部；保存沿用同一个，避免切换俱乐部后读写串池。 */
    private contextClubId: string = "";
    private loading: boolean = false;
    private loaded: boolean = false;
    private poolKey: string = "";
    /** 池级总开关 reward_on：默认关闭，关闭时不进池、不派奖。 */
    private poolOn: boolean = false;
    private warnedReadFailure: boolean = false;

    // ---------------------------------------------------------------- 游戏规则页
    private activeTab: number = 0;
    private tabNodes: cc.Node[] = [];
    private tabOnFrame: cc.SpriteFrame = null;
    private tabOffFrame: cc.SpriteFrame = null;
    private chipFrame: cc.SpriteFrame = null;

    private rulesCard: cc.Node = null;
    private rulesScroll: cc.Node = null;
    private rulesView: cc.Node = null;
    private rulesContent: cc.Node = null;
    private ruleTemplate: cc.Node = null;
    private ruleRows: cc.Node[] = [];
    private rules: any[] = [];
    private rulesClubId: string = "";
    private rulesLoaded: boolean = false;
    private rulesLoading: boolean = false;
    private rulesPending: boolean = false;
    private rulesContext: string = "";
    private rulesQueryToken: number = 0;
    private rulesRetry: number = 0;

    private createDialog: cc.Node = null;
    private deleteDialog: cc.Node = null;
    private createIndex: number = 0;
    private createNine: boolean = false;
    private createWater: number = 0;
    private createDark: number = 0;
    /** 同步带入钻石（服务端 special_rule 的「入座扣钻」），默认关闭。 */
    private createSeatStone: boolean = false;
    private createPending: boolean = false;
    private deletePending: boolean = false;
    private deleteRule: any = null;
    private deletePlayId: string = "";

    // ---------------------------------------------------------------- 暗抽开关
    /** 后台是否给当前俱乐部放行暗抽；默认关闭，等哈希回包再显示。 */
    private darkEnabled: boolean = false;
    /** 当前已查询/已应用的俱乐部 ID，用于忽略切换俱乐部后的旧回包。 */
    private darkClubId: string = "";
    private darkPendingContext: string = "";
    private darkPendingAt: number = 0;
    /** 创建规则弹窗各节点的原始 y，关闭暗抽时按相对偏移收紧布局。 */
    private darkLayoutBase: {[name: string]: number} = {};
    private darkLayoutCompact: boolean = false;

    onLoad() {
        super.onLoad();
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
        KBEngine.Event.register("ClubPlayList", this, "onClubPlayList");
        KBEngine.Event.register("ClubPlayResult", this, "onClubPlayResult");
        KBEngine.Event.register("ConsumeStonePriceUpdated", this, "onConsumeStonePriceUpdated");
        KBEngine.Event.register("ClubSeatStoneRatioUpdated", this, "onClubSeatStoneRatioUpdated");
        KBEngine.Event.register("UserHashInfo", this, "onUserHashInfo");
        KBEngine.Event.register("UserHashError", this, "onUserHashError");
        this.initRuleUi();
    }

    onEnable() {
        this.warnedReadFailure = false;
        this.saving = false;
        this.loading = false;
        this.savingPoolKey = "";
        this.createPending = false;
        this.deletePending = false;
        this.rulesPending = false;
        this.rulesLoading = false;
        this.hideCreateDialog();
        this.hideDeleteDialog();
        this.selectTab(0);
        this.requestDarkState(true);
        this.refreshRows();
    }

    onDisable() {
        this.createPending = false;
        this.deletePending = false;
        this.rulesPending = false;
        this.rulesLoading = false;
        this.unscheduleAllCallbacks();
    }

    // ---------------------------------------------------------------- 入口按钮

    public onButtonClick(button: cc.Button) {
        const name = button.node.name;
        if (name === "返回") {
            UIManager.getInstance().closePanelByName(this.node.name);
            return;
        }
        if (name === "弹窗取消" || name === "弹窗遮罩") {
            this.hidePercentDialog();
            return;
        }
        if (name === "弹窗确定") {
            this.confirmDialog();
            return;
        }
        if (name === "快捷5" || name === "快捷10" || name === "快捷20" || name === "快捷25") {
            const quickIndex = BILI_QUICK.indexOf(Number(name.replace("快捷", "")));
            if (quickIndex < 0) return;
            this.setDialogValue(this.editingKind === "balance"
                ? BALANCE_QUICK[quickIndex] * 100
                : BILI_QUICK[quickIndex]);
            return;
        }
        if (name === "池总开关") {
            this.togglePool();
            return;
        }
        if (name.indexOf("页签_") === 0) {
            this.selectTab(Number(name.replace("页签_", "")));
            return;
        }
        // ------------------------------------------------------------ 游戏规则
        if (name === "创建游戏规则") {
            this.openCreateDialog();
            return;
        }
        if (name === "创建规则遮罩" || name === "创建规则取消") {
            if (!this.createPending) this.hideCreateDialog();
            return;
        }
        if (name === "创建规则确认") {
            this.submitCreate();
            return;
        }
        if (name === "删除规则遮罩" || name === "删除规则取消") {
            if (!this.deletePending) this.hideDeleteDialog();
            return;
        }
        if (name === "删除规则确认") {
            this.submitDelete();
            return;
        }
        if (name.indexOf("底皮_") === 0) {
            this.selectCreateDipi(Number(name.replace("底皮_", "")));
            return;
        }
        if (name === "地九王开关") {
            this.toggleCreateNine();
            return;
        }
        if (name === "同步带入钻石开关") {
            this.toggleCreateSeatStone();
            return;
        }
        if (name === "抽水减" || name === "抽水加") {
            this.stepCreateWater(name === "抽水加" ? 1 : -1);
            return;
        }
        if (name === "暗抽减" || name === "暗抽加") {
            if (!this.darkEnabled) return;
            this.stepCreateDark(name === "暗抽加" ? 1 : -1);
            return;
        }
        if (name.indexOf("抽水快捷_") === 0) {
            const index = Number(name.replace("抽水快捷_", ""));
            if (index >= 0 && index < RULE_WATER_QUICK.length)
                this.setCreateWater(RULE_WATER_QUICK[index]);
            return;
        }
        if (name.indexOf("暗抽快捷_") === 0) {
            if (!this.darkEnabled) return;
            const index = Number(name.replace("暗抽快捷_", ""));
            if (index >= 0 && index < RULE_DARK_QUICK.length)
                this.setCreateDark(RULE_DARK_QUICK[index]);
            return;
        }
        if (name.indexOf("开关_") === 0) {
            this.toggleBili(Number(name.replace("开关_", "")));
            return;
        }
        if (name.indexOf("比例_") === 0) {
            this.openBiliDialog(Number(name.replace("比例_", "")));
            return;
        }
        if (name.indexOf("数量_") === 0) {
            this.openBalanceDialog(Number(name.replace("数量_", "")));
            return;
        }
    }

    // ---------------------------------------------------------------- 界面刷新

    private refreshRows() {
        this.refreshPoolSwitch();
        this.refreshListEnabled();
        this.refreshBiliRows();
        this.refreshBalanceRows();
        this.refreshTotal();
    }

    private refreshPoolSwitch() {
        const sw = Tool.GetChild(this.node, "卡片/池总开关行/池总开关");
        if (!sw) return;
        const on = sw.getChildByName("开");
        const off = sw.getChildByName("关");
        if (on) on.active = this.poolOn;
        if (off) off.active = !this.poolOn;
    }

    /** 总开关关闭时，整个滚动区（牌型比例 + 底皮奖池数量）置灰且不可修改。 */
    private refreshListEnabled() {
        const content = Tool.GetChild(this.node, "卡片/滚动/view/content");
        if (content) content.opacity = this.poolOn ? 255 : 120;
    }

    private refreshBiliRows() {
        for (let i = 0; i < REWARD_TIER_KEYS.length; i++) {
            const row = Tool.GetChild(this.node, "卡片/滚动/view/content/行_" + i);
            if (!row) continue;
            const chip = Tool.GetChild(row, "比例_" + i);
            const label = chip ? chip.getChildByName("数值").getComponent(cc.Label) : null;
            if (label) label.string = this.formatBili(this.bili[i]) + "%";
            const on = Tool.GetChild(row, "开关_" + i + "/开");
            const off = Tool.GetChild(row, "开关_" + i + "/关");
            if (on) on.active = this.biliOn[i];
            if (off) off.active = !this.biliOn[i];
            if (chip) chip.opacity = this.biliOn[i] ? 255 : 110;
        }
    }

    private refreshBalanceRows() {
        for (let i = 0; i < DIPI_KEYS.length; i++) {
            const label = Tool.GetChild(this.node,
                "卡片/滚动/view/content/底皮行_" + i + "/数量_" + i + "/数值");
            if (!label) continue;
            const comp = label.getComponent(cc.Label);
            if (comp) comp.string = this.formatBalanceLabel(this.balance[i]);
        }
    }

    private formatBalanceValue(fen: number): string {
        const value = Math.max(0, Math.floor(fen || 0));
        return value % 100 === 0 ? String(value / 100) : (value / 100).toFixed(2);
    }

    private normalizeBili(value: any): number {
        const num = Number(value);
        if (!isFinite(num)) return 0;
        const clamped = Math.max(0, Math.min(100, num));
        return Math.round(clamped * 100) / 100;
    }

    /** 比例展示去掉多余 0：0.50 → 0.5，10.00 → 10。 */
    private formatBili(value: number): string {
        return this.normalizeBili(value).toFixed(BILI_DECIMALS)
            .replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    }

    private formatBalanceLabel(fen: number): string {
        return this.formatBalanceValue(fen) + " 元";
    }

    private refreshTotal() {
        const sub = Tool.GetChild(this.node, "卡片/卡片说明");
        if (sub) {
            const subLabel = sub.getComponent(cc.Label);
            if (subLabel) subLabel.string = "各牌型比例与底皮奖池数量"
                + (this.contextClubId ? " · 俱乐部 " + this.contextClubId : "");
        }
        const node = Tool.GetChild(this.node, "卡片/合计");
        if (!node) return;
        const label = node.getComponent(cc.Label);
        const scope = this.poolType === "union" ? "（联盟共用）" : "";
        const prefix = this.poolKey ? "奖池 " + this.poolKey + scope + " · " : "";
        if (!this.poolOn) {
            label.string = prefix + "池未开启：不进池、不派奖，奖池配置不可修改";
            return;
        }
        let total = 0;
        for (let i = 0; i < this.bili.length; i++) total += this.biliOn[i] ? this.bili[i] : 0;
        label.string = prefix + "合计 " + this.formatBili(total) + "% · "
            + (total > 0 ? "各档独立按底皮奖池计算" : "该池未配置时不派奖");
    }

    // ---------------------------------------------------------------- 开关 / 弹窗

    private ensureLoaded(): boolean {
        if (this.loaded) return true;
        UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover,
            this.loading ? "正在读取奖池配置，请稍候" : "奖池配置未就绪，请重新打开");
        return false;
    }

    private ensurePoolOn(): boolean {
        if (this.poolOn) return true;
        UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "请先打开奖池总开关");
        return false;
    }

    private togglePool() {
        if (!this.ensureLoaded()) return;
        if (this.saving) return;
        this.poolOn = !this.poolOn;
        this.refreshRows();
        this.saveConfig("pool");
    }

    private toggleBili(index: number) {
        if (!this.ensureLoaded()) return;
        if (!this.ensurePoolOn()) return;
        if (this.saving) return;
        if (this.biliOn[index]) {
            this.lastBili[index] = this.bili[index] > 0 ? this.bili[index] : this.lastBili[index];
            this.bili[index] = 0;
            this.biliOn[index] = false;
        } else {
            this.bili[index] = this.lastBili[index] > 0
                ? this.normalizeBili(this.lastBili[index])
                : Math.min(100, FALLBACK_BILI[index] || 1);
            this.biliOn[index] = true;
        }
        this.refreshRows();
        this.saveConfig("bili");
    }

    private openBiliDialog(index: number) {
        if (!this.ensureLoaded()) return;
        if (!this.ensurePoolOn()) return;
        this.editingKind = "bili";
        this.editingIndex = index;
        this.editingBalanceIndex = -1;
        this.showDialog();
        this.setLabel("弹窗/面板/标题", "修改奖池比例");
        this.setLabel("弹窗/面板/副标题", "当前牌型：" + REWARD_TIER_LABELS[index]);
        this.setQuickLabels(["5%", "10%", "20%", "25%"]);
        this.setDialogMode(6, this.biliInputMode());

        let others = 0;
        for (let i = 0; i < this.bili.length; i++) {
            if (i !== index && this.biliOn[i]) others += this.bili[i];
        }
        others = this.normalizeBili(others);
        this.setLabel("弹窗/面板/提示",
            "其余牌型共占 " + this.formatBili(others) + "%，本项最多可改到 "
            + this.formatBili(Math.max(0, 100 - others)) + "%");
        this.setDialogValue(this.bili[index]);
    }

    private openBalanceDialog(index: number) {
        if (!this.ensureLoaded()) return;
        if (!this.ensurePoolOn()) return;
        if (index < 0 || index >= DIPI_KEYS.length) return;
        this.editingKind = "balance";
        this.editingIndex = -1;
        this.editingBalanceIndex = index;
        this.showDialog();
        this.setLabel("弹窗/面板/标题", "修改底皮奖池");
        this.setLabel("弹窗/面板/副标题", "当前底皮：底皮 " + DIPI_LABELS[index]);
        this.setQuickLabels(["100", "500", "1000", "5000"]);
        this.setDialogMode(12, 0);
        this.setLabel("弹窗/面板/提示", "单位：元，覆盖写入；当前 " + this.formatBalanceLabel(this.balance[index]));
        this.setDialogValue(this.balance[index]);
    }

    private setQuickLabels(labels: string[]) {
        const names = ["快捷5", "快捷10", "快捷20", "快捷25"];
        for (let i = 0; i < names.length && i < labels.length; i++)
            this.setLabel("弹窗/面板/" + names[i] + "/文字", labels[i]);
    }

    private biliInputMode(): number {
        // 原生端用小数键盘；网页端 input type=number 会吞掉「0.」里的点，退回文本输入。
        return cc.sys.isNative ? cc.EditBox.InputMode.DECIMAL : cc.EditBox.InputMode.ANY;
    }

    private setDialogMode(maxLength: number, inputMode: number) {
        const edit = this.editBox();
        if (!edit) return;
        edit.maxLength = maxLength;
        (edit as any).inputMode = inputMode;
        if (inputMode === cc.EditBox.InputMode.ANY && this.editingKind === "bili") {
            // 网页版 <input type=number> 会把「0.」判为非法值、吞掉小数点，比例改用文本框输入；
            // ANY 会把引擎自带的输入/占位标签改成顶部对齐，这里恢复居中单行。
            this.restoreDialogLabels(edit);
            const elem: any = (edit as any)._impl && (edit as any)._impl._elem;
            if (elem && elem.setAttribute) elem.setAttribute("inputmode", "decimal");
        }
        const placeholder = Tool.GetChild(this.node, "弹窗/面板/输入/PLACEHOLDER_LABEL");
        if (placeholder) {
            const label = placeholder.getComponent(cc.Label);
            if (label) label.string = this.editingKind === "balance" ? "0.00" : "0-100，可填小数";
        }
    }

    private restoreDialogLabels(edit: cc.EditBox) {
        const text = edit.textLabel;
        if (text) {
            text.verticalAlign = cc.Label.VerticalAlign.CENTER;
            text.enableWrapText = false;
        }
        const placeholder = edit.placeholderLabel;
        if (placeholder) {
            placeholder.verticalAlign = cc.Label.VerticalAlign.CENTER;
            placeholder.enableWrapText = false;
        }
    }

    private showDialog() {
        const dialog = Tool.GetChild(this.node, "弹窗");
        if (dialog) dialog.active = true;
    }

    private setLabel(path: string, text: string) {
        const node = Tool.GetChild(this.node, path);
        if (node) node.getComponent(cc.Label).string = text;
    }

    private hidePercentDialog() {
        this.editingIndex = -1;
        this.editingBalanceIndex = -1;
        this.editingKind = "bili";
        const dialog = Tool.GetChild(this.node, "弹窗");
        if (dialog) dialog.active = false;
    }

    private editBox(): cc.EditBox {
        const node = Tool.GetChild(this.node, "弹窗/面板/输入");
        return node ? node.getComponent(cc.EditBox) : null;
    }

    private setDialogValue(value: number) {
        const edit = this.editBox();
        if (!edit) return;
        if (this.editingKind === "balance") {
            edit.string = this.formatBalanceValue(value);
            return;
        }
        edit.string = this.formatBili(value);
    }

    private confirmDialog() {
        if (this.saving) return;
        const edit = this.editBox();
        if (!edit) {
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "输入框未就绪，请重新打开");
            return;
        }
        if (this.editingKind === "balance") {
            if (!this.ensurePoolOn()) return;
            const index = this.editingBalanceIndex;
            if (index < 0) return;
            const raw = (edit.string || "").trim();
            if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover,
                    "请输入 0 以上的金额，最多两位小数");
                return;
            }
            const fen = Math.round(Number(raw) * 100);
            if (!isFinite(fen) || fen < 0 || fen > MAX_BALANCE_FEN) {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "金额超出范围");
                return;
            }
            this.balance[index] = fen;
            this.hidePercentDialog();
            this.refreshRows();
            this.saveConfig("balance", index);
            return;
        }

        if (this.editingIndex < 0) return;
        const raw = (edit.string || "").trim();
        if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover,
                "请输入 0-100 的比例，最多两位小数");
            return;
        }
        const value = this.normalizeBili(Number(raw));
        if (value < 0 || value > 100) {
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "请输入 0-100 的比例");
            return;
        }
        const index = this.editingIndex;
        this.bili[index] = value;
        this.biliOn[index] = value > 0;
        if (value > 0) this.lastBili[index] = value;
        this.hidePercentDialog();
        this.refreshRows();
        this.saveConfig("bili");
    }

    // ---------------------------------------------------------------- 游戏规则页

    private initRuleUi() {
        if (this.tabNodes.length > 0) return;
        for (let i = 0; i < 2; i++) {
            const tab = Tool.GetChild(this.node, "页签/页签_" + i);
            if (tab) this.tabNodes.push(tab);
        }
        if (this.tabNodes.length >= 2) {
            const onSprite = this.tabNodes[0].getComponent(cc.Sprite);
            const offSprite = this.tabNodes[1].getComponent(cc.Sprite);
            if (onSprite) this.tabOnFrame = onSprite.spriteFrame;
            if (offSprite) this.tabOffFrame = offSprite.spriteFrame;
        }
        const chip = Tool.GetChild(this.node, "创建规则弹窗/面板/底皮_1");
        if (chip) {
            const chipSprite = chip.getComponent(cc.Sprite);
            if (chipSprite) this.chipFrame = chipSprite.spriteFrame;
        }

        this.rulesCard = Tool.GetChild(this.node, "规则卡片");
        this.rulesScroll = Tool.GetChild(this.node, "规则卡片/滚动");
        this.rulesView = Tool.GetChild(this.node, "规则卡片/滚动/view");
        this.rulesContent = Tool.GetChild(this.node, "规则卡片/滚动/view/content");
        this.ruleTemplate = Tool.GetChild(this.node, "规则卡片/滚动/view/content/规则行");
        this.createDialog = Tool.GetChild(this.node, "创建规则弹窗");
        this.deleteDialog = Tool.GetChild(this.node, "删除规则弹窗");
        if (this.ruleTemplate) this.ruleTemplate.active = false;
        const poolCard = Tool.GetChild(this.node, "卡片");
        if (poolCard) poolCard.active = this.activeTab === 1;
        if (this.rulesCard) this.rulesCard.active = this.activeTab === 0;
        if (this.createDialog) this.createDialog.active = false;
        if (this.deleteDialog) this.deleteDialog.active = false;
        this.captureCreateLayout();
        this.syncDarkSection();
        this.applyTabVisual();
    }

    private applyTabVisual() {
        for (let i = 0; i < this.tabNodes.length; i++) {
            const tab = this.tabNodes[i];
            const sprite = tab.getComponent(cc.Sprite);
            if (sprite) {
                const frame = i === this.activeTab ? this.tabOnFrame : this.tabOffFrame;
                if (frame) sprite.spriteFrame = frame;
            }
            const text = tab.getChildByName("文字");
            if (text) text.color = i === this.activeTab
                ? new cc.Color(48, 30, 8, 255)
                : new cc.Color(169, 192, 214, 255);
        }
    }

    private selectTab(index: number) {
        // 页面只保留「游戏规则」「奖池设置」两个页签。
        if (!isFinite(index) || (index !== 0 && index !== 1)) return;
        this.activeTab = index;
        const poolCard = Tool.GetChild(this.node, "卡片");
        if (poolCard) poolCard.active = index === 1;
        if (this.rulesCard) this.rulesCard.active = index === 0;
        this.applyTabVisual();
        if (index === 0) {
            this.rulesRetry = 0;
            this.requestRules();
        } else if (index === 1) {
            this.requestConfig();
        }
    }

    // ---------------------------------------------------------------- 规则列表

    private requestRules() {
        if (this.rulesPending) return;
        const account = GameDataManager.getAccount();
        if (!account) return;
        const clubId = this.resolveSettingsClubId();
        this.rulesClubId = clubId;
        if (clubId === "") {
            this.rulesLoaded = true;
            this.rules = [];
            this.renderRules("当前没有俱乐部，无法配置游戏规则");
            return;
        }
        this.rulesPending = true;
        this.rulesLoading = true;
        this.rulesQueryToken++;
        const token = this.rulesQueryToken;
        this.rulesContext = "P@查询_俱乐部_玩法列表:" + clubId;
        const params: any = {
            header: "查询_俱乐部_玩法列表",
            club_id: clubId,
            context: this.rulesContext
        };
        account.reqHallCommand(JSON.stringify(params), this.rulesContext);
        this.renderRules("正在读取游戏规则…");
        this.scheduleOnce(() => {
            if (this.rulesQueryToken !== token || !this.rulesPending) return;
            this.rulesPending = false;
            this.rulesLoading = false;
            this.renderRules("读取游戏规则失败，请稍后重试");
        }, 3);
    }

    private rowAt(index: number): cc.Node {
        if (!this.rulesContent || !this.ruleTemplate) return null;
        while (this.ruleRows.length <= index) {
            const row = cc.instantiate(this.ruleTemplate);
            row.name = "规则行" + (this.ruleRows.length + 1);
            row.parent = this.rulesContent;
            row.active = false;
            this.ruleRows.push(row);
        }
        return this.ruleRows[index];
    }

    /** listText 仅在空列表时显示，用于加载中/失败/无俱乐部。 */
    private renderRules(listText: string = "") {
        if (!this.rulesCard || !this.rulesContent || !this.rulesView) return;
        const list = this.rules || [];
        this.ruleRows.forEach(row => row.active = false);

        for (let i = 0; i < list.length; i++) {
            const row = this.rowAt(i);
            if (!row) continue;
            row.active = true;
            row.setPosition(0, -(i * (RULE_ROW_HEIGHT + RULE_ROW_GAP) + RULE_ROW_HEIGHT / 2));
            this.fillRuleRow(row, list[i]);
        }

        let roomTotal = 0;
        for (let i = 0; i < list.length; i++) roomTotal += this.ruleRoomCount(list[i]);
        this.setLabel("规则卡片/汇总", list.length === 0 && listText !== ""
            ? listText
            : "已创建 " + list.length + " 条规则 · " + roomTotal + " 个房间");

        const empty = Tool.GetChild(this.node, "规则卡片/空提示");
        if (empty) {
            empty.active = list.length === 0;
            if (list.length === 0) {
                const text = listText !== "" ? listText
                    : (this.rulesLoading ? "正在读取游戏规则…" : "暂无游戏规则，点击下方创建");
                this.setNodeLabel(empty, text);
            }
        }

        const viewHeight = this.rulesView.height;
        const contentHeight = Math.max(viewHeight,
            list.length * (RULE_ROW_HEIGHT + RULE_ROW_GAP));
        this.rulesContent.setContentSize(this.rulesView.width, contentHeight);
        // content 锚点 (0.5,1)：位置即顶边，对齐视口顶边。
        this.rulesContent.setPosition(0, viewHeight / 2);
        const scroll = this.rulesScroll ? this.rulesScroll.getComponent(cc.ScrollView) : null;
        if (scroll) {
            scroll.stopAutoScroll();
            scroll.scrollToTop(0);
        }
    }

    private fillRuleRow(row: cc.Node, rule: any) {
        row.targetOff(this);
        const dipi = rule && rule.dipi_name
            ? String(rule.dipi_name)
            : "底皮 " + String(rule && rule.dipi_key || "");
        const nine = Number(rule.dijiuwang) === 1;
        const seatStone = this.ruleSeatStone(rule);
        this.setNodeLabel(row.getChildByName("底皮"), dipi);
        const typeNode = row.getChildByName("类型");
        if (typeNode) {
            this.setNodeLabel(typeNode, nine ? "地九王" : "常规");
            typeNode.color = nine
                ? new cc.Color(120, 220, 250, 255)
                : new cc.Color(143, 166, 186, 255);
        }
        const seatNode = row.getChildByName("带入钻石");
        if (seatNode) seatNode.active = seatStone;
        const badge = row.getChildByName("徽章");
        if (badge) badge.color = nine
            ? new cc.Color(255, 255, 255, 255)
            : new cc.Color(150, 170, 185, 255);
        this.setNodeLabel(row.getChildByName("准入"),
            "准入 " + this.ruleMin(rule) + " · 8 人 · 30 分钟");
        const water = this.ruleWater(rule);
        const dark = this.ruleDark(rule, water);
        const waterChip = row.getChildByName("抽水");
        if (waterChip) waterChip.x = this.darkEnabled ? -166 : 0;
        this.setNodeLabel(Tool.GetChild(row, "抽水/文字"), "抽水 " + water + "%");
        const darkChip = row.getChildByName("暗抽");
        if (darkChip) darkChip.active = this.darkEnabled;
        if (this.darkEnabled)
            this.setNodeLabel(Tool.GetChild(row, "暗抽/文字"), "暗抽 " + dark + "% · 仅创建者");
        const rooms = this.ruleRoomCount(rule);
        this.setNodeLabel(row.getChildByName("房间"), rooms > 0
            ? "房间 " + rooms + " 个 · 满员/开局自动补房"
            : "暂无房间，开局后自动补房");

        const del = row.getChildByName("删除");
        if (del) {
            del.targetOff(this);
            const delButton = del.getComponent(cc.Button);
            if (delButton) delButton.transition = cc.Button.Transition.NONE;
            del.on("click", () => {
                this.PlayAudio("按键");
                this.openDeleteDialog(rule);
            }, this);
        }
    }

    private ruleAdmit(dipiKey: any): number {
        const index = RULE_DIPI_KEYS.indexOf(String(dipiKey || ""));
        return index >= 0 ? RULE_DIPI_ADMIT[index] : 0;
    }

    private ruleMin(rule: any): number {
        const value = Math.floor(Number(rule && rule.min_money));
        return isFinite(value) && value > 0 ? value : this.ruleAdmit(rule && rule.dipi_key);
    }

    private ruleWater(rule: any): number {
        const value = Math.floor(Number(rule && rule.water_rate));
        return isFinite(value) ? Math.max(0, Math.min(RULE_WATER_MAX, value)) : 0;
    }

    private ruleDark(rule: any, water: number): number {
        const value = Math.floor(Number(rule && rule.dark_percent));
        return isFinite(value) ? Math.max(0, Math.min(water, value)) : 0;
    }

    private ruleRoomCount(rule: any): number {
        return rule && Array.isArray(rule.room_ids) ? rule.room_ids.length : 0;
    }

    /** 该玩法是否开启入座扣钻（ClubPlayList.special_rule 含 token）。 */
    private ruleSeatStone(rule: any): boolean {
        return rule && String(rule.special_rule || "").indexOf("入座扣钻") >= 0;
    }

    // ---------------------------------------------------------------- 创建规则

    private openCreateDialog() {
        this.createIndex = 0;
        this.createNine = true;
        this.createWater = 5;
        this.createDark = 0;
        this.createSeatStone = false;
        this.setCreateHint("");
        // 后台改价后不重登也要拿到新价；节流，连续开关弹窗不会重复请求。
        ConfigManager.getInstance().RefreshConsumePrice();
        // 每次打开都补拉一次开关；后台刚改也能在下一次打开时生效。
        this.requestDarkState(true);
        this.refreshCreateDialog();
        if (this.createDialog) this.createDialog.active = true;
        if (!this.rulesLoaded && !this.rulesLoading) this.requestRules();
    }

    private hideCreateDialog() {
        this.createPending = false;
        if (this.createDialog) this.createDialog.active = false;
    }

    private refreshCreateDialog() {
        for (let i = 0; i < RULE_DIPI_KEYS.length; i++) {
            const chip = Tool.GetChild(this.node, "创建规则弹窗/面板/底皮_" + i);
            if (!chip) continue;
            const on = i === this.createIndex;
            const sprite = chip.getComponent(cc.Sprite);
            if (sprite) sprite.spriteFrame = on ? this.tabOnFrame : this.chipFrame;
            const nameNode = chip.getChildByName("名称");
            if (nameNode) nameNode.color = on
                ? new cc.Color(48, 30, 8, 255)
                : new cc.Color(255, 240, 214, 255);
            const admitNode = chip.getChildByName("准入");
            if (admitNode) admitNode.color = on
                ? new cc.Color(48, 30, 8, 255)
                : new cc.Color(143, 166, 186, 255);
        }

        const switchNode = Tool.GetChild(this.node, "创建规则弹窗/面板/地九王行/地九王开关");
        if (switchNode) {
            const on = switchNode.getChildByName("开");
            const off = switchNode.getChildByName("关");
            if (on) on.active = this.createNine;
            if (off) off.active = !this.createNine;
        }
        this.refreshSeatStoneRow();
        this.syncDarkSection();

        this.setLabel("创建规则弹窗/面板/抽水值/数值", this.createWater + "%");
        this.refreshQuickChips("抽水", RULE_WATER_QUICK, this.createWater, RULE_WATER_MAX);
        if (this.darkEnabled) {
            this.setLabel("创建规则弹窗/面板/暗抽值/数值", this.createDark + "%");
            this.refreshQuickChips("暗抽", RULE_DARK_QUICK, this.createDark, this.createWater);
        } else {
            this.createDark = 0;
        }
        this.setLabel("创建规则弹窗/面板/自动信息/准入值",
            this.ruleAdmit(RULE_DIPI_KEYS[this.createIndex]) + " 分");
        this.refreshRoomFeeHint();

        const confirm = Tool.GetChild(this.node, "创建规则弹窗/面板/创建规则确认");
        if (confirm) {
            const button = confirm.getComponent(cc.Button);
            if (button) button.interactable = !this.createPending;
            this.setNodeLabel(confirm.getChildByName("文字"),
                this.createPending ? "创建中…" : "创建并开房");
        }
    }

    /** 创建规则弹窗的红字房费说明；价格由后台「消费钻石价格」下发，0 = 未开启。 */
    private refreshRoomFeeHint() {
        const node = Tool.GetChild(this.node, "创建规则弹窗/面板/房费提示");
        if (!node) return;
        const fee = ConfigManager.getInstance().GetClubRoomFee();
        const label = node.getComponent(cc.Label);
        if (label) label.string = fee > 0
            ? "房费：开房扣 " + fee + " 钻；首局开始后每 30 分钟再扣 " + fee + " 钻；自动补房同扣"
            : "房费未开启：开房不扣钻石";
        node.color = fee > 0
            ? new cc.Color(255, 92, 84, 255)
            : new cc.Color(143, 166, 186, 255);
    }

    /** 价目表补拉回来后，弹窗开着就同步刷新红字。 */
    public onConsumeStonePriceUpdated() {
        if (this.createDialog && this.createDialog.active)
            this.refreshCreateDialog();
    }

    private refreshQuickChips(prefix: string, values: number[], current: number, maxValue: number) {
        for (let i = 0; i < values.length; i++) {
            const node = Tool.GetChild(this.node,
                "创建规则弹窗/面板/" + prefix + "快捷_" + i);
            if (!node) continue;
            const on = values[i] === current;
            const sprite = node.getComponent(cc.Sprite);
            if (sprite) sprite.spriteFrame = on ? this.tabOnFrame : this.chipFrame;
            const text = node.getChildByName("文字");
            if (text) text.color = on
                ? new cc.Color(48, 30, 8, 255)
                : new cc.Color(255, 240, 214, 255);
            const enabled = values[i] <= maxValue && !this.createPending;
            const button = node.getComponent(cc.Button);
            if (button) button.interactable = enabled;
            node.opacity = enabled ? 255 : 110;
        }
    }

    private selectCreateDipi(index: number) {
        if (index < 0 || index >= RULE_DIPI_KEYS.length || this.createPending) return;
        this.createIndex = index;
        this.setCreateHint("");
        this.refreshCreateDialog();
    }

    private toggleCreateNine() {
        if (this.createPending) return;
        this.createNine = !this.createNine;
        this.setCreateHint("");
        this.refreshCreateDialog();
    }

    /** 「同步带入钻石」开关：默认关闭，打开时建房规则带 special_rule=入座扣钻。 */
    private toggleCreateSeatStone() {
        if (this.createPending) return;
        this.createSeatStone = !this.createSeatStone;
        this.setCreateHint("");
        this.refreshCreateDialog();
    }

    private refreshSeatStoneRow() {
        const switchNode = Tool.GetChild(this.node, "创建规则弹窗/面板/同步带入钻石行/同步带入钻石开关");
        if (switchNode) {
            const on = switchNode.getChildByName("开");
            const off = switchNode.getChildByName("关");
            if (on) on.active = this.createSeatStone;
            if (off) off.active = !this.createSeatStone;
        }
        const hint = Tool.GetChild(this.node, "创建规则弹窗/面板/同步带入钻石行/说明");
        if (!hint) return;
        const label = hint.getComponent(cc.Label);
        if (!label) return;
        const ratio = ConfigManager.getInstance().GetClubSeatStoneRatio();
        label.string = ratio > 0
            ? "带入/结算按 1 积分 = " + panelGameSettings.FormatRatio(ratio) + " 钻同步扣退"
            : "兑换比例为 0，开启后不扣钻石";
        hint.color = ratio > 0
            ? new cc.Color(143, 166, 186, 255)
            : new cc.Color(255, 176, 162, 255);
    }

    private static FormatRatio(value: number): string {
        if (!isFinite(value)) return "1";
        const text = value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
        return text === "" ? "0" : text;
    }

    public onClubSeatStoneRatioUpdated() {
        if (this.createDialog && this.createDialog.active)
            this.refreshSeatStoneRow();
    }

    private stepCreateWater(delta: number) {
        this.setCreateWater(this.createWater + delta);
    }

    private setCreateWater(value: number) {
        if (this.createPending) return;
        this.createWater = Math.max(0, Math.min(RULE_WATER_MAX, Math.floor(value)));
        if (this.createDark > this.createWater) this.createDark = this.createWater;
        this.setCreateHint("");
        this.refreshCreateDialog();
    }

    private stepCreateDark(delta: number) {
        this.setCreateDark(this.createDark + delta);
    }

    private setCreateDark(value: number) {
        if (this.createPending) return;
        this.createDark = Math.max(0, Math.min(this.createWater, Math.floor(value)));
        this.setCreateHint("");
        this.refreshCreateDialog();
    }

    private setCreateHint(text: string) {
        this.setLabel("创建规则弹窗/面板/创建提示", text);
    }

    private submitCreate() {
        if (this.createPending) return;
        const account = GameDataManager.getAccount();
        if (!account) return;
        const clubId = this.resolveSettingsClubId();
        if (clubId === "") {
            this.setCreateHint("当前没有俱乐部，无法创建规则");
            return;
        }
        this.createPending = true;
        const context = "P@创建_俱乐部_玩法:" + clubId + ":" + Date.now();
        const params: any = {
            header: "创建_俱乐部_玩法",
            club_id: clubId,
            dipi_key: RULE_DIPI_KEYS[this.createIndex],
            dijiuwang: this.createNine ? 1 : 0,
            water_rate: this.createWater,
            dark_percent: this.darkEnabled ? this.createDark : 0,
            context: context
        };
        // 服务端按房间 special_rule 里的「入座扣钻」开启带入/结算钻石同步；不勾选不传，行为不变。
        if (this.createSeatStone)
            params.special_rule = "入座扣钻";
        account.reqHallCommand(JSON.stringify(params), context);
        KBEngine.Event.fire("RefreshClubRoomList", 1.5);
        this.setCreateHint("正在创建，房间会自动补开…");
        this.refreshCreateDialog();
        this.scheduleOnce(() => {
            if (!this.createPending) return;
            this.createPending = false;
            this.setCreateHint("创建结果未确认，请关闭后重新打开查看");
            this.refreshCreateDialog();
        }, RULE_TIMEOUT);
    }

    // ---------------------------------------------------------------- 删除规则

    private openDeleteDialog(rule: any) {
        if (this.deletePending) return;
        this.deleteRule = rule;
        this.deletePlayId = rule && rule.play_id != null ? String(rule.play_id) : "";
        const dipi = rule && rule.dipi_name
            ? String(rule.dipi_name)
            : "底皮 " + String(rule && rule.dipi_key || "");
        const nine = Number(rule && rule.dijiuwang) === 1;
        const water = this.ruleWater(rule);
        const dark = this.ruleDark(rule, water);
        this.setLabel("删除规则弹窗/面板/规则摘要/名称",
            dipi + " · " + (nine ? "地九王" : "常规") + (this.ruleSeatStone(rule) ? " · 带入钻石" : ""));
        this.setLabel("删除规则弹窗/面板/规则摘要/准入摘要",
            "准入 " + this.ruleMin(rule) + " · 8 人 · 30 分钟");
        const darkText = this.darkEnabled ? " · 暗抽 " + dark + "%" : "";
        this.setLabel("删除规则弹窗/面板/规则摘要/收益摘要",
            "抽水 " + water + "%" + darkText + " · " + this.ruleRoomCount(rule) + " 个房间");
        this.setLabel("删除规则弹窗/面板/提示", "");
        if (this.deleteDialog) this.deleteDialog.active = true;
    }

    private hideDeleteDialog() {
        this.deletePending = false;
        this.deleteRule = null;
        this.deletePlayId = "";
        if (this.deleteDialog) this.deleteDialog.active = false;
    }

    private submitDelete() {
        if (this.deletePending) return;
        const account = GameDataManager.getAccount();
        if (!account) return;
        const clubId = this.resolveSettingsClubId();
        if (clubId === "") {
            this.setLabel("删除规则弹窗/面板/提示", "当前没有俱乐部，无法删除规则");
            return;
        }
        if (this.deletePlayId === "") {
            this.setLabel("删除规则弹窗/面板/提示", "玩法 ID 缺失，请重新打开列表");
            return;
        }
        this.deletePending = true;
        const context = "P@删除_俱乐部_玩法:" + clubId + ":" + Date.now();
        const params: any = {
            header: "删除_俱乐部_玩法",
            club_id: clubId,
            play_id: this.deletePlayId,
            context: context
        };
        account.reqHallCommand(JSON.stringify(params), context);
        KBEngine.Event.fire("RefreshClubRoomList", 1.5);
        this.setLabel("删除规则弹窗/面板/提示", "正在删除…");
        this.scheduleOnce(() => {
            if (!this.deletePending) return;
            this.deletePending = false;
            this.setLabel("删除规则弹窗/面板/提示", "删除结果未确认，请重新打开列表查看");
        }, RULE_TIMEOUT);
    }

    // ---------------------------------------------------------------- 规则推送

    private parsePush(raw: any): any {
        if (raw && typeof raw === "object") return raw;
        if (typeof raw !== "string") return null;
        try { return JSON.parse(raw); } catch (e) { return null; }
    }

    private playListFrom(msg: any): any[] {
        if (!msg) return null;
        const candidates = [msg, msg.result, msg.ret_result];
        for (let i = 0; i < candidates.length; i++) {
            const item = candidates[i];
            if (item && Array.isArray(item.ClubPlayList)) return item.ClubPlayList;
        }
        return null;
    }

    public onClubPlayList(raw: any) {
        const msg = this.parsePush(raw);
        const list = this.playListFrom(msg);
        if (!list) return;
        if (this.rulesClubId !== "") {
            const current = this.resolveSettingsClubId();
            if (current !== "" && current !== this.rulesClubId) return;
        }

        this.rulesPending = false;
        this.rulesLoading = false;
        this.rulesLoaded = true;
        this.rulesRetry = 0;
        this.rules = this.normalizeRules(list);
        const created = this.createPending;
        const deleted = this.deletePending;
        this.createPending = false;
        this.deletePending = false;
        if (created) {
            this.hideCreateDialog();
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover,
                "规则已创建，房间会自动补开");
            KBEngine.Event.fire("RefreshClubRoomList", 1.5);
        } else if (deleted) {
            this.hideDeleteDialog();
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover,
                "规则已删除，进行中的牌局本局结束后关闭");
            KBEngine.Event.fire("RefreshClubRoomList", 1.5);
        }
        // 切换俱乐部后玩法列表会先到，开关状态要跟着当前俱乐部重新拉。
        if (this.resolveSettingsClubId() !== this.darkClubId)
            this.requestDarkState(true);
        this.renderRules();
    }

    public onClubPlayResult(raw: any) {
        const msg = this.parsePush(raw);
        if (!msg) return;
        const data = msg.ClubPlayResult || msg.result || msg.ret_result || msg;
        const error = data && data.error ? String(data.error) : "操作失败，请稍后重试";
        if (this.createPending) {
            this.createPending = false;
            if (this.createDialog && this.createDialog.active) {
                this.setCreateHint(error);
                this.refreshCreateDialog();
            } else {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, error);
            }
            return;
        }
        if (this.deletePending) {
            this.deletePending = false;
            if (this.deleteDialog && this.deleteDialog.active) {
                this.setLabel("删除规则弹窗/面板/提示", error);
            } else {
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, error);
            }
        }
    }

    private normalizeRules(list: any[]): any[] {
        const result: any[] = [];
        for (let i = 0; i < list.length; i++) {
            const item: any = list[i] || {};
            const water = Math.max(0, Math.min(RULE_WATER_MAX,
                Math.floor(Number(item.water_rate) || 0)));
            const dark = Math.max(0, Math.min(water,
                Math.floor(Number(item.dark_percent) || 0)));
            result.push({
                play_id: item.play_id == null ? "" : String(item.play_id),
                dipi_key: item.dipi_key == null ? "" : String(item.dipi_key),
                dipi_name: item.dipi_name == null ? "" : String(item.dipi_name),
                dijiuwang: Number(item.dijiuwang) === 1 ? 1 : 0,
                water_rate: water,
                dark_percent: dark,
                special_rule: item.special_rule == null ? "" : String(item.special_rule),
                min_money: item.min_money == null ? null : Number(item.min_money),
                room_ids: Array.isArray(item.room_ids) ? item.room_ids : []
            });
        }
        return result;
    }

    private setNodeLabel(node: cc.Node, text: string) {
        if (!node) return;
        const label = node.getComponent(cc.Label);
        if (label) label.string = text;
    }

    // ---------------------------------------------------------------- 服务端（按池配置）

    /** 与大厅「游戏设置」入口使用同一个当前俱乐部；多俱乐部时由大厅选中的俱乐部决定。 */
    private resolveSettingsClubId(): string {
        const account = GameDataManager.getAccount();
        return account == null ? "" : resolveRoomClubId(account);
    }

    // ---------------------------------------------------------------- 暗抽开关（哈希）

    /** 读当前俱乐部的暗抽开关；force=false 时 1 秒内不重复请求。 */
    private requestDarkState(force: boolean = false) {
        const clubId = this.resolveSettingsClubId();
        if (clubId === "") {
            this.darkClubId = "";
            this.darkPendingContext = "";
            this.applyDarkEnabled(false);
            return;
        }
        if (clubId !== this.darkClubId) {
            // 切俱乐部先回到关闭态，避免 A 俱乐部已开启时 B 俱乐部短暂显示暗抽。
            this.darkClubId = clubId;
            this.applyDarkEnabled(false);
        }
        const now = Date.now();
        const context = DARK_HASH_CONTEXT_PREFIX + clubId;
        if (!force && context === this.darkPendingContext && now - this.darkPendingAt < 1000)
            return;
        this.darkClubId = clubId;
        this.darkPendingContext = context;
        this.darkPendingAt = now;
        this.unschedule(this.onDarkTimeout);
        this.scheduleOnce(this.onDarkTimeout, DARK_HASH_TIMEOUT);
        ConfigManager.getInstance().GetOneHashKey(DARK_HASH_KEY_PREFIX + clubId, context);
    }

    /** 查询超时按关闭处理；迟到的回包仍会按 context 重新应用。 */
    private onDarkTimeout() {
        if (this.darkPendingContext === "") return;
        this.darkPendingContext = "";
        this.darkPendingAt = 0;
        this.applyDarkEnabled(false);
    }

    public onUserHashInfo(raw: any) {
        const msg = this.parsePush(raw);
        const info = msg && (msg.UserHashInfo || (msg.result && msg.result.UserHashInfo));
        if (!info) return;
        const key = info.key == null ? "" : String(info.key).trim();
        const context = info.context == null ? "" : String(info.context).trim();
        if (!this.isDarkHashResponse(key, context)) return;
        this.darkPendingContext = "";
        this.darkPendingAt = 0;
        this.unschedule(this.onDarkTimeout);
        this.applyDarkEnabled(this.darkValue(info.content));
    }

    public onUserHashError(raw: any) {
        const msg = this.parsePush(raw);
        const info = msg && (msg.UserHashError || (msg.result && msg.result.UserHashError));
        if (!info) return;
        const context = info.context == null ? "" : String(info.context).trim();
        if (!this.darkContextMatches(context, this.darkClubId))
            return;
        this.darkPendingContext = "";
        this.darkPendingAt = 0;
        this.unschedule(this.onDarkTimeout);
        this.applyDarkEnabled(false);
    }

    private isDarkHashResponse(key: string, context: string): boolean {
        const clubId = this.resolveSettingsClubId();
        if (clubId === "") return false;
        const expectedKey = DARK_HASH_KEY_PREFIX + clubId;
        if (key !== "" && key !== expectedKey) return false;
        return this.darkContextMatches(context, clubId);
    }

    /** 兼容服务端回传的 param context（暗抽开关_x）和账号命令 context（P@暗抽开关_x）。 */
    private darkContextMatches(context: string, clubId: string): boolean {
        if (context === "") return false;
        const base = DARK_HASH_CONTEXT_PREFIX + clubId;
        return context === base || context === "P@" + base ||
            context === this.darkPendingContext ||
            context === "P@" + this.darkPendingContext;
    }

    /** 兼容 1 / "1" / true / "True" / 开；其余一律关闭。 */
    private darkValue(content: any): boolean {
        if (content === null || content === undefined) return false;
        const text = String(content).trim().toLowerCase();
        return text === "1" || text === "true" || text === "on" ||
            text === "yes" || text === "开" || text === "开启";
    }

    private applyDarkEnabled(enabled: boolean) {
        if (this.darkEnabled === enabled) {
            this.syncDarkSection();
            return;
        }
        this.darkEnabled = enabled;
        if (!enabled) this.createDark = 0;
        this.syncDarkSection();
        if (this.createDialog && this.createDialog.active)
            this.refreshCreateDialog();
        if (this.rulesLoaded)
            this.renderRules();
    }

    /** 暗抽整项显隐；关闭时同时收紧创建规则弹窗。 */
    private syncDarkSection() {
        const show = this.darkEnabled;
        for (const name of DARK_UI_NAMES) {
            const node = Tool.GetChild(this.node, "创建规则弹窗/面板/" + name);
            if (node) node.active = show;
        }
        if (!show) this.createDark = 0;
        this.applyDarkLayout(!show);
    }

    /** 记录创建规则弹窗各节点的原始 y；Prefab 改布局后运行时自动以新值为基准。 */
    private captureCreateLayout() {
        if (Object.keys(this.darkLayoutBase).length > 0) return;
        const names = CREATE_TOP_NAMES.concat(CREATE_BOTTOM_NAMES);
        for (const name of names) {
            const node = Tool.GetChild(this.node, "创建规则弹窗/面板/" + name);
            if (node) this.darkLayoutBase[name] = node.y;
        }
    }

    /**
     * 关闭暗抽时顶部组下移、下方组上移，内容重新居中；
     * 开启时按记录的原始 y 恢复。
     */
    private applyDarkLayout(compact: boolean) {
        if (Object.keys(this.darkLayoutBase).length === 0) return;
        if (this.darkLayoutCompact === compact) return;
        this.darkLayoutCompact = compact;
        const topShift = compact ? DARK_COMPACT_TOP_SHIFT : 0;
        const bottomShift = compact ? DARK_COMPACT_BOTTOM_SHIFT : 0;
        for (const name of CREATE_TOP_NAMES) {
            const node = Tool.GetChild(this.node, "创建规则弹窗/面板/" + name);
            const base = this.darkLayoutBase[name];
            if (node && base !== undefined) node.y = base + topShift;
        }
        for (const name of CREATE_BOTTOM_NAMES) {
            const node = Tool.GetChild(this.node, "创建规则弹窗/面板/" + name);
            const base = this.darkLayoutBase[name];
            if (node && base !== undefined) node.y = base + bottomShift;
        }
    }

    private requestConfig() {
        if (this.loading) return;
        this.loading = true;
        this.contextClubId = this.resolveSettingsClubId();
        const context = "P@获取_俱乐部_奖池_配置";
        const params: any = { header: "获取_俱乐部_奖池_配置", context: context };
        if (this.contextClubId !== "") params.club_id = this.contextClubId;
        // 已读到过池键时带上；服务端当前只对 level>=99 生效，普通池主仍按身份推断。
        if (this.poolKey !== "") params.pool_key = this.poolKey;
        GameDataManager.getAccount().reqHallCommand(JSON.stringify(params), context);

        this.scheduleOnce(() => {
            if (!this.loading) return;
            this.loading = false;
            if (!this.loaded) this.warn("奖池配置读取失败，请稍后重试");
        }, 2.5);
    }

    private saveConfig(kind: ConfigKind, balanceIndex: number = -1) {
        this.saving = true;
        this.savingKind = kind;
        this.savingPoolKey = this.poolKey;
        const context = "P@设置_俱乐部_奖池_配置";
        const params: any = { header: "设置_俱乐部_奖池_配置", context: context };
        if (this.contextClubId !== "") params.club_id = this.contextClubId;
        // 把读取时的池键带回去，避免多俱乐部账号读到 A 池却写到 B 池。
        if (this.poolKey !== "") params.pool_key = this.poolKey;
        if (kind === "bili") {
            const dict: any = {};
            for (let i = 0; i < REWARD_TIER_KEYS.length; i++) dict[REWARD_TIER_KEYS[i]] = this.bili[i];
            params.reward_card_bili = dict;
        } else if (kind === "balance") {
            const index = balanceIndex >= 0 ? balanceIndex : this.editingBalanceIndex;
            if (index >= 0) {
                const dict: any = {};
                dict[DIPI_KEYS[index]] = this.balance[index];
                params.reward_balance = dict;
            }
        } else {
            params.reward_on = this.poolOn;
        }
        GameDataManager.getAccount().reqHallCommand(JSON.stringify(params), context);
        // 失败或丢包时别把整页锁死；回包会带回整表，无需再回读。
        this.scheduleOnce(() => { this.saving = false; this.savingPoolKey = ""; }, 3);
    }

    private warn(text: string) {
        if (this.warnedReadFailure) return;
        this.warnedReadFailure = true;
        UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, text);
    }

    private onHallCommand(nCode: number, param: any) {
        if (!param) return;
        if (typeof param !== "string") {
            try { param = JSON.stringify(param); } catch (e) { return; }
        }
        // ------------------------------------------------------------ 游戏规则
        if (param.indexOf("查询_俱乐部_玩法列表") >= 0) {
            if (nCode === 0x200) {
                // 正常只回空壳，数据走 ClubPlayList；兼容偶尔直接带回列表的环境。
                const data = this.parseResult(param);
                const list = this.playListFrom(data);
                if (list) this.onClubPlayList(data);
                return;
            }
            this.rulesPending = false;
            this.rulesLoading = false;
            const error = this.errorText(this.parseResult(param), "读取游戏规则失败，请稍后重试");
            this.renderRules(error);
            if (error.indexOf("加载中") >= 0 && this.activeTab === 0 && this.rulesRetry < 2) {
                this.rulesRetry++;
                this.scheduleOnce(() => {
                    if (this.activeTab === 0 && !this.rulesPending) this.requestRules();
                }, 1);
            }
            return;
        }
        if (param.indexOf("创建_俱乐部_玩法") >= 0) {
            if (nCode === 0x200) {
                const data = this.parseResult(param);
                const list = this.playListFrom(data);
                if (list) this.onClubPlayList(data);
                return;
            }
            this.createPending = false;
            this.setCreateHint(this.errorText(this.parseResult(param), "创建规则失败，请稍后重试"));
            this.refreshCreateDialog();
            return;
        }
        if (param.indexOf("删除_俱乐部_玩法") >= 0) {
            if (nCode === 0x200) {
                const data = this.parseResult(param);
                const list = this.playListFrom(data);
                if (list) this.onClubPlayList(data);
                return;
            }
            this.deletePending = false;
            this.setLabel("删除规则弹窗/面板/提示",
                this.errorText(this.parseResult(param), "删除规则失败，请稍后重试"));
            return;
        }

        // 房间内也会查同一命令，用房间专用 context 区分，避免串到大厅面板。
        if (param.indexOf("房间_获取_俱乐部_奖池_配置") >= 0) return;
        const isSet = param.indexOf("设置_俱乐部_奖池_配置") >= 0;
        const isGet = param.indexOf("获取_俱乐部_奖池_配置") >= 0;
        if (!isSet && !isGet) return;

        const data = this.parseResult(param);
        if (isSet) {
            if (!this.saving) return;
            this.saving = false;
            if (nCode === 0x200 && data) {
                const returnedPoolKey = data["pool_key"] == null ? "" : String(data["pool_key"]);
                const returnedClubId = data["club_id"] == null ? "" : String(data["club_id"]);
                const poolOk = this.savingPoolKey === "" || returnedPoolKey === ""
                    || returnedPoolKey === this.savingPoolKey;
                const clubOk = returnedClubId !== "" && (this.contextClubId === ""
                    || returnedClubId === this.contextClubId);
                if (returnedClubId !== "" ? (!poolOk && !clubOk) : !poolOk) {
                    UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover,
                        "保存落到了其他奖池（" + returnedPoolKey + "），请确认当前俱乐部后重试");
                    this.savingPoolKey = "";
                    this.requestConfig();
                    return;
                }
                this.savingPoolKey = "";
                this.applyConfig(data);
                let toast = "已保存，下次进池生效";
                if (this.savingKind === "balance") {
                    toast = "奖池数量已保存，下次进池生效";
                } else if (this.savingKind === "pool") {
                    toast = this.poolOn ? "奖池已开启，下次进池生效" : "奖池已关闭，余额与配置保留";
                }
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, toast);
            } else {
                this.savingPoolKey = "";
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover,
                    this.errorText(data, "保存失败，请稍后重试"));
                this.requestConfig();
            }
            return;
        }

        this.loading = false;
        if (nCode !== 0x200 || !data) {
            if (!this.loaded) this.warn(this.errorText(data, "奖池配置读取失败，请稍后重试"));
            return;
        }
        this.applyConfig(data);
    }

    private parseResult(param: string): any {
        let msg: any = null;
        try {
            msg = JSON.parse(param);
        } catch (e) {
            return null;
        }
        let data: any = msg ? (msg["result"] || msg["ret_result"] || msg) : null;
        if (typeof data === "string") {
            try {
                data = JSON.parse(data);
            } catch (e) {
                data = null;
            }
        }
        return data;
    }

    private errorText(data: any, fallback: string): string {
        return data && typeof data["error"] === "string" && data["error"] ? data["error"] : fallback;
    }

    private applyConfig(data: any) {
        if (!data) return;
        if (data["pool_key"] !== undefined && data["pool_key"] !== null) {
            this.poolKey = String(data["pool_key"]);
            // 服务端确认了独立俱乐部池时，按池键反推俱乐部，保证读取与保存同池。
            if (this.poolKey.indexOf("club-") === 0) {
                const poolClubId = this.poolKey.substring(5);
                if (poolClubId !== "") this.contextClubId = poolClubId;
            }
        }
        if (data["club_id"] !== undefined && data["club_id"] !== null && String(data["club_id"]) !== "")
            this.contextClubId = String(data["club_id"]);
        if (data["pool_type"] !== undefined && data["pool_type"] !== null) {
            this.poolType = String(data["pool_type"]);
        } else if (this.poolKey !== "") {
            this.poolType = this.poolKey.indexOf("club-") === 0 ? "club" : "union";
        }
        if (data["reward_on"] !== undefined) {
            this.poolOn = data["reward_on"] === true;
        }

        const bili = data["reward_card_bili"];
        if (bili && typeof bili === "object") {
            for (let i = 0; i < REWARD_TIER_KEYS.length; i++) {
                const v = this.normalizeBili(bili[REWARD_TIER_KEYS[i]]);
                this.bili[i] = v;
                this.biliOn[i] = v > 0;
                if (v > 0) this.lastBili[i] = v;
            }
        }

        const balance = data["reward_balance"];
        if (balance && typeof balance === "object") {
            for (let i = 0; i < DIPI_KEYS.length; i++) {
                const v = Math.floor(Number(balance[DIPI_KEYS[i]]) || 0);
                this.balance[i] = v > 0 ? Math.min(MAX_BALANCE_FEN, v) : 0;
            }
        }

        if (!bili && data["reward_on"] === undefined && data["reward_balance"] === undefined) {
            Debug.Log("俱乐部奖池配置回包缺少配置字段：" + JSON.stringify(data));
            return;
        }

        this.loading = false;
        this.loaded = true;
        this.refreshRows();
    }
}
