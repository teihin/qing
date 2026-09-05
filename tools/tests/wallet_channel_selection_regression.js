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
for (const filename of ['CCToggle.js', 'CCToggleContainer.js']) {
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
}
class Label extends Component { constructor() { super(); this.string = ''; } }
class Button extends Component {}
class Node {
  constructor(name, parent = null) {
    this.name = name; this.parent = parent; this._children = []; this.comps = []; this.events = {};
    this._active = true; if (parent) parent._children.push(this);
  }
  static isNode(n) { return n instanceof Node; }
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
  Component, Button, Sprite, Label, Node, ScrollView, SpriteFrame: class {},
  _decorator: { ccclass: C => C, property: () => () => {} },
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
function loadEngine(name) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(engine, 'components', name), 'utf8'), {
    cc, module, CC_EDITOR: false, CC_DEV: false,
    require(n) {
      if (n === '../platform/js') return { get: (p, k, f) => Object.defineProperty(p, k, { get: f }) };
      if (n === './CCButton') return Button;
      if (n === './CCToggleGroup') return Component;
      if (n === '../utils/gray-sprite-state') return {};
      throw new Error(n);
    }
  }, { filename: name });
  return module.exports;
}
cc.Toggle = loadEngine('CCToggle.js');
cc.ToggleContainer = loadEngine('CCToggleContainer.js');
const output = ts.transpileModule(fs.readFileSync(codePath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, experimentalDecorators: true }, reportDiagnostics: true
});
assert.equal((output.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, 'TypeScript syntax');
let requests;
const Tool = {
  GetChild(n, p) { return p.split('/').reduce((cur, name) => cur.getChildByName(name), n); },
  Base64Decode(s) { return Buffer.from(s, 'base64').toString('utf8'); }
};
const Config = { getInstance: () => ({ GetOneHashKey: (key, context) => requests.push({ key, context }) }) };
const account = { guuid: 'test', remark: '0,0,0,0,0,0,0' };
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
const definitions = prefab.filter(n => n.__type__ === 'cc.Toggle' && prefab[n.node.__id__]._parent && prefab[prefab[n.node.__id__]._parent.__id__]._name === '充值渠道');
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
function fixture(triggerEvents) {
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
  const tabs = new Node('选项', root);
  ['充值', '提现', '记录'].forEach(name => { const t = new Node(name, tabs).add(cc.Toggle); t._N$isChecked = name === '充值'; });
  const panel = new Panel(); panel.node = root;
  panel.ApplyPaymentChannelIcon = () => {};
  const toggles = definitions.map(d => {
    const data = prefab[d.node.__id__]; const n = new Node(data._name, channelRoot); n._active = data._active;
    const t = n.add(cc.Toggle); t._N$isChecked = d['_N$isChecked'];
    const serializedMark = prefab[d.checkMark.__id__];
    t.checkMark = new Node('checkmark', n).add(Sprite);
    t.checkMark.enabled = serializedMark._enabled;
    t.checkMark.node._active = prefab[serializedMark.node.__id__]._active;
    n.on('toggle', panel.onToggleClick, panel); return t;
  });
  root.active = true;
  const message = (context, content, key = context) => panel.OnUserHashInfo(JSON.stringify({ UserHashInfo: { key, context, content } }));
  const manage = names => message('支付管理', names);
  const config = (channel, notify) => message('更新支付配置', Buffer.from(JSON.stringify({ money: '', notify, icon: 'default' })).toString('base64'), '支付配置_' + channel);
  const updateRequests = () => requests.filter(r => r.context === '更新支付配置');
  const checked = () => toggles.filter(t => t.isChecked).map(t => t.node.name);
  const visibleMarks = () => toggles.filter(t => t.checkMark.enabledInHierarchy).map(t => t.node.name);
  const pick = name => { const t = toggles.find(t => t.node.name === name); t.toggle({}); };
  return { panel, root, recharge, rechargeRoot, scroll, channelRoot, container, toggles, amount, manage, config, updateRequests, checked, visibleMarks, pick };
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

  f.panel.SwitchTab('记录'); f.config('支付4', 'hidden page'); assert.equal(f.panel.strCurZhifuConfig, latest);
  f.manage('支付1'); assert.deepEqual(f.checked(), ['支付4']);
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
console.log(`PASS: ${definitions.length} serialized channel checkmark checks; ${cases} wallet channel cases, actual Cocos Toggle/ToggleContainer (${engineRoot}), migration events both enabled and disabled, first-entry/reopen scroll reset checked; TypeScript transpile clean.`);
