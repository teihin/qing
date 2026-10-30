import GameDataManager from "../GameDataManager";
import {ClubManagementApi,ClubListKind,ClubAction,ClubPeoplePage} from "./ClubManagementView";
const KBEngine = require("kbengine");
interface Pending {
    account:string; club:string; kind:string; page:number; user:string;
    resolve:(value:any)=>void; reject:(error:Error)=>void; timer:any;
}

/**
 * Member-list versions in the wild do not agree on where optional statistics
 * live.  Keep the adapter permissive, but only display a value when the
 * server actually sent one; the UI must not invent competitor-style data.
 */
function sources(row:any):any[] {
    const result:any[]=[row];
    if(!row || typeof row !== "object")return result;
    ["stats","statistics","member_stats","club_stats","data","user_info","player"].forEach(name=>{
        const value=row[name];
        if(value && typeof value === "object" && !Array.isArray(value))result.push(value);
    });
    return result;
}
function field(row:any,names:string[]):any {
    for(const source of sources(row)) {
        for(const name of names) {
            if(!Object.prototype.hasOwnProperty.call(source,name))continue;
            const value=source[name];
            if(value !== undefined && value !== null && String(value).trim() !== "")return value;
        }
    }
    return undefined;
}
function optionalText(row:any,names:string[]):string|undefined {
    const value=field(row,names);
    return value === undefined ? undefined : String(value);
}
function displayNumber(value:any):string|undefined {
    if(value === undefined || value === null || String(value).trim() === "")return undefined;
    const number=Number(value);
    if(!Number.isFinite(number))return String(value);
    return number.toFixed(2).replace(/\.?0+$/,"");
}
function optionalFen(row:any,names:string[]):string|undefined {
    const value=field(row,names);
    if(value === undefined)return undefined;
    const number=Number(value);
    return Number.isFinite(number) ? displayNumber(number / 100) : String(value);
}
function optionalFlag(row:any,names:string[]):boolean|undefined {
    const value=field(row,names);
    if(value === undefined)return undefined;
    if(typeof value === "boolean")return value;
    if(typeof value === "number")return value !== 0;
    const normalized=String(value).trim().toLowerCase();
    if(["1","true","yes","on","是"].indexOf(normalized)>=0)return true;
    if(["0","false","no","off","否"].indexOf(normalized)>=0)return false;
    return undefined;
}
function optionalOnline(row:any):boolean|undefined {
    const value=field(row,["status","online","is_online","online_status","onlineState"]);
    if(value === undefined)return undefined;
    if(typeof value === "boolean")return value;
    if(typeof value === "number")return value !== 0;
    const normalized=String(value).trim().toLowerCase();
    if(["1","true","online","在线","on","yes"].indexOf(normalized)>=0)return true;
    if(["0","false","offline","离线","off","no"].indexOf(normalized)>=0)return false;
    return undefined;
}

