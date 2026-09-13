// Exercise the production navigation handlers with cached and asynchronous wallets.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require(process.env.TYPESCRIPT_PATH || path.join(require('node:os').homedir(),'.nvm/versions/node/v22.19.0/lib/node_modules/nexe/node_modules/typescript/lib/typescript.js'));
const root=path.resolve(__dirname,'../..');
let pending=[],closed=[];
class Node {
  constructor(name,parent=null) {this.name=name;this.children=[];this.comps={};this.active=true;this.parent=parent;}
  set parent(p) {if(this._parent)this._parent.children=this._parent.children.filter(n=>n!==this);this._parent=p;if(p)p.children.push(this);}
  get parent(){return this._parent;}
  getChildByName(name){return this.children.find(n=>n.name===name)||null;}
  getComponent(type){return this.comps[typeof type==='string'?type:type.name]||null;}
  getComponentsInChildren(type){return [this.getComponent(type),...this.children.flatMap(n=>n.getComponentsInChildren(type))].filter(Boolean);}
}
class Toggle {
  constructor(node,owner,events){this.node=node;this.owner=owner;this.events=events;this._checked=false;node.comps.Toggle=this;}
  get isChecked(){return this._checked;}
  set isChecked(v){if(v===this._checked)return;this._checked=v;if(this.events)this.owner.onToggleClick(this);}
}
const cc={Component:class {},Toggle,RawAsset:class {},_decorator:{ccclass:C=>C,property:()=>()=>{}},
  isValid:n=>n!=null&&!n.destroyed,instantiate:()=>new Node('钱包'),error() {}};
function load(file){
  const result=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS,experimentalDecorators:true},reportDiagnostics:true});
  assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,file);
  const m={exports:{}};
  vm.runInNewContext(result.outputText,{cc,module:m,exports:m.exports,console,require(name){
    if(name.endsWith('/Tool'))return {default:{GetChild:(n,p)=>p.split('/').reduce((n,k)=>n&&n.getChildByName(k),n)}};
    if(name.endsWith('/WebLoadingManager'))return {default:{loadBlockingRes:(resource,title,cb)=>pending.push(cb)}};
    if(name.endsWith('/UIManager'))return {default:{getInstance:()=>({closePanelByName:name=>closed.push(name)})}};
    if(name.endsWith('/Debug'))return {default:{Log(){}}};
    return {default:class {}};
  }});
  return m.exports.default;
}
const Main=load('assets/scripts/UI/panelMain.ts'),Wallet=load('assets/scripts/UI/panelQianBao.ts');
function fixture(cached,events){
  pending=[];const owner=Object.create(Main.prototype);const n=owner.node=new Node('panelMain');n.comps.panelMain=owner;
  Object.assign(owner,{walletOpenRequest:0,walletOpening:false,walletReturnToCashWater:false,updatingMainTabSelection:false});
  const main=new Node('Main',n),down=new Node('Down',n),coin=new Node('资金明细',n);
  coin.records=['unchanged'];coin.page=3;coin.offset=125;
  for(const name of ['发现','我的'])new Node(name,main).active=name==='我的';
  for(const name of ['发现','我的','钱包'])new Toggle(new Node(name,down),owner,events)._checked=name==='我的';
  let roomRefreshes=0,balanceRefreshes=0;
  owner.getAllRooms=()=>roomRefreshes++;owner.set_gold=()=>balanceRefreshes++;
  if(cached)new Node('钱包',main).active=false;
  const openCoin=()=>owner.onButtonClick({node:{name:'金币充值',parent:{name:'V8资金概况'}}});
  const finish=()=>{const cb=pending.shift();if(cb)cb(null,{});};
  const close=()=>{const w=Object.create(Wallet.prototype);w.node=main.getChildByName('钱包');w.onButtonClick({node:{name:'关闭'}});};
  return {owner,main,down,coin,openCoin,finish,close,counts:()=>[roomRefreshes,balanceRefreshes]};
}
let cases=0;
for(const cached of [false,true])for(const events of [false,true]){
  const f=fixture(cached,events);f.openCoin();
  assert.equal(f.coin.active,false);assert.equal(f.down.active,false);
  if(!cached){f.openCoin();assert.equal(pending.length,1);}
  f.finish();assert.equal(f.main.getChildByName('钱包').active,true);
  f.close();assert.equal(f.coin.active,true);assert.equal(f.main.getChildByName('我的').active,true);
  assert.equal(f.main.getChildByName('发现').active,false);assert.equal(f.main.getChildByName('钱包').active,false);
  assert.equal(f.down.active,true);assert.deepEqual(f.coin.records,['unchanged']);assert.equal(f.coin.page,3);assert.equal(f.coin.offset,125);
  assert.deepEqual(f.counts(),[0,1]);cases++;
  // Origin is consumed: a later bottom-tab wallet must still return to the hall.
  f.owner.onToggleClick(f.down.getChildByName('钱包').getComponent(Toggle));f.close();
  assert.equal(f.coin.active,false);assert.equal(f.main.getChildByName('发现').active,true);
  assert.deepEqual(f.counts(),[1,1]);cases++;
}
{
  const f=fixture(false,true);f.openCoin();pending.shift()(new Error('load failed'));
  assert.equal(f.coin.active,true);assert.equal(f.down.active,true);cases++;
}
{
  const f=fixture(false,true);f.openCoin();f.owner.CloseWallet();f.finish();
  assert.equal(f.coin.active,true);assert.equal(f.main.getChildByName('钱包'),null);cases++;
}
{
  const f=fixture(false,true);f.openCoin();f.owner.switchTabSel('发现');f.finish();
  assert.equal(f.main.getChildByName('钱包'),null);assert.equal(f.main.getChildByName('发现').active,true);cases++;
}
{
  const w=Object.create(Wallet.prototype);w.node=new Node('钱包',new Node('Top'));
  w.onButtonClick({node:{name:'关闭'}});assert.deepEqual(closed,['钱包']);cases++;
}
console.log(`PASS: ${cases} wallet origin/cached-load/error/stale-callback/external-close cases; original records, page and offset preserved.`);
