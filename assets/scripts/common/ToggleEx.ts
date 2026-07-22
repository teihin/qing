

const {ccclass, property} = cc._decorator;

@ccclass
export default class ToggleEx extends cc.Toggle {


    start () {

        if(this.isChecked)
        {
            this.target.opacity = 0;
            this.checkMark.node.opacity = 255;
        }
        else
        {
            this.target.opacity = 255;
            this.checkMark.node.opacity = 0;
        }

        this.node.on("toggle",()=>{
            if(this.isChecked)
            {
                this.target.opacity = 0;
                this.checkMark.node.opacity = 255;
            }
            else
            {
                this.target.opacity = 255;
                this.checkMark.node.opacity = 0;
            }
        },this);
    }

}
