// Run from project root; optional first argument is the TypeScript module path.
const fs=require('fs'),vm=require('vm'),assert=require('assert');const ts=require(process.argv[2] || 'typescript');
let sent=[],badges=[],a={guuid:'99',club_make:'123456',reqHallCommand:(s)=>sent.push(JSON.parse(s))};
let timerId=0;const timers=new Map();
const exp={exports:{},require:n=>n==='kbengine'?{Event:{register(){},deregisterAll(){}}}:{default:{getAccount:()=>a}},setTimeout:f=>{timers.set(++timerId,f);return timerId},clearTimeout:id=>timers.delete(id),console};
const code=ts.transpileModule(fs.readFileSync('assets/scripts/UI/ClubManagementApi.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});assert.equal(code.diagnostics.length,0);vm.runInNewContext(code.outputText,exp);const api=new exp.exports.default((id,count)=>badges.push([id,count]));
const tick=()=>new Promise(r=>setImmediate(r));

(async()=>{
 const fixture={JoinerList:[{number:'0',count:'1',guuid:'718968',name:'abc',gold:'726',date:'2026-09-29 22:59:32',room_id:'',remark:''}]};
 const agentFixture={number:'0',count:'1',result:fixture.JoinerList};
 const p=api.list('820084','applications',0,20);const q=api.list('123456','applications',0,20);
 assert.equal(sent.length,1);assert.equal(sent[0].header,'查询_俱乐部_代理_申请');assert(!('user_id' in sent[0]));
 api.OnCommand(0x200,JSON.stringify({context:sent[0].context,result:{}}));assert.equal(sent.length,1);
 api.OnAgentApplications(JSON.stringify(agentFixture));const result=await p;
 assert.equal(result.total,1);assert.equal(result.items[0].id,'718968');assert.equal(result.items[0].name,'abc');assert.equal(result.items[0].balance,'726.00');
 assert.equal(sent.length,2);assert.equal(sent[1].club_id,'123456');
 assert.equal(sent[1].header,'查询_俱乐部_代理_申请');
 api.OnAgentApplications(JSON.stringify({number:'0',count:'0',result:[]}));assert.equal((await q).total,0);
 const approval=api.act('820084','approve','718968');
 const approvalRequest=sent[sent.length-1];
 assert.equal(approvalRequest.header,'添加_俱乐部_玩家');
 api.OnCommand(0x200,JSON.stringify({context:approvalRequest.context,result:{}}));
 assert.equal((await approval).message,'已同意加入俱乐部');
 assert.equal(sent.filter(request=>request.header==='查询_俱乐部_成员').length,0);
 api.RefreshBadges();const badgeRequest=sent[sent.length-1];assert.equal(badgeRequest.count,1);assert.equal(badgeRequest.header,'查询_俱乐部_代理_申请');
 const list=api.list('820084','applications',0,20);assert.equal(sent[sent.length-1],badgeRequest);
 api.OnCommand(0x200,JSON.stringify({context:badgeRequest.context,result:{}}));assert.equal(sent[sent.length-1],badgeRequest);
 api.OnAgentApplications(JSON.stringify(agentFixture));await tick();assert.deepEqual(badges,[['123456',1]]);
 api.OnAgentApplications(JSON.stringify({number:'0',count:'0',result:[]}));await list;
 // 1) 超时后迟到推送仍可排空墓碑并放行排队请求
 const late=api.list('820084','applications',0,20);const rejected=assert.rejects(late,/超时/);const request=sent[sent.length-1];timers.get(api.pending[request.context].timer)();await rejected;
 const queued=api.list('123456','applications',0,20);assert.equal(sent[sent.length-1],request);
 api.OnAgentApplications(JSON.stringify(agentFixture));
 assert.equal(sent[sent.length-1].club_id,'123456');
 api.OnAgentApplications(JSON.stringify({number:'0',count:'0',result:[]}));assert.equal((await queued).total,0);
 // 2) 推送彻底不来时，排空窗口到期自动释放车道；单条对象回包也要能解析
 const lost=api.list('820084','applications',0,20);const lostRejected=assert.rejects(lost,/超时/);const lostRequest=sent[sent.length-1];timers.get(api.pending[lostRequest.context].timer)();await lostRejected;
 const next=api.list('123456','applications',0,20);assert.equal(sent[sent.length-1],lostRequest);
 const hold=[...timers.entries()][0];assert(hold);timers.delete(hold[0]);hold[1]();
 assert.equal(sent[sent.length-1].club_id,'123456');
 api.OnAgentApplications(JSON.stringify({number:'0',count:'1',result:{user_id:'718968',user_name:'abc',gold:'726'}}));
 const parsed=await next;assert.equal(parsed.total,1);assert.equal(parsed.items[0].id,'718968');
 api.Dispose();console.log('PASS exact user payload, acceptance, empty list, cross-club FIFO, badge isolation, tombstone drain, lane release and object reply');
})().catch(e=>{api.Dispose();console.error(e);process.exitCode=1});
