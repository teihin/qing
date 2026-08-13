package org.cocos2dx.javascript;

import android.annotation.TargetApi;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.Toast;

/**
 * 为 Cocos Creator 2.4.13 的内嵌客服 WebView 补齐透明背景和文件选择。
 *
 * Creator 2.4.13 Android 默认只安装空 WebChromeClient，HTML file input
 * 不会弹出系统选择器。本桥接只接管游戏进程内的 WebView，不申请存储权限，
 * 图片和视频通过系统文档选择器以 content URI 返回给网页上传控件。
 */
public final class QingChatWebViewBridge {
    private static final int FILE_CHOOSER_REQUEST = 9992;

    private static AppActivity activity;
    private static ValueCallback<Uri[]> modernCallback;
    private static ValueCallback<Uri> legacyCallback;

    private QingChatWebViewBridge() {
    }

    public static synchronized void initialize(AppActivity value) {
        activity = value;
    }

    public static void Enable() {
        final AppActivity current = activity;
        if (current == null) {
            return;
        }
        current.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                View root = current.getWindow().getDecorView();
                configureWebViews(root);
            }
        });
    }

    public static synchronized void shutdown() {
        cancelPendingSelection();
        activity = null;
    }

    public static synchronized boolean onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != FILE_CHOOSER_REQUEST) {
            return false;
        }

        if (modernCallback != null) {
            Uri[] result = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            } else if (resultCode == Activity.RESULT_OK && data != null && data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
            modernCallback.onReceiveValue(result);
            modernCallback = null;
        }
        if (legacyCallback != null) {
            Uri result = resultCode == Activity.RESULT_OK && data != null ? data.getData() : null;
            legacyCallback.onReceiveValue(result);
            legacyCallback = null;
        }
        return true;
    }

    private static void configureWebViews(View view) {
        if (view instanceof WebView) {
            WebView webView = (WebView) view;
            webView.setBackgroundColor(Color.TRANSPARENT);
            webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
            webView.setWebChromeClient(new ChatWebChromeClient());
        }
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int index = 0; index < group.getChildCount(); index++) {
                configureWebViews(group.getChildAt(index));
            }
        }
    }

    private static synchronized void openChooser(Intent intent) {
        AppActivity current = activity;
        if (current == null) {
            cancelPendingSelection();
            return;
        }
        try {
            current.startActivityForResult(intent, FILE_CHOOSER_REQUEST);
        } catch (ActivityNotFoundException error) {
            cancelPendingSelection();
            Toast.makeText(current, "手机没有可用的图片或视频选择器", Toast.LENGTH_SHORT).show();
        }
    }

    private static Intent fallbackChooser(String acceptType) {
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(acceptType == null || acceptType.length() == 0 ? "*/*" : acceptType);
        return Intent.createChooser(intent, "选择图片或视频");
    }

    private static synchronized void cancelPendingSelection() {
        if (modernCallback != null) {
            modernCallback.onReceiveValue(null);
            modernCallback = null;
        }
        if (legacyCallback != null) {
            legacyCallback.onReceiveValue(null);
            legacyCallback = null;
        }
    }

    private static final class ChatWebChromeClient extends WebChromeClient {
        @Override
        @TargetApi(Build.VERSION_CODES.LOLLIPOP)
        public boolean onShowFileChooser(
                WebView webView,
                ValueCallback<Uri[]> filePathCallback,
                FileChooserParams fileChooserParams) {
            cancelPendingSelection();
            modernCallback = filePathCallback;
            Intent intent;
            try {
                intent = fileChooserParams.createIntent();
            } catch (RuntimeException error) {
                intent = fallbackChooser("*/*");
            }
            openChooser(intent);
            return true;
        }

        // Android 4.x WebView 使用的兼容入口；保留以覆盖旧机型。
        @SuppressWarnings("unused")
        public void openFileChooser(ValueCallback<Uri> callback) {
            openFileChooser(callback, "*/*");
        }

        @SuppressWarnings("unused")
        public void openFileChooser(ValueCallback<Uri> callback, String acceptType) {
            cancelPendingSelection();
            legacyCallback = callback;
            openChooser(fallbackChooser(acceptType));
        }

        @SuppressWarnings("unused")
        public void openFileChooser(ValueCallback<Uri> callback, String acceptType, String capture) {
            openFileChooser(callback, acceptType);
        }
    }
}
