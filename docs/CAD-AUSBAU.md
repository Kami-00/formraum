# Formraum: Ausbau von Bedienung und Konstruktion

Priorität des Nutzers vom 26. Oktober 2026: präzise Einzelteilkonstruktion und direkte Bedienung gemeinsam ausbauen. Formraum soll weiterhin im Browser laufen und Modelldaten auf dem eigenen Rechner halten. Diese Liste ist ein Entwicklungsplan; sie behauptet keine vollständige Funktionsgleichheit mit Tinkercad oder Onshape.

## Bestandsaufnahme

| Bereich | Vorhanden | Noch offen |
| --- | --- | --- |
| Direktes Formenbauen | Grundformen, Bohrkörper, Mehrfachauswahl, numerische Maße/Rotation/Skalierung, Boolesche Operationen | 3D-Griffe für Drehen/Skalieren, freies Ziehen aus der Formbibliothek, Auswahlrahmen, gesperrte Körper, Zwischenablage |
| Positionieren | Ausrichten, auf Boden setzen, gemeinsames Ziehen in XY/XZ/YZ, Achsensperre und Raster | Freie Arbeitsebenen, Flächenfang beim Platzieren, räumliches Einrasten und präzises Lineal direkt am Körper |
| Kopien und Spiegeln | Lineare und kreisförmige unabhängige Körperkopien; echte Spiegelgeometrie an versetzten Hauptebenen | Assoziative Muster mit editierbarer Anzahl, Raster in zwei Richtungen, Feature-/Flächenmuster, freie Spiegel- und Kurvenmuster |
| Skizzen | Rechteck, Kreis, Ellipse, regelmäßiges Vieleck; mehrere Konturen; Maße, Winkel, einfache Kantenabstände und Zentrieren | Linienzüge, Bögen, Splines, Langlöcher, Text, Trimmen, Verlängern, Versatz und Konstruktionsgeometrie |
| Skizzenabhängigkeiten | Maßfestlegung beim Ziehen und einige dauerhafte Positionsbezüge | Allgemeiner Solver: koinzident, horizontal/vertikal, parallel, rechtwinklig, tangential, gleich, symmetrisch; Freiheitsgrade und Konfliktanzeige |
| Volumenkörper | Aufbauen, Ausschneiden, Durch alles, Rundung, Fase, Wandung, einfache Zahnräder/Gewinde | Rotation, Loft, Sweep, Rippen, Formschräge, variable Rundungen, Normbohrungen und weitere Endbedingungen |
| Analyse | Volumen, Oberfläche, Außenmaße, kleinster Abstand zweier CAD-Körper | Punkt-/Kanten-/Winkelmessung, Schnittansicht, Materialien/Masse/Schwerpunkt, Überschneidungsvolumen und Wandstärkenprüfung |
| Modellverlauf | Nachträglich bearbeitbare Maße und Features; Referenzprüfung; Undo/Redo | Eigenständige Skizzenobjekte, Variablen/Formeln, Unterdrücken, Umordnen, Rollback-Marke, Abhängigkeitsgraph und Konfigurationen |
| Daten | Lokale Projekte und Entwürfe, JSON, STEP-Import/-Export und STL-Export, Offline-Cache | IndexedDB für größere Modelle, DXF/SVG-Skizzenimport, STL-Netzbearbeitung, 3MF, wiederverwendbare Bauteilbibliothek |
| Weitere Systeme | Noch nicht umgesetzt | Baugruppen/Gelenke, Explosionsansichten, technische Zeichnungen/Stücklisten, Blech, Flächenmodellierung, Simulation |
| Zusammenarbeit | Optionale lokale MCP-Verbindung | Mehrbenutzerbetrieb, Freigaben, Versionszweige und gemeinsame Cloud-Dokumente; eigene Architekturentscheidung erforderlich |

## Nächste zusammenhängende Ausbauschritte

