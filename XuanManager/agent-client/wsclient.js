'use strict';

// 极简 WebSocket 客户端（替代 Node 内置的 WebSocket）。
//
// 为什么不用 Node 自带的：Node 22 的 undici 实现会按 RFC 严格校验握手，
// KBEngine 的 WS 入口回了未请求的 `Sec-WebSocket-Protocol: WebManagerSocket`，
// 浏览器/原生引擎都容忍，但 undici 直接判失败（onerror_before_onopen）。
// 这里自带一个浏览器兼容的最小实现，只做游戏服需要的事：
// 文本/二进制帧、分片、ping/pong、close，客户端帧按规范加掩码。
//
// 对外开放的接口与浏览器 WebSocket 一致（onopen/onmessage/onclose/onerror、
// binaryType、send、close、readyState），SDK 无感。

const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { URL } = require('url');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

class MiniWebSocket {
  constructor(url, protocols) {
    this.url = String(url);
    this.readyState = CONNECTING;
    this.binaryType = 'arraybuffer';
    this.protocol = '';
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;

    this._socket = null;
    this._buffer = Buffer.alloc(0);
    this._fragments = [];
    this._fragmentOpcode = 0;
    this._handshakeDone = false;

    const parsed = new URL(this.url);
    const secure = parsed.protocol === 'wss:';
    const options = {
      host: parsed.hostname,
      port: Number(parsed.port || (secure ? 443 : 80)),
    };
    const key = crypto.randomBytes(16).toString('base64');
    this._accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    const offered = Array.isArray(protocols) ? protocols : (protocols ? [protocols] : []);

    const request = [
      'GET ' + (parsed.pathname || '/') + (parsed.search || '') + ' HTTP/1.1',
      'Host: ' + parsed.host,
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: ' + key,
      'Sec-WebSocket-Version: 13',
    ];
    if (offered.length > 0) {
      request.push('Sec-WebSocket-Protocol: ' + offered.join(', '));
    }
    // 注意：不发 Sec-WebSocket-Extensions —— 游戏服不支持压缩扩展，发了反而要处理协商。
    const payload = request.join('\r\n') + '\r\n\r\n';

    const onConnect = () => {
      this._socket.write(payload);
    };
    this._socket = secure
      ? tls.connect({ ...options, servername: options.host }, onConnect)
      : net.connect(options, onConnect);

    this._socket.on('data', (chunk) => this._onData(chunk));
    this._socket.on('error', (error) => this._fail(error));
    this._socket.on('close', () => this._onSocketClose());
  }

  _onData(chunk) {
    this._buffer = this._buffer.length === 0 ? chunk : Buffer.concat([this._buffer, chunk]);
    if (!this._handshakeDone) {
      const end = this._buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const head = this._buffer.slice(0, end).toString('latin1');
      this._buffer = this._buffer.slice(end + 4);
      if (!/^HTTP\/1\.1 101/.test(head)) {
        this._fail(new Error('握手失败：' + head.split('\r\n')[0]));
        return;
      }
      const accept = /sec-websocket-accept:\s*(\S+)/i.exec(head);
      if (!accept || accept[1] !== this._accept) {
        this._fail(new Error('握手失败：Sec-WebSocket-Accept 不匹配'));
        return;
      }
      const protocol = /sec-websocket-protocol:\s*(\S+)/i.exec(head);
      this.protocol = protocol ? protocol[1] : '';
      this._handshakeDone = true;
      this.readyState = OPEN;
      if (this.onopen) this.onopen({ type: 'open', target: this });
    }
    this._parseFrames();
  }

