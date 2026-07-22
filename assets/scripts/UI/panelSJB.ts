import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import GameDataManager from "../GameDataManager";
import Tool from "../common/Tool";
import { ShowPanelMode, WEB_TX_IP } from "../common/GameDef";
import Debug from "../common/Debug";
import ScrollViewEx from "../common/ScrollViewEx";

const {ccclass, property} = cc._decorator;

@ccclass
export default class panelSJB extends UIPanelViewBase {

    private nStatus = 1 //是否注册过 0正常 1:异常
    private nTotleScore = 0 //总积分
    private strOpenUrl = ""
    // onLoad () {}
    private scrollRecordList:ScrollViewEx = null;

    start () {
        super.start();

        this.scrollRecordList = Tool.GetChild(this.node,"上分列表").getComponent(ScrollViewEx);

        this.GetTotleScore(true) //查询是否注册以及总分
        this.GetHisList() //查询历史记录
    }

    // update (dt) {}

    onButtonClick(button:cc.Button)
    {
        if(button.node.name === "关闭上层")
        {
            button.node.parent.active = false;
        }
        else if(button.node.name === "关闭上上层")
        {
            button.node.parent.parent.active = false;
        }
        else if(button.node.name === "关闭")
        {
            UIManager.getInstance().closePanelByName(this.node.name);
        }
        else if(button.node.name === "首页")
        {
            this.GetHisList();
        }
        else if(button.node.name === "上一页")
        {
            if(this.scrollRecordList.nCurPage == 0)
                return;
            this.GetHisList(this.scrollRecordList.nCurPage-1);
        }
        else if(button.node.name === "下一页")
        {
            if(this.scrollRecordList.nCurPage+1>=this.scrollRecordList.nTotlePage)
                return;
            this.GetHisList(this.scrollRecordList.nCurPage+1);
        }
        else if(button.node.name === "尾页")
        {
            if(this.scrollRecordList.nTotlePage == 0)
                return;
            this.GetHisList(this.scrollRecordList.nTotlePage);
        }
        else if(button.node.name == "我要上分")
        {
           Tool.GetChild(this.node,"上分界面").active = true
           Tool.GetChild(this.node,"上分界面/bk/金额").getComponent(cc.EditBox).string = ""
           Tool.GetChild(this.node,"上分界面/bk/msg").getComponent(cc.Label).string = "注:可以输入最大分数 "+GameDataManager.getAccount().gold

        }
        else if(button.node.name == "我要下分")
        {
            if(this.nStatus == 0)
            {
                Tool.GetChild(this.node,"下分界面").active = true
                Tool.GetChild(this.node,"下分界面/bk/金额").getComponent(cc.EditBox).string = ""
                Tool.GetChild(this.node,"下分界面/bk/msg").getComponent(cc.Label).string = "注:可以输入最大分数 "+this.nTotleScore
     
            }
            else
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请先上分！")
            }
        }
        else if(button.node.name == "进入下注")
        {
            if(this.nStatus == 0)
            {
                Debug.Log(this.strOpenUrl)
                UIManager.getInstance().showPanel("panelSJBWeb",ShowPanelMode.Cover,this.strOpenUrl)
                //cc.sys.openURL(this.strOpenUrl) 
            }
            else
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请先上分！")
            }
        }
        else if(button.node.name == "确定上分")
        {
            Tool.GetChild(this.node,"上分界面").active = false
            let strNum = Tool.GetChild(this.node,"上分界面/bk/金额").getComponent(cc.EditBox).string
            if(strNum=="")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入金额")
                return
            }
            if(Number(strNum)<0)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入正确的金额！")
                return
            }
            let strUrl = "http://"+WEB_TX_IP+"/api/Bigball/up?uuid="+GameDataManager.getAccount().guuid+"&amount="+strNum//;
            Debug.Log(strUrl)
            Tool.HTTP_GET(strUrl,(res)=>{
                Debug.Log(res)
                if(res.status == 200)
                {
                    let data = JSON.parse(res.response)
                    Debug.Log(data)
                    if(data.status.result == 1)
                    {
                        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,data.status.msg)
                    }
                    else
                    {
                       // UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"上分成功")
                        
                        //this.strOpenUrl = data.data.url
                        //刷新
                        this.GetTotleScore()
                        this.GetHisList()

                        //延迟1秒跳转
                        if(this.strOpenUrl == "")
                        {
                            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"获取地址失败")
                        
                        }
                        else
                        {
                            UIManager.getInstance().showPanel("panelSJBWeb",ShowPanelMode.Cover,this.strOpenUrl)
                            // this.scheduleOnce(()=>{
                            //     Debug.Log("跳转"+this.strOpenUrl)
                            //     cc.sys.openURL(this.strOpenUrl)
                            // },1)
                        }
  
                    }
                }
            },()=>{
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"查询异常！")
            })
        }
        else if(button.node.name == "确定下分")
        {
            Tool.GetChild(this.node,"下分界面").active = false
            let strNum = Tool.GetChild(this.node,"下分界面/bk/金额").getComponent(cc.EditBox).string
            if(strNum=="")
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入金额")
                return
            }
            if(Number(strNum)<0)
            {
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入正确的金额！")
                return
            }
            let strUrl = "http://"+WEB_TX_IP+"/api/Bigball/down?uuid="+GameDataManager.getAccount().guuid+"&amount="+strNum//;
            Debug.Log(strUrl)
            Tool.HTTP_GET(strUrl,(res)=>{
                Debug.Log(res)
                if(res.status == 200)
                {
                    let data = JSON.parse(res.response)
                    Debug.Log(data)
                    if(data.status.result == 1)
                    {
                        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,data.status.msg)
                    }
                    else
                    {
                        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"下分成功")
                        //刷新
                        this.GetTotleScore()
                        this.GetHisList()
                    }
                }
            },()=>{
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"查询异常！")
            })
        }
        else if(button.node.name === "客服")
        {
           UIManager.getInstance().showPanel("panelKefu",ShowPanelMode.Cover);    
        }
        else if(button.node.name === "玩法说明")
        {
            Tool.GetChild(this.node,"玩法说明").active = true
        }
    }

    //查询记录
    public GetTotleScore(bGetUrl:boolean = false) //getUrl
    {
        let strUrl = "http://"+WEB_TX_IP+"/api/Bigball/query?uuid="+GameDataManager.getAccount().guuid+"&getUrl="+(bGetUrl?"true":"false");
        Debug.Log(strUrl)
        Tool.HTTP_GET(strUrl,(res)=>{
            Debug.Log(res)
            if(res.status == 200)
            {
                let data = JSON.parse(res.response)
                Debug.Log(data)
                this.nStatus = data.status.result
                if(data.data.url != "")
                {
                    this.strOpenUrl = data.data.url
                }
                this.nTotleScore = data.data.balance
            }
        },()=>{
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"查询异常！")
        })
    }
    //查询上分记录
    public GetHisList(nPage:number = 0)
    {
        nPage = nPage+1

        let strUrl = "http://"+WEB_TX_IP+"/api/Bigball/select_data?pageindex="+nPage+"&pagetotal=10&uuid="+GameDataManager.getAccount().guuid;
        Debug.Log(strUrl)
        Tool.HTTP_GET(strUrl,(res)=>{
            Debug.Log(res)
            if(res.status == 200)
            {
                let data = JSON.parse(res.response)
                Debug.Log(data)
                this.OnHisList(res.response)
            }
        },()=>{
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"查询异常！")
        })
    }
    public OnHisList(strMsg:string)
    {
        let data = JSON.parse(strMsg)

        let jList = data.data;
        this.scrollRecordList.nCurPage = data.pageIndex-1;
        this.scrollRecordList.nTotlePage = data.pageNum;


        for(let i=0;i<jList.length;i++)
        {
            let jItem = jList[i];

            if(i>=this.scrollRecordList.content.childrenCount)
            {
                cc.loader.loadRes("Prefabs/世界杯对象",(err,obj)=>{
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
        Tool.GetChild(node,"类型").getComponent(cc.Label).string = jItem["ORDER_ID"][0]=="D"?"下分":"上分"
        Tool.GetChild(node,"金额").getComponent(cc.Label).string = jItem["TOTAL_PRICE"]
        Tool.GetChild(node,"时间").getComponent(cc.Label).string = jItem["CREATE_TIME"]
        Tool.GetChild(node,"订单号").getComponent(cc.Label).string = jItem["ORDER_ID"]

        //修改颜色
        if(jItem["ORDER_ID"][0]=="U")
        {
            Tool.GetChild(node,"类型").color = cc.Color.GREEN
        }
        else
        {
            Tool.GetChild(node,"类型").color = cc.Color.RED
        }
    }
}
