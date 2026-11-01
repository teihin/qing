package org.cocos2dx.javascript;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * 给系统相机提供拍照落盘 URI 的最小 ContentProvider。
 *
 * 工程没有引入 androidx，所以不能用 FileProvider；Android 7.0 起又禁止把
 * file:// 交给相机（FileUriExposedException），这里只暴露 cache/direct_chat
 * 下的文件名，且 provider 不导出，仅靠 Intent 的一次性 URI 授权访问。
 */
public final class DirectChatMediaProvider extends ContentProvider {
    public static final String AUTHORITY_SUFFIX = ".directchat.media";

    private static final String DIR_NAME = "direct_chat";

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public String getType(Uri uri) {
        return "image/jpeg";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        // 部分相机应用写 EXTRA_OUTPUT 前会查 _display_name / _size，缺了会直接放弃拍照。
        Context context = getContext();
        String name = uri == null ? null : uri.getLastPathSegment();
        if (context == null || name == null) {
            return null;
        }
        File file = new File(new File(context.getCacheDir(), DIR_NAME), name);
        MatrixCursor cursor = new MatrixCursor(
                new String[]{"_display_name", "_size"}, 1);
        cursor.addRow(new Object[]{name, file.isFile() ? file.length() : 0L});
        return cursor;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        Context context = getContext();
        if (context == null) {
            throw new FileNotFoundException("provider detached");
        }
        String name = uri == null ? null : uri.getLastPathSegment();
        if (name == null || name.length() == 0
                || name.contains("..") || name.contains("/") || name.contains("\\")) {
            throw new FileNotFoundException("invalid media name");
        }
        File directory = new File(context.getCacheDir(), DIR_NAME);
        if (!directory.exists() && !directory.mkdirs()) {
            throw new FileNotFoundException("cache dir unavailable");
        }
        int flags = ParcelFileDescriptor.MODE_CREATE;
        if (mode != null && mode.startsWith("w")) {
            flags |= ParcelFileDescriptor.MODE_WRITE_ONLY | ParcelFileDescriptor.MODE_TRUNCATE;
        } else {
            flags |= ParcelFileDescriptor.MODE_READ_ONLY;
        }
        return ParcelFileDescriptor.open(new File(directory, name), flags);
    }
}
