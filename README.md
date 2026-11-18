# GPS Fahr-Dashboard

Web-App (Ordner `www/`) für Geschwindigkeit, Tageswerte, Wetter, DWD-Warnungen und Tankstellen in der Nähe. Ohne Blitzer-Warnungen.

## Datenquellen

- **GPS / Sensoren:** laufend, kein Datenabruf.
- **Tempolimit:** OpenStreetMap über Overpass, nur bei mehr als 300 m Bewegung. Ohne Angabe gelten Richtwerte je Land.
- **Wetter:** Open-Meteo, Standard 30 Minuten.
- **DWD-Warnungen:** `warnings.json` des DWD, Standard 15 Minuten. Die Gemeinde-Kennung (WARNCELLID) trägt man im Menü ein.
- **Tankstellen:** OpenStreetMap, Standard 30 Minuten. Preise sind nicht enthalten, weil kein Preis-Schlüssel vorliegt.
- **Stau:** nur eigene Meldungen. Live-Staudaten brauchen einen Anbieter mit Schlüssel.

Jede Quelle lässt sich im Menü einzeln ausschalten. Der Sparmodus schaltet alle Abrufe ab.

## Lokal testen

`www/index.html` im Browser öffnen oder mit einem einfachen Server starten. GPS und Sensoren brauchen HTTPS oder localhost.

## APK bauen (Capacitor)

```bash
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "GPS" "de.menne.gps" --web-dir=www
npx cap add android
npx cap sync android
npx cap open android   # in Android Studio: Build > Build APK(s)
```

Hinweise:
- Im Web-Build blockiert der Browser Abrufe an fremde Server (CORS). In der APK hilft das Capacitor-Plugin `CapacitorHttp` (in `capacitor.config.json` unter `plugins` aktivieren).
- Die Berechtigungen für Standort (`ACCESS_FINE_LOCATION`) und Internet trägt man in `android/app/src/main/AndroidManifest.xml` ein.
- Die DWD-Datei ist in JavaScript eingepackt. Die Auswertung in `fetchDwd()` bitte mit einer echten Gemeinde-Kennung prüfen, weil die Feldnamen (`event`, `level`) nicht überprüft sind.

## Lizenz und Nutzung

Nur für den privaten Gebrauch. OpenStreetMap-Daten (ODbL) brauchen einen Quellenhinweis. Die Nutzungsbedingungen von Open-Meteo und Overpass bitte vor einer Veröffentlichung prüfen.
