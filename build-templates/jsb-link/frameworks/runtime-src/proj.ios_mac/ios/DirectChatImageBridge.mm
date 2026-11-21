#import "DirectChatImageBridge.h"

#import <UIKit/UIKit.h>
#import <AVFoundation/AVFoundation.h>
#import <ImageIO/ImageIO.h>

#include <math.h>

#include "scripting/js-bindings/jswrapper/SeApi.h"

static NSString *const kDirectChatImageErrorDenied = @"denied";
static NSString *const kDirectChatImageErrorUnsupported = @"unsupported";

/**
 * 聊天图片的最长边与编码质量。
 *
 * 这一步不是省流量而是保命：手机相册原图动辄几 MB，原样上传会占满上行带宽几十秒，
 * KBEngine 的心跳包排不上队，22 秒收不到回包就判定掉线，表现就是发完图客户端转圈重连。
 */
static const CGFloat kDirectChatImageMaxEdge = 1600.0;
static const CGFloat kDirectChatImageJpegQuality = 0.85;
/** 低于该体积且不超长边的图片原样上传，避免把小图（含透明 PNG）白白重编码。 */
static const NSUInteger kDirectChatImageRawLimit = 400 * 1024;

@interface DirectChatImageBridge () <UIImagePickerControllerDelegate, UINavigationControllerDelegate>

@property(nonatomic, strong, nullable) UIImagePickerController *picker;
@property(nonatomic, copy) NSString *requestId;

@end

@implementation DirectChatImageBridge

+ (instancetype)sharedBridge
{
    static DirectChatImageBridge *bridge = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        bridge = [[DirectChatImageBridge alloc] init];
    });
    return bridge;
}

+ (void)Pick:(NSString *)requestId
{
    dispatch_async(dispatch_get_main_queue(), ^{
        [[DirectChatImageBridge sharedBridge] startPicking:requestId ?: @"" sourceType:UIImagePickerControllerSourceTypePhotoLibrary];
    });
}

+ (void)TakePhoto:(NSString *)requestId
{
    NSString *request = requestId ?: @"";
    if (![UIImagePickerController isSourceTypeAvailable:UIImagePickerControllerSourceTypeCamera]) {
        [[DirectChatImageBridge sharedBridge] notifyRequest:request path:@"" mime:@"" width:0 height:0 size:0 error:kDirectChatImageErrorUnsupported];
        return;
    }
    AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
    if (status == AVAuthorizationStatusDenied || status == AVAuthorizationStatusRestricted) {
        [[DirectChatImageBridge sharedBridge] notifyRequest:request path:@"" mime:@"" width:0 height:0 size:0 error:kDirectChatImageErrorDenied];
        return;
    }
    if (status == AVAuthorizationStatusNotDetermined) {
        [AVCaptureDevice requestAccessForMediaType:AVMediaTypeVideo completionHandler:^(BOOL granted) {
            dispatch_async(dispatch_get_main_queue(), ^{
                if (granted) {
                    [[DirectChatImageBridge sharedBridge] startPicking:request sourceType:UIImagePickerControllerSourceTypeCamera];
                } else {
                    [[DirectChatImageBridge sharedBridge] notifyRequest:request path:@"" mime:@"" width:0 height:0 size:0 error:kDirectChatImageErrorDenied];
                }
            });
        }];
        return;
    }
    dispatch_async(dispatch_get_main_queue(), ^{
        [[DirectChatImageBridge sharedBridge] startPicking:request sourceType:UIImagePickerControllerSourceTypeCamera];
    });
}

+ (void)shutdown
{
    dispatch_async(dispatch_get_main_queue(), ^{
        DirectChatImageBridge *bridge = [DirectChatImageBridge sharedBridge];
        [bridge.picker dismissViewControllerAnimated:NO completion:nil];
        bridge.picker = nil;
        bridge.requestId = @"";
    });
}

