#import "DirectChatImageBridge.h"

#import <UIKit/UIKit.h>

#include <math.h>

#include "scripting/js-bindings/jswrapper/SeApi.h"

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
        [[DirectChatImageBridge sharedBridge] startPicking:requestId ?: @""];
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

- (void)startPicking:(NSString *)requestId
{
    [self.picker dismissViewControllerAnimated:NO completion:nil];
    self.picker = nil;
    self.requestId = requestId ?: @"";

    if (![UIImagePickerController isSourceTypeAvailable:UIImagePickerControllerSourceTypePhotoLibrary]) {
        [self notifyRequest:self.requestId path:@"" mime:@"" width:0 height:0 size:0];
        self.requestId = @"";
        return;
    }

    UIViewController *presenter = [self topViewController];
    if (presenter == nil) {
        [self notifyRequest:self.requestId path:@"" mime:@"" width:0 height:0 size:0];
        self.requestId = @"";
        return;
    }

    UIImagePickerController *picker = [[UIImagePickerController alloc] init];
    picker.sourceType = UIImagePickerControllerSourceTypePhotoLibrary;
    picker.mediaTypes = @[@"public.image"];
    picker.delegate = self;
    picker.allowsEditing = NO;
    self.picker = picker;
    [presenter presentViewController:picker animated:YES completion:nil];
}

- (void)imagePickerController:(UIImagePickerController *)picker
        didFinishPickingMediaWithInfo:(NSDictionary *)info
{
    NSString *requestId = self.requestId ?: @"";
    UIImage *image = info[UIImagePickerControllerOriginalImage];
    NSURL *sourceURL = info[UIImagePickerControllerImageURL];
    NSData *data = nil;
    NSString *mime = @"image/jpeg";
    NSString *extension = @"jpg";

    if (sourceURL != nil) {
        NSString *sourceExtension = sourceURL.pathExtension.lowercaseString;
        BOOL supportedSource = [sourceExtension isEqualToString:@"jpg"]
            || [sourceExtension isEqualToString:@"jpeg"]
            || [sourceExtension isEqualToString:@"png"]
            || [sourceExtension isEqualToString:@"webp"];
        if ([sourceExtension isEqualToString:@"png"]) {
            mime = @"image/png";
            extension = @"png";
        } else if ([sourceExtension isEqualToString:@"webp"]) {
            mime = @"image/webp";
            extension = @"webp";
        }
        if (supportedSource) {
            data = [NSData dataWithContentsOfURL:sourceURL options:NSDataReadingMappedIfSafe error:nil];
        }
    }

    if (data == nil && image != nil) {
        data = UIImageJPEGRepresentation(image, 0.92);
        mime = @"image/jpeg";
        extension = @"jpg";
    }

    NSString *path = @"";
    if (data.length > 0) {
        NSString *directory = [NSTemporaryDirectory() stringByAppendingPathComponent:@"direct_chat"];
        [[NSFileManager defaultManager] createDirectoryAtPath:directory
                                   withIntermediateDirectories:YES
                                                    attributes:nil
                                                         error:nil];
        path = [directory stringByAppendingPathComponent:
            [NSString stringWithFormat:@"%@.%@", requestId, extension]];
        if (![data writeToFile:path options:NSDataWritingAtomic error:nil]) {
            path = @"";
        }
    }

    NSInteger width = image != nil ? (NSInteger)llround(image.size.width * image.scale) : 0;
    NSInteger height = image != nil ? (NSInteger)llround(image.size.height * image.scale) : 0;
    [self notifyRequest:requestId path:path mime:(path.length > 0 ? mime : @"")
                  width:width height:height size:(path.length > 0 ? data.length : 0)];
    [picker dismissViewControllerAnimated:YES completion:nil];
    self.picker = nil;
    self.requestId = @"";
}

- (void)imagePickerControllerDidCancel:(UIImagePickerController *)picker
{
    NSString *requestId = self.requestId ?: @"";
    [self notifyRequest:requestId path:@"" mime:@"" width:0 height:0 size:0];
    [picker dismissViewControllerAnimated:YES completion:nil];
    self.picker = nil;
    self.requestId = @"";
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
        UITabBarController *tabs = (UITabBarController *)controller;
        return [self topViewControllerFromController:tabs.selectedViewController];
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
            [(UITabBarController *)current selectedViewController]];
    }
    return current;
}

- (void)notifyRequest:(NSString *)requestId
                 path:(NSString *)path
                 mime:(NSString *)mime
                width:(NSInteger)width
               height:(NSInteger)height
                 size:(NSUInteger)size
{
    NSDictionary *payload = @{
        @"requestId": requestId ?: @"",
        @"path": path ?: @"",
        @"mime": mime ?: @"",
        @"width": @(width),
        @"height": @(height),
        @"size": @(size)
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
