#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_SOURCE_DIR = path.join(PROJECT_ROOT, 'build', 'web-mobile');
const CONFIG_PATH = path.join(__dirname, 'web_image_protection.json');
const LOADER_TEMPLATE_PATH = path.join(__dirname, 'web_image_loader.template.js');
const REPORT_NAME = 'web-image-protection.json';
const LOADER_PREFIX = 'qing-web-image-loader.';
const LOADER_SUFFIX = '.js';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const NONCE_CONTEXT = Buffer.from('QING_WEB_IMAGE_NONCE_V1\0', 'utf8');

function fail(message) {
    throw new Error(message);
}

function parseArgs(argv) {
    let sourceDir = DEFAULT_SOURCE_DIR;
    let verifyOnly = false;
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--source-dir') {
            if (i + 1 >= argv.length) fail('--source-dir 缺少目录参数');
            sourceDir = path.resolve(argv[++i]);
        }
        else if (arg === '--verify-only') {
            verifyOnly = true;
        }
        else if (arg === '--help' || arg === '-h') {
            console.log('用法: node tools/protect_web_images.js [--source-dir build/web-mobile] [--verify-only]');
            process.exit(0);
        }
        else {
            fail('未知参数: ' + arg);
        }
    }
    return { sourceDir, verifyOnly };
}

function readConfig() {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!config || config.format !== 'QIMG2GCM') fail('图片保护配置的format必须为QIMG2GCM');
    const key = Buffer.from(String(config.keyBase64 || ''), 'base64');
    if (key.length !== 32) fail('图片保护密钥必须是32字节AES-256密钥');
    const magic = Buffer.from(config.format, 'ascii');
    if (magic.length !== 8) fail('图片保护格式标记必须是8字节ASCII');
    const keyId = crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
    return { config, key, magic, keyId };
}

function walkFiles(rootDir) {
    const result = [];
    function walk(current) {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isSymbolicLink()) fail('网页版构建中不允许符号链接: ' + fullPath);
            if (entry.isDirectory()) walk(fullPath);
            else if (entry.isFile()) result.push(fullPath);
        }
    }
    walk(rootDir);
    return result.sort();
}

function isImagePath(filePath) {
    return /\.(png|jpe?g)$/i.test(filePath);
}

