// panelPlayerRecord：请求契约 / 空态 / 分页 / 行为守卫（不连服务器）
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.TYPESCRIPT_PATH || path.join(require('node:os').homedir(),
  '.workbuddy/binaries/node/workspace/node_modules/typescript'));
const root = path.resolve(__dirname, '../..');

class Label { constructor() { this.string = ''; } }
class Sprite {}
class ScrollViewEx {
  constructor() {
    this.nCurPage = 0;
    this.nTotlePage = 0;
    this.scrolled = 0;
    const content = {children: []};
    Object.defineProperty(content, 'childrenCount', {get() { return this.children.length; }});
    this.content = content;
  }
  scrollToTop() { this.scrolled++; }
}
class Toggle {
  constructor(name, checked) { this.node = {name, parent: {name: '条件'}}; this.isChecked = checked; }
}
class ToggleContainer { constructor(items) { this.toggleItems = items; } }
class Button {}
Button.Transition = {NONE: 0};
const cc = {
  Label, Sprite, Toggle, ToggleContainer, Button, Component: class {},
  Node: {EventType: {TOUCH_START: 'touch-start', TOUCH_END: 'touch-end', TOUCH_CANCEL: 'touch-cancel', TOUCH_MOVE: 'touch-move'}},
  color: (r, g, b, a) => ({r, g, b, a}),
  isValid: () => true,
  _decorator: {ccclass: C => C, property: () => () => {}},
};

const requests = [];
let scroll = null;
const toggles = [new Toggle('0', true), new Toggle('-1', false), new Toggle('-2', false)];
const opened = [];
const closed = [];
const account = {guuid: '430994', reqHallCommand: (body, route) => requests.push({body: JSON.parse(body), route})};

function labelNode(name, value = '') {
  const label = new Label();
  label.string = value;
  return {name, active: true, getComponent: t => (t === Label ? label : null), label};
}
function plain(name) {
  return {name, active: true, getComponent: () => null};
}
const tree = {
  '战绩列表': {name: '战绩列表', height: 1010, getComponent: t => (t === ScrollViewEx ? scroll : null)},
  '条件': {name: '条件', getComponent: t => (t === ToggleContainer ? new ToggleContainer(toggles) : null)},
  '分页': {'页码': labelNode('页码', '1/1')},
  '标题栏': {'标题文字': labelNode('标题文字', '玩家战绩'), '玩家': labelNode('玩家', '')},
  '加载': labelNode('加载', '正在查询战绩…'),
  '空状态': labelNode('空状态', '该玩家暂无战绩'),
  '错误': labelNode('错误', '查询失败，请稍后重试'),
};
const GetChild = (node, key) => {
  if (node !== panelNode) return null;
  let current = tree;
  for (const part of key.split('/')) {
    if (current == null) return null;
    current = current[part];
  }
  return current || null;
};
const imports = {
  // PanelBaseZ：大厅 0 / 牌桌 1。测试里没有牌桌父节点，按大厅口径返回 0，
  // 面板各自在此基础上 +n，用来验证「子页压在父页之上」的层级关系。
  '../common/Tool': {default: {GetChild, PanelBaseZ: () => 0}},
  '../GameDataManager': {default: {getAccount: () => account}},
  '../common/UIManager': {default: {getInstance: () => ({
    showPanel: (...args) => opened.push(args),
    closePanelByName: (name, mode) => closed.push(name),
  })}},
  '../common/ScrollViewEx': {default: ScrollViewEx},
  '../common/GameDef': {ShowPanelMode: {Cover: 1, Top: 2}, ClosePanelMode: {Normal: 0}},
  '../common/WebLoadingManager': {default: {loadBlockingRes: () => { throw new Error('no row prefab in this fixture'); }}},
  kbengine: {Event: {register() {}, deregisterAll() {}}},
};

function load(file) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: {target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, experimentalDecorators: true},
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, file);
  const moduleObject = {exports: {}};
  vm.runInNewContext(compiled.outputText, {cc, console: {log() {}}, module: moduleObject,
    exports: moduleObject.exports, setTimeout: () => 0, clearTimeout: () => {},
    require: key => imports[key] || {default: class {}}});
  return moduleObject.exports;
}

