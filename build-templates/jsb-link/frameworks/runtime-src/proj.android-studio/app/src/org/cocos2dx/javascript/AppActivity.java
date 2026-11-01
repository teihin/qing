/****************************************************************************
Copyright (c) 2015-2016 Chukong Technologies Inc.
Copyright (c) 2017-2018 Xiamen Yaji Software Co., Ltd.

http://www.cocos2d-x.org

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
****************************************************************************/
package org.cocos2dx.javascript;

import android.Manifest;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.WindowManager;
import android.widget.Toast;

import org.cocos2dx.lib.Cocos2dxActivity;
import org.cocos2dx.lib.Cocos2dxGLSurfaceView;
import org.cocos2dx.lib.Cocos2dxJavascriptJavaBridge;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.List;

public class AppActivity extends Cocos2dxActivity {
    private static final int LOCATION_PERMISSION_REQUEST = 9988;
    private static final int STORAGE_PERMISSION_REQUEST = 9989;

    private static AppActivity app;
    private static LocationManager locationManager;
    private static String pendingImagePath;

    private final LocationListener locationListener = new LocationListener() {
        @Override
        public void onLocationChanged(Location location) {
            // The JS layer pulls the latest value through GetCurGps().
        }

        @Override
        public void onStatusChanged(String provider, int status, Bundle extras) {
        }

        @Override
        public void onProviderEnabled(String provider) {
        }

        @Override
        public void onProviderDisabled(String provider) {
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!isTaskRoot()) {
            return;
        }

        app = this;
        QingChatWebViewBridge.initialize(this);
        DirectChatImageBridge.initialize(this);
        QingDeviceBridge.initialize(this);
        QingVoiceBridge.initialize(this);
        SDKWrapper.getInstance().init(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        initLocation();
    }

    private void initLocation() {
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (!hasLocationPermission()) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                requestPermissions(new String[]{
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION
                }, LOCATION_PERMISSION_REQUEST);
            }
            return;
        }
        startLocationUpdates();
    }

    private boolean hasLocationPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void startLocationUpdates() {
        if (locationManager == null || !hasLocationPermission()) {
            return;
        }
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000L, 50f, locationListener);
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 2000L, 0f, locationListener);
            }
        } catch (RuntimeException ignored) {
            // A provider may disappear or be disabled while the request is made.
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (DirectChatImageBridge.onRequestPermissionsResult(requestCode, permissions, grantResults)) {
            return;
        }
        if (requestCode == QingVoiceBridge.RECORD_AUDIO_PERMISSION_REQUEST) {
            QingVoiceBridge.onRequestPermissionsResult(requestCode, permissions, grantResults);
        } else if (requestCode == LOCATION_PERMISSION_REQUEST && hasLocationPermission()) {
            startLocationUpdates();
        } else if (requestCode == STORAGE_PERMISSION_REQUEST) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            String imagePath = pendingImagePath;
            pendingImagePath = null;
            if (granted && imagePath != null) {
                saveTextureToLocal(imagePath);
            } else if (!granted) {
                showToast("未获得存储权限，无法保存图片");
            }
        }
    }

    @Override
    public Cocos2dxGLSurfaceView onCreateView() {
        Cocos2dxGLSurfaceView glSurfaceView = new Cocos2dxGLSurfaceView(this);
        glSurfaceView.setEGLConfigChooser(5, 6, 5, 0, 16, 8);
        SDKWrapper.getInstance().setGLSurfaceView(glSurfaceView, this);
        return glSurfaceView;
    }

    @Override
    protected void onResume() {
        super.onResume();
        SDKWrapper.getInstance().onResume();
    }

    @Override
    protected void onPause() {
        super.onPause();
        SDKWrapper.getInstance().onPause();
    }

    @Override
    protected void onDestroy() {
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(locationListener);
            } catch (RuntimeException ignored) {
            }
        }
        QingVoiceBridge.shutdown();
        QingDeviceBridge.clear();
        DirectChatImageBridge.shutdown();
        QingChatWebViewBridge.shutdown();
        SDKWrapper.getInstance().onDestroy();
        if (app == this) {
            app = null;
        }
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (DirectChatImageBridge.onActivityResult(requestCode, resultCode, data)) {
            return;
        }
        if (QingChatWebViewBridge.onActivityResult(requestCode, resultCode, data)) {
            return;
        }
        SDKWrapper.getInstance().onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        SDKWrapper.getInstance().onNewIntent(intent);
    }

    @Override
    protected void onRestart() {
        super.onRestart();
        SDKWrapper.getInstance().onRestart();
    }

    @Override
    protected void onStop() {
        super.onStop();
        SDKWrapper.getInstance().onStop();
    }

    @Override
    public void onBackPressed() {
        SDKWrapper.getInstance().onBackPressed();
        super.onBackPressed();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        SDKWrapper.getInstance().onConfigurationChanged(newConfig);
        super.onConfigurationChanged(newConfig);
    }

    @Override
    protected void onRestoreInstanceState(Bundle savedInstanceState) {
        SDKWrapper.getInstance().onRestoreInstanceState(savedInstanceState);
        super.onRestoreInstanceState(savedInstanceState);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        SDKWrapper.getInstance().onSaveInstanceState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onStart() {
        SDKWrapper.getInstance().onStart();
        super.onStart();
    }

    public static String GetCurGps() {
        if (app == null || locationManager == null || !app.hasLocationPermission()) {
            return "0,0";
        }

        try {
            boolean gpsEnabled = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER);
            boolean networkEnabled = locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
            if (!gpsEnabled && !networkEnabled) {
                return "0,0";
            }

            Location bestLocation = null;
            List<String> providers = locationManager.getProviders(true);
            for (String provider : providers) {
                Location candidate = locationManager.getLastKnownLocation(provider);
                if (candidate != null && (bestLocation == null
                        || candidate.getAccuracy() < bestLocation.getAccuracy())) {
                    bestLocation = candidate;
                }
            }
            return bestLocation == null
                    ? "0,0"
                    : bestLocation.getLatitude() + "," + bestLocation.getLongitude();
        } catch (RuntimeException ignored) {
            return "0,0";
        }
    }

    public static void saveTextureToLocal(final String pngPath) {
        if (app == null || pngPath == null || pngPath.length() == 0) {
            return;
        }
        app.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (Build.VERSION.SDK_INT < 29
                        && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                        && app.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                        != PackageManager.PERMISSION_GRANTED) {
                    pendingImagePath = pngPath;
                    app.requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, STORAGE_PERMISSION_REQUEST);
                    return;
                }

                Bitmap bitmap = BitmapFactory.decodeFile(pngPath);
                if (bitmap == null) {
                    showToast("保存图片失败");
                    return;
                }

                String fileName = new File(pngPath).getName();
                boolean saved = Build.VERSION.SDK_INT >= 29
                        ? saveImageWithMediaStore(bitmap, fileName)
                        : saveImageLegacy(bitmap, fileName);
                bitmap.recycle();
                showToast(saved ? "图片已保存到相册" : "保存图片失败");
            }
        });
    }

    private static boolean saveImageWithMediaStore(Bitmap bitmap, String fileName) {
        ContentValues values = new ContentValues();
        // String keys keep this source compilable with the project's API 28 SDK.
        values.put("_display_name", fileName);
        values.put("mime_type", "image/png");
        values.put("relative_path", Environment.DIRECTORY_PICTURES + "/Qin");
        values.put("is_pending", 1);
        Uri uri = app.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) {
            return false;
        }
        try (OutputStream output = app.getContentResolver().openOutputStream(uri)) {
            boolean saved = output != null && bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
            if (saved) {
                ContentValues published = new ContentValues();
                published.put("is_pending", 0);
                app.getContentResolver().update(uri, published, null, null);
            } else {
                app.getContentResolver().delete(uri, null, null);
            }
            return saved;
        } catch (Exception ignored) {
            app.getContentResolver().delete(uri, null, null);
            return false;
        }
    }

    private static boolean saveImageLegacy(Bitmap bitmap, String fileName) {
        File directory = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "Qin");
        if (!directory.exists() && !directory.mkdirs()) {
            return false;
        }
        File outputFile = new File(directory, fileName);
        try (OutputStream output = new FileOutputStream(outputFile)) {
            if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) {
                return false;
            }
            app.sendBroadcast(new Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE, Uri.fromFile(outputFile)));
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    public static void CopyData(final String text) {
        if (app == null) {
            return;
        }
        app.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                ClipboardManager clipboard = (ClipboardManager) app.getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard != null) {
                    clipboard.setPrimaryClip(ClipData.newPlainText("text", text == null ? "" : text));
                }
            }
        });
    }

    public static void GetCopyData() {
        if (app == null) {
            return;
        }
        app.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                ClipboardManager clipboard = (ClipboardManager) app.getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard == null || !clipboard.hasPrimaryClip()) {
                    return;
                }
                ClipData clipData = clipboard.getPrimaryClip();
                if (clipData == null || clipData.getItemCount() == 0) {
                    return;
                }
                CharSequence value = clipData.getItemAt(0).coerceToText(app);
                notifyJs("粘贴", value == null ? "" : value.toString());
            }
        });
    }

    private static void notifyJs(final String type, final String message) {
        if (app == null) {
            return;
        }
        app.runOnGLThread(new Runnable() {
            @Override
            public void run() {
                Cocos2dxJavascriptJavaBridge.evalString(
                        "cc.MobileManager.onMsgReturn(" + JSONObject.quote(type) + ","
                                + JSONObject.quote(message == null ? "" : message) + ")");
            }
        });
    }

    private static void showToast(final String message) {
        if (app == null) {
            return;
        }
        app.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(app, message, Toast.LENGTH_LONG).show();
            }
        });
    }
}
