import UIPanelViewBase from "./UIPanelViewBase";
import ScrollItemBase from "./ScrollItemBase";
import ScrollViewNoEnd from "./ScrollViewNoEnd";
import Debug from "./Debug";

const { ccclass, property } = cc._decorator;

/**
 * 纵向虚拟列表。
 *
 * ScrollView 只负责触摸、惯性和边界；本组件根据绝对滚动偏移计算可见数据索引，
 * 用少量节点循环显示。content 不应再用 Layout 自动排列子节点。
 */
@ccclass
export default class scrollview2 extends cc.Component {
    @property(cc.Node)
    view: cc.Node = null;

    @property(cc.Node)
    content: cc.Node = null;

    @property(cc.Node)
    itemPrefab: cc.Node = null;

    @property(cc.Float)
    itemHeight: number = 0;

    @property(cc.Float)
    paddingTop: number = 10;

    @property(cc.Float)
    paddingBottom: number = 10;

    @property(cc.Float)
    spaceY: number = 20;

    public main: UIPanelViewBase = null;

    private readonly bufferRows: number = 2;
    // ScrollView 在 content 不高于 view 时不会进入稳定的弹性拖动流程。
    // 仅保留 1px 不可察觉的滚动余量，使空列表和短列表也能下拉触发 bounce-top。
    private readonly minScrollableDistance: number = 1;
    private data: any[] = [];
    private dataCount: number = 0;
    private poolItems: cc.Node[] = [];
    private poolCapacity: number = 0;
    private renderedStartIndex: number = -1;
    private selfViewNoEnd: ScrollViewNoEnd = null;
    private arrayRoomData: any[] = [];

    private scrollInfoInitialized: boolean = false;
    private pageRequestPending: boolean = false;
    private canLoadMore: boolean = true;
    private updateListFunc: Function = null;
    private responsePageSize: number = 0;

    onLoad() {
        this.ensureScrollView();
        this.disableContentLayout();
        this.normalizeContentAnchor();
        this.collectExistingPoolItems();
        this.node.on("scrolling", this.onVirtualScrolling, this);
    }

    onDestroy() {
        this.node.off("scrolling", this.onVirtualScrolling, this);
        this.updateListFunc = null;
    }

    /**
     * 排行榜等通用列表使用的分页事件绑定。大厅房间列表有独立的分页状态控制。
     */
    public InitScrollInfo(panelBase: UIPanelViewBase, updateFunc: Function) {
        this.ensureScrollView();
        this.main = panelBase;
        this.updateListFunc = updateFunc;

        if (this.scrollInfoInitialized)
            return;

        this.scrollInfoInitialized = true;
        this.node.on(cc.Node.EventType.TOUCH_END, () => {
            if (this.dataCount === 0)
                this.requestPage(0, true);
        }, this);
        this.node.on("bounce-top", () => {
            this.requestPage(0, true);
        }, this);
        this.node.on("scrolling", this.tryRequestNextPage, this);
    }

    public UpdateList(strMsg: string, strName: string) {
        let msg: any = null;
        try {
            msg = JSON.parse(strMsg);
        }
        catch (error) {
            Debug.Error("解析虚拟列表内容失败：" + error);
            this.pageRequestPending = false;
            return;
        }

        if (msg == null || !Array.isArray(msg[strName])) {
            Debug.Log("解析虚拟列表内容失败！");
            this.pageRequestPending = false;
            return;
        }

        this.ensureScrollView();
        this.pageRequestPending = false;

        const temp: any[] = msg[strName].slice();
        const hasCount: boolean = msg.hasOwnProperty("count");
        const totalCount: number = hasCount ? Math.max(0, Number(msg.count) || 0) : 0;
        const currentPage: number = msg.hasOwnProperty("number") ? Math.max(0, Number(msg.number) || 0) : 0;

        if (this.selfViewNoEnd != null) {
            this.selfViewNoEnd.nCurPage = currentPage;
            this.selfViewNoEnd.nCount = totalCount;
        }

        if (currentPage === 0) {
            if (temp.length > 0)
                this.responsePageSize = temp.length;
            this.arrayRoomData = temp;
            this.Init(this.arrayRoomData, true);
        }
        else if (temp.length > 0) {
            this.arrayRoomData.push(...temp);
            this.Init(this.arrayRoomData, false);
        }

        if (hasCount) {
            this.canLoadMore = temp.length > 0 && this.arrayRoomData.length < totalCount;
            if (this.selfViewNoEnd != null) {
                const responsePageSize = this.responsePageSize > 0
                    ? this.responsePageSize
                    : Math.max(1, temp.length, this.arrayRoomData.length);
                this.selfViewNoEnd.nTotlePage = totalCount > 0 ? Math.ceil(totalCount / responsePageSize) : 0;
            }
        }
        else {
            // 没有总数时允许再请求一页；一旦服务器返回空页即停止。
            this.canLoadMore = temp.length > 0;
        }
    }

