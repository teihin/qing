import UIPanelViewBase from "../common/UIPanelViewBase";
import Tool from "../common/Tool";
import GameDataManager from "../GameDataManager";
import UIManager from "../common/UIManager";
import ScrollViewEx from "../common/ScrollViewEx";
import Debug from "../common/Debug";
import { ShowPanelMode } from "../common/GameDef";
import WebLoadingManager from "../common/WebLoadingManager";

var KBEngine = require("kbengine");

const {ccclass, property} = cc._decorator;

@ccclass
export default class panelRecordList extends UIPanelViewBase {

    private PAGE_PER_COUNT:string = "10";
    private scrollRecordList:ScrollViewEx = null;

    onLoad () {
        super.onLoad();

        this.scrollRecordList = Tool.GetChild(this.node,"战绩列表").getComponent(ScrollViewEx);

        KBEngine.Event.register("PlayerAllScore", this, "OnPlayerAllScore");
    }

    start () {
        let strParam:string = GameDataManager.getAccount().remark;
        if (strParam == "")
            strParam = "0,0,0,0,0,0";
        let arrayParam = strParam.split(',');
        Tool.GetChild(this.node,"统计/总局数").getComponent(cc.Label).string = arrayParam[4];
        Tool.GetChild(this.node,"统计/总手数").getComponent(cc.Label).string = (Number(arrayParam[0])+ Number(arrayParam[1])+ Number(arrayParam[2])).toString();

        this.GetAllRecord();
    }

    // update (dt) {}

    public onButtonClick(button:cc.Button)
    {
        if(button.node.name === "关闭")
        {
            UIManager.getInstance().closePanelByName(this.node.name);
        }
        else if(button.node.name === "首页")
        {
            this.GetAllRecord();
        }
        else if(button.node.name === "上一页")
        {
            if(this.scrollRecordList.nCurPage == 0)
                return;
            this.GetAllRecord(this.scrollRecordList.nCurPage-1);
        }
        else if(button.node.name === "下一页")
        {
            if(this.scrollRecordList.nCurPage+1>=this.scrollRecordList.nTotlePage)
                return;
            this.GetAllRecord(this.scrollRecordList.nCurPage+1);
        }
        else if(button.node.name === "尾页")
        {
            if(this.scrollRecordList.nTotlePage == 0)
                return;
            this.GetAllRecord(this.scrollRecordList.nTotlePage);
        }
        else if(button.node.name === "战绩对象")
        {
            let strRoomID =  button.node.getChildByName("房间号").getComponent(cc.Label).string;
            UIManager.getInstance().showPanel("panelRecordInfo",ShowPanelMode.Cover,strRoomID);
        }
    }

    public onToggleClick(toggle:cc.Toggle)
    {
        if(toggle.node.parent.name === "条件")
        {
            this.GetAllRecord();
        }
    }

    public GetAllRecord(nPage:number = 0)
    {
        let arrayAll:cc.Toggle[] = Tool.GetChild(this.node,"条件").getComponent(cc.ToggleContainer).toggleItems;
        let date:string = "0";
        for(let item of arrayAll)
        {
            if(item.isChecked)
            {
                date = item.node.name;
                break;
            }
        }
        let strParam:string = "{\"header\":\"查询_玩家_所有的牌局_信息\",\"date\":\"" + date + "\",\"page\":\"" + nPage.toString() + "\",\"count\":\"" + this.PAGE_PER_COUNT + "\"}";
        GameDataManager.getAccount().reqHallCommand(strParam, "P@查询_玩家_所有的牌局_信息");
    }

    public OnPlayerAllScore(strMsg:string)
    {
        let data = JSON.parse(strMsg);
        if(data == null)
            return;

        let jList = data["PlayerAllScore"];
        for(let i=0;i<jList.length;i++)
        {
            let jItem = jList[i];
            this.scrollRecordList.nCurPage = Number(jItem["number"]);
            this.scrollRecordList.nTotlePage = Math.ceil(Number(jItem["count"])/Number(this.PAGE_PER_COUNT));

            if(i>=this.scrollRecordList.content.childrenCount)
            {
                WebLoadingManager.loadBlockingRes("Prefabs/战绩对象","正在加载战绩列表",(err,obj)=>{
                    if(err)
                    {
                        cc.error(err.message || err);
                        return null;
                    }
                    let node = cc.instantiate(obj);
                    node.parent = this.scrollRecordList.content;
                    this.setRecordItemInfo(node,jItem);
                });
            }
            else
            {
                this.setRecordItemInfo(this.scrollRecordList.content.children[i],jItem);
            }
        }

        //多余的对象全部删除
        let arrayDel = new Array<cc.Node>();
        for(let i=jList.length;i<this.scrollRecordList.content.childrenCount;i++)
        {
            arrayDel.push(this.scrollRecordList.content.children[i]);
        }
        for(let item of arrayDel)
        {
            item.destroy();
        }

        //更新底栏
        Tool.GetChild(this.node,"分页/页码").getComponent(cc.Label).string = (this.scrollRecordList.nCurPage+1).toString()+"/"+this.scrollRecordList.nTotlePage.toString();

    }
    public setRecordItemInfo(node:cc.Node,jItem:any)
    {
        node.active = true;
        let rawRemark = jItem["all_remark"];
        let remark:any[] = Array.isArray(rawRemark) ? rawRemark : (rawRemark == null ? [] : rawRemark.toString().split(','));
        let buyIn:string = "--";
        if(remark.length > 1 && remark[1] != null)
        {
            let rawBuyIn = remark[1].toString().trim();
            if(rawBuyIn !== "" && isFinite(Number(rawBuyIn)) && Number(rawBuyIn) >= 0)
                buyIn = rawBuyIn;
        }

        node.getChildByName("房间号").getComponent(cc.Label).string = jItem["room_id"];
        node.getChildByName("带入").getComponent(cc.Label).string = buyIn;
        node.getChildByName("底皮").getComponent(cc.Label).string = remark.length > 5 && remark[5] != null ? remark[5].toString() : "--";
        node.getChildByName("时间").getComponent(cc.Label).string = remark.length > 7 && remark[7] != null ? remark[7].toString() : "--";
        node.getChildByName("输赢").getComponent(cc.Label).string = jItem["score"];

        //node.getChildByName("s房间").color = jItem["creater_guuid"] == "694632"?cc.Color.WHITE:cc.Color.RED;

        if(Number(jItem["score"])>0)
        {
            node.getChildByName("输赢").color = cc.color(196,86,66,255);
        }
        else if(Number(jItem["score"])<0)
        {
            node.getChildByName("输赢").color = cc.color(92,156,111,255);
        }

        let btn = node.getComponent(cc.Button);
        btn.node.targetOff(this);
        btn.node.on("click",()=>{
            this.onButtonClick(btn);
        },this);
    }
}
