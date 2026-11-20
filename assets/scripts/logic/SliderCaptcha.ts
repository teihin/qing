import { REG_HOST } from "../common/GameDef";

/** 滑动验证通过后要回传给注册接口的字段，与服务端 gameRegistrationRequest 对应。 */
export interface CaptchaAnswer {
    captchaId: string;
    captchaOffset: number;
    captchaElapsed: number;
    captchaTrack: number[];
}

interface CaptchaPayload {
    captchaId: string;
    background: string;
    puzzle: string;
    puzzleY: number;
    expiresIn: number;
}

/**
 * 注册滑动验证（纯代码创建 UI，不依赖 Prefab）。
 *
 * 流程：拉一次性验证码 → 显示带缺口的背景与可拖动拼图 → 玩家拖动对位 →
 * 松手把偏移、耗时、轨迹一起回传，由服务端判定。
 *
 * 尺寸策略：面板按屏幕宽度自适应（左右各留 6%），图片按 2:1 等比缩放。
 * 服务端的答案基于原图 320×160 的像素坐标，所以位移都要除以显示缩放比
 * 还原成原图坐标再提交，否则屏幕一大就会被判偏移过大。
 */
export class SliderCaptcha {
    /** 与服务端 registration_captcha.go 的常量保持一致。 */
    private static readonly SOURCE_WIDTH = 320;
    private static readonly SOURCE_HEIGHT = 160;
    private static readonly SOURCE_PIECE = 50;
    private static readonly MAX_OFFSET = 320 - 50;

    private static readonly PANEL_MAX_WIDTH = 700;

    public static Show(parent: cc.Node, onDone: (answer: CaptchaAnswer | null) => void): void
    {
        if(parent == null)
        {
            onDone(null);
            return;
        }
        SliderCaptcha.LoadPayload((payload: CaptchaPayload) => {
            if(payload == null)
            {
                onDone(null);
                return;
            }
            SliderCaptcha.Build(parent,payload,onDone);
        });
    }

    private static LoadPayload(done: (payload: CaptchaPayload) => void): void
    {
        let request = new XMLHttpRequest();
        let finished = false;
        let finish = (payload: CaptchaPayload) => {
            if(finished)
                return;
            finished = true;
            done(payload);
        };
        request.onreadystatechange = () => {
            if(request.readyState !== 4)
                return;
            let payload: CaptchaPayload = null;
            try
            {
                let parsed = JSON.parse(request.responseText);
                if(parsed != null && parsed.ok && parsed.data != null)
                    payload = parsed.data;
            }
            catch(error)
            {
                payload = null;
            }
            finish(payload);
        };
        request.onerror = () => finish(null);
        request.ontimeout = () => finish(null);
        request.open("GET","http://" + REG_HOST + "/xuanmanager/api/game/registration-captcha",true);
        request.timeout = 10000;
        request.send();
    }

