// Production settlement behavior against nodes from the serialized Prefabs.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require(process.env.TYPESCRIPT_PATH||path.join(require('node:os').homedir(),'.nvm/versions/node/v22.19.0/lib/node_modules/nexe/node_modules/typescript/lib/typescript.js'));
const root=path.resolve(__dirname,'../..');
class Label{} class Sprite{} class Toggle{} class Component{}
const cc={Label,Sprite,Toggle,Component,Color:{RED:{}},color:(r,g,b,a)=>({r,g,b,a}),isValid:n=>!!n,
  _decorator:{ccclass:c=>c,property:()=>()=>{}},director:{getScene:()=>({name:'login'})}};
function prefab(file){
 const data=JSON.parse(fs.readFileSync(path.join(root,file)));const nodes=new Map();
 data.forEach((v,i)=>{if(v.__type__==='cc.Node')nodes.set(i,{name:v._name,active:v._active,color:v._color,children:[],comps:{},getChildByName(n){return this.children.find(c=>c.name===n)},getComponent(t){return this.comps[t.name||t]}})});
 nodes.forEach((n,i)=>{const v=data[i];n.parent=v._parent&&nodes.get(v._parent.__id__);n.children=v._children.map(r=>nodes.get(r.__id__));for(const r of v._components){const c=data[r.__id__];n.comps[c.__type__.replace('cc.','')]={string:c._string,enabled:c._enabled,isChecked:c['_N$isChecked']};}});
 return nodes.get(data.findIndex(v=>v.__type__==='cc.Node'&&!v._parent));
}
const child=(n,p)=>p.split('/').reduce((n,k)=>n.getChildByName(k),n);
let snapshot={queueActive:false},closed=[],opened=[],requests=[];
const source=fs.readFileSync(path.join(root,'assets/scripts/UI/panelRecordInfo.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS,experimentalDecorators:true},reportDiagnostics:true});
assert.equal(compiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const moduleObject={exports:{}};
vm.runInNewContext(compiled.outputText,{cc,module:moduleObject,exports:moduleObject.exports,console,require(name){
 if(name.endsWith('/Tool'))return {default:{GetChild:child}};
 if(name.endsWith('/GameDef'))return {ShowPanelMode:{Cover:1,Top:2}};
 if(name.endsWith('/QueueMatchManager'))return {default:{getInstance:()=>({getSnapshot:()=>snapshot})}};
 if(name.endsWith('/UIManager'))return {default:{getInstance:()=>({showPanel:(...a)=>opened.push(a),closePanelByName:n=>closed.push(n)})}};
 if(name.endsWith('/ImageManager'))return {default:{getInstance:()=>({GetImageByName:()=>true})}};
 if(name.endsWith('/GameDataManager'))return {default:{getAccount:()=>({reqAccountCommand:(...a)=>requests.push(a)})}};
 return {default:class {}};
}});
const Panel=moduleObject.exports.default,p=new Panel();p.node=prefab('assets/resources/UI/panelRecordInfo.prefab');
p.queueButton=child(p.node,'排行/排队');let game=null;p.GetActiveGameView=()=>game;let cases=0;
p.RefreshQueueButtonVisibility();assert.equal(p.queueButton.active,false);cases++;
let queueOpens=0;game={CanOpenQueuePanelFromRecordInfo:()=>true,OpenQueuePanelFromRecordInfo:()=>{queueOpens++;return true}};
p.RefreshQueueButtonVisibility();assert.equal(p.queueButton.active,true);p.onButtonClick({node:p.queueButton});assert.equal(queueOpens,1);cases++;
snapshot.queueActive=true;game.CanOpenQueuePanelFromRecordInfo=()=>false;p.onButtonClick({node:p.queueButton});assert.equal(queueOpens,2);cases++;
snapshot.queueActive=false;p.onButtonClick({node:p.queueButton});assert.equal(opened.at(-1)[0],'panelMsgView');assert.equal(queueOpens,2);cases++;
for(const status of ['waiting','queued','cancelled']){p.OnQueueMatchStateChanged({status});assert.equal(closed.length,0);cases++;}
for(const status of ['assigning','switching','pre_sitting']){p.OnQueueMatchStateChanged({status});assert.equal(closed.at(-1),'panelRecordInfo');cases++;}
const rows=[['alpha','101',100,95],['beta','102',300,-50],['gamma','103',200,0]];
for(const [i,[name,id,bring,score]] of rows.entries()){
 const n=prefab('assets/resources/Prefabs/战绩玩家对象.prefab');
 p.setRecordItemInfo(n,{user_guuid:id,user_name:name,remark:String(bring),remark2:'0,15:55:01,168,38,test,1/3,0,0',all_remark:'0,0,0,0,0,0,0,0,0,0,地方',rounds:'38',score:String(score)},i);
 assert.equal(n.getChildByName('名字').getComponent(Label).string,name);
 assert.equal(n.getChildByName('id').getComponent(Label).string,'ID:'+id);
 assert.equal(n.getChildByName('带入').getComponent(Label).string,String(bring));
 assert.equal(n.getChildByName('输赢').getComponent(Label).string,(score>0?'+':'')+score);
 assert.deepEqual(n.getChildByName('输赢').color,score>0?cc.color(255,105,89,255):score<0?cc.color(203,225,55,255):cc.color(255,242,216,255));
 assert.equal(n.getChildByName('idx').getComponent(Label).enabled,false);cases++;
}
assert.equal(p.strMaxInName,'beta');assert.equal(p.strMaxWinName,'alpha');assert.equal(p.strMinWinName,'beta');cases++;
p.strRoomID='594741';p.UpdateMainShowInfo();assert.equal(child(p.node,'基本/时长').getComponent(Label).string,'15:55');assert.equal(child(p.node,'扩展/底皮').getComponent(Label).string,'底皮:1/3');cases++;
// Data updates must retain the authored summary tint, including a zero pool.
for(const prize of ['168','0','-1']){
 p.strGameJiangChi=prize;p.UpdateMainShowInfo();
 assert.deepEqual(child(p.node,'扩展/奖池').color,child(p.node,'基本/房间名').color);cases++;
}
p.onButtonClick({node:child(p.node,'title/牌局回顾')});assert.equal(child(p.node,'牌局回顾').active,true);assert.equal(JSON.parse(requests.at(-1)[0]).round_id,'1');cases++;
p.onButtonClick({node:child(p.node,'牌局回顾/title/关闭上上层')});assert.equal(child(p.node,'牌局回顾').active,false);cases++;
// Top-level return in history still closes this panel through UIManager.
p.onButtonClick({node:child(p.node,'关闭')});assert.equal(closed.at(-1),'panelRecordInfo');cases++;
console.log(`PASS ${cases} settlement queue, awards, live fields, review and return cases.`);
