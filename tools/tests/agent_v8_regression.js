// Production agent handlers, formal node paths and PageEx; no network or account writes.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const ts=require(process.env.TYPESCRIPT_PATH||path.join(require('os').homedir(),'.nvm/versions/node/v22.19.0/lib/node_modules/nexe/node_modules/typescript/lib/typescript.js'));
const root=path.resolve(__dirname,'../..');
class Node{constructor(o){this.name=o._name;this.active=o._active;this.children=[];this.comps={};this.events={};}getChildByName(n){return this.children.find(c=>c.name===n)}getComponent(t){return this.comps[t.name||t]||null}on(e,fn){this.events[e]=fn}targetOff(){this.events={}}}
class Sprite{};class Label{};class Button{};class EditBox{};class ToggleContainer{};class Layout{};
const find=(n,p)=>p.split('/').reduce((n,k)=>n&&n.getChildByName(k),n);
function prefab(file){const a=JSON.parse(fs.readFileSync(root+'/'+file));const ns=new Map();a.forEach((o,i)=>{if(o.__type__==='cc.Node')ns.set(i,new Node(o))});for(const [i,n]of ns){const o=a[i];n.children=o._children.map(r=>ns.get(r.__id__));for(const ch of n.children)ch.parent=n;for(const r of o._components){const c=a[r.__id__],key=c.__type__.replace('cc.','');if(['Label','Button','EditBox','ToggleContainer','Graphics','Sprite'].includes(key))n.comps[key]={node:n,string:c['_N$string']??c._string??''};}}return ns.get(a[0].data.__id__)}
const commands=[],panels=[];let shares=0;
const account={hongli:'888899',use_hongli:'1791299',all_hongli:'2680000',hongli2:'368099',use_hongli2:'922099',fenhong:'86',role:'盟主',level:'99',client_prop:'True',big_percent:20,guuid:'123456',reqEnterRoom:(...a)=>commands.push(['room',...a]),reqHallCommand:(...a)=>commands.push(['hall',...a]),reqAccountCommand:(...a)=>commands.push(['account',...a])};
const cc={Sprite,Label,Button,EditBox,ToggleContainer,Layout,Component:class{},RawAsset:class{},Color:{BLACK:{}},isValid:x=>!!x,_decorator:{ccclass:c=>c,property:()=>()=>{}}};
class QR{addData(){}make(){}getModuleCount(){return 2}isDark(r,c){return r===c}}
let gpsOpen=true;const avatarBindings=[];
const modules={ImageManager:{getInstance:()=>({BindPlayerListAvatar:(...a)=>avatarBindings.push(a)})},GpsManager:{getInstance:()=>({IsGpsOpen:()=>gpsOpen})},Tool:{GetChild:find},Debug:{Log(){},Error(){}},GameDataManager:{getAccount:()=>account},MobileManager:{getInstance:()=>({CaptureScreen:()=>shares++})},ConfigManager:{getInstance:()=>({downloadurl:'https://example.test',enalbe_gps:'True'})},UIManager:{getInstance:()=>({showPanel:(...a)=>panels.push(a)})},QRCode:QR};
function load(file){const mod={exports:{}};const js=ts.transpileModule(fs.readFileSync(root+'/'+file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017,experimentalDecorators:true}}).outputText;vm.runInNewContext(js,{cc,QRCode:QR,QRErrorCorrectLevel:{H:1},module:mod,exports:mod.exports,console,require(n){const k=n.split('/').pop();if(k==='GameDef')return {ShowPanelMode:{Cover:0,Top:1},RoomType:{Custom:7}};if(k==='QRErrorCorrectLevel')return {default:{H:1}};return {default:modules[k]||class{}};}});return mod.exports.default;}
const C=load('assets/scripts/UI/panelHongli.ts'),c=Object.create(C.prototype);c.node=prefab('assets/resources/UI/panelHongli.prefab');let cases=0;
const node=p=>find(c.node,p),value=p=>node(p).getComponent(Label).string,click=p=>c.onButtonClick({node:node(p)});
for(const method of ['set_hongli','set_all_hongli','set_use_hongli','set_hongli2','set_use_hongli2'])c[method]();
assert.equal(value('提取记录/V8可提取红利'),'8888');assert.equal(value('提取记录/V8累计提取'),'17912');assert.equal(value('奖池提取记录/V8奖池余额'),'3680');assert.equal(value('提取红利面板/bk/V8可提取金额'),'可提取金额：8888');cases+=4;
c.OnGetTodayLowerCount(JSON.stringify({GetTodayLowerCount:{today_lower_count:17}}));assert.equal(value('我的玩家/V8今日新增'),17);cases++;
c.onHallCommand(0x200,JSON.stringify({header:'异步_查询_红利_信息',result:[386,528,419]}));assert.equal(value('统计/V8今日红利'),386);cases++;
for(const [role,level,prop,leader,total] of [['玩家','1','False',false,false],['盟主','99','False',true,true],['代理','98','True',false,true]]){Object.assign(account,{role,level,client_prop:prop});c.set_role();c.set_client_prop();assert.equal(node('操作').width,leader&&total?640:!leader&&!total?422:640);assert.equal(node('操作/我的盟主').active,leader);assert.equal(node('操作/总业绩').active,total);cases++;}
const row=prefab('assets/resources/Prefabs/玩家对象.prefab');
for(const [level,isAgent] of [['1',false],['98',true]]){c.setMyPlayerItem(row,{user_id:'659348',user_name:'测试玩家',user_remark:'2,3,4',date:'2026-09-13',user_level:level,big_agentid:'0',supper_agentid:'0',big_agentid2:'0'});assert.equal(find(row,'count').getComponent(Label).string,'9');assert.equal(find(row,'授权代理').active,!isAgent);cases++;}
row.getChildByName('授权代理').active=true;c.onButtonClick({node:row.getChildByName('授权代理')});assert(node('添加代理面板').active);assert.match(value('添加代理面板/bk/msg'),/测试玩家/);assert.equal(value('添加代理面板/bk/id'),'659348');cases++;
commands.length=0;click('添加代理面板/bk/关闭上上层');assert.equal(commands.length,0);assert(!node('添加代理面板').active);cases++;
const leaderRow=prefab('assets/resources/Prefabs/盟主对象.prefab');c.setMengzhuItem(leaderRow,{user_id:'123123',user_name:'测试盟主',all_lower_count:8,big_agentid:'123123',big_percent:12});assert.equal(leaderRow.getChildByName('设置盟主').active,true);c.onButtonClick({node:leaderRow.getChildByName('设置盟主')});assert.equal(node('修改盟主面板/bk/比例').getComponent(EditBox).string,'12');cases++;
Object.assign(account,{role:'盟主',big_percent:20});commands.length=0;node('修改盟主面板/bk/比例').getComponent(EditBox).string='10';click('修改盟主面板/bk/确认修改盟主');assert.equal(commands.length,0);assert.match(panels.at(-1)[2],/12到20/);cases++;
node('修改盟主面板/bk/比例').getComponent(EditBox).string='18';click('修改盟主面板/bk/确认修改盟主');assert.equal(JSON.parse(commands.at(-1)[1]).big_agentid_percent,'123123,18');cases++;
commands.length=0;node('总业绩/标题/用户ID').getComponent(EditBox).string='12';click('总业绩/标题/授权总业绩');assert.equal(commands.length,0);cases++;
node('总业绩/标题/用户ID').getComponent(EditBox).string='123456';click('总业绩/标题/授权总业绩');assert.equal(JSON.parse(commands.at(-1)[1]).client_prop,'True');assert.equal(node('总业绩/标题/用户ID').getComponent(EditBox).string,'');cases++;
for(const amount of [0,86]){account.fenhong=amount;node('提取分红面板').active=false;commands.length=0;click('总业绩2/bk/我的分红');assert.equal(node('提取分红面板').active,amount>0);assert.equal(commands.length,0);cases++;}
// Real main/agent cross-page behavior is covered by promotion_shared_regression.js.
c.node.parent={getChildByName:()=>({getComponent:()=>({OpenPromotionPanel:origin=>{assert.equal(origin,c.node);return true;}})})};
click('操作/推广');assert.equal(node('推广二维码').active,false);cases++;
const P=load('assets/scripts/Common/PageEx.ts'),pager=Object.create(P.prototype),pn=node('我的玩家/分页'),requested=[];
const scroll={callBackFresh:p=>requested.push(p),nCurPage:0,nTotlePage:3};pn.parent.getComponentInChildren=()=>scroll;pager.node=pn;pager.onLoad();
pn.getChildByName('上一页').events.click();assert.deepEqual(requested,[]);pn.getChildByName('下一页').events.click();assert.deepEqual(requested,[1]);cases+=2;
scroll.nCurPage=2;pn.getChildByName('下一页').events.click();assert.deepEqual(requested,[1]);pn.getChildByName('首页').events.click();assert.deepEqual(requested,[1,0]);cases+=2;
console.log('PASS',cases,'agent data, permissions, authorization/ratio validation, share confirmation, shared promotion route and real pagination cases; all external effects mocked.');

