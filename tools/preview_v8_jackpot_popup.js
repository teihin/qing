// Run only in an agent-owned local Creator preview. No account/game requests.
(async () => {
    const load = path => new Promise((resolve, reject) => cc.loader.loadRes(path, cc.Prefab,
        (error, asset) => error ? reject(error) : resolve(asset)));
    const prefab = await load('UI/panelGameView');
    await load('Prefabs/奖池记录对象');
    const node = cc.instantiate(prefab); node.active = false;
    const controller = node.getComponent('panelGameView');
    const keep = ['cc.Sprite', 'cc.Label', 'cc.LabelShadow', 'cc.Button', 'cc.Toggle',
        'cc.ToggleContainer', 'cc.Widget', 'cc.Mask', 'cc.Layout', 'BKMask', 'ScrollViewEx'];
    function strip(n) {
        // Remove unrelated component instances before activation/onLoad.
        n._components = n._components.filter(c => keep.includes(cc.js.getClassName(c)));
        n.children.forEach(strip);
    }
    strip(node);
    const normal = cc.find('Canvas/Normal');
    normal.children.forEach(n => n.active = false); normal.addChild(node);
    const find = path => cc.find(path, node);
    find('坐下控制').active = true; find('UserInfo').active = false;
    const modal = find('奖池面板'); modal.active = true;
    const F = window.__jackpotVisual = {node, controller, find, clicks: [], rows: []};
    const set = (path, value) => find('奖池面板/容器/' + path).getComponent(cc.Label).string = value;
    controller.GetAllJiangChiInfo = () => {
        set('奖池总览/总金额/num', '3,001,800');
        ['1-3','2-5','5-10','10-20','20-40','50-100'].forEach((tier,i) =>
            set('奖池总览/各级奖池奖励设定/底皮'+tier,['386,800','426,000','508,000','601,000','680,000','400,000'][i]));
        set('奖池/金额/num','386,800'); set('奖池/当前级别','底皮 1/3');
    };
    F.rows = ['星海玩家','云山','青岚','北辰','晚风'].map((name,i) =>
        [name,['天皇','杂皇','朵皇','杂皇','朵皇'][i],[77360,38680,7736,32560,6280][i],
            '2026-09-14 '+['14:28','13:56','13:22','12:48','12:16'][i]+':00']);
    controller.scrollJCList = find('奖池面板/容器/奖池记录/记录列表').getComponent('ScrollViewEx');
    controller.GetAllJiangDetal = () => controller.RewardPoolRec(JSON.stringify({RewardPoolRec:{max_winner:F.rows[0]||[],history_list:F.rows}}));
    modal.getChildByName('条件').getComponentsInChildren(cc.Toggle).forEach(toggle => {
        toggle.node.on('toggle', () => { F.clicks.push(toggle.node.name); controller.onToggleClick(toggle); });
    });
    const close = find('奖池面板/bk/关闭上上层').getComponent(cc.Button);
    close.node.on('click', () => { F.clicks.push('关闭'); controller.onButtonClick(close); });
    node.active = true; controller.GetAllJiangChiInfo(); controller.switchJC('奖池');
    F.select = name => controller.switchJC(name);
    return {root:node.name, art:find('奖池面板/bk').getComponent(cc.Sprite).spriteFrame.name,
        cards:find('奖池面板/容器/奖池').children.filter(n=>n.name.startsWith('V8原始牌面')).length};
})();
