// Run in an agent-owned localhost Creator preview tab only.
// Keeps all game/network components disabled; amounts and room state are samples.
(async () => {
    const prefab = await new Promise((resolve, reject) =>
        cc.loader.loadRes('UI/panelGameView', cc.Prefab, (error, asset) =>
            error ? reject(error) : resolve(asset)));
    const node = cc.instantiate(prefab);
    node.active = false;
    const keep = ['cc.Sprite', 'cc.Label', 'cc.Button', 'cc.Widget', 'cc.Mask', 'cc.Layout'];
    function disableGameComponents(n) {
        n._components.forEach(c => {
            if (!keep.includes(cc.js.getClassName(c))) c.enabled = false;
        });
        n.children.forEach(disableGameComponents);
    }
    disableGameComponents(node);
    const normal = cc.find('Canvas/Normal');
    normal.children.forEach(n => n.active = false);
    normal.addChild(node);
    node.getChildByName('坐下控制').active = true;
    node.getChildByName('UserInfo').active = false;
    node.active = true;
    const F = window.__roomVisual = {
        node, find: path => cc.find(path, node),
        logic: node.getComponent('DrhLogicMgr'), clicks: []
    };
    F.logic.UpdateCurJiangChi('3001800');
    ['坐下控制/坐下0', '奖池条/奖池条'].forEach(path =>
        F.find(path).on('click', () => F.clicks.push(path)));
    return { root: node.name, font: F.find('奖池条/num').getComponent(cc.Label).font.name };
})();