  _parseFrames() {
    while (this._buffer.length >= 2) {
      const first = this._buffer[0];
      const second = this._buffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this._buffer.length < offset + 2) return;
        length = this._buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this._buffer.length < offset + 8) return;
        const high = this._buffer.readUInt32BE(offset);
        const low = this._buffer.readUInt32BE(offset + 4);
        length = high * 0x100000000 + low;
        offset += 8;
      }
      let mask = null;
      if (masked) {
        if (this._buffer.length < offset + 4) return;
        mask = this._buffer.slice(offset, offset + 4);
        offset += 4;
      }
      if (this._buffer.length < offset + length) return;
      let payload = this._buffer.slice(offset, offset + length);
      this._buffer = this._buffer.slice(offset + length);
      if (mask) {
        const copy = Buffer.from(payload);
        for (let index = 0; index < copy.length; index += 1) {
          copy[index] ^= mask[index % 4];
        }
        payload = copy;
      }
      this._onFrame(fin, opcode, payload);
    }
  }

  _onFrame(fin, opcode, payload) {
    switch (opcode) {
      case 0x8: // close
        this._sendFrame(0x8, payload.slice(0, 2));
        this._shutdown();
        this._emitClose(1000, '对端关闭连接');
        return;
      case 0x9: // ping
        this._sendFrame(0xA, payload);
        return;
      case 0xA: // pong
        return;
      case 0x0: // continuation
        this._fragments.push(payload);
        if (fin) this._flushMessage();
        return;
      case 0x1:
      case 0x2:
        this._fragmentOpcode = opcode;
        this._fragments = [payload];
        if (fin) this._flushMessage();
        return;
      default:
        return;
    }
  }

  _flushMessage() {
    const data = Buffer.concat(this._fragments);
    this._fragments = [];
    const binary = this._fragmentOpcode === 0x2;
    let delivered = data;
    if (binary && this.binaryType === 'arraybuffer') {
      // 复制成独立 ArrayBuffer，避免和后续解包共用内存。
      delivered = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    } else {
      delivered = data.toString('utf8');
    }
    if (this.onmessage) this.onmessage({ type: 'message', data: delivered });
  }

  send(data) {
    if (this.readyState !== OPEN) return;
    if (typeof data === 'string') {
      this._sendFrame(0x1, Buffer.from(data, 'utf8'));
      return;
    }
    if (data instanceof ArrayBuffer) {
      this._sendFrame(0x2, Buffer.from(data));
      return;
    }
    if (ArrayBuffer.isView(data)) {
      this._sendFrame(0x2, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    }
  }

  close(code) {
    if (this.readyState === CLOSED || this.readyState === CLOSING) return;
    this.readyState = CLOSING;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code && code > 0 ? code : 1000, 0);
    this._sendFrame(0x8, payload);
    this._shutdown();
    this._emitClose(code || 1000, '本地关闭');
  }

  _sendFrame(opcode, payload) {
    if (!this._socket || this._socket.destroyed) return;
    const maskKey = crypto.randomBytes(4);
    const length = payload.length;
    let header;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[1] = 0x80 | length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 0x80 | 127;
      header.writeUInt32BE(Math.floor(length / 0x100000000), 2);
      header.writeUInt32BE(length >>> 0, 6);
    }
    header[0] = 0x80 | opcode;
    const masked = Buffer.from(payload);
    for (let index = 0; index < masked.length; index += 1) {
      masked[index] ^= maskKey[index % 4];
    }
    this._socket.write(Buffer.concat([header, maskKey, masked]));
  }

  _shutdown() {
    this.readyState = CLOSED;
    if (this._socket) {
      this._socket.end();
      this._socket.destroy();
    }
  }

  _onSocketClose() {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this._emitClose(1006, '连接断开');
  }

  _emitClose(code, reason) {
    if (this.onclose) this.onclose({ type: 'close', code, reason, target: this });
  }

  _fail(error) {
    this.readyState = CLOSED;
    if (this._socket) this._socket.destroy();
    if (this.onerror) {
      this.onerror({ type: 'error', data: error && error.message, message: error && error.message, error });
    }
  }
}

MiniWebSocket.CONNECTING = CONNECTING;
MiniWebSocket.OPEN = OPEN;
MiniWebSocket.CLOSING = CLOSING;
MiniWebSocket.CLOSED = CLOSED;

module.exports = MiniWebSocket;
