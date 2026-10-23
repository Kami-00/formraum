# Formraum · CAD im Browser

Formraum läuft vollständig im Browser: Oberfläche, echte CAD-Volumenkörper, STEP-Import und STEP-/STL-Export. FreeCAD, Python und ein CAD-Backend werden nicht benötigt. Open CASCADE wird als WebAssembly in einem Web Worker ausgeführt; Projekt- und Modelldaten bleiben auf deinem Gerät. Alle Maße sind in Millimetern.

![Formraum mit Beispielbauteil und Maßfenster](docs/preview.jpg)

## Anwendung öffnen

Die gebaute Anwendung wird als statische Website über HTTPS bereitgestellt. Nutzer öffnen nur deren Adresse – keine Installation, kein npm und kein lokaler Server erforderlich. Nach dem ersten vollständigen Laden speichert ein Service Worker auch den CAD-Kern für die Offline-Nutzung. Browser können diesen Cache bei Platzmangel entfernen; Projektdateien deshalb regelmäßig herunterladen.

Der erste Aufruf lädt rund 23 MB WebAssembly (bei gzip etwa 7,3 MB). Aktuelle Desktop-Browser mit WebAssembly, WebGL und Web Workers werden benötigt. Automatisiert geprüft wird Chromium. Maus und Tastatur sind für die CAD-Bedienung vorgesehen.

### Lokal entwickeln

Node.js **22.12 oder neuer** installieren und im Projektverzeichnis ausführen:

```sh
npm ci
npm run dev
```

Die ausgegebene Adresse öffnen (normalerweise `http://127.0.0.1:5173`). Unter Windows erledigt `start.cmd` diese Schritte und öffnet den Browser. Node.js dient ausschließlich der Entwicklung und dem Erstellen der statischen Dateien. Der lokale Entwicklungsserver liefert Dateien; er berechnet keine Geometrie.

### Statische Website bereitstellen

```sh
npm ci
npm run build
npm run preview
```

Den vollständigen Inhalt von `dist/` auf einem beliebigen statischen HTTPS-Host veröffentlichen. Auch Unterverzeichnisse wie `/formraum/` funktionieren; es werden relative Asset-Pfade verwendet. `.wasm` sollte mit `application/wasm` und möglichst komprimiert ausgeliefert werden. Keine API, Datenbank, Serverfunktion oder besonderen Cross-Origin-Isolation-Header nötig. Das direkte Öffnen von `index.html` über `file://` wird wegen Browserbeschränkungen für Module und Worker nicht unterstützt.

Für **GitHub Pages** ist `.github/workflows/pages.yml` vorbereitet: In den Repository-Einstellungen unter **Pages → Source → GitHub Actions** auswählen. Nach Übernahme auf `main` baut, testet und veröffentlicht der Workflow die Anwendung. Die vorgesehene Adresse ist `https://kami-00.github.io/formraum/`; sie ist erst nach erfolgreichem Deployment verfügbar. Das Einrichten dieses Workflows allein aktiviert Pages noch nicht.

## Arbeiten am Modell

1. **Körper wählen:** Quader oder Zylinder hinzufügen, anklicken und Maße beziehungsweise Position rechts eintragen.
2. **Fläche wählen:** Eine ebene Fläche anklicken und **Skizze** aktivieren. Rechteck oder Kreis auf der Fläche aufziehen.
3. **Bearbeiten:** Höhe beziehungsweise Tiefe angeben und die Skizze **Aufbauen** oder **Ausschneiden** lassen.
4. **Kanten bearbeiten:** **Rundung** oder **Fase** wählen, Kanten anklicken und Radius beziehungsweise Fasenmaß eingeben.
5. **Sichern:** **Speichern** lädt eine bearbeitbare `.formraum.json`-Datei herunter. **Exportieren** erzeugt STEP für andere CAD-Systeme oder STL für den 3D-Druck. **Öffnen** unterstützt Projektdateien und STEP (`.step`, `.stp`).