- (void)startPicking:(NSString *)requestId sourceType:(UIImagePickerControllerSourceType)sourceType
{
    [self.picker dismissViewControllerAnimated:NO completion:nil];
    self.picker = nil;
    self.requestId = requestId ?: @"";

    if (![UIImagePickerController isSourceTypeAvailable:sourceType]) {
        NSString *error = sourceType == UIImagePickerControllerSourceTypeCamera
            ? kDirectChatImageErrorUnsupported : @"";
        [self notifyRequest:self.requestId path:@"" mime:@"" width:0 height:0 size:0 error:error];
        self.requestId = @"";
        return;
    }

    UIViewController *presenter = [self topViewController];
    if (presenter == nil) {
        [self notifyRequest:self.requestId path:@"" mime:@"" width:0 height:0 size:0 error:kDirectChatImageErrorUnsupported];
        self.requestId = @"";
        return;
    }

    UIImagePickerController *picker = [[UIImagePickerController alloc] init];
    picker.sourceType = sourceType;
    picker.mediaTypes = @[@"public.image"];
    picker.delegate = self;
    picker.allowsEditing = NO;
    if (sourceType == UIImagePickerControllerSourceTypeCamera) {
        picker.cameraCaptureMode = UIImagePickerControllerCameraCaptureModePhoto;
    }
    self.picker = picker;
    [presenter presentViewController:picker animated:YES completion:nil];
}

- (void)imagePickerController:(UIImagePickerController *)picker
        didFinishPickingMediaWithInfo:(NSDictionary *)info
{
    NSString *requestId = self.requestId ?: @"";
    UIImage *image = info[UIImagePickerControllerOriginalImage];
    NSURL *sourceURL = info[UIImagePickerControllerImageURL];

    NSDictionary *prepared = [self prepareImageDataFromURL:sourceURL image:image];
    NSData *data = prepared[@"data"];
    NSString *mime = prepared[@"mime"] ?: @"image/jpeg";
    NSString *extension = prepared[@"extension"] ?: @"jpg";
    NSInteger width = [prepared[@"width"] integerValue];
    NSInteger height = [prepared[@"height"] integerValue];

    NSString *path = @"";
    if (data.length > 0) {
        NSString *directory = [NSTemporaryDirectory() stringByAppendingPathComponent:@"direct_chat"];
        [[NSFileManager defaultManager] createDirectoryAtPath:directory
                                   withIntermediateDirectories:YES
                                                    attributes:nil
                                                         error:nil];
        path = [directory stringByAppendingPathComponent:
            [NSString stringWithFormat:@"%@.%@", requestId, extension]];
        // 先写临时名再原子替换，避免同名旧文件让体积判断读到上一次的图。
        NSString *temp = [path stringByAppendingString:@".tmp"];
        [[NSFileManager defaultManager] removeItemAtPath:temp error:nil];
        if (![data writeToFile:temp options:NSDataWritingAtomic error:nil]
            || ![[NSFileManager defaultManager] moveItemAtPath:temp toPath:path error:nil]) {
            [[NSFileManager defaultManager] removeItemAtPath:temp error:nil];
            path = @"";
        }
    }

    [self notifyRequest:requestId path:path mime:(path.length > 0 ? mime : @"")
                  width:width height:height size:(path.length > 0 ? data.length : 0)
                  error:(path.length > 0 ? @"" : kDirectChatImageErrorUnsupported)];
    [picker dismissViewControllerAnimated:YES completion:nil];
    self.picker = nil;
    self.requestId = @"";
}

/**
 * 把选中的图片规整成适合聊天的数据。
 *
 * 尺寸和体积都达标时原样返回（保留 PNG/WebP 与透明通道）；超限时才降采样并重编码
 * JPEG。返回 data / mime / extension / width / height，宽高用于气泡按比例排版。
 */
