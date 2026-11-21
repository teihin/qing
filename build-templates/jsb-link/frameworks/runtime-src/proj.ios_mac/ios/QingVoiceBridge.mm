#import "QingVoiceBridge.h"

#import <AVFoundation/AVFoundation.h>
#import <UIKit/UIKit.h>

#include "scripting/js-bindings/jswrapper/SeApi.h"
#include "audio/include/AudioEngine.h"

#include <OpenAL/alc.h>

#include <unistd.h>

static const double QingVoiceSampleRate = 16000.0;
static const NSUInteger QingVoiceBytesPerSecond = 32000;
static const NSUInteger QingVoiceMinBytes = QingVoiceBytesPerSecond * 300 / 1000;
static const NSUInteger QingVoiceMaxBytes = QingVoiceBytesPerSecond * 9800 / 1000;
static const NSUInteger QingVoiceCacheLimit = 20;

@interface QingVoiceRecordSession : NSObject

@property(nonatomic, copy) NSString *httpBase;
@property(nonatomic, copy) NSString *clientTag;
@property(nonatomic, copy) NSString *requestId;
@property(nonatomic, assign) NSInteger roomGeneration;
@property(nonatomic, strong) NSMutableData *pcm;
@property(nonatomic, assign) NSUInteger byteCount;
@property(nonatomic, assign) BOOL stopRequested;
@property(nonatomic, assign) BOOL cancelled;
@property(nonatomic, assign) BOOL hasSignal;
@property(nonatomic, assign) BOOL captureFinished;
@property(nonatomic, assign) BOOL streamingFailed;
@property(nonatomic, assign) BOOL streamTaskFinished;
@property(nonatomic, assign) BOOL bodyStreamProvided;
@property(nonatomic, assign) BOOL fallbackStarted;
@property(nonatomic, assign) BOOL completed;
@property(nonatomic, assign) BOOL autoStopScheduled;
@property(nonatomic, copy, nullable) NSString *captureError;
@property(nonatomic, strong, nullable) NSError *streamTaskError;
@property(nonatomic, strong) AVAudioEngine *engine;
@property(nonatomic, strong) AVAudioConverter *converter;
@property(nonatomic, strong, nullable) NSInputStream *inputStream;
@property(nonatomic, strong, nullable) NSOutputStream *outputStream;
@property(nonatomic, strong, nullable) NSURLSessionDataTask *streamTask;
@property(nonatomic, strong) NSMutableArray<NSData *> *pendingBeforeSignal;
@property(nonatomic, strong) NSMutableData *responseData;
@property(nonatomic, strong) NSMutableArray<NSURLSessionTask *> *tasks;
@property(nonatomic, assign) NSInteger responseStatus;
@property(nonatomic) dispatch_queue_t uploadQueue;
@property(nonatomic) dispatch_group_t captureGroup;

@end

@implementation QingVoiceRecordSession
@end

@interface QingVoiceBridge () <
    NSURLSessionDataDelegate,
    NSURLSessionTaskDelegate,
    AVAudioPlayerDelegate
>

@property(nonatomic, strong) NSURLSession *urlSession;
@property(nonatomic, strong) NSOperationQueue *delegateQueue;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, QingVoiceRecordSession *> *taskSessions;
@property(nonatomic, strong) NSMutableSet<QingVoiceRecordSession *> *recordSessions;
@property(nonatomic, strong, nullable) QingVoiceRecordSession *activeRecord;
@property(nonatomic, strong, nullable) AVAudioEngine *preparedEngine;
@property(nonatomic, copy) NSString *httpBase;
@property(nonatomic, assign) BOOL pendingPermissionStart;
@property(nonatomic, copy) NSString *pendingClientTag;
@property(nonatomic, assign) NSInteger roomGeneration;
@property(nonatomic, strong, nullable) AVAudioPlayer *player;
@property(nonatomic, assign) NSInteger playerGeneration;
// 切换到录音/语音播放前记录的游戏音频会话配置，用完必须还原，否则游戏音效会静音。
@property(nonatomic, copy) NSString *gameAudioCategory;
@property(nonatomic, copy) NSString *gameAudioMode;
@property(nonatomic, assign) NSUInteger gameAudioOptions;
@property(nonatomic, assign) BOOL hasGameAudioSnapshot;
// 最近一次让 OpenAL 重连的时间，用于节流，避免频繁 setActive 打断其它 App。
@property(nonatomic, assign) NSTimeInterval lastOpenALReconnectTime;
@property(nonatomic) dispatch_queue_t networkQueue;

- (void)cancelRecordSession:(QingVoiceRecordSession *)record;
- (void)forgetRecordSession:(QingVoiceRecordSession *)record;
- (void)restoreGameAudioSession;
- (void)reconnectOpenALContext;
- (void)rebuildAudioEngine;

@end

@implementation QingVoiceBridge

+ (instancetype)sharedBridge
{
    static QingVoiceBridge *bridge = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        bridge = [[QingVoiceBridge alloc] initPrivate];
    });
    return bridge;
}

- (instancetype)initPrivate
{
    self = [super init];
    if (self) {
        _httpBase = @"";
        _pendingClientTag = @"";
        _taskSessions = [NSMutableDictionary dictionary];
        _recordSessions = [NSMutableSet set];
        _networkQueue = dispatch_queue_create("com.fireball.qing.voice.network", DISPATCH_QUEUE_SERIAL);
        _delegateQueue = [[NSOperationQueue alloc] init];
        _delegateQueue.maxConcurrentOperationCount = 1;
        _delegateQueue.name = @"com.fireball.qing.voice.delegate";

        NSURLSessionConfiguration *configuration =
            [NSURLSessionConfiguration defaultSessionConfiguration];
        configuration.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
        configuration.timeoutIntervalForRequest = 20.0;
        configuration.timeoutIntervalForResource = 35.0;
        _urlSession = [NSURLSession sessionWithConfiguration:configuration
                                                   delegate:self
                                              delegateQueue:_delegateQueue];
        [self ensureCacheDirectory];
    }
    return self;
}

- (instancetype)init
{
    return [QingVoiceBridge sharedBridge];
}

+ (void)initializeBridge
{
    (void)[QingVoiceBridge sharedBridge];
}

+ (void)Prepare:(NSString *)serverBase
{
    [[QingVoiceBridge sharedBridge] prepare:serverBase];
}

+ (void)StartRecord:(NSString *)serverBase clientTag:(NSString *)clientTag
{
    [[QingVoiceBridge sharedBridge] startRecord:serverBase clientTag:clientTag];
}

+ (void)StopRecord
{
    [[QingVoiceBridge sharedBridge] stopRecord:NO];
}

+ (void)CancelRecord
{
    [[QingVoiceBridge sharedBridge] stopRecord:YES];
}

