package de.menne.gps;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.Locale;

/**
 * Sprachassistent: Mikrofon (Android-Spracherkennung, Deutsch) und Sprachausgabe (Android-TTS).
 * Ereignisse: "speech" {text}, "state" {listening, speaking, error}.
 * Während die App spricht, hört sie nicht zu (sonst würde sie sich selbst verstehen).
 */
@CapacitorPlugin(name = "Voice", permissions = {
        @Permission(alias = "mic", strings = {Manifest.permission.RECORD_AUDIO})
})
public class VoicePlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer rec;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private boolean wantListen = false;
    private boolean speaking = false;
    private String pendingText = null;
    private float pendingPitch = 0.7f, pendingRate = 0.95f;

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
            call.reject("Mikrofon nicht erlaubt");
        }
    }

    private void begin(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("Keine Spracherkennung auf diesem Gerät (Google-App/Sprachdienste fehlen)");
            return;
        }
        wantListen = true;
        main.post(this::startRec);
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

    private void startRec() {
        if (!wantListen || speaking) return;
        killRec();
        rec = SpeechRecognizer.createSpeechRecognizer(getContext());
        rec.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) { emitState(null); }
            @Override public void onBeginningOfSpeech() { }
            @Override public void onRmsChanged(float rmsdB) { }
            @Override public void onBufferReceived(byte[] buffer) { }
            @Override public void onEndOfSpeech() { }
            @Override public void onPartialResults(Bundle partialResults) { }
            @Override public void onEvent(int eventType, Bundle params) { }

            @Override
            public void onResults(Bundle results) {
                ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (list != null && !list.isEmpty()) {
                    JSObject o = new JSObject();
                    o.put("text", list.get(0));
                    notifyListeners("speech", o);
                }
                restart(300);
            }

            @Override
            public void onError(int error) {
                if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                    wantListen = false;
                    emitState("Mikrofon nicht erlaubt");
                    return;
                }
                // NO_MATCH (7) und SPEECH_TIMEOUT (6) sind normal: einfach weiter zuhören
                if (error != SpeechRecognizer.ERROR_NO_MATCH && error != SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                    emitState("Fehler " + error);
                }
                restart(error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ? 1200 : 400);
            }
        });
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "de-DE");
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
        try {
            rec.startListening(i);
        } catch (Exception e) {
            emitState("Start fehlgeschlagen");
            restart(1500);
        }
    }

    private void restart(long delayMs) {
        main.postDelayed(this::startRec, delayMs);
    }

    private void emitState(String error) {
        JSObject o = new JSObject();
        o.put("listening", wantListen && !speaking);
        o.put("speaking", speaking);
        if (error != null) o.put("error", error);
        notifyListeners("state", o);
    }

    // ---------- Sprachausgabe ----------
    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        pendingText = text;
        pendingPitch = call.getFloat("pitch", 0.7f);
        pendingRate = call.getFloat("rate", 0.95f);
        main.post(() -> {
            if (tts == null) {
                tts = new TextToSpeech(getContext(), status -> {
                    if (status == TextToSpeech.SUCCESS) {
                        tts.setLanguage(Locale.GERMANY);
                        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                            @Override public void onStart(String id) { }
                            @Override public void onDone(String id) { speechFinished(); }
                            @Override public void onError(String id) { speechFinished(); }
                        });
                        ttsReady = true;
                        sayPending();
                    }
                });
            } else if (ttsReady) {
                sayPending();
            }
        });
        call.resolve();
    }

    private void sayPending() {
        if (pendingText == null || pendingText.isEmpty()) return;
        // zuhören pausieren, solange gesprochen wird
        speaking = true;
        killRec();
        emitState(null);
        tts.setPitch(pendingPitch);
        tts.setSpeechRate(pendingRate);
        tts.speak(pendingText, TextToSpeech.QUEUE_FLUSH, null, "kitt");
        pendingText = null;
    }

    private void speechFinished() {
        main.post(() -> {
            speaking = false;
            emitState(null);
            if (wantListen) restart(500);
        });
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
