package de.menne.gps;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/** Hält die App mit einer Benachrichtigung im Vordergrund, damit KITT auch bei anderen Apps zuhören darf. */
public class KeepAliveService extends Service {
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String ch = "kitt";
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel(ch, "KITT", NotificationManager.IMPORTANCE_LOW));
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, ch) : new Notification.Builder(this);
        Notification n = b.setContentTitle("KITT hört zu").setContentText("Sprachsteuerung aktiv")
                .setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentIntent(pi).setOngoing(true).build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        else startForeground(1, n);
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