+ (void)PlayFile:(NSString *)serverBase voiceId:(NSString *)voiceId
{
    [[QingVoiceBridge sharedBridge] playFile:serverBase voiceId:voiceId];
}

+ (void)PreloadFile:(NSString *)serverBase voiceId:(NSString *)voiceId
{
    [[QingVoiceBridge sharedBridge] preloadFile:serverBase voiceId:voiceId];
}

+ (void)LeaveRoom
{
    [[QingVoiceBridge sharedBridge] leaveRoom];
}

+ (void)RestoreGameAudio
{
    [[QingVoiceBridge sharedBridge] restoreGameAudioSession];
}

+ (void)ApplicationWillResignActive
{
    [[QingVoiceBridge sharedBridge] applicationWillResignActive];
}

+ (void)ApplicationDidBecomeActive
{
    [[QingVoiceBridge sharedBridge] applicationDidBecomeActive];
}

+ (void)shutdownBridge
{
    [[QingVoiceBridge sharedBridge] shutdownInternal];
}

- (void)prepare:(NSString *)serverBase
{
    NSString *normalized = [self normalizeBase:serverBase];
    if (normalized.length > 0) {
        self.httpBase = normalized;
    }
    dispatch_async(dispatch_get_main_queue(), ^{
        if ([AVAudioSession sharedInstance].recordPermission
                == AVAudioSessionRecordPermissionGranted) {
            [self prepareAudioEngine];
        }
    });
}

- (void)startRecord:(NSString *)serverBase clientTag:(NSString *)clientTag
{
    NSString *normalized = [self normalizeBase:serverBase];
    NSString *safeTag = clientTag ?: @"";
    if (normalized.length == 0) {
        [self notifyJs:@"语音录制失败"
               message:[self recordMessage:safeTag value:@"语音服务器地址未配置"]];
        return;
    }
    self.httpBase = normalized;

    dispatch_async(dispatch_get_main_queue(), ^{
        AVAudioSession *audioSession = [AVAudioSession sharedInstance];
        if (audioSession.recordPermission == AVAudioSessionRecordPermissionDenied) {
            [self notifyJs:@"语音录制失败"
                   message:[self recordMessage:safeTag
                                          value:@"麦克风权限未开启，请在系统设置中允许麦克风"]];
            return;
        }
        if (audioSession.recordPermission == AVAudioSessionRecordPermissionUndetermined) {
            self.pendingPermissionStart = YES;
            self.pendingClientTag = safeTag;
            [audioSession requestRecordPermission:^(BOOL granted) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    BOOL shouldStart = self.pendingPermissionStart;
                    NSString *pendingTag = self.pendingClientTag ?: @"";
                    self.pendingPermissionStart = NO;
                    self.pendingClientTag = @"";
                    if (!granted) {
                        if (shouldStart) {
                            [self notifyJs:@"语音录制失败"
                                   message:[self recordMessage:pendingTag
                                                          value:@"麦克风权限未开启，请在系统设置中允许麦克风"]];
                        }
                        return;
                    }
                    if (shouldStart) {
                        [self beginRecord:normalized clientTag:pendingTag];
                    } else {
                        [self prepareAudioEngine];
                    }
                });
            }];
            return;
        }
        [self beginRecord:normalized clientTag:safeTag];
    });
}

- (void)beginRecord:(NSString *)serverBase clientTag:(NSString *)clientTag
{
    if (self.activeRecord != nil && !self.activeRecord.captureFinished) {
        [self notifyJs:@"语音录制失败"
               message:[self recordMessage:clientTag value:@"上一条语音正在结束，请稍后再试"]];
        return;
    }

    QingVoiceRecordSession *record = [[QingVoiceRecordSession alloc] init];
    record.httpBase = serverBase;
    record.clientTag = clientTag ?: @"";
    record.requestId =
        [[[NSUUID UUID].UUIDString lowercaseString] stringByReplacingOccurrencesOfString:@"-"
                                                                             withString:@""];
    record.roomGeneration = self.roomGeneration;
    record.pcm = [NSMutableData dataWithCapacity:QingVoiceMaxBytes];
    record.pendingBeforeSignal = [NSMutableArray array];
    record.responseData = [NSMutableData data];
    record.tasks = [NSMutableArray array];
    record.uploadQueue = dispatch_queue_create(
        [[NSString stringWithFormat:@"com.fireball.qing.voice.upload.%@",
                                    record.requestId] UTF8String],
        DISPATCH_QUEUE_SERIAL);
    record.captureGroup = dispatch_group_create();
    record.engine = self.preparedEngine ?: [[AVAudioEngine alloc] init];
    self.preparedEngine = nil;
    self.activeRecord = record;
    @synchronized (self.recordSessions) {
        [self.recordSessions addObject:record];
    }

    NSError *sessionError = nil;
    AVAudioSession *audioSession = [AVAudioSession sharedInstance];
    [self captureGameAudioSession];
    BOOL configured = [audioSession setCategory:AVAudioSessionCategoryPlayAndRecord
                                           mode:AVAudioSessionModeVoiceChat
                                        options:(AVAudioSessionCategoryOptionDefaultToSpeaker |
                                                 AVAudioSessionCategoryOptionAllowBluetooth)
                                          error:&sessionError];
    if (configured) {
        [audioSession setPreferredSampleRate:QingVoiceSampleRate error:nil];
        [audioSession setPreferredIOBufferDuration:0.01 error:nil];
        configured = [audioSession setActive:YES error:&sessionError];
    }
    if (!configured) {
        record.captureError = sessionError.localizedDescription ?: @"无法启动音频会话";
        [self finishRecord:record cancel:NO];
        return;
    }

    AVAudioInputNode *inputNode = record.engine.inputNode;
    AVAudioFormat *inputFormat = [inputNode inputFormatForBus:0];
    if (inputFormat.channelCount == 0 || inputFormat.sampleRate <= 0) {
        record.captureError = @"设备没有可用麦克风输入";
        [self finishRecord:record cancel:NO];
        return;
    }
    AVAudioFormat *outputFormat =
        [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatInt16
                                         sampleRate:QingVoiceSampleRate
                                           channels:1
                                        interleaved:NO];
    record.converter = [[AVAudioConverter alloc] initFromFormat:inputFormat
                                                       toFormat:outputFormat];
    if (record.converter == nil) {
        record.captureError = @"无法初始化语音格式转换器";
        [self finishRecord:record cancel:NO];
        return;
    }

    [self startStreamingUpload:record];

    __weak QingVoiceBridge *weakSelf = self;
    __weak QingVoiceRecordSession *weakRecord = record;
    [inputNode installTapOnBus:0
                    bufferSize:480
                        format:inputFormat
                         block:^(AVAudioPCMBuffer *buffer, AVAudioTime *when) {
        QingVoiceBridge *strongSelf = weakSelf;
        QingVoiceRecordSession *strongRecord = weakRecord;
        if (strongSelf == nil || strongRecord == nil) {
            return;
        }
        BOOL shouldCapture = NO;
        @synchronized (strongRecord) {
            if (!strongRecord.stopRequested) {
                dispatch_group_enter(strongRecord.captureGroup);
                shouldCapture = YES;
            }
        }
        if (!shouldCapture) {
            return;
        }
        @autoreleasepool {
            [strongSelf captureBuffer:buffer record:strongRecord];
        }
        dispatch_group_leave(strongRecord.captureGroup);
    }];

    NSError *engineError = nil;
    [record.engine prepare];
    if (![record.engine startAndReturnError:&engineError]) {
        [inputNode removeTapOnBus:0];
        record.captureError = engineError.localizedDescription ?: @"麦克风启动失败";
        [self finishRecord:record cancel:NO];
    }
}

