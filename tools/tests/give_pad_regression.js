// Gift confirmation handler with its live RPC and image manager effects mocked.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const ts=require(process.env.TYPESCRIPT_PATH||path.join(require('os').homedir(),'.nvm/versions/node/v22.19.0/lib/node_modules/nexe/node_modules/typescript/lib/typescript.js'));
const root=path.resolve(__dirname,'../..');
class Label{constructor(){this.string='';}} class EditBox{constructor(){this.string='';}} class Sprite{}
class Node{constructor(name){this.name=name;this.active=true;this.children={};this.comps={};}add(node){this.children[node.name]=node;return node;}get(path){return path.split('/').reduce((node,name)=>node.children[name],this);}getComponent(type){return this.comps[type.name||type];}}
const makeNode=(name,component)=>{const node=new Node(name);if(component)node.comps[component.constructor.name]=component;return node;};
function panelTree(){const rootNode=new Node('panelGivePad'),bk=rootNode.add(new Node('bk'));
 const input=bk.add(makeNode('输入金额',new EditBox()));const amount=bk.add(makeNode('金额',new Label()));
 bk.add(makeNode('密码',new EditBox()));bk.add(makeNode('id',new Label()));bk.add(makeNode('name',new Label()));
 bk.add(new Node('头像')).add(new Node('mask')).add(makeNode('img',new Sprite()));
 return rootNode;
}
const panels=[],closed=[],accountRequests=[],hallRequests=[],imageReads=[],imageWaits=[];
const account={reqAccountCommand:(body,route)=>accountRequests.push({body:JSON.parse(body),route}),reqHallCommand:(body,route)=>hallRequests.push({body:JSON.parse(body),route})};
const Tool={GetChild:(node,path)=>node.get(path)};
const modules={UIPanelViewBase:class{},Tool,GameDataManager:{getAccount:()=>account},UIManager:{getInstance:()=>({showPanel:(...args)=>panels.push(args),closePanelByName:(...args)=>closed.push(args)})},ImageManager:{getInstance:()=>({GetImageByName:(...args)=>{imageReads.push(args);return false;},AddWaitFreshImage2Catch:(...args)=>imageWaits.push(args)})},ConfigManager:{},Debug:{Log(){}}};
const cc={Label,EditBox,Sprite,Button:class{},_decorator:{ccclass:c=>c,property:()=>()=>{}}};
const mod={exports:{}};
const source=fs.readFileSync(path.join(root,'assets/scripts/UI/panelGivePad.ts'),'utf8');
const result=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017,experimentalDecorators:true},reportDiagnostics:true});
assert.equal(result.diagnostics.length,0,'panelGivePad TypeScript diagnostics');
vm.runInNewContext(result.outputText,{cc,module:mod,exports:mod.exports,console,require(name){if(name==='kbengine')return {Event:{register(){}}};if(name.endsWith('GameDef'))return {ShowPanelMode:{Cover:0}};return {default:modules[name.split('/').pop()]||class{}};}});
const C=mod.exports.default;
function makePanel(userData){const panel=Object.create(C.prototype);panel.node=panelTree();panel.strUserData=userData;panel.strID='';panel.strNum='';panel.strYLinfo='';return panel;}
function click(panel){panel.onButtonClick({node:{name:'确定赠送'}});}
function lastMessage(){return panels.at(-1)[2];}

let cases=0;
const manual=makePanel('123456,');manual.start();
assert.equal(manual.strID,'123456');assert.equal(manual.node.get('bk/输入金额').active,true);assert.equal(manual.node.get('bk/金额').active,false);
assert.deepEqual(hallRequests.at(-1),{body:{header:'查询_用户_名字',user_id:'123456'},route:'P@查询_用户_名字'});cases++;
for(const amount of ['', '0', '-1', '1.5', ' 1']){const panel=makePanel('123456,');panel.start();panel.node.get('bk/输入金额').getComponent(EditBox).string=amount;click(panel);assert.equal(accountRequests.length,0);assert(panels.length>0);cases++;}
const noPassword=makePanel('123456,');noPassword.start();noPassword.node.get('bk/输入金额').getComponent(EditBox).string='7';click(noPassword);assert.equal(accountRequests.length,0);assert.match(lastMessage(),/请输入密码/);cases++;
const valid=makePanel('123456,');valid.start();valid.node.get('bk/输入金额').getComponent(EditBox).string='007';valid.node.get('bk/密码').getComponent(EditBox).string='trade-pass';click(valid);
assert.deepEqual(accountRequests.at(-1),{body:{header:'调用_方法_Exchange2',target_guuid:'123456',money_value:'007',money_type:'gold',user_pwd:'trade-pass',client_version:'2022032201'},route:'P@调用_方法_Exchange2'});assert.equal(closed.at(-1)[0],'panelGivePad');cases++;
const preset=makePanel('654321,250');preset.start();assert.equal(preset.node.get('bk/输入金额').active,false);assert.equal(preset.node.get('bk/金额').active,true);preset.node.get('bk/密码').getComponent(EditBox).string='preset-pass';click(preset);assert.equal(accountRequests.at(-1).body.money_value,'250');assert.equal(accountRequests.at(-1).body.target_guuid,'654321');cases++;
const identity=makePanel('123456,');identity.start();identity.UserName(JSON.stringify({id:'999999',name:'别的玩家',photo:'other'}));assert.equal(identity.node.get('bk/name').getComponent(Label).string,'');assert.equal(imageReads.length,0);identity.UserName(JSON.stringify({id:'123456',name:'目标玩家',photo:'avatar-1'}));assert.equal(identity.node.get('bk/name').getComponent(Label).string,'目标玩家');assert.deepEqual(imageReads.at(-1).slice(0,2),['123456','avatar-1']);assert.deepEqual(imageWaits.at(-1).slice(0,1),['123456']);identity.UserName('{bad json');identity.UserName(JSON.stringify({name:'缺少ID'}));assert.equal(identity.node.get('bk/name').getComponent(Label).string,'目标玩家');cases++;
console.log('PASS',cases,'gift confirmation cases: validation, RPC payload, preset amount, and target-only identity/avatar updates.');
