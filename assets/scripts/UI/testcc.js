cc.Class({
        extends: cc.Component,
    
        properties: {
            camera: cc.Camera,
            _canvas: null,
            _callFunc:null,
        },
    
        init () {
            var node = new cc.Node();
            node.parent = cc.director.getScene();
            this.camera = node.addComponent(cc.Camera);
            node.anchorX = 0.5;
            node.anchorY = 0.5;
            node.x = cc.visibleRect.width/2;
            node.y = cc.visibleRect.height/2;
    
            var texture = new cc.RenderTexture();
            var gl = cc.game._renderContext;
            texture.initWithSize(cc.visibleRect.width, cc.visibleRect.height, gl.STENCIL_INDEX8);
            //this.camera.cullingMask = 0xffffffff;
            this.camera.targetTexture = texture;
            this.texture = texture;
            this._callFunc = null;
        },
            // create the img element
            initImage () {
                // return the type and dataUrl
                var dataURL = this._canvas.toDataURL("image/png");
                var img = document.createElement("img");
                img.src = dataURL;
                return img;
            },
            // create the canvas and context, filpY the image Data
            createSprite () {
                var width = this.texture.width;
                var height = this.texture.height;
                if (!this._canvas) {
                    this._canvas = document.createElement('canvas');
            
                    this._canvas.width = width;
                    this._canvas.height = height;
                }
                else {
                    this.clearCanvas();
                }
                var ctx = this._canvas.getContext('2d');
                this.camera.render();
                var data = this.texture.readPixels();
                // write the render data
                var rowBytes = width * 4; 
                for (var row = 0; row < height; row++) {
                    var srow = height - 1 - row;
                    var imageData = ctx.createImageData(width, 1);
                    var start = srow * width * 4;
                    for (var i = 0; i < rowBytes; i++) {
                        imageData.data[i] = data[start + i];
                    }
        
                    ctx.putImageData(imageData, 0, row);
                }
                return this._canvas;
            },
            // show on the canvas
            showSprite (img) {
                var texture = new cc.Texture2D();
                texture.initWithElement(img);
        
                var spriteFrame = new cc.SpriteFrame();
                spriteFrame.setTexture(texture);
        
                var node = new cc.Node();
                var sprite = node.addComponent(cc.Sprite);
                sprite.spriteFrame = spriteFrame;
        
                node.zIndex = cc.macro.MAX_ZINDEX;
                node.parent = cc.director.getScene();
                node.x = cc.winSize.width / 2;
                node.y = cc.winSize.height / 2;
                node.on(cc.Node.EventType.TOUCH_START, () => {
                    node.parent = null;
                    node.destroy();
                }); 
            },
        
            clearCanvas () {
                var ctx = this._canvas.getContext('2d');
                ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
            },
    
    
        //截屏到本地终端设备
        captureAndShow_native (strPngName, callFunc) {
            this._callFunc = callFunc;
            this.createSprite();
            var img = this.initImage();
            this.showSprite(img);
            this.saveFile_native(strPngName);
        },
    
        saveFile_native (strPngName) {
            if (CC_JSB) {
                var data = this.texture.readPixels();
                var width = this.texture.width;
                var height = this.texture.height;
                var picData = this.filpYImage_native(data, width, height);
    
                var filePath = jsb.fileUtils.getWritablePath() + strPngName;
    
                var success = jsb.saveImageData(picData, width, height, filePath)
                if (success) {
                    //cc.log("save image data success, file: " + filePath);
                     if (this._callFunc) {
                         this._callFunc(filePath);
                     }
                }
                else {
                    cc.error("save image data failed!");
                }
            }
            else {
                cc.log("saveImage, only supported on native platform.");
            }
        },
    
        // This is a temporary solution
        filpYImage_native (data, width, height) {
            // create the data array
            var picData = new Uint8Array(width * height * 4);
            var rowBytes = width * 4;
            for (var row = 0; row < height; row++) {
                var srow = height - 1 - row;
                var start = srow * width * 4;
                var reStart = row * width * 4;
                // save the piexls data
                for (var i = 0; i < rowBytes; i++) {
                    picData[reStart + i] = data[start + i];
                }
            }    
            return picData;
        },
    
        //浏览器 网页截屏
        captureAndShow_web () {
            this.createSprite();
            var img = this.initImage();
            this.showSprite(img);
            // download the pic as the file to your local
            //'Showing the capture'
            this.downloadFile_web('capture_to_web.png', img.src);
        },
    
        base64Img2Blob_web(code){
            var parts = code.split(';base64,');
            var contentType = parts[0].split(':')[1];
            var raw = window.atob(parts[1]);
            var rawLength = raw.length;
    
            var uInt8Array = new Uint8Array(rawLength);
    
            for (var i = 0; i < rawLength; ++i) {
              uInt8Array[i] = raw.charCodeAt(i);
            }
    
            return new Blob([uInt8Array], {type: contentType}); 
        },
    
        downloadFile_web (fileName, content){      
            var aLink = document.createElement('a');
            var blob = this.base64Img2Blob_web(content);
          
            var evt = document.createEvent("MouseEvents");
            evt.initEvent("click", false, false);
            aLink.download = fileName;
            aLink.href = URL.createObjectURL(blob);
     
            aLink.dispatchEvent(evt);
        },
    
        //微信小程序截屏
        captureAndShow_wechat () {
            var canvas = this.createSprite();
            var img = this.initImage();
            this.showSprite(img);
            this.saveFile_wechat(canvas);
        },
    
        saveFile_wechat (tempCanvas) {
            // This is one of the ways that could save the img to your local.
            if (cc.sys.platform === cc.sys.WECHAT_GAME) {
                var self = this;
                var data = {
                    x: 0,
                    y: 0,
                    width: canvas.width,
                    height: canvas.height,
                    // destination file sizes
                    destWidth: canvas.width,
                    destHeight: canvas.height,
                    fileType: 'png',
                    quality: 1
                }
                // https://developers.weixin.qq.com/minigame/dev/api/render/canvas/Canvas.toTempFilePathSync.html
                var _tempFilePath = tempCanvas.toTempFilePathSync(data);
                cc.log(`Capture file success!${_tempFilePath}`);
                cc.vv.Tool.ToastMakeText('图片加载完成，等待本地预览');
                // https://developers.weixin.qq.com/minigame/dev/api/media/image/wx.previewImage.html
                wx.previewImage({
                    urls: [_tempFilePath],
                    success: (res) => {
                        cc.log('Preview image success.');
                    }
                });
            }
        },
    });
