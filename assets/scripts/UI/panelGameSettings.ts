import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import Debug from "../common/Debug";
import { ShowPanelMode } from "../common/GameDef";
import { resolveRoomClubId } from "../logic/RoomClubContext";

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

    onLoad() {
        super.onLoad();
        KBEngine.Event.register("onHallCommand", this, "onHallCommand");
    }

    onEnable() {
        this.warnedReadFailure = false;
        this.saving = false;
        this.savingPoolKey = "";
        this.refreshRows();
        this.requestConfig();
    }

    onDisable() {
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
        if (name.indexOf("页签_") === 0 && name !== "页签_0") {
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "该设置暂未开放");
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
            if (label) label.string = this.bili[i] + "%";
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
        label.string = prefix + "合计 " + total + "% · "
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
                ? Math.min(100, this.lastBili[index])
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
        this.setDialogMode(3, 2);

        let others = 0;
        for (let i = 0; i < this.bili.length; i++) {
            if (i !== index && this.biliOn[i]) others += this.bili[i];
        }
        this.setLabel("弹窗/面板/提示",
            "其余牌型共占 " + others + "%，本项最多可改到 " + Math.max(0, 100 - others) + "%");
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

    private setDialogMode(maxLength: number, inputMode: number) {
        const edit = this.editBox();
        if (!edit) return;
        edit.maxLength = maxLength;
        (edit as any).inputMode = inputMode;
        const placeholder = Tool.GetChild(this.node, "弹窗/面板/输入/PLACEHOLDER_LABEL");
        if (placeholder) {
            const label = placeholder.getComponent(cc.Label);
            if (label) label.string = inputMode === 0 ? "0.00" : "0-100";
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
        edit.string = String(Math.max(0, Math.min(100, Math.floor(value))));
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
        const value = Number(edit.string);
        if (isNaN(value) || value !== Math.floor(value) || value < 0 || value > 100) {
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "请输入 0-100 的整数");
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

    // ---------------------------------------------------------------- 服务端（按池配置）

    /** 与大厅「游戏设置」入口使用同一个当前俱乐部；多俱乐部时由大厅选中的俱乐部决定。 */
    private resolveSettingsClubId(): string {
        const account = GameDataManager.getAccount();
        return account == null ? "" : resolveRoomClubId(account);
    }

    private requestConfig() {
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

    private onHallCommand(nCode: number, param: string) {
        if (!param) return;
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
                const v = Math.max(0, Math.min(100, Math.floor(Number(bili[REWARD_TIER_KEYS[i]]) || 0)));
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
