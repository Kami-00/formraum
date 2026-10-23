# Formraum · Lokales CAD

Ein erster CAD-Prototyp zum direkten Arbeiten am 3D-Körper: Flächen anklicken, darauf zeichnen und Maße im rechten Fenster eingeben. Der Browser zeigt das Modell; FreeCAD/Open CASCADE berechnet die echten Volumenkörper auf demselben Rechner. Alle Maße sind in Millimetern.

![Formraum mit Beispielbauteil und Maßfenster](docs/preview.jpg)

## Starten

1. `start.cmd` doppelt anklicken.
2. Der Browser öffnet `http://127.0.0.1:8787`.
3. Den vorhandenen Quader anklicken und rechts seine Maße ändern.

Voraussetzungen sind Windows und FreeCAD 1.0 mit `python.exe` unter `%LOCALAPPDATA%\Programs\FreeCAD 1.0\bin\python.exe`. Für einen anderen Installationsort kann die Umgebungsvariable `FORMRAUM_FREECAD_PYTHON` auf diese Datei gesetzt werden. Kein npm-Build ist nötig.

Unter `examples/Beispielbauteil.formraum.json` liegt ein bearbeitbares Beispiel mit Aufbau, Kreistasche, Rundung und Fase. Über **Öffnen** laden. Die passenden STEP- und STL-Dateien liegen ebenfalls unter `examples/`. **Öffnen** unterstützt auch STEP-Dateien (`.step`, `.stp`).

Der Server läuft im Hintergrund weiter, wenn der Browser geschlossen wird. Ein erneuter Start öffnet dieselbe laufende Anwendung. Ein durch ein anderes Programm belegter Port wird mit einer Fehlermeldung angezeigt. Startprotokolle stehen in `.runtime/server.log` und `.runtime/server-error.log`.

## Erster Arbeitsablauf

1. **Körper wählen:** Quader oder Zylinder hinzufügen, anklicken und Maße beziehungsweise Position rechts eintragen.
2. **Fläche wählen:** Eine ebene Fläche anklicken und **Skizze** aktivieren. Rechteck oder Kreis direkt auf der Fläche aufziehen.
3. **Bearbeiten:** Höhe beziehungsweise Tiefe angeben und die Skizze **Aufbauen** oder **Ausschneiden** lassen.
4. **Kanten bearbeiten:** **Rundung** oder **Fase** wählen, Kanten anklicken und Radius beziehungsweise Fasenmaß eingeben.
5. **Sichern:** Das Projekt mit **Speichern** als bearbeitbare Projektdatei herunterladen. **Exportieren** erzeugt STEP für andere CAD-Systeme oder STL für den 3D-Druck.

Rechte Maustaste ziehen dreht die Ansicht, das Mausrad zoomt, die mittlere Maustaste verschiebt die Ansicht. **F** passt das Modell ein. **Strg Z** macht einen Schritt rückgängig, **Strg Y** stellt ihn wieder her. Die Schaltflächen **Oben**, **Vorn** und **Rechts** helfen beim Zeichnen.

## Lokale Daten und Grenzen

Die Anwendung verwendet eine Adresse auf `127.0.0.1`, lokal mitgelieferte Browser-Bibliotheken und keine Cloud-Dienste. Berechnungen und Datei-Exporte bleiben auf dem Rechner. Die automatische Browser-Sicherung ersetzt keine separat heruntergeladene Projektdatei.

Dies ist ein Prototyp für die gemeinsame Entwicklung der Bedienung. Unterstützt werden Quader, Zylinder, Rechteck- und Kreisskizzen auf ebenen Flächen sowie Aufbauen, Ausschneiden, Rundung und Fase. Freie Linienzüge, vollständig bemaßte Skizzen mit Abhängigkeiten und Baugruppenmechanik sind noch nicht umgesetzt. Jede Bearbeitung muss einen einzelnen gültigen Volumenkörper ergeben. Pro Projekt sind bis zu 30 Körper mit jeweils 50 Bearbeitungen vorgesehen.

Flächen- und Kantenbezüge werden mit Geometrieankern geprüft. Verändert eine frühere Bearbeitung einen solchen Bezug, weist die Anwendung die Änderung ab und behält den letzten gültigen Stand bei. Der betreffende Schritt muss dann auf der gewünschten Fläche oder Kante neu angelegt werden. Beim Entfernen eines Modellschritts werden auch seine Folgeschritte entfernt; Strg Z stellt sie gemeinsam wieder her. Dies ist noch keine vollständige parametrische Skizzen- und Referenzverwaltung.

## Geometrie-Prüfung für die Entwicklung

Mit FreeCAD-Python aus diesem Verzeichnis ausführen:

```powershell
& "$env:LOCALAPPDATA\Programs\FreeCAD 1.0\bin\python.exe" .\backendqa.py
```

Die Prüfung baut einen Quader mit Rechteckaufbau, Kreistasche und Rundung sowie einen Zylinder mit Fase. Sie vergleicht Maße und Volumina, prüft abgewiesene Operationen ohne Veränderung der Projektdaten und liest STEP sowie STL unabhängig wieder ein. Optional prüft `--server http://127.0.0.1:8787` zusätzlich den bereits laufenden lokalen HTTP-Server. Die Prüfung startet keinen Server.

`backend_reference_qa.py` prüft zusätzlich die Absicherung veränderter Flächen- und Kantenbezüge sowie das Ergänzen dieser Bezüge bei vorhandenen Projektdateien.
