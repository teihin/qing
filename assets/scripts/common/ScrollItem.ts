import panelMain from "../UI/panelMain";
import UIPanelViewBase from "./UIPanelViewBase";
import ScrollItemBase from "./ScrollItemBase";

const { ccclass, property } = cc._decorator;

@ccclass
export default class ScrollItem extends ScrollItemBase {
    private static statusSpriteCache:{[path:string]:cc.SpriteFrame} = {};
    private refreshVersion:number = 0;

    public Refresh(jRoom:any){
        if(!Array.isArray(jRoom))
        {
            this.node.active = false;
            return;
        }

        const currentRefreshVersion = ++this.refreshVersion;
        this.node.active = true;
        let room_id = jRoom[0] == null ? "" : jRoom[0].toString();
        let room_status = jRoom[1];
        let plays = jRoom[3];
        let max_plays = jRoom[4];
        let game_pi = jRoom[5];
        let game_time = jRoom[6];
        let room_name = jRoom[7];

        this.node.name = room_id;

        if(room_id == '-999')
        {
            this.node.opacity = 0;
        }
        else
        {
            this.node.opacity = 255
        }

        // 当前大厅协议中的 room_name 采用“底皮-房间号”格式，例如
        // “1-812193”。V7 卡片按确认稿拆成“房间 812193 / 底皮 1”，
        // game_pi 则是局数（例如 1/3），不再把 remark 的分钟值塞进局数栏。
        let rawRoomName = room_name == null || room_name === "" ? room_id : String(room_name);
        let displayRoomID = rawRoomName.replace(/^房间\s*/, "");
        let bottomSkin = "";
        let roomNameParts = displayRoomID.match(/^(\d+)-(\d+)$/);
        if(roomNameParts != null)
        {
            bottomSkin = roomNameParts[1];
            displayRoomID = roomNameParts[2];
        }

        // 确认稿卡片没有旧版“地九王”角标；玩法信息仍由房间数据和
        // 进入后的规则面板保留，这里只关闭旧皮肤的叠加美术。
        this.node.getChildByName("地九王").active = false;
        this.node.getChildByName("底皮").getComponent(cc.Label).string = bottomSkin;
        this.node.getChildByName("人数").getComponent(cc.Label).string = plays+'/'+max_plays;
        this.node.getChildByName("时间").getComponent(cc.Label).string = game_time;
        this.node.getChildByName("倒计时").getComponent(cc.Label).string = String(game_pi || "").replace("底皮", "").replace("局数", "");
        this.node.getChildByName("name").getComponent(cc.Label).string = "房间 " + displayRoomID;

        const statusPath = "other/状态_"+room_status;
        const cachedStatus = ScrollItem.statusSpriteCache[statusPath];
        if(cachedStatus != null)
        {
            this.node.getChildByName("状态").getComponent(cc.Sprite).spriteFrame = cachedStatus;
        }
        else
        {
            this.node.getChildByName("状态").getComponent(cc.Sprite).spriteFrame = null;
            cc.loader.loadRes(statusPath,cc.SpriteFrame,(err,obj:cc.SpriteFrame)=>{
            if(err)
            {
                cc.error(err.message || err);
                return null;
            }
            ScrollItem.statusSpriteCache[statusPath] = obj;
            if(cc.isValid(this.node) && this.refreshVersion === currentRefreshVersion && this.node.name === room_id)
                this.node.getChildByName("状态").getComponent(cc.Sprite).spriteFrame = obj;
            });
        }
        
        //更新背景
        // cc.loader.loadRes("other/背景_"+room_status,cc.SpriteFrame,(err,obj)=>{
        //     if(err)
        //     {
        //         cc.error(err.message || err);
        //         return null;
        //     }
        //     if(cc.isValid(this.node))
        //         this.   node.getComponent(cc.Sprite).spriteFrame = obj;
        // }); 

        let btn = this.node.getComponent(cc.Button);
        btn.interactable = room_id != '-999';
        btn.node.targetOff(this);
        btn.node.on("click",()=>{
            this.main.onButtonClick(btn);
        },this);

    }
    public Refresh2(jRoom: any) {        

        //this.node.getChildByName('index').getComponent(cc.Label).string = data;
        let room_id = jRoom.room_id;
        let creater_guuid = jRoom.creater_guuid;
        let room_status = jRoom.room_status;
        let remark = jRoom.remark;
        let is_sitedowned = jRoom.is_sitedowned;
        let inhold_count = jRoom.inhold_count;
        let play_mode = jRoom.play_mode;

        let node = this.node;
        
        node.name = room_id.toString();


        if(room_id == '-999')
        {
            node.opacity = 0;
        }
        else
        {
            node.opacity = 255
        }

        let strRoomName = "";
        let strDiPi = "";
        let strMangGuo = "";
        let strDefTime = "";
        let strRule = "";
        let bSpecialMode = false;
        for(let i=0;i<jRoom.special_rule.length;i++)
        {
            let strTemp:string = jRoom.special_rule[i];
            if(strTemp.indexOf("房间名称:")>=0)
            {
                strRoomName = strTemp.replace("房间名称:","");
            }
            if (strTemp.indexOf("芒果") >= 0 && strTemp.indexOf("/") >= 0)
            {
                strMangGuo = strTemp;
            }
            if (strTemp.indexOf("底皮") >= 0)
            {
                strDiPi = strTemp;
            }
            if(strTemp.indexOf("分钟")>=0)
            {
                strDefTime = strTemp;
            }

            if(strTemp.indexOf("地九王")>=0)
            {
                bSpecialMode = true;
            }
        }
        if(strRoomName.indexOf("私密房")<0)
        {
            node.getChildByName("name").getComponent(cc.Label).string = strRoomName;
            node.getChildByName("私密房").active = false;
        }
        else
        {
            node.getChildByName("name").getComponent(cc.Label).string = "";
            node.getChildByName("私密房").active = true;
        }
        node.getChildByName("地九王").active = bSpecialMode;        
        node.getChildByName("底皮").getComponent(cc.Label).string = strDiPi.replace("底皮","");
        node.getChildByName("人数").getComponent(cc.Label).string = (jRoom.player_list.length+inhold_count).toString()+"/"+jRoom.max_number.toString();
        node.getChildByName("时间").getComponent(cc.Label).string = strDefTime;
        node.getChildByName("倒计时").getComponent(cc.Label).string = "剩余 "+remark+"";

        if(is_sitedowned === "True")
        {             
            cc.loader.loadRes("other/状态_参与过",cc.SpriteFrame,(err,obj)=>{
                if(err)
                {
                    cc.error(err.message || err);
                    return null;
                }
                if(cc.isValid(node))
                    node.getChildByName("状态").getComponent(cc.Sprite).spriteFrame = obj;
            });

            //更新背景
            cc.loader.loadRes("other/背景_参与过",cc.SpriteFrame,(err,obj)=>{
                if(err)
                {
                    cc.error(err.message || err);
                    return null;
                }
                if(cc.isValid(node))
                    node.getComponent(cc.Sprite).spriteFrame = obj;
            });
        }
        else
        {
            cc.loader.loadRes("other/状态_"+room_status,cc.SpriteFrame,(err,obj)=>{
                if(err)
                {
                    cc.error(err.message || err);
                    return null;
                }
                if(cc.isValid(node))
                    node.getChildByName("状态").getComponent(cc.Sprite).spriteFrame = obj;
            });     
            
            //更新背景
            cc.loader.loadRes("other/背景_"+room_status,cc.SpriteFrame,(err,obj)=>{
                if(err)
                {
                    cc.error(err.message || err);
                    return null;
                }
                if(cc.isValid(node))
                    node.getComponent(cc.Sprite).spriteFrame = obj;
            }); 
        }

        let btn = node.getComponent(cc.Button);
        
        btn.node.targetOff(this);
        btn.node.on("click",()=>{
            this.main.onButtonClick(btn);
        },this);
    }
}
