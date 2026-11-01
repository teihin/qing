#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/** 原生直聊图片桥：相册选图与拍照，均把缓存路径回调给 JS。 */
@interface DirectChatImageBridge : NSObject

+ (void)Pick:(NSString *)requestId;
+ (void)TakePhoto:(NSString *)requestId;
+ (void)shutdown;

@end

NS_ASSUME_NONNULL_END
