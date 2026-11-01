package org.cocos2dx.javascript;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;

import org.cocos2dx.lib.Cocos2dxJavascriptJavaBridge;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 原生直聊图片选择桥：选图后复制到应用缓存，再把本地路径交给 JS 上传。 */
public final class DirectChatImageBridge {
    public static final int PICK_REQUEST = 9993;

    private static AppActivity activity;
    private static String pendingRequestId = "";
    private static final ExecutorService executor = Executors.newSingleThreadExecutor();

    private DirectChatImageBridge() {
    }

    public static synchronized void initialize(AppActivity value) {
        activity = value;
    }

    public static void Pick(final String requestId) {
        final AppActivity current;
        synchronized (DirectChatImageBridge.class) {
            current = activity;
            pendingRequestId = requestId == null ? "" : requestId;
        }
        if (current == null) {
            notifyPicked(requestId, "", "", 0, 0, 0);
            return;
        }
        current.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Intent intent;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                } else {
                    intent = new Intent(Intent.ACTION_GET_CONTENT);
                }
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES,
                        new String[]{"image/jpeg", "image/png", "image/webp"});
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                }
                try {
                    current.startActivityForResult(intent, PICK_REQUEST);
                } catch (RuntimeException error) {
                    clearPending();
                    notifyPicked(requestId, "", "", 0, 0, 0);
                }
            }
        });
    }

    public static synchronized boolean onActivityResult(
            int requestCode, int resultCode, Intent data) {
        if (requestCode != PICK_REQUEST) {
            return false;
        }
        final String requestId = pendingRequestId;
        pendingRequestId = "";
        final AppActivity current = activity;
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            notifyPicked(requestId, "", "", 0, 0, 0);
            return true;
        }
        if (current == null) {
            notifyPicked(requestId, "", "", 0, 0, 0);
            return true;
        }
        final Uri uri = data.getData();
        executor.execute(new Runnable() {
            @Override
            public void run() {
                copyToCache(current, requestId, uri);
            }
        });
        return true;
    }

    public static synchronized void shutdown() {
        pendingRequestId = "";
        activity = null;
    }

    private static void copyToCache(AppActivity current, String requestId, Uri uri) {
        ContentResolver resolver = current.getContentResolver();
        String mime = normalizeMime(resolver.getType(uri));
        boolean reencodeAsJpeg = mime.length() == 0;
        if (reencodeAsJpeg)
            mime = "image/jpeg";
        File directory = new File(current.getCacheDir(), "direct_chat");
        if (!directory.exists() && !directory.mkdirs()) {
            notifyPicked(requestId, "", "", 0, 0, 0);
            return;
        }
        String extension = mime.equals("image/png") ? ".png"
                : (mime.equals("image/webp") ? ".webp" : ".jpg");
        File target = new File(directory, requestId + extension);
        try {
            if (reencodeAsJpeg) {
                try (InputStream input = resolver.openInputStream(uri);
                     OutputStream output = new FileOutputStream(target, false)) {
                    if (input == null) {
                        notifyPicked(requestId, "", "", 0, 0, 0);
                        return;
                    }
                    Bitmap bitmap = BitmapFactory.decodeStream(input);
                    if (bitmap == null || !bitmap.compress(Bitmap.CompressFormat.JPEG, 92, output)) {
                        notifyPicked(requestId, "", "", 0, 0, 0);
                        return;
                    }
                    bitmap.recycle();
                }
            } else {
                try (InputStream input = resolver.openInputStream(uri);
                     OutputStream output = new FileOutputStream(target, false)) {
                    if (input == null) {
                        notifyPicked(requestId, "", "", 0, 0, 0);
                        return;
                    }
                    byte[] buffer = new byte[64 * 1024];
                    int count;
                    while ((count = input.read(buffer)) >= 0) {
                        if (count > 0)
                            output.write(buffer, 0, count);
                    }
                    output.flush();
                }
            }
        } catch (Exception error) {
            notifyPicked(requestId, "", "", 0, 0, 0);
            return;
        }
        if (!target.isFile() || target.length() <= 0) {
            notifyPicked(requestId, "", "", 0, 0, 0);
            return;
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(target.getAbsolutePath(), options);
        notifyPicked(requestId, target.getAbsolutePath(), mime,
                options.outWidth, options.outHeight, target.length());
    }

    private static String normalizeMime(String value) {
        String mime = value == null ? "" : value.trim().toLowerCase(Locale.US);
        if (mime.equals("image/jpg")) {
            return "image/jpeg";
        }
        if (mime.equals("image/jpeg") || mime.equals("image/png") || mime.equals("image/webp")) {
            return mime;
        }
        return "";
    }

    private static synchronized void clearPending() {
        pendingRequestId = "";
    }

    private static void notifyPicked(final String requestId, final String path,
                                     final String mime, final int width, final int height,
                                     final long size) {
        final AppActivity current;
        synchronized (DirectChatImageBridge.class) {
            current = activity;
        }
        if (current == null) {
            return;
        }
        try {
            final JSONObject payload = new JSONObject();
            payload.put("requestId", requestId == null ? "" : requestId);
            payload.put("path", path == null ? "" : path);
            payload.put("mime", mime == null ? "" : mime);
            payload.put("width", width);
            payload.put("height", height);
            payload.put("size", size);
            current.runOnGLThread(new Runnable() {
                @Override
                public void run() {
                    Cocos2dxJavascriptJavaBridge.evalString(
                            "if(window.DirectChatImagePicked){window.DirectChatImagePicked("
                                    + JSONObject.quote(payload.toString()) + ");}");
                }
            });
        } catch (Exception ignored) {
            // JS 回调失败时由页面的上传超时/状态提示兜底。
        }
    }
}