1. **Werkzeugbedienung vereinheitlichen:** Vorschau, Anwenden und Abbrechen für Transformationen; Auswahlzustand und Werkzeugzustand vom großen UI-Modul trennen. Bestehende Dateien und Undo dürfen dabei nicht verändert werden.
2. **Freie Skizzen als eigenständige Objekte:** Stabile IDs für Punkte, Linien und Bögen; geschlossene Bereiche erkennen; Trimmen, Konstruktionselemente und direkte Bearbeitung. Vorhandene Rechteck-/Kreisprojekte müssen weiterhin laden.
3. **Abhängigkeiten lösen:** Einen geeigneten browserfähigen Solver auswählen und getrennt testen. Unter-, voll- und überbestimmte Skizzen sichtbar unterscheiden. Widersprüchliche Maße dürfen die letzte gültige Kontur nicht zerstören.
4. **Parametrische Modellierung erweitern:** Rotation, danach Sweep/Loft auf den eigenständigen Skizzen; Variablen, weitere Endbedingungen und assoziative Muster. Referenzen müssen bei Änderungen nachvollziehbar bleiben oder eine gezielte Reparatur anbieten.
5. **Direkte 3D-Bedienung vertiefen:** Transformationsgriffe, Fläche als Arbeitsebene, Flächenfang, Auswahlrahmen, Lineal und Kontextmenüs. Dieselben Operationen sollen über Ziehen und genaue Eingaben ausführbar sein.
6. **Konstruktion prüfen und weitergeben:** Schnittansicht, detaillierte Messungen, Materialdaten, technische Zeichnungen und erweiterte Dateiformate. Baugruppen folgen als eigener Bereich.

Die Reihenfolge 2–5 beschreibt Abhängigkeiten, keine endgültigen Zeit- oder Vollständigkeitszusagen. Jede Stufe braucht reale CAD-Tests, Fehlerfälle, Speichern/Laden und eine nutzbare Oberfläche. Funktionen mit nur einem sichtbaren Knopf gelten nicht als umgesetzt.

## Abnahmekriterien für den aktuellen Ausbau

- Kopien erhalten Maße und bestehende Bearbeitungen; Eingaben und Ursprungsobjekte bleiben unverändert, bis die Aktion erfolgreich übernommen wird.
- Kreisverteilung funktioniert bei gedrehten Ausgangsteilen, versetztem Zentrum, negativen Winkeln, Teil- und Vollkreisen.
- Spiegeln erhält das Volumen, spiegelt auch asymmetrische Geometrie korrekt und erlaubt nachfolgende Features sowie STEP-Export.
- Gemeinsames Verschieben erhält die relativen Abstände; Ebene, Achse, Raster und Esc werden berücksichtigt.
- Körperabstände stammen aus dem CAD-Kern; Messen schreibt keine Projektrevision und erzeugt keinen Undo-Schritt.
- Ungültige Maße und die Körpergrenze werden ohne Datenverlust gemeldet. Bestehende Tests müssen weiterhin bestehen.

## Referenzen für die Funktionsplanung

- [Tinkercad: offizielle Tastatur- und Werkzeugübersicht](https://images.tinkercad.com/jl5ii4oqrdmc/6TNFVIF89KMN9CPLLH97U0/a847b794b1b579f1529d87863783df8d/Tinkercad_keyboard_shortcuts_2_up.pdf)
- [Onshape: Skizzenwerkzeuge](https://cad.onshape.com/help/Content/Sketch/sketch_tools.htm)
- [Onshape: lineare Muster](https://cad.onshape.com/help/Content/PartStudio/linear_pattern.htm)
- [Onshape: Rotation](https://cad.onshape.com/help/Content/PartStudio/revolve.htm), [Loft](https://cad.onshape.com/help/Content/PartStudio/loft.htm), [Sweep](https://cad.onshape.com/help/Content/PartStudio/sweep.htm)
- [Onshape: Konfigurationen](https://cad.onshape.com/help/Content/PartStudio/part_studio_and_assembly_configurations.htm), [Zeichnungen](https://www.onshape.com/en/features/drawings), [Simulation](https://www.onshape.com/en/features/simulation)

Quellen dienen als Vergleich für Arbeitsabläufe und Fähigkeiten; Formraum entwickelt eine eigene Oberfläche und Implementierung.
