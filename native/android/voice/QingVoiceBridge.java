package org.cocos2dx.javascript;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaPlayer;
import android.media.MediaRecorder;
import android.media.audiofx.AutomaticGainControl;
import android.media.audiofx.NoiseSuppressor;
import android.os.Build;
import android.util.Log;

import org.cocos2dx.lib.Cocos2dxJavascriptJavaBridge;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 房间语音的 Android 原生实现。
 *
 * 录音为 16 kHz / 单声道 / PCM16LE。按下后立即通过 HTTP(S) chunked body
 * 边录边上传；松开只关闭请求体并等待服务端编码结果。网络流失败时保留的内存
 * PCM 会使用同一 requestId 做一次有界补传，避免生成重复语音。
 */
public final class QingVoiceBridge {
    public static final int RECORD_AUDIO_PERMISSION_REQUEST = 9990;

    private static final String TAG = "QingVoice";
    private static final int SAMPLE_RATE = 16000;
    private static final int BYTES_PER_SECOND = SAMPLE_RATE * 2;
    private static final int MIN_BYTES = BYTES_PER_SECOND * 300 / 1000;
    private static final int MAX_BYTES = BYTES_PER_SECOND * 9800 / 1000;
    private static final int CACHE_LIMIT = 20;
    private static final byte[] END_OF_STREAM = new byte[0];

    private static QingVoiceBridge instance;

    private final AppActivity activity;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Object stateLock = new Object();
    private final File cacheDir;

    private volatile String httpBase = "";
    private volatile RecordSession activeSession;
    private volatile boolean pendingPermissionStart;
    private volatile String pendingClientTag = "";
    private volatile int roomGeneration;
    private volatile MediaPlayer mediaPlayer;
    private volatile AudioRecord preparedRecorder;
    private volatile boolean preparingRecorder;

    private QingVoiceBridge(AppActivity activity) {
        this.activity = activity;
        this.cacheDir = new File(activity.getCacheDir(), "qing_voice");
        if (!cacheDir.exists() && !cacheDir.mkdirs()) {
            Log.w(TAG, "Unable to create voice cache directory");
        }
    }

    public static synchronized void initialize(AppActivity activity) {
        if (instance != null) {
            instance.shutdownInternal();
        }
        instance = new QingVoiceBridge(activity);
    }

    public static void Prepare(String serverBase) {
        QingVoiceBridge bridge = instance;
        if (bridge != null) {
            bridge.prepare(serverBase);
        }
    }

    public static void StartRecord(String serverBase, String clientTag) {
        QingVoiceBridge bridge = instance;
        if (bridge != null) {
            bridge.startRecord(serverBase, clientTag);
        }
    }

    public static void StopRecord() {
        QingVoiceBridge bridge = instance;
        if (bridge != null) {
            bridge.stopRecord(false);
        }
    }

    public static void CancelRecord() {
        QingVoiceBridge bridge = instance;
        if (bridge != null) {
            bridge.stopRecord(true);
        }
    }

    public static void PlayFile(String serverBase, String voiceId) {
        QingVoiceBridge bridge = instance;
        if (bridge != null) {
            bridge.playFile(serverBase, voiceId);
        }
    }

    public static void PreloadFile(String serverBase, String voiceId) {
        QingVoiceBridge bridge = instance;
        if (bridge != null) {
            bridge.preloadFile(serverBase, voiceId);
        }
    }

    public static void LeaveRoom() {
        QingVoiceBridge bridge = instance;
        if (bridge != null) {
            bridge.leaveRoom();
        }
    }

    public static void onRequestPermissionsResult(
            int requestCode, String[] permissions, int[] grantResults) {
        QingVoiceBridge bridge = instance;
        if (bridge == null || requestCode != RECORD_AUDIO_PERMISSION_REQUEST) {
            return;
        }
        bridge.onMicrophonePermissionResult(
                grantResults.length > 0
                        && grantResults[0] == PackageManager.PERMISSION_GRANTED);
    }

    public static synchronized void shutdown() {
        if (instance != null) {
            instance.shutdownInternal();
            instance = null;
        }
    }