    public Init(sourceData: any[], bNew: boolean = true) {
        if (!this.view || !this.content || !this.itemPrefab) {
            Debug.Error("虚拟列表缺少 view、content 或 itemPrefab 配置");
            return;
        }

        this.ensureScrollView();
        this.disableContentLayout();
        this.normalizeContentAnchor();
        this.collectExistingPoolItems();

        const oldOffsetY = !bNew && this.selfViewNoEnd != null
            ? Math.max(0, this.selfViewNoEnd.getScrollOffset().y)
            : 0;

        this.data = Array.isArray(sourceData) ? sourceData : [];
        this.dataCount = this.data.length;
        this.itemHeight = this.itemPrefab.getContentSize().height;

        const rowStride = this.getRowStride();
        const visibleCount = rowStride > 0 ? Math.max(1, Math.ceil(this.view.height / rowStride)) : 1;
        const desiredPoolCapacity = Math.min(this.dataCount, visibleCount + this.bufferRows * 2);

        this.ensurePoolCapacity(desiredPoolCapacity);
        this.poolCapacity = desiredPoolCapacity;
        this.renderedStartIndex = -1;

        const logicalHeight = this.dataCount > 0
            ? this.paddingTop + this.paddingBottom + this.dataCount * this.itemHeight + (this.dataCount - 1) * this.spaceY
            : this.paddingTop + this.paddingBottom;
        this.content.height = Math.max(this.view.height + this.minScrollableDistance, logicalHeight);

        if (this.selfViewNoEnd != null) {
            this.selfViewNoEnd.stopAutoScroll();
            if (bNew)
                this.selfViewNoEnd.scrollToTop();
            else
                this.selfViewNoEnd.scrollToOffset(cc.v2(0, Math.min(oldOffsetY, this.selfViewNoEnd.getMaxScrollOffset().y)));
        }

        this.refreshVisibleItems(true);
    }

    private ensureScrollView() {
        if (this.selfViewNoEnd == null)
            this.selfViewNoEnd = this.node.getComponent(ScrollViewNoEnd);
    }

    /**
     * 虚拟列表通过绝对坐标摆放复用节点，不能再让 Layout 重算节点位置和 content 高度。
     * 兼容历史 Prefab 即使仍带有启用的 Layout，也在运行时安全关闭。
     */
    private disableContentLayout() {
        if (!this.content)
            return;
        const layout = this.content.getComponent(cc.Layout);
        if (layout != null && layout.enabled)
            layout.enabled = false;
    }

    /**
     * 旧大厅 Prefab 的 content 锚点是 0.5，排行榜中还出现过 1.27。
     * 虚拟列表统一使用顶部锚点，并在修改时保持 content 顶边的世界位置不变。
     */
    private normalizeContentAnchor() {
        if (!this.content || Math.abs(this.content.anchorY - 1) < 0.0001)
            return;

        const oldTopY = this.content.y + (1 - this.content.anchorY) * this.content.height;
        this.content.setAnchorPoint(this.content.anchorX, 1);
        this.content.y = oldTopY;
    }

