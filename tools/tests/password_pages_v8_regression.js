// Password form validation/dispatch against the formal Prefab; no live account calls.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const ts=require(process.env.TYPESCRIPT_PATH||path.join(require('os').homedir(),'.nvm/versions/node/v22.19.0/lib/node_modules/nexe/node_modules/typescript/lib/typescript.js'));
const root=path.resolve(__dirname,'../..');
class EditBox{};
let messages=[],commands=[],blurs=0;
const cc={Component:class{},RawAsset:class{},EditBox,_decorator:{ccclass:c=>c,property:()=>()=>{}}};
const find=(n,p)=>p.split('/').reduce((n,k)=>n.children.find(c=>c.name===k),n);
const mods={Debug:{Log(){}},Tool:{GetChild:find},GameDataManager:{getAccount:()=>({reqHallCommand:(...args)=>commands.push(args)})},
 UIManager:{getInstance:()=>({showPanel:(...args)=>messages.push(args)})}};
const m={exports:{}};
const result=ts.transpileModule(fs.readFileSync(path.join(root,'assets/scripts/UI/panelMain.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017,experimentalDecorators:true},reportDiagnostics:true});
assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
vm.runInNewContext(result.outputText,{cc,module:m,exports:m.exports,require(name){const key=name.split('/').pop();return key==='GameDef'?{ShowPanelMode:{Cover:0}}:{default:mods[key]||class{}};}});
const data=JSON.parse(fs.readFileSync(path.join(root,'assets/resources/UI/panelMain.prefab'))),nodes=new Map();
for(const [i,o]of data.entries())if(o.__type__==='cc.Node')nodes.set(i,{name:o._name,active:o._active,children:[],comps:{},getChildByName(n){return this.children.find(c=>c.name===n)},getComponent(t){return this.comps[t.name||t]}});
for(const [i,n]of nodes){const o=data[i];n.parent=o._parent&&nodes.get(o._parent.__id__);n.children=o._children.map(r=>nodes.get(r.__id__));
 for(const ref of o._components){const c=data[ref.__id__];if(c.__type__==='cc.EditBox')n.comps.EditBox={string:c._string,blur(){blurs++}};}}
const c=Object.create(m.exports.default.prototype);c.node=nodes.get(data[0].data.__id__);
let count=0;
for(const name of ['修改登陆密码','修改交易密码','初始化交易密码']){
 const init=name==='初始化交易密码';
 const paths=(init?[]:['原有密码']).concat(['新密码1','新密码2']);
 const fields=paths.map(p=>find(c.node,name+'/列表/'+p+'/txt').getComponent(EditBox));
 const click=()=>c.onButtonClick({node:find(c.node,name+'/列表/ok/确定'+name)});
 const values=init?['123456','123456']:['654321','123456','123456'];
 const set=arr=>fields.forEach((e,i)=>e.string=arr[i]);
 for(let i=0;i<fields.length;i++){
  const blank=values.slice();blank[i]='';set(blank);commands=[];messages=[];click();
  assert.equal(commands.length,0);assert.match(messages.at(-1)[2],/请输入|请再次输入/);count++;
 }
 set(values);fields.at(-1).string='000000';commands=[];messages=[];click();
 assert.equal(commands.length,0);assert.match(messages.at(-1)[2],/两次密码输入不一致/);count++;
 set(values);commands=[];click();assert.equal(commands.length,1);
 const [payload,context]=commands[0],body=JSON.parse(payload);
 assert.equal(body.header,name==='修改登陆密码'?'修改_玩家_登录密码':'修改_玩家_交易密码');
 assert.equal(context,'P@'+body.header);assert.equal(body.old_pwd,init?'':'654321');assert.equal(body.new_pwd,'123456');count++;
 find(c.node,name).active=true;c.onButtonClick({node:find(c.node,name+'/title copy/关闭上上层')});
 assert.equal(find(c.node,name).active,false);count++;
}
c.ClearTransactionPasswordInputs();
assert.equal(blurs,5);
for(const page of ['修改交易密码','初始化交易密码'])for(const row of (page==='修改交易密码'?['原有密码']:[]).concat(['新密码1','新密码2']))assert.equal(find(c.node,page+'/列表/'+row+'/txt').getComponent(EditBox).string,'');
count++;
console.log('PASS:',count,'password form validation, mock command dispatch, return and clear cases. No live credentials or network.');
