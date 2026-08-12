const {ccclass, property} = cc._decorator;

@ccclass
export default class ScrollViewNoEnd extends cc.ScrollView {

    @property
    nCurPage:number = 0;

    @property
    nTotlePage:number = 0;

    @property
    nCount:number = 0;

    // 滚动物理和边界由 cc.ScrollView 负责；虚拟列表只维护可见节点。
}
