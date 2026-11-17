const { ccclass, property } = cc._decorator;

/** Binds room values to the serialized buy-in controls; contains no skin/layout code. */
@ccclass
export default class BuyinDisplay extends cc.Component {
    @property(cc.Slider) slider: cc.Slider = null;
    @property(cc.ProgressBar) fill: cc.ProgressBar = null;
    @property(cc.Label) amount: cc.Label = null;
    @property(cc.Label) minimum: cc.Label = null;
    @property(cc.Label) maximum: cc.Label = null;
    @property(cc.Label) already: cc.Label = null;
    @property(cc.Label) balance: cc.Label = null;
    @property(cc.Node) stoneRow: cc.Node = null;
    @property(cc.Label) stone: cc.Label = null;
    @property(cc.Node) stoneCostRow: cc.Node = null;
    @property(cc.Label) stoneCost: cc.Label = null;
    @property(cc.Button) confirm: cc.Button = null;

    private minimumValue = 0;
    private step = 0;
    private maximumValue = 0;
    private count = 0;
    private availableValue = 0;
    private hasAllBalanceOption = false;
    private displayScale = 1;
    private stoneRatio = 1;
    public currentAmount = 0;

    onLoad() {
        if (this.slider != null && cc.isValid(this.slider.node))
            this.slider.node.on('slide', this.onSlide, this);
    }

    // 销毁场景时引擎先销毁子节点再销毁父节点组件，slider 的 node 可能已被置空。
    // 这里必须判空，否则 onDestroy 抛出的异常会中断引擎的销毁/切场景流程，
    // 表现为退出房间时 Error 5000 刷屏与画面反复闪烁。
    onDestroy() {
        if (this.slider != null && cc.isValid(this.slider.node))
            this.slider.node.off('slide', this.onSlide, this);
    }

    /**
     * minimum/step/maximum/defaultValue 都是服务端原值；displayScale 只影响分数显示
     * （0.1/0.3、0.2/0.5 房按 1/10 显示），提交仍用原值。
     */
    public configure(minimum: number, step: number, maximum: number, defaultValue: number,
        already: number, balance: number, displayScale: number = 1, preserveAmount: number = 0) {
        this.displayScale = Number.isFinite(displayScale) && displayScale > 0 ? displayScale : 1;
        this.minimumValue = Number.isFinite(minimum) && minimum > 0 ? minimum : 0;
        this.step = Number.isFinite(step) && step > 0 ? step : this.minimumValue;
        this.maximumValue = Number.isFinite(maximum) && maximum > 0 ? maximum : 0;
        const available = Number.isFinite(balance) && balance > 0 ? balance : 0;
        this.availableValue = available;
        const regularCount = this.minimumValue > 0 && this.step > 0 && this.maximumValue >= this.minimumValue
            ? Math.floor((this.maximumValue - this.minimumValue) / this.step + 1e-8) + 1
            : 0;
        const lastRegularValue = regularCount > 0 ? this.value(regularCount - 1) : 0;
        // 服务端上限允许且余额落在两个离散档之间时，末档代表把当前余额全部带入。
        // 余额刚好是整数档时不重复添加一档；余额超过服务端上限时也不能越过上限。
        this.hasAllBalanceOption = regularCount > 0
            && available > lastRegularValue + 1e-8
            && available <= this.maximumValue + 1e-8;
        this.count = regularCount + (this.hasAllBalanceOption ? 1 : 0);
        this.minimum.string = this.formatScaled(this.minimumValue);
        this.maximum.string = this.formatScaled(this.count ? this.value(this.count - 1) : 0);
        this.already.string = this.formatScaled(Number.isFinite(already) ? already : 0);
        this.balance.string = this.format(available);
        // One valid amount needs no dragging and must never divide by zero.
        this.slider.enabled = this.count > 1;
        // 余额不够最低值时不再禁用「确定」：禁用后点击毫无反馈，玩家会以为按钮坏了。
        // 现在按钮始终可点，由面板在点击时弹出具体原因（俱乐部金币不足 / 余额不足）。
        this.confirm.interactable = true;
        let index = 0;
        if (this.count > 0 && Number.isFinite(preserveAmount) && preserveAmount > 0)
            index = this.indexForAmount(preserveAmount);
        else if (this.count > 0 && Number.isFinite(defaultValue) && defaultValue > 0)
            index = this.indexForAmount(defaultValue);
        this.select(index);
    }