    private static Build(parent: cc.Node, payload: CaptchaPayload, onDone: (answer: CaptchaAnswer | null) => void): void
    {
        let winWidth = cc.winSize.width;
        let winHeight = cc.winSize.height;

        // 面板宽度：屏幕宽的 88%（左右各留 6%），上限 700；图片占面板内宽，按 2:1 定高
        let panelWidth = Math.min(winWidth * 0.88,SliderCaptcha.PANEL_MAX_WIDTH);
        let imageWidth = panelWidth - 48;
        let imageHeight = imageWidth / 2;
        // 原图 → 显示的缩放比，所有坐标换算都靠它
        let scale = imageWidth / SliderCaptcha.SOURCE_WIDTH;

        let titleBlock = 112;
        let trackHeight = 80;
        let panelHeight = imageHeight + titleBlock + 40 + trackHeight + 88;

        let mask = new cc.Node("滑动验证遮罩");
        mask.parent = parent;
        mask.setContentSize(winWidth,winHeight);
        mask.setPosition(0,0);
        let block = mask.addComponent(cc.BlockInputEvents);
        block.enabled = true;
        let maskGraphics = mask.addComponent(cc.Graphics);
        maskGraphics.fillColor = new cc.Color(0,0,0,190);
        maskGraphics.rect(-winWidth / 2,-winHeight / 2,winWidth,winHeight);
        maskGraphics.fill();
        mask.setSiblingIndex(parent.children.length - 1);

        let top = panelHeight / 2;

        let panel = new cc.Node("滑动验证面板");
        panel.parent = mask;
        panel.setContentSize(panelWidth,panelHeight);
        panel.setPosition(0,0);
        let panelGraphics = panel.addComponent(cc.Graphics);
        panelGraphics.fillColor = new cc.Color(246,247,250,255);
        panelGraphics.roundRect(-panelWidth / 2,-panelHeight / 2,panelWidth,panelHeight,16);
        panelGraphics.fill();

        SliderCaptcha.CreateLabel(panel,"安全验证","拖动下方滑块，把拼图块对准缺口",
            0,top - 54,28,"#2b2f36");

        // 图片区：锚点左上，子节点用「已缩放」的显示坐标
        let imageBox = new cc.Node("图片区");
        imageBox.parent = panel;
        imageBox.anchorX = 0;
        imageBox.anchorY = 1;
        imageBox.setContentSize(imageWidth,imageHeight);
        imageBox.setPosition(-imageWidth / 2,top - titleBlock);

        let pieceSize = SliderCaptcha.SOURCE_PIECE * scale;
        let pieceY = payload.puzzleY * scale;

        let backgroundNode = SliderCaptcha.CreateSpriteNode(imageBox,"背景图",imageWidth,imageHeight,0,0);
        let puzzleNode = SliderCaptcha.CreateSpriteNode(imageBox,"拼图块",pieceSize,pieceSize,0,-pieceY);
        SliderCaptcha.LoadBase64Sprite(backgroundNode,payload.background);
        SliderCaptcha.LoadBase64Sprite(puzzleNode,payload.puzzle);

        // 滑块区：滑块宽 = 拼图块宽、轨道宽 = 图片宽，
        // 这样滑块走满行程时拼图正好走到最右，两者严格同步。
        let travel = imageWidth - pieceSize;
        let thumbWidth = pieceSize;
        let trackWidth = imageWidth;
        let trackY = top - titleBlock - imageHeight - 52;

        let track = new cc.Node("滑块槽");
        track.parent = panel;
        track.setContentSize(trackWidth,trackHeight);
        track.setPosition(0,trackY);
        let trackGraphics = track.addComponent(cc.Graphics);
        trackGraphics.fillColor = new cc.Color(226,229,236,255);
        trackGraphics.roundRect(-trackWidth / 2,-trackHeight / 2,trackWidth,trackHeight,trackHeight / 2);
        trackGraphics.fill();

        let thumbH = trackHeight - 10;
        let thumb = new cc.Node("滑块");
        thumb.parent = track;
        thumb.anchorX = 0.5;
        thumb.anchorY = 0.5;
        thumb.setContentSize(thumbWidth,thumbH);
        thumb.setPosition(-travel / 2,0);
        let thumbGraphics = thumb.addComponent(cc.Graphics);
        thumbGraphics.fillColor = new cc.Color(64,150,255,255);
        thumbGraphics.roundRect(-thumbWidth / 2,-thumbH / 2,thumbWidth,thumbH,thumbH / 2);
        thumbGraphics.fill();
        SliderCaptcha.CreateLabel(thumb,"按住拖动","",0,0,24,"#ffffff");

        SliderCaptcha.CreateLabel(panel,"对准缺口后松手","",0,trackY - trackHeight / 2 - 32,18,"#8a9099");

        // 拖动状态：dragPx 是屏幕位移，提交前除以 scale 还原成原图坐标
        let dragging = false;
        let startTime = 0;
        let trackPoints: number[] = [];
        let dragPx = 0;
        let closed = false;

        let close = (answer: CaptchaAnswer | null) => {
            if(closed)
                return;
            closed = true;
            if(cc.isValid(mask))
                mask.destroy();
            onDone(answer);
        };

        mask.on(cc.Node.EventType.TOUCH_END,() => {
            if(dragging)
                return;
            close(null);
        });

        thumb.on(cc.Node.EventType.TOUCH_START,(event: cc.Event.EventTouch) => {
            event.propagationStopped = true;
            dragging = true;
            startTime = Date.now();
            trackPoints = [0];
        });

        thumb.on(cc.Node.EventType.TOUCH_MOVE,(event: cc.Event.EventTouch) => {
            event.propagationStopped = true;
            if(!dragging)
                return;
            dragPx = Math.max(0,Math.min(travel,dragPx + event.getDeltaX()));
            thumb.setPosition(-travel / 2 + dragPx,0);
            // 显示位置直接用 dragPx：拼图和滑块在同一套设计坐标里同步移动。
            // 只有提交给服务端的值才除以 scale 还原成原图像素。
            puzzleNode.setPosition(dragPx,-pieceY);
            let current = Math.round(dragPx / scale);
            if(trackPoints[trackPoints.length - 1] !== current)
                trackPoints.push(current);
        });

        thumb.on(cc.Node.EventType.TOUCH_END,(event: cc.Event.EventTouch) => {
            // 必须阻止冒泡：否则遮罩的 TOUCH_END 会先关闭面板，导致回调拿不到答案
            event.propagationStopped = true;
            if(!dragging)
                return;
            dragging = false;
            let elapsed = Date.now() - startTime;
            if(dragPx <= 0)
            {
                close(null);
                return;
            }
            let offset = Math.round(dragPx / scale);
            trackPoints.push(offset);
            close({
                captchaId: payload.captchaId,
                captchaOffset: offset,
                captchaElapsed: elapsed,
                captchaTrack: trackPoints
            });
        });

        thumb.on(cc.Node.EventType.TOUCH_CANCEL,(event: cc.Event.EventTouch) => {
            event.propagationStopped = true;
            dragging = false;
            close(null);
        });
    }

