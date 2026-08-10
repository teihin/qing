package org.cocos2dx.javascript;

import android.content.Context;
import android.provider.Settings;

/** Stable device identity used by the anti-theft login protocol. */
public final class QingDeviceBridge {
    private static Context applicationContext;

    private QingDeviceBridge() {
    }

    public static synchronized void initialize(Context context) {
        applicationContext = context == null ? null : context.getApplicationContext();
    }

    public static synchronized void clear() {
        applicationContext = null;
    }

    public static String GetDeviceId() {
        Context context = applicationContext;
        if (context == null) {
            return "";
        }
        String value = Settings.Secure.getString(
                context.getContentResolver(), Settings.Secure.ANDROID_ID);
        if (value == null || value.length() < 8 || value.length() > 255
                || "9774d56d682e549c".equalsIgnoreCase(value)) {
            return "";
        }
        return value;
    }
}
