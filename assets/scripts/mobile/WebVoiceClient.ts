import {
    AUDIO_SERVER_HTTP_BASE,
    AUDIO_SERVER_WS_URL,
    AUDIO_SERVER_PROXY_PATH
} from "../common/GameDef";
import WebVoiceRecorder from "./WebVoiceRecorder";

interface VoiceEndpoints {
    httpBase:string;
    wsURL:string;
}

interface PendingControl {
    resolve:(value:any)=>void;
    reject:(error:any)=>void;
    timer:any;
}

interface BufferedPCM {
    data:ArrayBuffer;
    timestampMS:number;
}

interface VoiceUploadSession {
    id:number;
    requestID:string;
    endpoints:VoiceEndpoints;
    sequence:number;
    pcmBytes:number;
    socket:WebSocket;
    socketReady:boolean;
    socketFailed:boolean;
    closingSocket:boolean;
    stopRequested:boolean;
    stopped:boolean;
    cancelled:boolean;
    recorderReady:boolean;
    startPromise:Promise<void>;
    connectPromise:Promise<void>;
    finalizePromise:Promise<string>;
    hasSignal:boolean;
    silenceRecoveryAttempted:boolean;
    silenceCheckTimer:any;
    recoveryPromise:Promise<void>;
    pendingFrames:BufferedPCM[];
    allFrames:ArrayBuffer[];
    controlWaiters:{[key:string]:PendingControl};
    abortController:any;
}

export default class WebVoiceClient {
    private recorder:WebVoiceRecorder = new WebVoiceRecorder();
    private endpoints:VoiceEndpoints;
    private activeSession:VoiceUploadSession = null;
    private sessions:VoiceUploadSession[] = [];
    private nextSessionID:number = 0;
    private readonly minPCMBytes:number = 16000 * 2 * 0.3;
    private readonly maxPCMBytes:number = 16000 * 2 * 9.8;
    private readonly maxPendingSessions:number = 6;
    private recorderReleaseTimer:any = null;
    private cache:{[voiceID:string]:string} = {};
    private cacheOrder:string[] = [];
    private pendingDownloads:{[voiceID:string]:Promise<string>} = {};
    private downloadGeneration:number = 0;
    private activeAudio:HTMLAudioElement = null;
    private playbackTimer:any = null;
    private onPlaybackDone:()=>void;

    constructor(onPlaybackDone:()=>void) {
        this.onPlaybackDone = onPlaybackDone;
        this.endpoints = this.resolveEndpoints();
    }

    public prepare():Promise<void> {
        this.clearRecorderReleaseTimer();
        this.endpoints = this.resolveEndpoints();
        let endpointError = this.validateEndpoints();
        if(endpointError != null)
            return Promise.reject(endpointError);
        if(!WebVoiceRecorder.IsSupported())
            return Promise.reject(new Error("当前浏览器不支持麦克风录音"));
        if(!WebVoiceRecorder.IsSecureEnough())
            return Promise.reject(new Error("网页版录音必须通过HTTPS或localhost打开"));
        return this.recorder.prepare();
    }

    public isRecording():boolean {
        return this.activeSession != null;
    }

    public start():Promise<void> {
        this.clearRecorderReleaseTimer();
        if(this.isRecording())
            return Promise.reject(new Error("录音已经开始"));
        if(this.sessions.length >= this.maxPendingSessions)
            return Promise.reject(new Error("语音发送任务较多，请稍后再试"));

        this.endpoints = this.resolveEndpoints();
        let endpointError = this.validateEndpoints();
        if(endpointError != null)
            return Promise.reject(endpointError);

        let session = this.createSession();
        this.activeSession = session;
        this.sessions.push(session);

        session.connectPromise = this.connectAndStart(session).catch((error:any)=>{
            session.socketFailed = true;
            this.closeSocket(session);
        });
        session.startPromise = this.recorder.start((pcm:ArrayBuffer, timestampMS:number)=>{
            this.onPCM(session, pcm, timestampMS);
        }).then(()=>{
            if(!session.stopped && !session.cancelled)
            {
                session.recorderReady = true;
                this.scheduleInputHealthCheck(session, 600);
            }
        }).catch((error:any)=>{
            if(session.cancelled)
                return;
            if(session.stopped)
            {
                let message = error == null ? "" :
                    (error.message == null ? error.toString() : error.message.toString());
                if(message.indexOf("录音已取消") >= 0)
                    return;
                throw error;
            }
            session.cancelled = true;
            if(this.activeSession === session)
                this.activeSession = null;
            this.recorder.stop();
            this.cancelSocket(session);
            this.removeSession(session);
            throw error;
        });
        return session.startPromise;
    }

