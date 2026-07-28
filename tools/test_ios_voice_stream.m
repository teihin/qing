#import <Foundation/Foundation.h>

@interface QingVoiceStreamProbe : NSObject <
    NSURLSessionDataDelegate,
    NSURLSessionTaskDelegate
>

@property(nonatomic, strong) NSURLSession *session;
@property(nonatomic, strong) NSInputStream *inputStream;
@property(nonatomic, strong) NSOutputStream *outputStream;
@property(nonatomic, strong) NSMutableData *responseData;
@property(nonatomic, assign) NSInteger responseStatus;
@property(nonatomic, assign) NSInteger bodyStreamRequests;
@property(nonatomic, strong) dispatch_semaphore_t finished;
@property(nonatomic, strong) NSError *taskError;

- (BOOL)run:(NSURL *)url;

@end

@implementation QingVoiceStreamProbe

- (instancetype)init
{
    self = [super init];
    if (self) {
        _responseData = [NSMutableData data];
        _finished = dispatch_semaphore_create(0);
        NSOperationQueue *queue = [[NSOperationQueue alloc] init];
        queue.maxConcurrentOperationCount = 1;
        NSURLSessionConfiguration *configuration =
            [NSURLSessionConfiguration ephemeralSessionConfiguration];
        configuration.timeoutIntervalForRequest = 8.0;
        configuration.timeoutIntervalForResource = 8.0;
        _session = [NSURLSession sessionWithConfiguration:configuration
                                                 delegate:self
                                            delegateQueue:queue];
    }
    return self;
}

- (BOOL)run:(NSURL *)url
{
    CFReadStreamRef readStream = NULL;
    CFWriteStreamRef writeStream = NULL;
    CFStreamCreateBoundPair(kCFAllocatorDefault, &readStream, &writeStream, 64 * 1024);
    if (readStream == NULL || writeStream == NULL) {
        return NO;
    }
    self.inputStream = (__bridge_transfer NSInputStream *)readStream;
    self.outputStream = (__bridge_transfer NSOutputStream *)writeStream;

    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = @"POST";
    [request setValue:@"application/octet-stream" forHTTPHeaderField:@"Content-Type"];
    [request setValue:@"ios_stream_probe_0001" forHTTPHeaderField:@"X-Request-ID"];
    [request setValue:@"100-continue" forHTTPHeaderField:@"Expect"];
    NSURLSessionUploadTask *task =
        [self.session uploadTaskWithStreamedRequest:request];

    NSMutableData *pcm = [NSMutableData dataWithLength:32000];
    int16_t *samples = pcm.mutableBytes;
    for (NSUInteger index = 0; index < 16000; index++) {
        samples[index] = (int16_t)((index % 200) - 100) * 120;
    }

    [self.outputStream open];
    [task resume];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        const uint8_t *bytes = pcm.bytes;
        NSUInteger offset = 0;
        while (offset < pcm.length) {
            NSInteger written =
                [self.outputStream write:bytes + offset
                               maxLength:MIN((NSUInteger)2048, pcm.length - offset)];
            if (written < 0) {
                break;
            }
            if (written == 0) {
                usleep(1000);
                continue;
            }
            offset += (NSUInteger)written;
        }
        [self.outputStream close];
    });

    long waitResult = dispatch_semaphore_wait(
        self.finished,
        dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
    [self.session invalidateAndCancel];
    BOOL validJSON = NO;
    if (self.responseData.length > 0) {
        NSDictionary *root =
            [NSJSONSerialization JSONObjectWithData:self.responseData options:0 error:nil];
        NSDictionary *data =
            [root isKindOfClass:[NSDictionary class]] ? root[@"data"] : nil;
        NSString *voiceId =
            [data isKindOfClass:[NSDictionary class]] ? data[@"voiceId"] : nil;
        validJSON = [voiceId isKindOfClass:[NSString class]] && voiceId.length == 64;
    }
    NSLog(@"status=%ld streamRequests=%ld responseBytes=%lu error=%@",
          (long)self.responseStatus,
          (long)self.bodyStreamRequests,
          (unsigned long)self.responseData.length,
          self.taskError);
    return waitResult == 0
        && self.taskError == nil
        && self.responseStatus == 201
        && self.bodyStreamRequests == 1
        && validJSON;
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
 needNewBodyStream:(void (^)(NSInputStream *bodyStream))completionHandler
{
    self.bodyStreamRequests += 1;
    completionHandler(self.bodyStreamRequests == 1 ? self.inputStream : nil);
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
didReceiveResponse:(NSURLResponse *)response
 completionHandler:(void (^)(NSURLSessionResponseDisposition disposition))completionHandler
{
    self.responseStatus = ((NSHTTPURLResponse *)response).statusCode;
    completionHandler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
    didReceiveData:(NSData *)data
{
    [self.responseData appendData:data];
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
didCompleteWithError:(NSError *)error
{
    self.taskError = error;
    dispatch_semaphore_signal(self.finished);
}

@end

int main(int argc, const char *argv[])
{
    @autoreleasepool {
        if (argc != 2) {
            NSLog(@"usage: test_ios_voice_stream <upload-url>");
            return 2;
        }
        NSURL *url = [NSURL URLWithString:[NSString stringWithUTF8String:argv[1]]];
        QingVoiceStreamProbe *probe = [[QingVoiceStreamProbe alloc] init];
        return [probe run:url] ? 0 : 1;
    }
}
