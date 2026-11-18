package de.menne.gps;

import android.Manifest;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileInputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Sprachassistent: Mikrofon (Android-Spracherkennung, Deutsch) und Sprachausgabe (Android-TTS)
 * mit optionalem Roboter-Effekt (Ringmodulation + Kammfilter) für einen KITT-ähnlichen Klang.
 * Ereignisse: "speech" {text}, "state" {listening, speaking, error}.
 */
@CapacitorPlugin(name = "Voice", permissions = {
        @Permission(alias = "mic", strings = {Manifest.permission.RECORD_AUDIO})
})
public class VoicePlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer rec;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private final List<Runnable> waiting = new ArrayList<>();
    private boolean wantListen = false;
    private boolean speaking = false;
    private int hardErrors = 0;

    private String pText = "", pVoice = "";
    private float pPitch = 0.7f, pRate = 0.95f;
    private boolean pFx = true;

    // ---------- Mikrofon ----------
    @PluginMethod
    public void listen(PluginCall call) {
        if (getPermissionState("mic") != PermissionState.GRANTED) {
            requestPermissionForAlias("mic", call, "micPermResult");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void micPermResult(PluginCall call) {
        if (getPermissionState("mic") == PermissionState.GRANTED) {
            begin(call);
        } else {
            call.reject("Mikrofon nicht erlaubt (Android-Einstellungen > Apps > Berechtigungen)");
        }
    }

    private void begin(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("Keine Spracherkennung auf diesem Gerät (Google-App / Sprachdienste fehlen)");
            return;
        }
        wantListen = true;
        hardErrors = 0;
        main.post(() -> startRec(true));
        call.resolve();
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        wantListen = false;
        main.post(() -> {
            killRec();
            emitState(null);
        });
        call.resolve();
    }

    private void killRec() {
        if (rec != null) {
            try { rec.cancel(); } catch (Exception ignored) { }
            try { rec.destroy(); } catch (Exception ignored) { }
            rec = null;
        }
    }

    private static String errText(int e) {
        switch (e) {
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "Netzwerk-Zeitüberschreitung (1)";
            case SpeechRecognizer.ERROR_NETWORK: return "Kein Internet für die Spracherkennung (2)";
            case SpeechRecognizer.ERROR_AUDIO: return "Audioaufnahme fehlgeschlagen (3)";
            case SpeechRecognizer.ERROR_SERVER: return "Server der Spracherkennung meldet Fehler (4)";
            case SpeechRecognizer.ERROR_CLIENT: return "Client-Fehler der Spracherkennung (5)";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "Mikrofon nicht erlaubt (9)";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "Spracherkennung belegt (8)";
            case 10: return "Zu viele Anfragen (10)";
            case 11: return "Verbindung zum Sprachdienst getrennt (11)";
            case 12: return "Deutsch wird nicht unterstützt (12)";
            case 13: return "Deutsches Sprachpaket fehlt, in der Google-App herunterladen (13)";
            default: return "Fehler " + e;
        }
    }

    private void startRec(boolean fresh) {
        if (!wantListen || speaking) return;
        if (fresh) killRec();
        if (rec == null) {
            rec = SpeechRecognizer.createSpeechRecognizer(getContext());
            rec.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) { emitState(null); }
                @Override public void onBeginningOfSpeech() { hardErrors = 0; }
                @Override public void onRmsChanged(float rmsdB) { }
                @Override public void onBufferReceived(byte[] buffer) { }
                @Override public void onEndOfSpeech() { }
                @Override public void onPartialResults(Bundle partialResults) { }
                @Override public void onEvent(int eventType, Bundle params) { }

                @Override
                public void onResults(Bundle results) {
                    hardErrors = 0;
                    ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (list != null && !list.isEmpty()) {
                        JSObject o = new JSObject();
                        o.put("text", list.get(0));
                        notifyListeners("speech", o);
                    }
                    again(250, false);
                }

                @Override
                public void onError(int error) {
                    if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                        again(250, false); // normal: nichts gesagt
                        return;
                    }
                    if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS || error == 12 || error == 13) {
                        wantListen = false;
                        killRec();
                        emitState(errText(error));
                        return;
                    }
                    hardErrors++;
                    emitState(errText(error));
                    if (hardErrors >= 10) {
                        wantListen = false;
                        killRec();
                        emitState("Mikrofon gestoppt nach mehreren Fehlern: " + errText(error));
                        return;
                    }
                    // Rückzug: je mehr Fehler in Folge, desto länger warten; Erkennung neu aufbauen
                    boolean net = error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT
                            || error == SpeechRecognizer.ERROR_SERVER || error == 10;
                    long delay = Math.min(6000, (net ? 2000 : 800) * hardErrors);
                    again(delay, true);
                }
            });
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "de-DE");
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
        try {
            rec.startListening(i);
        } catch (Exception e) {
            emitState("Start fehlgeschlagen: " + e.getMessage());
            again(1500, true);
        }
    }

    private void again(long delayMs, boolean fresh) {
        main.postDelayed(() -> startRec(fresh), delayMs);
    }

    private void emitState(String error) {
        JSObject o = new JSObject();
        o.put("listening", wantListen && !speaking);
        o.put("speaking", speaking);
        if (error != null) o.put("error", error);
        notifyListeners("state", o);
    }

    // ---------- Sprachausgabe ----------
    private void ensureTts(Runnable r) {
        main.post(() -> {
            if (ttsReady) { r.run(); return; }
            waiting.add(r);
            if (tts == null) {
                tts = new TextToSpeech(getContext(), status -> {
                    if (status == TextToSpeech.SUCCESS) {
                        tts.setLanguage(Locale.GERMANY);
                        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                            @Override public void onStart(String id) { }
                            @Override public void onDone(String id) {
                                if ("fx".equals(id)) {
                                    new Thread(VoicePlugin.this::playFx).start();
                                } else {
                                    speechFinished();
                                }
                            }
                            @Override public void onError(String id) {
                                if ("fx".equals(id)) {
                                    main.post(VoicePlugin.this::speakPlain);
                                } else {
                                    speechFinished();
                                }
                            }
                        });
                        ttsReady = true;
                        List<Runnable> copy = new ArrayList<>(waiting);
                        waiting.clear();
                        for (Runnable w : copy) w.run();
                    } else {
                        waiting.clear();
                        tts = null;
                    }
                });
            }
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        pText = call.getString("text", "");
        pPitch = call.getFloat("pitch", 0.7f);
        pRate = call.getFloat("rate", 0.95f);
        pVoice = call.getString("voice", "");
        pFx = call.getBoolean("fx", true);
        ensureTts(this::sayPending);
        call.resolve();
    }

    @PluginMethod
    public void voices(PluginCall call) {
        ensureTts(() -> {
            JSArray arr = new JSArray();
            try {
                for (Voice v : tts.getVoices()) {
                    if ("de".equals(v.getLocale().getLanguage())) {
                        JSObject o = new JSObject();
                        o.put("name", v.getName());
                        o.put("country", v.getLocale().getCountry());
                        o.put("network", v.isNetworkConnectionRequired());
                        arr.put(o);
                    }
                }
            } catch (Exception ignored) { }
            JSObject out = new JSObject();
            out.put("voices", arr);
            call.resolve(out);
        });
    }

    private void applyVoice() {
        tts.setLanguage(Locale.GERMANY);
        if (pVoice != null && !pVoice.isEmpty()) {
            try {
                for (Voice v : tts.getVoices()) {
                    if (v.getName().equals(pVoice)) { tts.setVoice(v); break; }
                }
            } catch (Exception ignored) { }
        }
        tts.setPitch(pPitch);
        tts.setSpeechRate(pRate);
    }

    private void sayPending() {
        if (pText == null || pText.isEmpty() || tts == null) return;
        speaking = true;           // währenddessen nicht zuhören
        if (rec != null) { try { rec.cancel(); } catch (Exception ignored) { } }
        emitState(null);
        applyVoice();
        if (pFx) {
            File f = new File(getContext().getCacheDir(), "kitt.wav");
            Bundle b = new Bundle();
            int r = tts.synthesizeToFile(pText, b, f, "fx");
            if (r != TextToSpeech.SUCCESS) speakPlain();
        } else {
            speakPlain();
        }
    }

    private void speakPlain() {
        if (tts == null) { speechFinished(); return; }
        tts.speak(pText, TextToSpeech.QUEUE_FLUSH, null, "plain");
    }

    private void speechFinished() {
        main.post(() -> {
            speaking = false;
            emitState(null);
            if (wantListen) again(500, false);
        });
    }

    // ---------- Roboter-Effekt: WAV lesen, bearbeiten, abspielen ----------
    private static int le16(byte[] b, int o) { return (b[o] & 0xff) | ((b[o + 1] & 0xff) << 8); }
    private static int le32(byte[] b, int o) { return le16(b, o) | (le16(b, o + 2) << 16); }

    private void playFx() {
        File f = new File(getContext().getCacheDir(), "kitt.wav");
        try {
            byte[] b = new byte[(int) f.length()];
            try (FileInputStream in = new FileInputStream(f)) {
                int off = 0, n;
                while (off < b.length && (n = in.read(b, off, b.length - off)) > 0) off += n;
            }
            int ch = le16(b, 22), rate = le32(b, 24), bits = le16(b, 34);
            int data = -1;
            for (int i = 12; i + 8 < b.length; i++) {
                if (b[i] == 'd' && b[i + 1] == 'a' && b[i + 2] == 't' && b[i + 3] == 'a') { data = i + 8; break; }
            }
            if (data < 0 || bits != 16 || ch < 1 || ch > 2 || rate < 8000) throw new Exception("WAV-Format");
            int n = (b.length - data) / 2;
            short[] s = new short[n];
            ByteBuffer.wrap(b, data, n * 2).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(s);

            // Ringmodulation (45 Hz, 35 %) + kurzer Kammfilter (6 ms) = leicht metallischer Computer-Klang
            float[] y = new float[n];
            double w = 2 * Math.PI * 45.0 / rate;
            float mix = 0.35f;
            int dd = Math.max(1, (int) (rate * 0.006)) * ch;
            float peak = 0.0001f;
            for (int k = 0; k < n; k++) {
                float x = s[k] / 32768f;
                float rm = x * (float) Math.sin(w * (k / ch));
                float v = x * (1 - mix) + rm * mix;
                if (k >= dd) v += 0.3f * y[k - dd];
                y[k] = v;
                float a = Math.abs(v);
                if (a > peak) peak = a;
            }
            float g = 0.9f / Math.max(peak, 0.9f);
            for (int k = 0; k < n; k++) s[k] = (short) Math.max(-32768, Math.min(32767, y[k] * g * 32767f));

            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
            AudioFormat fmt = new AudioFormat.Builder().setSampleRate(rate)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(ch == 1 ? AudioFormat.CHANNEL_OUT_MONO : AudioFormat.CHANNEL_OUT_STEREO).build();
            final AudioTrack t = new AudioTrack(attrs, fmt, n * 2, AudioTrack.MODE_STATIC, AudioManager.AUDIO_SESSION_ID_GENERATE);
            t.write(s, 0, n);
            final int frames = n / ch;
            final AtomicBoolean done = new AtomicBoolean(false);
            final Runnable finish = () -> {
                if (done.compareAndSet(false, true)) {
                    try { t.release(); } catch (Exception ignored) { }
                    f.delete();
                    speechFinished();
                }
            };
            t.setNotificationMarkerPosition(Math.max(1, frames - 1));
            t.setPlaybackPositionUpdateListener(new AudioTrack.OnPlaybackPositionUpdateListener() {
                @Override public void onMarkerReached(AudioTrack track) { finish.run(); }
                @Override public void onPeriodicNotification(AudioTrack track) { }
            });
            t.play();
            main.postDelayed(finish, (long) (frames * 1000.0 / rate) + 1500); // Sicherheitsnetz
        } catch (Exception e) {
            // Effekt nicht möglich: normal sprechen
            main.post(this::speakPlain);
        }
    }

    @Override
    protected void handleOnDestroy() {
        wantListen = false;
        killRec();
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
    }
}