    public stop(immediate:boolean = false):Promise<string> {
        let session = this.activeSession;
        if(session == null)
            return Promise.reject(new Error("没有正在录音"));
        if(session.finalizePromise != null)
            return session.finalizePromise;
        session.stopRequested = true;
        // 给ScriptProcessor兜底路径留一个很短的尾音窗口，避免松手瞬间尚在
        // 浏览器音频缓冲区里的最后几十毫秒被截掉。
        session.finalizePromise = this.delay(immediate ? 0 : 50).then(()=>{
            if(this.activeSession === session)
                this.activeSession = null;
            session.stopped = true;
            this.recorder.stop();
            this.clearInputHealthTimer(session);
            if(session.cancelled)
                throw new Error("语音发送已取消");
            if(session.pcmBytes < this.minPCMBytes)
            {
                this.cancelSocket(session);
                throw new Error("录音时间太短");
            }
            if(!session.hasSignal)
            {
                this.cancelSocket(session);
                this.recorder.invalidateInput();
                throw new Error("麦克风没有采集到声音，请重新按住录音");
            }
            if(session.socketReady && !session.socketFailed &&
                session.socket != null && session.socket.readyState === WebSocket.OPEN)
            {
                return this.finishWebSocket(session);
            }
            return this.uploadFallback(session);
        }).then((voiceID:string)=>{
            if(session.cancelled)
                throw new Error("语音发送已取消");
            this.closeSocket(session);
            this.removeSession(session);
            return voiceID;
        }).catch((error:any)=>{
            this.closeSocket(session);
            this.removeSession(session);
            throw error;
        });
        return session.finalizePromise;
    }

    public cancel() {
        let session = this.activeSession;
        this.activeSession = null;
        this.recorder.stop();
        if(session != null)
            this.cancelSession(session);
    }

    public play(voiceID:string):Promise<void> {
        this.stopPlayback(false);
        return this.getVoiceURL(voiceID).then((blobURL:string)=>{
            return new Promise<void>((resolve, reject)=>{
                let completed = false;
                let audio = new Audio(blobURL);
                this.activeAudio = audio;
                audio.preload = "auto";

                let finish = (error:any)=>{
                    if(completed)
                        return;
                    completed = true;
                    this.stopPlayback(false);
                    if(error != null)
                        reject(error);
                    else
                        resolve();
                };
                audio.onended = ()=>finish(null);
                audio.onerror = ()=>finish(new Error("语音播放失败"));
                this.playbackTimer = setTimeout(()=>{
                    finish(new Error("语音播放超时"));
                }, 12000);

                let playResult:any = audio.play();
                if(playResult != null && typeof playResult.catch === "function")
                {
                    playResult.catch((error:any)=>{
                        finish(new Error("浏览器阻止了语音自动播放"));
                    });
                }
            });
        }).then(()=>{
            this.onPlaybackDone();
        }).catch((error:any)=>{
            this.onPlaybackDone();
            throw error;
        });
    }

    public preload(voiceID:string):Promise<void> {
        return this.getVoiceURL(voiceID).then(()=>{
            return;
        });
    }

    public unlockPlayback() {
        if(typeof document === "undefined")
            return;
        try {
            let audio = new Audio(
                "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEA" +
                "QB8AAEAfAAABAAgAZGF0YQAAAAA="
            );
            audio.volume = 0;
            let result:any = audio.play();
            if(result != null && typeof result.catch === "function")
                result.catch((error:any)=>{});
        } catch(e) {}
    }

    public shutdown() {
        this.clearRecorderReleaseTimer();
        this.resetRoomState();
        this.recorder.shutdown();
    }

    // 切房只清理房间相关上传、下载和播放状态。麦克风链短暂保留，
    // 新房间可直接复用，避免连续stop/getUserMedia得到live但静音的轨道。
    public leaveRoom() {
        this.clearRecorderReleaseTimer();
        this.resetRoomState();
        this.recorder.resetPreRoll();
        this.recorderReleaseTimer = setTimeout(()=>{
            this.recorderReleaseTimer = null;
            if(!this.isRecording())
                this.recorder.shutdown();
        }, 5000);
    }