- (void)captureBuffer:(AVAudioPCMBuffer *)input
               record:(QingVoiceRecordSession *)record
{
    if (record.stopRequested || record.cancelled || record.byteCount >= QingVoiceMaxBytes) {
        return;
    }
    double ratio = QingVoiceSampleRate / input.format.sampleRate;
    AVAudioFrameCount capacity =
        (AVAudioFrameCount)ceil((double)input.frameLength * ratio) + 64;
    AVAudioPCMBuffer *output =
        [[AVAudioPCMBuffer alloc] initWithPCMFormat:record.converter.outputFormat
                                      frameCapacity:capacity];
    if (output == nil) {
        return;
    }

    __block BOOL suppliedInput = NO;
    NSError *convertError = nil;
    AVAudioConverterOutputStatus status =
        [record.converter convertToBuffer:output
                                    error:&convertError
                       withInputFromBlock:^AVAudioBuffer * _Nullable(
                           AVAudioPacketCount requestedPackets,
                           AVAudioConverterInputStatus *outStatus) {
        if (suppliedInput) {
            *outStatus = AVAudioConverterInputStatus_NoDataNow;
            return nil;
        }
        suppliedInput = YES;
        *outStatus = AVAudioConverterInputStatus_HaveData;
        return input;
    }];
    if (status == AVAudioConverterOutputStatus_Error || convertError != nil) {
        @synchronized (record) {
            if (record.captureError == nil) {
                record.captureError =
                    convertError.localizedDescription ?: @"语音格式转换失败";
            }
        }
        dispatch_async(dispatch_get_main_queue(), ^{
            if (self.activeRecord == record) {
                [self finishRecord:record cancel:NO];
            }
        });
        return;
    }
    if (output.frameLength == 0 || output.int16ChannelData == nil) {
        return;
    }

    NSUInteger byteLength = (NSUInteger)output.frameLength * sizeof(int16_t);
    NSUInteger remaining = QingVoiceMaxBytes - record.byteCount;
    byteLength = MIN(byteLength, remaining);
    byteLength -= byteLength % sizeof(int16_t);
    if (byteLength == 0) {
        return;
    }
    NSData *chunk = [NSData dataWithBytes:output.int16ChannelData[0]
                                  length:byteLength];
    BOOL hasSignal = [self dataContainsSignal:chunk];
    @synchronized (record) {
        [record.pcm appendData:chunk];
        record.byteCount += chunk.length;
        if (hasSignal) {
            record.hasSignal = YES;
        }
    }
    [self enqueueChunk:chunk record:record];

    if (record.byteCount >= QingVoiceMaxBytes) {
        BOOL shouldStop = NO;
        @synchronized (record) {
            if (!record.autoStopScheduled) {
                record.autoStopScheduled = YES;
                shouldStop = YES;
            }
        }
        if (shouldStop) {
            dispatch_async(dispatch_get_main_queue(), ^{
                if (self.activeRecord == record && !record.stopRequested) {
                    [self notifyJs:@"语音录制自动停止"
                           message:[self recordMessage:record.clientTag value:@""]];
                    [self finishRecord:record cancel:NO];
                }
            });
        }
    }
}

- (void)stopRecord:(BOOL)cancel
{
    dispatch_async(dispatch_get_main_queue(), ^{
        self.pendingPermissionStart = NO;
        self.pendingClientTag = @"";
        QingVoiceRecordSession *record = self.activeRecord;
        if (record != nil) {
            [self finishRecord:record cancel:cancel];
        }
    });
}

- (void)finishRecord:(QingVoiceRecordSession *)record cancel:(BOOL)cancel
{
    BOOL alreadyStopped = NO;
    @synchronized (record) {
        alreadyStopped = record.stopRequested;
        if (!alreadyStopped) {
            record.stopRequested = YES;
            record.cancelled = cancel;
        }
    }
    if (alreadyStopped) {
        if (cancel) {
            [self cancelRecordSession:record];
        }
        return;
    }
    if (cancel) {
        [self cancelRecordSession:record];
    }

    AVAudioInputNode *inputNode = record.engine.inputNode;
    [record.engine stop];
    @try {
        [inputNode removeTapOnBus:0];
    } @catch (NSException *exception) {
    }
    if (self.player == nil) {
        // 录音已停且没有语音在播，把会话还给游戏，否则音效会哑掉。
        [self restoreGameAudioSession];
    }
    if (self.activeRecord == record) {
        self.activeRecord = nil;
    }
    if (!cancel && record.roomGeneration == self.roomGeneration && self.preparedEngine == nil) {
        self.preparedEngine = record.engine;
    }

    dispatch_group_notify(record.captureGroup, record.uploadQueue, ^{
        record.captureFinished = YES;
        NSString *invalid = [self validateRecord:record];
        if (cancel || record.cancelled || record.roomGeneration != self.roomGeneration) {
            [self cancelStreaming:record];
            [self forgetRecordSession:record];
            return;
        }
        if (invalid != nil) {
            [self cancelStreaming:record];
            [self completeFailure:record message:invalid];
            return;
        }
        if (record.streamingFailed || record.streamTaskFinished) {
            [self handleStreamingCompletion:record];
            return;
        }
        [self flushPendingChunks:record];
        [record.outputStream close];
    });
}

- (void)startStreamingUpload:(QingVoiceRecordSession *)record
{
    CFReadStreamRef readStream = NULL;
    CFWriteStreamRef writeStream = NULL;
    CFStreamCreateBoundPair(kCFAllocatorDefault, &readStream, &writeStream, 64 * 1024);
    if (readStream == NULL || writeStream == NULL) {
        record.streamingFailed = YES;
        if (readStream != NULL) {
            CFRelease(readStream);
        }
        if (writeStream != NULL) {
            CFRelease(writeStream);
        }
        return;
    }
    record.inputStream = (__bridge_transfer NSInputStream *)readStream;
    record.outputStream = (__bridge_transfer NSOutputStream *)writeStream;

    NSMutableURLRequest *request =
        [self uploadRequest:record.httpBase requestId:record.requestId];
    NSURLSessionUploadTask *task =
        [self.urlSession uploadTaskWithStreamedRequest:request];
    record.streamTask = task;
    @synchronized (self.taskSessions) {
        self.taskSessions[@(task.taskIdentifier)] = record;
    }
    @synchronized (record) {
        [record.tasks addObject:task];
    }
    [record.outputStream open];
    [task resume];
}

