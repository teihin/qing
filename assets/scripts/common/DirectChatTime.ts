/**
 * 直聊时间显示工具。
 *
 * 服务端统一返回 `YYYY-MM-DD HH:MM:SS`（毫秒精度时带 `.SSS`），按东八区本地时间格式输出，
 * 客户端按本地时间解析，不再做时区换算。所有页面的时间文案都从这里出，
 * 避免各页面各自拼字符串导致列表、分割线和气泡时间不一致。
 */
export default class DirectChatTime {

    /** 解析服务端时间字符串；无法解析时返回 0，调用方必须容忍 0 不显示时间。 */
    public static Parse(value:any):number
    {
        if(value === null || value === undefined)
            return 0;
        if(typeof value === "number")
            return value > 0 ? value : 0;
        let text = String(value).trim();
        if(text === "")
            return 0;
        // 兼容 ISO 形式（带 T 和 Z）与服务端的空格分隔形式。
        let matched = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?/);
        if(matched == null)
            return 0;
        let result = new Date(
            Number(matched[1]),
            Number(matched[2]) - 1,
            Number(matched[3]),
            Number(matched[4]),
            Number(matched[5]),
            Number(matched[6]),
            matched[7] == null ? 0 : Number((matched[7] + "00").substr(0,3))
        );
        let time = result.getTime();
        return isFinite(time) ? time : 0;
    }

    private static Pad(value:number):string
    {
        return value < 10 ? "0" + value.toString() : value.toString();
    }

    private static StartOfDay(time:number):number
    {
        let date = new Date(time);
        return new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime();
    }

    public static IsSameDay(first:number,second:number):boolean
    {
        if(first <= 0 || second <= 0)
            return false;
        return DirectChatTime.StartOfDay(first) === DirectChatTime.StartOfDay(second);
    }

    /** 会话列表右侧时间：今天显示时分，昨天显示“昨天”，同年显示月日，跨年显示年月日。 */
    public static FormatListTime(value:any):string
    {
        let time = DirectChatTime.Parse(value);
        if(time <= 0)
            return "";
        let now = Date.now();
        let today = DirectChatTime.StartOfDay(now);
        let date = new Date(time);
        if(time >= today)
            return DirectChatTime.Pad(date.getHours()) + ":" + DirectChatTime.Pad(date.getMinutes());
        if(time >= today - 86400000)
            return "昨天";
        if(date.getFullYear() === new Date(now).getFullYear())
            return (date.getMonth() + 1).toString() + "月" + date.getDate().toString() + "日";
        return date.getFullYear().toString() + "/" + (date.getMonth() + 1).toString() + "/" + date.getDate().toString();
    }

    /** 消息时间分割线：今天只显示时分，昨天带“昨天”，更早带日期。 */
    public static FormatDivider(value:any):string
    {
        let time = DirectChatTime.Parse(value);
        if(time <= 0)
            return "";
        let now = Date.now();
        let today = DirectChatTime.StartOfDay(now);
        let date = new Date(time);
        let hm = DirectChatTime.Pad(date.getHours()) + ":" + DirectChatTime.Pad(date.getMinutes());
        if(time >= today)
            return hm;
        if(time >= today - 86400000)
            return "昨天 " + hm;
        let md = (date.getMonth() + 1).toString() + "月" + date.getDate().toString() + "日 " + hm;
        if(date.getFullYear() === new Date(now).getFullYear())
            return md;
        return date.getFullYear().toString() + "年" + md;
    }

    /** 系统通报条的完整时间：一律 YYYY-MM-DD HH:MM:SS，不随「今天/昨天」变化。 */
    public static FormatFull(value:any):string
    {
        let time = DirectChatTime.Parse(value);
        if(time <= 0)
            return "";
        let date = new Date(time);
        return date.getFullYear().toString() + "-" + DirectChatTime.Pad(date.getMonth() + 1) + "-"
            + DirectChatTime.Pad(date.getDate()) + " " + DirectChatTime.Pad(date.getHours()) + ":"
            + DirectChatTime.Pad(date.getMinutes()) + ":" + DirectChatTime.Pad(date.getSeconds());
    }

    /** 两条消息间隔超过 5 分钟才插入时间分割线。 */
    public static NeedDivider(previousTime:number,currentTime:number):boolean
    {
        if(currentTime <= 0)
            return false;
        if(previousTime <= 0)
            return true;
        return currentTime - previousTime > 5 * 60 * 1000;
    }

    /** 语音时长文案：小于 1 秒统一显示 1″，和气泡最短宽度对应。 */
    public static FormatDuration(durationMs:any):string
    {
        let value = Number(durationMs);
        if(!isFinite(value) || value <= 0)
            return "1″";
        let seconds = Math.max(1,Math.round(value / 1000));
        return seconds.toString() + "″";
    }

    /** 录音计时文案：录音浮层显示 0:03 形式。 */
    public static FormatRecordSeconds(seconds:number):string
    {
        let value = Math.max(0,Math.floor(seconds));
        return Math.floor(value / 60).toString() + ":" + DirectChatTime.Pad(value % 60);
    }
}