    private void startRecord(String serverBase, String clientTag) {
        String safeClientTag = clientTag == null ? "" : clientTag;
        String normalized = normalizeBase(serverBase);
        if (normalized.length() == 0) {
            notifyJs("语音录制失败", recordMessage(safeClientTag, "语音服务器地址未配置"));
            return;
        }
        httpBase = normalized;

        if (!hasMicrophonePermission()) {
            synchronized (stateLock) {
                pendingPermissionStart = true;
                pendingClientTag = safeClientTag;
            }
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        activity.requestPermissions(
                                new String[]{Manifest.permission.RECORD_AUDIO},
                                RECORD_AUDIO_PERMISSION_REQUEST);
                    }
                }
            });
            return;
        }
        beginRecord(normalized, safeClientTag);
    }

    private void prepare(String serverBase) {
        httpBase = normalizeBase(serverBase);
        prepareRecorder();
    }

    private void prepareRecorder() {
        synchronized (stateLock) {
            if (!hasMicrophonePermission()
                    || preparingRecorder
                    || preparedRecorder != null
                    || activeSession != null
                    || executor.isShutdown()) {
                return;
            }
            preparingRecorder = true;
        }
        final int generation = roomGeneration;
        executor.execute(new Runnable() {
            @Override
            public void run() {
                AudioRecord recorder = null;
                try {
                    recorder = createBestRecorder();
                } catch (Exception error) {
                    Log.w(TAG, "Microphone prewarm failed: " + safeMessage(error, ""));
                }
                synchronized (stateLock) {
                    preparingRecorder = false;
                    if (recorder != null
                            && generation == roomGeneration
                            && activeSession == null
                            && preparedRecorder == null) {
                        preparedRecorder = recorder;
                        recorder = null;
                    }
                }
                if (recorder != null) {
                    recorder.release();
                }
            }
        });
    }

    private void beginRecord(String normalizedBase, String clientTag) {
        final RecordSession session;
        synchronized (stateLock) {
            pendingPermissionStart = false;
            pendingClientTag = "";
            if (activeSession != null && !activeSession.captureDone()) {
                notifyJs(
                        "语音录制失败",
                        recordMessage(clientTag, "上一条语音正在结束，请稍后再试"));
                return;
            }
            session = new RecordSession(normalizedBase, roomGeneration, clientTag);
            activeSession = session;
        }

        executor.execute(new Runnable() {
            @Override
            public void run() {
                runStreamingUpload(session);
            }
        });
        executor.execute(new Runnable() {
            @Override
            public void run() {
                runCapture(session);
            }
        });
    }

    private void stopRecord(boolean cancel) {
        final RecordSession session;
        synchronized (stateLock) {
            pendingPermissionStart = false;
            pendingClientTag = "";
            session = activeSession;
        }
        if (session == null) {
            return;
        }
        if (cancel) {
            session.cancelled = true;
            HttpURLConnection connection = session.connection;
            if (connection != null) {
                connection.disconnect();
            }
        }
        session.stopRequested = true;
        AudioRecord recorder = session.audioRecord;
        if (recorder != null) {
            try {
                recorder.stop();
            } catch (RuntimeException ignored) {
            }
        }
    }

    private void onMicrophonePermissionResult(boolean granted) {
        boolean shouldStart;
        String clientTag;
        synchronized (stateLock) {
            shouldStart = pendingPermissionStart;
            clientTag = pendingClientTag;
            pendingPermissionStart = false;
            pendingClientTag = "";
        }
        if (!granted) {
            if (shouldStart) {
                notifyJs(
                        "语音录制失败",
                        recordMessage(clientTag, "麦克风权限未开启，请在系统设置中允许麦克风"));
            }
            return;
        }
        if (shouldStart) {
            beginRecord(httpBase, clientTag);
        } else {
            prepareRecorder();
        }
    }

    private boolean hasMicrophonePermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void runCapture(RecordSession session) {
        AudioRecord recorder = null;
        NoiseSuppressor noiseSuppressor = null;
        AutomaticGainControl gainControl = null;
        try {
            synchronized (stateLock) {
                recorder = preparedRecorder;
                preparedRecorder = null;
            }
            if (recorder == null) {
                recorder = createBestRecorder();
            }

            session.audioRecord = recorder;
            try {
                if (NoiseSuppressor.isAvailable()) {
                    noiseSuppressor = NoiseSuppressor.create(recorder.getAudioSessionId());
                }
            } catch (RuntimeException ignored) {
            }
            try {
                if (AutomaticGainControl.isAvailable()) {
                    gainControl = AutomaticGainControl.create(recorder.getAudioSessionId());
                }
            } catch (RuntimeException ignored) {
            }

            if (session.stopRequested || session.cancelled) {
                return;
            }
            recorder.startRecording();
            if (recorder.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                throw new IOException("麦克风启动失败");
            }

            byte[] buffer = new byte[2048];
            while (!session.stopRequested && !session.cancelled
                    && session.byteCount < MAX_BYTES) {
                int remaining = MAX_BYTES - session.byteCount;
                int read = recorder.read(buffer, 0, Math.min(buffer.length, remaining));
                if (read > 0) {
                    byte[] chunk = Arrays.copyOf(buffer, read);
                    session.pcm.write(chunk, 0, chunk.length);
                    session.byteCount += chunk.length;
                    if (!session.hasSignal && containsSignal(chunk)) {
                        session.hasSignal = true;
                    }
                    session.uploadQueue.offer(chunk);
                } else if (read < 0 && !session.stopRequested) {
                    throw new IOException("麦克风读取失败:" + read);
                }
            }
            if (session.byteCount >= MAX_BYTES && !session.stopRequested) {
                session.stopRequested = true;
                notifyJs("语音录制自动停止", recordMessage(session.clientTag, ""));
            }
        } catch (Exception error) {
            session.captureError = safeMessage(error, "录音失败");
        } finally {
            if (recorder != null) {
                try {
                    if (recorder.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                        recorder.stop();
                    }
                } catch (RuntimeException ignored) {
                }
                recorder.release();
            }
            if (noiseSuppressor != null) {
                noiseSuppressor.release();
            }
            if (gainControl != null) {
                gainControl.release();
            }
            session.audioRecord = null;
            session.uploadQueue.offer(END_OF_STREAM);
            session.captureFinished.countDown();
            synchronized (stateLock) {
                if (activeSession == session) {
                    activeSession = null;
                }
            }
            if (!session.cancelled && session.roomGeneration == roomGeneration) {
                prepareRecorder();
            }
        }
    }

    private AudioRecord createBestRecorder() throws IOException {
        int minBuffer = AudioRecord.getMinBufferSize(
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT);
        if (minBuffer <= 0) {
            throw new IOException("设备不支持16kHz单声道录音");
        }
        int bufferSize = Math.max(4096, minBuffer * 2);
        AudioRecord recorder =
                createRecorder(MediaRecorder.AudioSource.VOICE_RECOGNITION, bufferSize);
        if (recorder == null) {
            recorder = createRecorder(MediaRecorder.AudioSource.MIC, bufferSize);
        }
        if (recorder == null) {
            throw new IOException("无法启动麦克风");
        }
        return recorder;
    }

    private AudioRecord createRecorder(int source, int bufferSize) {
        AudioRecord recorder = null;
        try {
            recorder = new AudioRecord(
                    source,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferSize);
            if (recorder.getState() == AudioRecord.STATE_INITIALIZED) {
                return recorder;
            }
        } catch (RuntimeException ignored) {
        }
        if (recorder != null) {
            recorder.release();
        }
        return null;
    }

    private void runStreamingUpload(RecordSession session) {
        HttpURLConnection connection = null;
        OutputStream output = null;
        try {
            connection = openUploadConnection(
                    session.httpBase, session.requestId, -1, true);
            session.connection = connection;
            output = new BufferedOutputStream(connection.getOutputStream(), 4096);

            // 先保留最开始的少量静音。检测到有效采样后再一次性发出，
            // 既保留首音前沿，也避免全零录音被服务端落盘。
            List<byte[]> pending = new ArrayList<byte[]>();
            while (true) {
                byte[] chunk = session.uploadQueue.take();
                if (chunk == END_OF_STREAM) {
                    break;
                }
                if (!session.hasSignal) {
                    pending.add(chunk);
                    continue;
                }
                if (!pending.isEmpty()) {
                    for (byte[] buffered : pending) {
                        output.write(buffered);
                    }
                    pending.clear();
                }
                output.write(chunk);
            }
            session.captureFinished.await();

            String invalid = validateSession(session);
            if (invalid != null) {
                throw new InvalidRecordingException(invalid);
            }
            output.flush();
            output.close();
            output = null;

            int status = connection.getResponseCode();
            String body = readResponse(connection, status);
            if (status == HttpURLConnection.HTTP_OK
                    || status == HttpURLConnection.HTTP_CREATED) {
                completeSuccess(session, parseVoiceId(body));
                return;
            }
            throw new HttpStatusException(status, parseErrorMessage(body, status));
        } catch (InvalidRecordingException invalid) {
            completeFailure(session, invalid.getMessage());
        } catch (Exception streamingError) {
            awaitCapture(session);
            if (session.cancelled || session.roomGeneration != roomGeneration) {
                return;
            }
            String invalid = validateSession(session);
            if (invalid != null) {
                completeFailure(session, invalid);
                return;
            }
            runFallbackUpload(session, safeMessage(streamingError, "网络上传失败"));
        } finally {
            closeQuietly(output);
            if (connection != null) {
                connection.disconnect();
            }
            session.connection = null;
        }
    }

    private void runFallbackUpload(RecordSession session, String firstError) {
        byte[] pcm = session.pcm.toByteArray();
        String lastError = firstError;
        long[] delays = new long[]{0L, 160L, 320L, 640L, 1000L};
        for (int attempt = 0; attempt < delays.length; attempt++) {
            if (session.cancelled || session.roomGeneration != roomGeneration) {
                return;
            }
            if (delays[attempt] > 0L) {
                try {
                    Thread.sleep(delays[attempt]);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    completeFailure(session, "语音上传已取消");
                    return;
                }
            }
            HttpURLConnection connection = null;
            OutputStream output = null;
            try {
                connection = openUploadConnection(
                        session.httpBase, session.requestId, pcm.length, false);
                session.connection = connection;
                output = new BufferedOutputStream(connection.getOutputStream(), 8192);
                output.write(pcm);
                output.flush();
                output.close();
                output = null;

                int status = connection.getResponseCode();
                String body = readResponse(connection, status);
                if (status == HttpURLConnection.HTTP_OK
                        || status == HttpURLConnection.HTTP_CREATED) {
                    completeSuccess(session, parseVoiceId(body));
                    return;
                }
                lastError = parseErrorMessage(body, status);
                if (!isRetryableStatus(status)) {
                    break;
                }
            } catch (Exception error) {
                lastError = safeMessage(error, "语音上传失败");
            } finally {
                closeQuietly(output);
                if (connection != null) {
                    connection.disconnect();
                }
                session.connection = null;
            }
        }
        completeFailure(session, lastError);
    }

    private HttpURLConnection openUploadConnection(
            String base, String requestId, int contentLength, boolean chunked)
            throws IOException {
        URL url = new URL(base + "/v1/voices");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(6000);
        connection.setReadTimeout(12000);
        connection.setUseCaches(false);
        connection.setDoInput(true);
        connection.setDoOutput(true);
        connection.setRequestMethod("POST");
        connection.setRequestProperty("Content-Type", "application/octet-stream");
        connection.setRequestProperty("X-Request-ID", requestId);
        connection.setRequestProperty("Connection", "close");
        if (chunked) {
            connection.setChunkedStreamingMode(4096);
        } else {
            connection.setFixedLengthStreamingMode(contentLength);
        }
        return connection;
    }

    private void playFile(String serverBase, String voiceId) {
        final String normalized = normalizeBase(serverBase);
        if (!validVoiceId(voiceId) || normalized.length() == 0) {
            notifyJs("语音播放失败", "语音文件名无效");
            return;
        }
        final int generation = roomGeneration;
        final String safeVoiceId = voiceId;
        executor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    File file = obtainVoiceFile(normalized, safeVoiceId, generation);
                    if (generation != roomGeneration) {
                        return;
                    }
                    startPlayer(file, generation);
                } catch (Exception error) {
                    if (generation == roomGeneration) {
                        notifyJs("语音播放失败", safeMessage(error, "语音下载失败"));
                    }
                }
            }
        });
    }

    private void preloadFile(String serverBase, String voiceId) {
        final String normalized = normalizeBase(serverBase);
        if (!validVoiceId(voiceId) || normalized.length() == 0) {
            return;
        }
        final int generation = roomGeneration;
        final String safeVoiceId = voiceId;
        executor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    obtainVoiceFile(normalized, safeVoiceId, generation);
                } catch (Exception error) {
                    Log.w(TAG, "Voice preload failed: " + safeMessage(error, ""));
                }
            }
        });
    }

    private File obtainVoiceFile(String base, String voiceId, int generation)
            throws IOException {
        File target = new File(cacheDir, voiceId + ".m4a");
        if (target.isFile() && target.length() > 0L) {
            target.setLastModified(System.currentTimeMillis());
            return target;
        }

        File part = new File(
                cacheDir,
                voiceId + "." + Thread.currentThread().getId() + ".part");
        HttpURLConnection connection = null;
        InputStream input = null;
        OutputStream output = null;
        try {
            connection = (HttpURLConnection) new URL(
                    base + "/v1/files/" + voiceId).openConnection();
            connection.setConnectTimeout(6000);
            connection.setReadTimeout(12000);
            connection.setUseCaches(false);
            connection.setRequestProperty("Connection", "close");
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                String body = readResponse(connection, status);
                throw new IOException(parseErrorMessage(body, status));
            }
            input = new BufferedInputStream(connection.getInputStream(), 8192);
            output = new BufferedOutputStream(new FileOutputStream(part), 8192);
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (generation != roomGeneration) {
                    throw new IOException("已离开语音房间");
                }
                if (read > 0) {
                    output.write(buffer, 0, read);
                }
            }
            output.flush();
            output.close();
            output = null;

            if (part.length() <= 0L) {
                throw new IOException("语音文件为空");
            }
            if (!part.renameTo(target)) {
                copyFile(part, target);
                if (!part.delete()) {
                    Log.w(TAG, "Unable to remove voice temp file");
                }
            }
            target.setLastModified(System.currentTimeMillis());
            pruneCache();
            return target;
        } finally {
            closeQuietly(input);
            closeQuietly(output);
            if (connection != null) {
                connection.disconnect();
            }
            if (part.exists() && !part.equals(target) && !part.delete()) {
                Log.w(TAG, "Unable to clean voice temp file");
            }
        }
    }

    private void startPlayer(final File file, final int generation) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (generation != roomGeneration) {
                    return;
                }
                releasePlayer();
                final MediaPlayer player = new MediaPlayer();
                mediaPlayer = player;
                try {
                    AudioManager audioManager =
                            (AudioManager) activity.getSystemService(Context.AUDIO_SERVICE);
                    if (audioManager != null) {
                        audioManager.requestAudioFocus(
                                null,
                                AudioManager.STREAM_MUSIC,
                                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
                    }
                    player.setAudioStreamType(AudioManager.STREAM_MUSIC);
                    player.setDataSource(file.getAbsolutePath());
                    player.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
                        @Override
                        public void onPrepared(MediaPlayer prepared) {
                            if (generation != roomGeneration || mediaPlayer != prepared) {
                                prepared.release();
                                return;
                            }
                            prepared.start();
                        }
                    });
                    player.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
                        @Override
                        public void onCompletion(MediaPlayer completed) {
                            if (mediaPlayer == completed) {
                                releasePlayer();
                            } else {
                                completed.release();
                            }
                            if (generation == roomGeneration) {
                                notifyJs("语音播放完成", "");
                            }
                        }
                    });
                    player.setOnErrorListener(new MediaPlayer.OnErrorListener() {
                        @Override
                        public boolean onError(MediaPlayer failed, int what, int extra) {
                            if (mediaPlayer == failed) {
                                releasePlayer();
                            } else {
                                failed.release();
                            }
                            if (generation == roomGeneration) {
                                notifyJs("语音播放失败", "语音解码失败");
                            }
                            return true;
                        }
                    });
                    player.prepareAsync();
                } catch (Exception error) {
                    releasePlayer();
                    notifyJs("语音播放失败", safeMessage(error, "语音播放失败"));
                }
            }
        });
    }

    private void leaveRoom() {
        roomGeneration++;
        pendingPermissionStart = false;
        pendingClientTag = "";
        AudioRecord prewarmed = preparedRecorder;
        preparedRecorder = null;
        if (prewarmed != null) {
            prewarmed.release();
        }
        RecordSession session = activeSession;
        if (session != null) {
            session.cancelled = true;
            session.stopRequested = true;
            HttpURLConnection connection = session.connection;
            if (connection != null) {
                connection.disconnect();
            }
            AudioRecord recorder = session.audioRecord;
            if (recorder != null) {
                try {
                    recorder.stop();
                } catch (RuntimeException ignored) {
                }
            }
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                releasePlayer();
            }
        });
    }

    private void shutdownInternal() {
        leaveRoom();
        executor.shutdownNow();
    }

    private void releasePlayer() {
        MediaPlayer player = mediaPlayer;
        mediaPlayer = null;
        if (player != null) {
            try {
                player.stop();
            } catch (RuntimeException ignored) {
            }
            player.reset();
            player.release();
        }
        AudioManager audioManager =
                (AudioManager) activity.getSystemService(Context.AUDIO_SERVICE);
        if (audioManager != null) {
            audioManager.abandonAudioFocus(null);
        }
    }

    private void completeSuccess(RecordSession session, String voiceId) {
        if (!validVoiceId(voiceId)) {
            completeFailure(session, "服务器返回了无效语音文件名");
            return;
        }
        if (session.completed.compareAndSet(false, true)
                && !session.cancelled
                && session.roomGeneration == roomGeneration) {
            notifyJs("语音录制成功", recordMessage(session.clientTag, voiceId));
        }
    }

    private void completeFailure(RecordSession session, String message) {
        if (session.completed.compareAndSet(false, true)
                && !session.cancelled
                && session.roomGeneration == roomGeneration) {
            notifyJs("语音录制失败", recordMessage(session.clientTag, message));
        }
    }

    private String validateSession(RecordSession session) {
        if (session.captureError != null) {
            return session.captureError;
        }
        if (session.byteCount < MIN_BYTES) {
            return "录音时间太短";
        }
        if (!session.hasSignal) {
            return "麦克风没有采集到声音";
        }
        return null;
    }

    private void awaitCapture(RecordSession session) {
        try {
            session.captureFinished.await();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            session.cancelled = true;
        }
    }

    private static boolean containsSignal(byte[] pcm) {
        for (int i = 0; i + 1 < pcm.length; i += 2) {
            int sample = (pcm[i] & 0xff) | (pcm[i + 1] << 8);
            if (sample > 1 || sample < -1) {
                return true;
            }
        }
        return false;
    }

    private static String normalizeBase(String base) {
        if (base == null) {
            return "";
        }
        String result = base.trim();
        while (result.endsWith("/")) {
            result = result.substring(0, result.length() - 1);
        }
        if (!result.startsWith("http://") && !result.startsWith("https://")) {
            return "";
        }
        return result;
    }

    private static boolean validVoiceId(String voiceId) {
        return voiceId != null && voiceId.matches("^[0-9a-f]{64}$");
    }

    private static boolean isRetryableStatus(int status) {
        return status == HttpURLConnection.HTTP_CONFLICT
                || status == 408
                || status == 425
                || status == 429
                || status >= 500;
    }

    private static String parseVoiceId(String body) throws Exception {
        JSONObject root = new JSONObject(body);
        JSONObject data = root.optJSONObject("data");
        String voiceId = data == null ? "" : data.optString("voiceId", "");
        if (!validVoiceId(voiceId)) {
            throw new IOException("服务器没有返回语音文件名");
        }
        return voiceId;
    }

    private static String parseErrorMessage(String body, int status) {
        try {
            JSONObject root = new JSONObject(body);
            JSONObject error = root.optJSONObject("error");
            String message = error == null ? "" : error.optString("message", "");
            if (message.length() > 0) {
                return message;
            }
        } catch (Exception ignored) {
        }
        return "语音服务器错误(" + status + ")";
    }

    private static String readResponse(HttpURLConnection connection, int status)
            throws IOException {
        InputStream input = status >= 200 && status < 400
                ? connection.getInputStream()
                : connection.getErrorStream();
        if (input == null) {
            return "";
        }
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read > 0) {
                    output.write(buffer, 0, read);
                }
            }
            return new String(output.toByteArray(), Charset.forName("UTF-8"));
        } finally {
            closeQuietly(input);
        }
    }

    private static void copyFile(File source, File target) throws IOException {
        InputStream input = null;
        OutputStream output = null;
        try {
            input = new BufferedInputStream(new FileInputStream(source), 8192);
            output = new BufferedOutputStream(new FileOutputStream(target), 8192);
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read > 0) {
                    output.write(buffer, 0, read);
                }
            }
            output.flush();
        } finally {
            closeQuietly(input);
            closeQuietly(output);
        }
    }

    private void pruneCache() {
        File[] files = cacheDir.listFiles();
        if (files == null || files.length <= CACHE_LIMIT) {
            return;
        }
        List<File> cached = new ArrayList<File>();
        for (File file : files) {
            if (file.getName().endsWith(".m4a")) {
                cached.add(file);
            }
        }
        Collections.sort(cached, new Comparator<File>() {
            @Override
            public int compare(File left, File right) {
                if (left.lastModified() == right.lastModified()) {
                    return 0;
                }
                return left.lastModified() < right.lastModified() ? -1 : 1;
            }
        });
        while (cached.size() > CACHE_LIMIT) {
            File oldest = cached.remove(0);
            if (!oldest.delete()) {
                Log.w(TAG, "Unable to prune voice cache");
            }
        }
    }

    private void notifyJs(final String type, final String message) {
        activity.runOnGLThread(new Runnable() {
            @Override
            public void run() {
                Cocos2dxJavascriptJavaBridge.evalString(
                        "cc.MobileManager.onMsgReturn("
                                + JSONObject.quote(type) + ","
                                + JSONObject.quote(message == null ? "" : message)
                                + ")");
            }
        });
    }

    private static String safeMessage(Throwable error, String fallback) {
        if (error == null || error.getMessage() == null
                || error.getMessage().trim().length() == 0) {
            return fallback;
        }
        return error.getMessage();
    }

    private static String recordMessage(String clientTag, String value) {
        return (clientTag == null ? "" : clientTag)
                + "\n"
                + (value == null ? "" : value);
    }

    private static void closeQuietly(InputStream input) {
        if (input != null) {
            try {
                input.close();
            } catch (IOException ignored) {
            }
        }
    }

    private static void closeQuietly(OutputStream output) {
        if (output != null) {
            try {
                output.close();
            } catch (IOException ignored) {
            }
        }
    }

    private static final class RecordSession {
        final String httpBase;
        final String requestId = UUID.randomUUID().toString().replace("-", "");
        final int roomGeneration;
        final String clientTag;
        final ByteArrayOutputStream pcm = new ByteArrayOutputStream(MAX_BYTES);
        final BlockingQueue<byte[]> uploadQueue = new LinkedBlockingQueue<byte[]>();
        final CountDownLatch captureFinished = new CountDownLatch(1);
        final AtomicBoolean completed = new AtomicBoolean(false);

        volatile boolean stopRequested;
        volatile boolean cancelled;
        volatile boolean hasSignal;
        volatile int byteCount;
        volatile String captureError;
        volatile AudioRecord audioRecord;
        volatile HttpURLConnection connection;

        RecordSession(String httpBase, int roomGeneration, String clientTag) {
            this.httpBase = httpBase;
            this.roomGeneration = roomGeneration;
            this.clientTag = clientTag;
        }

        boolean captureDone() {
            return captureFinished.getCount() == 0L;
        }
    }

    private static final class InvalidRecordingException extends Exception {
        InvalidRecordingException(String message) {
            super(message);
        }
    }

    private static final class HttpStatusException extends IOException {
        final int status;

        HttpStatusException(int status, String message) {
            super(message);
            this.status = status;
        }
    }
}
