/**
 * 统一解析进入俱乐部房间时使用的 club_id，并把它写入 roomSetting。
 */
export function normalizeRoomClubId(value:any):string
{
    if(value === undefined || value === null)
        return "";
    const id = String(value).trim();
    return /^\d{6}$/.test(id) ? id : "";
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

function readRoomSettingClubId(account:any):string
{
    if(account == null || account.roomSetting == null)
        return "";
    let raw = String(account.roomSetting).trim();
    if(raw.indexOf("{{") === 0 && raw.lastIndexOf("}}") === raw.length - 2)
        raw = raw.slice(1,-1);
    try
    {
        const setting = JSON.parse(raw);
        return normalizeRoomClubId(setting && setting.club_id);
    }
    catch(error)
    {
        return "";
    }
}

/** 只读取当前房间的俱乐部，不回退到大厅当前选中的俱乐部。 */
export function resolveRoomSettingClubId(account:any):string
{
    return readRoomSettingClubId(account);
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
    const roomClubId = preferRoomSetting ? readRoomSettingClubId(account) : "";
    if(roomClubId)
        return roomClubId;
    const ids = accountClubIds(account);
    const selected = readSelectedClubId(account);
    if(selected && (ids.length === 0 || ids.indexOf(selected) >= 0))
        return selected;
    return ids.length > 0 ? ids[0] : "";
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
