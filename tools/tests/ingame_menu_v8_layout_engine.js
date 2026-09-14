// Exercise the installed Cocos 2.4.13 Grid, including hide/restore on one instance.
const fs = require('fs'), vm = require('vm'), assert = require('assert/strict'), path = require('path');
const root = path.resolve(__dirname, '../..');
const engine = process.env.COCOS_ENGINE || '/Applications/Cocos/Creator/2.4.13/CocosCreator.app/Contents/Resources/engine';
const cc = {Enum: o => o, size: (width,height) => ({width,height}), v2: (x,y) => ({x,y}), Class(spec) {
  class Comp {}
  for (const [k,v] of Object.entries(spec)) if (typeof v === 'function' && k !== 'extends') Comp.prototype[k] = v;
  for (const [k,v] of Object.entries(spec.properties)) if (v && (v.get || v.set)) Object.defineProperty(Comp.prototype,k,{get:v.get,set:v.set});
  return Comp;
}};
const mod = {exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(engine,'cocos2d/core/components/CCLayout.js'),'utf8'),
  {cc,CC_EDITOR:false,CC_DEV:false,module:mod,require:()=>({EventType:{}})});
const names = ['站起围观','补充钵钵','留座离桌','牌型展示','牌局设置','解散房间','联系客服','退出房间'];
let cases = 0;
for (const file of ['assets/resources/UI/panelGameView.prefab','assets/Scenes/drh8.fire']) {
  const a = JSON.parse(fs.readFileSync(path.join(root,file)));
  const raw = a.find(n => n.__type__ === 'cc.Node' && n._name === 'ConfigMain');
  const comps = raw._components.map(r => a[r.__id__]);
  const cfg = comps.find(c => c.__type__ === 'cc.Layout');
  assert.equal(cfg._enabled,true);
  assert.ok(comps.some(c => c.__type__ === 'cc.Button' && c._enabled), 'header close hit target');
  const group = { ...raw._contentSize, _contentSize:{...raw._contentSize}, children:[], getContentSize(){return {width:this.width,height:this.height};}, getAnchorPoint(){return {x:.5,y:.5};} };
  group.children = raw._children.map(r=>a[r.__id__]).map(n=>({
    name:n._name, initial:n._active, activeInHierarchy:n._active,
    ...n._contentSize, anchorX:.5,anchorY:.5,scaleX:1,scaleY:1,
    getAnchorPoint(){return {x:.5,y:.5};}, setPosition(p){this.x=p.x;this.y=p.y;}
  }));
  const layout = Object.assign(new mod.exports(), cfg, {node:group,_layoutDirty:true});
  for (const k of ['cellSize','startAxis','paddingLeft','paddingRight','paddingTop','paddingBottom','spacingX','spacingY','verticalDirection','horizontalDirection','affectedByScale']) layout[k] = cfg['_N$'+k];
  const scenarios = [[], ...names.map(n=>[n]), ['补充钵钵','解散房间'], ['站起围观','留座离桌','解散房间'], names, []];
  for (const hidden of scenarios) {
    group.children.forEach(n=>n.activeInHierarchy=n.initial && !hidden.includes(n.name));
    layout._doLayoutDirty(); layout.updateLayout();
    const visible = group.children.filter(n=>n.activeInHierarchy);
    assert.deepEqual(visible.map(n=>n.name), names.filter(n=>!hidden.includes(n)), 'only actions enter Grid');
    visible.forEach((n,i)=>{
      const x = -group.width/2 + layout.paddingLeft + n.width/2 + i%2*(n.width+layout.spacingX);
      const y = group.height/2-layout.paddingTop-n.height/2-Math.floor(i/2)*(n.height+layout.spacingY);
      assert.ok(Math.abs(n.x-x)<1e-6 && Math.abs(n.y-y)<1e-6, `${file} ${n.name}: hole at slot ${i}`);
    });
    if (hidden.length === 1 && hidden[0] === '解散房间') {
      assert.equal(visible[5].name,'联系客服');
      assert.equal(visible[6].name,'退出房间');
      assert.ok(visible[5].x>0 && visible[6].x<0, 'customer service moves to row 3 right, exit to row 4 left');
    }
    cases++;
  }
}
console.log(`PASS ${cases} actual Cocos Grid scenarios: each hidden action, multiple hides, all hidden, restore; no gaps.`);