    private resetRoomState() {
        this.cancel();
        let sessions = this.sessions.slice(0);
        for(let i = 0; i < sessions.length; i++)
            this.cancelSession(sessions[i]);
        this.sessions = [];
        this.stopPlayback(false);
        this.downloadGeneration++;
        this.pendingDownloads = {};
        for(let voiceID in this.cache)
        {
            if(this.cache.hasOwnProperty(voiceID))
                URL.revokeObjectURL(this.cache[voiceID]);
        }
        this.cache = {};
        this.cacheOrder = [];
    }

    private createSession():VoiceUploadSession {
        return {
            id: ++this.nextSessionID,
            requestID: "web_" + new Date().getTime().toString() + "_" +
                Math.floor(Math.random() * 100000000).toString(),
            endpoints: {
                httpBase: this.endpoints.httpBase,
                wsURL: this.endpoints.wsURL
            },
            sequence: 0,
            pcmBytes: 0,
            socket: null,
            socketReady: false,
            socketFailed: false,
            closingSocket: false,
            stopRequested: false,
            stopped: false,
            cancelled: false,
            recorderReady: false,
            startPromise: null,
            connectPromise: null,
            finalizePromise: null,
            hasSignal: false,
            silenceRecoveryAttempted: false,
            silenceCheckTimer: null,
            recoveryPromise: null,
            pendingFrames: [],
            allFrames: [],
            controlWaiters: {},
            abortController: null
        };
    }

    private connectAndStart(session:VoiceUploadSession):Promise<void> {
        return new Promise<void>((resolve, reject)=>{
            let socket = new WebSocket(session.endpoints.wsURL);
            session.socket = socket;
            socket.binaryType = "arraybuffer";
            let timer = setTimeout(()=>{
                reject(new Error("连接语音服务器超时"));
            }, 5000);

            socket.onopen = ()=>{
                clearTimeout(timer);
                if(session.cancelled || session.stopped)
                {
                    this.closeSocket(session);
                    reject(new Error("录音已结束"));
                    return;
                }
                let startWait = this.waitControl(session, "started", 5000);
                startWait.then(()=>{
                    if(session.cancelled || session.stopped)
                    {
                        this.cancelSocket(session);
                        reject(new Error("录音已结束"));
                        return;
                    }
                    session.socketReady = true;
                    this.flushPendingFrames(session);
                    resolve();
                }).catch(reject);
                try {
                    socket.send(JSON.stringify({
                        type: "start",
                        requestId: session.requestID
                    }));
                } catch(e) {
                    this.closeSocket(session);
                    reject(new Error("语音服务器连接失败"));
                }
            };
            socket.onmessage = (event:MessageEvent)=>{
                this.onControlMessage(session, event.data);
            };
            socket.onerror = ()=>{
                clearTimeout(timer);
                reject(new Error("语音服务器连接失败"));
            };
            socket.onclose = ()=>{
                clearTimeout(timer);
                if(!session.closingSocket)
                {
                    session.socketFailed = true;
                    this.rejectAllWaiters(session, new Error("语音服务器连接已断开"));
                }
                reject(new Error("语音服务器连接已断开"));
            };
        });
    }

    private onPCM(session:VoiceUploadSession, pcm:ArrayBuffer, timestampMS:number) {
        if(session.cancelled || session.stopped || this.activeSession !== session)
            return;
        if(!session.hasSignal && this.hasNonZeroPCM(pcm))
        {
            session.hasSignal = true;
            this.clearInputHealthTimer(session);
        }
        let remaining = this.maxPCMBytes - session.pcmBytes;
        if(remaining <= 0)
            return;
        let stableCopy = pcm.byteLength <= remaining ?
            pcm.slice(0) : pcm.slice(0, remaining - remaining % 2);
        if(stableCopy.byteLength === 0)
            return;
        session.pcmBytes += stableCopy.byteLength;
        session.allFrames.push(stableCopy);
        let frame:BufferedPCM = {
            data: stableCopy,
            timestampMS: timestampMS
        };
        if(!session.socketReady || session.socket == null)
        {
            session.pendingFrames.push(frame);
            return;
        }
        this.sendFrame(session, frame);
    }

