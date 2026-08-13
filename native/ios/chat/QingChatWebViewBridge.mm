#import "QingChatWebViewBridge.h"

#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

@implementation QingChatWebViewBridge

+ (void)Enable
{
    dispatch_async(dispatch_get_main_queue(), ^{
        UIWindow *window = UIApplication.sharedApplication.keyWindow;
        if (window == nil) {
            for (UIWindow *candidate in UIApplication.sharedApplication.windows) {
                if (candidate.isKeyWindow) {
                    window = candidate;
                    break;
                }
            }
        }
        if (window != nil) {
            [self configureView:window];
        }
    });
}

+ (void)configureView:(UIView *)view
{
    if ([view isKindOfClass:WKWebView.class]) {
        WKWebView *webView = (WKWebView *)view;
        webView.opaque = NO;
        webView.backgroundColor = UIColor.clearColor;
        webView.scrollView.backgroundColor = UIColor.clearColor;
    }
    for (UIView *child in view.subviews) {
        [self configureView:child];
    }
}

@end
