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
    @property(cc.Button) confirm: cc.Button = null;

    private step = 0;
    private count = 0;
    public currentAmount = 0;

    onLoad() { this.slider.node.on('slide', this.onSlide, this); }
    onDestroy() { this.slider.node.off('slide', this.onSlide, this); }

    public configure(minimum: number, balance: number, already: number) {
        this.step = Number.isFinite(minimum) && minimum > 0 ? minimum : 0;
        const available = Number.isFinite(balance) && balance > 0 ? balance : 0;
        this.count = this.step ? Math.max(0, Math.floor(available / this.step + 1e-8)) : 0;
        this.minimum.string = this.format(this.step);
        this.maximum.string = this.format(this.count ? this.value(this.count - 1) : 0);
        this.already.string = this.format(Number.isFinite(already) ? already : 0);
        this.balance.string = this.format(available);
        // One valid amount needs no dragging and must never divide by zero.
        this.slider.enabled = this.count > 1;
        this.confirm.interactable = this.count > 0;
        this.select(0);
    }

    private value(index: number): number {
        return Number((this.step * (index + 1)).toPrecision(12));
    }

    private onSlide() {
        this.select(Math.round(this.slider.progress * Math.max(0, this.count - 1)));
    }

    private select(index: number) {
        index = Math.max(0, Math.min(Math.max(0, this.count - 1), index));
        this.currentAmount = this.count ? this.value(index) : 0;
        this.slider.progress = this.count > 1 ? index / (this.count - 1) : 0;
        this.fill.progress = this.slider.progress;
        this.amount.string = this.format(this.currentAmount);
    }

    private format(value: number): string {
        const parts = String(value).split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return parts.join('.');
    }
}
