import PaiHangScrollItem from "./PaiHangScrollItem";

const {ccclass} = cc._decorator;

/** Sequential pages append to the live list; fixed art stays in the Prefab. */
@ccclass
export default class LeaderboardScrollView extends cc.ScrollView {
    public callBackFresh: (page: number) => void = null;
    private nextPage = 0;
    private loadedCount = 0;
    private loading = false;
    private hasMore = true;
    private failed = false;
    private seen: {[id: string]: boolean} = {};

    start() {
        super.start();
        this.node.on("scrolling", this.checkNearEnd, this);
        this.node.on(cc.Node.EventType.TOUCH_START, this.retryOnGesture, this);
        this.node.on(cc.Node.EventType.MOUSE_WHEEL, this.retryOnGesture, this);
        this.checkNearEnd();
    }

    private retryOnGesture() {
        // A failure waits for a fresh gesture, rather than retrying each frame.
        if (!this.failed) return;
        this.failed = false;
        this.checkNearEnd();
    }

    private checkNearEnd() {
        if (!this.node.activeInHierarchy || this.loading || this.failed || !this.hasMore || !this.callBackFresh) return;
        const remaining = this.getMaxScrollOffset().y - this.getScrollOffset().y;
        if (remaining <= Math.max(360, this.content.parent.height * .75)) this.callBackFresh(this.nextPage);
    }

    public beginPage(page: number): boolean {
        if (this.loading || !this.hasMore || page !== this.nextPage) return false;
        this.loading = true;
        this.failed = false;
        this.node.parent.getChildByName("V8空列表").active = false;
        return true;
    }

    public failPage(page: number) {
        if (page !== this.nextPage) return;
        this.loading = false;
        this.failed = true;
        if (!this.loadedCount) {
            const empty = this.node.parent.getChildByName("V8空列表");
            empty.getComponent(cc.Label).string = "加载失败，请滑动重试";
            empty.active = true;
        }
    }

    public clearPage() {
        this.loading = false;
        this.failed = false;
        this.hasMore = true;
        this.nextPage = this.loadedCount = 0;
        this.seen = {};
        this.content.children.forEach(row => row.active = false);
        this.content.getComponent(cc.Layout).updateLayout();
        this.node.parent.getChildByName("V8空列表").active = false;
        this.stopAutoScroll();
        this.scrollToTop();
    }

    public renderPage(data: any, key: string, template: cc.Node, perPage: number, requestedPage: number) {
        if (!this.loading || requestedPage !== this.nextPage) return;
        if (!Array.isArray(data[key])) throw new Error("Missing leaderboard rows");
        const rows = data[key];
        const first = rows[0] || {};
        const total = data.rowsTotal != null ? data.rowsTotal : data.count != null ? data.count : first.count;
        const count = total == null || total === "" ? NaN : Number(total);
        const before = this.loadedCount;
        rows.forEach((item, index) => {
            // Rankings can shift between requests; don't show overlapping users twice.
            const user = item.user_guuid != null && item.user_guuid !== "" ? item.user_guuid : item.proxy_guuid;
            const identity = user != null && user !== "" ? "u:" + user : item.user_no != null ? "r:" + item.user_no : requestedPage + ":" + index;
            if (this.seen[identity]) return;
            let row = this.content.children[this.loadedCount];
            if (!row) {
                row = cc.instantiate(template);
                this.content.addChild(row);
            }
            row.getComponent(PaiHangScrollItem).Refresh(item, key === "ListActivityUserScore");
            this.seen[identity] = true;
            this.loadedCount++;
        });
        this.nextPage = requestedPage + 1;
        this.hasMore = rows.length > 0 && this.loadedCount > before;
        if (isFinite(count) && count >= 0) this.hasMore = this.hasMore && this.nextPage * perPage < count;
        else if (data.pageNum != null && isFinite(Number(data.pageNum))) this.hasMore = this.hasMore && this.nextPage < Number(data.pageNum);
        else this.hasMore = this.hasMore && rows.length >= perPage;
        // The top anchor keeps already-visible rows in place as height grows.
        // Do not stop inertia or scrollToTop when appending another page.
        this.content.getComponent(cc.Layout).updateLayout();
        this.loading = false;
        const empty = this.node.parent.getChildByName("V8空列表");
        empty.getComponent(cc.Label).string = "暂无排行数据";
        empty.active = this.loadedCount === 0;
        // Also fill a tall viewport if the first response is shorter than it.
        this.scheduleOnce(this.checkNearEnd, 0);
    }
}