Rechts ziehen dreht, das Mausrad zoomt, die mittlere Maustaste verschiebt die Ansicht. **F** passt das Modell ein. **Strg Z** macht einen Schritt rückgängig, **Strg Y** stellt ihn wieder her. Unter macOS funktioniert auch Cmd. **Oben**, **Vorn** und **Rechts** helfen beim Zeichnen.

`examples/Beispielbauteil.formraum.json` enthält Aufbau, Kreistasche, Rundung und Fase; die passenden STEP-/STL-Dateien liegen daneben. Das vorhandene Projektformat Version 1 bleibt erhalten. Geometriebezüge werden anhand von Fläche, Normalen, Schwerpunkt und Kantenendpunkten geprüft und bei geänderter Open-CASCADE-Reihenfolge eindeutig zugeordnet. Nicht eindeutig zuordenbare Bezüge werden abgewiesen; die letzte gültige Geometrie bleibt erhalten. Alte Dateien ohne Geometrieanker erhalten diese nach erfolgreichem Aufbau.

## Daten und Grenzen

Die automatische Sicherung liegt im lokalen Browser-Speicher der jeweiligen Website-Adresse. Sie ersetzt keine heruntergeladene Projektdatei. Es gibt keine Cloud-Synchronisierung, Telemetrie oder extern geladenen Laufzeitbibliotheken. Der CAD-Kern und seine Abhängigkeiten werden zusammen mit der Anwendung ausgeliefert.

Unterstützt werden Quader, Zylinder, Rechteck- und Kreisskizzen auf ebenen Flächen, Aufbauen, Ausschneiden, Rundung, Fase und STEP-Volumenkörper. Freie Linienzüge, vollständig bemaßte Skizzen mit Abhängigkeiten und Baugruppenmechanik sind noch nicht umgesetzt. Jede Bearbeitung muss einen einzelnen gültigen Volumenkörper ergeben. Pro Projekt sind bis zu 30 Körper mit jeweils 50 Bearbeitungen vorgesehen; Dateiimporte sind auf 25 MB begrenzt. Komplexe Modelle hängen von Arbeitsspeicher und Leistung des Geräts ab. Nach 120 Sekunden wird eine hängende Berechnung abgebrochen; der Worker startet bei der nächsten Anfrage neu.

## Prüfungen

```sh
npm ci
npx playwright install chromium
npm run build
npm test
```

Die Tests führen den tatsächlichen WebAssembly-Kern im Browser aus. Sie prüfen Volumina, Flächen-/Kantenzuordnung, Aufbauen/Ausschneiden, Rundung/Fase, unveränderte Daten nach fehlgeschlagenen Operationen, das bestehende Beispielprojekt, STEP-Rückimport, binäres STL, Speichern, Rückgängig/Wiederholen und Wiederherstellung. Ein eigener Test lädt den Produktionsbuild von einem rein statischen Host unter `/formraum/`, schaltet das Netzwerk aus, lädt neu und modelliert/exportiert offline. CI führt dieselben Prüfungen aus.

`backend.py`, `backendqa.py` und `backend_reference_qa.py` bleiben als historische FreeCAD-Referenz erhalten. Sie gehören nicht zur Browser-Anwendung und werden weder gestartet noch ausgeliefert.

## Abhängigkeiten

- [Replicad](https://github.com/sgenoud/replicad): JavaScript-Schnittstelle zum CAD-Kern (MIT; siehe mitgelieferte Lizenz).
- [replicad-opencascadejs](https://github.com/sgenoud/replicad/tree/main/packages/replicad-opencascadejs): Open CASCADE als WebAssembly (LGPL-2.1; Originalquellen und Build-Anweisungen im verlinkten Projekt). Die WASM-Datei bleibt als austauschbare separate Datei erhalten.
- [Three.js](https://github.com/mrdoob/three.js): Darstellung und Kamerasteuerung (MIT).

Lizenztexte sind unter `web/public/licenses/` enthalten und über die Hilfe der Anwendung erreichbar. Versionen sind in `package-lock.json` festgeschrieben.