    /** 金额已按最低值和步长生成，这里只做提交前的兜底校验。 */
    public isCurrentAmountValid():boolean {
        return this.count > 0
            && this.currentAmount >= this.minimumValue - 1e-8
            && this.currentAmount <= this.maximumValue + 1e-8;
    }

    /** 当前可用余额是否够最低带入；不够时面板要弹「金币不足」而不是静默不响应。 */
    public hasEnoughBalance():boolean {
        return this.count > 0 && this.availableValue >= this.minimumValue - 1e-8;
    }

    /** 服务端原值口径的最低带入，供面板拼余额不足文案。 */
    public minimumAmount():number {
        return this.minimumValue;
    }

    /** 房间开启「入座扣钻」时显示钻石余额和当前选择会扣的钻石；其它房间隐藏两行。 */
    public setStoneBalance(value: number, visible: boolean, ratio: number = 1) {
        const show = visible === true;
        // 兼容手工改 prefab 后组件引用丢失：按节点名兜底。
        const row = this.stoneRow != null ? this.stoneRow : this.node.getChildByName("钻石余额");
        const costRow = this.stoneCostRow != null ? this.stoneCostRow : this.node.getChildByName("实时扣钻石");
        this.stoneRatio = Number.isFinite(ratio) && ratio >= 0 ? ratio : 1;
        if (row != null)
            row.active = show;
        if (costRow != null)
            costRow.active = show;
        const label = this.stone != null ? this.stone : (row == null ? null : row.getComponent(cc.Label));
        if (label != null)
            label.string = "钻石余额：" + this.format(show && Number.isFinite(value) ? value : 0);
        const costNode = costRow == null ? null : costRow.getChildByName("扣钻石数");
        const costLabel = this.stoneCost != null
            ? this.stoneCost
            : (costNode != null ? costNode.getComponent(cc.Label) : (costRow == null ? null : costRow.getComponent(cc.Label)));
        if (costLabel != null)
            costLabel.string = "落座钻石：" + this.format(show ? this.currentStoneCost() : 0);
    }

    private currentStoneCost():number {
        const value = this.currentAmount * this.stoneRatio;
        return Number.isFinite(value) ? Number(value.toFixed(4)) : 0;
    }

    private value(index: number): number {
        if (this.hasAllBalanceOption && index === this.count - 1)
            return this.availableValue;
        return Number((this.minimumValue + this.step * index).toPrecision(12));
    }

    private indexForAmount(amount: number): number {
        if (this.hasAllBalanceOption && Math.abs(amount - this.availableValue) <= 1e-8)
            return this.count - 1;
        return Math.round((amount - this.minimumValue) / this.step);
    }

    private onSlide() {
        this.select(Math.round(this.slider.progress * Math.max(0, this.count - 1)));
    }

    private select(index: number) {
        index = Math.max(0, Math.min(Math.max(0, this.count - 1), index));
        this.currentAmount = this.count ? this.value(index) : 0;
        this.slider.progress = this.count > 1 ? index / (this.count - 1) : 0;
        this.fill.progress = this.slider.progress;
        this.amount.string = this.formatScaled(this.currentAmount);
        if (this.stoneCost != null)
            this.stoneCost.string = "落座钻石：" + this.format(this.currentStoneCost());
    }

    private formatScaled(value: number): string {
        return this.format(value * this.displayScale);
    }

    private format(value: number): string {
        const parts = String(Number.isFinite(value) ? Number(value.toPrecision(12)) : 0).split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return parts.join('.');
    }
}
