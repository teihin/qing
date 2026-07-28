# Qing AudioServer

牌桌“按住说话、松开发送”功能的自有语音消息服务器。服务端接收16 kHz
单声道PCM，录音过程中实时调用FFmpeg编码，最终保存为AAC-LC/M4A。房间协议
只需要广播返回的`voiceId`。

## 已实现能力

- HTTP/WS无证书模式。
- HTTPS/WSS直接加载证书模式。
- Nginx等反向代理终止TLS的代理模式。
- WS边录边传和HTTP断线补传。
- 安卓、苹果、网页统一无令牌上传和下载。
- 同一请求ID幂等，避免重试产生两条语音。
- M4A临时文件、原子提交、SHA-256校验和分片目录。
- 不可预测文件ID、ETag、Range请求和客户端缓存支持。
- 语音过期清理、未完成临时文件清理、并发限制、健康检查和基础指标。

## 环境

- Go 1.25或兼容版本。
- FFmpeg，且包含原生AAC编码器。
- Linux或macOS。生产环境建议Linux。

## 构建

```bash
go mod download
go test ./...
go build -o audioserver ./cmd/audioserver
```

## 启动无证书模式

```bash
cp config.example.json config.json
export AUDIO_SERVER_ID_SECRET='替换为至少32位的高强度随机值'
./audioserver -config config.json
```

默认监听：

```text
HTTP  http://服务器:8080
WS    ws://服务器:8080/v1/stream
```

不带证书的流量可被窃听或篡改，只应在明确接受该风险的环境使用。

## 启动直接证书模式

参考`config.tls.example.json`配置`https_address`、`tls_cert_file`和
`tls_key_file`。`http_address`与`https_address`可以同时启用，不会自动跳转。

```bash
export AUDIO_SERVER_ID_SECRET='替换为至少32位的高强度随机值'
./audioserver -config config.tls.json
```

服务端不会绕过证书错误，也不会把HTTPS失败静默降级为HTTP。

## 反向代理模式

服务只监听`127.0.0.1:8080`，使用`deploy/nginx.conf.example`把公网
HTTPS/WSS转发到内部HTTP/WS。这种方式下AudioServer不读取任何证书文件。

## 当前 CentOS 7 服务器部署

现有热更新服务器没有免密`sudo`，因此使用
`deploy/centos7-user/`中的普通用户部署脚本。服务文件位于服务器私有目录
`/www/html/.audio-server`，目录权限为`0700`，AudioServer监听`18080`，
公网经现有Caddy的`/audio/*`路由访问。

```text
HTTP  http://154.37.155.17/audio
WS    ws://154.37.155.17/audio/v1/stream
```

用户级守护脚本负责进程异常重启，`crontab`负责服务器重启后启动服务，并每分钟
只读确认Caddy路由是否存在；路由丢失时才重新插入，不会每分钟重载Caddy。
当前入口没有证书，Android和iOS可以使用，公网浏览器不能在该页面环境中申请
麦克风权限。

当前服务器的HTTP补传链路应发送`Expect: 100-continue`。公网实测直接推送
32 KB请求体时部分网络会提前关闭连接，使用该标准握手后上传、转码和下载均
正常。WebSocket主链路不受此问题影响。

## 配置覆盖

以下环境变量会覆盖JSON：

```text
AUDIO_SERVER_ID_SECRET
AUDIO_SERVER_HTTP_ADDR
AUDIO_SERVER_HTTPS_ADDR
AUDIO_SERVER_TLS_CERT_FILE
AUDIO_SERVER_TLS_KEY_FILE
AUDIO_SERVER_DATA_DIR
AUDIO_SERVER_FFMPEG_PATH
```

`AUDIO_SERVER_ID_SECRET`只用于生成不可预测且支持幂等重试的文件ID，不是客户端
令牌，客户端无需知道或发送。生产环境不要把它写进版本库。

## 存储

PCM通过管道进入FFmpeg，默认不会长期保存。编码时先写：

```text
data/tmp/<voiceId>-<random>.m4a.part
```

完成后原子移动到：

```text
data/voices/YYYY/MM/DD/aa/bb/<voiceId>.m4a
```

元数据位于：

```text
data/metadata/aa/bb/<voiceId>.json
```

元数据不包含音频二进制。第一版使用文件元数据索引，接口已经与业务处理分离；
部署为多实例前应切换成共享元数据和自建MinIO等共享文件存储。

## 接口

```text
GET  /healthz
GET  /readyz
GET  /metrics
WS   /v1/stream
POST /v1/voices
GET  /v1/files/<voiceId>
```

详细消息格式见[PROTOCOL.md](PROTOCOL.md)。

## 浏览器限制

公网浏览器只有在HTTPS页面中才能申请麦克风权限，并且HTTPS页面只能连接
HTTPS/WSS接口。HTTP/WS模式可用于Android、iOS以及localhost网页联调。

## 游戏网页版客户端

网页版接入位于：

```text
assets/scripts/mobile/WebVoiceRecorder.ts
assets/scripts/mobile/WebVoiceClient.ts
assets/scripts/mobile/MobileManager.ts
```

进入牌桌时会提前建立并保持浏览器麦克风采集链路，离开房间时释放；空闲阶段
只保留约180ms的滚动PCM前置缓冲，不上传。按住按钮后优先用`AudioWorklet`
采集，旧浏览器回退到`ScriptProcessor`，统一流式重采样为
16 kHz单声道PCM16LE并通过WS边录边传；松手只发送结束消息。WS失败时保留
本次PCM并尝试HTTP补传。接收端下载M4A后使用Blob URL缓存和
`HTMLAudioElement`按原队列播放。服务返回`voiceId`后客户端直接调用现有
`reqSay("@@语音@@"+voiceId)`，KB只广播该文件名；所有平台上传和下载均不
需要令牌。

默认明文地址在`assets/scripts/common/GameDef.ts`。HTTPS网页不会降级到
明文服务，而是自动使用当前站点同源的`/audio`和WSS；部署时应把该路径反向
代理到AudioServer。也可在受控测试环境设置：

```javascript
localStorage.setItem("AudioServerBaseURL", "https://voice.example.com/audio")
```
