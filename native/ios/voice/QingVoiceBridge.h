#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface QingVoiceBridge : NSObject

+ (void)initializeBridge;
+ (void)Prepare:(NSString *)serverBase;
+ (void)StartRecord:(NSString *)serverBase clientTag:(NSString *)clientTag;
+ (void)StopRecord;
+ (void)CancelRecord;
+ (void)PlayFile:(NSString *)serverBase voiceId:(NSString *)voiceId;
+ (void)PreloadFile:(NSString *)serverBase voiceId:(NSString *)voiceId;
+ (void)LeaveRoom;
+ (void)ApplicationWillResignActive;
+ (void)shutdownBridge;

@end

NS_ASSUME_NONNULL_END
