/**
 * 房间俱乐部统一解析：roomSetting 的 club_id/union_id、玩家自己的结算俱乐部，
 * 以及进房参数里的 club_id 拼装。
 */
export function normalizeRoomClubId(value:any):string
{
    if(value === undefined || value === null)
        return "";
    const id = String(value).trim();
    return /^\d{6}$/.test(id) ? id : "";
}

export function normalizeRoomUnionId(value:any):string
{
    return normalizeRoomClubId(value);
}

interface RoomSettingInfo
{
    clubId:string;
    unionId:string;
}

function accountClubIds(account:any):string[]
{
    const result:string[] = [];
    if(account == null)
        return result;
    for(const value of [account.club_make, account.club_join, account.club_join2, account.club_manage])
    {
        for(const raw of String(value || "").split(","))
        {
            const id = normalizeRoomClubId(raw);
            if(id && result.indexOf(id) < 0)
                result.push(id);
        }
    }
    return result;
}

function readRoomSetting(account:any):RoomSettingInfo
{
    const result:RoomSettingInfo = { clubId:"", unionId:"" };
    if(account == null || account.roomSetting == null)
        return result;
    let raw = String(account.roomSetting).trim();
    if(raw.indexOf("{{") === 0 && raw.lastIndexOf("}}") === raw.length - 2)
        raw = raw.slice(1,-1);
    try
    {
        const setting = JSON.parse(raw);
        result.clubId = normalizeRoomClubId(setting && setting.club_id);
        result.unionId = normalizeRoomUnionId(setting && setting.union_id);
    }
    catch(error) {}
    return result;
}

/** 只读取当前房间的俱乐部，不回退到大厅当前选中的俱乐部。 */
export function resolveRoomSettingClubId(account:any):string
{
    return readRoomSetting(account).clubId;
}

/** 联盟房返回 6 位联盟码；普通房和成员旧房为空串。 */
export function resolveRoomSettingUnionId(account:any):string
{
    return readRoomSetting(account).unionId;
}

export function isUnionRoom(account:any):boolean
{
    return resolveRoomSettingUnionId(account) !== "";
}

/**
 * 读取 Account.club_gold 中指定俱乐部的积分（单位：元）。
 * 服务端通常下发 JSON 映射；保留数字/数字字符串兼容，缺失和 -99 统一按 0 处理。
 */
export function getAccountClubGold(account:any, clubId:any):number
{
    const id = normalizeRoomClubId(clubId);
    if(account == null || id === "")
        return 0;

    let value:any = account.club_gold;
    if(typeof value === "string")
    {
        try { value = JSON.parse(value); }
        catch(error) { return 0; }
    }

    let raw:any = value;
    if(value != null && typeof value === "object" && !Array.isArray(value))
        raw = value[id];
    const number = Number(raw);
    return Number.isFinite(number) && number >= 0 && number !== -99 ? number : 0;
}

function readSelectedClubId(account:any):string
{
    const guuid = account == null || account.guuid == null ? "" : String(account.guuid);
    if(!guuid)
        return "";
    try
    {
        if(typeof cc !== "undefined" && cc.sys && cc.sys.localStorage)
            return normalizeRoomClubId(cc.sys.localStorage.getItem("lastRoomClub:" + guuid));
    }
    catch(error) {}
    return "";
}

export function resolveRoomClubId(account:any, preferred:any = "", preferRoomSetting:boolean = false):string
{
    const explicit = normalizeRoomClubId(preferred);
    if(explicit)
        return explicit;
    const roomClubId = preferRoomSetting ? readRoomSetting(account).clubId : "";
    if(roomClubId)
        return roomClubId;
    const ids = accountClubIds(account);
    const selected = readSelectedClubId(account);
    if(selected && (ids.length === 0 || ids.indexOf(selected) >= 0))
        return selected;
    return ids.length > 0 ? ids[0] : "";
}

let cachedRoomSettingRaw:string = "";
let cachedMyRoomClubId:string = "";

function isOwnClubId(account:any, clubId:string):boolean
{
    if(clubId === "")
        return false;
    const ids = accountClubIds(account);
    return ids.length === 0 || ids.indexOf(clubId) >= 0;
}

/** 给定俱乐部 ID 是否是账号自己的俱乐部；账号俱乐部列表尚未加载时不拦。 */
export function isAccountClubId(account:any, clubId:any):boolean
{
    return isOwnClubId(account,normalizeRoomClubId(clubId));
}

function syncMyRoomClubCache(account:any):void
{
    const raw = account == null || account.roomSetting == null ? "" : String(account.roomSetting);
    if(raw !== cachedRoomSettingRaw)
    {
        cachedRoomSettingRaw = raw;
        cachedMyRoomClubId = "";
    }
}

/** 记录服务端确认的本房间结算俱乐部；切房后由 roomSetting 原文变化自动清空。 */
export function setMyRoomClubId(value:any):void
{
    cachedMyRoomClubId = normalizeRoomClubId(value);
}

/**
 * 牌桌内真正用于积分/带入/兑换/结算的俱乐部。
 * 普通俱乐部房沿用 roomSetting.club_id；联盟共享房用玩家自己的俱乐部，
 * 不能回退到房间归属俱乐部，否则会拿房间老板的俱乐部去查余额。
 */
export function resolveMyRoomClubId(account:any, selfReqClubId:any = ""):string
{
    syncMyRoomClubCache(account);
    const setting = readRoomSetting(account);
    const reqClubId = normalizeRoomClubId(selfReqClubId);
    if(setting.unionId === "")
    {
        if(setting.clubId !== "")
            return setting.clubId;
        // 老房间回包可能只在本人 PlayerInfo.req_club_id 带回俱乐部。
        return reqClubId;
    }

    if(isOwnClubId(account, reqClubId))
    {
        cachedMyRoomClubId = reqClubId;
        return reqClubId;
    }
    if(isOwnClubId(account, cachedMyRoomClubId))
        return cachedMyRoomClubId;

    // 服务端还没下发当前玩家俱乐部时，用大厅当前选中的俱乐部兜底；
    // 多俱乐部玩家仍优先使用 PlayerList 的 req_club_id。
    const fallback = resolveRoomClubId(account);
    if(isOwnClubId(account, fallback))
    {
        cachedMyRoomClubId = fallback;
        return fallback;
    }
    return "";
}

/** 兼容旧的双大括号输入，但始终输出服务器要求的单层 JSON。 */
export function withRoomClubId(roomSetting:any, clubId:any):string
{
    const raw = roomSetting == null ? "" : String(roomSetting).trim();
    const id = normalizeRoomClubId(clubId);
    const wrapped = raw.indexOf("{{") === 0 && raw.lastIndexOf("}}") === raw.length - 2;
    const json = wrapped ? raw.slice(1,-1) : raw;
    let setting:any = {};
    if(json)
    {
        try { setting = JSON.parse(json); }
        catch(error) { return raw; }
    }
    if(setting == null || typeof setting !== "object" || Array.isArray(setting))
        return raw;
    if(id)
        setting.club_id = id;
    const result = JSON.stringify(setting);
    // 双大括号只是旧客户端传入的包装，不能继续下发给服务器。
    return result;
}
