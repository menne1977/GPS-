package de.menne.gps;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
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

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Sprachassistent: Mikrofon (Android-Spracherkennung, Deutsch) und Sprachausgabe (Android-TTS)
 * auf dem Medien-Kanal mit einstellbarer Lautstärke. Vor jeder Ausgabe wird die Erkennung komplett beendet und Audiofokus
 * geholt; danach wird sie neu aufgebaut. Jede Ausgabe hat eine eigene Nummer, damit späte Rückmeldungen
 * älterer Ausgaben nichts durcheinanderbringen.
 * Ereignisse: "speech" {text, alts}, "state" {listening, speaking, error}, "spoke" {via}.
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
    private int idle = 0;
    private boolean once = false;
    private int token = 0;
    private AudioManager am;
    private AudioFocusRequest focusReq;

    private String pText = "", pVoice = "";
    private float pPitch = 0.85f, pRate = 0.95f, pVolume = 80f;

    private AudioManager am() {
        if (am == null) am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        return am;
    }

    // ---------- Mikrofon ----------
    @PluginMethod
    public void listen(PluginCall call) {
        if (getPermissionState("mic") != PermissionState.GRANTED) {
            requestPermissionForAlias("mic", call, "micPermResult");
            return;
        }
        begin(call);
    }

    // Einmal zuhören (Tippen & sprechen): kein Dauerbetrieb, kein ständiges Neustarten
    @PluginMethod
    public void listenOnce(PluginCall call) {
        if (getPermissionState("mic") != PermissionState.GRANTED) {
            requestPermissionForAlias("mic", call, "micPermOnce");
            return;
        }
        beginOnce(call);
    }

    @PermissionCallback
    private void micPermOnce(PluginCall call) {
        if (getPermissionState("mic") == PermissionState.GRANTED) beginOnce(call);
        else call.reject("Mikrofon nicht erlaubt (Android-Einstellungen > Apps > Berechtigungen)");
    }

    private void beginOnce(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("Keine Spracherkennung auf diesem Gerät (Google-App / Sprachdienste fehlen)");
            return;
        }
        once = true;
        main.post(() -> startRec(true));
        call.resolve();
    }

    @PermissionCallback
    private void micPermResult(PluginCall call) {
        if (getPermissionState("mic") == PermissionState.GRANTED) begin(call);
        else call.reject("Mikrofon nicht erlaubt (Android-Einstellungen > Apps > Berechtigungen)");
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
        once = false;
        main.post(() -> { killRec(); emitState(null); });
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
        if (!(wantListen || once) || speaking) return;
        if (fresh) killRec();
        if (rec == null) {
            rec = SpeechRecognizer.createSpeechRecognizer(getContext());
            rec.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) { emitState(null); }
                @Override public void onBeginningOfSpeech() { hardErrors = 0; idle = 0; }
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
                        JSArray alts = new JSArray();
                        for (String a : list) alts.put(a);
                        o.put("alts", alts);
                        notifyListeners("speech", o);
                    }
                    idle = 0;
                    if (once) { once = false; emitState(null); return; }
                    if (!speaking) again(250, false);
                }

                @Override
                public void onError(int error) {
                    if (speaking) return; // Abbruch durch eigene Ausgabe
                    if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                        if (once) { once = false; killRec(); emitState("Nichts verstanden"); return; }
                        // Ruhephasen: Neustarts seltener, damit das Mikrofon-Symbol weniger flackert
                        idle++;
                        again(idle < 3 ? 250 : 1500, false);
                        return;
                    }
                    if (once) { once = false; killRec(); emitState(errText(error)); return; }
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
                    boolean net = error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT
                            || error == SpeechRecognizer.ERROR_SERVER || error == 10;
                    again(Math.min(6000, (net ? 2000 : 800) * hardErrors), true);
                }
            });
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "de-DE");
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L);
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
        o.put("listening", (wantListen || once) && !speaking);
        o.put("speaking", speaking);
        if (error != null) o.put("error", error);
        notifyListeners("state", o);
    }

    private void emitSpoke(String via) {
        JSObject o = new JSObject();
        o.put("via", via);
        notifyListeners("spoke", o);
    }

    // ---------- Audiofokus + Lautstärke ----------
    private int savedVol = -1;

    private void takeFocus() {
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                focusReq = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                        .setAudioAttributes(attrs()).build();
                am().requestAudioFocus(focusReq);
            } else {
                am().requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
            }
        } catch (Exception ignored) { }
    }

    private void dropFocus() {
        try {
            if (Build.VERSION.SDK_INT >= 26 && focusReq != null) am().abandonAudioFocusRequest(focusReq);
            else am().abandonAudioFocus(null);
        } catch (Exception ignored) { }
    }

    // Medienlautstärke während der Ansage auf den eingestellten Wert setzen, danach zurück
    private void raiseVolume() {
        if (pVolume <= 0) return;
        try {
            int max = am().getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            int cur = am().getStreamVolume(AudioManager.STREAM_MUSIC);
            int want = Math.max(1, Math.round(max * pVolume / 100f));
            if (want != cur) {
                if (savedVol < 0) savedVol = cur;
                am().setStreamVolume(AudioManager.STREAM_MUSIC, want, 0);
            }
        } catch (Exception e) {
            emitState("Lautstärke nicht änderbar (Nicht-stören aktiv?)");
        }
    }

    private void restoreVolume() {
        if (savedVol < 0) return;
        try { am().setStreamVolume(AudioManager.STREAM_MUSIC, savedVol, 0); } catch (Exception ignored) { }
        savedVol = -1;
    }

    private static AudioAttributes attrs() {
        // Medien-Kanal: folgt der normalen Medienlautstärke
        return new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    }

    // ---------- Sprachausgabe ----------
    private String langStatus = "unbekannt";

    private void ensureTts(Runnable r) {
        main.post(() -> {
            if (ttsReady && tts != null) { r.run(); return; }
            waiting.add(r);
            if (tts != null) return;
            tts = new TextToSpeech(getContext(), status -> {
                if (status != TextToSpeech.SUCCESS) {
                    waiting.clear();
                    tts = null;
                    langStatus = "kein Sprachdienst";
                    emitState("Sprachausgabe nicht verfügbar: kein Text-zu-Sprache-Dienst aktiv (Android-Einstellungen > Text-zu-Sprache)");
                    return;
                }
                int lr = tts.setLanguage(Locale.GERMANY);
                langStatus = (lr == TextToSpeech.LANG_MISSING_DATA) ? "Deutsch: Sprachdaten fehlen"
                        : (lr == TextToSpeech.LANG_NOT_SUPPORTED) ? "Deutsch nicht unterstützt" : "Deutsch OK";
                if (lr == TextToSpeech.LANG_MISSING_DATA || lr == TextToSpeech.LANG_NOT_SUPPORTED) {
                    emitState("Deutsche Sprachausgabe fehlt: Android-Einstellungen > Text-zu-Sprache > Sprachdaten installieren");
                }
                tts.setAudioAttributes(attrs());
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { if (isCurrent(id)) emitSpoke("ok"); }
                    @Override public void onDone(String id) { if (isCurrent(id)) speechFinished(token); }
                    @Override public void onError(String id) { if (isCurrent(id)) speechFinished(token); }
                    @Override public void onError(String id, int code) {
                        if (isCurrent(id)) emitState("Sprachausgabe-Fehler " + code);
                        onError(id);
                    }
                });
                ttsReady = true;
                List<Runnable> copy = new ArrayList<>(waiting);
                waiting.clear();
                for (Runnable w : copy) w.run();
            });
        });
    }

    private boolean isCurrent(String id) {
        int c = id.indexOf(':');
        try { return c > 0 && Integer.parseInt(id.substring(c + 1)) == token; } catch (Exception e) { return false; }
    }

    @PluginMethod
    public void speak(PluginCall call) {
        pText = call.getString("text", "");
        pPitch = call.getFloat("pitch", 0.85f);
        pRate = call.getFloat("rate", 0.95f);
        pVoice = call.getString("voice", "");
        pVolume = call.getFloat("volume", 80f);
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
                        o.put("network", v.isNetworkConnectionRequired());
                        o.put("installed", !v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED));
                        arr.put(o);
                    }
                }
            } catch (Exception ignored) { }
            JSObject out = new JSObject();
            out.put("voices", arr);
            call.resolve(out);
        });
    }

    // Stimme prüfen: Dienst, Sprache, aktive Stimme, Medienlautstärke
    @PluginMethod
    public void check(PluginCall call) {
        ensureTts(() -> {
            JSObject o = new JSObject();
            try { o.put("engine", tts.getDefaultEngine()); } catch (Exception e) { o.put("engine", "?"); }
            o.put("language", langStatus);
            try { Voice v = tts.getVoice(); o.put("voice", v != null ? v.getName() : "Standard"); } catch (Exception e) { o.put("voice", "?"); }
            int max = am().getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            int cur = am().getStreamVolume(AudioManager.STREAM_MUSIC);
            o.put("media", Math.round(cur * 100f / Math.max(1, max)));
            call.resolve(o);
        });
        // falls kein Dienst startet, trotzdem antworten
        main.postDelayed(() -> {
            if (!ttsReady) {
                JSObject o = new JSObject();
                o.put("engine", "keiner");
                o.put("language", langStatus);
                o.put("voice", "-");
                o.put("media", -1);
                try { call.resolve(o); } catch (Exception ignored) { }
            }
        }, 4000);
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
        final int tk = ++token;
        speaking = true;
        killRec();                 // Erkennung komplett beenden
        tts.stop();
        emitState(null);
        takeFocus();
        raiseVolume();
        applyVoice();
        main.postDelayed(() -> { if (speaking && token == tk) speechFinished(tk); }, 9000 + pText.length() * 120L);
        Bundle b = new Bundle();
        b.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f);
        b.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC);
        int r = tts.speak(pText, TextToSpeech.QUEUE_FLUSH, b, "say:" + tk);
        if (r != TextToSpeech.SUCCESS) {
            emitState("Sprachausgabe konnte nicht starten");
            speechFinished(tk);
        }
    }

    private void speechFinished(int tk) {
        main.post(() -> {
            if (token != tk || !speaking) return;
            speaking = false;
            restoreVolume();
            dropFocus();
            emitState(null);
            if (wantListen) again(700, true);
        });
    }

    @Override
    protected void handleOnDestroy() {
        wantListen = false;
        killRec();
        restoreVolume();
        dropFocus();
        if (tts != null) { tts.stop(); tts.shutdown(); tts = null; }
    }
}
