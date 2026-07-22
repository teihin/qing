

const {ccclass, property} = cc._decorator;

@ccclass
export default class EditBoxEx extends cc.EditBox {

    @property({tooltip:"是否只能输入数字"})
    bNumberOnly:boolean = false;

    @property({tooltip:"是否检测输入只能为字符数字"})
    bCheckChar:boolean = false;

    regNum:RegExp = new RegExp("^[0-9]+$");
    regChar = new RegExp("^[A-Za-z0-9]+$");


    // onLoad () {}

    start () {
        
        this.node.on("text-changed",(editbox:cc.EditBox)=>{
            if(this.bNumberOnly)
            {
                editbox.blur();  //主动让editbox失去焦点，已达到我们替换文本的目的
                let str = "";
                //这个for循环是为了检测每个字符，因为现在的输入法可以一次性输入多个字符
                for(let i = 0; i < editbox.string.length; i++){
                    if(this.regNum.test(editbox.string.charAt(i))){
                        str += editbox.string.charAt(i);
                    }
                }
                console.log(str);
                editbox.string = str;
                editbox.focus();//替换完成后在触发焦点，这样不会导致玩家输入中断。V2.1以下请用setFocus
            }
            else if(this.bCheckChar)
            {
                editbox.blur();  //主动让editbox失去焦点，已达到我们替换文本的目的
                let str = "";
                //这个for循环是为了检测每个字符，因为现在的输入法可以一次性输入多个字符
                for(let i = 0; i < editbox.string.length; i++){
                    if(this.regChar.test(editbox.string.charAt(i))){
                        str += editbox.string.charAt(i);
                    }
                }
                console.log(str);
                editbox.string = str;
                editbox.focus();//替换完成后在触发焦点，这样不会导致玩家输入中断。V2.1以下请用setFocus
            }


        },this);
    }

    // update (dt) {}
}