const sample={user_id:'123456',user_name:'玩家',user_remark:'2,3,4',date:'2026-09-21',user_level:'1'};
for(const value of [undefined,null,'',0,'0','  ',false,-1,'null','abc',1.5,{},[]]){c.setMyPlayerItem(row,{...sample,room_id:value});assert.equal(find(row,'观战').active,false);assert.equal(find(row,'观战').events.click,undefined);}
for(const value of [123456,' 654321 ']){c.setMyPlayerItem(row,{...sample,room_id:value});assert.equal(find(row,'观战').active,true);find(row,'观战').events.click();assert.deepEqual(commands.at(-1),['room',7,Number(value),'{{"special_rule": "观战"}}']);}
gpsOpen=false;commands.length=0;find(row,'观战').events.click();assert.equal(commands.length,0);assert.match(panels.at(-1)[2],/GPS/);
assert.equal(avatarBindings.at(-1)[0],'123456');
const IM=load('assets/scripts/logic/ImageManager.ts');const im=Object.create(IM.prototype);im.mapID2ImageSave=new Map();const img={},calls=[];im.GetImageByName=()=>false;im.AddWaitFreshImage2Catch=(id,sp)=>{calls.push(id);im.mapID2ImageSave.set(id,[sp]);};
im.BindPlayerListAvatar('A',img);im.BindPlayerListAvatar('B',img);assert.equal(im.mapID2ImageSave.get('A').length,0);assert.equal(im.mapID2ImageSave.get('B')[0],img);
console.log('PASS room visibility, reused-row room binding, GPS guard, avatar stale-response removal');
// Matching identity layout in performance and leader rows; values remain server-owned.
const performanceRow=prefab('assets/resources/Prefabs/贡献对象.prefab');
c.setYejiItem(performanceRow,{player_guuid:'556677',player_wxname:'业绩玩家',upper_today_income:'123.45',upper_total_income:'6789.01'});
assert.equal(find(performanceRow,'id').getComponent(Label).string,'556677');
assert.equal(find(performanceRow,'today').getComponent(Label).string,'123.45');
assert.equal(find(performanceRow,'all').getComponent(Label).string,'6789.01');
assert.equal(avatarBindings.at(-1)[0],'556677');
c.setMengzhuItem(leaderRow,{user_id:'123123',user_name:'盟主',all_lower_count:8,big_agentid:'123123',big_percent:12});
assert.equal(find(leaderRow,'比例').getComponent(Label).string,'12%');
assert.equal(find(leaderRow,'设置盟主').active,true);assert.equal(find(leaderRow,'授权盟主').active,false);
c.setMengzhuItem(leaderRow,{user_id:'987654',user_name:'普通玩家',all_lower_count:3,big_agentid:'123123'});
assert.equal(find(leaderRow,'比例').getComponent(Label).string,'');
assert.equal(find(leaderRow,'设置盟主').active,false);assert.equal(find(leaderRow,'授权盟主').active,true);
assert.equal(avatarBindings.at(-1)[0],'987654');
console.log('PASS performance server values, two avatar bindings, leader permission states and reused-row ratio reset');
