// Exercise the real controller with isolated record responses; no server traffic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.TYPESCRIPT_PATH || path.join(require('node:os').homedir(), '.nvm/versions/node/v22.19.0/lib/node_modules/nexe/node_modules/typescript/lib/typescript.js'));
const root = path.resolve(__dirname, '../..');
class Label { constructor() { this.string = ''; } }
class ScrollViewEx {}
class ToggleContainer {}
class Button {}
Button.Transition = {NONE: 0};
const cc = {Label, ToggleContainer, Button, Toggle: class {}, Component: class {}, Node: {EventType: {
  TOUCH_START: 'touch-start', TOUCH_END: 'touch-end', TOUCH_CANCEL: 'touch-cancel', TOUCH_MOVE: 'touch-move'
}}, _decorator: {ccclass: C => C, property: () => () => {}}};
const requests = [];
const account = {reqHallCommand: (body, route) => requests.push({body: JSON.parse(body), route})};
const imports = {
  '../common/Tool': {default: {GetChild: (node, key) => node.paths[key]}},
  '../GameDataManager': {default: {getAccount: () => account}},
  '../common/ScrollViewEx': {default: ScrollViewEx},
  '../common/WebLoadingManager': {default: {loadBlockingRes: () => {throw Error('Rows should be reused in this fixture');}}},
  kbengine: {Event: {register() {}}}
};
function load(file) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {compilerOptions: {
    target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, experimentalDecorators: true
  }, reportDiagnostics: true});
  assert.equal(compiled.diagnostics.filter(x => x.category === ts.DiagnosticCategory.Error).length, 0, file);
  const m = {exports: {}};
  vm.runInNewContext(compiled.outputText, {cc, console: {log() {}}, module: m, exports: m.exports,
    require: key => imports[key] || {default: class {}}});
  return m.exports;
}
imports['./UIViewBase'] = load('assets/scripts/common/UIViewBase.ts');
imports['../common/UIPanelViewBase'] = load('assets/scripts/common/UIPanelViewBase.ts');
const moduleStub = {exports: load('assets/scripts/UI/panelRecordList.ts')};

const prefab = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/UI/panelRecordList.prefab'), 'utf8'));
const nodeByName = name => prefab.find(x => x.__type__ === 'cc.Node' && x._name === name);
const pager = {active: nodeByName('分页')._active};
const retention = {active: nodeByName('V8保留提示')._active};
const pageLabel = new Label();
const toggles = ['0', '-1', '-2'].map(name => ({node: {name, parent: {name: '条件'}}, isChecked: name === '0'}));
const content = {children: [], get childrenCount() {return this.children.length;}};
const scroll = {nCurPage: 0, nTotlePage: 0, content};
const buttons = ['首页', '上一页', '下一页', '尾页'].map(name => {
  const handlers = {};
  const node = {name, handlers, getComponent: () => null, on: (event, fn, context) => {handlers[event] = fn.bind(context);}};
  return {node, getComponent: () => null};
});
const panel = new moduleStub.exports.default();
panel.node = {name: 'panelRecordList', on() {}, getComponentsInChildren: () => buttons, paths: {
  '战绩列表': {getComponent: () => scroll},
  '分页/页码': {getComponent: () => pageLabel},
  '条件': {getComponent: () => ({toggleItems: toggles})}
}, getChildByName: key => key === '分页' ? pager : retention};
panel.onLoad();
panel.PlayAudio = () => {};
panel.setRecordItemInfo = (node, data) => {node.data = data;};
let checks = 0;
function check(name, run) {run(); checks++; console.log('PASS:', name);}
function response(page, count) {
  const length = Math.min(6, Math.max(0, count - page * 6));
  while (content.childrenCount < length) content.children.push({destroy() {this.destroyed = true;}});
  const rows = Array.from({length}, (_, i) => ({number: String(page), count: String(count), room_id: 'sample-' + i}));
  panel.OnPlayerAllScore(JSON.stringify({PlayerAllScore: rows}));
  content.children = content.children.filter(x => !x.destroyed);
  assert.equal(pager.active, true, 'pagination must remain visible');
  assert.equal(retention.active, false, 'footer prompt must not cover controls');
}
function click(name, expectedPage) {
  requests.length = 0;
  const button = buttons.find(x => x.node.name === name);
  button.node.handlers.click(button);
  if (expectedPage === null) return assert.equal(requests.length, 0, name + ' boundary');
  assert.equal(requests.length, 1, name + ' request');
  assert.equal(requests[0].body.page, String(expectedPage));
  assert.equal(requests[0].body.count, '6');
  assert.equal(requests[0].route, 'P@查询_玩家_所有的牌局_信息');
}

check('initial prefab footer visible, bottom anchored, controls bound', () => {
  assert.equal(pager.active, true); assert.equal(retention.active, false);
  const widget = nodeByName('分页')._components.map(ref => prefab[ref.__id__]).find(x => x.__type__ === 'cc.Widget');
  assert.equal(widget._enabled, true); assert.equal(widget._alignFlags & 4, 4);
  for (const name of ['首页', '上一页', '下一页', '尾页']) {
    const node = nodeByName(name);
    assert.equal(node._active, true);
    const button = node._components.map(ref => prefab[ref.__id__]).find(x => x.__type__ === 'cc.Button');
    assert.equal(button._enabled, true); assert.equal(button['_N$interactable'], true);
    assert.equal(typeof buttons.find(x => x.node.name === name).node.handlers.click, 'function', 'UIViewBase binds button');
  }
});
check('empty initial response is 1/1 and cannot advance', () => {
  response(0, 0); assert.equal(pageLabel.string, '1/1'); click('上一页', null); click('下一页', null); click('尾页', null);
});
check('one page remains visible with working first/last and bounds', () => {
  response(0, 6); assert.equal(pageLabel.string, '1/1'); click('首页', 0); click('尾页', 0); click('上一页', null); click('下一页', null);
});
check('first of three pages requests page 1 and last page 2', () => {
  response(0, 13); assert.equal(pageLabel.string, '1/3'); click('上一页', null); click('下一页', 1); click('尾页', 2);
});
check('middle page supports all four directions', () => {
  response(1, 13); assert.equal(pageLabel.string, '2/3'); click('首页', 0); click('上一页', 0); click('下一页', 2); click('尾页', 2);
});
check('partial last page updates count and prevents advancing', () => {
  response(2, 13); assert.equal(pageLabel.string, '3/3'); assert.equal(content.childrenCount, 1); click('下一页', null); click('上一页', 1); click('首页', 0);
});
for (const date of ['0', '-1', '-2']) check('date ' + date + ' starts at first page and keeps date when paging', () => {
  toggles.forEach(t => t.isChecked = t.node.name === date);
  requests.length = 0; panel.onToggleClick(toggles.find(t => t.isChecked));
  assert.equal(requests[0].body.page, '0'); assert.equal(requests[0].body.date, date);
  response(0, 12); click('下一页', 1); assert.equal(requests[0].body.date, date);
});
check('empty date clears stale last-page state and rows', () => {
  response(2, 13); response(0, 0);
  assert.equal(pageLabel.string, '1/1'); assert.equal(scroll.nCurPage, 0); assert.equal(scroll.nTotlePage, 0);
  assert.equal(content.childrenCount, 0); click('上一页', null); click('下一页', null); click('尾页', null);
});
console.log(`PASS: ${checks} record pagination cases; real controller, request contract and formal prefab.`);
