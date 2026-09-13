// Exercise both production controllers against their complete formal Prefab node trees.
// All network, clipboard and capture effects are mocked; no real account is used.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const ts=require(process.env.TYPESCRIPT_PATH||path.join(require('os').homedir(),'.nvm/versions/node/v22.19.0/lib/node_modules/nexe/node_modules/typescript/lib/typescript.js'));
const root=path.resolve(__dirname,'../..');
class Node {
  constructor(o){this.name=o._name;this.active=o._active;this.children=[];this.comps={};this.parent=null;}
  get activeInHierarchy(){return this.active && (!this.parent || this.parent.activeInHierarchy);}
  getChildByName(n){return this.children.find(c=>c.name===n)||null;}
  getComponent(t){return this.comps[typeof t==='string'?t:t.name]||null;}
}
class Label{};class Graphics{};class Layout{};
const find=(n,p)=>p.split('/').reduce((n,k)=>n&&n.getChildByName(k),n);
function prefab(name){
  const a=JSON.parse(fs.readFileSync(path.join(root,'assets/resources/UI/'+name+'.prefab'))),ns=new Map();
  a.forEach((o,i)=>{if(o.__type__==='cc.Node')ns.set(i,new Node(o));});
  for(const [i,n]of ns){const o=a[i];Object.assign(n,o._contentSize);
    n.children=o._children.map(r=>ns.get(r.__id__));for(const ch of n.children)ch.parent=n;
    for(const r of o._components){const c=a[r.__id__],key=c.__type__.replace('cc.','');
      if(['Label','Button','Graphics','Layout'].includes(key))n.comps[key]={node:n,string:c['_N$string']??c._string??'',updateLayout(){this.updates=(this.updates||0)+1;}};
    }
  }
  return ns.get(a[0].data.__id__);
}
const account={guuid:'123456',hongli:0,hongli2:0,fenhong:0},config={downloadurl:'https://example.test'};
const panels=[],copied=[],qrData=[];let captures=0;
const modules={Tool:{GetChild:find},Debug:{Log(){}},GameDataManager:{getAccount:()=>account},ConfigManager:{getInstance:()=>config},MobileManager:{getInstance:()=>({CopyToPhone:v=>copied.push(v),CaptureScreen:()=>captures++})},UIManager:{getInstance:()=>({showPanel:(...a)=>panels.push(a)})}};
const cc={Label,Graphics,Layout,Component:class{},RawAsset:class{},Color:{BLACK:{}},isValid:n=>!!n&&!n.destroyed,_decorator:{ccclass:c=>c,property:()=>()=>{}}};
class QR{addData(v){qrData.push(v);}make(){}getModuleCount(){return 2;}isDark(r,c){return r===c;}}
function load(file){
  const mod={exports:{}};
  const result=ts.transpileModule(fs.readFileSync(path.join(root,'assets/scripts/UI/'+file+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017,experimentalDecorators:true},reportDiagnostics:true});
  assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,file);
  vm.runInNewContext(result.outputText,{cc,QRCode:QR,QRErrorCorrectLevel:{H:1},module:mod,exports:mod.exports,console,require(n){const k=n.split('/').pop();return k==='GameDef'?{ShowPanelMode:{Cover:0}}:{default:modules[k]||class{}};}});
  modules[file]=mod.exports.default;return mod.exports.default;
}
const Main=load('panelMain'),Agent=load('panelHongli');
function fixture(){
  const normal=new Node({_name:'Normal',_active:true}),main=Object.create(Main.prototype),agent=Object.create(Agent.prototype);
  main.node=prefab('panelMain');agent.node=prefab('panelHongli');normal.children=[main.node,agent.node];
  for(const n of normal.children)n.parent=normal;
  main.node.active=agent.node.active=true;main.node.comps.panelMain=main;
  const page=main.node.getChildByName('推广二维码'),old=agent.node.getChildByName('推广二维码');
  const g=find(page,'二维码/img').getComponent(Graphics);Object.assign(g,{clears:0,rects:0,clear(){this.clears++;this.rects=0;},rect(){this.rects++;},fill(){}});
  const click=(owner,p)=>{const n=find(owner.node,p);assert(n,'formal button missing: '+p);assert(n.getComponent('Button'),'not a real button: '+p);owner.onButtonClick({node:n});};
  const openMain=()=>click(main,'Main/我的/操作/推广二维码');
  const openAgent=()=>click(agent,'操作/推广');
  const close=()=>click(main,'推广二维码/title/关闭上上层');
  const value=p=>find(page,p).getComponent(Label).string;
  return {normal,main,agent,page,old,g,openMain,openAgent,close,value,click};
}
let cases=0;
{
  const f=fixture();f.agent.node.active=false;f.openMain();assert(f.page.activeInHierarchy);assert(!f.old.active);
  assert.equal(f.value('V7推广ID'),'推广ID：123456');assert.equal(f.value('V7推广链接'),'https://example.test/zc?guuid=123456');
  f.close();assert(!f.page.active);assert(!f.agent.node.active);cases++;
}
{
  const f=fixture();const state=find(f.agent.node,'我的玩家/列表');state.page=3;state.offset=157;
  for(let i=0;i<3;i++){
    account.guuid=String(456780+i);config.downloadurl='https://example'+i+'.test';f.openAgent();
    assert(f.page.activeInHierarchy);assert.equal(f.page,f.main.node.getChildByName('推广二维码'));assert(!f.agent.node.active);assert(!f.old.active);
    assert.equal(f.value('V7推广ID'),'推广ID：'+account.guuid);assert.equal(f.value('V7推广链接'),config.downloadurl+'/zc?guuid='+account.guuid);
    assert.equal(qrData.at(-1),f.value('V7推广链接'));assert.equal(f.g.rects,2);assert.equal(f.g.clears,i+1);
    f.click(f.main,'推广二维码/复制推广ID');assert.equal(copied.at(-1),account.guuid);
    f.click(f.main,'推广二维码/复制推广地址');assert.equal(copied.at(-1),f.value('V7推广链接'));
    const before=captures;f.click(f.main,'推广二维码/分享二维码');f.click(f.main,'推广二维码/保存二维码');assert.equal(captures,before+2);
    f.close();assert(f.agent.node.activeInHierarchy);assert(!f.page.active);assert.equal(state.page,3);assert.equal(state.offset,157);cases++;
  }
  f.agent.node.active=false;f.openMain();f.close();assert(!f.agent.node.active);cases++;
}
{
  const f=fixture();f.openAgent();f.main.HidePromotionPanelOnLobbyOpen();assert(!f.page.active);assert(f.agent.node.active);
  f.agent.node.active=false;f.openMain();f.close();assert(!f.agent.node.active);cases++;
}
for(const mode of ['destroyed','detached']){
  const f=fixture();f.openAgent();if(mode==='destroyed')f.agent.node.destroyed=true;else f.agent.node.parent=null;
  f.close();assert(!f.agent.node.active);assert(!f.page.active);cases++;
}
for(const mode of ['missing','inactive','no-controller']){
  const f=fixture();if(mode==='missing')f.normal.children=[f.agent.node];else if(mode==='inactive')f.main.node.active=false;else delete f.main.node.comps.panelMain;
  f.openAgent();assert(f.agent.node.active);assert(!f.old.active);assert(!f.page.active);assert.match(panels.at(-1)[2],/推广页面暂未就绪/);cases++;
}
{
  const f=fixture(),foreign=new Node({_name:'foreign',_active:true});f.main.OpenPromotionPanel(foreign);assert(foreign.active);f.close();assert(foreign.active);cases++;
}
{
  const f=fixture(),settings=f.main.node.getChildByName('设置');settings.active=true;
  f.click(f.main,'设置/title/关闭上上层');assert(!settings.active);assert(f.agent.node.active);cases++;
}
{
  const f=fixture();for(const n of ['我的盟主','总业绩'])find(f.agent.node,'操作/'+n).active=false;
  for(const enabled of [false,true]){
    f.agent.OnUserHashInfo(JSON.stringify({UserHashInfo:{key:'推广二维码',content:enabled?'开':'关',context:'推广二维码'}}));
    assert.equal(find(f.agent.node,'操作/推广').active,enabled);assert.equal(find(f.agent.node,'操作').width,422);
  }
  assert.equal(find(f.agent.node,'操作').getComponent(Layout).updates,2);cases++;
}
console.log('PASS',cases,'shared promotion: exact page identity, both entrances, origin return, QR refresh, copy/capture, lifecycle, missing source and config reflow. External effects mocked.');