- (void)enqueueChunk:(NSData *)chunk record:(QingVoiceRecordSession *)record
{
    dispatch_async(record.uploadQueue, ^{
        if (record.cancelled || record.streamingFailed || record.completed) {
            return;
        }
        if (!record.hasSignal) {
            [record.pendingBeforeSignal addObject:chunk];
            return;
        }
        [self flushPendingChunks:record];
        if (![self writeData:chunk record:record]) {
            [self markStreamingFailed:record];
        }
    });
}

- (void)flushPendingChunks:(QingVoiceRecordSession *)record
{
    if (record.pendingBeforeSignal.count == 0) {
        return;
    }
    NSArray<NSData *> *pending = [record.pendingBeforeSignal copy];
    [record.pendingBeforeSignal removeAllObjects];
    for (NSData *data in pending) {
        if (![self writeData:data record:record]) {
            [self markStreamingFailed:record];
            return;
        }
    }
}

- (BOOL)writeData:(NSData *)data record:(QingVoiceRecordSession *)record
{
    NSOutputStream *stream = record.outputStream;
    if (stream == nil) {
        return NO;
    }
    const uint8_t *bytes = (const uint8_t *)data.bytes;
    NSUInteger offset = 0;
    CFAbsoluteTime blockedSince = 0;
    while (offset < data.length) {
        if (record.cancelled || record.streamingFailed) {
            return NO;
        }
        NSInteger written = [stream write:bytes + offset maxLength:data.length - offset];
        if (written > 0) {
            offset += (NSUInteger)written;
            blockedSince = 0;
            continue;
        }
        if (written < 0) {
            return NO;
        }
        if (blockedSince == 0) {
            blockedSince = CFAbsoluteTimeGetCurrent();
        } else if (CFAbsoluteTimeGetCurrent() - blockedSince > 3.0) {
            return NO;
        }
        usleep(2000);
    }
    return YES;
}

- (void)markStreamingFailed:(QingVoiceRecordSession *)record
{
    if (record.streamingFailed) {
        return;
    }
    record.streamingFailed = YES;
    [record.outputStream close];
    [record.streamTask cancel];
    if (record.captureFinished) {
        [self handleStreamingCompletion:record];
    }
}

- (void)cancelStreaming:(QingVoiceRecordSession *)record
{
    [record.outputStream close];
    [record.inputStream close];
    [record.streamTask cancel];
}

- (void)cancelRecordSession:(QingVoiceRecordSession *)record
{
    if (record == nil) {
        return;
    }
    NSArray<NSURLSessionTask *> *tasks = nil;
    @synchronized (record) {
        record.cancelled = YES;
        record.completed = YES;
        tasks = [record.tasks copy];
        [record.tasks removeAllObjects];
    }
    [record.outputStream close];
    [record.inputStream close];
    for (NSURLSessionTask *task in tasks) {
        [task cancel];
    }
    @synchronized (self.taskSessions) {
        for (NSURLSessionTask *task in tasks) {
            [self.taskSessions removeObjectForKey:@(task.taskIdentifier)];
        }
    }
    [self forgetRecordSession:record];
}

- (void)forgetRecordSession:(QingVoiceRecordSession *)record
{
    @synchronized (self.recordSessions) {
        [self.recordSessions removeObject:record];
    }
}

- (void)handleStreamingCompletion:(QingVoiceRecordSession *)record
{
    if (!record.captureFinished || record.completed || record.cancelled
            || record.roomGeneration != self.roomGeneration) {
        return;
    }
    NSString *invalid = [self validateRecord:record];
    if (invalid != nil) {
        [self completeFailure:record message:invalid];
        return;
    }
    if (!record.streamingFailed
            && record.streamTaskError == nil
            && (record.responseStatus == 200 || record.responseStatus == 201)) {
        NSString *voiceId = [self voiceIdFromResponse:record.responseData];
        if ([self validVoiceId:voiceId]) {
            [self completeSuccess:record voiceId:voiceId];
            return;
        }
    }
    NSString *message =
        record.streamTaskError.localizedDescription
            ?: [self errorMessageFromResponse:record.responseData
                                       status:record.responseStatus];
    [self startFallbackUpload:record initialError:message];
}

- (void)startFallbackUpload:(QingVoiceRecordSession *)record
               initialError:(NSString *)initialError
{
    @synchronized (record) {
        if (record.fallbackStarted || record.completed || record.cancelled) {
            return;
        }
        record.fallbackStarted = YES;
    }
    NSData *pcm = [record.pcm copy];
    [self fallbackUpload:record
                     pcm:pcm
                 attempt:0
               lastError:initialError ?: @"语音上传失败"];
}

- (void)fallbackUpload:(QingVoiceRecordSession *)record
                   pcm:(NSData *)pcm
               attempt:(NSInteger)attempt
             lastError:(NSString *)lastError
{
    static const NSTimeInterval delays[] = {0.0, 0.16, 0.32, 0.64, 1.0};
    const NSInteger attemptCount = sizeof(delays) / sizeof(delays[0]);
    if (record.cancelled || record.completed
            || record.roomGeneration != self.roomGeneration) {
        return;
    }
    if (attempt >= attemptCount) {
        [self completeFailure:record message:lastError ?: @"语音上传失败"];
        return;
    }

    dispatch_after(
        dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delays[attempt] * NSEC_PER_SEC)),
        self.networkQueue,
        ^{
        if (record.cancelled || record.completed
                || record.roomGeneration != self.roomGeneration) {
            return;
        }
        NSMutableURLRequest *request =
            [self uploadRequest:record.httpBase requestId:record.requestId];
        request.HTTPBody = pcm;
        __block __weak NSURLSessionDataTask *weakTask = nil;
        NSURLSessionDataTask *task =
            [self.urlSession dataTaskWithRequest:request
                              completionHandler:^(NSData *data,
                                                  NSURLResponse *response,
                                                  NSError *error) {
            NSURLSessionDataTask *finishedTask = weakTask;
            @synchronized (record) {
                if (finishedTask != nil) {
                    [record.tasks removeObject:finishedTask];
                }
            }
            NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
            NSInteger status = http.statusCode;
            if (error == nil && (status == 200 || status == 201)) {
                NSString *voiceId = [self voiceIdFromResponse:data];
                if ([self validVoiceId:voiceId]) {
                    [self completeSuccess:record voiceId:voiceId];
                    return;
                }
            }
            NSString *message =
                error.localizedDescription
                    ?: [self errorMessageFromResponse:data status:status];
            if (error != nil || [self retryableStatus:status]) {
                [self fallbackUpload:record
                                 pcm:pcm
                             attempt:attempt + 1
                           lastError:message];
            } else {
                [self completeFailure:record message:message];
            }
        }];
        weakTask = task;
        @synchronized (record) {
            [record.tasks addObject:task];
        }
        [task resume];
    });
}

