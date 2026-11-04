import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import Debug from "../common/Debug";
import { ShowPanelMode } from "../common/GameDef";

var KBEngine = require("kbengine");

const { ccclass } = cc._decorator;

/** 服务端字典键；第 5 档服务端叫「丁二皇」，界面按用户要求显示「单独丁儿皇」。 */
const REWARD_TIER_KEYS: string[] = ["天皇", "地皇", "朵皇", "朵朵", "丁二皇"];
const REWARD_TIER_LABELS: string[] = ["天皇", "地皇", "朵皇", "朵朵", "单独丁儿皇"];
/** 池级配置未设置时服务端返回 0（不派奖），界面初值一律 0；下面是开关打开时的兜底档位。 */
const FALLBACK_BILI: number[] = [20, 10, 10, 2, 2];

type ConfigKind = "bili" | "pool";

@ccclass
export default class panelGameSettings extends UIPanelViewBase {

    private bili: number[] = [0, 0, 0, 0, 0];
    private biliOn: boolean[] = [false, false, false, false, false];
    /** 关掉开关前的比例，重新打开时恢复。 */
    private lastBili: number[] = [0, 0, 0, 0, 0];

    private editingIndex: number = -1;

    private saving: boolean = false;
    private savingKind: ConfigKind = "bili";
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
            this.confirmPercent();
            return;
        }
        if (name === "快捷5" || name === "快捷10" || name === "快捷20" || name === "快捷25") {
            this.setDialogValue(Number(name.replace("快捷", "")));
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
    }

    // ---------------------------------------------------------------- 界面刷新

    private refreshRows() {
        this.refreshPoolSwitch();
        this.refreshListEnabled();
        this.refreshBiliRows();
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

    /** 总开关关闭时，下方比例只读并置灰。 */
    private refreshListEnabled() {
        const list = Tool.GetChild(this.node, "卡片/列表");
        if (list) list.opacity = this.poolOn ? 255 : 120;
    }

    private refreshBiliRows() {
        for (let i = 0; i < REWARD_TIER_KEYS.length; i++) {
            const row = Tool.GetChild(this.node, "卡片/列表/行_" + i);
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

    private refreshTotal() {
        const node = Tool.GetChild(this.node, "卡片/合计");
        if (!node) return;
        const label = node.getComponent(cc.Label);
        const prefix = this.poolKey ? "奖池 " + this.poolKey + " · " : "";
        if (!this.poolOn) {
            label.string = prefix + "池未开启：不进池、不派奖";
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
        this.editingIndex = index;
        this.showDialog();
        this.setLabel("弹窗/面板/标题", "修改奖池比例");
        this.setLabel("弹窗/面板/副标题", "当前牌型：" + REWARD_TIER_LABELS[index]);

        let others = 0;
        for (let i = 0; i < this.bili.length; i++) {
            if (i !== index && this.biliOn[i]) others += this.bili[i];
        }
        this.setLabel("弹窗/面板/提示",
            "其余牌型共占 " + others + "%，本项最多可改到 " + Math.max(0, 100 - others) + "%");
        this.setDialogValue(this.bili[index]);
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
        edit.string = String(Math.max(0, Math.min(100, Math.floor(value))));
    }

    private confirmPercent() {
        if (this.saving) return;
        if (this.editingIndex < 0) return;
        const edit = this.editBox();
        if (!edit) {
            UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, "输入框未就绪，请重新打开");
            return;
        }
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

    private requestConfig() {
        this.loading = true;
        const context = "P@获取_俱乐部_奖池_配置";
        const param = "{\"header\":\"获取_俱乐部_奖池_配置\",\"context\":\"" + context + "\"}";
        GameDataManager.getAccount().reqHallCommand(param, context);

        this.scheduleOnce(() => {
            if (!this.loading) return;
            this.loading = false;
            if (!this.loaded) this.warn("奖池配置读取失败，请稍后重试");
        }, 2.5);
    }

    private saveConfig(kind: ConfigKind) {
        this.saving = true;
        this.savingKind = kind;
        const context = "P@设置_俱乐部_奖池_配置";
        const params: any = { header: "设置_俱乐部_奖池_配置", context: context };
        if (kind === "bili") {
            const dict: any = {};
            for (let i = 0; i < REWARD_TIER_KEYS.length; i++) dict[REWARD_TIER_KEYS[i]] = this.bili[i];
            params.reward_card_bili = dict;
        } else {
            params.reward_on = this.poolOn;
        }
        GameDataManager.getAccount().reqHallCommand(JSON.stringify(params), context);
        // 失败或丢包时别把整页锁死；回包会带回整表，无需再回读。
        this.scheduleOnce(() => { this.saving = false; }, 3);
    }

    private warn(text: string) {
        if (this.warnedReadFailure) return;
        this.warnedReadFailure = true;
        UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, text);
    }

    private onHallCommand(nCode: number, param: string) {
        if (!param) return;
        const isSet = param.indexOf("设置_俱乐部_奖池_配置") >= 0;
        const isGet = param.indexOf("获取_俱乐部_奖池_配置") >= 0;
        if (!isSet && !isGet) return;

        const data = this.parseResult(param);
        if (isSet) {
            if (!this.saving) return;
            this.saving = false;
            if (nCode === 0x200 && data) {
                this.applyConfig(data);
                let toast = "已保存，下次进池生效";
                if (this.savingKind === "pool") {
                    toast = this.poolOn ? "奖池已开启，下次进池生效" : "奖池已关闭，余额与配置保留";
                }
                UIManager.getInstance().showPanel("panelMsgView", ShowPanelMode.Cover, toast);
            } else {
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

        if (!bili && data["reward_on"] === undefined) {
            Debug.Log("俱乐部奖池配置回包缺少配置字段：" + JSON.stringify(data));
            return;
        }

        this.loading = false;
        this.loaded = true;
        this.refreshRows();
    }
}