    private flushPendingFrames(session:VoiceUploadSession) {
        while(session.pendingFrames.length > 0 && !session.socketFailed &&
            !session.cancelled && !session.stopped)
        {
            this.sendFrame(session, session.pendingFrames.shift());
        }
    }

    private sendFrame(session:VoiceUploadSession, frame:BufferedPCM) {
        if(session.socket == null || session.socket.readyState !== WebSocket.OPEN)
        {
            session.socketFailed = true;
            return;
        }
        let packet = new ArrayBuffer(14 + frame.data.byteLength);
        let view = new DataView(packet);
        view.setUint8(0, 1);
        view.setUint8(1, 1);
        view.setUint32(2, session.sequence, false);
        this.writeUint64(view, 6, frame.timestampMS);
        new Uint8Array(packet, 14).set(new Uint8Array(frame.data));
        session.sequence++;
        try {
            session.socket.send(packet);
        } catch(e) {
            session.socketFailed = true;
        }
    }

    private finishWebSocket(session:VoiceUploadSession):Promise<string> {
        let readyWait = this.waitControl(session, "ready", 8000);
        try {
            session.socket.send(JSON.stringify({type:"finish"}));
        } catch(e) {
            readyWait.catch((error:any)=>{});
            session.socketFailed = true;
            return this.uploadFallback(session);
        }
        return readyWait.then((message:any)=>{
            if(message.voice == null || message.voice.voiceId == null)
                throw new Error("语音服务器未返回文件ID");
            return message.voice.voiceId.toString();
        }).catch((error:any)=>{
            if(session.cancelled)
                throw new Error("语音发送已取消");
            session.socketFailed = true;
            return this.uploadFallback(session);
        });
    }

    private uploadFallback(session:VoiceUploadSession):Promise<string> {
        let byteLength = session.pcmBytes;
        if(byteLength < this.minPCMBytes)
            return Promise.reject(new Error("录音时间太短"));

        let body = new Uint8Array(byteLength);
        let offset = 0;
        for(let i = 0; i < session.allFrames.length; i++)
        {
            let one = new Uint8Array(session.allFrames[i]);
            body.set(one, offset);
            offset += one.length;
        }
        return this.releaseWebSocketForFallback(session).then(()=>{
            return this.postFallback(session, body.buffer, 0);
        });
    }

    private releaseWebSocketForFallback(session:VoiceUploadSession):Promise<void> {
        if(session.socket != null && session.socket.readyState === WebSocket.OPEN)
        {
            let cancelled = this.waitControl(session, "cancelled", 400).catch((error:any)=>{
                return;
            });
            try {
                session.socket.send(JSON.stringify({type:"cancel"}));
            } catch(e) {
                cancelled = Promise.resolve();
            }
            return cancelled.then(()=>{
                this.closeSocket(session);
                return this.delay(60);
            });
        }
        this.closeSocket(session);
        // 连接已异常关闭时，给服务器defer清理录音状态留一点时间。
        return this.delay(160);
    }

    private postFallback(session:VoiceUploadSession, body:ArrayBuffer, attempt:number):Promise<string> {
        if(session.cancelled)
            return Promise.reject(new Error("语音发送已取消"));
        let options:any = {
            method: "POST",
            headers: {
                "Content-Type": "application/octet-stream",
                "X-Request-ID": session.requestID
            },
            body: body.slice(0)
        };
        let timeout:any = null;
        let AbortControllerClass:any = typeof window !== "undefined" ?
            (window as any).AbortController : null;
        if(AbortControllerClass != null)
        {
            let controller = new AbortControllerClass();
            session.abortController = controller;
            options.signal = controller.signal;
            timeout = setTimeout(()=>{
                controller.abort();
            }, 8000);
        }
        let retryDelays = [120, 240, 480, 800];
        return fetch(session.endpoints.httpBase + "/v1/voices", options).then((response:Response)=>{
            if(timeout != null)
                clearTimeout(timeout);
            session.abortController = null;
            let retryable = response.status === 409 || response.status === 429 ||
                response.status === 500 || response.status === 502 ||
                response.status === 503 || response.status === 504;
            if(retryable && attempt < retryDelays.length)
            {
                return response.text().then(()=>{
                    return this.delay(retryDelays[attempt]);
                }).then(()=>{
                    return this.postFallback(session, body, attempt + 1);
                });
            }
            if(!response.ok)
                throw new Error("语音补传失败(" + response.status.toString() + ")");
            return response.json();
        }, (error:any)=>{
            if(timeout != null)
                clearTimeout(timeout);
            session.abortController = null;
            if(session.cancelled)
                throw new Error("语音发送已取消");
            if(attempt < retryDelays.length)
            {
                return this.delay(retryDelays[attempt]).then(()=>{
                    return this.postFallback(session, body, attempt + 1);
                });
            }
            throw new Error("语音补传失败，请检查网络");
        }).then((payload:any)=>{
            if(typeof payload === "string")
                return payload;
            if(payload == null || payload.data == null || payload.data.voiceId == null)
                throw new Error("语音补传未返回文件ID");
            return payload.data.voiceId.toString();
        });
    }

