#import <Foundation/Foundation.h>
#import "AppController.h"

NS_ASSUME_NONNULL_BEGIN

@interface AppController (QingAppServices)

+ (NSString *)GetCurGps;
+ (void)saveTextureToLocal:(NSString *)filePath;
+ (void)CopyData:(NSString *)text;
+ (void)GetCopyData;

@end

NS_ASSUME_NONNULL_END
