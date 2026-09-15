import UIPanelViewBase from "../common/UIPanelViewBase";
import UIManager from "../common/UIManager";
import { ShowPanelMode, CardInfo } from "../common/GameDef";
import GameDataManager from "../GameDataManager";
import MobileManager from "../mobile/MobileManager";
import Debug from "../common/Debug";
import Tool from "../common/Tool";
import ConfigManager from "../logic/ConfigManager";
import ImageManager from "../logic/ImageManager";
import DeviceIdentityManager from "../logic/DeviceIdentityManager";

var KBEngine = require("kbengine");

const {ccclass, property} = cc._decorator;

interface RegisterFormData {
    invitationCode:string;
    nickname:string;
    loginName:string;
    password:string;
    confirmPassword:string;
    avatarIndex:string;
    antiTheftEnabled:boolean;
    deviceId?:string;
    devicePlatform?:"android"|"ios"|"web";
    deviceVersion?:number;
}

interface RegistrationResponse {
    ok?:boolean;
    data?:{
        message?:string;
    };
    error?:{
        code?:string;
        message?:string;
    };
}

@ccclass
export default class panelLogin extends UIPanelViewBase {

    // 注册界面布局全部维护在 panelLogin.prefab；本脚本只处理交互、校验和接口请求。
    private _loginUserName:string = "";
    private _loginPass:string = "";
    private _loginInputEditing:{[key:string]:boolean} = {};
    private _loginInputPlaceholderArt:{[key:string]:cc.Node} = {};
    private strLastMMSMask:string = "";
    private _registerPanel:cc.Node = null;
    private _registerDialog:cc.Node = null;
    private _registerInputs:{[key:string]:cc.EditBox} = {};
    private _registerInputEditing:{[key:string]:boolean} = {};
    private _registerStatus:cc.Label = null;
    private _registerStatusBackground:cc.Node = null;
    private _registerStatusIcon:cc.Node = null;
    private _registerAvatarSprite:cc.Sprite = null;
    private _registerAvatarLabel:cc.Label = null;
    private _registerAvatarPicker:cc.Node = null;
    private _registerAvatarIndex:string = "1";
    private _registerAntiTheftToggle:cc.Toggle = null;
    private _registerAvatarBatch:Array<string> = [];
    private _registerAvatarBySlot:{[slotName:string]:string} = {};
    private _registerSubmitting:boolean = false;
    private _registerRequest:XMLHttpRequest = null;
    // 重置密码界面布局全部维护在 panelLogin.prefab；本脚本只处理交互、校验和接口请求。
    private _resetPanel:cc.Node = null;
    private _resetDialog:cc.Node = null;
    private _resetInputs:{[key:string]:cc.EditBox} = {};
    private _resetInputEditing:{[key:string]:boolean} = {};
    private _resetColoredPlaceholders:{[key:string]:cc.Color} = {};
    private _resetSubmitting:boolean = false;
    private _resetRequest:XMLHttpRequest = null;
    onLoad(){
        super.onLoad();

        
        if(cc.sys.os === cc.sys.OS_IOS || cc.sys.os === cc.sys.OS_ANDROID)
        {
            this._loginUserName = Tool.GetConfigString("unionid","");
            Debug.Log("本地缓存账号111122111:"+this._loginUserName);
        }
        else
        {
            //PC版随机一个账号
            // this._loginUserName = new Date().getTime().toString();
            // cc.sys.localStorage.setItem("unionid",this._loginUserName);

            //PC版读取本地配置账号
            //this._loginUserName = "testabc";
        }
        this.node.getChildByName("ver").getComponent(cc.Label).string = GameDataManager.getInstance().strLocalVertion;


        KBEngine.Event.register("onLoginSuccessfully", this, "onLoginSuccessfully");   


        let test = new CardInfo(1,2,1,2,1,2);
        Debug.Log(test.nCheck.toString());

        MobileManager.getInstance();



        //初始化账号密码
        this._loginPass = Tool.GetConfigString("pass","");
        this.node.getChildByName("手机号").getComponent(cc.EditBox).string = this._loginUserName;
        this.node.getChildByName("密码").getComponent(cc.EditBox).string = this._loginPass;
        this.initLoginInputArt();

        this.initRegisterUI();

        this.initResetUI();

        let forcedLogoutMessage = GameDataManager.getInstance().consumeForcedLogoutMessage();
        if(forcedLogoutMessage != "")
        {
            // 等登录面板完成挂载后再显示，避免被更新页到登录页的切换覆盖。
            this.scheduleOnce(()=>{
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,forcedLogoutMessage);
            },0);
        }


