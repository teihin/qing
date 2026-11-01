#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/** 原生直聊图片选择桥：从系统相册选择图片并把缓存路径回调给 JS。 */
@interface DirectChatImageBridge : NSObject

+ (void)Pick:(NSString *)requestId;
+ (void)shutdown;

@end

NS_ASSUME_NONNULL_END
