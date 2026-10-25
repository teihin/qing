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
