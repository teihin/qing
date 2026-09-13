// Real settings handlers and formal Prefab paths; all account/storage effects are mocked.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const ts=require(process.env.TYPESCRIPT_PATH||path.join(require('os').homedir(),'.nvm/versions/node/v22.19.0/lib/node_modules/nexe/node_modules/typescript/lib/typescript.js'));
const root=path.resolve(__dirname,'../..');
class Node {constructor(o){this.name=o._name;this.active=o._active;this.children=[];this.comps={};}getChildByName(n){return this.children.find(x=>x.name===n)}getComponent(t){return this.comps[t.name||t]||null;}}
class Toggle{};class Label{};
let saved=new Map(),panels=[],commands=[],restarts=0,cleared=0;
const account={anti_theft_on:0,reqAccountCommand:(...a)=>commands.push(a)};
const cc={Toggle,Label,Component:class{},RawAsset:class{},Color:class{constructor(r,g,b,a){Object.assign(this,{r,g,b,a})}},_decorator:{ccclass:c=>c,property:()=>()=>{}},sys:{localStorage:{setItem:(k,v)=>saved.set(k,String(v))}},game:{restart:()=>restarts++}};
const find=(n,p)=>p.split('/').reduce((n,k)=>n.getChildByName(k),n);
const modules={Debug:{Log(){}},Tool:{GetChild:find,GetConfigNumber:(k,d)=>saved.has(k)?Number(saved.get(k)):d},
 GameDataManager:{getAccount:()=>account,getInstance:()=>({bLoginSuccess:true})},
 UIManager:{getInstance:()=>({showPanel:(...a)=>panels.push(a)})},
 DeviceIdentityManager:{getInstance:()=>({prepare:async()=>({available:true,persistent:true,platform:'web',deviceId:'local-test',version:1})})},
 RoomInviteManager:{getInstance:()=>({clearCurrentAccountSession:()=>cleared++})}};
const mod={exports:{}};
const js=ts.transpileModule(fs.readFileSync(root+'/assets/scripts/UI/panelMain.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017,experimentalDecorators:true}}).outputText;
vm.runInNewContext(js,{cc,module:mod,exports:mod.exports,console,require(n){const key=n.split('/').pop();if(key==='GameDef')return {ShowPanelMode:{Cover:0}};return {default:modules[key]||class{}};}});
const C=mod.exports.default,c=Object.create(C.prototype);
const data=JSON.parse(fs.readFileSync(root+'/assets/resources/UI/panelMain.prefab'));
const nodes=new Map();data.forEach((o,i)=>{if(o.__type__==='cc.Node')nodes.set(i,new Node(o));});
for(const [i,n]of nodes){const o=data[i];n.children=o._children.map(r=>nodes.get(r.__id__));for(const ch of n.children)ch.parent=n;
 for(const ref of o._components){const d=data[ref.__id__];if(d.__type__==='cc.Label'){const x=new Label;Object.assign(x,{node:n,string:d._string});n.comps.Label=x;}
  if('checkEvents'in d){const x=new Toggle;Object.assign(x,{node:n,isChecked:d['_N$isChecked'],interactable:true});n.comps.Toggle=x;}}}
c.node=nodes.get(data[0].data.__id__);c.antiTheftToggle=find(c.node,'设置/列表/item/防盗号/防盗号开关').getComponent(Toggle);c.antiTheftStatus=find(c.node,'设置/列表/item/防盗号状态').getComponent(Label);c.antiTheftBusy=false;c.antiTheftSyncing=false;
function click(name){const n=find(c.node,'设置/列表/'+name);assert(n.active,name);c.onButtonClick({node:n});}
(async()=>{
 let cases=0;const open=()=>c.onButtonClick({node:find(c.node,'Main/我的/操作/设置')});
 for(const voice of [0,1])for(const audio of [0,100])for(const anti of [0,1]){saved.set('AudioGCloud',String(voice));saved.set('AudioEff',String(audio));account.anti_theft_on=anti;open();assert.equal(find(c.node,'设置').active,true);assert.equal(find(c.node,'设置/列表/item/聊天语音/聊天语音').getComponent(Toggle).isChecked,!!voice);assert.equal(find(c.node,'设置/列表/item/游戏音效/游戏音效').getComponent(Toggle).isChecked,!!audio);assert.equal(c.antiTheftToggle.isChecked,!!anti);assert(c.antiTheftStatus.node.active);assert.match(c.antiTheftStatus.string,anti?/已开启/:/未开启/);cases++;}
 for(const [name,key,on]of [['聊天语音','AudioGCloud','1'],['游戏音效','AudioEff','100']])for(const value of [true,false]){const t=find(c.node,'设置/列表/item/'+name+'/'+name).getComponent(Toggle);t.isChecked=value;c.onToggleClick(t);assert.equal(saved.get(key),value?on:'0');cases++;}
 click('修改登陆密码');assert(find(c.node,'修改登陆密码').active);cases++;
 c.bNeedInitJYPwd=false;find(c.node,'修改交易密码').active=false;click('修改交易密码');assert(find(c.node,'修改交易密码').active);cases++;
 c.bNeedInitJYPwd=true;find(c.node,'初始化交易密码').active=false;click('修改交易密码');assert(find(c.node,'初始化交易密码').active);cases++;
 assert.equal(find(c.node,'设置/列表/修改预留信息').active,false);cases++;
 c.onButtonClick({node:find(c.node,'设置/title/关闭上上层')});assert.equal(find(c.node,'设置').active,false);open();assert.equal(find(c.node,'设置').active,true);cases++;
 account.anti_theft_on=0;c.antiTheftToggle.isChecked=true;c.onToggleClick(c.antiTheftToggle);assert.equal(c.antiTheftToggle.isChecked,false);await Promise.resolve();assert.match(panels.at(-1)[2],/确认开启/);panels.at(-1)[3][0](false);assert.equal(commands.length,0);assert.equal(c.antiTheftStatus.string,'已取消修改');cases++;
 c.antiTheftBusy=true;c.RefreshAntiTheftSetting('正在绑定当前设备…');assert.equal(c.antiTheftToggle.interactable,false);assert.equal(c.antiTheftStatus.string,'正在绑定当前设备…');cases++;
 click('切换账号');assert.equal(restarts,1);assert.equal(cleared,1);assert.equal(saved.get('unionid'),'');assert.equal(saved.get('pass'),'');cases++;
 console.log('PASS',cases,'production settings handler cases with formal Prefab paths; all storage, account and restart actions isolated in memory.');
})().catch(e=>{console.error(e);process.exitCode=1});
