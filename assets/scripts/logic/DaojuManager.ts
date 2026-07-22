import Debug from "../common/Debug";
import { stringify } from "querystring";
import { stat } from "fs";
import Tool from "../common/Tool";

const {ccclass, property} = cc._decorator;

@ccclass
export default class DaojuManager extends cc.Component {
    static instance: DaojuManager
    static getInstance() {
        if (!DaojuManager.instance) {            
            let node = new cc.Node("DaojuManager");
            cc.game.addPersistRootNode(node);
            this.instance = node.addComponent(DaojuManager);       
        }
        return DaojuManager.instance;
    }

    onDestroy(){
        DaojuManager.instance = null;
    }
    // onLoad () {}

    start () {

    }

    // update (dt) {}

    public UserDaoju(strName:string,srcV:cc.Vec2,desV:cc.Vec2)
    {
        if(strName === "Nice")
        {
            this.LoadOneObj((animate:cc.Animation)=>{
                animate.node.position = this.node.convertToNodeSpaceAR(srcV);
                let res = ["道具/Nice1","道具/Nice2","道具/Nice3"];
                this.LoadAnimateRes(animate,res,()=>{
                    animate.play("Nice1");
                    this.PlayAudio(animate.node,strName);
                    animate.on("finished",()=>{
                        let move = cc.moveTo(0.5,this.node.convertToNodeSpaceAR(desV));
                        animate.play("Nice2");
                        animate.node.runAction(cc.sequence(move,cc.callFunc(()=>{
                            animate.targetOff(this);
                            animate.play("Nice3");
                            animate.on("finished",()=>{
                                animate.node.destroy();
                            },this);

                        })));
                    },this);
                });
            });
        }
        else if(strName === "亲嘴" || strName === "大拇指" || strName === "屎" || strName === "干杯" || strName === "抓鸡" || strName === "炸弹" || strName === "鲨鱼")
        {
            this.LoadOneObj((animate:cc.Animation)=>{
                animate.node.position = this.node.convertToNodeSpaceAR(srcV);

                if(strName === "鲨鱼")
                {
                    let pos =srcV;
                    let temp =pos.sub(desV);
                    let degree =this.getDegree(temp);
                    animate.node.rotation = -degree;
                }

                //飞到对面后播放后续
                let move = cc.moveTo(0.5,this.node.convertToNodeSpaceAR(desV));

                let res = ["道具/"+strName+"1","道具/"+strName+"2"];
                this.LoadAnimateRes(animate,res,()=>{
                    Debug.Log("clip加载完成！");
                    animate.play(strName+"1")
                    animate.node.runAction(cc.sequence(move,cc.callFunc(()=>{
                        this.PlayAudio(animate.node,strName);
                        animate.node.rotation = 0;
                        //移动结束
                        animate.play(strName+"2");
                        animate.on("finished",()=>{
                            Debug.Log("播放完成！");
                            //完成
                            animate.node.destroy();
                        },this);
                    })));
                });
            });
        }
        else if(strName === "机枪")
        {
            this.LoadObjs((animates:cc.Animation[])=>{
                let res = ["道具/机枪1","道具/机枪2","道具/机枪3"];
                this.LoadAnimateRes(animates[0],["道具/机枪1"],()=>{
                    animates[0].node.anchorX = 1;
                    animates[0].node.scaleX = 2;
                    animates[0].node.position = this.node.convertToNodeSpaceAR(srcV);

                    let pos =srcV;
                    let temp =pos.sub(desV);
                    let degree =this.getDegree(temp);
                    animates[0].node.rotation = -degree;
                    
                    let state =animates[0].play("机枪1")
                    this.PlayAudio(animates[0].node,strName);
                    state.wrapMode = cc.WrapMode.Loop;
                    state.repeatCount = 2;
                    animates[0].on("finished",()=>{
                        animates[0].node.destroy();
                    },this);
                    
                    
                });
                this.LoadAnimateRes(animates[2],["道具/机枪3"],()=>{
                    animates[2].node.position = this.node.convertToNodeSpaceAR(desV);
                    let state =animates[2].play("机枪3")
                    state.wrapMode = cc.WrapMode.Loop;
                    state.repeatCount = 2;
                    animates[2].on("finished",()=>{
                        animates[2].node.destroy();
                    },this);
                    
                });

                this.LoadAnimateRes(animates[1],["道具/机枪2"],()=>{
                    animates[1].node.parent = animates[0].node;
                    animates[1].node.anchorX = 1;
                    //修改子弹长度
                    let distense = srcV.sub(desV).mag()-160;
                    animates[1].node.scaleX = distense/256;
                    animates[1].node.position = cc.v2(-80,0);//cc.v2(animates[0].node.width*2,0);

                    
                    animates[1].node.width = 1000;//distense/2;

                    let state =animates[1].play("机枪2")
                    state.wrapMode = cc.WrapMode.Loop;
                    state.repeatCount = 2;
                    animates[1].on("finished",()=>{
                        animates[1].node.destroy();
                    },this);
                    
                });
            },3);
        }
        else if(strName === "钓鱼")
        {
            this.LoadOneObj((animate:cc.Animation)=>{
                animate.node.position = this.node.convertToNodeSpaceAR(srcV);
                let res = ["道具/钓鱼1","道具/钓鱼2","道具/钓鱼3"];
                this.LoadAnimateRes(animate,res,()=>{
                    animate.play("钓鱼1");
                    this.PlayAudio(animate.node,strName);
                    animate.on("finished",()=>{
                        animate.node.position = this.node.convertToNodeSpaceAR(desV);
                        animate.targetOff(this);
                        animate.play("钓鱼2");
                        animate.on("finished",()=>{
                            let move = cc.moveTo(0.5,this.node.convertToNodeSpaceAR(srcV));
                            animate.targetOff(this);
                            animate.play("钓鱼3");
                            animate.node.runAction(cc.sequence(move,cc.callFunc(()=>{
                                animate.node.destroy();
                            })));
                        },this);
                    },this);
                });
            });
        }
    }
    public LoadOneObj(action:Function)
    {
        cc.loader.loadRes("Prefabs/道具对象",(err,obj)=>{
            if(err)
            {
                cc.error(err.message || err);
                return null;
            }
            let item:cc.Node = cc.instantiate(obj);
            item.scale = 1.5;
            item.parent = this.node;
            let animate = item.getComponent(cc.Animation);
            action(animate);                 
        });
    }
    public LoadObjs(action:Function,nCount:number)
    {
        let arrayPath = Array<string>();
        for(let i=0;i<nCount;i++)
        {
            arrayPath.push("Prefabs/道具对象");
        }
        cc.loader.loadResArray(arrayPath,cc.Prefab,(err,objs)=>{
            if(err)
            {
                cc.error(err.message || err);
                return null;
            }
            let arrayObjs = Array<cc.Animation>();
            for(let one of objs)
            {
                let item:cc.Node = cc.instantiate(one);
                item.scale = 1.5;
                item.parent = this.node;
                let animate = item.getComponent(cc.Animation);
                arrayObjs.push(animate);
            }
            action(arrayObjs);
        });
    }
    public LoadAnimateRes(animate:cc.Animation,res:string[],action:Function)
    {
        cc.loader.loadResArray(res,cc.AnimationClip,(err,assets)=>{
            if(err)
            {
                cc.error(err.message || err);
                return null;
            }
            for(let as of assets)
            {
                animate.addClip(as);
            }
            action();
        });
    }

    public getDegree(vector:cc.Vec2):number
    {
        let degree = Math.atan(vector.y / vector.x) / Math.PI * 180;
        if(vector.x >= 0){
            if(vector.y < 0){
                degree += 360;
            }
        }else{
            if(vector.y > 0){
                degree += 180;
            }else{
                degree = 180 + degree;
            }
        }
        return degree;
    }

    //public audio:cc.AudioSource = null;
    public PlayAudio(root:cc.Node, strName:string)
    {
        
        let nEff =  Tool.GetConfigNumber("AudioEff",100);
        if (nEff > 0)
        {
            let audio = root.getComponent(cc.AudioSource);

            if(audio == null)
            {
                audio = this.node.addComponent(cc.AudioSource);       
                audio.playOnLoad = false;             
            }
        
            let strAuPath = "Audio/道具声音/"+strName;
            audio.volume = nEff / 100;

            cc.loader.loadRes(strAuPath,cc.AudioClip,(err,obj:cc.AudioClip)=>{
                if(err)
                {
                    Debug.Error(err.message+err);
                    return null;
                }
                
                //this.audio.stop();
                audio.clip = obj;
                audio.play();
            });
        }
    }
}
