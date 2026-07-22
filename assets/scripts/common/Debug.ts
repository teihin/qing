
const {ccclass, property} = cc._decorator;

@ccclass
export default class Debug {

    public static Log(msg:any)
    {
        console.log(msg);
    }
    public static Error(msg:any)
    {
        console.error(msg);
    }
    public static Info(msg:any)
    {
        return;
        console.info(msg);
    }
}
