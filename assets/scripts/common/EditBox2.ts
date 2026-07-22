import InputManager from "../logic/InputManager";

const {ccclass, property} = cc._decorator;

@ccclass
export default class EditBox2 extends cc.EditBox {
    // onLoad () {}

    start () {
        this.node.on("editing-did-began",(editbox:cc.EditBox)=>{
            console.log("开始编辑");
            let strmMsg = "";
            if(editbox.inputFlag == cc.EditBox.InputFlag.PASSWORD)
            {
                let nLen =editbox.string.length;
                for(let i=0;i<nLen;i++)
                {
                    strmMsg+="*";
                }
            }
            else
            {
                strmMsg = editbox.string;
            }
            InputManager.getInstance().ShowInput(strmMsg);
        },this);
        this.node.on("text-changed",(editbox:cc.EditBox)=>{
            console.log("编辑中"+editbox.string);
            let strmMsg = "";
            if(editbox.inputFlag == cc.EditBox.InputFlag.PASSWORD)
            {
                let nLen =editbox.string.length;
                for(let i=0;i<nLen;i++)
                {
                    strmMsg+="*";
                }
            }
            else
            {
                strmMsg = editbox.string;
            }
            InputManager.getInstance().ShowInput(strmMsg);
        },this);
        this.node.on("editing-did-ended",(editbox:cc.EditBox)=>{
            console.log("end编辑");
            InputManager.getInstance().HideInput();
        },this);
        this.node.on("editing-return",(editbox:cc.EditBox)=>{
            console.log("return编辑");
            InputManager.getInstance().HideInput();
        },this);
        
    }

    // update (dt) {}
}
