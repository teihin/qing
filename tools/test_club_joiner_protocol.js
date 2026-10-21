// Run from project root; optional first argument is the TypeScript module path.
const fs=require('fs'),vm=require('vm'),assert=require('assert');const ts=require(process.argv[2] || 'typescript');
let sent=[],badges=[],a={guuid:'99',club_make:'123456',reqHallCommand:(s)=>sent.push(JSON.parse(s))};
let timerId=0;const timers=new Map();
const exp={exports:{},require:n=>n==='kbengine'?{Event:{register(){},deregisterAll(){}}}:{default:{getAccount:()=>a}},setTimeout:f=>{timers.set(++timerId,f);return timerId},clearTimeout:id=>timers.delete(id),console};
const code=ts.transpileModule(fs.readFileSync('assets/scripts/UI/ClubManagementApi.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});assert.equal(code.diagnostics.length,0);vm.runInNewContext(code.outputText,exp);const api=new exp.exports.default((id,count)=>badges.push([id,count]));
const tick=()=>new Promise(r=>setImmediate(r));

(async()=>{
 const fixture={JoinerList:[{number:'0',count:'1',guuid:'718968',name:'abc',gold:'726',date:'2026-09-29 22:59:32',room_id:'',remark:''}]};
 const p=api.list('820084','applications',0,20);const q=api.list('123456','applications',0,20);
 assert.equal(sent.length,1);assert(!('user_id' in sent[0]));
 api.OnCommand(0x200,JSON.stringify({context:sent[0].context,result:{}}));assert.equal(sent.length,1);
 api.OnApplications(JSON.stringify(fixture));const result=await p;
 assert.equal(result.total,1);assert.equal(result.items[0].id,'718968');assert.equal(result.items[0].name,'abc');assert.equal(result.items[0].balance,'726.00');
 assert.equal(sent.length,2);assert.equal(sent[1].club_id,'123456');
 api.OnApplications(JSON.stringify({JoinerList:[]}));assert.equal((await q).total,0);
 api.RefreshBadges();const badgeRequest=sent[sent.length-1];assert.equal(badgeRequest.count,1);
 const list=api.list('820084','applications',0,20);assert.equal(sent[sent.length-1],badgeRequest);
 api.OnCommand(0x200,JSON.stringify({context:badgeRequest.context,result:{}}));assert.equal(sent[sent.length-1],badgeRequest);
 api.OnApplications(JSON.stringify(fixture));await tick();assert.deepEqual(badges,[['123456',1]]);
 api.OnApplications(JSON.stringify({JoinerList:[]}));await list;
 const late=api.list('820084','applications',0,20);const rejected=assert.rejects(late,/超时/);const request=sent[sent.length-1];timers.get(api.pending[request.context].timer)();await rejected;
 await assert.rejects(api.list('123456','applications',0,20),/尚未返回/);
 api.OnApplications(JSON.stringify(fixture));const next=api.list('123456','applications',0,20);api.OnApplications(JSON.stringify({JoinerList:[]}));assert.equal((await next).total,0);
 api.Dispose();console.log('PASS exact user payload, acceptance, empty list, cross-club FIFO, badge isolation, timeout tombstone and late reply drain');
})().catch(e=>{api.Dispose();console.error(e);process.exitCode=1});