/** Hall command results and list pushes are correlated separately. */
export default class HallClubManagementApi implements ClubManagementApi {
    private pending:{[context:string]:Pending} = {};
    // JoinerList has no context/club_id. Foreground lists and badge probes share one lane.
    private applicationActive:string = "";
    private applicationQueue:Array<{club:string;kind:string;header:string;extra:any;account:string;resolve:(v:any)=>void;reject:(e:Error)=>void}> = [];
    private applicationHoldTimer:any = null;
    private serial:number = 0;
    private prefix = "clubmg:" + Date.now() + ":";
    private disposed = false;
    constructor(private badge:(club:string,count:number)=>void,
        private isAgent:(club:string)=>boolean = ()=>false,
        private agentClubs:()=>string[] = ()=>[]) {
        KBEngine.Event.register("onHallCommand",this,"OnCommand");
        KBEngine.Event.register("NumberList",this,"OnMembers");
        // Legacy application route; decoder rejects unknown shapes instead of treating them as empty.
        KBEngine.Event.register("JoinerList",this,"OnApplications");
        // 代理视角的待审申请（查询_俱乐部_代理_申请）。报文同样不带 context/club_id，只能走串行车道配对。
        KBEngine.Event.register("ClubAgentReqInfo",this,"OnAgentApplications");
        KBEngine.Event.register("ClubReqInfo",this,"OnBadge");
    }
    public Dispose():void {
        this.disposed = true;
        KBEngine.Event.deregisterAll(this);
        this.clearApplicationHold();
        this.applicationQueue.splice(0).forEach(job=>job.reject(new Error("页面已关闭")));
        Object.keys(this.pending).forEach(key=>this.finish(key,new Error("页面已关闭")));
    }
    private account():string { const a=GameDataManager.getAccount();return a ? String(a.guuid || "") : ""; }
    private request(club:string,kind:string,header:string,extra:any = {}):Promise<any> {
        if(this.disposed) return Promise.reject(new Error("页面已关闭"));
        if(kind === "applications" || kind === "badges") {
            // 超时墓碑只用于排空可能迟到的推送；新请求排队，由释放定时器继续发送，
            // 不能直接报错，否则一次丢包就会让申请列表永久打不开。
            return new Promise((resolve,reject)=>{
                this.applicationQueue.push({club,kind,header,extra,account:this.account(),resolve,reject});
                this.pumpApplications();
            });
        }
        return this.sendRequest(club,kind,header,extra);
    }
    private pumpApplications():void {
        if(this.disposed)return;
        if(this.applicationActive) {
            if(!this.pending[this.applicationActive])this.scheduleApplicationRelease();
            return;
        }
        const job=this.applicationQueue.shift();if(!job)return;
        if(job.account !== this.account()) {job.reject(new Error("账号已切换"));this.pumpApplications();return;}
        this.sendRequest(job.club,job.kind,job.header,job.extra).then(job.resolve,job.reject);
    }
    /** 超时后服务端不一定还会补推，给迟到推送留一个短窗口后强制释放车道。 */
    private scheduleApplicationRelease():void {
        if(this.applicationHoldTimer != null)return;
        this.applicationHoldTimer = setTimeout(()=>{
            this.applicationHoldTimer = null;
            if(this.disposed || !this.applicationActive || this.pending[this.applicationActive])return;
            this.applicationActive = "";
            this.pumpApplications();
        },2000);
    }
    private clearApplicationHold():void {
        if(this.applicationHoldTimer != null) {clearTimeout(this.applicationHoldTimer);this.applicationHoldTimer = null;}
    }
    private sendRequest(club:string,kind:string,header:string,extra:any):Promise<any> {
        const context = this.prefix + (++this.serial);
        if(kind === "applications" || kind === "badges") this.applicationActive=context;
        return new Promise((resolve,reject)=>{
            // 后台红点轮询失败不该长时间占住用户正在看的申请列表。
            const timeout = kind === "badges" ? 6000 : 12000;
            const timer = setTimeout(()=>this.finish(context,new Error("请求超时，请刷新后确认结果"),null,true),timeout);
            this.pending[context]={account:this.account(),club,kind,page:Number(extra.page || 0),user:String(extra.user_id || ""),resolve,reject,timer};
            try {
                GameDataManager.getAccount().reqHallCommand(JSON.stringify({...extra,header,club_id:club,context}),"p@"+context);
            } catch(error) { this.finish(context,new Error("请求发送失败")); }
        });
    }
    private finish(key:string,error:Error = null,value:any = null,timedOut:boolean = false):void {
        const p=this.pending[key];if(!p)return;
        delete this.pending[key];clearTimeout(p.timer);
        if(p.account !== this.account()) error=new Error("账号已切换");
        if(error)p.reject(error);else p.resolve(value);
        if(key === this.applicationActive) {
            if(timedOut) {
                // Keep a tombstone until the untagged late push is drained. Never give it to a new club.
                this.applicationQueue.splice(0).forEach(job=>job.reject(new Error("入会查询超时，请稍后重试")));
                this.scheduleApplicationRelease();
            } else {
                this.clearApplicationHold();
                this.applicationActive="";
                this.pumpApplications();
            }
        }
    }
    private parse(raw:any):any { try{return typeof raw === "string" ? JSON.parse(raw) : raw;}catch(e){return null;} }
    private context(data:any):string {return String(data && data.context || "").replace(/^[pP]@/,"");}
    public list(club:string,kind:ClubListKind,page:number,count:number,search:string = "",agentId:string = ""):Promise<ClubPeoplePage> {
        if(kind === "members") {
            // 2026-10-26 起服务端只返回被查节点的直属成员；agent_id 用于下钻指定下级代理。
            const extra:any={page,count,user_id:"ALL"};
            if(agentId && agentId.trim())extra.agent_id=agentId.trim();
            if(search && search.trim())extra.search_name_id=search.trim();
            return this.request(club,kind,"查询_俱乐部_成员",extra);
        }
        // 文档中的新命令同时支持代理、创建者和管理员；统一走该命令，
        // 避免代理信息异步返回前误判身份而回退到旧的全量申请命令。
        return this.request(club,kind,"查询_俱乐部_代理_申请",{page,count});
    }
    public async act(club:string,action:ClubAction,user:string,value?:string):Promise<{message?:string}> {
        const commands={
            leave:"申请_退出_俱乐部",dissolve:"删除_俱乐部",approve:"添加_俱乐部_玩家",
            reject:"删除_俱乐部_加入申请",remove:"删除_俱乐部_玩家",promote:"添加_俱乐部_管理员",
            adjustScore:"修改_俱乐部_成员_积分",setAgent:"设置_俱乐部_代理",
            changeAgentRatio:"修改_俱乐部_代理_比例",cancelAgent:"取消_俱乐部_代理",
            setNote:"设置_俱乐部_成员_备注"
        };
        const extra:any = user ? {user_id:user} : {};
        if(action === "adjustScore") extra.user_modify_gold = Number(value);
        if(action === "setAgent" || action === "changeAgentRatio") extra.percent = Number(value);
        // 备注空串 = 清空；服务端上限 30 字、超出直接报错。
        if(action === "setNote") extra.note = value === undefined || value === null ? "" : String(value);
        const outcome = await this.request(club,action,commands[action],extra);
        if(action === "promote") return {message:outcome.accepted ? "设置管理员请求已受理，请刷新确认" : "已设为管理员"};
        if(action === "remove") return {message:"已删除俱乐部成员"};
        if(action === "adjustScore") return {message:outcome.accepted ? "积分调整请求已受理，请刷新确认" : "积分已调整"};
        if(action === "setAgent") return {message:"已开通代理，请刷新确认比例"};
        if(action === "changeAgentRatio") return {message:"代理比例已调整"};
        if(action === "cancelAgent") return {message:"已取消代理"};
        if(action === "setNote") return {message:extra.note ? "备注已更新" : "备注已清空"};
        if(action === "approve") {
            // 审批的最终 0x200 已表示入会完成。成员列表是独立推送，不能用它阻塞
            // 审批弹窗；否则 NumberList 缺失时会把已成功的操作误报成超时。
            this.RefreshBadges();
            return {message:"已同意加入俱乐部"};
        }
        this.RefreshBadges();
        return {message:action === "leave" ? "退出申请已提交，请等待审核" : action === "dissolve" ? "俱乐部已解散" : "已拒绝入会申请"};
    }
    public RefreshBadges():void {
        const a=GameDataManager.getAccount();
        if(!a || this.disposed)return;
        const managedIds=(String(a.club_make||"")+","+String(a.club_manage||"")).split(",").map(x=>x.trim());
        const agentIds=this.agentClubs();
        if(!managedIds.some(id=>/^\d{6}$/.test(id)) && agentIds.length===0)return;
        // Use per-club list counts; untagged ClubAgentReqInfo pushes cannot carry an aggregate.
        // 查询_俱乐部_代理_申请 对创建者/管理员返回全部待审、对代理返回自己名下的申请，
        // 一条命令覆盖两种身份，不再走老的 查询_俱乐部_加入申请（JoinerList）。
        const ids=managedIds.concat(agentIds).filter((x,i,all)=>/^\d{6}$/.test(x)&&all.indexOf(x)===i);
        for(const club of ids) {
            if(Object.keys(this.pending).some(k=>this.pending[k].club===club && ["badges","applications"].indexOf(this.pending[k].kind)>=0) ||
                this.applicationQueue.some(job=>job.club===club))continue;
            this.request(club,"badges","查询_俱乐部_代理_申请",{page:0,count:1})
                .then(result=>{if(!this.disposed)this.badge(club,result.total);}).catch(()=>{});
        }
    }
    public OnCommand(code:number,raw:string):void {
        const data=this.parse(raw);if(!data)return;
        const key=this.context(data),p=this.pending[key];if(!p)return;
        const error=data.error || (data.result && data.result.error);
        if(error || (code !== 0x200 && code !== 0x500)) {
            this.finish(key,new Error(String(error || "俱乐部操作失败")));return;
        }
        if(["members","applications","verify","badges"].indexOf(p.kind)>=0)return;
        // 0x500 只对列表请求保留兼容；操作命令按当前协议只接受最终 0x200。
        if(code !== 0x200) {
            this.finish(key,new Error("请求已受理，操作结果尚未确认，请刷新后确认"));return;
        }
        this.finish(key,null,{accepted:false});
    }
    public OnMembers(raw:string):void {this.receive(raw,"members","NumberList");}
    public OnApplications(raw:string):void {this.receive(raw,"applications","JoinerList");}
    /** ClubAgentReqInfo: {number,count,result:[ClubAgentReq...]}，无 context/club_id，靠串行车道配对。 */
    public OnAgentApplications(raw:string):void {
        const data=this.parse(raw);
        if(!data)return;
        if(!Array.isArray(data.result) && Array.isArray(data.ClubAgentReqInfo))data.result=data.ClubAgentReqInfo;
        // 服务端在 count=1 时可能把单条申请包成对象（与 ClubAgentInfo 一致），不能当成空列表丢掉。
        if(data.result && !Array.isArray(data.result) && typeof data.result === "object") {
            const inner=data.result;
            if(Array.isArray(inner.result)) {
                data.result=inner.result;
                if(data.number == null)data.number=inner.number;
                if(data.count == null)data.count=inner.count;
            } else data.result=[inner];
        }
        this.receive(data,"applications","result");
    }
    private receive(raw:any,kind:string,route:string):void {
        const data=this.parse(raw);if(!data)return;
        const body=data.result && !Array.isArray(data.result) ? this.parse(data.result) : data;
        // 服务端的列表推送可能裹在 result / 路由名 / JSON 字符串里，也可能单条时是对象。
        // 先找数组；找不到再把单条记录包成数组，避免整条推送被当成空列表丢掉。
        const pickRows=():any[]|null=>{
            const candidates:any[]=[Array.isArray(data)?data:null,Array.isArray(body)?body:null,
                data && data[route],body && body[route],data && data.result,body && body.result];
            for(const value of candidates) if(Array.isArray(value))return value;
            for(const value of candidates) if(value && typeof value === "object") {
                if(Array.isArray(value.result))return value.result;
                if(Array.isArray(value[route]))return value[route];
                return [value];
            }
            return null;
        };
        const rows=pickRows();
        const first=rows && rows.length ? rows[0] : null;
        let key=this.context(data) || this.context(body) || this.context(first);
        const club=String(data.club_id || (body && body.club_id) || (first && first.club_id) || "");
        const number=data.number != null ? data.number : body && body.number != null ? body.number : first && first.number;
        if(kind === "applications" && !key && !club && Array.isArray(rows)) {
            key=this.applicationActive;
            if(key && !this.pending[key]) {
                this.clearApplicationHold();
                this.applicationActive="";
                this.pumpApplications();
                return;
            }
        }
        if(!key && club) {
            const candidates=Object.keys(this.pending).filter(k=>{
                const p=this.pending[k];return p.club===club && (p.kind===kind || kind==="members" && p.kind==="verify" || kind==="applications" && p.kind==="badges") &&
                    number != null && p.page===Number(number);
            });
            if(candidates.length===1)key=candidates[0];
        }
        const p=this.pending[key];
        if(!p || (p.kind!==kind && !(kind==="members" && p.kind==="verify") && !(kind==="applications" && p.kind==="badges")))return;
        if(club && club!==p.club || number != null && Number(number)!==p.page)return;
        if(!Array.isArray(rows)){this.finish(key,new Error("列表回包格式不匹配，请联系管理员"));return;}
        const items=[];
        for(const row of rows) {
            if(!row || typeof row !== "object" || Array.isArray(row)) {
                this.finish(key,new Error("成员数据格式不匹配"));return;
            }
            const id=String(row.user_id || row.guuid || "");
            if(!id){this.finish(key,new Error("列表缺少玩家ID，请确认服务器回包"));return;}
            const gold = row.gold;
            const balance = gold !== null && gold !== undefined && String(gold).trim() !== "" && Number.isFinite(Number(gold)) ? Number(gold).toFixed(2) : undefined;
            const roleValue = optionalText(row,["role","club_role"]);
            const role = roleValue || undefined;
            items.push({
                id,
                name:String(row.name || row.user_name || row.nickname || "玩家 "+id),
                balance,
                role,
                clubGold:displayNumber(field(row,["club_gold"])),
                isAgent:optionalFlag(row,["is_agent"]),
                isLeader:optionalFlag(row,["is_leader"]),
                agentPercent:displayNumber(field(row,["percent","agent_percent"])),
                // note 为 2026-10-30 新增的成员备注，服务端恒下发（无值为空串）。
                note:optionalText(row,["note"]),
                status:optionalText(row,["status"]),
                teamCount:optionalText(row,["team_count"]),
                // club_gold is the current club balance; it is not a score delta.
                points:displayNumber(field(row,["club_gold"])),
                online:optionalOnline(row),
                todayWin:optionalText(row,["today_score"]),
                yesterdayWin:optionalText(row,["yesterday_score"]),
                totalWin:optionalText(row,["total_score"]),
                todayContribution:optionalFen(row,["today_contrib_fen"]),
                yesterdayContribution:optionalFen(row,["yesterday_contrib_fen"]),
                totalContribution:optionalFen(row,["total_contrib_fen"])
            });
        }
        const total=data.count != null ? data.count : body && body.count != null ? body.count : first && first.count;
        if(total == null && items.length){this.finish(key,new Error("列表缺少分页总数，请确认服务器回包"));return;}
        if(total != null && (!Number.isFinite(Number(total)) || Number(total)<items.length)) {
            this.finish(key,new Error("列表总数格式不匹配"));return;
        }
        this.finish(key,null,{items,total:Number(total)||0});
    }
    public OnBadge(raw:string):void {
        const data=this.parse(raw);if(!data)return;
        // 推送既可能是裸对象 {club_id,req_count,...}，也可能包在 ClubReqInfo / result 里。
        const asRows=(value:any):any[]=>Array.isArray(value) ? value :
            value && typeof value === "object" ? [value] : [];
        let rows=Array.isArray(data) ? data : [];
        if(rows.length === 0) rows=asRows(data.ClubReqInfo);
        if(rows.length === 0 && data.result) rows=asRows(this.parse(data.result));
        if(rows.length === 0) rows=[data];
        const a=GameDataManager.getAccount();if(!a)return;
        const listOf=(value:any)=>String(value == null ? "" : value).split(",").map(id=>id.trim()).filter(id=>id !== "");
        const managed=listOf(a.club_make).concat(listOf(a.club_manage));
        const joined=listOf(a.club_join).concat(listOf(a.club_join2));
        for(const row of rows) {
            const id=String(row.club_id || "");
            if(!id)continue;
            // 代理不在 club_make/club_manage 里，只认这两个列表会把服务端的
            // ClubReqInfo 推送整条丢掉，表现就是「推送来了没红点，要等自己轮询才亮」。
            // 所以成员关系（club_join/club_join2）和代理身份也一并算「自己的俱乐部」。
            const mine=managed.indexOf(id) >= 0 || joined.indexOf(id) >= 0 || this.isAgent(id);
            if(mine && row.req_count != null)this.badge(id,Number(row.req_count));
        }
    }
}