    private collectExistingPoolItems() {
        if (!this.content || this.poolItems.length > 0)
            return;

        for (const child of this.content.children) {
            if (child && child.getComponent(ScrollItemBase) != null)
                this.poolItems.push(child);
        }
    }

    private ensurePoolCapacity(desiredCapacity: number) {
        while (this.poolItems.length < desiredCapacity) {
            const item = cc.instantiate(this.itemPrefab);
            item.active = false;
            item.setParent(this.content);
            const scrollItem = item.getComponent(ScrollItemBase);
            if (scrollItem != null)
                scrollItem.main = this.main;
            this.poolItems.push(item);
        }

        for (const item of this.poolItems) {
            const scrollItem = item.getComponent(ScrollItemBase);
            if (scrollItem != null)
                scrollItem.main = this.main;
        }
    }

    private getRowStride(): number {
        return this.itemHeight + this.spaceY;
    }

    private onVirtualScrolling() {
        this.refreshVisibleItems(false);
    }

    private refreshVisibleItems(force: boolean) {
        if (!this.content || !this.view || this.poolCapacity <= 0 || this.dataCount <= 0) {
            for (const item of this.poolItems)
                item.active = false;
            this.renderedStartIndex = -1;
            return;
        }

        const rowStride = this.getRowStride();
        if (rowStride <= 0)
            return;

        let offsetY = 0;
        if (this.selfViewNoEnd != null)
            offsetY = Math.max(0, this.selfViewNoEnd.getScrollOffset().y);

        const firstVisibleIndex = Math.max(0, Math.floor(Math.max(0, offsetY - this.paddingTop) / rowStride));
        const maxStartIndex = Math.max(0, this.dataCount - this.poolCapacity);
        const startIndex = Math.min(maxStartIndex, Math.max(0, firstVisibleIndex - this.bufferRows));

        if (!force && startIndex === this.renderedStartIndex)
            return;

        const usedSlots: { [slot: number]: boolean } = {};
        const endIndex = Math.min(this.dataCount, startIndex + this.poolCapacity);
        for (let dataIndex = startIndex; dataIndex < endIndex; dataIndex++) {
            const slot = dataIndex % this.poolCapacity;
            const item = this.poolItems[slot];
            const scrollItem = item.getComponent(ScrollItemBase);
            if (scrollItem == null)
                continue;

            usedSlots[slot] = true;
            const needsRefresh = force || !item.active || scrollItem.DataIndex !== dataIndex;
            scrollItem.main = this.main;
            scrollItem.DataIndex = dataIndex;
            item.setPosition(0, -this.paddingTop - this.itemHeight * 0.5 - dataIndex * rowStride);
            if (needsRefresh)
                scrollItem.Refresh(this.data[dataIndex]);
            item.active = true;
        }

        for (let slot = 0; slot < this.poolItems.length; slot++) {
            if (slot >= this.poolCapacity || !usedSlots[slot])
                this.poolItems[slot].active = false;
        }

        this.renderedStartIndex = startIndex;
    }

    private requestPage(page: number, force: boolean = false) {
        if (this.updateListFunc == null || this.pageRequestPending)
            return;
        if (page > 0 && !this.canLoadMore)
            return;
        if (!force && page === 0 && this.dataCount > 0)
            return;

        this.pageRequestPending = true;
        this.updateListFunc(page);
    }

    private tryRequestNextPage() {
        if (this.selfViewNoEnd == null || this.pageRequestPending || !this.canLoadMore)
            return;

        const maxOffsetY = this.selfViewNoEnd.getMaxScrollOffset().y;
        if (maxOffsetY <= 0)
            return;

        const offsetY = Math.max(0, this.selfViewNoEnd.getScrollOffset().y);
        if (offsetY / maxOffsetY >= 0.75)
            this.requestPage(Number(this.selfViewNoEnd.nCurPage) + 1);
    }
}
