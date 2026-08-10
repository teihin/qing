#import "QingDeviceBridge.h"

#import <Security/Security.h>

static NSString *const QingDeviceIdentityService = @"com.fireball.qing.device-identity";
static NSString *const QingDeviceIdentityAccount = @"primary";

@implementation QingDeviceBridge

+ (NSMutableDictionary *)baseQuery
{
    return [@{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: QingDeviceIdentityService,
        (__bridge id)kSecAttrAccount: QingDeviceIdentityAccount,
        (__bridge id)kSecAttrSynchronizable: @NO
    } mutableCopy];
}

+ (NSString *)readStoredDeviceId
{
    NSMutableDictionary *query = [self baseQuery];
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status != errSecSuccess || result == NULL) {
        if (result != NULL) {
            CFRelease(result);
        }
        return @"";
    }
    NSData *data = CFBridgingRelease(result);
    NSString *value = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    return value ?: @"";
}

+ (NSString *)GetDeviceId
{
    NSString *stored = [self readStoredDeviceId];
    if (stored.length >= 8 && stored.length <= 255) {
        return stored;
    }

    NSString *created = [[NSUUID UUID] UUIDString].lowercaseString;
    NSData *data = [created dataUsingEncoding:NSUTF8StringEncoding];
    NSMutableDictionary *item = [self baseQuery];
    item[(__bridge id)kSecValueData] = data;
    item[(__bridge id)kSecAttrAccessible] =
        (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
    OSStatus status = SecItemAdd((__bridge CFDictionaryRef)item, NULL);
    if (status == errSecSuccess) {
        return created;
    }
    if (status == errSecDuplicateItem) {
        return [self readStoredDeviceId];
    }
    return @"";
}

@end
