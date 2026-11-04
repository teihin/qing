import GameDataManager from "../GameDataManager";
import {ClubManagementApi,ClubListKind,ClubAction,ClubPeoplePage,
    ClubUnionApplication,ClubUnionApplicationPage,ClubUnionMember,ClubUnionMemberPage} from "./ClubManagementView";
const KBEngine = require("kbengine");
interface Pending {
    account:string; club:string; kind:string; header:string; page:number; user:string;
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
    /** 查询_联盟_加入申请 / 查询_我的_联盟 都是无固定 context 的列表推送，各自只允许一个在途。 */
    private unionApply:{key:string;account:string;resolve:(v:ClubUnionApplicationPage)=>void;
        reject:(e:Error)=>void;timer:any} = null;
    private unionMembersPending:{key:string;account:string;resolve:(v:ClubUnionMemberPage)=>void;
        reject:(e:Error)=>void;timer:any} = null;
    constructor(private badge:(club:string,count:number)=>void,
        private isAgent:(club:string)=>boolean = ()=>false,
        private agentClubs:()=>string[] = ()=>[],
        /** 无在途查询时收到的 ClubUnionApply / ClubMyUnion 也交给界面实时刷新。 */
        private onUnionApplyPush?:(page:ClubUnionApplicationPage)=>void,
        private onUnionMemberPush?:(page:ClubUnionMemberPage)=>void) {
        KBEngine.Event.register("onHallCommand",this,"OnCommand");
        KBEngine.Event.register("NumberList",this,"OnMembers");
        // Legacy application route; decoder rejects unknown shapes instead of treating them as empty.
        KBEngine.Event.register("JoinerList",this,"OnApplications");
        // 代理视角的待审申请（查询_俱乐部_代理_申请）。报文同样不带 context/club_id，只能走串行车道配对。
        KBEngine.Event.register("ClubAgentReqInfo",this,"OnAgentApplications");
        KBEngine.Event.register("ClubReqInfo",this,"OnBadge");
        KBEngine.Event.register("ClubUnionApply",this,"OnUnionApply");
        KBEngine.Event.register("ClubMyUnion",this,"OnUnionMembers");
    }
    public Dispose():void {
        this.disposed = true;
        KBEngine.Event.deregisterAll(this);
        this.clearApplicationHold();
        if(this.unionApply) {
            clearTimeout(this.unionApply.timer);
            this.unionApply.reject(new Error("页面已关闭"));
            this.unionApply = null;
        }
        if(this.unionMembersPending) {
            clearTimeout(this.unionMembersPending.timer);
            this.unionMembersPending.reject(new Error("页面已关闭"));
            this.unionMembersPending = null;
        }
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
            this.pending[context]={account:this.account(),club,kind,header,page:Number(extra.page || 0),user:String(extra.user_id || ""),resolve,reject,timer};
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
            setNote:"设置_俱乐部_成员_备注",grantQuota:"授信_俱乐部_额度",
            increaseQuota:"授信_俱乐部_额度",decreaseQuota:"授信_俱乐部_额度",
            setUnionPercent:"设置_联盟_盟主_比例"
        };
        const extra:any = user ? {user_id:user} : {};
        if(action === "adjustScore") extra.user_modify_gold = Number(value);
        if(action === "setAgent" || action === "changeAgentRatio") extra.percent = Number(value);
        if(action === "setUnionPercent") extra.percent = Number(value);
        if(action === "grantQuota") extra.quota_fen = Number(value);
        if(action === "increaseQuota") extra.quota_fen = Math.abs(Number(value));
        if(action === "decreaseQuota") extra.quota_fen = -Math.abs(Number(value));
        // 备注空串 = 清空；服务端上限 30 字、超出直接报错。
        if(action === "setNote") extra.note = value === undefined || value === null ? "" : String(value);
        const outcome = await this.request(club,action,commands[action],extra);
        if(action === "promote") return {message:outcome.accepted ? "设置管理员请求已受理，请刷新确认" : "已设为管理员"};
        if(action === "remove") return {message:"已删除俱乐部成员"};
        if(action === "adjustScore") return {message:outcome.accepted ? "积分调整请求已受理，请刷新确认" : "积分已调整"};
        if(action === "setAgent") return {message:"已开通代理，请刷新确认比例"};
        if(action === "changeAgentRatio") return {message:"代理比例已调整"};
        if(action === "cancelAgent") return {message:"已取消代理"};
        if(action === "grantQuota") return {message:"额度已设置"};
        if(action === "increaseQuota") return {message:"额度已增加"};
        if(action === "decreaseQuota") return {message:"额度已减少"};
        if(action === "setNote") return {message:extra.note ? "备注已更新" : "备注已清空"};
        if(action === "setUnionPercent") return {message:"盟主比例已调整为 " + Number(value) + "%"};
        if(action === "approve") {
            // 审批的最终 0x200 已表示入会完成。成员列表是独立推送，不能用它阻塞
            // 审批弹窗；否则 NumberList 缺失时会把已成功的操作误报成超时。
            this.RefreshBadges();
            return {message:"已同意加入俱乐部"};
        }
        this.RefreshBadges();
        return {message:action === "leave" ? "退出申请已提交，请等待审核" : action === "dissolve" ? "俱乐部已解散" : "已拒绝入会申请"};
    }
    /** 联盟审批：查询命令不接收 club_id，服务端按调用者是不是总群主返回自己联盟的待审俱乐部。 */
    public unionApplications():Promise<ClubUnionApplicationPage> {
        if(this.disposed) return Promise.reject(new Error("页面已关闭"));
        if(this.unionApply) return Promise.reject(new Error("正在查询入盟申请，请稍候"));
        const context = this.prefix + "u" + (++this.serial);
        return new Promise((resolve,reject)=>{
            const timer = setTimeout(()=>{
                if(!this.unionApply || this.unionApply.key !== context) return;
                this.unionApply = null;
                reject(new Error("入盟申请查询超时，请刷新重试"));
            },12000);
            this.unionApply = {key:context,account:this.account(),resolve,reject,timer};
            try {
                GameDataManager.getAccount().reqHallCommand(
                    JSON.stringify({header:"查询_联盟_加入申请",context}),"p@" + context);
            } catch(error) {
                clearTimeout(timer);
                this.unionApply = null;
                reject(new Error("请求发送失败"));
            }
        });
    }
    /** 同意/拒绝由命令名决定，不需要 agree 字段；club_id 为目标俱乐部。 */
    public unionAct(club:string,target:string,approve:boolean):Promise<{message?:string}> {
        if(this.disposed) return Promise.reject(new Error("页面已关闭"));
        const context = this.prefix + (++this.serial);
        return new Promise((resolve,reject)=>{
            const timer = setTimeout(()=>this.finish(context,new Error("审批超时，请刷新后确认结果")),12000);
            this.pending[context] = {account:this.account(),club,kind:"unionAct",
                header:approve ? "同意_加入_联盟" : "拒绝_加入_联盟",page:0,user:target,resolve,reject,timer};
            try {
                GameDataManager.getAccount().reqHallCommand(JSON.stringify({
                    header:approve ? "同意_加入_联盟" : "拒绝_加入_联盟",
                    club_id:target,context
                }),"p@" + context);
            } catch(error) { this.finish(context,new Error("请求发送失败")); }
        });
    }
    /** 授信_联盟_额度：正数从联盟池划给目标俱乐部，负数从目标俱乐部收回。 */
    public unionQuotaAdjust(target:string,quotaFen:number):Promise<{message?:string}> {
        if(this.disposed) return Promise.reject(new Error("页面已关闭"));
        const context = this.prefix + "q" + (++this.serial);
        return new Promise((resolve,reject)=>{
            const timer = setTimeout(()=>this.finish(context,new Error("额度调整超时，请刷新后确认结果")),12000);
            this.pending[context] = {account:this.account(),club:target,kind:"unionQuota",
                header:"授信_联盟_额度",page:0,user:target,resolve,reject,timer};
            try {
                GameDataManager.getAccount().reqHallCommand(JSON.stringify({
                    header:"授信_联盟_额度",club_id:target,quota_fen:quotaFen,context
                }),"p@" + context);
            } catch(error) { this.finish(context,new Error("请求发送失败")); }
        });
    }
    /** 盟友管理：查询_我的_联盟 只对总群主成功，返回联盟内全部俱乐部。 */
    public unionMembers():Promise<ClubUnionMemberPage> {
        if(this.disposed) return Promise.reject(new Error("页面已关闭"));
        if(this.unionMembersPending) return Promise.reject(new Error("正在查询盟友，请稍候"));
        const context = this.prefix + "m" + (++this.serial);
        return new Promise((resolve,reject)=>{
            const timer = setTimeout(()=>{
                if(!this.unionMembersPending || this.unionMembersPending.key !== context) return;
                this.unionMembersPending = null;
                reject(new Error("盟友查询超时，请刷新重试"));
            },12000);
            this.unionMembersPending = {key:context,account:this.account(),resolve,reject,timer};
            try {
                GameDataManager.getAccount().reqHallCommand(
                    JSON.stringify({header:"查询_我的_联盟",context}),"p@" + context);
            } catch(error) {
                clearTimeout(timer);
                this.unionMembersPending = null;
                reject(new Error("请求发送失败"));
            }
        });
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
        let key=this.context(data);
        // 查询_联盟_加入申请 的结果走 ClubUnionApply 推送；同步回包带列表时也兼容。
        if(this.unionApply && key === this.unionApply.key) {
            const error=data.error || (data.result && data.result.error);
            if(error || (code !== 0x200 && code !== 0x500)) {
                const failed=this.unionApply;
                this.unionApply=null;
                clearTimeout(failed.timer);
                failed.reject(new Error(String(error || "入盟申请查询失败")));
                return;
            }
            let body:any=data.result;
            if(typeof body === "string") body=this.parse(body);
            const hasRows=!!data.ClubUnionApply || Array.isArray(body) ||
                !!body && (Array.isArray(body.ClubUnionApply) || Array.isArray(body.result));
            if(hasRows) { this.OnUnionApply(raw); return; }
            // 正式列表走 ClubUnionApply 推送；给迟到推送留短窗口，空列表不能一直等到 12 秒超时。
            const pending=this.unionApply;
            clearTimeout(pending.timer);
            pending.timer=setTimeout(()=>{
                if(this.unionApply !== pending) return;
                this.unionApply=null;
                pending.resolve({items:[],total:0});
            },1500);
            return;
        }
        // 查询_我的_联盟 的结果走 ClubMyUnion 推送；同步回包带 members 时也兼容。
        if(this.unionMembersPending && key === this.unionMembersPending.key) {
            const error=data.error || (data.result && data.result.error);
            if(error || (code !== 0x200 && code !== 0x500)) {
                const failed=this.unionMembersPending;
                this.unionMembersPending=null;
                clearTimeout(failed.timer);
                failed.reject(new Error(String(error || "盟友查询失败")));
                return;
            }
            let body:any=data.result;
            if(typeof body === "string") body=this.parse(body);
            const hasMembers=!!data.ClubMyUnion ||
                !!body && (Array.isArray(body.members) || !!body.ClubMyUnion);
            if(hasMembers) { this.OnUnionMembers(raw); return; }
            const pending=this.unionMembersPending;
            clearTimeout(pending.timer);
            pending.timer=setTimeout(()=>{
                if(this.unionMembersPending !== pending) return;
                this.unionMembersPending=null;
                pending.resolve({items:[],total:0});
            },1500);
            return;
        }
        let p=this.pending[key];
        // 授信/额度调整成功回包可能不带 context；当前页面串行提交，
        // 因此只在唯一的额度变更请求上兜底，避免把无标签的旧回包交给其他操作。
        if(!p && !key) {
            const candidates=Object.keys(this.pending).filter(k=>
                ["grantQuota","increaseQuota","decreaseQuota","unionQuota"].indexOf(this.pending[k].kind) >= 0);
            if(candidates.length === 1) { key=candidates[0];p=this.pending[key]; }
        }
        if(!p)return;
        const error=data.error || (data.result && data.result.error);
        if(error || (code !== 0x200 && code !== 0x500)) {
            this.finish(key,new Error(String(error ||
                (p.kind === "unionAct" ? "联盟审批失败，请稍后重试" : p.kind === "unionQuota" ? "联盟额度调整失败，请稍后重试" : "俱乐部操作失败"))));return;
        }
        if(["members","applications","verify","badges"].indexOf(p.kind)>=0)return;
        // 0x500 只对列表请求保留兼容；操作命令按当前协议只接受最终 0x200。
        if(code !== 0x200) {
            this.finish(key,new Error("请求已受理，操作结果尚未确认，请刷新后确认"));return;
        }
        this.finish(key,null,{accepted:false});
    }
    /** ClubUnionApply：{ClubUnionApply:[{club_id,club_name,owner_guuid,owner_name}]}，无 context。 */
    public OnUnionApply(raw:any,secondaryRaw?:any):void {
        if(secondaryRaw !== undefined && (typeof raw === "number" || typeof raw === "boolean")) raw = secondaryRaw;
        const data=this.parse(raw);if(!data)return;
        let body:any=data.ClubUnionApply;
        if(body === undefined && data.result !== undefined) {
            const parsed=this.parse(data.result);
            body=parsed !== null ? parsed : data.result;
        }
        if(body === undefined) body=data;
        if(typeof body === "string") body=this.parse(body);
        if(body && typeof body === "object" && !Array.isArray(body)) {
            if(body.ClubUnionApply !== undefined) body=body.ClubUnionApply;
            else if(body.result !== undefined) body=body.result;
        }
        const explicitList = Array.isArray(body);
        const rows:any[] = Array.isArray(body) ? body :
            body && typeof body === "object" ? [body] : [];
        const items:ClubUnionApplication[]=[];
        for(const row of rows) {
            if(!row || typeof row !== "object" || Array.isArray(row)) continue;
            const clubId=String(row.club_id || row.clubId || "").trim();
            if(!clubId) continue;
            items.push({
                clubId,
                clubName:String(row.club_name || row.clubName || row.name || ("俱乐部 " + clubId)),
                ownerId:String(row.owner_guuid || row.owner_id || row.ownerId || ""),
                ownerName:String(row.owner_name || row.ownerName || "")
            });
        }
        const page={items,total:items.length};
        const pending=this.unionApply;
        if(pending) {
            this.unionApply=null;
            clearTimeout(pending.timer);
            if(pending.account !== this.account()) pending.reject(new Error("账号已切换"));
            else pending.resolve(page);
            return;
        }
        // 文档：有客户端就推送。没有在途查询时也要驱动界面实时刷新；
        // 但不是列表结构的包裹（例如只带 union_id 的通知）不能当成「0 条申请」清空列表。
        if(!this.disposed && this.onUnionApplyPush && (explicitList || items.length > 0))
            this.onUnionApplyPush(page);
    }
    /** ClubMyUnion：{union_id,union_name,members:[{club_id,club_name,owner_guuid,owner_name,union_quota,union_percent?}]}。 */
    public OnUnionMembers(raw:any,secondaryRaw?:any):void {
        if(secondaryRaw !== undefined && (typeof raw === "number" || typeof raw === "boolean")) raw = secondaryRaw;
        const data=this.parse(raw);if(!data)return;
        let body:any=data.ClubMyUnion;
        if(body === undefined && data.result !== undefined) {
            const parsed=this.parse(data.result);
            body=parsed !== null ? parsed : data.result;
        }
        if(body === undefined) body=data;
        if(typeof body === "string") body=this.parse(body);
        if(body && typeof body === "object" && !Array.isArray(body)) {
            if(body.ClubMyUnion !== undefined) body=body.ClubMyUnion;
            else if(body.result !== undefined && typeof body.result === "object") body=body.result;
        }
        // 只有带 members 的报文才是盟友列表；只带 union_name / union_quota 的名称推送不能清空列表。
        const explicitMembers = Array.isArray(body) ||
            !!(body && !Array.isArray(body) && (Array.isArray(body.members) ||
                (body.members && typeof body.members === "object")));
        const rows:any[] = Array.isArray(body) ? body :
            body && Array.isArray(body.members) ? body.members :
            body && body.members && typeof body.members === "object" ? [body.members] : [];
        const poolRaw = body && !Array.isArray(body) ?
            (body.union_quota !== undefined ? body.union_quota : body.unionQuota) : undefined;
        const poolNumber = Number(poolRaw);
        const poolQuotaFen = poolRaw !== undefined && poolRaw !== null && String(poolRaw).trim() !== "" &&
            Number.isFinite(poolNumber) ? poolNumber : undefined;
        const items:ClubUnionMember[]=[];
        for(const row of rows) {
            if(!row || typeof row !== "object" || Array.isArray(row)) continue;
            const clubId=String(row.club_id || row.clubId || "").trim();
            if(!clubId) continue;
            const quota=Number(row.union_quota);
            const percentRaw=row.union_percent !== undefined ? row.union_percent :
                row.percent !== undefined ? row.percent : row.unionPercent;
            const percent=Number(percentRaw);
            items.push({
                clubId,
                clubName:String(row.club_name || row.clubName || row.name || ("俱乐部 " + clubId)),
                ownerId:String(row.owner_guuid || row.owner_id || row.ownerId || ""),
                ownerName:String(row.owner_name || row.ownerName || ""),
                quotaFen:Number.isFinite(quota) ? quota : undefined,
                unionPercent:percentRaw !== undefined && percentRaw !== null &&
                    String(percentRaw).trim() !== "" && Number.isFinite(percent) ? percent : undefined
            });
        }
        const page={items,total:items.length,poolQuotaFen};
        const pending=this.unionMembersPending;
        if(pending) {
            // 同名推送也可能是别的界面在补联盟名称；context 对不上或没有 members 时不能结束盟友查询。
            const key=this.context(data) || this.context(body);
            if((key && key !== pending.key) || !explicitMembers) return;
            this.unionMembersPending=null;
            clearTimeout(pending.timer);
            if(pending.account !== this.account()) pending.reject(new Error("账号已切换"));
            else pending.resolve(page);
            return;
        }
        if(!this.disposed && explicitMembers && this.onUnionMemberPush)
            this.onUnionMemberPush(page);
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
        const contextKey = this.context(data) || this.context(body) || this.context(first);
        let key = contextKey;
        // 有 context 时不要再拿首行的 club_id 校验：V2 成员列表首行可能是其它俱乐部的盟主虚拟行。
        const club=String(data.club_id || (body && body.club_id) ||
            (contextKey ? "" : (first && first.club_id) || ""));
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
                clubId:String(field(row,["club_id"]) || ""),
                balance,
                role,
                clubGold:displayNumber(field(row,["club_gold"])),
                isAgent:optionalFlag(row,["is_agent"]),
                isLeader:optionalFlag(row,["is_leader"]),
                clubQuotaFen:(()=>{const q=Number(field(row,["quota"]));return Number.isFinite(q)?q:undefined;})(),
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
        const totalNumber = total != null ? Number(total) : null;
        if(totalNumber != null && !Number.isFinite(totalNumber)) {
            this.finish(key,new Error("列表总数格式不匹配"));return;
        }
        // V2：总群主查成员第一页会额外前置「盟主虚拟行」，这些行不占 count；
        // 成员列表允许 items.length > total，不能整包丢弃。
        if(totalNumber != null && totalNumber < items.length && kind !== "members") {
            this.finish(key,new Error("列表总数格式不匹配"));return;
        }
        this.finish(key,null,{items,total:totalNumber != null ? totalNumber : 0});
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