- (NSMutableURLRequest *)uploadRequest:(NSString *)base requestId:(NSString *)requestId
{
    NSURL *url = [NSURL URLWithString:[base stringByAppendingString:@"/v1/voices"]];
    NSMutableURLRequest *request =
        [NSMutableURLRequest requestWithURL:url
                               cachePolicy:NSURLRequestReloadIgnoringLocalCacheData
                           timeoutInterval:20.0];
    request.HTTPMethod = @"POST";
    [request setValue:@"application/octet-stream" forHTTPHeaderField:@"Content-Type"];
    [request setValue:requestId forHTTPHeaderField:@"X-Request-ID"];
    [request setValue:@"100-continue" forHTTPHeaderField:@"Expect"];
    [request setValue:@"close" forHTTPHeaderField:@"Connection"];
    return request;
}

#pragma mark - NSURLSession streaming delegate

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
didReceiveResponse:(NSURLResponse *)response
 completionHandler:(void (^)(NSURLSessionResponseDisposition disposition))completionHandler
{
    QingVoiceRecordSession *record = [self recordForTask:dataTask];
    if (record != nil) {
        NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
        record.responseStatus = http.statusCode;
        [record.responseData setLength:0];
    }
    completionHandler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
    didReceiveData:(NSData *)data
{
    QingVoiceRecordSession *record = [self recordForTask:dataTask];
    if (record != nil && data.length > 0) {
        [record.responseData appendData:data];
    }
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
 needNewBodyStream:(void (^)(NSInputStream * _Nullable bodyStream))completionHandler
{
    QingVoiceRecordSession *record = [self recordForTask:task];
    if (record == nil) {
        completionHandler(nil);
        return;
    }
    BOOL provideInitialStream = NO;
    @synchronized (record) {
        if (!record.bodyStreamProvided
                && !record.cancelled
                && !record.streamingFailed
                && !record.completed) {
            record.bodyStreamProvided = YES;
            provideInitialStream = YES;
        } else {
            record.streamingFailed = YES;
        }
    }
    // uploadTaskWithStreamedRequest asks here for the initial live stream.
    // Any later request means a redirect/auth replay, which cannot replay the
    // microphone stream and therefore falls back to the retained PCM body.
    completionHandler(provideInitialStream ? record.inputStream : nil);
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
willPerformHTTPRedirection:(NSHTTPURLResponse *)response
        newRequest:(NSURLRequest *)request
 completionHandler:(void (^)(NSURLRequest * _Nullable))completionHandler
{
    QingVoiceRecordSession *record = [self recordForTask:task];
    NSString *oldScheme = response.URL.scheme.lowercaseString;
    NSString *newScheme = request.URL.scheme.lowercaseString;
    BOOL downgradesTLS =
        [oldScheme isEqualToString:@"https"] && [newScheme isEqualToString:@"http"];
    // A live request body cannot be replayed safely. Fixed-body retries and
    // downloads may follow same-security redirects, but never HTTPS to HTTP.
    completionHandler((record != nil || downgradesTLS) ? nil : request);
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
didCompleteWithError:(NSError *)error
{
    QingVoiceRecordSession *record = nil;
    @synchronized (self.taskSessions) {
        record = self.taskSessions[@(task.taskIdentifier)];
        [self.taskSessions removeObjectForKey:@(task.taskIdentifier)];
    }
    if (record == nil) {
        return;
    }
    record.streamTaskFinished = YES;
    record.streamTaskError = error;
    @synchronized (record) {
        [record.tasks removeObject:task];
    }
    [record.inputStream close];
    [record.outputStream close];
    dispatch_async(record.uploadQueue, ^{
        [self handleStreamingCompletion:record];
    });
}

- (QingVoiceRecordSession *)recordForTask:(NSURLSessionTask *)task
{
    @synchronized (self.taskSessions) {
        return self.taskSessions[@(task.taskIdentifier)];
    }
}

#pragma mark - Playback and cache

- (void)playFile:(NSString *)serverBase voiceId:(NSString *)voiceId
{
    NSString *base = [self normalizeBase:serverBase];
    if (base.length == 0 || ![self validVoiceId:voiceId]) {
        [self notifyJs:@"语音播放失败" message:@"语音文件名无效"];
        return;
    }
    NSInteger generation = self.roomGeneration;
    [self obtainVoiceFile:base
                  voiceId:voiceId
               generation:generation
               completion:^(NSURL *fileURL, NSError *error) {
        if (generation != self.roomGeneration) {
            return;
        }
        if (error != nil || fileURL == nil) {
            [self notifyJs:@"语音播放失败"
                   message:error.localizedDescription ?: @"语音下载失败"];
            return;
        }
        dispatch_async(dispatch_get_main_queue(), ^{
            [self startPlayer:fileURL generation:generation];
        });
    }];
}

- (void)preloadFile:(NSString *)serverBase voiceId:(NSString *)voiceId
{
    NSString *base = [self normalizeBase:serverBase];
    if (base.length == 0 || ![self validVoiceId:voiceId]) {
        return;
    }
    NSInteger generation = self.roomGeneration;
    [self obtainVoiceFile:base
                  voiceId:voiceId
               generation:generation
               completion:^(NSURL *fileURL, NSError *error) {
        if (error != nil) {
            NSLog(@"[QingVoice] preload failed: %@", error.localizedDescription);
        }
    }];
}

- (void)obtainVoiceFile:(NSString *)base
                voiceId:(NSString *)voiceId
             generation:(NSInteger)generation
             completion:(void (^)(NSURL * _Nullable, NSError * _Nullable))completion
{
    NSURL *target = [[self cacheDirectory]
        URLByAppendingPathComponent:[voiceId stringByAppendingString:@".m4a"]];
    NSDictionary *attributes =
        [[NSFileManager defaultManager] attributesOfItemAtPath:target.path error:nil];
    if ([attributes fileSize] > 0) {
        [[NSFileManager defaultManager] setAttributes:@{
            NSFileModificationDate: [NSDate date]
        } ofItemAtPath:target.path error:nil];
        completion(target, nil);
        return;
    }

    NSURL *url =
        [NSURL URLWithString:[NSString stringWithFormat:@"%@/v1/files/%@", base, voiceId]];
    NSMutableURLRequest *request =
        [NSMutableURLRequest requestWithURL:url
                               cachePolicy:NSURLRequestReloadIgnoringLocalCacheData
                           timeoutInterval:15.0];
    [request setValue:@"close" forHTTPHeaderField:@"Connection"];
    NSURLSessionDataTask *task =
        [self.urlSession dataTaskWithRequest:request
                          completionHandler:^(NSData *data,
                                              NSURLResponse *response,
                                              NSError *error) {
        if (generation != self.roomGeneration) {
            return;
        }
        NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
        if (error != nil || http.statusCode != 200 || data.length == 0) {
            NSString *message =
                error.localizedDescription
                    ?: [self errorMessageFromResponse:data status:http.statusCode];
            completion(nil, [NSError errorWithDomain:@"QingVoice"
                                                 code:http.statusCode
                                             userInfo:@{NSLocalizedDescriptionKey:
                                                            message ?: @"语音下载失败"}]);
            return;
        }
        NSError *writeError = nil;
        if (![data writeToURL:target
                      options:NSDataWritingAtomic
                        error:&writeError]) {
            completion(nil, writeError);
            return;
        }
        [self pruneCache];
        completion(target, nil);
    }];
    [task resume];
}

- (void)startPlayer:(NSURL *)fileURL generation:(NSInteger)generation
{
    if (generation != self.roomGeneration) {
        return;
    }
    [self stopPlayer:NO];
    NSError *sessionError = nil;
    AVAudioSession *audioSession = [AVAudioSession sharedInstance];
    [self captureGameAudioSession];
    // 播放语音必须用 Default mode：VoiceChat 会启用通话语音处理（AEC/降噪/窄带），
    // 把输出电平压到"电话级"，音量还跟随通话音量而不是媒体音量，听起来又小又闷。
    // 同时允许 A2DP，避免蓝牙耳机下回落到 HFP 通话音质。
    [audioSession setCategory:AVAudioSessionCategoryPlayAndRecord
                         mode:AVAudioSessionModeDefault
                      options:(AVAudioSessionCategoryOptionDefaultToSpeaker |
                               AVAudioSessionCategoryOptionAllowBluetooth |
                               AVAudioSessionCategoryOptionAllowBluetoothA2DP)
                        error:&sessionError];
    [audioSession setActive:YES error:&sessionError];

    NSError *playerError = nil;
    AVAudioPlayer *player = [[AVAudioPlayer alloc] initWithContentsOfURL:fileURL
                                                                  error:&playerError];
    if (player == nil || playerError != nil) {
        [self restoreGameAudioSession];
        [self notifyJs:@"语音播放失败"
               message:playerError.localizedDescription ?: @"语音解码失败"];
        return;
    }
    self.player = player;
    self.playerGeneration = generation;
    player.delegate = self;
    player.volume = 1.0;
    [player prepareToPlay];
    if (![player play]) {
        [self stopPlayer:NO];
        [self restoreGameAudioSession];
        [self notifyJs:@"语音播放失败" message:@"语音播放失败"];
    }
}

- (void)audioPlayerDidFinishPlaying:(AVAudioPlayer *)player successfully:(BOOL)flag
{
    if (self.player != player) {
        return;
    }
    NSInteger generation = self.playerGeneration;
    [self stopPlayer:NO];
    [self restoreGameAudioSession];
    if (generation == self.roomGeneration) {
        [self notifyJs:(flag ? @"语音播放完成" : @"语音播放失败")
               message:(flag ? @"" : @"语音播放未正常完成")];
    }
}

- (void)audioPlayerDecodeErrorDidOccur:(AVAudioPlayer *)player
                                  error:(NSError *)error
{
    if (self.player != player) {
        return;
    }
    NSInteger generation = self.playerGeneration;
    [self stopPlayer:NO];
    [self restoreGameAudioSession];
    if (generation == self.roomGeneration) {
        [self notifyJs:@"语音播放失败"
               message:error.localizedDescription ?: @"语音解码失败"];
    }
}

- (void)stopPlayer:(BOOL)notify
{
    AVAudioPlayer *player = self.player;
    NSInteger generation = self.playerGeneration;
    self.player = nil;
    self.playerGeneration = 0;
    player.delegate = nil;
    [player stop];
    if (notify && generation == self.roomGeneration) {
        [self notifyJs:@"语音播放失败" message:@"语音播放已中断"];
    }
}

#pragma mark - Lifecycle

- (void)leaveRoom
{
    dispatch_async(dispatch_get_main_queue(), ^{
        self.roomGeneration += 1;
        self.pendingPermissionStart = NO;
        self.pendingClientTag = @"";
        QingVoiceRecordSession *record = self.activeRecord;
        if (record != nil) {
            [self finishRecord:record cancel:YES];
        }
        NSArray<QingVoiceRecordSession *> *records = nil;
        @synchronized (self.recordSessions) {
            records = self.recordSessions.allObjects;
        }
        for (QingVoiceRecordSession *pending in records) {
            [self cancelRecordSession:pending];
        }
        [self stopPlayer:NO];
        [self.preparedEngine stop];
        self.preparedEngine = nil;
        // 注意：这里绝对不能 setActive:NO。
        // 引擎的音频走 OpenAL，会话一旦停用，ALCcontext 就会断开；重连只发生在
        // 引擎收到 UIApplicationDidBecomeActive 且内部 resumeOnBecomingActive 为真时，
        // 进出房间不会触发，于是 setActive:YES 也救不回来，表现为"出房间后彻底没声音"。
        // 只把分类交还游戏，保持会话激活即可。
        [self restoreGameAudioSession];
    });
}

- (void)applicationWillResignActive
{
    dispatch_async(dispatch_get_main_queue(), ^{
        QingVoiceRecordSession *record = self.activeRecord;
        if (record != nil) {
            NSString *tag = record.clientTag;
            [self finishRecord:record cancel:YES];
            [self notifyJs:@"语音录制失败"
                   message:[self recordMessage:tag value:@"录音已取消"]];
        }
        [self stopPlayer:YES];
        [self.preparedEngine stop];
        self.preparedEngine = nil;
        [[AVAudioSession sharedInstance]
            setActive:NO
          withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                error:nil];
        [self restoreGameAudioSession];
    });
}

- (void)applicationDidBecomeActive
{
    dispatch_async(dispatch_get_main_queue(), ^{
        // 回到前台时会话可能仍是停用状态，补一次恢复，否则游戏没有声音。
        [self restoreGameAudioSession];
    });
    // 关键：AppController 是「先 ApplicationDidBecomeActive、后 app->onResume()」，
    // 上面的恢复发生在引擎恢复运行之前，补发的 InterruptionEnded 会被引擎丢掉。
    // 这里等引擎真的跑起来再补一次。
    __weak QingVoiceBridge *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.2 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
        if ([UIApplication sharedApplication].applicationState != UIApplicationStateActive) {
            return;
        }
        [weakSelf restoreGameAudioSession];
        [weakSelf rebuildAudioEngine];
    });
}

/**
 * 重建 Cocos 的音频引擎（OpenAL device + context）。
 *
 * 为什么必须重建：引擎的 AudioEngineSessionHandler 只有在收到
 * AVAudioSessionInterruptionTypeBegan 时才会记 pauseOnResignActive，
 * 而游戏切后台只会收到 UIApplicationWillResignActive —— 引擎两个标志位都是 false，
 * 于是 willResignActive 不置空 context、didBecomeActive 也不重新 makeCurrent，
 * 但 iOS 已经把它底层的 AudioUnit 停掉了。结果是 context 指针还在、播放调用也不报错，
 * 就是不出声。补发 InterruptionEnded 只能走到 alcMakeContextCurrent，救不回 AudioUnit，
 * 唯一可靠的办法是 end() 掉整个引擎再 lazyInit() 重建一套。
 *
 * end() 会 stopAll()，但回前台这一刻本来就没有在播的声音，代价可以接受；
 * 之后任何一次 play2d 都会自己 lazyInit。
 */
- (void)rebuildAudioEngine
{
    if ([NSThread isMainThread] == NO) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [self rebuildAudioEngine];
        });
        return;
    }
    AVAudioSession *session = [AVAudioSession sharedInstance];
    NSLog(@"[QingVoiceBridge] 回前台音频状态 category=%@ mode=%@ options=%lu alContext=%p",
          session.category, session.mode, (unsigned long)session.categoryOptions,
          alcGetCurrentContext());
    cocos2d::AudioEngine::end();
    bool ok = cocos2d::AudioEngine::lazyInit();
    NSLog(@"[QingVoiceBridge] 重建音频引擎 %@ alContext=%p",
          ok ? @"成功" : @"失败", alcGetCurrentContext());
}

