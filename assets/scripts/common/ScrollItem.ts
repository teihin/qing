import panelMain from "../UI/panelMain";
import UIPanelViewBase from "./UIPanelViewBase";
import ScrollItemBase from "./ScrollItemBase";

const { ccclass, property } = cc._decorator;

@ccclass
export default class ScrollItem extends ScrollItemBase {
    public Refresh(jRoom:any){
        this.node.active = true;
        let room_id = jRoom[0];
        let room_status = jRoom[1];
        let remark = jRoom[2];
        let plays = jRoom[3];
        let max_plays = jRoom[4];
        let game_pi = jRoom[5];
        let game_time = jRoom[6];
        let room_name = jRoom[7];
        let game_9 = jRoom[8] == 0 ? false:true; //地九王

        this.node.name = room_id.toString();

        if(room_id == '-999')
        {
            this.node.opacity = 0;
        }
        else
        {
            this.node.opacity = 255
        }


        this.node.getChildByName("地九王").active = game_9;        
        this.node.getChildByName("底皮").getComponent(cc.Label).string = game_pi.replace("底皮","");
        this.node.getChildByName("人数").getComponent(cc.Label).string = plays+'/'+max_plays;
        this.node.getChildByName("时间").getComponent(cc.Label).string = game_time;
        this.node.getChildByName("倒计时").getComponent(cc.Label).string = "剩余"+remark;
        this.node.getChildByName("name").getComponent(cc.Label).string = room_name;

        cc.loader.loadRes("other/状态_"+room_status,cc.SpriteFrame,(err,obj)=>{
            if(err)
            {
                cc.error(err.message || err);
                return null;
            }
            if(cc.isValid(this.node))
                this.node.getChildByName("状态").getComponent(cc.Sprite).spriteFrame = obj;
        });     
        
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

