// Production handlers against serialized nodes, with no live server requests.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..');
const ts=require(process.env.TYPESCRIPT_PATH||'/Users/yy/.nvm/versions/node/v22.19.0/lib/node_modules/nexe/node_modules/typescript/lib/typescript.js');
class Component{}
class Label extends Component{}
class Toggle extends Component{}
class Layout extends Component{updateLayout(){this.node.height=this.node.children.length*84;}}
class Node{
 constructor(o){this.name=o._name;this.active=o._active!==false;this.children=[];this.comps=[];this.height=o._contentSize?.height||0;}
 set parent(n){this.removeFromParent();this._parent=n;if(n)n.children.push(this)} get parent(){return this._parent}
 getChildByName(n){return this.children.find(x=>x.name===n)}
 getComponent(t){return this.comps.find(c=>c instanceof t)}
 getComponentsInChildren(t){return this.comps.filter(c=>c instanceof t).concat(...this.children.map(n=>n.getComponentsInChildren(t)))}
 removeFromParent(){if(this._parent)this._parent.children=this._parent.children.filter(n=>n!==this);this._parent=null}
 destroy(){this.destroyed=true}
}
const cc={Component,Node,Label,Toggle,Layout,error(){},isValid:n=>!!n&&!n.destroyed,_decorator:{ccclass:c=>c,property:()=>()=>{}}};
function prefab(file){const a=JSON.parse(fs.readFileSync(path.join(root,file)));const nodes=new Map();a.forEach((o,i)=>{if(o.__type__==='cc.Node')nodes.set(i,new Node(o))});for(const [i,n]of nodes){const o=a[i];o._children.forEach(r=>nodes.get(r.__id__).parent=n);o._components.forEach(r=>{const v=a[r.__id__],T={'cc.Label':Label,'cc.Toggle':Toggle,'cc.Layout':Layout}[v.__type__];if(T){const c=new T();c.node=n;c.string=v['_N$string'];c.isChecked=v['_N$isChecked'];n.comps.push(c)}})}return nodes.get(a[0].data.__id__)}
cc.instantiate=()=>prefab('assets/resources/Prefabs/奖池记录对象.prefab');
const get=(n,p)=>p.split('/').reduce((n,k)=>n.getChildByName(k),n);
const account={roomSetting:'地九王 底皮1/3',reqHallCommand:(s)=>requests.push(JSON.parse(s))};
let requests=[],loads=[];
const modules={UIPanelViewBase:Component,Tool:{GetChild:get},GameDataManager:{getAccount:()=>account},WebLoadingManager:{loadBlockingRes:(p,t,cb)=>loads.push(cb)}};
function load(file){const mod={exports:{}};const r=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017,experimentalDecorators:true},reportDiagnostics:true});assert.equal(r.diagnostics.length,0);vm.runInNewContext(r.outputText,{cc,console,module:mod,exports:mod.exports,require(n){const key=n.split('/').pop();if(key==='JackpotDisplay')return display;if(n==='kbengine')return {};return {default:modules[key]||Component}}});return mod.exports}
const display=load('assets/scripts/common/JackpotDisplay.ts');
const C=load('assets/scripts/UI/panelGameView.ts').default;
let cases=0;const test=(name,f)=>{f();cases++;console.log('PASS',name)};
test('exact integer/decimal formatting without Number rounding',()=>{
 assert.equal(display.jackpotAmount('9007199254740993.25'),'9,007,199,254,740,993.25');
 assert.equal(display.jackpotAmount(0),'0');assert.equal(display.jackpotAmount('1,234.50'),'1,234.50');
 for(const value of [null,undefined,'',NaN,Infinity,'bad'])assert.equal(display.jackpotAmount(value),'—');
});
test('tier parsing at end of settings and time display',()=>{
 assert.equal(display.jackpotTier('地九王 底皮1/3'),'底皮1/3');assert.equal(display.jackpotTier('底皮 0.2 / 0.5 休芒'),'底皮0.2/0.5');
 assert.equal(display.jackpotTier('无底皮'),'');assert.equal(display.jackpotTime('2026-09-14 14:28:59',true),'09-14\n14:28');
 assert.equal(display.jackpotTime('raw-time'),'raw-time');
});
const c=new C();c.node=prefab('assets/resources/UI/panelGameView.prefab');
const n=p=>get(c.node,'奖池面板/'+p),value=p=>n(p).getComponent(Label).string;
test('three tabs preserve query routes and exclusive content',()=>{
 for(const name of ['奖池总览','奖池','奖池记录']){c.switchJC(name);assert.deepEqual(n('容器').children.filter(x=>x.active).map(x=>x.name),[name]);}
 assert.equal(requests.at(-1).header,'查询_奖池_记录');assert.equal(requests.at(-1).score_type,'底皮1/3');
});
test('all six rewards and current tier remain server values',()=>{
 c.onHallCommand(0x200,JSON.stringify({header:'查询_奖池_信息',result:{all_rewards:'123456789.25',rewards:{'底皮1/3':'386800','底皮2/5':'0'}}}));
 assert.equal(value('容器/奖池总览/总金额/num'),'123,456,789.25');assert.equal(value('容器/奖池/金额/num'),'386,800');
 assert.equal(value('容器/奖池总览/各级奖池奖励设定/底皮2-5'),'0');assert.equal(value('容器/奖池总览/各级奖池奖励设定/底皮50-100'),'—');
 assert.equal(value('容器/奖池/当前级别'),'底皮 1/3');
});
const list=n('容器/奖池记录/记录列表/view/content');
const reply=(rows,winner=rows[0]||[])=>c.RewardPoolRec(JSON.stringify({RewardPoolRec:{history_list:rows,max_winner:winner}}));
const rows=Array.from({length:12},(_,i)=>['玩家'+i,'天皇',77360+i,'2026-09-14 14:28:00']);
test('one asset load preserves server row order and amount/date columns',()=>{
 loads=[];reply(rows);assert.equal(loads.length,1);loads.shift()(null,{});assert.equal(list.children.length,12);
 assert.deepEqual(list.children.map(n=>n.getChildByName('name').getComponent(Label).string),rows.map(x=>x[0]));
 assert.equal(list.children[0].getChildByName('gold').getComponent(Label).string,'77,360');
 assert.equal(list.children[0].getChildByName('time').getComponent(Label).string,'09-14\n14:28');assert(n('容器/奖池记录/V8滚动提示').active);
});
test('new response invalidates old load callback',()=>{
 loads=[];reply(rows);reply([['最新','朵皇',5,'09-14 12:00']]);loads[1](null,{});loads[0](null,{});
 assert.equal(list.children.length,1);assert.equal(list.children[0].getChildByName('name').getComponent(Label).string,'最新');
});
test('empty result clears previous winner and pending rows',()=>{
 loads=[];reply(rows);reply([]);loads[0](null,{});assert.equal(list.children.length,0);
 assert.equal(value('容器/奖池记录/最大赢家/name'),'暂无赢家');assert.equal(value('容器/奖池记录/最大赢家/gold'),'—');
 assert(n('容器/奖池记录/V8记录状态').active);assert(!n('容器/奖池记录/V8滚动提示').active);
});
test('asset failure and destroyed view do not add rows',()=>{
 loads=[];reply(rows);loads[0](new Error('fixture'));assert.equal(list.children.length,0);assert.equal(value('容器/奖池记录/V8记录状态'),'记录加载失败，请重新打开');
 loads=[];reply(rows);c.node.destroyed=true;loads[0](null,{});assert.equal(list.children.length,0);
});
console.log(cases+' jackpot regressions passed.');