- (void)shutdownInternal
{
    [self leaveRoom];
    [self.urlSession invalidateAndCancel];
}

- (void)prepareAudioEngine
{
    if (self.preparedEngine != nil || self.activeRecord != nil) {
        return;
    }
    // 只预创建引擎，不碰 AVAudioSession。
    // 进牌桌时若把会话切成 PlayAndRecord + VoiceChat，游戏音效会走通话通道，
    // 音量被压到通话档、非语音内容还会被 AEC 压制，表现为"进房后音效没了"。
    // 会话配置只在实际录音（beginRecord）和播放语音（startPlayer）时设置。
    self.preparedEngine = [[AVAudioEngine alloc] init];
}

#pragma mark - Game audio session

- (void)captureGameAudioSession
{
    if (self.hasGameAudioSnapshot) {
        return;
    }
    AVAudioSession *session = [AVAudioSession sharedInstance];
    // 已经是录音分类，说明快照被污染，不记录，恢复时回落到 Ambient。
    if ([session.category isEqualToString:AVAudioSessionCategoryPlayAndRecord]) {
        return;
    }
    self.gameAudioCategory = session.category;
    self.gameAudioMode = session.mode;
    self.gameAudioOptions = session.categoryOptions;
    self.hasGameAudioSnapshot = YES;
}