- (NSDictionary *)prepareImageDataFromURL:(NSURL *)sourceURL image:(UIImage *)image
{
    NSData *rawData = nil;
    NSString *rawMime = @"image/jpeg";
    NSString *rawExtension = @"jpg";
    if (sourceURL != nil) {
        NSString *sourceExtension = sourceURL.pathExtension.lowercaseString;
        BOOL supportedSource = [sourceExtension isEqualToString:@"jpg"]
            || [sourceExtension isEqualToString:@"jpeg"]
            || [sourceExtension isEqualToString:@"png"]
            || [sourceExtension isEqualToString:@"webp"];
        if ([sourceExtension isEqualToString:@"png"]) {
            rawMime = @"image/png";
            rawExtension = @"png";
        } else if ([sourceExtension isEqualToString:@"webp"]) {
            rawMime = @"image/webp";
            rawExtension = @"webp";
        }
        if (supportedSource) {
            rawData = [NSData dataWithContentsOfURL:sourceURL options:NSDataReadingMappedIfSafe error:nil];
        }
    }

    CGFloat pixelLongEdge = 0;
    if (image != nil) {
        CGFloat scale = image.scale > 0 ? image.scale : 1.0;
        pixelLongEdge = MAX(image.size.width, image.size.height) * scale;
    }
    // 拿不到 OriginalImage 时用文件体积兜底：大文件一律重编码，宁可多压一次也不堵上行。
    BOOL tooLarge = rawData.length > kDirectChatImageRawLimit;
    BOOL tooWide = pixelLongEdge > kDirectChatImageMaxEdge;
    BOOL needsReencode = (rawData.length == 0) || tooLarge || tooWide;

    if (!needsReencode) {
        CGSize rawSize = [self pixelSizeOfImageData:rawData];
        CGFloat scale = image.scale > 0 ? image.scale : 1.0;
        NSInteger rawWidth = image != nil ? (NSInteger)llround(image.size.width * scale)
                                          : (NSInteger)llround(rawSize.width);
        NSInteger rawHeight = image != nil ? (NSInteger)llround(image.size.height * scale)
                                           : (NSInteger)llround(rawSize.height);
        return @{
            @"data": rawData,
            @"mime": rawMime,
            @"extension": rawExtension,
            @"width": @(rawWidth),
            @"height": @(rawHeight)
        };
    }

    // 优先走 ImageIO 降采样：只解出目标尺寸的位图，不会为一张 12MP 照片分配 48MB 内存；
    // kCGImageSourceCreateThumbnailWithTransform 会顺带按 EXIF 方向转正。
    UIImage *source = [self downsampledImageFromData:rawData maxEdge:kDirectChatImageMaxEdge];
    if (source == nil) {
        source = image != nil ? image : [UIImage imageWithData:rawData];
    }
    NSData *jpeg = source != nil ? [self jpegDataFromImage:source] : nil;
    if (jpeg.length == 0) {
        // 重编码失败就退回原数据，别让用户发不出图（服务端还会再校验一次）。
        if (rawData.length == 0) {
            return @{@"data": [NSData data], @"mime": @"", @"extension": @"jpg",
                     @"width": @0, @"height": @0};
        }
        CGSize rawSize = [self pixelSizeOfImageData:rawData];
        CGFloat scale = image.scale > 0 ? image.scale : 1.0;
        return @{
            @"data": rawData,
            @"mime": rawMime,
            @"extension": rawExtension,
            @"width": @(image != nil ? (NSInteger)llround(image.size.width * scale)
                                     : (NSInteger)llround(rawSize.width)),
            @"height": @(image != nil ? (NSInteger)llround(image.size.height * scale)
                                      : (NSInteger)llround(rawSize.height))
        };
    }
    CGSize finalSize = [self pixelSizeOfImageData:jpeg];
    return @{
        @"data": jpeg,
        @"mime": @"image/jpeg",
        @"extension": @"jpg",
        @"width": @((NSInteger)llround(finalSize.width)),
        @"height": @((NSInteger)llround(finalSize.height))
    };
}

- (void)imagePickerControllerDidCancel:(UIImagePickerController *)picker
{
    NSString *requestId = self.requestId ?: @"";
    [self notifyRequest:requestId path:@"" mime:@"" width:0 height:0 size:0 error:@""];
    [picker dismissViewControllerAnimated:YES completion:nil];
    self.picker = nil;
    self.requestId = @"";
}

/** 按最长边上限等比重绘后编码 JPEG；透明区域铺白底，避免转 JPEG 后变黑。 */
- (NSData *)jpegDataFromImage:(UIImage *)image
{
    CGFloat scale = image.scale > 0 ? image.scale : 1.0;
    CGFloat width = image.size.width * scale;
    CGFloat height = image.size.height * scale;
    if (width <= 0 || height <= 0) {
        return nil;
    }
    CGFloat longEdge = MAX(width, height);
    CGSize target = CGSizeMake(width, height);
    if (longEdge > kDirectChatImageMaxEdge) {
        CGFloat ratio = kDirectChatImageMaxEdge / longEdge;
        target = CGSizeMake(MAX(1.0, llround(width * ratio)), MAX(1.0, llround(height * ratio)));
    }
    UIGraphicsBeginImageContextWithOptions(target, YES, 1.0);
    if (UIGraphicsGetCurrentContext() == nil) {
        UIGraphicsEndImageContext();
        return UIImageJPEGRepresentation(image, kDirectChatImageJpegQuality);
    }
    [[UIColor whiteColor] setFill];
    UIRectFill(CGRectMake(0, 0, target.width, target.height));
    [image drawInRect:CGRectMake(0, 0, target.width, target.height)];
    UIImage *scaled = UIGraphicsGetImageFromCurrentImageContext();
    UIGraphicsEndImageContext();
    return UIImageJPEGRepresentation(scaled ?: image, kDirectChatImageJpegQuality);
}