    private delay(milliseconds:number):Promise<void> {
        return new Promise<void>((resolve)=>{
            setTimeout(resolve, milliseconds);
        });
    }

    private waitControl(session:VoiceUploadSession, type:string, timeoutMS:number):Promise<any> {
        return new Promise<any>((resolve, reject)=>{
            let timer = setTimeout(()=>{
                delete session.controlWaiters[type];
                reject(new Error("等待语音服务器响应超时:" + type));
            }, timeoutMS);
            session.controlWaiters[type] = {
                resolve: resolve,
                reject: reject,
                timer: timer
            };
        });
    }

    private onControlMessage(session:VoiceUploadSession, raw:any) {
        if(typeof raw !== "string")
            return;
        let message:any;
        try {
            message = JSON.parse(raw);
        } catch(e) {
            return;
        }
        if(message.type === "error")
        {
            let error = new Error(message.message || message.code || "语音服务器错误");
            this.rejectAllWaiters(session, error);
            session.socketFailed = true;
            return;
        }
        let waiter = session.controlWaiters[message.type];
        if(waiter == null)
            return;
        clearTimeout(waiter.timer);
        delete session.controlWaiters[message.type];
        waiter.resolve(message);
    }

    private rejectAllWaiters(session:VoiceUploadSession, error:any) {
        for(let type in session.controlWaiters)
        {
            if(!session.controlWaiters.hasOwnProperty(type))
                continue;
            let waiter = session.controlWaiters[type];
            clearTimeout(waiter.timer);
            waiter.reject(error);
        }
        session.controlWaiters = {};
    }

    private closeSocket(session:VoiceUploadSession) {
        session.closingSocket = true;
        this.rejectAllWaiters(session, new Error("语音连接已关闭"));
        if(session.socket != null)
        {
            try { session.socket.close(); } catch(e) {}
        }
        session.socket = null;
        session.socketReady = false;
    }

    private cancelSocket(session:VoiceUploadSession) {
        if(session.socket != null && session.socket.readyState === WebSocket.OPEN)
        {
            try { session.socket.send(JSON.stringify({type:"cancel"})); } catch(e) {}
        }
        this.closeSocket(session);
    }

    private cancelSession(session:VoiceUploadSession) {
        if(session == null || session.cancelled)
            return;
        session.cancelled = true;
        session.stopped = true;
        if(session.abortController != null)
        {
            try { session.abortController.abort(); } catch(e) {}
            session.abortController = null;
        }
        this.cancelSocket(session);
        this.clearInputHealthTimer(session);
        session.pendingFrames = [];
        session.allFrames = [];
        this.removeSession(session);
    }

    private removeSession(session:VoiceUploadSession) {
        let index = this.sessions.indexOf(session);
        if(index >= 0)
            this.sessions.splice(index, 1);
        this.clearInputHealthTimer(session);
        session.pendingFrames = [];
        session.allFrames = [];
        session.abortController = null;
    }

    private scheduleInputHealthCheck(session:VoiceUploadSession, delayMS:number) {
        this.clearInputHealthTimer(session);
        if(session.hasSignal || session.cancelled || session.stopped)
            return;
        session.silenceCheckTimer = setTimeout(()=>{
            session.silenceCheckTimer = null;
            if(session.hasSignal || session.cancelled || session.stopped ||
                session.stopRequested || this.activeSession !== session)
            {
                return;
            }
            if(session.silenceRecoveryAttempted)
                return;
            session.silenceRecoveryAttempted = true;
            session.recoveryPromise = this.recorder.recover(
                (pcm:ArrayBuffer, timestampMS:number)=>{
                    this.onPCM(session, pcm, timestampMS);
                }
            ).then(()=>{
                session.recoveryPromise = null;
            }).catch((error:any)=>{
                session.recoveryPromise = null;
            });
        }, delayMS);
    }

