// Exercises production handlers, row rendering and infinite loading with no live requests.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const ts=require(process.env.TYPESCRIPT_PATH||path.join(require('os').homedir(),'.nvm/versions/node/v22.19.0/lib/node_modules/nexe/node_modules/typescript/lib/typescript.js'));
const root=path.resolve(__dirname,'../..');
class Node {
 constructor(o={}){this.name=o._name||'';this.active=o._active!==false;this.children=[];this.comps=[];this.events={};this.width=o._contentSize?.width||0;this.height=o._contentSize?.height||0;}
 get activeInHierarchy(){return this.active&&(!this.parent||this.parent.activeInHierarchy)}
 getChildByName(n){return this.children.find(c=>c.name===n)}
 getComponent(t){return this.comps.find(c=>typeof t==='string'?c.constructor.name===t:c instanceof t)||null}
 getComponentsInChildren(t){return this.comps.filter(c=>c instanceof t).concat(...this.children.map(c=>c.getComponentsInChildren(t)))}
 getComponentInChildren(t){return this.getComponentsInChildren(t)[0]||null}
 addChild(n){this.children.push(n);n.parent=this}
 on(e,fn,target){(this.events[e]||=[]).push(target?fn.bind(target):fn)}
 emit(e,arg){(this.events[e]||[]).forEach(f=>f(arg))}
}
class Component{onLoad(){}onButtonClick(){}scheduleOnce(fn){fn.call(this)}}
class Label extends Component{constructor(){super();this.string=''}}
class Button extends Component{}
class Toggle extends Button{set isChecked(v){this.checked=v;if(v&&this.node?.parent)this.node.parent.children.forEach(n=>{const t=n.getComponent(Toggle);if(t&&t!==this)t.checked=false})}get isChecked(){return this.checked}}
class Layout extends Component{updateLayout(){this.node.height=this.node.children.filter(n=>n.active).reduce((n,r)=>n+r.height,0)}}
class ScrollViewEx extends Component{constructor(){super();this.offset=0;this.topCalls=0}start(){}stopAutoScroll(){}scrollToTop(){this.offset=0;this.topCalls++}getScrollOffset(){return {y:this.offset}}getMaxScrollOffset(){return {y:Math.max(0,this.content.height-this.content.parent.height)}}}
const cc={Node,Label,Button,Toggle,Layout,Component,ScrollView:ScrollViewEx,warn(){},_decorator:{ccclass:c=>c,property:()=>()=>{}}};
Node.EventType={TOUCH_START:'touch-start',MOUSE_WHEEL:'mouse-wheel'};
const commands=[],events=[],panels=[];let account={reqHallCommand:(raw,context)=>commands.push({data:JSON.parse(raw),context})};
const find=(n,p)=>p.split('/').reduce((v,k)=>v&&v.getChildByName(k),n);
const modules={UIPanelViewBase:Component,ScrollItemBase:Component,ScrollViewEx,Tool:{GetChild:find},GameDataManager:{getAccount:()=>account},ConfigManager:{getInstance:()=>({GetOneHashKey(){}})},UIManager:{getInstance:()=>({showPanel:(...a)=>panels.push(a)})}};
function load(file){const mod={exports:{}};const result=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017,experimentalDecorators:true},reportDiagnostics:true});assert.equal(result.diagnostics.length,0,file);vm.runInNewContext(result.outputText,{cc,module:mod,exports:mod.exports,console,require(n){if(n==='kbengine')return {Event:{register:(...a)=>events.push(a)}};if(n.endsWith('GameDef'))return {ShowPanelMode:{Cover:0}};return {default:modules[n.split('/').pop()]||Component};}});return mod.exports.default}
modules.PaiHangScrollItem=load('assets/scripts/common/PaiHangScrollItem.ts');
modules.LeaderboardScrollView=load('assets/scripts/common/LeaderboardScrollView.ts');
const C=load('assets/scripts/UI/panelPaihangbang.ts');
function scriptId(name){const u=JSON.parse(fs.readFileSync(path.join(root,'assets/scripts/common',name+'.ts.meta'))).uuid.replace(/-/g,'');const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';return u.slice(0,5)+u.slice(5).match(/.../g).map(s=>chars[parseInt(s,16)>>6]+chars[parseInt(s,16)&63]).join('')}
function readPrefab(file){const a=JSON.parse(fs.readFileSync(path.join(root,file)));const ns=new Map();a.forEach((o,i)=>{if(o.__type__==='cc.Node')ns.set(i,new Node(o))});const types={'cc.Label':Label,'cc.Button':Button,'cc.Toggle':Toggle,'cc.Layout':Layout,[scriptId('LeaderboardScrollView')]:modules.LeaderboardScrollView,[scriptId('PaiHangScrollItem')]:modules.PaiHangScrollItem};for(const [i,n]of ns){const o=a[i];o._children.forEach(r=>n.addChild(ns.get(r.__id__)));for(const ref of o._components){const v=a[ref.__id__],Type=types[v.__type__];if(!Type)continue;const c=new Type();c.node=n;n.comps.push(c);if(c instanceof Label)c.string=v['_N$string']??v._string;if(c instanceof Toggle)c.checked=v['_N$isChecked'];if(c instanceof modules.LeaderboardScrollView)c.content=ns.get(v.content.__id__);}}return {node:ns.get(a[0].data.__id__),a,ns}}
function clone(n){const k=new Node({_name:n.name,_active:n.active,_contentSize:n});n.children.forEach(ch=>k.addChild(clone(ch)));n.comps.forEach(c=>{const d=new c.constructor();d.node=k;if(c instanceof Label)d.string=c.string;k.comps.push(d)});return k}cc.instantiate=clone;
let cases=0;
const boardNames=['玩家手数榜','玩家赢分榜','代理红利榜'];
const keyNames=['ListActivityPlayedcount','ListActivityUserScore','ListActivityProxyHongli'];
const listCallbacks=['OnListActivityPlayedcount','OnListActivityUserScore','ListActivityProxyHongli'];
const selfCallbacks=['OnListActivitySelfPlayedcount','OnListActivitySelfUserScore','ListActivitySelfProxyHongli'];
const selfKeys=['ListActivitySelfPlayedcount','ListActivitySelfUserScore','ListActivitySelfProxyHongli'];
const sample=(rank=1)=>({user_no:String(rank),user_name:'长昵称测试玩家',user_guuid:String(123456+rank),activity_num:'90630',user_reward:'3000'});
const rows=(start=1,n=30)=>Array.from({length:n},(_,i)=>sample(start+i));
function setup(){
 commands.length=0;
 const c=new C();c.node=readPrefab('assets/resources/Prefabs/排行榜.prefab').node;c.rowTemplate=c.node.getChildByName('排行榜对象');c.onLoad();c.onEnable();
 const node=p=>find(c.node,p),value=p=>node(p).getComponent(Label).string;
 const list=i=>node('容器/'+boardNames[i]+'/列表').getComponent(modules.LeaderboardScrollView);
 for(let i=0;i<3;i++)list(i).start();
 const reply=(i,data=rows(),extra={count:61,number:0})=>c[listCallbacks[i]](JSON.stringify({...extra,[keyNames[i]]:data,start_date:'09/01 00:00',end_date:'09/30 23:59'}));
 const self=(i,extra={})=>c[selfCallbacks[i]](JSON.stringify({[selfKeys[i]]:[{...sample(18),lingqu_on:'True',is_reward:'True',lingqu_count:'0',...extra}]}));
 const select=i=>{const t=node('条件/'+boardNames[i]).getComponent(Toggle);t.isChecked=true;c.onToggleClick(t)};
 const filter=n=>{const t=node('容器/玩家手数榜/选择手数/'+n+'皮').getComponent(Toggle);t.isChecked=true;c.onToggleClick(t)};
 const active=i=>list(i).content.children.filter(n=>n.active);
 const near=i=>{const l=list(i);l.offset=l.getMaxScrollOffset().y-300;l.node.emit('scrolling')};
 return {c,node,value,list,reply,self,select,filter,active,near};
}
function test(name,fn){fn(setup());cases++;}
for(let i=0;i<3;i++)test(boardNames[i]+' prefetch/append/exhaustion',h=>{
 if(i)h.select(i);h.reply(i);h.self(i);
 const l=h.list(i),before=commands.length,top=l.topCalls;
 assert.equal(h.active(i).length,30);l.node.emit('scrolling');assert.equal(commands.length,before);
 h.near(i);assert.equal(commands.length,before+1);assert.equal(commands.at(-1).data.page,'1');assert.equal(commands.at(-1).data.count,'30');
 const offset=l.offset;l.node.emit('scrolling');l.node.emit('scrolling');assert.equal(commands.length,before+1);
 h.reply(i,rows(31),{count:61,number:1});assert.equal(h.active(i).length,60);assert.equal(l.offset,offset);assert.equal(l.topCalls,top);
 h.near(i);assert.equal(commands.at(-1).data.page,'2');h.reply(i,rows(61,1),{count:61,number:2});
 assert.equal(h.active(i).length,61);const last=commands.length;h.near(i);l.node.emit('scrolling');assert.equal(commands.length,last);
 // Duplicate unsolicited reply cannot append again.
 h.reply(i,rows(61,1),{count:61,number:2});assert.equal(h.active(i).length,61);
 const row=h.active(i)[0];assert(row.getChildByName('V8皇冠1').active);assert(!row.getChildByName('idx').active);
 assert.equal(row.getChildByName('played_count').getComponent(Label).string,i===1?'+90,630':'90,630');
 assert(!h.node('容器/'+boardNames[i]+'/分页').active);
});
test('rapid filters serialize and reset offset',h=>{
 h.filter(2);h.filter(20);const before=commands.length;h.reply(0);assert.equal(commands.length,before+1);assert.equal(commands.at(-1).data.play_type,'20皮');assert.equal(h.active(0).length,0);
 h.self(0);h.reply(0);h.self(0,{user_no:'4'});assert.equal(h.value('广告/V8排名'),'4');
 h.near(0);h.filter(5);assert.equal(h.list(0).offset,0);assert.equal(h.active(0).length,0);
 h.reply(0,rows(31),{count:61,number:1});assert.equal(h.active(0).length,0);assert.equal(commands.at(-1).data.page,'0');assert.equal(commands.at(-1).data.play_type,'5皮');
 h.reply(0,rows(71));assert.equal(h.active(0)[0].getChildByName('idx').getComponent(Label).string,'71');
});
test('switch away and back rejects old first page and header',h=>{
 h.select(1);h.select(0);h.reply(0,rows(100));assert.equal(h.active(0).length,0);assert.equal(commands.at(-1).data.page,'0');h.reply(0);h.self(0);h.self(0,{user_no:'8'});
 h.reply(1);h.self(1,{user_no:'99'});assert.equal(h.value('广告/V8排名'),'8');
});
test('empty list stops and hides reward',h=>{
 h.reply(0,[],{count:0});h.c.OnListActivitySelfPlayedcount(JSON.stringify({ListActivitySelfPlayedcount:[]}));
 assert(h.node('容器/玩家手数榜/V8空列表').active);assert(!h.node('广告/领取奖励').active);assert.equal(h.value('广告/V8排名'),'未上榜');
 const before=commands.length;h.near(0);assert.equal(commands.length,before);
});
test('legacy row count and CS envelope',h=>{
 h.reply(0,rows().map(r=>({...r,count:31,number:0})),{});h.near(0);h.reply(0,rows(31,1),{rowsTotal:31,pageIndex:2,pageNum:2});assert.equal(h.active(0).length,31);const n=commands.length;h.near(0);assert.equal(commands.length,n);
});
test('missing totals uses full page then short page',h=>{
 h.reply(0,rows(),{});h.near(0);h.reply(0,rows(31,7),{});assert.equal(h.active(0).length,37);const n=commands.length;h.near(0);assert.equal(commands.length,n);
});
test('pageNum without total and empty tail stop',h=>{
 h.reply(0,rows(),{pageNum:3});h.near(0);h.reply(0,[],{pageNum:3});assert.equal(h.active(0).length,30);const n=commands.length;h.near(0);assert.equal(commands.length,n);assert(!h.node('容器/玩家手数榜/V8空列表').active);
});
test('short first response fills viewport once, inactive lists do not load',h=>{
 h.reply(0,rows(1,3),{count:61});assert.equal(commands.at(-1).data.page,'1');const n=commands.length;h.list(0).node.emit('scrolling');assert.equal(commands.length,n);
 h.select(1);const after=commands.length;h.list(0).node.emit('scrolling');assert.equal(commands.length,after);
});
test('overlapping users are not duplicated; repeated page ends loading',h=>{
 h.reply(0);h.near(0);h.reply(0,rows(30),{count:91});assert.equal(h.active(0).length,59);
 h.near(0);h.reply(0,rows(30),{count:91});assert.equal(h.active(0).length,59);const n=commands.length;h.near(0);assert.equal(commands.length,n);
});
test('network failure retains rows and retries same page on new gesture',h=>{
 h.reply(0);h.near(0);h.c.onHallCommand(500,'查询_活动_玩家手数');const n=commands.length;
 h.list(0).node.emit('scrolling');assert.equal(commands.length,n);assert.equal(h.active(0).length,30);
 h.list(0).node.emit('touch-start');assert.equal(commands.length,n+1);assert.equal(commands.at(-1).data.page,'1');h.reply(0,rows(31),{count:61});assert.equal(h.active(0).length,60);
});
test('malformed first response shows retry and can recover',h=>{
 h.c.OnListActivityPlayedcount('null');assert.equal(h.value('容器/玩家手数榜/V8空列表'),'加载失败，请滑动重试');assert(h.node('容器/玩家手数榜/V8空列表').active);
 h.list(0).node.emit('mouse-wheel');h.reply(0);assert.equal(h.active(0).length,30);assert(!h.node('容器/玩家手数榜/V8空列表').active);
});
test('disconnect and reopening start from first page',h=>{
 h.reply(0);h.self(0);h.near(0);h.c.onDisconnected();h.c.onRankingReconnect();assert.equal(commands.at(-1).data.page,'0');h.reply(0);h.self(0,{lingqu_count:'1'});assert(h.node('广告/已领取').active);
 h.c.onDisable();h.c.node.active=false;h.c.node.active=true;h.c.onEnable();assert.equal(h.active(0).length,0);assert(h.node('条件/玩家手数榜').getComponent(Toggle).isChecked);
});
test('selected layers, formatting and claim contract retained',h=>{
 h.filter(20);h.c.LingquShoushu();assert.equal(commands.at(-1).data.play_type,'20皮');assert.equal(commands.at(-1).context,'P@领取_活动_自己手数');
 for(const n of h.node('容器/玩家手数榜/选择手数').children.filter(n=>n.active))assert(n.children.findIndex(c=>c.name==='checkmark')>n.children.findIndex(c=>c.name==='Background'));
 assert(!h.node('容器/玩家手数榜/选择手数/50皮').active);
 const fmt=modules.PaiHangScrollItem.number;assert.equal(fmt('12345678901234567890.50'),'12,345,678,901,234,567,890.50');assert.equal(fmt('-1234'),'-1,234');assert.equal(fmt(undefined),'—');
});
console.log('PASS',cases,'leaderboard infinite-loading scenarios: prefetch, single flight, append offset, end, empty, metadata, stale filters, retry, reconnect and retained rewards. All requests mocked.');
