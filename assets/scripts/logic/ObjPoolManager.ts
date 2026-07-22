//对象池管理

import Debug from "../common/Debug";

const {ccclass, property} = cc._decorator;

@ccclass
export default class ObjPoolManager extends cc.Component {

    private mapName2Pool = new Map<string,cc.NodePool>(); //缓存池映射

    static instance: ObjPoolManager
    static getInstance() {
        if (!ObjPoolManager.instance) {            
            let node = new cc.Node("ObjPoolManager");
            cc.game.addPersistRootNode(node);
            this.instance = node.addComponent(ObjPoolManager);       
        }
        return ObjPoolManager.instance;
    }

    onDestroy(){
        ObjPoolManager.instance = null;
    }
    
    start () {

    }
    //得到pool
    private getPool(strObjType:string):cc.NodePool
    {
        //没有则创建该缓存池
        let pool:cc.NodePool = null;
        if(!this.mapName2Pool.has(strObjType))
        {
            pool = new cc.NodePool(strObjType);
            this.mapName2Pool.set(strObjType,pool);
        }
        else
        {
            pool = this.mapName2Pool.get(strObjType);
        }
        return pool;
    }
    //增加指定数量的对象到池子
    public addObj2Pool(strObjType:string,nCount:number,bDelayMode:boolean = true){
        let pool:cc.NodePool = this.getPool(strObjType);
        //延时加载
        cc.loader.loadRes("Prefabs/"+strObjType,cc.Prefab,(err,obj)=>{
            if(err){
                Debug.Log(err.message);
                return;
            }
            this.schedule(()=>{
                let node = cc.instantiate(obj);
                pool.put(node);
                Debug.Log('对象池增加对象完成:'+strObjType+'->'+pool.size());
            },0.01,nCount,0.01);          
        })
    }
    //获取对象
    public getObj(strObjType:string,callback:(error: Error, resource: any) => void)
    {
        let pool:cc.NodePool = this.getPool(strObjType);
        if(pool.size() > 0) //有余粮
        {
            Debug.Log('有缓存');
            let obj = pool.get();
            callback(null,obj);
        }
        else
        {
            Debug.Log('没有了需要创建');
            cc.loader.loadRes("Prefabs/"+strObjType,cc.Prefab,(err,obj)=>{
                if(err)
                {
                    callback(err,obj)
                    return;
                }
                let node = cc.instantiate(obj);
                callback(err,node);
            })
        }
    }
    //归还对象
    public returnObj(strObjType:string,obj:cc.Node){
        let pool = this.getPool(strObjType);
        pool.put(obj);
        Debug.Log('归还：'+pool.size());
    }
}
