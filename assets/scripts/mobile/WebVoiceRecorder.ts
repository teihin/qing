export type WebVoicePCMCallback = (pcm: ArrayBuffer, timestampMS: number) => void;

class StreamingPCMResampler {
    private inputRate:number;
    private outputRate:number;
    private ratio:number;
    private buffered:Float32Array = new Float32Array(0);
    private position:number = 0;

    constructor(inputRate:number, outputRate:number) {
        this.inputRate = inputRate;
        this.outputRate = outputRate;
        this.ratio = inputRate / outputRate;
    }

    public reset() {
        this.buffered = new Float32Array(0);
        this.position = 0;
    }

    public process(input:Float32Array):Int16Array {
        if(input == null || input.length === 0)
            return new Int16Array(0);

        let merged = new Float32Array(this.buffered.length + input.length);
        merged.set(this.buffered, 0);
        merged.set(input, this.buffered.length);

        let outputLength = 0;
        if(merged.length >= 2 && this.position < merged.length - 1)
            outputLength = Math.ceil((merged.length - 1 - this.position) / this.ratio);

        let output = new Int16Array(outputLength);
        for(let i = 0; i < outputLength; i++)
        {
            let sourceIndex = Math.floor(this.position);
            let fraction = this.position - sourceIndex;
            let first = merged[sourceIndex];
            let second = merged[Math.min(sourceIndex + 1, merged.length - 1)];
            let sample = first + (second - first) * fraction;
            sample = Math.max(-1, Math.min(1, sample));
            output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
            this.position += this.ratio;
        }

        // 跨AudioWorklet/ScriptProcessor数据块保留最后一个插值样本和采样相位，
        // 避免每个数据块都产生重复样本或长期时长漂移。
        let consumed = Math.min(Math.floor(this.position), merged.length);
        if(consumed > 0)
        {
            this.buffered = merged.slice(Math.min(consumed, merged.length));
            this.position -= consumed;
        }
        else
        {
            this.buffered = merged;
        }
        return output;
    }
}

export default class WebVoiceRecorder {
    private mediaStream:any = null;
    private audioContext:any = null;
    private sourceNode:any = null;
    private processorNode:any = null;
    private silentGain:any = null;
    private resampler:StreamingPCMResampler = null;
    private onPCM:WebVoicePCMCallback = null;
    private sentSamples:number = 0;
    private preparePromise:Promise<void> = null;
    private setupGeneration:number = 0;
    private recordGeneration:number = 0;
    private recording:boolean = false;
    private inputInvalid:boolean = false;
    private preRollFrames:Int16Array[] = [];
    private preRollSamples:number = 0;
    private readonly maxPreRollSamples:number = 2880; // 16kHz下约180ms

    public static IsSupported():boolean {
        if(typeof window === "undefined" || typeof navigator === "undefined")
            return false;
        let mediaDevices:any = (navigator as any).mediaDevices;
        let audioContext:any = (window as any).AudioContext || (window as any).webkitAudioContext;
        return mediaDevices != null && typeof mediaDevices.getUserMedia === "function" && audioContext != null;
    }

    public static IsSecureEnough():boolean {
        if(typeof window === "undefined")
            return false;
        if((window as any).isSecureContext === true)
            return true;
        let hostname = window.location.hostname;
        return window.location.protocol === "https:" ||
            hostname === "localhost" ||
            hostname === "127.0.0.1" ||
            hostname === "[::1]";
    }

