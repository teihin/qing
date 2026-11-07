package org.cocos2dx.javascript;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

import org.cocos2dx.lib.Cocos2dxJavascriptJavaBridge;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 原生直聊图片桥：相册选图与拍照。
 *
 * 两条路径都把结果落到 cache/direct_chat 下的本地文件，再把绝对路径交给 JS
 * 读取上传，避免把大图塞进 JS 字符串里过桥。
 *
 * 落地的图片会统一规整到聊天尺寸（长边 {@link #CHAT_IMAGE_MAX_EDGE}、JPEG
 * {@link #CHAT_IMAGE_JPEG_QUALITY}）。这一步不是省流量，而是保命：手机相册原图
 * 动辄几 MB，原样上传会占满上行带宽几十秒，KBEngine 的心跳包排不上队，
 * 22 秒收不到回包就判定掉线，表现就是发完图客户端转圈重连。
 */
public final class DirectChatImageBridge {
    public static final int PICK_REQUEST = 9993;
    public static final int PHOTO_REQUEST = 9994;
    public static final int CAMERA_PERMISSION_REQUEST = 9995;

    /** 聊天图片的最长边。看图气泡只有 240 宽，1600 已经远超需要。 */
    private static final int CHAT_IMAGE_MAX_EDGE = 1600;
    private static final int CHAT_IMAGE_JPEG_QUALITY = 85;
    /** 低于该体积且不超长边的图片原样上传，避免把小图（含透明 PNG）白白重编码。 */
    private static final long CHAT_IMAGE_RAW_LIMIT = 400 * 1024;

    public static final String ERROR_DENIED = "denied";
    public static final String ERROR_UNSUPPORTED = "unsupported";

    private static AppActivity activity;
    private static String pendingRequestId = "";
    private static String pendingPhotoId = "";
    private static String pendingCameraPermissionId = "";
    private static final ExecutorService executor = Executors.newSingleThreadExecutor();

    private DirectChatImageBridge() {
    }

    public static synchronized void initialize(AppActivity value) {
        activity = value;
    }

    /** 相册/文件选择器选图。 */
    public static void Pick(final String requestId) {
        final AppActivity current;
        synchronized (DirectChatImageBridge.class) {
            current = activity;
            pendingRequestId = requestId == null ? "" : requestId;
        }
        if (current == null) {
            notifyPicked(requestId, "", "", 0, 0, 0, "");
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
                    notifyPicked(requestId, "", "", 0, 0, 0, ERROR_UNSUPPORTED);
                }
            }
        });
    }

    /**
     * 调系统相机拍照。Android 6.0 起相机权限要运行时申请，没授权时先申请，
     * 结果回到 {@link #onRequestPermissionsResult} 再继续。
     */
    public static void TakePhoto(final String requestId) {
        final AppActivity current;
        final String id = requestId == null ? "" : requestId;
        synchronized (DirectChatImageBridge.class) {
            current = activity;
        }
        if (current == null) {
            notifyPicked(id, "", "", 0, 0, 0, ERROR_UNSUPPORTED);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && current.checkSelfPermission(Manifest.permission.CAMERA)
                        != PackageManager.PERMISSION_GRANTED) {
            synchronized (DirectChatImageBridge.class) {
                pendingCameraPermissionId = id;
            }
            try {
                current.requestPermissions(
                        new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
            } catch (RuntimeException error) {
                synchronized (DirectChatImageBridge.class) {
                    pendingCameraPermissionId = "";
                }
                notifyPicked(id, "", "", 0, 0, 0, ERROR_UNSUPPORTED);
            }
            return;
        }
        startCamera(current, id);
    }

    /** @return 是否消费了该权限回调。 */
    public static boolean onRequestPermissionsResult(
            int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode != CAMERA_PERMISSION_REQUEST) {
            return false;
        }
        String id;
        synchronized (DirectChatImageBridge.class) {
            id = pendingCameraPermissionId;
            pendingCameraPermissionId = "";
        }
        boolean granted = grantResults != null && grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        final AppActivity current = activity;
        if (!granted || current == null) {
            notifyPicked(id, "", "", 0, 0, 0, granted ? ERROR_UNSUPPORTED : ERROR_DENIED);
            return true;
        }
        // 部分机型在权限回调里直接启动 Activity 会被丢弃，转一次主线程队列。
        final String target = id;
        current.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                startCamera(current, target);
            }
        });
        return true;
    }

    private static void startCamera(final AppActivity current, final String requestId) {
        final String id = requestId == null ? "" : requestId;
        if (id.length() == 0) {
            notifyPicked(id, "", "", 0, 0, 0, ERROR_UNSUPPORTED);
            return;
        }
        final File directory = new File(current.getCacheDir(), "direct_chat");
        if (!directory.exists() && !directory.mkdirs()) {
            notifyPicked(id, "", "", 0, 0, 0, ERROR_UNSUPPORTED);
            return;
        }
        synchronized (DirectChatImageBridge.class) {
            pendingPhotoId = id;
        }
        final File target = new File(directory, id + ".jpg");
        final Uri output = Uri.parse("content://" + current.getPackageName()
                + DirectChatMediaProvider.AUTHORITY_SUFFIX + "/" + target.getName());
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        intent.putExtra(MediaStore.EXTRA_OUTPUT, output);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            current.startActivityForResult(intent, PHOTO_REQUEST);
        } catch (ActivityNotFoundException error) {
            clearPendingPhoto();
            notifyPicked(id, "", "", 0, 0, 0, ERROR_UNSUPPORTED);
        } catch (RuntimeException error) {
            clearPendingPhoto();
            notifyPicked(id, "", "", 0, 0, 0, ERROR_UNSUPPORTED);
        }
    }

    public static synchronized boolean onActivityResult(
            int requestCode, int resultCode, Intent data) {
        if (requestCode == PHOTO_REQUEST) {
            final String requestId = pendingPhotoId;
            pendingPhotoId = "";
            final AppActivity current = activity;
            if (current == null) {
                notifyPicked(requestId, "", "", 0, 0, 0, ERROR_UNSUPPORTED);
                return true;
            }
            if (resultCode != Activity.RESULT_OK) {
                notifyPicked(requestId, "", "", 0, 0, 0, "");
                return true;
            }
            final File target = new File(
                    new File(current.getCacheDir(), "direct_chat"), requestId + ".jpg");
            if (!target.isFile() || target.length() <= 0) {
                notifyPicked(requestId, "", "", 0, 0, 0, ERROR_UNSUPPORTED);
                return true;
            }
            executor.execute(new Runnable() {
                @Override
                public void run() {
                    finishPhoto(current, requestId, target);
                }
            });
            return true;
        }
        if (requestCode != PICK_REQUEST) {
            return false;
        }
        final String requestId = pendingRequestId;
        pendingRequestId = "";
        final AppActivity current = activity;
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            notifyPicked(requestId, "", "", 0, 0, 0, "");
            return true;
        }
        if (current == null) {
            notifyPicked(requestId, "", "", 0, 0, 0, ERROR_UNSUPPORTED);
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
        pendingPhotoId = "";
        pendingCameraPermissionId = "";
        activity = null;
    }

    /**
     * 拍照结果：纠正 EXIF 方向、限制最长边后回调 JS。
     *
     * 相机原图落在 {@code requestId.jpg}，规整后的成品是同目录下的
     * {@code requestId.c.jpg}；原图在成功后删除，避免 cache 里留两份几 MB 的图。
     */
    private static void finishPhoto(AppActivity current, String requestId, File file) {
        File directory = file.getParentFile();
        PreparedImage prepared = prepareChatImage(file, directory, requestId, "image/jpeg");
        if (prepared == null) {
            // 解码/编码失败时退回原文件，至少保证能发出去（服务端还会再校验一次）。
            notifyPicked(requestId, file.getAbsolutePath(), "image/jpeg",
                    decodeWidth(file), decodeHeight(file), file.length(), "");
            return;
        }
        if (!prepared.file.getAbsolutePath().equals(file.getAbsolutePath())) {
            // 删除原图前先确认成品确实落在磁盘上。
            if (prepared.file.isFile() && prepared.file.length() > 0)
                file.delete();
        }
        notifyPicked(requestId, prepared.file.getAbsolutePath(), prepared.mime,
                prepared.width, prepared.height, prepared.file.length(), "");
    }

    private static Bitmap applyOrientation(Bitmap bitmap, int orientation) {
        Matrix matrix = new Matrix();
        switch (orientation) {
            case ExifInterface.ORIENTATION_ROTATE_90:
                matrix.postRotate(90f);
                break;
            case ExifInterface.ORIENTATION_ROTATE_180:
                matrix.postRotate(180f);
                break;
            case ExifInterface.ORIENTATION_ROTATE_270:
                matrix.postRotate(270f);
                break;
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL:
                matrix.postScale(-1f, 1f);
                break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL:
                matrix.postScale(1f, -1f);
                break;
            case ExifInterface.ORIENTATION_TRANSPOSE:
                matrix.postRotate(90f);
                matrix.postScale(-1f, 1f);
                break;
            case ExifInterface.ORIENTATION_TRANSVERSE:
                matrix.postRotate(270f);
                matrix.postScale(-1f, 1f);
                break;
            default:
                return bitmap;
        }
        try {
            Bitmap rotated = Bitmap.createBitmap(
                    bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
            if (rotated != bitmap) {
                bitmap.recycle();
            }
            return rotated;
        } catch (Throwable error) {
            return bitmap;
        }
    }

    private static Bitmap limitLongEdge(Bitmap bitmap, int maxEdge) {
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int longEdge = Math.max(width, height);
        if (longEdge <= maxEdge) {
            return bitmap;
        }
        float ratio = (float) maxEdge / (float) longEdge;
        try {
            Bitmap scaled = Bitmap.createScaledBitmap(bitmap,
                    Math.max(1, Math.round(width * ratio)),
                    Math.max(1, Math.round(height * ratio)), true);
            if (scaled != bitmap) {
                bitmap.recycle();
            }
            return scaled;
        } catch (Throwable error) {
            return bitmap;
        }
    }

    private static void copyToCache(AppActivity current, String requestId, Uri uri) {
        ContentResolver resolver = current.getContentResolver();
        String mime = normalizeMime(resolver.getType(uri));
        boolean unknownMime = mime.length() == 0;
        if (unknownMime)
            mime = "image/jpeg";
        File directory = new File(current.getCacheDir(), "direct_chat");
        if (!directory.exists() && !directory.mkdirs()) {
            notifyPicked(requestId, "", "", 0, 0, 0, ERROR_UNSUPPORTED);
            return;
        }
        String extension = mime.equals("image/png") ? ".png"
                : (mime.equals("image/webp") ? ".webp" : ".jpg");
        // 先原样落到 .src，再由 prepareChatImage 决定是否重编码，两条路径共用同一套逻辑。
        File raw = new File(directory, requestId + ".src");
        try (InputStream input = resolver.openInputStream(uri);
             OutputStream output = new FileOutputStream(raw, false)) {
            if (input == null) {
                raw.delete();
                notifyPicked(requestId, "", "", 0, 0, 0, ERROR_UNSUPPORTED);
                return;
            }
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                if (count > 0)
                    output.write(buffer, 0, count);
            }
            output.flush();
        } catch (Exception error) {
            raw.delete();
            notifyPicked(requestId, "", "", 0, 0, 0, ERROR_UNSUPPORTED);
            return;
        }
        if (!raw.isFile() || raw.length() <= 0) {
            raw.delete();
            notifyPicked(requestId, "", "", 0, 0, 0, ERROR_UNSUPPORTED);
            return;
        }

        // 部分机型/文件管理器给不出 mime，这里按 JPEG 尝试解码；解不出来就原样上传，
        // 让服务端按文件头判定，不能因为本地识图失败就让用户发不出图。
        PreparedImage prepared = prepareChatImage(raw, directory, requestId, mime);
        File result;
        String resultMime;
        int width = 0;
        int height = 0;
        if (prepared == null) {
            result = new File(directory, requestId + extension);
            result.delete();
            if (!raw.renameTo(result)) {
                raw.delete();
                notifyPicked(requestId, "", "", 0, 0, 0, ERROR_UNSUPPORTED);
                return;
            }
            resultMime = mime;
            width = decodeWidth(result);
            height = decodeHeight(result);
        } else if (prepared.file.getAbsolutePath().equals(raw.getAbsolutePath())) {
            // 尺寸体积都达标：保留原始字节（含 PNG/WebP 的透明通道），只改回正常扩展名。
            result = new File(directory, requestId + extension);
            result.delete();
            if (!raw.renameTo(result)) {
                raw.delete();
                notifyPicked(requestId, "", "", 0, 0, 0, ERROR_UNSUPPORTED);
                return;
            }
            resultMime = mime;
            width = prepared.width;
            height = prepared.height;
        } else {
            raw.delete();
            result = prepared.file;
            resultMime = prepared.mime;
            width = prepared.width;
            height = prepared.height;
        }
        if (!result.isFile() || result.length() <= 0) {
            notifyPicked(requestId, "", "", 0, 0, 0, ERROR_UNSUPPORTED);
            return;
        }
        notifyPicked(requestId, result.getAbsolutePath(), resultMime,
                width, height, result.length(), "");
    }

    /** prepareChatImage 的产物：落地文件、真实 mime 与服务端需要的像素尺寸。 */
    private static final class PreparedImage {
        final File file;
        final String mime;
        final int width;
        final int height;

        PreparedImage(File file, String mime, int width, int height) {
            this.file = file;
            this.mime = mime;
            this.width = width;
            this.height = height;
        }
    }

    /**
     * 把本地图片规整到聊天尺寸：纠 EXIF 方向 → 限制最长边 → 重编码 JPEG。
     *
     * 尺寸和体积都达标时直接返回 source 本身（调用方按原文件上传）；无法解码时返回
     * null，由调用方退回原文件。产物固定落在 {@code requestId.c.jpg}，不会覆盖 source。
     */
    private static PreparedImage prepareChatImage(File source, File directory, String requestId, String mime) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(source.getAbsolutePath(), bounds);
        int sourceWidth = bounds.outWidth;
        int sourceHeight = bounds.outHeight;
        if (sourceWidth <= 0 || sourceHeight <= 0)
            return null;

        int orientation = readOrientation(source);
        boolean needRotate = orientation != ExifInterface.ORIENTATION_NORMAL
                && orientation != ExifInterface.ORIENTATION_UNDEFINED;
        int longEdge = Math.max(sourceWidth, sourceHeight);
        boolean needScale = longEdge > CHAT_IMAGE_MAX_EDGE;
        boolean needShrink = source.length() > CHAT_IMAGE_RAW_LIMIT;
        if (!needRotate && !needScale && !needShrink)
            return new PreparedImage(source, mime, sourceWidth, sourceHeight);

        Bitmap bitmap = null;
        try {
            BitmapFactory.Options options = new BitmapFactory.Options();
            if (needScale) {
                options.inSampleSize = 1;
                while (longEdge / (options.inSampleSize * 2) >= CHAT_IMAGE_MAX_EDGE) {
                    options.inSampleSize *= 2;
                }
            }
            bitmap = BitmapFactory.decodeFile(source.getAbsolutePath(), options);
            if (bitmap == null)
                return null;
            if (needRotate)
                bitmap = applyOrientation(bitmap, orientation);
            if (Math.max(bitmap.getWidth(), bitmap.getHeight()) > CHAT_IMAGE_MAX_EDGE)
                bitmap = limitLongEdge(bitmap, CHAT_IMAGE_MAX_EDGE);

            // PNG/WebP 可能带透明通道，JPEG 不支持，透明区域会变黑，先铺白底。
            boolean flattenAlpha = mime.equals("image/png") || mime.equals("image/webp");
            File target = new File(directory, requestId + ".c.jpg");
            File temp = new File(directory, requestId + ".tmp");
            if (!encodeJpeg(bitmap, temp, flattenAlpha)) {
                temp.delete();
                return null;
            }
            target.delete();
            if (!temp.renameTo(target)) {
                temp.delete();
                return null;
            }
            return new PreparedImage(target, "image/jpeg",
                    decodeWidth(target), decodeHeight(target));
        } catch (Throwable error) {
            return null;
        } finally {
            if (bitmap != null && !bitmap.isRecycled())
                bitmap.recycle();
        }
    }

    private static boolean encodeJpeg(Bitmap bitmap, File target, boolean flattenAlpha) {
        Bitmap source = bitmap;
        Bitmap flattened = null;
        try {
            if (flattenAlpha) {
                flattened = Bitmap.createBitmap(
                        bitmap.getWidth(), bitmap.getHeight(), Bitmap.Config.ARGB_8888);
                Canvas canvas = new Canvas(flattened);
                canvas.drawColor(Color.WHITE);
                canvas.drawBitmap(bitmap, 0f, 0f, null);
                source = flattened;
            }
            try (OutputStream output = new FileOutputStream(target, false)) {
                return source.compress(Bitmap.CompressFormat.JPEG,
                        CHAT_IMAGE_JPEG_QUALITY, output);
            }
        } catch (Throwable error) {
            return false;
        } finally {
            if (flattened != null && !flattened.isRecycled())
                flattened.recycle();
        }
    }

    private static int readOrientation(File file) {
        try {
            ExifInterface exif = new ExifInterface(file.getAbsolutePath());
            return exif.getAttributeInt(
                    ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
        } catch (Throwable ignored) {
            // API 24 以下没有 android.media.ExifInterface，按无需旋转处理。
            return ExifInterface.ORIENTATION_NORMAL;
        }
    }

    private static int decodeWidth(File file) {
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(file.getAbsolutePath(), options);
        return options.outWidth;
    }

    private static int decodeHeight(File file) {
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(file.getAbsolutePath(), options);
        return options.outHeight;
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

    private static synchronized void clearPendingPhoto() {
        pendingPhotoId = "";
    }

    private static void notifyPicked(final String requestId, final String path,
                                     final String mime, final int width, final int height,
                                     final long size, final String error) {
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
            payload.put("error", error == null ? "" : error);
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