imports['./UIViewBase'] = load('assets/scripts/common/UIViewBase.ts');
imports['../common/UIPanelViewBase'] = load('assets/scripts/common/UIPanelViewBase.ts');
const Panel = load('assets/scripts/UI/panelPlayerRecord.ts').default;

scroll = new ScrollViewEx();
const panelNode = {name: 'panelPlayerRecord', on() {}, getComponentsInChildren: () => [], zIndex: 0};
const panel = new Panel();
panel.node = panelNode;
panel.PlayAudio = () => {};

let checks = 0;
function check(name, run) { run(); checks++; console.log('PASS:', name); }

panel.onLoad();
panel.strUserData = JSON.stringify({userId: '121500', name: '张三', clubId: '267493'});

check('入参写进标题与玩家标签', () => {
  panel.ReadInput();
  panel.RefreshTitle();
  assert.equal(tree['标题栏']['标题文字'].label.string, '玩家战绩');
  assert.equal(tree['标题栏']['玩家'].label.string, '张三  ID:121500');
});

check('请求带 user_id / date / page / count，路由与我的战绩一致', () => {
  panel.GetAllRecord(0);
  assert.equal(requests.length, 1);
  const req = requests[0];
  assert.equal(req.route, 'P@查询_玩家_所有的牌局_信息');
  assert.equal(req.body.header, '查询_玩家_所有的牌局_信息');
  assert.equal(req.body.user_id, '121500');
  assert.equal(req.body.date, '0');
  assert.equal(req.body.page, '0');
  assert.equal(req.body.count, String(panel.pageCount));
  assert.ok(panel.pageCount >= 6 && panel.pageCount <= 15, '一页行数在合理区间');
});

check('一页行数按列表高度换算（1010 高约 9 行）', () => {
  assert.equal(panel.pageCount, 9);
});

function row(index) {
  const cells = {};
  const clicks = [];
  return {
    active: false,
    children: [],
    clicks,
    destroy() { this.destroyed = true; },
    getChildByName: name => (cells[name] = cells[name] || labelNode(name)),
    getComponent: t => (t === Button ? {node: {targetOff() {}, on: (evt, fn) => clicks.push(fn)}} : null),
  };
}

check('空回包显示空态、页码 1/1、没有残留行', () => {
  scroll.content.children = [row(0), row(1)];
  panel.OnPlayerAllScore(JSON.stringify({PlayerAllScore: []}));
  assert.equal(tree['空状态'].active, true);
  assert.equal(tree['加载'].active, false);
  assert.equal(tree['错误'].active, false);
  assert.equal(tree['分页']['页码'].label.string, '1/1');
  assert.equal(scroll.content.children.filter(x => !x.destroyed).length, 0);
  scroll.content.children = scroll.content.children.filter(x => !x.destroyed);
});

check('26 条记录按 9 条/页算出 3 页，行内容与颜色按分数走', () => {
  const rows = [];
  for (let i = 0; i < 9; i++) rows.push({number: '0', count: '26', room_id: '59474' + i, score: i === 0 ? '15' : '-8', all_remark: '0,100,0,0,0,2'});
  scroll.content.children = Array.from({length: 9}, (_, i) => row(i));
  scroll.scrolled = 0;
  panel.pending = true;
  panel.OnPlayerAllScore(JSON.stringify({PlayerAllScore: rows}));
  assert.equal(tree['空状态'].active, false);
  assert.equal(tree['分页']['页码'].label.string, '1/3');
  const first = scroll.content.children[0];
  assert.equal(first.getChildByName('房间号').label.string, '594740');
  assert.equal(first.getChildByName('带入').label.string, '100');
  assert.equal(first.getChildByName('底皮').label.string, '2');
  assert.equal(first.getChildByName('输赢').label.string, '15');
  assert.deepEqual(first.getChildByName('输赢').color, cc.color(246, 63, 54, 255));
  assert.deepEqual(scroll.content.children[1].getChildByName('输赢').color, cc.color(139, 188, 25, 255));
  assert.equal(scroll.scrolled, 1, '第一页回包后回到顶部');
});

