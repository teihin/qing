const {ccclass, property,executeInEditMode} = cc._decorator;

@ccclass
@executeInEditMode
export default class Score extends cc.Component {

    private bLightMode:boolean = true;

    onLoad(){   

        let size = this.getComponent(cc.Label).fontSize;
        let sc = this.node.getScale(cc.v3());


        if(sc.x === 0.25 && !this.bLightMode)
        {
            this.node.setScale(1,1,1);
            this.getComponent(cc.Label).fontSize = size/4;
            this.getComponent(cc.Label).lineHeight = size/4;
        }

        if(sc.x === 1 && this.bLightMode)
        {
            this.node.setScale(0.25,0.25,0.25);
            this.getComponent(cc.Label).fontSize = size*4;
            this.getComponent(cc.Label).lineHeight = size*4;
        }
    }


    // // 编辑框输入事件
    // public inputScore (string: string ,editbox: cc.EditBox) {
    //     let s = parseInt(string);
    //     this._w = s;
    // }

    
    

}

// @property
// get w () {
//     this._w = this.getComponent(cc.Label).fontSize/4;
//     this.getComponent(cc.Label).fontSize = this._w*4;
//     this.getComponent(cc.Label).lineHeight = this._w*4;
//     this.node.setScale(0.25,0.25,0.25);
//     return this.getComponent(cc.Label).fontSize/4;
// }

// set w (value) {
//     this._w = value;
//     this.getComponent(cc.Label).fontSize = this._w*4;
//     this.getComponent(cc.Label).lineHeight = this._w*4;
//     this.node.setScale(0.25,0.25,0.25);
// }

// // 编辑框输入事件
// public inputScore (string: string ,editbox: cc.EditBox) {
//     let s = parseInt(string);
//     this._w = s;
// }