/**
 * 用 ImageIO 把图片数据直接降采样到最长边上限。
 *
 * 相比 UIImage 全量解码，这里只解出目标尺寸的位图：一张 12MP 相册图全解码要
 * 48MB，在低端机上很容易触发内存告警。
 */
- (UIImage *)downsampledImageFromData:(NSData *)data maxEdge:(CGFloat)maxEdge
{
    if (data.length == 0 || maxEdge <= 0) {
        return nil;
    }
    CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, NULL);
    if (source == NULL) {
        return nil;
    }
    NSDictionary *options = @{
        (__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
        // 按 EXIF 方向转正，省掉自己读写 orientation 的分支。
        (__bridge NSString *)kCGImageSourceCreateThumbnailWithTransform: @YES,
        (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize: @((NSInteger)llround(maxEdge))
    };
    CGImageRef thumbnail = CGImageSourceCreateThumbnailAtIndex(
        source, 0, (__bridge CFDictionaryRef)options);
    CFRelease(source);
    if (thumbnail == NULL) {
        return nil;
    }
    UIImage *result = [UIImage imageWithCGImage:thumbnail
                                          scale:1.0
                                    orientation:UIImageOrientationUp];
    CGImageRelease(thumbnail);
    return result;
}

/** 不解码像素，只读图片头里的宽高。 */
- (CGSize)pixelSizeOfImageData:(NSData *)data
{
    if (data.length == 0) {
        return CGSizeZero;
    }
    CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, NULL);
    if (source == NULL) {
        return CGSizeZero;
    }
    CGSize size = CGSizeZero;
    CFDictionaryRef properties = CGImageSourceCopyPropertiesAtIndex(source, 0, NULL);
    if (properties != NULL) {
        NSNumber *width = (__bridge NSNumber *)CFDictionaryGetValue(
            properties, kCGImagePropertyPixelWidth);
        NSNumber *height = (__bridge NSNumber *)CFDictionaryGetValue(
            properties, kCGImagePropertyPixelHeight);
        size = CGSizeMake(width.doubleValue, height.doubleValue);
        CFRelease(properties);
    }
    CFRelease(source);
    return size;
}

- (UIViewController *)topViewController
{
    UIWindow *window = UIApplication.sharedApplication.keyWindow;
    if (window == nil) {
        for (UIWindow *candidate in UIApplication.sharedApplication.windows) {
            if (candidate.isKeyWindow) {
                window = candidate;
                break;
            }
        }
    }
    UIViewController *controller = window.rootViewController;
    while (controller.presentedViewController != nil) {
        controller = controller.presentedViewController;
    }
    if ([controller isKindOfClass:UINavigationController.class]) {
        return [self topFromNavigationController:(UINavigationController *)controller];
    }
    if ([controller isKindOfClass:UITabBarController.class]) {
        return [self topViewControllerFromController:((UITabBarController *)controller).selectedViewController];
    }
    return controller;
}

- (UIViewController *)topFromNavigationController:(UINavigationController *)controller
{
    return [self topViewControllerFromController:controller.visibleViewController];
}

- (UIViewController *)topViewControllerFromController:(UIViewController *)controller
{
    UIViewController *current = controller;
    while (current.presentedViewController != nil) {
        current = current.presentedViewController;
    }
    if ([current isKindOfClass:UINavigationController.class]) {
        return [self topFromNavigationController:(UINavigationController *)current];
    }
    if ([current isKindOfClass:UITabBarController.class]) {
        return [self topViewControllerFromController:
            ((UITabBarController *)current).selectedViewController];
    }
    return current;
}

- (void)notifyRequest:(NSString *)requestId
                 path:(NSString *)path
                 mime:(NSString *)mime
                width:(NSInteger)width
               height:(NSInteger)height
                 size:(NSUInteger)size
                error:(NSString *)error
{
    NSDictionary *payload = @{
        @"requestId": requestId ?: @"",
        @"path": path ?: @"",
        @"mime": mime ?: @"",
        @"width": @(width),
        @"height": @(height),
        @"size": @(size),
        @"error": error ?: @""
    };
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
    NSString *json = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
    if (json.length == 0) {
        return;
    }
    NSString *script = [NSString stringWithFormat:
        @"if(window.DirectChatImagePicked){window.DirectChatImagePicked(%@);}", json];
    se::ScriptEngine::getInstance()->evalString(script.UTF8String);
}

@end
