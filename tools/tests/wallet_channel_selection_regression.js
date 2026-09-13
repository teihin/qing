const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Runs the production panel against actual Cocos Toggle/ToggleContainer code in a
// small Node host. This checks interaction/lifecycle logic, not rendering or payments.
// Usage: node tools/tests/wallet_channel_selection_regression.js [panel-source.ts]
// COCOS_ENGINE_ROOT points to Creator's Resources/engine directory.
// TYPESCRIPT_PATH can point to a TypeScript package directory or lib/typescript.js.
function loadTypeScript() {
  const candidates = [
    'typescript',
    process.env.TYPESCRIPT_PATH,
    path.join(require('node:os').homedir(), '.nvm/versions/node/v22.19.0/lib/node_modules/nexe/node_modules/typescript/lib/typescript.js')
  ].filter(Boolean);
  const failures = [];
  for (const candidate of candidates) {
    try {
      const compiler = require(candidate);
      if (typeof compiler.transpileModule !== 'function') throw new Error('transpileModule is unavailable');
      return compiler;
    } catch (error) {
      failures.push(`${candidate}: ${error.code || error.message}`);
    }
  }
  throw new Error('TypeScript compiler unavailable. Install typescript locally or set TYPESCRIPT_PATH to an existing package/lib/typescript.js. Tried:\n' + failures.join('\n'));
}
const ts = loadTypeScript();
const project = path.resolve(__dirname, '../..');
const engineRoot = process.env.COCOS_ENGINE_ROOT || '/Applications/Cocos/Creator/2.4.13/CocosCreator.app/Contents/Resources/engine';
const engine = path.join(engineRoot, 'cocos2d/core');
for (const filename of ['CCToggle.js', 'CCToggleContainer.js', 'CCLayout.js']) {
  const file = path.join(engine, 'components', filename);
  if (!fs.existsSync(file)) throw new Error(`Cocos engine file missing: ${file}. Set COCOS_ENGINE_ROOT to Creator's Resources/engine directory.`);
}
const codePath = process.argv[2] || path.join(project, 'assets/scripts/UI/panelQianBao.ts');
const classes = {};
class Component {
  constructor() { this.enabled = true; }
  get enabledInHierarchy() { return this.enabled && this.node.activeInHierarchy; }
  _super() {}
}
Component.EventHandler = { emitEvents() {} };
class Sprite extends Component {}
class ScrollView extends Component {
  constructor() { super(); this.scrollOffset = 0; this.topCalls = []; }
  scrollToTop(duration) {
    assert.equal(this.enabledInHierarchy, true, 'Scroll reset must run after the recharge root becomes visible');
    this.topCalls.push(duration); this.scrollOffset = 0;
  }
  stopAutoScroll() { this.autoScrolling = false; }
}
// Only native Widget geometry is hosted here; Grid/Toggle logic runs from the
// installed Cocos source. No editor, browser or payment service is started.
class Widget extends Component {
  updateAlignment() {
    const n = this.node, p = n.parent;
    if (!p) return;
    const parentWidget = p.getComponent(Widget);
    if (parentWidget) parentWidget.updateAlignment();
    const flags = this.flags;
    if ((flags & 8) && (flags & 32)) n.width = p.width-this.left-this.right;
    if ((flags & 1) && (flags & 4)) n.height = p.height-this.top-this.bottom;
    if (flags & 1) n.y = p.height*(1-p.anchorY)-this.top-n.height*(1-n.anchorY);
    else if (flags & 4) n.y = -p.height*p.anchorY+this.bottom+n.height*n.anchorY;
    if (flags & 16) n.x = p.width*(.5-p.anchorX)+this.horizontalCenter;
  }
}
class Label extends Component { constructor() { super(); this.string = ''; } }
class EditBox extends Component { constructor() { super(); this.string = ''; } }
class Button extends Component {}
class Node {
  constructor(name, parent = null) {
    this.name = name; this.parent = parent; this._children = []; this.comps = []; this.events = {};
    this._contentSize = { width: 0, height: 0 }; this.anchorX = .5; this.anchorY = .5;
    this.scaleX = this.scaleY = 1; this.x = this.y = 0;
    this._active = true; if (parent) parent._children.push(this);
  }
  static isNode(n) { return n instanceof Node; }
  get width() { return this._contentSize.width; }
  set width(value) { if (value !== this.width) { this._contentSize.width = value; this.emit('size-changed'); } }
  get height() { return this._contentSize.height; }
  set height(value) { if (value !== this.height) { this._contentSize.height = value; this.emit('size-changed'); } }
  getContentSize() { return cc.size(this.width, this.height); }
  setContentSize(w, h) { if (typeof w === 'object') { h = w.height; w = w.width; } this.width = w; this.height = h; }
  getAnchorPoint() { return { x: this.anchorX, y: this.anchorY }; }
  setPosition(v) { this.x = v.x; this.y = v.y; }
  get children() { return this._children; }
  get active() { return this._active; }
  get activeInHierarchy() { return this._active && (!this.parent || this.parent.activeInHierarchy); }
  set active(v) {
    const before = new Map(); this.walk(n => before.set(n, n.activeInHierarchy)); this._active = v;
    this.walk(n => { if (before.get(n) === n.activeInHierarchy) return;
      for (const c of n.comps) if (c.enabled) {
        const hook = n.activeInHierarchy ? c.onEnable : c.onDisable;
        if (hook) hook.call(c);
      }
    });
  }
  walk(fn) { fn(this); this._children.forEach(n => n.walk(fn)); }
  add(C) { const c = new C(); c.node = this; this.comps.push(c); return c; }
  getComponent(C) { return this.comps.find(c => c instanceof C) || null; }
  getComponentsInChildren(C) { const out = []; this.walk(n => n.comps.forEach(c => { if (c instanceof C) out.push(c); })); return out; }
  getChildByName(n) { return this.children.find(c => c.name === n) || null; }
  on(evt, fn, ctx) { (this.events[evt] ||= []).push([fn, ctx]); }
  off(evt, fn, ctx) { this.events[evt] = (this.events[evt] || []).filter(p => p[0] !== fn || p[1] !== ctx); }
  emit(evt, ...args) { (this.events[evt] || []).slice().forEach(([fn, ctx]) => fn.apply(ctx, args)); }
}
const cc = {
  Color: class { constructor(r,g,b,a) { Object.assign(this,{r,g,b,a}); } },
  Component, Button, Sprite, Label, EditBox, Node, ScrollView, Widget, SpriteFrame: class {},
  Enum: v => v, v2: (x, y) => ({ x, y }),
  size: (width, height) => ({ width, height, equals(other) { return width === other.width && height === other.height; } }),
  director: { on() {}, off() {} }, Director: { EVENT_AFTER_UPDATE: 'after-update' },
  _decorator: { ccclass: C => C, property: () => () => {} },
  sys: { isBrowser: false },
  Class(def) {
    const C = class extends def.extends {
      constructor() { super();
        for (const [key, prop] of Object.entries(def.properties || {})) {
          if (prop && typeof prop === 'object' && (prop.get || prop.set)) continue;
          const val = prop && typeof prop === 'object' && 'default' in prop ? prop.default : prop;
          this[key] = Array.isArray(val) ? val.slice() : val;
        }
      }
    };
    for (const [key, prop] of Object.entries(def.properties || {}))
      if (prop && typeof prop === 'object' && (prop.get || prop.set)) Object.defineProperty(C.prototype, key, { get: prop.get, set: prop.set });
    for (const [key, val] of Object.entries(def)) if (typeof val === 'function' && key !== 'extends') C.prototype[key] = val;
    Object.assign(C, def.statics); classes[def.name] = C; return C;
  }
};
Node.EventType = Object.fromEntries(['SIZE_CHANGED', 'ANCHOR_CHANGED', 'CHILD_ADDED', 'CHILD_REMOVED', 'CHILD_REORDER', 'SCALE_CHANGED', 'POSITION_CHANGED'].map(k => [k, k.toLowerCase().replaceAll('_', '-')]));
function loadEngine(name) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(engine, 'components', name), 'utf8'), {
    cc, module, CC_EDITOR: false, CC_DEV: false,
    require(n) {
      if (n === '../platform/js') return { get: (p, k, f) => Object.defineProperty(p, k, { get: f }) };
      if (n === './CCButton') return Button;
      if (n === './CCComponent') return Component;
      if (n === '../CCNode') return Node;
      if (n === './CCToggleGroup') return Component;
      if (n === '../utils/gray-sprite-state') return {};
      throw new Error(n);
    }
  }, { filename: name });
  return module.exports;
}
cc.Toggle = loadEngine('CCToggle.js');
cc.ToggleContainer = loadEngine('CCToggleContainer.js');
cc.Layout = loadEngine('CCLayout.js');
const output = ts.transpileModule(fs.readFileSync(codePath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, experimentalDecorators: true }, reportDiagnostics: true
});
assert.equal((output.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, 'TypeScript syntax');
let requests;
const Tool = {
  GetChild(n, p) { return p.split('/').reduce((cur, name) => cur.getChildByName(name), n); },
  HTTP_GET() {}, // No network requests in this test host.
  Base64Decode(s) { return Buffer.from(s, 'base64').toString('utf8'); }
};
const Config = { getInstance: () => ({ GetOneHashKey: (key, context) => requests.push({ key, context }) }) };
let hallRequests = [];
const account = { guuid: 'test', remark: '0,0,0,0,0,0,0',
  reqHallCommand: (body, context) => hallRequests.push({body, context}) };
const moduleResult = { exports: {} };
vm.runInNewContext(output.outputText, {
  cc, module: moduleResult, exports: moduleResult.exports, console,
  require(n) {
    if (n.endsWith('/UIPanelViewBase')) return { default: class {} };
    if (n.endsWith('/Tool')) return { default: Tool };
    if (n.endsWith('/ConfigManager')) return { default: Config };
    if (n.endsWith('/GameDataManager')) return { default: { getAccount: () => account } };
    if (n.endsWith('/Debug')) return { default: { Log() {} } };
    return { default: {} };
  }
}, { filename: codePath });
const Panel = moduleResult.exports.default;
const prefab = JSON.parse(fs.readFileSync(path.join(project, 'assets/resources/Prefabs/钱包.prefab')));
const serializedNodes = new Map();
function nodePath(n) { return n._parent ? nodePath(prefab[n._parent.__id__]) + '/' + n._name : n._name; }
for (const n of prefab) if (n.__type__ === 'cc.Node') serializedNodes.set(nodePath(n), n);
function hydrateGeometry(root) {
  function visit(n, prefix) {
    const key = prefix ? prefix + '/' + n.name : n.name;
    const data = serializedNodes.get(key);
    if (data) {
      n.setContentSize(data._contentSize); n.anchorX = data._anchorPoint.x; n.anchorY = data._anchorPoint.y;
      [n.x, n.y] = data._trs.array;
      for (const ref of data._components) {
        const c = prefab[ref.__id__];
        if (c.__type__ === 'cc.Widget' && c._enabled) {
          const w = n.add(Widget); w.flags = c._alignFlags;
          for (const prop of ['top', 'bottom', 'left', 'right', 'horizontalCenter']) w[prop] = c['_' + prop];
        }
        if (c.__type__ === 'cc.Layout' && c._enabled) {
          const layout = n.add(cc.Layout);
          layout.type = c['_N$layoutType']; layout.resizeMode = c._resize;
          for (const prop of ['cellSize', 'spacingX', 'spacingY', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'startAxis', 'verticalDirection', 'horizontalDirection', 'affectedByScale']) layout[prop] = c['_N$' + prop];
        }
      }
    }
    n.children.forEach(child => visit(child, key));
  }
  visit(root, '');
}
const definitions = prefab.filter(n => n.__type__ === 'cc.Toggle' && prefab[n.node.__id__]._parent && prefab[prefab[n.node.__id__]._parent.__id__]._name === '充值渠道');
const amountDefinitions = prefab.filter(n => n.__type__ === 'cc.Toggle' && prefab[n.node.__id__]._parent && prefab[prefab[n.node.__id__]._parent.__id__]._name === '金额');
for (const toggle of amountDefinitions) {
  const n=prefab[toggle.node.__id__];
  const label=prefab[n._children.find(r=>prefab[r.__id__]._name==='txt').__id__];
  assert.equal(toggle['_N$isChecked'],false,'No serialized amount selected before configuration');
  assert.deepEqual([label._color.r,label._color.g,label._color.b],[255,237,202],'Every initial amount has unselected text');
}
assert.equal(definitions.length, 9, 'Wallet must expose all 9 configured channel Toggle definitions');
for (const toggle of definitions) {
  const channelName = prefab[toggle.node.__id__]._name;
  const checkMark = prefab[toggle.checkMark.__id__];
  const checkNode = prefab[checkMark.node.__id__];
  // CCToggle only changes checkMark.node.active. A disabled serialized Sprite
  // remains invisible even when the Toggle and its checkmark node are selected.
  assert.equal(checkMark.__type__, 'cc.Sprite', `${channelName}: checkMark must reference a Sprite`);
  assert.equal(checkMark._enabled, true, `${channelName}: checkMark Sprite must stay enabled`);
  assert.equal(checkNode._active, toggle['_N$isChecked'], `${channelName}: initial checkmark node visibility must match isChecked`);
}
function fixture(triggerEvents, screenHeight = 1334) {
  requests = []; cc.Toggle._triggerEventInScript_isChecked = triggerEvents;
  const root = new Node('钱包'); root._active = false;
  const body = new Node('容器', root); const recharge = new Node('充值', body);
  new Node('提现', body)._active = false; new Node('记录', body)._active = false;
  new Node('充值信息', recharge)._active = false;
  const rechargeRoot = new Node('根', recharge); rechargeRoot._active = false;
  const viewport = new Node('通道视口', rechargeRoot); const scroll = viewport.add(ScrollView);
  const channelRoot = new Node('充值渠道', viewport); const container = channelRoot.add(cc.ToggleContainer);
  const amount = new Node('金额', rechargeRoot);
  new Node('充值提示', rechargeRoot).add(Label);
  new Node('V8默认充值提示', rechargeRoot);
  for (const name of ['V7充值面板', 'V7选择充值金额', 'V7充值提示框', '确认充值']) new Node(name, rechargeRoot);
  const tabs = new Node('选项', root);
  ['充值', '提现', '记录'].forEach(name => { const t = new Node(name, tabs).add(cc.Toggle); t._N$isChecked = name === '充值'; });
  const panel = new Panel(); panel.node = root;
  panel.ApplyPaymentChannelIcon = () => {};
  amount.add(cc.ToggleContainer).allowSwitchOff=true;
  const amountToggles=amountDefinitions.map(d=>{
    const data=prefab[d.node.__id__], n=new Node(data._name,amount),t=n.add(cc.Toggle);
    t._N$isChecked=d['_N$isChecked'];
    t.checkMark=new Node('checkmark',n).add(Sprite);
    t.checkMark.node._active=t.isChecked;
    new Node('txt',n).add(Label);
    n.on('toggle',panel.onToggleClick,panel);
    return t;
  });
  const toggles = definitions.map(d => {
    const data = prefab[d.node.__id__]; const n = new Node(data._name, channelRoot); n._active = data._active;
    const t = n.add(cc.Toggle); t._N$isChecked = d['_N$isChecked'];
    const serializedMark = prefab[d.checkMark.__id__];
    t.checkMark = new Node('checkmark', n).add(Sprite);
    t.checkMark.enabled = serializedMark._enabled;
    t.checkMark.node._active = prefab[serializedMark.node.__id__]._active;
    n.on('toggle', panel.onToggleClick, panel); return t;
  });
  hydrateGeometry(root); root.height = screenHeight;
  panel.CaptureRechargeChannelLayout();
  rechargeRoot.on(Node.EventType.SIZE_CHANGED, panel.RefreshRechargeChannelLayout, panel);
  root.active = true;
  const message = (context, content, key = context) => panel.OnUserHashInfo(JSON.stringify({ UserHashInfo: { key, context, content } }));
  const manage = names => message('支付管理', names);
  const config = (channel, notify, money='') => message('更新支付配置', Buffer.from(JSON.stringify({ money, notify, icon: 'default' })).toString('base64'), '支付配置_' + channel);
  const updateRequests = () => requests.filter(r => r.context === '更新支付配置');
  const checked = () => toggles.filter(t => t.isChecked).map(t => t.node.name);
  const visibleMarks = () => toggles.filter(t => t.checkMark.enabledInHierarchy).map(t => t.node.name);
  const pick = name => { const t = toggles.find(t => t.node.name === name); t.toggle({}); };
  return { panel, root, recharge, rechargeRoot, viewport, scroll, channelRoot, container, toggles, amount, amountToggles, manage, config, updateRequests, checked, visibleMarks, pick };
}
let cases = 0;
for (const events of [true, false]) {
  let f = fixture(events);
  // Reproduce an already checked Toggle whose visual node was hidden earlier.
  f.toggles.find(t => t.node.name === '支付3').checkMark.node._active = false;
  f.manage('支付3#支付4#支付5#支付6');
  assert.deepEqual(f.checked(), ['支付3']); assert.deepEqual(f.visibleMarks(), ['支付3']);
  assert.equal(f.updateRequests().length, 1); assert.equal(f.updateRequests()[0].key, '支付配置_支付3');
  assert.equal(f.container.allowSwitchOff, false);
  assert.deepEqual(f.scroll.topCalls, [0]); cases++;

  f.pick('支付4'); assert.deepEqual(f.checked(), ['支付4']); assert.deepEqual(f.visibleMarks(), ['支付4']);
  f.config('支付4', 'current'); const latest = f.panel.strCurZhifuConfig;
  f.config('支付3', 'stale'); assert.equal(f.panel.strCurZhifuConfig, latest); cases++;
  f.pick('支付4'); assert.deepEqual(f.checked(), ['支付4']); f.config('支付4', 'current'); cases++;

  // Empty channel copy must show the approved default; custom copy replaces it.
  const fallback = Tool.GetChild(f.root, '容器/充值/根/V8默认充值提示');
  const notice = Tool.GetChild(f.root, '容器/充值/根/充值提示').getComponent(Label);
  assert.equal(fallback.active, false); assert.equal(notice.string, 'current');
  for (const empty of ['', '  ', null, undefined]) {
    f.config('支付4', empty);
    assert.equal(fallback.active, true); assert.equal(notice.string, '');
  }
  f.config('支付4', 'current');
  assert.equal(fallback.active, false); assert.equal(notice.string, 'current'); cases++;

  f.panel.SwitchTab('记录'); f.config('支付4', 'hidden page'); assert.equal(f.panel.strCurZhifuConfig, latest);
  f.manage('支付1'); assert.deepEqual(f.checked(), ['支付4']);
  Tool.GetChild(f.root, '选项/充值').getComponent(cc.Toggle).isChecked = true;
  f.panel.onToggleClick(Tool.GetChild(f.root, '选项/充值').getComponent(cc.Toggle));
  f.manage('支付3#支付4'); assert.deepEqual(f.checked(), ['支付3']); assert.deepEqual(f.visibleMarks(), ['支付3']); cases++;

  f.scroll.scrollOffset = 400; const resetsBeforeReopen = f.scroll.topCalls.length;
  f.root.active = false; f.config('支付3', 'closed'); assert.equal(f.panel.strCurZhifuConfig, '');
  f.root.active = true;
  f.panel.onToggleClick(Tool.GetChild(f.root, '选项/充值').getComponent(cc.Toggle));
  f.manage('支付1#支付3'); assert.deepEqual(f.checked(), ['支付1']); assert.deepEqual(f.visibleMarks(), ['支付1']);
  assert.equal(f.scroll.scrollOffset, 0);
  assert.equal(f.scroll.topCalls.length, resetsBeforeReopen + 1);
  assert.equal(f.scroll.topCalls.at(-1), 0); cases++;

  f.manage(''); assert.equal(f.rechargeRoot.active, false); assert.deepEqual(f.checked(), []); assert.deepEqual(f.visibleMarks(), []);
  assert.equal(f.panel.strCurZhifuConfig, ''); cases++;

  f.manage('VIP充值'); assert.deepEqual(f.checked(), ['VIP充值']); assert.deepEqual(f.visibleMarks(), ['VIP充值']);
  assert.equal(f.amount.active, false); assert.equal(f.updateRequests().at(-1).key, '支付配置_VIP充值'); cases++;
}
let amountCases=0;
for (const events of [true,false]) {
  const f=fixture(events);f.manage('支付3#支付4');
  const assertAmountState=(selected=-1)=>f.amountToggles.forEach((t,i)=>{
    assert.equal(t.isChecked,i===selected);
    assert.equal(t.checkMark.node.active,i===selected);
    const c=t.node.getChildByName('txt').color;
    assert.deepEqual([c.r,c.g,c.b],i===selected?[4,34,57]:[255,237,202]);
  });
  f.config('支付3','', '50,100,200,300,400,500');assertAmountState();amountCases++;
  // Reproduce the old third-card state before a config reset.
  f.amountToggles[2].toggle({});assertAmountState(2);
  f.config('支付3','', '50,100,200,300,400,500');assertAmountState();amountCases++;
  f.amountToggles[2].toggle({});f.amountToggles[1].toggle({});assertAmountState(1);amountCases++;
  f.amountToggles[1].toggle({});assertAmountState();amountCases++;
  f.amountToggles[2].toggle({});f.pick('支付4');assertAmountState();
  f.config('支付4','', '10,100,200,500,800,1000');assertAmountState();amountCases++;
  f.amountToggles[0].toggle({});f.config('支付3','stale','50,100,200');assertAmountState(0);amountCases++;
  f.root.active=false;f.root.active=true;
  f.panel.onToggleClick(Tool.GetChild(f.root,'选项/充值').getComponent(cc.Toggle));
  f.manage('支付3#支付4');f.config('支付3','', '50,100,200');assertAmountState();
  assert.deepEqual(f.amountToggles.map(t=>t.node.active),[true,true,true,false,false,false]);amountCases++;
}
let layoutCases = 0;
const close = (a, b, message) => assert.ok(Math.abs(a-b)<1e-5, `${message}: ${a} != ${b}`);
for (const height of [1334, 1500, 1624, 1778, 1860]) {
  const f = fixture(true, height);
  const layout = f.channelRoot.getComponent(cc.Layout);
  // Descending and repeated counts reproduce refresh/re-entry, rather than
  // accepting an implementation that grows correctly but can never shrink.
  for (const count of [1,2,3,4,5,6,7,8,9,2,3,1]) {
    const names = f.toggles.slice(0,count).map(t => t.node.name);
    f.manage(names.join('#'));
    const rows = Math.ceil(count/2), rowHeight = f.toggles[0].node.height;
    close(f.channelRoot.height, rows*rowHeight+(rows-1)*layout.spacingY, 'native Grid row height');
    const viewWidget = f.viewport.getComponent(Widget);
    const heading = f.rechargeRoot.getChildByName('V7选择充值金额').getComponent(Widget);
    close(heading.top-(viewWidget.top+f.viewport.height), 47*750/941, 'amount heading follows the visible channel area');
    assert.ok(f.viewport.height <= f.channelRoot.height+1e-5, 'no unused channel rows');
    if (count<=4) close(f.viewport.height,f.channelRoot.height,'one/two rows must fit without empty filler');
    assert.equal(f.scroll.vertical,f.channelRoot.height>f.viewport.height+.1,'only overflowing channels scroll');
    const panel = f.rechargeRoot.getChildByName('V7充值面板'), pw = panel.getComponent(Widget);
    assert.ok(pw.top+panel.height <= f.rechargeRoot.height-pw.bottom+1e-5,'panel and confirm stay on screen');
    const confirm = f.rechargeRoot.getChildByName('确认充值'), confirmWidget = confirm.getComponent(Widget);
    close(pw.top+panel.height-confirmWidget.top-confirm.height,41*750/941,'confirm retains frame padding');
    for (const name of f.panel.rechargeFollowingNodes) {
      const widget = f.rechargeRoot.getChildByName(name).getComponent(Widget);
      close(widget.top-f.panel.rechargeLayoutBase.followingTops[name], f.viewport.height-f.panel.rechargeLayoutBase.viewportHeight, name+' follows without drift');
    }
    close(f.channelRoot.y,f.viewport.height/2,'first channel row starts at viewport top');
    layoutCases++;
  }
  // Simulate a real Widget resize event while the same configured page is open.
  f.manage(f.toggles.map(t=>t.node.name).join('#'));
  for (const resized of [1334,1860,1500]) {
    f.root.height = resized;
    f.rechargeRoot.getComponent(Widget).updateAlignment();
    const panel=f.rechargeRoot.getChildByName('V7充值面板'), pw=panel.getComponent(Widget);
    const fullHeight = pw.top+pw.bottom+f.panel.rechargeLayoutBase.panelHeight-f.panel.rechargeLayoutBase.viewportHeight+f.channelRoot.height;
    close(pw.top+panel.height+pw.bottom, Math.min(fullHeight,f.rechargeRoot.height),'layout recomputes on phone resize');
    layoutCases++;
  }
}
let withdrawCases = 0;
for (const screenHeight of [1334,1624,1778]) {
  const root=new Node('钱包'), body=new Node('容器',root), page=new Node('提现',body), fields=new Node('提现选项',page);
  const names=['金额','姓名','银行','支行','卡号','密码'];
  names.forEach(name=>new Node(name,fields));hydrateGeometry(root);root.height=screenHeight;
  const panel=new Panel();panel.node=root;
  const baseline=names.map(name=>{ const n=fields.getChildByName(name);return [n.height,n.getComponent(Widget).top]; });
  for (const enabled of [false,true,false,true,false]) {
    fields.getChildByName('支行').active=enabled;
    panel.RefreshWithdrawBankRows();
    const visible=names.map(name=>fields.getChildByName(name)).filter(n=>n.active);
    for (let i=1;i<visible.length;i++) {
      const a=visible[i-1],b=visible[i];
      assert.ok(a.getComponent(Widget).top+a.height < b.getComponent(Widget).top,'branch field must not overlap its neighbors');
    }
    const password=fields.getChildByName('密码');
    close(password.getComponent(Widget).top+password.height,baseline.at(-1)[0]+baseline.at(-1)[1],'six fields fit the original form span');
    if (!enabled) names.forEach((name,i)=>{
      const n=fields.getChildByName(name);close(n.height,baseline[i][0],'height restores after mode change');close(n.getComponent(Widget).top,baseline[i][1],'top restores after mode change');
    });
    withdrawCases++;
  }
}
function withdrawalFixture(triggerEvents, autoOptions = true) {
  requests = []; hallRequests = []; account.guuid = 'wallet-test';
  cc.Toggle._triggerEventInScript_isChecked = triggerEvents;
  const root = new Node('钱包'); root._active = false;
  function ensure(p) {
    return p.split('/').reduce((parent, name) => parent.getChildByName(name) || new Node(name,parent),root);
  }
  for (const p of ['容器/充值/根/金额','容器/充值/充值信息','容器/提现/全部提现',
      '容器/记录','Title/关闭','实名/Title/关闭','选择银行','订单详情']) ensure(p);
  for (const field of ['姓名','银行','卡号','交易密码','确认密码']) ensure('实名/信息/'+field+'/input').add(EditBox);
  for (const field of ['金额','姓名','银行','支行','支付宝','卡号','密码','RMB金额','USDT数量','TRC20地址'])
    ensure('容器/提现/提现选项/'+field+'/input').add(EditBox);
  ensure('容器/提现/提现选项/汇率/txt').add(Label);
  ensure('容器/提现/提现选项/提现文本').add(Label);
  const panel = new Panel(); panel.node = root;
  panel.RefreshWithdrawBankRows = () => {}; // Layout has separate checks above.
  panel.GetJiaoYiInfo = () => {};
  for (const [parent,names] of [['选项',['充值','提现','记录']],
      ['容器/提现/类型选择',['银行卡提现','支付宝提现','USDT提现']]]) {
    const group = ensure(parent).add(cc.ToggleContainer); group.allowSwitchOff = false;
    names.forEach((name,i) => {
      const n = ensure(parent+'/'+name), toggle = n.add(cc.Toggle);
      toggle._N$isChecked = i===0;
      n.on('toggle',panel.onToggleClick,panel);
    });
  }
  root.active = true; panel.onEnable();
  const latest = type => requests.filter(r => r.key===account.guuid+'_提现预留_'+type).at(-1);
  const reply = (request,content='',error=false) => {
    assert.ok(request,'expected pending profile request');
    // The live server omits key/content on a missing profile and echoes only
    // its context. Do not invent a key in identity failure/race regressions.
    const info = error && request.key.includes('_提现预留_') ? {context:request.context} : {...request,content};
    panel[error?'OnUserHashError':'OnUserHashInfo'](JSON.stringify({UserHashInfo:info}));
  };
  const optionKeys = ['银行卡提现','支付宝提现','USDT提现','USDT汇率','提现类型'];
  const optionRequests = () => requests.filter(r=>optionKeys.includes(r.key)).slice(-5);
  const options = (values, batch = optionRequests()) => batch.forEach(r => reply(r,values[r.key] || '',!(r.key in values)));
  const click = p => {
    ensure(p).getComponent(cc.Toggle).toggle({});
    if (p==='选项/提现' && autoOptions) options({'银行卡提现':'开','支付宝提现':'开','USDT提现':'开','USDT汇率':'7','提现类型':'3'});
  };
  const field = p => ensure(p).getComponent(EditBox).string;
  const visible = () => ensure('实名').active;
  const closePanel = () => { root.active=false; panel.onDisable(); };
  const reopen = () => { root.active=true; panel.onEnable(); };
  return {panel,root,ensure,latest,reply,click,field,visible,closePanel,reopen,options,optionRequests};
}
const savedBank = '#测试甲#测试银行#测试支行##12345678';
const savedAlipay = '#测试乙###alipay-test#87654321';
let realnameCases = 0;
for (const events of [false,true]) {
  {
    const f = withdrawalFixture(events), request = f.latest('银联');
    const send = (info,error=true) => f.panel[error?'OnUserHashError':'OnUserHashInfo'](JSON.stringify({UserHashInfo:info}));
    send({key:'other-account_提现预留_银联',context:request.context});
    send({context:request.context+'-unknown'});
    send({context:request.context,content:savedBank},false);
    assert.equal(f.visible(),false,'wrong key, unknown context and keyless success cannot resolve identity');
    assert.equal(hallRequests.length,0);
    f.reply(request,'',true);
    assert.equal(f.visible(),true,'first open resolves keyless missing-profile error without entering withdrawal');
    assert.equal(f.ensure('容器/提现').active,false);
    f.reply(request,'',true);
    assert.equal(hallRequests.length,1,'a missing-profile reply is consumed once');
    realnameCases++;
  }
  {
    const f = withdrawalFixture(events), request = f.latest('银联');
    f.panel.OnUserHashError(JSON.stringify({UserHashInfo:{...request,content:''}}));
    assert.equal(f.visible(),true,'keyed missing-profile replies remain supported');
    realnameCases++;
  }
  {
    const f = withdrawalFixture(events), old = f.latest('银联');
    f.closePanel(); f.reopen();
    f.reply(old,'',true);
    assert.equal(f.visible(),false,'keyless error from a previous opening is rejected');
    f.reply(f.latest('银联'),'',true);
    assert.equal(f.visible(),true,'current missing-profile reply still opens setup after reopening');
    realnameCases++;
  }
  for (const errorFirst of [false,true]) {
    const f = withdrawalFixture(events);
    f.reply(f.latest('银联'),savedBank);
    f.click('选项/提现');
    assert.equal(requests.filter(r=>r.key.endsWith('_提现预留_支付宝')).length,0,'deselection must not query Alipay');
    f.reply(f.latest('银联'),savedBank);
    f.click('容器/提现/类型选择/支付宝提现');
    const alipay = f.latest('支付宝');
    f.click('容器/提现/类型选择/银行卡提现');
    const bank = f.latest('银联');
    if (errorFirst) { f.reply(alipay,'',true); f.reply(bank,savedBank); }
    else { f.reply(bank,savedBank); f.reply(alipay,'',true); }
    assert.equal(f.visible(),false,'missing Alipay defaults must not open real-name setup');
    assert.equal(f.field('实名/信息/姓名/input'),'测试甲');
    assert.equal(f.field('容器/提现/提现选项/卡号/input'),'12345678');
    assert.equal(hallRequests.length,0,'optional defaults must not trigger password setup');
    // Duplicated failure after a handled success is stale, not new missing identity.
    f.reply(bank,'',true); assert.equal(f.visible(),false);
    const before = requests.length;
    f.panel.onToggleClick(f.ensure('容器/提现/类型选择/支付宝提现').getComponent(cc.Toggle));
    assert.equal(requests.length,before,'unchecked callback has no side effects');
    realnameCases++;
  }
  {
    const f = withdrawalFixture(events);
    f.reply(f.latest('银联'),savedBank); f.click('选项/提现');
    f.reply(f.latest('银联'),savedBank);
    f.click('容器/提现/类型选择/支付宝提现'); const alipay = f.latest('支付宝');
    f.click('容器/提现/类型选择/银行卡提现'); f.reply(f.latest('银联'),savedBank);
    f.reply(alipay,savedAlipay);
    assert.equal(f.field('实名/信息/姓名/input'),'测试甲','Alipay must not overwrite bank identity');
    assert.equal(f.field('容器/提现/提现选项/卡号/input'),'12345678','old mode must not fill current form');
    f.click('容器/提现/类型选择/USDT提现');
    f.reply(f.latest('USDT'),'',true); assert.equal(f.visible(),false);
    realnameCases++;
  }
  {
    const f = withdrawalFixture(events); const old = f.latest('银联');
    f.closePanel(); f.reply(old,'',true);
    assert.equal(f.visible(),false,'closed wallet ignores missing-profile reply');
    f.reopen(); const current = f.latest('银联');
    f.reply(old,'',true); assert.equal(f.visible(),false,'old wallet session cannot open setup');
    f.reply(current,savedBank); f.reply(old,'',true);
    assert.equal(f.visible(),false); assert.equal(f.field('实名/信息/姓名/input'),'测试甲');
    realnameCases++;
  }
  {
    const f = withdrawalFixture(events), old = f.latest('银联');
    account.guuid = 'different-account';
    f.reply(old,savedBank); f.reply(old,'',true);
    assert.equal(f.visible(),false); assert.equal(f.field('实名/信息/姓名/input'),'');
    realnameCases++;
  }
  {
    const f = withdrawalFixture(events);
    f.reply(f.latest('银联'),'',true);
    assert.equal(f.visible(),true,'genuinely missing bank profile still opens setup');
    assert.equal(hallRequests.length,1);
    f.panel.onHallCommand(0x200,JSON.stringify({header:'校验_玩家_交易密码',result:{}}));
    assert.equal(f.panel.bNeedInitJYPwd,true,'existing empty-password check still requests initialization');
    f.click('选项/提现'); f.reply(f.latest('银联'),savedBank);
    assert.equal(f.visible(),false,'later confirmed bank profile dismisses obsolete setup');
    f.panel.onHallCommand(0x200,JSON.stringify({header:'校验_玩家_交易密码',result:{}}));
    assert.equal(f.panel.bNeedInitJYPwd,false,'late password reply cannot reconfigure a dismissed form');
    realnameCases++;
  }
  {
    const f = withdrawalFixture(events);
    f.click('选项/提现');
    assert.equal(requests.filter(r=>r.key.endsWith('_提现预留_银联')).length,1,'opening and selecting bank share one pending request');
    f.reply(f.latest('银联'),'#测试甲#测试银行###');
    assert.equal(f.visible(),true,'incomplete server profile still needs completion');
    f.panel.onHallCommand(0x400,JSON.stringify({header:'校验_玩家_交易密码',result:{}}));
    assert.equal(f.panel.bNeedInitJYPwd,false);
    assert.equal(f.ensure('实名/信息/交易密码').active,false,'existing password is not reset');
    realnameCases++;
  }
  {
    const f = withdrawalFixture(events);
    f.reply(f.latest('银联'),savedBank); f.click('选项/提现'); const bank = f.latest('银联');
    f.click('选项/记录'); f.reply(bank,savedBank);
    assert.equal(f.visible(),false);
    const count=requests.length;
    f.panel.OnUserHashInfo(JSON.stringify({UserHashInfo:{key:'提现类型',context:'提现类型',content:'3'}}));
    assert.equal(requests.length,count,'late mode config cannot reset a hidden withdrawal page');
    realnameCases++;
  }
}
let switchCases = 0;
for (const events of [false,true]) {
  for (let mask=0;mask<8;mask++) {
    const f=withdrawalFixture(events,false); f.reply(f.latest('银联'),savedBank); f.click('选项/提现');
    assert.equal(f.ensure('容器/提现/提现选项').active,false,'loading starts disabled');
    const config={'银行卡提现':mask&1?'开':'关','支付宝提现':mask&2?'开':'关','USDT提现':mask&4?'开':'关','USDT汇率':'7.25','提现类型':'3'};
    f.options(config,f.optionRequests().reverse());
    ['银行卡提现','支付宝提现','USDT提现'].forEach((name,i)=>assert.equal(f.ensure('容器/提现/类型选择/'+name).active,Boolean(mask&(1<<i)),name));
    assert.equal(f.ensure('容器/提现/提现选项').active,mask!==0);
    assert.equal(f.ensure('容器/提现/全部提现').active,mask!==0);
    if (mask) {
      const expected=mask&1?'银联':mask&2?'支付宝':'USDT';
      assert.equal(f.panel.selectedWithdrawType,expected,'first enabled mode selected after all replies');
      const selected=f.ensure('容器/提现/类型选择').getComponentsInChildren(cc.Toggle).filter(t=>t.isChecked && t.node.active);
      assert.equal(selected.length,1);
    }
    switchCases++;
  }
  for (const config of [{}, {'提现类型':'1'}, {'提现类型':'2'}, {'提现类型':'3'},
      {'提现类型':'3','银行卡提现':'关','支付宝提现':'关'}, {'USDT提现':'true','USDT汇率':'7'},
      {'USDT提现':'开'}, {'USDT提现':'开','USDT汇率':'0'}, {'USDT提现':'开','USDT汇率':'NaN'},
      {'USDT提现':'开','USDT汇率':'-7'}, {'USDT提现':'开','USDT汇率':'Infinity'}]) {
    const f=withdrawalFixture(events,false);f.click('选项/提现');f.options(config);
    assert.equal(f.ensure('容器/提现/类型选择/USDT提现').active,false,'missing/invalid USDT configuration fails closed');
    const legacy=config['提现类型'];
    assert.equal(f.ensure('容器/提现/类型选择/银行卡提现').active,'银行卡提现' in config?config['银行卡提现']==='开':legacy==='1'||legacy==='3');
    assert.equal(f.ensure('容器/提现/类型选择/支付宝提现').active,'支付宝提现' in config?config['支付宝提现']==='开':legacy==='2'||legacy==='3');
    switchCases++;
  }
  {
    const f=withdrawalFixture(events,false);f.click('选项/提现');const old=f.optionRequests();
    f.click('选项/记录');f.options({'USDT提现':'开','USDT汇率':'7'},old);
    assert.equal(f.ensure('容器/提现/类型选择/USDT提现').active,false,'hidden page ignores old option replies');
    f.click('选项/提现');const current=f.optionRequests();f.options({'USDT提现':'开','USDT汇率':'7'},old);
    assert.equal(f.ensure('容器/提现/提现选项').active,false,'old session cannot enable methods');
    f.options({'USDT提现':'关'},current);
    assert.equal(f.ensure('容器/提现/类型选择/USDT提现').active,false);
    switchCases++;
  }
}
assert.equal(fs.readFileSync(codePath,'utf8').includes('/api/JsonPay/hasUSDT'),false,'removed retired website dependency');
console.log(`PASS: ${definitions.length} serialized channel checkmarks; ${cases} interaction cases; ${amountCases} amount state cases; ${layoutCases} channel-height cases; ${withdrawCases} optional-bank-branch layout cases; ${realnameCases} withdrawal/identity race cases; ${switchCases} hash switch/rate cases. Actual Cocos Toggle/ToggleContainer/Grid; TypeScript transpile clean. No Creator launched.`);
