// Exercise the installed 2.4.13 EditBox upgrade and Widget layout without Creator.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const engine = process.env.COCOS_ENGINE || '/Applications/Cocos/Creator/2.4.13/CocosCreator.app/Contents/Resources/engine';
const source = file => fs.readFileSync(path.join(engine, 'cocos2d/core', file), 'utf8');
const cc = {
  Enum: value => value, Component: class {}, Sprite: class {}, Scene: class {},
  Node: {EventType: {SIZE_CHANGED: 'size-changed'}},
  Vec2: {ZERO: {x: 0, y: 0}, ONE: {x: 1, y: 1}}, sys: {isBrowser: false},
  Class(spec) {
    class Comp {}
    for (const [key, value] of Object.entries(spec)) {
      if (typeof value === 'function' && key !== 'extends') Comp.prototype[key] = value;
    }
    for (const [key, value] of Object.entries(spec.properties)) {
      if (value && (value.get || value.set)) {
        Object.defineProperty(Comp.prototype, key, {get: value.get, set: value.set});
      }
    }
    Object.assign(Comp, spec.statics);
    return Comp;
  },
};
function evaluate(code, requireFn = () => { throw Error('Unexpected engine import'); }) {
  const module = {exports: {}};
  vm.runInNewContext(code, {cc, CC_EDITOR: false, CC_DEV: false, module,
    exports: module.exports, require: requireFn});
  return module.exports;
}
const types = evaluate(source('components/editbox/types.js'));
const Label = {Overflow: {CLAMP: 1}};
const EditBox = evaluate(source('components/editbox/CCEditBox.js'), name => {
  if (name.endsWith('CCMacro')) return {VerticalTextAlignment: {TOP: 0, CENTER: 1}};
  if (name.endsWith('CCLabel')) return Label;
  if (name === './types') return types;
  if (name.endsWith('EditBoxImplBase')) return class {
    init() {} setSize() {}
  };
  throw Error('Unexpected engine import: '+name);
});
// Use the engine's actual anchor-aware alignment, not the offline image renderer.
const widgets = source('base-ui/CCWidgetManager.js');
const align = evaluate(widgets.slice(widgets.indexOf('var TOP '), widgets.indexOf('function visitNode'))
  + '\nmodule.exports = align;');
function makeNode(raw, parent) {
  return {
    _parent: parent, _contentSize: {...raw._contentSize}, _anchorPoint: {...raw._anchorPoint},
    x: raw._trs.array[0], y: raw._trs.array[1], scaleX: raw._trs.array[7], scaleY: raw._trs.array[8],
    active: raw._active,
    setAnchorPoint(x, y) { this._anchorPoint = {x, y}; },
    setPosition(x, y) { this.x = x; this.y = y; },
    getContentSize() { return this._contentSize; }, on() {},
    get width() { return this._contentSize.width; }, set width(v) { this._contentSize.width = v; },
    get height() { return this._contentSize.height; }, set height(v) { this._contentSize.height = v; },
  };
}
const prefab = JSON.parse(fs.readFileSync(process.argv[2] || path.join(root, 'assets/resources/Prefabs/钱包.prefab')));
function nodePath(id) {
  const n = prefab[id];
  return (n._parent ? nodePath(n._parent.__id__)+'/' : '')+n._name;
}
let count = 0;
for (const raw of prefab.filter(c => c.__type__ === 'cc.EditBox')) {
  if (process.argv[3] && !process.argv[3].split(',').some(name =>
      nodePath(raw.node.__id__).includes('/'+name+'/'))) continue;
  const owner = makeNode(prefab[raw.node.__id__]);
  const edit = Object.assign(new EditBox(), raw, {node: owner,
    inputMode: raw._N$inputMode, inputFlag: raw._N$inputFlag});
  const labels = ['_N$textLabel', '_N$placeholderLabel'].map(key => {
    const c = prefab[raw[key].__id__], n = prefab[c.node.__id__];
    const node = makeNode(n, owner);
    const widget = {...n._components.map(r => prefab[r.__id__]).find(c => c.__type__ === 'cc.Widget')};
    widget.isStretchWidth = (widget._alignFlags & 40) === 40;
    widget.isStretchHeight = (widget._alignFlags & 5) === 5;
    return {node, widget, string: c._N$string ?? c._string, horizontalAlign: c._N$horizontalAlign,
      verticalAlign: c._N$verticalAlign, overflow: c._N$overflow ?? c._overflow, enableWrapText: c._enableWrapText};
  });
  [edit.textLabel, edit.placeholderLabel] = labels;
  const name = nodePath(raw.node.__id__);
  function check(stage) {
    for (const label of labels) {
      const n = label.node, left = n.x-n._anchorPoint.x*n.width*n.scaleX;
      const top = n.y+(1-n._anchorPoint.y)*n.height*n.scaleY;
      const right = left+n.width*n.scaleX, bottom = top-n.height*n.scaleY;
      const minX = -owner._anchorPoint.x*owner.width;
      const maxY = (1-owner._anchorPoint.y)*owner.height;
      const tag = `${name}: ${stage}`;
      assert.ok(left >= minX-0.001 && right <= minX+owner.width+0.001, tag+' horizontal containment');
      assert.ok(top <= maxY+0.001 && bottom >= maxY-owner.height-0.001, tag+' vertical containment');
      assert.ok(Math.abs((top+bottom)/2-(.5-owner._anchorPoint.y)*owner.height)<0.001, tag+' vertical center');
      assert.equal(label.horizontalAlign, 0, tag+' left-aligned text');
      assert.equal(label.verticalAlign, 1, tag+' centered line');
      assert.equal(label.overflow, Label.Overflow.CLAMP, tag+' long text clipping');
      assert.equal(label.enableWrapText, false, tag+' single line');
      // Recharge-information keeps the caption area at the left of the value.
      if (name.includes('/充值信息/')) assert.ok(left >= minX+199, tag+' reserved caption');
    }
  }
  check('serialized');
  edit.__preload(); // _upgradeComp changes anchors when legacy font properties exist.
  check('after preload');
  for (const text of ['', '中国建设银行', '123456789012345678901234567890']) {
    edit.string = text;
    edit._hideLabels(); edit._showLabels();
    assert.equal(edit.textLabel.node.active, edit.string !== '');
    assert.equal(edit.placeholderLabel.node.active, edit.string === '');
    if (edit.inputFlag === types.InputFlag.PASSWORD) {
      assert.equal(edit.textLabel.string, '●'.repeat(edit.string.length));
    }
    check('input/blur/re-entry');
  }
  // Input-mode notification can reset BOTH anchors; stored layout must survive it.
  edit._updateTextLabel(); edit._updatePlaceholderLabel();
  check('label refresh');
  for (const factor of [0.85, 1, 1.15]) {
    owner.width = prefab[raw.node.__id__]._contentSize.width*factor;
    owner.height = prefab[raw.node.__id__]._contentSize.height*factor;
    for (const label of labels) {
      assert.equal(label.widget._enabled, true);
      assert.equal(label.widget.alignMode, 1);
      align(label.node, label.widget);
    }
    check('input size change '+factor);
  }
  count++;
}
assert.equal(count, Number(process.argv[4] || 20));
console.log(`PASS: ${count} EditBoxes / ${count*2} labels; actual engine preload, text/placeholder, password, re-entry and resize alignment. Creator not launched.`);
