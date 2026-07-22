import Debug from "../common/Debug";
import { CardInfo } from "../common/GameDef";
import GameDataManager from "../GameDataManager";

const {ccclass, property} = cc._decorator;

@ccclass
export default class DrhNameManager extends cc.Component {

    mapCard2Name:Map<string,string> = new Map<string,string>();

    static instance: DrhNameManager
    static getInstance() {
        if (!DrhNameManager.instance) {            
            let node = new cc.Node("DrhNameManager");
            cc.game.addPersistRootNode(node);
            this.instance = node.addComponent(DrhNameManager);            
        }
        return DrhNameManager.instance;
    }
    onDestroy()
    {
        DrhNameManager.instance = null;
    }
    //初始化
    initManager()
    {
        cc.loader.loadRes("other/nameconfig",(err,conf)=>{
            if(err)
            {
                cc.error(err.message || err);
                return null;
            }
            
            //解析内容
            let msg:string = conf.text;
            let lines = msg.split("\n");
            lines.forEach((one,idx,array)=>{
                let items = one.split("|"); 
                let cards = items[1].split(" ");
                cards.forEach((card,idx,array)=>{
                    card = card.trim();
                    if(!this.mapCard2Name.has(card))
                    {
                        this.mapCard2Name.set(card,items[0]);
                    }
                    else
                    {
                        Debug.Log("发现重复牌型：" + card);
                    }
                },this);
            },this);

            Debug.Log("映射解析完成，发现:"+this.mapCard2Name.size);

        });



        // let time = new Date(0,0,0,0,0,80,0); //10秒
        // Debug.Log("时间1->"+time.getHours()+":"+time.getMinutes()+":"+time.getSeconds());

        // this._test = this.test.bind(this,10);
        // this.schedule(this._test,1,cc.macro.REPEAT_FOREVER,0);
    }
    // _test:Function;
    // count:number = 10;
    // public test(test:number,callback:Function)
    // {
    //     if(this.count>=0)
    //         Debug.Log("计数:"+this.count--);
    //     else
    //         {
    //             Debug.Log("结束");
    //             this.unschedule(this._test);
    //         }
    // }

    public GetDrhNameByCard(arrayCards:Array<CardInfo>,strPlayMode:string = ""):string
    {
        let strName =  arrayCards[0].nType.toString()+arrayCards[0].nNum.toString()+":"+arrayCards[1].nType.toString()+arrayCards[1].nNum.toString();
        Debug.Log(strName);
        let strValue = "";

        if(!this.mapCard2Name.has(strName))
        {
            strName = arrayCards[1].nType.toString()+arrayCards[1].nNum.toString()+":"+arrayCards[0].nType.toString()+arrayCards[0].nNum.toString();
            strValue = this.mapCard2Name.get(strName);
        }
        else
        {
            strValue = this.mapCard2Name.get(strName);
        }

        let strSet:string = GameDataManager.getAccount().roomSetting;
        if(strSet.indexOf("地九王")<0 && strValue == "地九王" && strPlayMode != "地方")
        {
            strValue = null;
        }

        //没有找到的特殊牌型按点数计算
        if (strValue == null || strValue == "")
        {
            if (arrayCards[0].nType == 4)
                arrayCards[0].nNum = 6;
            if (arrayCards[1].nType == 4)
                arrayCards[1].nNum = 6;

            let nNum = (arrayCards[0].nNum + arrayCards[1].nNum)%10;
            strValue = nNum.toString() + "点";
        }

        return strValue;
    }

    
}
