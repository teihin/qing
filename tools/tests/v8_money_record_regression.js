// Offline checks of the real controller's display mapping, without Creator.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.TYPESCRIPT_PATH || path.join(require('node:os').homedir(), '.nvm/versions/node/v22.19.0/lib/node_modules/nexe/node_modules/typescript/lib/typescript.js'));
const root=path.resolve(__dirname,'../..');
class Label { constructor() { this.string=''; } }
class Color { constructor(r,g,b,a) { Object.assign(this,{r,g,b,a}); } }
const cc={Label,Color,Component:class {}, _decorator:{ccclass:C=>C, property:()=>()=>{}}, v2:(x,y)=>({x,y})};
function controller(file) {
  const result=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{
    compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS,experimentalDecorators:true},reportDiagnostics:true});
  assert.equal(result.diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0,file+' syntax');
  const m={exports:{}};
  vm.runInNewContext(result.outputText,{cc,console,module:m,exports:m.exports,require:()=>({default:class {}})});
  return Object.create(m.exports.default.prototype);
}
function row(names) {
  const children=Object.fromEntries(names.map(name=>[name,{active:false,color:null,label:new Label(),getComponent(){return this.label;}}]));
  Object.values(children).forEach(node=>{node.label.node=node;});
  return {active:false,getChildByName:name=>children[name],children};
}
const main=controller('assets/scripts/UI/panelMain.ts');
const wallet=controller('assets/scripts/UI/panelQianBao.ts');
let cases=0;
for (const [type,oldMoney,newMoney,icon] of [['充值',10,110,'in'],['游戏输赢',110,80,'game'],['赠送',80,70,'gift'],['提现',70,50,'out'],['未知类型',50,50,''],['结算',277,327,'game'],['带入',327,277,'game']]) {
  const r=row(['type','count','now','time',...['in','out','gift','game'].map(k=>'V8类型图标_'+k)]);
  main.setLiushuiItemInfo(r,{option_type:type,old_money:oldMoney,new_money:newMoney,add_money:999,date:'2026-09-13 18:26:52'});
  assert.equal(r.children.type.label.string,type);
  assert.equal(r.children.now.label.string,String(newMoney));
  assert.equal(r.children.count.label.string,newMoney>oldMoney?'+'+(newMoney-oldMoney):String(newMoney-oldMoney));
  assert.equal(r.children.time.label.string,'09/13 18:26');
  for (const key of ['in','out','gift','game']) assert.equal(r.children['V8类型图标_'+key].active,key===icon);
  if (newMoney>oldMoney) assert.ok(r.children.count.color.g>r.children.count.color.r);
  if (newMoney<oldMoney) assert.ok(r.children.count.color.r>r.children.count.color.g);
  cases++;
}
for (const [type,money,status,out] of [['充值','500','已完成',false],['提现','200','审核中',true],['充值','100','未完成',false]]) {
  const r=row(['type','count','time','id','txt','状态文字','V7充值图标','V7提现图标']);
  wallet.setExchangeItem(r,{work_type:type,money,date:'2026-09-13 18:26:52',work_order:'example-id',status});
  assert.equal(r.children.count.label.string,money); // server amount is never rewritten
  assert.equal(r.children.type.label.string,type);assert.equal(r.children['状态文字'].label.string,status);
  assert.equal(r.children.time.label.string,'09/13 18:26');assert.equal(r.children['V7提现图标'].active,out);
  cases++;
}
console.log(`PASS: ${cases} coin-flow/wallet display cases; real values, signs, dates, type icons and status mappings; both controllers transpile clean.`);
