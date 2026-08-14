(function (global) {
    'use strict';

    // QING_WEB_IMAGE_PROTECTION_LOADER_V1
    // 该密钥最终必须在浏览器中使用，只用于阻止直接下载资源，不应视为服务端密钥。
    var FORMAT_MAGIC = 'QIMG2GCM';
    var KEY_BASE64 = '__QING_WEB_IMAGE_KEY_BASE64__';
    var KEY_ID = '__QING_WEB_IMAGE_KEY_ID__';
    var HEADER_LENGTH = 20;
    var TAG_LENGTH_BITS = 128;
    var keyPromise = null;

    function bytesFromAscii(text) {
        var result = new Uint8Array(text.length);
        for (var i = 0; i < text.length; i++) {
            result[i] = text.charCodeAt(i) & 0xff;
        }
        return result;
    }

    function bytesFromBase64(text) {
        var binary = global.atob(text);
        var result = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) {
            result[i] = binary.charCodeAt(i);
        }
        return result;
    }

    var MAGIC_BYTES = bytesFromAscii(FORMAT_MAGIC);
    var KEY_BYTES = bytesFromBase64(KEY_BASE64);

    function startsWith(bytes, prefix) {
        if (!bytes || bytes.length < prefix.length) {
            return false;
        }
        for (var i = 0; i < prefix.length; i++) {
            if (bytes[i] !== prefix[i]) {
                return false;
            }
        }
        return true;
    }

    function isPng(bytes) {
        return bytes.length >= 8 &&
            bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
            bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
    }

    function isJpeg(bytes) {
        return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    }

    function cleanUrl(url) {
        return String(url || '').split('#')[0].split('?')[0].replace(/\\/g, '/');
    }

    function shouldHandle(url) {
        return /(?:^|\/)assets\/[^/]+\/native\//.test(cleanUrl(url));
    }

    function protectedRequestUrl(url) {
        var separator = String(url).indexOf('?') >= 0 ? '&' : '?';
        return String(url) + separator + 'qimg=' + encodeURIComponent(FORMAT_MAGIC + '-' + KEY_ID);
    }

    function mimeForUrl(url) {
        return /\.jpe?g$/i.test(cleanUrl(url)) ? 'image/jpeg' : 'image/png';
    }

    function normalDomImage(url, onComplete) {
        var image = new Image();
        if (global.location && global.location.protocol !== 'file:') {
            image.crossOrigin = 'anonymous';
        }

        function cleanup() {
            image.removeEventListener('load', onLoad);
            image.removeEventListener('error', onError);
        }

        function onLoad() {
            cleanup();
            onComplete(null, image);
        }

        function onError() {
            cleanup();
            onComplete(new Error('[WebImageProtection] 图片加载失败: ' + url));
        }

        image.addEventListener('load', onLoad);
        image.addEventListener('error', onError);
        image.src = url;
        return image;
    }

    function blobImage(bytes, mime, url, onComplete) {
        var blob;
        var objectUrl;
        try {
            blob = new Blob([bytes], { type: mime });
            objectUrl = global.URL.createObjectURL(blob);
        }
        catch (error) {
            onComplete(new Error('[WebImageProtection] 无法创建图片数据: ' + url + ' (' + error.message + ')'));
            return null;
        }

        var image = new Image();

        function cleanup() {
            image.removeEventListener('load', onLoad);
            image.removeEventListener('error', onError);
            global.URL.revokeObjectURL(objectUrl);
            blob = null;
        }

        function onLoad() {
            cleanup();
            onComplete(null, image);
        }

        function onError() {
            cleanup();
            onComplete(new Error('[WebImageProtection] 解密后的图片无法解码: ' + url));
        }

        image.addEventListener('load', onLoad);
        image.addEventListener('error', onError);
        image.src = objectUrl;
        return image;
    }

    function downloadArrayBuffer(url, options, onComplete) {
        var xhr = new XMLHttpRequest();
        var completed = false;

        function finish(error, response) {
            if (completed) {
                return;
            }
            completed = true;
            onComplete(error, response);
        }

        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        if (options && options.withCredentials !== undefined) {
            xhr.withCredentials = options.withCredentials;
        }
        if (options && options.timeout !== undefined) {
            xhr.timeout = options.timeout;
        }
        if (options && options.header) {
            for (var header in options.header) {
                if (Object.prototype.hasOwnProperty.call(options.header, header)) {
                    xhr.setRequestHeader(header, options.header[header]);
                }
            }
        }
        if (options && typeof options.onFileProgress === 'function') {
            xhr.onprogress = function (event) {
                if (event.lengthComputable) {
                    options.onFileProgress(event.loaded, event.total);
                }
            };
        }
        xhr.onload = function () {
            if ((xhr.status >= 200 && xhr.status < 300) || (xhr.status === 0 && xhr.response)) {
                finish(null, xhr.response);
            }
            else {
                finish(new Error('[WebImageProtection] 下载失败: ' + url + '，状态码 ' + xhr.status));
            }
        };
        xhr.onerror = function () {
            finish(new Error('[WebImageProtection] 下载失败: ' + url));
        };
        xhr.ontimeout = function () {
            finish(new Error('[WebImageProtection] 下载超时: ' + url));
        };
        xhr.onabort = function () {
            finish(new Error('[WebImageProtection] 下载已取消: ' + url));
        };
        xhr.send(null);
        return xhr;
    }

    function importKey() {
        if (!global.crypto || !global.crypto.subtle) {
            return Promise.reject(new Error('当前浏览器不支持Web Crypto'));
        }
        if (!keyPromise) {
            keyPromise = global.crypto.subtle.importKey(
                'raw',
                KEY_BYTES,
                { name: 'AES-GCM' },
                false,
                ['decrypt']
            );
        }
        return keyPromise;
    }

    function decrypt(bytes) {
        if (bytes.length <= HEADER_LENGTH + 16 || !startsWith(bytes, MAGIC_BYTES)) {
            return Promise.reject(new Error('图片密文格式不正确'));
        }
        var nonce = bytes.slice(MAGIC_BYTES.length, HEADER_LENGTH);
        var encrypted = bytes.slice(HEADER_LENGTH);
        return importKey().then(function (key) {
            return global.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: nonce, tagLength: TAG_LENGTH_BITS },
                key,
                encrypted
            );
        }).then(function (plainBuffer) {
            return new Uint8Array(plainBuffer);
        });
    }

    function isAppleMobileWeb() {
        var ua = global.navigator ? global.navigator.userAgent || '' : '';
        var platform = global.navigator ? global.navigator.platform || '' : '';
        var touchPoints = global.navigator ? global.navigator.maxTouchPoints || 0 : 0;
        return /iPad|iPhone|iPod/i.test(ua) || (platform === 'MacIntel' && touchPoints > 1);
    }

    function install() {
        if (!global.cc || !cc.assetManager || !cc.assetManager.downloader) {
            throw new Error('[WebImageProtection] Cocos资源管理器尚未初始化');
        }

        var downloader = cc.assetManager.downloader;
        if (downloader.__qingWebImageProtectionInstalled) {
            return;
        }

        var state = global.__QING_WEB_IMAGE_PROTECTION__ = {
            installed: true,
            format: FORMAT_MAGIC,
            keyId: KEY_ID,
            encryptedLoaded: 0,
            plainLoaded: 0,
            failed: 0
        };

        function protectedImageDownloader(url, options, onComplete) {
            if (!shouldHandle(url)) {
                return normalDomImage(url, onComplete);
            }

            // 首次从明文版本切换到密文时使用独立缓存键，避免浏览器复用旧的immutable明文响应。
            return downloadArrayBuffer(protectedRequestUrl(url), options || {}, function (downloadError, arrayBuffer) {
                if (downloadError) {
                    state.failed++;
                    onComplete(downloadError);
                    return;
                }

                var bytes = new Uint8Array(arrayBuffer);
                if (!startsWith(bytes, MAGIC_BYTES)) {
                    if (isPng(bytes) || isJpeg(bytes)) {
                        state.plainLoaded++;
                        blobImage(bytes, mimeForUrl(url), url, onComplete);
                    }
                    else {
                        state.failed++;
                        onComplete(new Error('[WebImageProtection] 图片既不是受保护资源也不是标准图片: ' + url));
                    }
                    return;
                }

                decrypt(bytes).then(function (plainBytes) {
                    var valid = mimeForUrl(url) === 'image/jpeg' ? isJpeg(plainBytes) : isPng(plainBytes);
                    if (!valid) {
                        throw new Error('解密结果与图片扩展名不匹配');
                    }
                    state.encryptedLoaded++;
                    blobImage(plainBytes, mimeForUrl(url), url, onComplete);
                    bytes = null;
                    arrayBuffer = null;
                }).catch(function (error) {
                    state.failed++;
                    onComplete(new Error('[WebImageProtection] 图片解密失败: ' + url + ' (' + error.message + ')'));
                });
            });
        }

        downloader.register({
            '.png': protectedImageDownloader,
            '.jpg': protectedImageDownloader,
            '.jpeg': protectedImageDownloader
        });

        // iPhone/iPad上限制首次并发，避免密文、明文和解码纹理同时占用过多内存。
        if (isAppleMobileWeb()) {
            downloader.maxConcurrency = Math.min(Number(downloader.maxConcurrency) || 4, 4);
            downloader.maxRequestsPerFrame = Math.min(Number(downloader.maxRequestsPerFrame) || 4, 4);
        }
    }

    var originalBoot = global.boot;
    if (typeof originalBoot !== 'function') {
        throw new Error('[WebImageProtection] 找不到window.boot，加载器注入位置不正确');
    }

    global.boot = function () {
        install();
        return originalBoot.apply(this, arguments);
    };
})(window);