        //Debug.Error("https://mcybde.com/chat/text/chat_04RAVp.html?extradata="+Tool.encrypt("{\"vipid\":\"999999\",\"name\":\"黄澄澄\"}"))

        
    }

    private initLoginInputArt()
    {
        let artNames:{[key:string]:string} = {
            "手机号":"V7账号占位美术字",
            "密码":"V7密码占位美术字"
        };
        for(let fieldName in artNames)
        {
            let editBox = this.node.getChildByName(fieldName).getComponent(cc.EditBox);
            this._loginInputEditing[fieldName] = false;
            this._loginInputPlaceholderArt[fieldName] = editBox.node.getChildByName(artNames[fieldName]);
            editBox.node.on("text-changed",()=>this.refreshLoginInputArt(fieldName),this);
            editBox.node.on("editing-did-began",()=>{
                this._loginInputEditing[fieldName] = true;
                this.refreshLoginInputArt(fieldName);
            },this);
            editBox.node.on("editing-did-ended",()=>{
                this._loginInputEditing[fieldName] = false;
                this.refreshLoginInputArt(fieldName);
            },this);
            this.refreshLoginInputArt(fieldName);
        }
    }

    private refreshLoginInputArt(fieldName:string)
    {
        let editBox = this.node.getChildByName(fieldName).getComponent(cc.EditBox);
        let art = this._loginInputPlaceholderArt[fieldName];
        if(editBox != null && art != null)
            art.active = !this._loginInputEditing[fieldName] && editBox.string.length == 0;
    }

    private initRegisterUI()
    {
        this._registerPanel = this.node.getChildByName("注册弹窗");
        this._registerDialog = Tool.GetChild(this._registerPanel,"注册资料框");
        this._registerStatus = Tool.GetChild(this._registerDialog,"注册状态").getComponent(cc.Label);
        this._registerStatusBackground = Tool.GetChild(this._registerDialog,"V7注册动态状态底");
        this._registerStatusIcon = Tool.GetChild(this._registerDialog,"V7注册状态图标");
        this._registerInputs["invitationCode"] = Tool.GetChild(this._registerDialog,"邀请码/输入").getComponent(cc.EditBox);
        this._registerInputs["nickname"] = Tool.GetChild(this._registerDialog,"昵称/输入").getComponent(cc.EditBox);
        this._registerInputs["loginName"] = Tool.GetChild(this._registerDialog,"账号/输入").getComponent(cc.EditBox);
        this._registerInputs["password"] = Tool.GetChild(this._registerDialog,"密码/输入").getComponent(cc.EditBox);
        this._registerInputs["confirmPassword"] = Tool.GetChild(this._registerDialog,"确认密码/输入").getComponent(cc.EditBox);
        this._registerAvatarSprite = Tool.GetChild(this._registerDialog,"头像选择/头像预览").getComponent(cc.Sprite);
        this._registerAvatarLabel = Tool.GetChild(this._registerDialog,"头像选择/头像序号").getComponent(cc.Label);
        this._registerAvatarPicker = Tool.GetChild(this._registerPanel,"头像选择弹窗");
        this._registerAntiTheftToggle = Tool.GetChild(this._registerDialog,"防盗号/防盗号开关").getComponent(cc.Toggle);
        this._registerAntiTheftToggle.isChecked = false;
        this._registerAvatarPicker.active = false;
        this.setRegisterAvatar("1");
        DeviceIdentityManager.getInstance().prepare();

        for(let key in this._registerInputs)
        {
            this._registerInputEditing[key] = false;
            this._registerInputs[key].node.on("text-changed",()=>this.onRegisterInputChanged(key),this);
            this._registerInputs[key].node.on("editing-did-began",()=>{
                this._registerInputEditing[key] = true;
                this.refreshRegisterInputArt(key);
            },this);
            this._registerInputs[key].node.on("editing-did-ended",()=>{
                this._registerInputEditing[key] = false;
                this.refreshRegisterInputArt(key);
            },this);
            this.refreshRegisterInputArt(key);
        }
    }

    private setRegisterAvatar(avatarValue:any)
    {
        this._registerAvatarIndex = ImageManager.getInstance().NormalizeAvatarIndex(avatarValue);
        ImageManager.getInstance().SetLocalAvatar(this._registerAvatarSprite,this._registerAvatarIndex);
        this._registerAvatarLabel.string = "点击选择头像";
        this.refreshRegisterAvatarPickerSelection();
        if(!this._registerSubmitting)
            this.showRegisterStatus("已选择头像 " + this._registerAvatarIndex,false);
    }

    private stepRegisterAvatar(offset:number)
    {
        let imageManager = ImageManager.getInstance();
        let current = Number(imageManager.NormalizeAvatarIndex(this._registerAvatarIndex));
        let next = ((current - 1 + offset) % imageManager.AVATAR_COUNT + imageManager.AVATAR_COUNT) % imageManager.AVATAR_COUNT + 1;
        this.setRegisterAvatar(next.toString());
    }

    private openRegisterAvatarPicker()
    {
        this.blurRegisterInputs();
        this.refreshRegisterAvatarBatch();
        this._registerAvatarPicker.active = true;
        let dialog = Tool.GetChild(this._registerAvatarPicker,"头像选择框");
        dialog.stopAllActions();
        dialog.opacity = 0;
        dialog.scale = 0.96;
        cc.tween(dialog).to(0.16,{opacity:255,scale:1},{easing:"backOut"}).start();
    }

    private closeRegisterAvatarPicker()
    {
        this._registerAvatarPicker.active = false;
    }

    private refreshRegisterAvatarPickerSelection()
    {
        if(this._registerAvatarPicker == null)
            return;
        let list = Tool.GetChild(this._registerAvatarPicker,"头像选择框/头像列表");
        if(list == null)
            return;
        for(let item of list.children)
        {
            let selected = item.getChildByName("选中");
            if(selected != null)
                selected.active = this._registerAvatarBySlot[item.name] === this._registerAvatarIndex;
        }
    }

    private refreshRegisterAvatarBatch()
    {
        if(this._registerAvatarPicker == null)
            return;
        let list = Tool.GetChild(this._registerAvatarPicker,"头像选择框/头像列表");
        if(list == null)
            return;

        let imageManager = ImageManager.getInstance();
        this._registerAvatarBatch = imageManager.RandomAvatarBatch(20,this._registerAvatarBatch);
        this._registerAvatarBySlot = {};
        for(let index = 0; index < list.children.length && index < this._registerAvatarBatch.length; index++)
        {
            let item = list.children[index];
            let avatarIndex = this._registerAvatarBatch[index];
            this._registerAvatarBySlot[item.name] = avatarIndex;
            imageManager.SetLocalAvatar(item.getComponent(cc.Sprite),avatarIndex);
        }
        this.refreshRegisterAvatarPickerSelection();
    }

    private onRegisterInputChanged(key:string)
    {
        let editBox = this._registerInputs[key];
        let filtered = editBox.string;
        if(key === "invitationCode")
            filtered = filtered.replace(/[^0-9]/g,"");
        else if(key === "nickname")
            filtered = filtered.replace(/[^A-Za-z0-9\u3400-\u4DBF\u4E00-\u9FFF]/g,"");
        else if(key === "loginName")
            filtered = filtered.replace(/[^A-Za-z0-9]/g,"");
        if(filtered !== editBox.string)
            editBox.string = filtered;

        this.refreshRegisterInputArt(key);

        if(!this._registerSubmitting)
            this.showRegisterStatus("请完整填写注册资料",false);
    }

    private refreshRegisterInputArt(key:string)
    {
        let editBox = this._registerInputs[key];
        if(editBox == null)
            return;
        let rowSprite = editBox.node.parent.getComponent(cc.Sprite);
        if(rowSprite != null)
            rowSprite.enabled = this._registerInputEditing[key] || editBox.string.length > 0;
    }

    private initResetUI()
    {
        this._resetPanel = this.node.getChildByName("重置密码弹窗");
        this._resetDialog = Tool.GetChild(this._resetPanel,"重置资料框");
        let rows:{[key:string]:string} = {
            "loginName":"账号",
            "password":"新密码",
            "confirmPassword":"确认密码",
            "tradePassword":"交易密码"
        };
        for(let key in rows)
        {
            let editBox = Tool.GetChild(this._resetDialog,rows[key]+"/输入").getComponent(cc.EditBox);
            this._resetInputs[key] = editBox;
            this._resetInputEditing[key] = false;
            this.bindResetPlaceholder(key,editBox);
        }
        this._resetPanel.active = false;
    }

    // Prefab 内的占位文字由 EditBox 自身接管，颜色在这里保留（新密码行为红色警示）。
    private bindResetPlaceholder(key:string,editBox:cc.EditBox)
    {
        let label = editBox.placeholderLabel;
        if(label == null)
            return;
        let color = label.node.color.clone();
        this._resetColoredPlaceholders[key] = color;
        editBox.placeholder = label.string;
        editBox.placeholderFontSize = label.fontSize;
        label.node.color = color;
    }

    private openResetPanel()
    {
        this._resetSubmitting = false;
        for(let key in this._resetInputs)
        {
            this._resetInputs[key].string = "";
            this.bindResetPlaceholder(key,this._resetInputs[key]);
        }
        this._resetPanel.active = true;
        this._resetDialog.stopAllActions();
        this._resetDialog.opacity = 0;
        this._resetDialog.scale = 0.96;
        cc.tween(this._resetDialog).to(0.18,{opacity:255,scale:1},{easing:"backOut"}).start();
    }

    private closeResetPanel()
    {
        if(this._resetRequest != null)
        {
            this._resetRequest.abort();
            this._resetRequest = null;
        }
        for(let key in this._resetInputs)
        {
            this._resetInputs[key].blur();
            if(key !== "loginName")
                this._resetInputs[key].string = "";
        }
        this._resetSubmitting = false;
        this._resetPanel.active = false;
    }

    private onResetSubmit()
    {
        if(this._resetSubmitting)
            return;
        let strAccount = this._resetInputs["loginName"].string.trim();
        let strPassword = this._resetInputs["password"].string;
        let strConfirm = this._resetInputs["confirmPassword"].string;
        let strTrade = this._resetInputs["tradePassword"].string;
        if(strAccount.length < 1)
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入账号");
            return;
        }
        if(strPassword.length < 6 || strPassword.length > 32 || strPassword.trim().length != strPassword.length)
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"新密码需为6-32位，首尾不能有空格");
            return;
        }
        if(strPassword !== strConfirm)
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"两次输入的密码不一致");
            return;
        }
        if(strTrade.length < 1)
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入交易密码");
            return;
        }
        for(let key in this._resetInputs)
            this._resetInputs[key].blur();
        this._resetSubmitting = true;
        this.requestResetPassword({
            loginName:strAccount,
            password:strPassword,
            confirmPassword:strConfirm,
            tradePassword:strTrade
        });
    }

    // 登录前自助改密：POST /api/game/change-login-password，身份核验只依赖交易密码。
    private requestResetPassword(params:{[key:string]:string})
    {
        let request = new XMLHttpRequest();
        let completed = false;
        this._resetRequest = request;
        let finish = (message:string,ok:boolean)=>{
            if(completed)
                return;
            completed = true;
            this._resetRequest = null;
            this._resetSubmitting = false;
            if(ok)
            {
                this.closeResetPanel();
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,message);
                return;
            }
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,message);
        };
        request.onreadystatechange = ()=>{
            if(request.readyState !== 4)
                return;
            let payload:any = null;
            try{ payload = JSON.parse(request.responseText); }catch(e){ payload = null; }
            if(payload == null)
            {
                finish("无法连接服务器，请检查网络后重试",false);
                return;
            }
            // 与后台统一使用 ok/data 信封
            if(payload.ok === true)
            {
                finish("登录密码修改成功，请使用新密码登录",true);
                return;
            }
            let message:string = payload.error != null && payload.error.message != null ? payload.error.message : "";
            if(message === "") message = "修改失败，请稍后再试";
            finish(message,false);
        };
        request.onerror = ()=>finish("无法连接服务器，请检查网络后重试",false);
        request.ontimeout = ()=>finish("请求超时，请稍后再试",false);
        request.open("POST",ConfigManager.getInstance().changeLoginPasswordUrl,true);
        request.timeout = 12000;
        request.setRequestHeader("Content-Type","application/json");
        request.send(JSON.stringify({
            account:params["loginName"],
            pay_pwd:params["tradePassword"],
            new_pwd:params["password"]
        }));
    }

    private openRegisterPanel()
    {
        this._registerSubmitting = false;
        this._registerAntiTheftToggle.isChecked = false;
        this._registerAvatarPicker.active = false;
        this.setRegisterAvatar(ImageManager.getInstance().RandomAvatarIndex());
        this.showRegisterStatus("请完整填写注册资料",false);
        for(let key in this._registerInputs)
            this.refreshRegisterInputArt(key);
        this._registerPanel.active = true;
        this._registerDialog.stopAllActions();
        this._registerDialog.opacity = 0;
        this._registerDialog.scale = 0.96;
        cc.tween(this._registerDialog).to(0.18,{opacity:255,scale:1},{easing:"backOut"}).start();
    }

    private closeRegisterPanel()
    {
        if(this._registerRequest != null)
        {
            this._registerRequest.abort();
            this._registerRequest = null;
        }
        for(let key in this._registerInputs)
        {
            this._registerInputs[key].blur();
            if(key === "password" || key === "confirmPassword")
                this._registerInputs[key].string = "";
        }
        this._registerSubmitting = false;
        this._registerAntiTheftToggle.isChecked = false;
        this._registerAvatarPicker.active = false;
        this._registerPanel.active = false;
    }

    private onRegisterSubmit()
    {
        if(this._registerSubmitting)
            return;

        this.blurRegisterInputs();
        let data:RegisterFormData = {
            invitationCode:this._registerInputs["invitationCode"].string.trim(),
            nickname:this._registerInputs["nickname"].string.trim(),
            loginName:this._registerInputs["loginName"].string.trim(),
            password:this._registerInputs["password"].string,
            confirmPassword:this._registerInputs["confirmPassword"].string,
            avatarIndex:this._registerAvatarIndex,
            antiTheftEnabled:this._registerAntiTheftToggle.isChecked
        };

        if(!/^\d{6}$/.test(data.invitationCode))
        {
            this.showRegisterError("邀请码必须是6位数字",this._registerInputs["invitationCode"]);
            return;
        }
        if(data.nickname.length < 1 || data.nickname.length > 32)
        {
            this.showRegisterError("昵称需为1–32个字符",this._registerInputs["nickname"]);
            return;
        }
        if(!/^[A-Za-z0-9\u3400-\u4DBF\u4E00-\u9FFF]+$/.test(data.nickname))
        {
            this.showRegisterError("昵称只能使用中文、英文字母或数字",this._registerInputs["nickname"]);
            return;
        }
        if(!/^[A-Za-z0-9]{6,16}$/.test(data.loginName))
        {
            this.showRegisterError("登录账号必须是6–16位英文字母或数字",this._registerInputs["loginName"]);
            return;
        }
        if(data.password.length < 6 || data.password.length > 32 || data.password.trim() !== data.password)
        {
            this.showRegisterError("密码需为6–32位，首尾不能有空格",this._registerInputs["password"]);
            return;
        }
        if(data.password !== data.confirmPassword)
        {
            this.showRegisterError("两次输入的密码不一致",this._registerInputs["confirmPassword"]);
            return;
        }

        if(!data.antiTheftEnabled)
        {
            this.requestRegister(data);
            return;
        }

        this._registerSubmitting = true;
        this.showRegisterStatus("正在检查当前设备…",true);
        DeviceIdentityManager.getInstance().prepare().then((identity)=>{
            if(!this._registerPanel.active)
                return;
            if(!identity.available || !identity.persistent)
            {
                this._registerSubmitting = false;
                this._registerAntiTheftToggle.isChecked = false;
                let message = identity.message || "当前设备无法稳定保存设备标识，不能开启防盗号";
                this.showRegisterStatus(message,true);
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,message);
                return;
            }
            data.deviceId = identity.deviceId;
            data.devicePlatform = identity.platform;
            data.deviceVersion = identity.version;
            let submit = ()=>{
                if(!this._registerPanel.active)
                    return;
                this.requestRegister(data);
            };
            if(identity.platform === "web")
            {
                let warning = "开启防盗号后，账号将绑定当前浏览器。清除网站数据、更换浏览器或更换访问地址后将无法直接登录，需要联系客服解绑。确认继续注册吗？";
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,warning,[(confirmed:boolean)=>{
                    if(confirmed)
                    {
                        submit();
                        return;
                    }
                    this._registerSubmitting = false;
                    this._registerAntiTheftToggle.isChecked = false;
                    this.showRegisterStatus("已取消开启防盗号",false);
                }]);
                return;
            }
            submit();
        });
    }

    private showRegisterError(message:string,editBox:cc.EditBox)
    {
        this.showRegisterStatus(message,true);
        if(editBox != null)
            editBox.blur();
        UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,message);
    }

    private blurRegisterInputs()
    {
        for(let key in this._registerInputs)
            this._registerInputs[key].blur();
    }

    private showRegisterStatus(message:string,isHighlight:boolean)
    {
        this._registerStatus.string = message;
        this._registerStatus.node.color = isHighlight ? new cc.Color(249,226,181,255) : new cc.Color(236,202,149,255);
        let useApprovedDefault = message === "请完整填写注册资料" && !isHighlight;
        this._registerStatus.node.active = !useApprovedDefault;
        if(this._registerStatusBackground != null)
            this._registerStatusBackground.active = !useApprovedDefault;
        if(this._registerStatusIcon != null)
            this._registerStatusIcon.active = !useApprovedDefault;
    }

    private requestRegister(data:RegisterFormData)
    {
        this._registerSubmitting = true;
        this.showRegisterStatus("正在提交注册资料…",true);

        let request = new XMLHttpRequest();
        let completed = false;
        this._registerRequest = request;

        let finish = (networkError:boolean = false)=>{
            if(completed)
                return;
            completed = true;
            this._registerRequest = null;
            this._registerSubmitting = false;

            let response:RegistrationResponse = null;
            if(!networkError && request.responseText != null && request.responseText !== "")
            {
                try
                {
                    response = JSON.parse(request.responseText);
                }
                catch(error)
                {
                    response = null;
                }
            }

            if(!networkError && request.status === 201 && response != null && response.ok)
            {
                let message = response.data != null && response.data.message != null ? response.data.message : "注册成功，请使用登录账号和密码进入游戏";
                this._loginUserName = data.loginName;
                cc.sys.localStorage.setItem("registrationAvatar_" + data.loginName,data.avatarIndex);
                this.node.getChildByName("手机号").getComponent(cc.EditBox).string = data.loginName;
                this.node.getChildByName("密码").getComponent(cc.EditBox).string = "";
                this.refreshLoginInputArt("手机号");
                this.refreshLoginInputArt("密码");
                this.closeRegisterPanel();
                UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,message);
                return;
            }

            let errorMessage = "注册失败，请稍后再试";
            if(networkError || request.status === 0)
                errorMessage = "无法连接注册服务器，请检查网络后重试";
            else if(response != null && response.error != null && response.error.message != null)
                errorMessage = response.error.message;
            this.showRegisterStatus(errorMessage,true);
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,errorMessage);
        };

        request.onreadystatechange = ()=>{
            if(request.readyState === 4)
                finish(false);
        };
        request.onerror = ()=>finish(true);
        request.ontimeout = ()=>finish(true);
        request.open("POST",ConfigManager.getInstance().registrationUrl,true);
        request.timeout = 12000;
        request.setRequestHeader("Content-Type","application/json");
        request.send(JSON.stringify({
            invitationCode:data.invitationCode,
            nickname:data.nickname,
            loginName:data.loginName,
            password:data.password,
            avatarIndex:data.avatarIndex,
            antiTheftEnabled:data.antiTheftEnabled,
            deviceId:data.antiTheftEnabled ? data.deviceId : undefined,
            devicePlatform:data.antiTheftEnabled ? data.devicePlatform : undefined,
            deviceVersion:data.antiTheftEnabled ? data.deviceVersion : undefined
        }));
    }

    onToggleClick(toggle:cc.Toggle)
    {
        if(toggle.node.name !== "防盗号开关")
            return;
        if(this._registerSubmitting)
            return;
        this.showRegisterStatus(toggle.isChecked ? "已选择绑定当前设备，注册后仅本机可登录" : "防盗号默认关闭，可注册后在设置中开启",false);
    }



    //登陆成功！
    onLoginSuccessfully()
    {
        UIManager.getInstance().showPanel("panelMain",ShowPanelMode.CloseOther,"登陆");
    }
    

    onButtonClick(button:cc.Button)
    {
        if(button.node.name === "登陆")
        {
            if(cc.sys.os == cc.sys.OS_IOS || cc.sys.os == cc.sys.OS_ANDROID)
            {
                //检测本地是否存在账号记录                
                if(this._loginUserName === null)
                {
                    MobileManager.getInstance().wxLogin();
                }
                else //直接登陆
                {
                    Debug.Log("发现缓存账号："+this._loginUserName);
                    this.onLoginSystem();
                }
                
            }
            else//其他平台直接账号登陆
            {
                console.log("非移动平台，直接登陆！");
                Debug.Log("当前模式:"+ Tool.GetConfigString("登陆模式","外网"));
                this.onLoginSystem();
            }

        }
        else if(button.node.name === "注册账号")
        {
            this.openRegisterPanel();
        }
        else if(button.node.name === "关闭注册")
        {
            this.closeRegisterPanel();
        }
        else if(button.node.name === "确认注册")
        {
            this.onRegisterSubmit();
        }
        else if(button.node.name === "头像预览")
        {
            this.openRegisterAvatarPicker();
        }
        else if(button.node.name === "上一头像")
        {
            this.stepRegisterAvatar(-1);
        }
        else if(button.node.name === "下一头像")
        {
            this.stepRegisterAvatar(1);
        }
        else if(button.node.name === "关闭头像选择")
        {
            this.closeRegisterAvatarPicker();
        }
        else if(button.node.name === "换一批头像")
        {
            this.refreshRegisterAvatarBatch();
        }
        else if(button.node.name.indexOf("头像选项") === 0)
        {
            let avatarIndex = this._registerAvatarBySlot[button.node.name];
            if(ImageManager.getInstance().IsAvatarIndex(avatarIndex))
            {
                this.setRegisterAvatar(avatarIndex);
                this.closeRegisterAvatarPicker();
            }
        }
        else if(button.node.name === "内网" && cc.sys.isBrowser)
        {
            Debug.Log("进入内网");
            cc.sys.localStorage.setItem("登陆模式","内网");
            GameDataManager.getInstance().initKBE();
            cc.game.restart();
        }
        else if(button.node.name === "外网" && cc.sys.isBrowser)
        {
            Debug.Log("进入外网");
            cc.sys.localStorage.setItem("登陆模式","外网");
            GameDataManager.getInstance().initKBE();
            cc.game.restart();
        }
        else if(button.node.name === "关闭上层")
        {
            button.node.parent.active = false;
        }
        else if(button.node.name === "关闭上上层")
        {
            button.node.parent.parent.active = false;
        }
        else if(button.node.name === "忘记密码")
        {
            this.openResetPanel();
        }
        else if(button.node.name === "关闭重置")
        {
            this.closeResetPanel();
        }
        else if(button.node.name === "确认修改")
        {
            this.onResetSubmit();
        }
        else if(button.node.name === "获取验证码")
        {
            // let strPhone =Tool.GetChild(this.node,"修改密码/列表/账号/手机号").getComponent(cc.EditBox).string;
            // if(strPhone.length != 11)
            // {
            //     UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入正确的手机号!");
            //     return;
            // }
            // this.strLastMMSMask = Tool.SendMMS(strPhone);
            // Tool.GetChild(this.node,"修改密码/列表/验证码/time").active = true;
            // Tool.GetChild(this.node,"修改密码/列表/验证码/获取验证码").active = false;
            // let nCount = 20;
            // this.schedule(()=>{
            //     Tool.GetChild(this.node,"修改密码/列表/验证码/time").getComponent(cc.Label).string = (nCount--).toString();
            //     if(nCount==0)
            //     {
            //         Tool.GetChild(this.node,"修改密码/列表/验证码/time").active = false;
            //         Tool.GetChild(this.node,"修改密码/列表/验证码/获取验证码").active = true; 
            //     }
            // },1,nCount,0.1);
        }
        else if(button.node.name === "清除用户" || button.node.name === "清除密码")
        {
            button.node.parent.getComponent(cc.EditBox).string = ""
            this.refreshLoginInputArt(button.node.parent.name);
        }
    }
    //登陆游戏
    onLoginSystem()
    {
        let strID = this.node.getChildByName("手机号").getComponent(cc.EditBox).string;
        let strPass = this.node.getChildByName("密码").getComponent(cc.EditBox).string;

        if(strID.length<1)
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入正确的账号");
            return;
        }
        if(strPass == "")
        {
            UIManager.getInstance().showPanel("panelMsgView",ShowPanelMode.Cover,"请输入密码");
            return;
        }

        cc.sys.localStorage.setItem("unionid",strID);
        cc.sys.localStorage.setItem("pass",strPass);

        GameDataManager.getInstance().loginGame(strID,strPass,"登陆")
    }
    OnEndTest()
    {
        console.log("进入end");
    }
}