    private clearInputHealthTimer(session:VoiceUploadSession) {
        if(session.silenceCheckTimer != null)
        {
            clearTimeout(session.silenceCheckTimer);
            session.silenceCheckTimer = null;
        }
    }

    private hasNonZeroPCM(pcm:ArrayBuffer):boolean {
        let samples = new Int16Array(pcm);
        for(let i = 0; i < samples.length; i++)
        {
            if(samples[i] > 1 || samples[i] < -1)
                return true;
        }
        return false;
    }

    private clearRecorderReleaseTimer() {
        if(this.recorderReleaseTimer != null)
        {
            clearTimeout(this.recorderReleaseTimer);
            this.recorderReleaseTimer = null;
        }
    }

    private stopPlayback(notify:boolean) {
        if(this.playbackTimer != null)
        {
            clearTimeout(this.playbackTimer);
            this.playbackTimer = null;
        }
        if(this.activeAudio != null)
        {
            this.activeAudio.onended = null;
            this.activeAudio.onerror = null;
            try {
                this.activeAudio.pause();
                this.activeAudio.currentTime = 0;
            } catch(e) {}
            this.activeAudio = null;
        }
        if(notify)
            this.onPlaybackDone();
    }

    private addCache(voiceID:string, blobURL:string) {
        this.cache[voiceID] = blobURL;
        this.cacheOrder.push(voiceID);
        while(this.cacheOrder.length > 20)
        {
            let removeID = this.cacheOrder.shift();
            if(this.cache[removeID] != null)
            {
                URL.revokeObjectURL(this.cache[removeID]);
                delete this.cache[removeID];
            }
        }
    }

    private getVoiceURL(voiceID:string):Promise<string> {
        let cached = this.cache[voiceID];
        if(cached != null)
            return Promise.resolve(cached);
        let pending = this.pendingDownloads[voiceID];
        if(pending != null)
            return pending;

        let generation = this.downloadGeneration;
        let url = this.endpoints.httpBase + "/v1/files/" + encodeURIComponent(voiceID);
        let download = fetch(url, {
            method: "GET",
            cache: "force-cache"
        }).then((response:Response)=>{
            if(!response.ok)
                throw new Error("语音下载失败(" + response.status.toString() + ")");
            return response.blob();
        }).then((blob:Blob)=>{
            if(generation !== this.downloadGeneration)
                throw new Error("已离开房间");
            let blobURL = URL.createObjectURL(blob);
            this.addCache(voiceID, blobURL);
            return blobURL;
        });
        this.pendingDownloads[voiceID] = download;
        let clearPending = ()=>{
            if(this.pendingDownloads[voiceID] === download)
                delete this.pendingDownloads[voiceID];
        };
        download.then(clearPending, clearPending);
        return download;
    }

    private resolveEndpoints():VoiceEndpoints {
        let override = "";
        try {
            override = cc.sys.localStorage.getItem("AudioServerBaseURL") || "";
        } catch(e) {}

        let httpBase = AUDIO_SERVER_HTTP_BASE;
        if(override !== "")
            httpBase = override.replace(/\/+$/, "");
        else if(typeof window !== "undefined" && window.location.protocol === "https:")
            httpBase = window.location.origin + AUDIO_SERVER_PROXY_PATH;

        let wsURL = AUDIO_SERVER_WS_URL;
        if(httpBase.indexOf("https://") === 0)
            wsURL = "wss://" + httpBase.substr("https://".length) + "/v1/stream";
        else if(httpBase.indexOf("http://") === 0)
            wsURL = "ws://" + httpBase.substr("http://".length) + "/v1/stream";
        return {
            httpBase: httpBase,
            wsURL: wsURL
        };
    }

    private validateEndpoints():Error {
        if(typeof window !== "undefined" &&
            window.location.protocol === "https:" &&
            this.endpoints.httpBase.indexOf("http://") === 0)
        {
            return new Error("HTTPS网页不能连接明文语音服务器");
        }
        return null;
    }

    private writeUint64(view:DataView, offset:number, value:number) {
        let high = Math.floor(value / 0x100000000);
        let low = value >>> 0;
        view.setUint32(offset, high, false);
        view.setUint32(offset + 4, low, false);
    }
}