function relativePosix(rootDir, filePath) {
    return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function isTargetImage(rootDir, filePath) {
    const relative = relativePosix(rootDir, filePath);
    return isImagePath(relative) && /^assets\/[^/]+\/native\//.test(relative);
}

function isPng(data) {
    return data.length >= PNG_SIGNATURE.length && data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function isJpeg(data) {
    return data.length >= JPEG_SIGNATURE.length && data.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE);
}

function isStandardImage(data) {
    return isPng(data) || isJpeg(data);
}

function expectedSignatureMatches(filePath, data) {
    return /\.png$/i.test(filePath) ? isPng(data) : isJpeg(data);
}

function isProtected(data, magic) {
    return data.length > magic.length && data.subarray(0, magic.length).equals(magic);
}

function deriveNonce(relativePath, plainData) {
    const plainHash = crypto.createHash('sha256').update(plainData).digest();
    return crypto.createHash('sha256')
        .update(NONCE_CONTEXT)
        .update(Buffer.from(relativePath, 'utf8'))
        .update(Buffer.from([0]))
        .update(plainHash)
        .digest()
        .subarray(0, 12);
}

function encryptImage(relativePath, plainData, key, magic) {
    const nonce = deriveNonce(relativePath, plainData);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    const encrypted = Buffer.concat([cipher.update(plainData), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([magic, nonce, encrypted, tag]);
}

function decryptImage(protectedData, key, magic) {
    const headerLength = magic.length + 12;
    if (!isProtected(protectedData, magic) || protectedData.length <= headerLength + 16) {
        fail('受保护图片长度或文件头不正确');
    }
    const nonce = protectedData.subarray(magic.length, headerLength);
    const tag = protectedData.subarray(protectedData.length - 16);
    const encrypted = protectedData.subarray(headerLength, protectedData.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function atomicWrite(filePath, data) {
    const tempPath = filePath + '.qing-image-protection-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
    try {
        fs.writeFileSync(tempPath, data, { mode: 0o644 });
        fs.renameSync(tempPath, filePath);
    }
    finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
}

function renderLoader(sourceDir, keyBase64, keyId) {
    const template = fs.readFileSync(LOADER_TEMPLATE_PATH, 'utf8');
    const keyToken = '__QING_WEB_IMAGE_KEY_BASE64__';
    const idToken = '__QING_WEB_IMAGE_KEY_ID__';
    if ((template.split(keyToken).length - 1) !== 1 || (template.split(idToken).length - 1) !== 1) {
        fail('网页图片加载器模板占位符数量不正确');
    }
    const rendered = template.replace(keyToken, keyBase64).replace(idToken, keyId);
    const hash = crypto.createHash('sha256').update(rendered).digest('hex').slice(0, 10);
    const loaderName = LOADER_PREFIX + hash + LOADER_SUFFIX;

    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.startsWith(LOADER_PREFIX) && entry.name.endsWith(LOADER_SUFFIX) && entry.name !== loaderName) {
            fs.unlinkSync(path.join(sourceDir, entry.name));
        }
    }
    atomicWrite(path.join(sourceDir, loaderName), Buffer.from(rendered, 'utf8'));
    return loaderName;
}

function injectLoader(sourceDir, loaderName) {
    const indexPath = path.join(sourceDir, 'index.html');
    if (!fs.existsSync(indexPath)) fail('网页版构建缺少index.html: ' + indexPath);
    let html = fs.readFileSync(indexPath, 'utf8');
    html = html.replace(/^\s*<script\s+src=["']qing-web-image-loader\.[^"']+\.js["'][^>]*><\/script>\s*$/gim, '');
    const mainScriptPattern = /(<script\s+src=["']main(?:\.[^"']+)?\.js["'][^>]*><\/script>)/i;
    if (!mainScriptPattern.test(html)) fail('index.html中找不到main.js脚本，无法注入图片加载器');
    html = html.replace(mainScriptPattern, '$1\n<script src="' + loaderName + '" charset="utf-8"></script>');
    atomicWrite(indexPath, Buffer.from(html, 'utf8'));
}

function scanAndProtect(sourceDir, options) {
    const assetRoot = path.join(sourceDir, 'assets');
    if (!fs.existsSync(assetRoot) || !fs.statSync(assetRoot).isDirectory()) {
        fail('网页版构建缺少assets目录: ' + assetRoot);
    }

    const targets = walkFiles(assetRoot).filter((filePath) => isTargetImage(sourceDir, filePath));
    if (targets.length === 0) fail('没有找到需要保护的网页图片');

    let encryptedNow = 0;
    let protectedCount = 0;
    let plainCount = 0;
    let originalBytes = 0;
    let protectedBytes = 0;

    for (const filePath of targets) {
        const relative = relativePosix(sourceDir, filePath);
        let data = fs.readFileSync(filePath);

        if (isProtected(data, options.magic)) {
            let plain;
            try {
                plain = decryptImage(data, options.key, options.magic);
            }
            catch (error) {
                fail('图片密文无法使用当前密钥解密: ' + relative + ' (' + error.message + ')');
            }
            if (!expectedSignatureMatches(filePath, plain)) {
                fail('图片密文解密结果与扩展名不匹配: ' + relative);
            }
            originalBytes += plain.length;
            protectedBytes += data.length;
            protectedCount++;
            continue;
        }

        if (!isStandardImage(data) || !expectedSignatureMatches(filePath, data)) {
            fail('图片既不是标准PNG/JPEG也不是受支持密文: ' + relative);
        }
        plainCount++;
        originalBytes += data.length;

        if (options.verifyOnly) {
            continue;
        }

        const encrypted = encryptImage(relative, data, options.key, options.magic);
        const roundTrip = decryptImage(encrypted, options.key, options.magic);
        if (!roundTrip.equals(data)) fail('图片加密往返校验失败: ' + relative);
        atomicWrite(filePath, encrypted);
        data = encrypted;
        encryptedNow++;
        protectedCount++;
        protectedBytes += data.length;
    }

    return { targets, encryptedNow, protectedCount, plainCount, originalBytes, protectedBytes };
}

function verifyLoader(sourceDir, keyId) {
    const indexPath = path.join(sourceDir, 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    const loaderMatches = Array.from(html.matchAll(/<script\s+src=["'](qing-web-image-loader\.[^"']+\.js)["'][^>]*><\/script>/gi));
    if (loaderMatches.length !== 1) fail('index.html必须且只能引用一个网页图片加载器');
    const mainIndex = html.search(/<script\s+src=["']main(?:\.[^"']+)?\.js["']/i);
    const loaderIndex = html.indexOf(loaderMatches[0][0]);
    if (mainIndex < 0 || loaderIndex <= mainIndex) fail('网页图片加载器必须在main.js之后执行');
    const loaderPath = path.join(sourceDir, loaderMatches[0][1]);
    if (!fs.existsSync(loaderPath)) fail('index.html引用的网页图片加载器不存在: ' + loaderMatches[0][1]);
    const loaderText = fs.readFileSync(loaderPath, 'utf8');
    if (!loaderText.includes('QING_WEB_IMAGE_PROTECTION_LOADER_V1') || !loaderText.includes("var KEY_ID = '" + keyId + "'")) {
        fail('网页图片加载器版本或密钥标识不匹配');
    }
    return loaderMatches[0][1];
}

function writeReport(sourceDir, config, stats, loaderName) {
    const report = {
        format: config.config.format,
        keyId: config.keyId,
        loader: loaderName,
        protectedImages: stats.protectedCount,
        plainImages: 0,
        originalBytes: stats.originalBytes,
        protectedBytes: stats.protectedBytes
    };
    atomicWrite(path.join(sourceDir, REPORT_NAME), Buffer.from(JSON.stringify(report, null, 2) + '\n', 'utf8'));
}

function verifyReport(sourceDir, config, stats, loaderName) {
    const reportPath = path.join(sourceDir, REPORT_NAME);
    if (!fs.existsSync(reportPath)) fail('网页版构建缺少图片保护报告: ' + REPORT_NAME);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (report.format !== config.config.format || report.keyId !== config.keyId || report.loader !== loaderName ||
        report.protectedImages !== stats.protectedCount || report.plainImages !== 0) {
        fail('网页图片保护报告与实际产物不一致');
    }
}

function main() {
    const args = parseArgs(process.argv);
    if (!fs.existsSync(args.sourceDir) || !fs.statSync(args.sourceDir).isDirectory()) {
        fail('网页版构建目录不存在: ' + args.sourceDir);
    }
    const config = readConfig();

    if (!args.verifyOnly) {
        const firstPass = scanAndProtect(args.sourceDir, { ...config, verifyOnly: false });
        const loaderName = renderLoader(args.sourceDir, config.config.keyBase64, config.keyId);
        injectLoader(args.sourceDir, loaderName);
        const verified = scanAndProtect(args.sourceDir, { ...config, verifyOnly: true });
        if (verified.plainCount !== 0 || verified.protectedCount !== verified.targets.length) {
            fail('网页图片保护后仍存在未加密图片');
        }
        writeReport(args.sourceDir, config, verified, loaderName);
        verifyLoader(args.sourceDir, config.keyId);
        verifyReport(args.sourceDir, config, verified, loaderName);
        console.log(
            'WEB_IMAGE_PROTECTION_OK protected=' + verified.protectedCount +
            ' encrypted_now=' + firstPass.encryptedNow +
            ' original_mb=' + (verified.originalBytes / 1024 / 1024).toFixed(2) +
            ' protected_mb=' + (verified.protectedBytes / 1024 / 1024).toFixed(2) +
            ' loader=' + loaderName +
            ' key_id=' + config.keyId
        );
        return;
    }

    const verified = scanAndProtect(args.sourceDir, { ...config, verifyOnly: true });
    if (verified.plainCount !== 0 || verified.protectedCount !== verified.targets.length) {
        fail('网页构建仍有' + verified.plainCount + '张未加密图片');
    }
    const loaderName = verifyLoader(args.sourceDir, config.keyId);
    verifyReport(args.sourceDir, config, verified, loaderName);
    console.log('WEB_IMAGE_PROTECTION_VERIFY_OK protected=' + verified.protectedCount + ' loader=' + loaderName);
}

try {
    main();
}
catch (error) {
    console.error('网页图片保护失败: ' + error.message);
    process.exit(1);
}