check('翻页/首页/尾页的边界与请求页码', () => {
  scroll.nCurPage = 1;
  scroll.nTotlePage = 3;
  requests.length = 0;
  panel.onButtonClick({node: {name: '上一页'}});
  assert.equal(requests.at(-1).body.page, '0');
  panel.onButtonClick({node: {name: '下一页'}});
  assert.equal(requests.at(-1).body.page, '2');
  panel.onButtonClick({node: {name: '首页'}});
  assert.equal(requests.at(-1).body.page, '0');
  panel.onButtonClick({node: {name: '尾页'}});
  assert.equal(requests.at(-1).body.page, '2');
  scroll.nCurPage = 0;
  requests.length = 0;
  panel.onButtonClick({node: {name: '上一页'}});
  assert.equal(requests.length, 0, '第一页不能再往前');
});

check('切「昨日」从第一页重查，带上 date=-1', () => {
  toggles.forEach(t => (t.isChecked = t.node.name === '-1'));
  scroll.nCurPage = 2;
  requests.length = 0;
  panel.onToggleClick(toggles[1]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.date, '-1');
  assert.equal(requests[0].body.page, '0');
});

check('推送不是战绩列表时不渲染（别的面板的推送）', () => {
  requests.length = 0;
  panel.pending = false;
  const before = [tree['加载'].active, tree['空状态'].active, tree['错误'].active];
  panel.OnPlayerAllScore(JSON.stringify({NumberList: []}));
  assert.deepEqual([tree['加载'].active, tree['空状态'].active, tree['错误'].active], before, '状态保持不变');
  assert.equal(requests.length, 0, '不会因为别人的推送再发请求');
});

check('点行打开房间详情（panelRecordInfo），带该行房间号 + 浏览态标记', () => {
  assert.equal(scroll.content.children[0].clicks.length, 1, '行上挂了点击');
  scroll.content.children[0].clicks[0]();
  const last = opened.at(-1);
  assert.equal(last[0], 'panelRecordInfo');
  // browse:true —— 数据统计里查的是别人的历史局，结算详情的「返回」只关窗口、不退房回大厅。
  assert.deepEqual(JSON.parse(last[2]), {roomId: '594740', browse: true});
});

check('服务端拒绝（无权查询该玩家战绩）立即提示，不干等超时', () => {
  requests.length = 0;
  panel.pending = true;
  panel.onHallCommand(0x301, JSON.stringify({result: '无权查询该玩家战绩'}));
  assert.equal(panel.pending, false, '结束在途状态');
  assert.equal(tree['错误'].active, true);
  assert.match(tree['错误'].label.string, /仅本人或平台 boss 可查/);
});

check('其它命令的错误回执不打断本面板', () => {
  panel.pending = true;
  tree['错误'].active = false;
  panel.onHallCommand(0x301, JSON.stringify({result: '无权访问', context: '查询_俱乐部_分组列表'}));
  assert.equal(panel.pending, true, '仍在等在途回包');
  assert.equal(tree['错误'].active, false);
  panel.pending = false;
});

check('缺玩家ID时回退查自己（文档：user_id 缺省=自己）', () => {
  requests.length = 0;
  panel.userId = '';
  panel.GetAllRecord(0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.user_id, '430994');
});

check('返回按钮关闭自己', () => {
  panel.onButtonClick({node: {name: '返回'}});
  assert.equal(closed.at(-1), 'panelPlayerRecord');
});

check('静态 Open 带 user_id/昵称走 showPanel', () => {
  Panel.Open('121500', '张三', '267493');
  assert.equal(opened.at(-1)[0], 'panelPlayerRecord');
  assert.deepEqual(JSON.parse(opened.at(-1)[2]), {userId: '121500', name: '张三', clubId: '267493'});
});

console.log(`PASS: ${checks} player-record panel cases.`);
