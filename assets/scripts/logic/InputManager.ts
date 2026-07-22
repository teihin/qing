import Tool from "../common/Tool";

const {ccclass, property} = cc._decorator;

@ccclass
export default class InputManager extends cc.Component {
    static instance: InputManager
    static getInstance() {
        if (!InputManager.instance) {            
            let node = new cc.Node("InputManager");
            cc.game.addPersistRootNode(node);
            this.instance = node.addComponent(InputManager);       
        }
        return InputManager.instance;
    }

    onDestroy(){
        InputManager.instance = null;
    }
    // onLoad () {}

    start () {

    }

    // update (dt) {}
    public inputObj:cc.Node = null;
    public ShowInput(strMsg:string)
    {
        if(cc.sys.os == cc.sys.OS_ANDROID || cc.sys.isBrowser)
        {
            //检测输入控件是否创建

            this.inputObj = cc.find("Canvas").getChildByName("InputBK");
            
            this.inputObj.active = true;
            Tool.GetChild(this.inputObj,"输入/txt").getComponent(cc.Label).string = strMsg;

        }

    }
    public HideInput()
    {
        if(cc.sys.os == cc.sys.OS_ANDROID || cc.sys.isBrowser)
        {
            if(this.inputObj == null)
            {
                this.inputObj = cc.find("Canvas").getChildByName("InputBK");
            }
            this.inputObj.active = false;
        }

    }
}