- (void)restoreGameAudioSession
{
    AVAudioSession *session = [AVAudioSession sharedInstance];
    NSError *error = nil;
    BOOL switched = NO;
    if ([session.category isEqualToString:AVAudioSessionCategoryPlayAndRecord]) {
        NSString *category = self.gameAudioCategory.length > 0 ? self.gameAudioCategory
                                                               : AVAudioSessionCategoryAmbient;
        NSString *mode = self.gameAudioMode.length > 0 ? self.gameAudioMode
                                                       : AVAudioSessionModeDefault;
        if (![session setCategory:category mode:mode options:self.gameAudioOptions error:&error]) {
            NSLog(@"[QingVoiceBridge] 恢复游戏音频会话分类失败: %@", error);
        } else {
            switched = YES;
        }
    }
    // 后台不激活；前台补一次激活 —— 会话被停用后引擎的 OpenAL 不会自己重连。
    if ([UIApplication sharedApplication].applicationState != UIApplicationStateActive) {
        return;
    }
    if (![session setActive:YES error:&error]) {
        NSLog(@"[QingVoiceBridge] 重新激活游戏音频会话失败: %@", error);
        return;
    }
    if (switched) {
        NSLog(@"[QingVoiceBridge] 音频会话已交还游戏: category=%@ mode=%@",
              session.category, session.mode);
    }
    [self reconnectOpenALContext];
}

/**
 * 让 Cocos 的 OpenAL 音频引擎重新接管会话。
 *
 * 引擎自己的 AudioEngineSessionHandler 只在收到 AVAudioSessionInterruptionEnded
 * （或回到前台且内部 resumeOnBecomingActive 为真）时才执行 alcMakeContextCurrent(s_ALContext)。
 * 语音录制/播报把 category 切成 PlayAndRecord 再切回来、以及切后台时的 setActive:NO，
 * 都会让底层的 audio unit 重建，但引擎收不到中断回调，于是 ALCcontext 一直悬空：
 * 之后所有 alSourcePlay 都静默失败，表现为"用着用着突然一点声音都没有"，只能重启 App。
 * 这里补发一次等价的 Ended 通知，让引擎把 context 重新设为 current。
 */
- (void)reconnectOpenALContext
{
    if ([NSThread isMainThread] == NO) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [self reconnectOpenALContext];
        });
        return;
    }
    // 防抖：只挡「同一时刻被多个入口重复调用」，不能挡掉回前台的兜底恢复。
    // 之前设 1 秒，正好吞掉 JS 侧 800ms 那次（didBecomeActive 已经先跑过一次），
    // 导致引擎 resume 之后再也收不到 InterruptionEnded，表现为回前台永久静音。
    NSTimeInterval now = [NSDate timeIntervalSinceReferenceDate];
    if (now - self.lastOpenALReconnectTime < 0.35) {
        return;
    }
    self.lastOpenALReconnectTime = now;
    NSLog(@"[QingVoiceBridge] 通知引擎重连 OpenAL context");
    [[NSNotificationCenter defaultCenter]
        postNotificationName:AVAudioSessionInterruptionNotification
                      object:[AVAudioSession sharedInstance]
                    userInfo:@{AVAudioSessionInterruptionTypeKey:
                                   @(AVAudioSessionInterruptionTypeEnded)}];
}

#pragma mark - Helpers