    private static CreateSpriteNode(parent: cc.Node, name: string,
        width: number, height: number, x: number, y: number): cc.Node
    {
        let node = new cc.Node(name);
        node.parent = parent;
        node.anchorX = 0;
        node.anchorY = 1;
        node.setContentSize(width,height);
        node.setPosition(x,y);
        let sprite = node.addComponent(cc.Sprite);
        sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        sprite.enabled = true;
        return node;
    }

    private static CreateLabel(parent: cc.Node, title: string, subtitle: string,
        x: number, y: number, fontSize: number, color: string): cc.Label
    {
        let node = new cc.Node("文字");
        node.parent = parent;
        node.setPosition(x,y);
        let label = node.addComponent(cc.Label);
        label.string = title;
        label.fontSize = fontSize;
        label.lineHeight = fontSize + 6;
        label.horizontalAlign = cc.Label.HorizontalAlign.CENTER;
        label.verticalAlign = cc.Label.VerticalAlign.CENTER;
        node.color = cc.color().fromHEX(color);
        if(subtitle !== "")
        {
            let sub = new cc.Node("说明");
            sub.parent = parent;
            sub.setPosition(x,y - fontSize - 16);
            let subLabel = sub.addComponent(cc.Label);
            subLabel.string = subtitle;
            subLabel.fontSize = Math.max(16,fontSize - 10);
            subLabel.lineHeight = fontSize;
            subLabel.horizontalAlign = cc.Label.HorizontalAlign.CENTER;
            sub.color = cc.color().fromHEX("#8a9099");
        }
        return label;
    }

    /** 把服务端返回的 base64 PNG 加载成 SpriteFrame；原生与网页都走 cc.loader。 */
    private static LoadBase64Sprite(node: cc.Node, base64: string): void
    {
        let sprite = node.getComponent(cc.Sprite);
        if(sprite == null || base64 == "")
            return;
        let url = "data:image/png;base64," + base64;
        cc.loader.load({url: url,type: "image"},(error: Error,texture: cc.Texture2D) => {
            if(error != null || texture == null || !cc.isValid(node) || !cc.isValid(sprite))
                return;
            sprite.spriteFrame = new cc.SpriteFrame(texture);
        });
    }
}
