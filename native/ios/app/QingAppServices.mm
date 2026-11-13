#import "QingAppServices.h"

#import <UIKit/UIKit.h>
#import <CoreLocation/CoreLocation.h>
#include "scripting/js-bindings/jswrapper/SeApi.h"

/**
 * AppController 由 Creator 生成，重建会覆盖手写方法。
 * 位置、相册保存和剪贴板接口放在项目级分类里，配合 sync_ios_app_services.py 接回工程。
 */
@interface QingAppLocationService : NSObject <CLLocationManagerDelegate>

@property (nonatomic, strong, nullable) CLLocationManager *locationManager;
@property (nonatomic, copy, nullable) NSString *lastLocation;

@end

@implementation QingAppLocationService

- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)manager
{
    if (@available(iOS 14.0, *)) {
        if (manager.authorizationStatus == kCLAuthorizationStatusAuthorizedWhenInUse ||
            manager.authorizationStatus == kCLAuthorizationStatusAuthorizedAlways) {
            [manager startUpdatingLocation];
        }
    }
}

- (void)locationManager:(CLLocationManager *)manager didChangeAuthorizationStatus:(CLAuthorizationStatus)status
{
    if (status == kCLAuthorizationStatusAuthorizedWhenInUse || status == kCLAuthorizationStatusAuthorizedAlways) {
        [manager startUpdatingLocation];
    }
}

- (void)locationManager:(CLLocationManager *)manager didUpdateLocations:(NSArray<CLLocation *> *)locations
{
    CLLocation *location = locations.lastObject;
    if (location) {
        self.lastLocation = [NSString stringWithFormat:@"%.6f,%.6f",
            location.coordinate.latitude, location.coordinate.longitude];
    }
}

- (void)locationManager:(CLLocationManager *)manager didFailWithError:(NSError *)error
{
    if (error.code != kCLErrorLocationUnknown) {
        self.lastLocation = @"0,0";
    }
}

@end

static QingAppLocationService *QingSharedLocationService(void)
{
    static QingAppLocationService *service = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        service = [[QingAppLocationService alloc] init];
    });
    return service;
}

@implementation AppController (QingAppServices)

+ (NSString *)GetCurGps
{
    QingAppLocationService *service = QingSharedLocationService();
    if (![CLLocationManager locationServicesEnabled]) {
        return @"0,0";
    }

    CLAuthorizationStatus status;
    if (@available(iOS 14.0, *)) {
        status = service.locationManager ? service.locationManager.authorizationStatus
                                         : kCLAuthorizationStatusNotDetermined;
    } else {
        status = [CLLocationManager authorizationStatus];
    }
    if (status == kCLAuthorizationStatusDenied || status == kCLAuthorizationStatusRestricted) {
        return @"0,0";
    }

    if (!service.locationManager) {
        service.lastLocation = @"0,0";
        service.locationManager = [[CLLocationManager alloc] init];
        service.locationManager.delegate = service;
        service.locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters;
        service.locationManager.distanceFilter = 10.0;
    }
    if (status == kCLAuthorizationStatusNotDetermined) {
        [service.locationManager requestWhenInUseAuthorization];
    } else {
        [service.locationManager startUpdatingLocation];
    }
    return service.lastLocation ?: @"0,0";
}

+ (void)saveTextureToLocal:(NSString *)filePath
{
    UIImage *image = [UIImage imageWithContentsOfFile:filePath];
    if (image) {
        UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil);
    }
}

+ (void)CopyData:(NSString *)text
{
    [UIPasteboard generalPasteboard].string = text ?: @"";
}

+ (void)GetCopyData
{
    NSString *text = [UIPasteboard generalPasteboard].string ?: @"";
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:@[text] options:0 error:nil];
    NSString *jsonArray = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
    NSString *jsonString = [jsonArray substringWithRange:NSMakeRange(1, jsonArray.length - 2)];
    NSString *script = [NSString stringWithFormat:@"cc.MobileManager.onMsgReturn(\"粘贴\",%@);", jsonString];
    se::ScriptEngine::getInstance()->evalString([script UTF8String]);
}

@end