- (NSString *)validateRecord:(QingVoiceRecordSession *)record
{
    if (record.captureError.length > 0) {
        return record.captureError;
    }
    if (record.byteCount < QingVoiceMinBytes) {
        return @"录音时间太短";
    }
    if (!record.hasSignal) {
        return @"麦克风没有采集到声音";
    }
    return nil;
}

- (BOOL)dataContainsSignal:(NSData *)data
{
    const int16_t *samples = (const int16_t *)data.bytes;
    NSUInteger count = data.length / sizeof(int16_t);
    for (NSUInteger index = 0; index < count; index++) {
        if (samples[index] > 1 || samples[index] < -1) {
            return YES;
        }
    }
    return NO;
}

- (NSString *)normalizeBase:(NSString *)base
{
    if (![base isKindOfClass:[NSString class]]) {
        return @"";
    }
    NSString *result =
        [base stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    while ([result hasSuffix:@"/"]) {
        result = [result substringToIndex:result.length - 1];
    }
    NSURLComponents *components = [NSURLComponents componentsWithString:result];
    NSString *scheme = components.scheme.lowercaseString;
    if ((![scheme isEqualToString:@"http"] && ![scheme isEqualToString:@"https"])
            || components.host.length == 0
            || components.user.length > 0
            || components.password.length > 0
            || components.query.length > 0
            || components.fragment.length > 0) {
        return @"";
    }
    return result;
}

- (BOOL)validVoiceId:(NSString *)voiceId
{
    if (voiceId.length != 64) {
        return NO;
    }
    NSCharacterSet *invalid =
        [[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"]
            invertedSet];
    return [voiceId rangeOfCharacterFromSet:invalid].location == NSNotFound;
}

- (BOOL)retryableStatus:(NSInteger)status
{
    return status == 408 || status == 409 || status == 425 || status == 429
        || status >= 500 || status <= 0;
}

- (NSString *)voiceIdFromResponse:(NSData *)data
{
    if (data.length == 0) {
        return @"";
    }
    NSDictionary *root = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    NSDictionary *payload = [root isKindOfClass:[NSDictionary class]] ? root[@"data"] : nil;
    NSString *voiceId =
        [payload isKindOfClass:[NSDictionary class]] ? payload[@"voiceId"] : nil;
    return [voiceId isKindOfClass:[NSString class]] ? voiceId : @"";
}

- (NSString *)errorMessageFromResponse:(NSData *)data status:(NSInteger)status
{
    if (data.length > 0) {
        NSDictionary *root =
            [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        NSDictionary *error =
            [root isKindOfClass:[NSDictionary class]] ? root[@"error"] : nil;
        NSString *message =
            [error isKindOfClass:[NSDictionary class]] ? error[@"message"] : nil;
        if ([message isKindOfClass:[NSString class]] && message.length > 0) {
            return message;
        }
    }
    return [NSString stringWithFormat:@"语音服务器错误(%ld)", (long)status];
}

- (void)completeSuccess:(QingVoiceRecordSession *)record voiceId:(NSString *)voiceId
{
    BOOL shouldNotify = NO;
    @synchronized (record) {
        if (!record.completed) {
            record.completed = YES;
            shouldNotify = !record.cancelled
                && record.roomGeneration == self.roomGeneration;
        }
    }
    if (shouldNotify) {
        [self notifyJs:@"语音录制成功"
               message:[self recordMessage:record.clientTag value:voiceId]];
    }
    [self forgetRecordSession:record];
}

- (void)completeFailure:(QingVoiceRecordSession *)record message:(NSString *)message
{
    BOOL shouldNotify = NO;
    @synchronized (record) {
        if (!record.completed) {
            record.completed = YES;
            shouldNotify = !record.cancelled
                && record.roomGeneration == self.roomGeneration;
        }
    }
    if (shouldNotify) {
        [self notifyJs:@"语音录制失败"
               message:[self recordMessage:record.clientTag
                                      value:message ?: @"语音上传失败"]];
    }
    [self forgetRecordSession:record];
}

- (NSString *)recordMessage:(NSString *)clientTag value:(NSString *)value
{
    return [NSString stringWithFormat:@"%@\n%@",
                                      clientTag ?: @"",
                                      value ?: @""];
}

- (void)notifyJs:(NSString *)type message:(NSString *)message
{
    NSArray *arguments = @[type ?: @"", message ?: @""];
    NSData *jsonData =
        [NSJSONSerialization dataWithJSONObject:arguments options:0 error:nil];
    NSString *json =
        [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
    NSString *script =
        [NSString stringWithFormat:
            @"(function(a){if(cc&&cc.MobileManager){cc.MobileManager.onMsgReturn(a[0],a[1]);}})(%@);",
            json ?: @"[\"\",\"\"]"];
    dispatch_async(dispatch_get_main_queue(), ^{
        se::ScriptEngine::getInstance()->evalString(script.UTF8String);
    });
}

- (NSURL *)cacheDirectory
{
    NSURL *base = [[[NSFileManager defaultManager]
        URLsForDirectory:NSCachesDirectory
               inDomains:NSUserDomainMask] firstObject];
    return [base URLByAppendingPathComponent:@"qing_voice" isDirectory:YES];
}

- (void)ensureCacheDirectory
{
    [[NSFileManager defaultManager]
        createDirectoryAtURL:[self cacheDirectory]
  withIntermediateDirectories:YES
                   attributes:nil
                        error:nil];
}

- (void)pruneCache
{
    NSURL *directory = [self cacheDirectory];
    NSArray<NSURL *> *files =
        [[NSFileManager defaultManager]
            contentsOfDirectoryAtURL:directory
          includingPropertiesForKeys:@[NSURLContentModificationDateKey]
                             options:NSDirectoryEnumerationSkipsHiddenFiles
                               error:nil];
    NSPredicate *m4aPredicate =
        [NSPredicate predicateWithBlock:^BOOL(NSURL *url, NSDictionary *bindings) {
            return [url.pathExtension.lowercaseString isEqualToString:@"m4a"];
        }];
    NSMutableArray<NSURL *> *cached =
        [[files filteredArrayUsingPredicate:m4aPredicate] mutableCopy];
    [cached sortUsingComparator:^NSComparisonResult(NSURL *left, NSURL *right) {
        NSDate *leftDate = nil;
        NSDate *rightDate = nil;
        [left getResourceValue:&leftDate forKey:NSURLContentModificationDateKey error:nil];
        [right getResourceValue:&rightDate forKey:NSURLContentModificationDateKey error:nil];
        return [(leftDate ?: [NSDate distantPast])
            compare:(rightDate ?: [NSDate distantPast])];
    }];
    while (cached.count > QingVoiceCacheLimit) {
        NSURL *oldest = cached.firstObject;
        [[NSFileManager defaultManager] removeItemAtURL:oldest error:nil];
        [cached removeObjectAtIndex:0];
    }
}

@end