    public prepare():Promise<void> {
        if(!WebVoiceRecorder.IsSupported())
            return Promise.reject(new Error("当前浏览器不支持麦克风录音"));
        if(!WebVoiceRecorder.IsSecureEnough())
            return Promise.reject(new Error("网页版录音必须通过HTTPS或localhost打开"));
        if(this.preparePromise != null)
            return this.preparePromise;
        if(this.audioContext != null && this.hasHealthyAudioTrack() &&
            this.audioContext.state !== "closed")
        {
            return Promise.resolve();
        }
        if(this.audioContext != null || this.mediaStream != null)
            this.releaseResources();

        let constraints:any = {
            audio: {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        };
        let generation = this.setupGeneration;
        let preparing:Promise<void> =
        (navigator as any).mediaDevices.getUserMedia(constraints).then((stream:any)=>{
            if(generation !== this.setupGeneration)
            {
                this.stopTracks(stream);
                throw new Error("麦克风预热已取消");
            }
            this.mediaStream = stream;
            this.bindTrackHealth(stream);
            if(!this.hasHealthyAudioTrack())
                throw new Error("麦克风轨道不可用");
            let AudioContextClass:any = (window as any).AudioContext || (window as any).webkitAudioContext;
            this.audioContext = new AudioContextClass();
            this.resampler = new StreamingPCMResampler(this.audioContext.sampleRate, 16000);
            this.sourceNode = this.audioContext.createMediaStreamSource(stream);
            return this.createProcessor();
        }).then(()=>{
            if(generation !== this.setupGeneration)
                throw new Error("麦克风预热已取消");
            this.sourceNode.connect(this.processorNode);
            this.silentGain = this.audioContext.createGain();
            this.silentGain.gain.value = 0;
            this.processorNode.connect(this.silentGain);
            this.silentGain.connect(this.audioContext.destination);
            if(this.preparePromise === preparing)
                this.preparePromise = null;
        }).catch((error:any)=>{
            if(generation === this.setupGeneration)
                this.releaseResources();
            if(this.preparePromise === preparing)
                this.preparePromise = null;
            throw error;
        });
        this.preparePromise = preparing;
        return preparing;
    }

    public start(callback:WebVoicePCMCallback):Promise<void> {
        if(this.recording)
            return Promise.reject(new Error("录音已经开始"));
        let generation = ++this.recordGeneration;
        return this.prepare().then(()=>{
            if(generation !== this.recordGeneration)
                throw new Error("录音已取消");
            let resumePromise = this.audioContext != null &&
                this.audioContext.state !== "running" &&
                this.audioContext.state !== "closed" &&
                typeof this.audioContext.resume === "function" ?
                this.audioContext.resume() : Promise.resolve();
            return resumePromise;
        }).then(()=>{
            if(generation !== this.recordGeneration)
                throw new Error("录音已取消");
            this.onPCM = callback;
            this.sentSamples = 0;
            this.recording = true;
            this.flushPreRoll();
        });
    }

    public stop() {
        this.recordGeneration++;
        this.recording = false;
        this.onPCM = null;
    }

    // 当前轨道虽然仍显示live但持续输出全零PCM时，原地重建一次采集链。
    // sentSamples不清零，保证同一个上传会话内的时间戳继续单调递增。
    public recover(callback:WebVoicePCMCallback):Promise<void> {
        let generation = ++this.recordGeneration;
        this.setupGeneration++;
        this.recording = false;
        this.onPCM = null;
        this.preparePromise = null;
        this.releaseResources();
        return this.prepare().then(()=>{
            if(generation !== this.recordGeneration)
                throw new Error("录音已取消");
            let resumePromise = this.audioContext != null &&
                this.audioContext.state !== "running" &&
                this.audioContext.state !== "closed" &&
                typeof this.audioContext.resume === "function" ?
                this.audioContext.resume() : Promise.resolve();
            return resumePromise;
        }).then(()=>{
            if(generation !== this.recordGeneration)
                throw new Error("录音已取消");
            if(!this.hasHealthyAudioTrack())
                throw new Error("麦克风轨道不可用");
            this.onPCM = callback;
            this.recording = true;
            this.flushPreRoll();
        });
    }

    public invalidateInput() {
        this.recordGeneration++;
        this.setupGeneration++;
        this.recording = false;
        this.onPCM = null;
        this.preparePromise = null;
        this.releaseResources();
    }

    public resetPreRoll() {
        this.preRollFrames = [];
        this.preRollSamples = 0;
    }

    public isInputHealthy():boolean {
        return this.audioContext != null &&
            this.audioContext.state !== "closed" &&
            this.hasHealthyAudioTrack();
    }

    public shutdown() {
        this.recordGeneration++;
        this.setupGeneration++;
        this.recording = false;
        this.onPCM = null;
        this.preparePromise = null;
        this.releaseResources();
    }

    private releaseResources() {
        if(this.sourceNode != null)
        {
            try { this.sourceNode.disconnect(); } catch(e) {}
        }
        if(this.processorNode != null)
        {
            try {
                this.processorNode.disconnect();
                if(this.processorNode.port != null)
                    this.processorNode.port.onmessage = null;
                if(this.processorNode.onaudioprocess !== undefined)
                    this.processorNode.onaudioprocess = null;
            } catch(e) {}
        }
        if(this.silentGain != null)
        {
            try { this.silentGain.disconnect(); } catch(e) {}
        }
        this.stopTracks(this.mediaStream);
        if(this.audioContext != null)
        {
            try { this.audioContext.close(); } catch(e) {}
        }

        this.mediaStream = null;
        this.audioContext = null;
        this.sourceNode = null;
        this.processorNode = null;
        this.silentGain = null;
        this.resampler = null;
        this.onPCM = null;
        this.inputInvalid = false;
        this.preRollFrames = [];
        this.preRollSamples = 0;
    }

    private createProcessor():Promise<void> {
        let context:any = this.audioContext;
        if(context.audioWorklet != null && (window as any).AudioWorkletNode != null)
        {
            let processorName = "qing-voice-pcm-" + new Date().getTime().toString() +
                "-" + Math.floor(Math.random() * 100000).toString();
            let source = [
                "class QingVoicePCMProcessor extends AudioWorkletProcessor {",
                "process(inputs) {",
                "const channel = inputs[0] && inputs[0][0];",
                "if (channel && channel.length) {",
                "const copy = new Float32Array(channel);",
                "this.port.postMessage(copy, [copy.buffer]);",
                "}",
                "return true;",
                "}",
                "}",
                "registerProcessor('" + processorName + "', QingVoicePCMProcessor);"
            ].join("\n");
            let blobURL = URL.createObjectURL(new Blob([source], {type:"application/javascript"}));
            return context.audioWorklet.addModule(blobURL).then(()=>{
                URL.revokeObjectURL(blobURL);
                let WorkletNode:any = (window as any).AudioWorkletNode;
                this.processorNode = new WorkletNode(context, processorName, {
                    numberOfInputs: 1,
                    numberOfOutputs: 1,
                    outputChannelCount: [1]
                });
                this.processorNode.port.onmessage = (event:any)=>{
                    let samples = event.data instanceof Float32Array ?
                        event.data : new Float32Array(event.data);
                    this.handleSamples(samples);
                };
            }).catch((error:any)=>{
                URL.revokeObjectURL(blobURL);
                this.createScriptProcessor();
            });
        }

        this.createScriptProcessor();
        return Promise.resolve();
    }

    private createScriptProcessor() {
        let createProcessor = this.audioContext.createScriptProcessor ||
            this.audioContext.createJavaScriptNode;
        // 2048样本可把旧浏览器ScriptProcessor兜底的尾音缓冲压到约43ms，
        // 再配合客户端50ms尾音窗口，避免松手时丢失最后一个音节。
        this.processorNode = createProcessor.call(this.audioContext, 2048, 1, 1);
        this.processorNode.onaudioprocess = (event:any)=>{
            let input = event.inputBuffer.getChannelData(0);
            this.handleSamples(new Float32Array(input));
        };
    }

    private handleSamples(samples:Float32Array) {
        if(this.resampler == null)
            return;
        let pcm = this.resampler.process(samples);
        if(pcm.length === 0)
            return;
        if(!this.recording || this.onPCM == null)
        {
            this.addPreRoll(pcm);
            return;
        }
        this.sendPCM(pcm);
    }

    private sendPCM(pcm:Int16Array) {
        if(this.onPCM == null)
            return;
        let timestampMS = Math.floor(this.sentSamples * 1000 / 16000);
        this.sentSamples += pcm.length;
        this.onPCM(pcm.buffer, timestampMS);
    }

    private addPreRoll(pcm:Int16Array) {
        this.preRollFrames.push(pcm);
        this.preRollSamples += pcm.length;
        let excess = this.preRollSamples - this.maxPreRollSamples;
        while(excess > 0 && this.preRollFrames.length > 0)
        {
            let first = this.preRollFrames[0];
            if(first.length <= excess)
            {
                this.preRollFrames.shift();
                this.preRollSamples -= first.length;
                excess -= first.length;
            }
            else
            {
                this.preRollFrames[0] = first.slice(excess);
                this.preRollSamples -= excess;
                excess = 0;
            }
        }
    }

    private flushPreRoll() {
        let frames = this.preRollFrames;
        this.preRollFrames = [];
        this.preRollSamples = 0;
        for(let i = 0; i < frames.length; i++)
            this.sendPCM(frames[i]);
    }

    private stopTracks(stream:any) {
        if(stream == null || typeof stream.getTracks !== "function")
            return;
        let tracks = stream.getTracks();
        for(let i = 0; i < tracks.length; i++)
        {
            let track = tracks[i];
            try {
                track.onended = null;
                track.onmute = null;
                track.onunmute = null;
            } catch(e) {}
            try { track.stop(); } catch(e) {}
        }
    }

    private bindTrackHealth(stream:any) {
        this.inputInvalid = false;
        if(stream == null || typeof stream.getAudioTracks !== "function")
        {
            this.inputInvalid = true;
            return;
        }
        let tracks = stream.getAudioTracks();
        if(tracks == null || tracks.length === 0)
        {
            this.inputInvalid = true;
            return;
        }
        for(let i = 0; i < tracks.length; i++)
        {
            let track = tracks[i];
            try { track.enabled = true; } catch(e) {}
            track.onended = ()=>{
                if(this.mediaStream === stream)
                    this.inputInvalid = true;
            };
            track.onmute = ()=>{
                if(this.mediaStream === stream)
                    this.inputInvalid = true;
            };
            track.onunmute = ()=>{
                if(this.mediaStream === stream &&
                    track.readyState === "live" && track.enabled !== false)
                {
                    this.inputInvalid = false;
                }
            };
        }
    }

    private hasHealthyAudioTrack():boolean {
        if(this.inputInvalid)
            return false;
        if(this.mediaStream == null ||
            typeof this.mediaStream.getAudioTracks !== "function")
        {
            return false;
        }
        let tracks = this.mediaStream.getAudioTracks();
        if(tracks == null || tracks.length === 0)
            return false;
        for(let i = 0; i < tracks.length; i++)
        {
            let track = tracks[i];
            if(track.readyState === "live" &&
                track.enabled !== false &&
                track.muted !== true)
            {
                return true;
            }
        }
        return false;
    }
}
