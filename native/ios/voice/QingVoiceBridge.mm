#import "QingVoiceBridge.h"

#import <AVFoundation/AVFoundation.h>
#import <UIKit/UIKit.h>

#include "scripting/js-bindings/jswrapper/SeApi.h"

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
@property(nonatomic) dispatch_queue_t networkQueue;

- (void)cancelRecordSession:(QingVoiceRecordSession *)record;
- (void)forgetRecordSession:(QingVoiceRecordSession *)record;

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

+ (void)ApplicationWillResignActive
{
    [[QingVoiceBridge sharedBridge] applicationWillResignActive];
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
    [audioSession setCategory:AVAudioSessionCategoryPlayAndRecord
                         mode:AVAudioSessionModeVoiceChat
                      options:(AVAudioSessionCategoryOptionDefaultToSpeaker |
                               AVAudioSessionCategoryOptionAllowBluetooth)
                        error:&sessionError];
    [audioSession setActive:YES error:&sessionError];

    NSError *playerError = nil;
    AVAudioPlayer *player = [[AVAudioPlayer alloc] initWithContentsOfURL:fileURL
                                                                  error:&playerError];
    if (player == nil || playerError != nil) {
        [self notifyJs:@"语音播放失败"
               message:playerError.localizedDescription ?: @"语音解码失败"];
        return;
    }
    self.player = player;
    self.playerGeneration = generation;
    player.delegate = self;
    [player prepareToPlay];
    if (![player play]) {
        [self stopPlayer:NO];
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
        [[AVAudioSession sharedInstance]
            setActive:NO
          withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                error:nil];
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
    });
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
    AVAudioSession *audioSession = [AVAudioSession sharedInstance];
    [audioSession setCategory:AVAudioSessionCategoryPlayAndRecord
                         mode:AVAudioSessionModeVoiceChat
                      options:(AVAudioSessionCategoryOptionDefaultToSpeaker |
                               AVAudioSessionCategoryOptionAllowBluetooth)
                        error:nil];
    [audioSession setPreferredSampleRate:QingVoiceSampleRate error:nil];
    [audioSession setPreferredIOBufferDuration:0.01 error:nil];
    self.preparedEngine = [[AVAudioEngine alloc] init];
    (void)self.preparedEngine.inputNode;
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
