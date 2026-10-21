import GameDataManager from "../GameDataManager";
import {ClubManagementApi,ClubListKind,ClubAction,ClubPeoplePage} from "./ClubManagementView";
const KBEngine = require("kbengine");
interface Pending {
    account:string; club:string; kind:string; page:number; user:string;
    resolve:(value:any)=>void; reject:(error:Error)=>void; timer:any;
}

/** Hall commands and async pushes are correlated separately; acceptance is not a list/result. */
export default class HallClubManagementApi implements ClubManagementApi {
    private pending:{[context:string]:Pending} = {};
    // JoinerList has no context/club_id. Foreground lists and badge probes share one lane.
    private applicationActive:string = "";
    private applicationQueue:Array<{club:string;kind:string;header:string;extra:any;account:string;resolve:(v:any)=>void;reject:(e:Error)=>void}> = [];
    private serial:number = 0;
    private prefix = "clubmg:" + Date.now() + ":";
    private disposed = false;
    constructor(private badge:(club:string,count:number)=>void) {
        KBEngine.Event.register("onHallCommand",this,"OnCommand");
        KBEngine.Event.register("NumberList",this,"OnMembers");
        // Legacy application route; decoder rejects unknown shapes instead of treating them as empty.
        KBEngine.Event.register("JoinerList",this,"OnApplications");
        KBEngine.Event.register("ClubReqInfo",this,"OnBadge");
    }
    public Dispose():void {
        this.disposed = true;
        KBEngine.Event.deregisterAll(this);
        this.applicationQueue.splice(0).forEach(job=>job.reject(new Error("页面已关闭")));
        Object.keys(this.pending).forEach(key=>this.finish(key,new Error("页面已关闭")));
    }
    private account():string { const a=GameDataManager.getAccount();return a ? String(a.guuid || "") : ""; }
    private request(club:string,kind:string,header:string,extra:any = {}):Promise<any> {
        if(this.disposed) return Promise.reject(new Error("页面已关闭"));
        if(kind === "applications" || kind === "badges") {
            if(this.applicationActive && !this.pending[this.applicationActive])
                return Promise.reject(new Error("上一入会查询尚未返回，请稍后重试或重新登录"));
            return new Promise((resolve,reject)=>{
                this.applicationQueue.push({club,kind,header,extra,account:this.account(),resolve,reject});
                this.pumpApplications();
            });
        }
        return this.sendRequest(club,kind,header,extra);
    }
    private pumpApplications():void {
        if(this.disposed || this.applicationActive)return;
        const job=this.applicationQueue.shift();if(!job)return;
        if(job.account !== this.account()) {job.reject(new Error("账号已切换"));this.pumpApplications();return;}
        this.sendRequest(job.club,job.kind,job.header,job.extra).then(job.resolve,job.reject);
    }
    private sendRequest(club:string,kind:string,header:string,extra:any):Promise<any> {
        const context = this.prefix + (++this.serial);
        if(kind === "applications" || kind === "badges") this.applicationActive=context;
        return new Promise((resolve,reject)=>{
            const timer = setTimeout(()=>this.finish(context,new Error("请求超时，请刷新后确认结果"),null,true),12000);
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
            } else {
                this.applicationActive="";
                this.pumpApplications();
            }
        }
    }
    private parse(raw:any):any { try{return typeof raw === "string" ? JSON.parse(raw) : raw;}catch(e){return null;} }
    private context(data:any):string {return String(data && data.context || "").replace(/^[pP]@/,"");}
    public list(club:string,kind:ClubListKind,page:number,count:number):Promise<ClubPeoplePage> {
        return this.request(club,kind,kind === "members" ? "查询_俱乐部_成员" : "查询_俱乐部_加入申请",
            kind === "members" ? {page,count,user_id:"ALL"} : {page,count,mode:0});
    }
    public async act(club:string,action:ClubAction,user:string):Promise<{message?:string}> {
        const account = this.account();
        const commands={leave:"申请_退出_俱乐部",dissolve:"删除_俱乐部",approve:"添加_俱乐部_玩家",reject:"删除_俱乐部_加入申请",remove:"删除_俱乐部_玩家",promote:"添加_俱乐部_管理员"};
        const outcome = await this.request(club,action,commands[action],user ? {user_id:user} : {});
        if(action === "promote") return {message:outcome.accepted ? "设置管理员请求已受理，请刷新确认" : "已设为管理员"};
        if(action === "remove") return {message:"已删除俱乐部成员"};
        if(action === "approve") {
            // 0x500 is acceptance. Confirm this exact player through the authoritative member query.
            for(let attempt=0;attempt<3;attempt++) {
                if(attempt) await new Promise(resolve=>setTimeout(resolve,1000));
                if(this.disposed || this.account() !== account) throw new Error("账号或页面已切换");
                const result:ClubPeoplePage = await this.request(club,"verify","查询_俱乐部_成员",{user_id:user,page:0,count:20});
                if(result.items.some(item=>item.id === user)) {
                    this.RefreshBadges();return {message:"已同意加入俱乐部"};
                }
            }
            throw new Error("请求已受理，成员状态尚未确认，请刷新列表后确认");
        }
        this.RefreshBadges();
        return {message:action === "leave" ? "退出申请已提交，请等待审核" : action === "dissolve" ? "俱乐部已解散" : "已拒绝入会申请"};
    }
    public RefreshBadges():void {
        const a=GameDataManager.getAccount();
        if(!a || (!a.club_make && !a.club_manage) || this.disposed)return;
        // Use per-club list counts. Aggregate queries could emit multiple untagged JoinerList pushes.
        const ids=(String(a.club_make||"")+","+String(a.club_manage||"")).split(",").map(x=>x.trim()).filter((x,i,all)=>/^\d{6}$/.test(x)&&all.indexOf(x)===i);
        for(const club of ids) {
            if(Object.keys(this.pending).some(k=>this.pending[k].club===club && ["badges","applications"].indexOf(this.pending[k].kind)>=0) ||
                this.applicationQueue.some(job=>job.club===club))continue;
            this.request(club,"badges","查询_俱乐部_加入申请",{page:0,count:1,mode:0})
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
        if(p.kind !== "approve" && p.kind !== "promote" && p.kind !== "badges" && code !== 0x200) {
            this.finish(key,new Error("请求已受理，操作结果尚未确认，请刷新后确认"));return;
        }
        this.finish(key,null,{accepted:code === 0x500});
    }
    public OnMembers(raw:string):void {this.receive(raw,"members","NumberList");}
    public OnApplications(raw:string):void {this.receive(raw,"applications","JoinerList");}
    private receive(raw:string,kind:string,field:string):void {
        const data=this.parse(raw);if(!data)return;
        const body=data.result && !Array.isArray(data.result) ? this.parse(data.result) : data;
        const rows=Array.isArray(data) ? data : data[field] || (body && body[field]) || data.result;
        const first=Array.isArray(rows) && rows.length ? rows[0] : null;
        let key=this.context(data) || this.context(body) || this.context(first);
        const club=String(data.club_id || (body && body.club_id) || (first && first.club_id) || "");
        const number=data.number != null ? data.number : body && body.number != null ? body.number : first && first.number;
        if(kind === "applications" && !key && !club && Array.isArray(rows)) {
            key=this.applicationActive;
            if(key && !this.pending[key]) {
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
            const role = row.club_role === "管理员" || row.club_role === "创建者" ? row.club_role : undefined;
            items.push({id,name:String(row.name || row.user_name || row.nickname || "玩家 "+id),balance,role});
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
        const rows=Array.isArray(data) ? data : Array.isArray(data.ClubReqInfo) ? data.ClubReqInfo : [data];
        const a=GameDataManager.getAccount();if(!a)return;
        const ids=(String(a.club_make||"")+","+String(a.club_manage||"")).split(",").map(x=>x.trim());
        for(const row of rows) {
            const id=String(row.club_id || "");
            if(ids.indexOf(id)>=0 && row.req_count != null)this.badge(id,Number(row.req_count));
        }
    }
}
