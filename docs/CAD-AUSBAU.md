# Formraum: Ausbau von Bedienung und Konstruktion

Priorität des Nutzers vom 26. Oktober 2026: präzise Einzelteilkonstruktion und direkte Bedienung gemeinsam ausbauen. Formraum soll weiterhin im Browser laufen und Modelldaten auf dem eigenen Rechner halten. Diese Liste ist ein Entwicklungsplan; sie behauptet keine vollständige Funktionsgleichheit mit Tinkercad oder Onshape.

## Bestandsaufnahme

| Bereich | Vorhanden | Noch offen |
| --- | --- | --- |
| Direktes Formenbauen | Grundformen, Bohrkörper, Mehrfachauswahl, numerische Maße/Rotation/Skalierung, Boolesche Operationen, 3D-Drehgriffe und gleichmäßige Skalierungsgriffe, Auswahlrahmen, Körpersperren, Formraum-Zwischenablage | Freies Ziehen aus der Formbibliothek, Skalieren einzelner Achsen, weitere Kontextaktionen |
| Positionieren | Ausrichten, auf Boden setzen, gemeinsames Ziehen in XY/XZ/YZ, Achsensperre und Raster | Freie Arbeitsebenen, Flächenfang beim Platzieren, räumliches Einrasten und präzises Lineal direkt am Körper |
| Kopien und Spiegeln | Lineare und kreisförmige unabhängige Körperkopien; echte Spiegelgeometrie an versetzten Hauptebenen; assoziative Generator-Muster mit editierbarer Anzahl und verschachtelten Children (auch Raster durch zwei lineare Ebenen) | Feature-/Flächenmuster, freie Spiegel- und Kurvenmuster |
| Skizzen | Rechteck, Kreis, Ellipse, regelmäßiges Vieleck, Langloch mit echten Kreisbögen; freie geschlossene Linienzüge mit stabilen Punkt-IDs, Maustasten-/Koordinatenbearbeitung und Entwurfssicherung; mehrere Konturen, Maße, Winkel und einfache Kantenabstände; eigenständige freie Linien-/Kreisskizzen mit Schnittpunkt- und Flächenerkennung, anklickbaren Teilflächen und genauer Rotation | Frei gezeichnete Bögen, Splines, Text, Trimmen, Verlängern, Versatz, Konstruktionsgeometrie und gemeinsame Skizzenverwaltung für alle bisherigen Skizzentypen |
| Skizzenabhängigkeiten | Maßfestlegung beim Ziehen und einige dauerhafte Positionsbezüge | Allgemeiner Solver: koinzident, horizontal/vertikal, parallel, rechtwinklig, tangential, gleich, symmetrisch; Freiheitsgrade und Konfliktanzeige |
| Volumenkörper | Aufbauen, Ausschneiden, Durch alles, Rundung, Fase, Wandung, Zahnräder/Gewinde, volle/teilweise Rotation um eine versetzte V-Achse; Rotation gewählter freier Skizzenflächen um U/V oder eine gezeichnete Achse, Loft mit zwei transformierten Querschnitten, Sweep entlang ebenem Linienpfad | Loft mit unabhängigen Querschnitten/Leitkurven; räumliche/gebogene Sweep-Pfade; Rotation als additives/subtraktives Flächenfeature; Rippen, Formschräge, variable Rundungen, Normbohrungen und weitere Endbedingungen |
| Analyse | Volumen, Oberfläche, Außenmaße, Körperabstand, Überschneidungsvolumen, Volumenschwerpunkt, Masse aus benutzerdefinierter Dichte, geschlossene CAD-Schnittansicht an X/Y/Z-Ebenen | Punkt-/Kanten-/Winkelmessung, beliebige Schnittebenen, Materialkatalog und Wandstärkenprüfung |
| Modellverlauf | Nachträglich bearbeitbare Maße und Features; Referenzprüfung; Undo/Redo; Schritte unterdrücken/aktivieren, umordnen und bis zu einem Schritt anzeigen; ungültige Abhängigkeiten verwerfen die Änderung | Gemeinsamer Modellbaum für alle Skizzentypen, grafischer Abhängigkeitsgraph, gezielte Referenzreparatur und Konfigurationen |
| Generatoren | Projektvariablen und sichere Rechenformeln, gebundene Grundkörpermaße, Eltern-/Kindhierarchie, lokale Position/Drehung/Skalierung, lineare und kreisförmige Muster ganzer Teilbäume, Umwandlung in freie Körper | Formeln für beliebige Skizzen-/Featuremaße, Instanzindex in Formeln, wiederverwendbare Module mit eigenen Parametern, assoziative Boolesche Generatoroperationen |
| Daten | Lokale Projekte und Entwürfe, JSON, STEP-Import/-Export und STL-Export, Offline-Cache | IndexedDB für größere Modelle, DXF/SVG-Skizzenimport, STL-Netzbearbeitung, 3MF, wiederverwendbare Bauteilbibliothek |
| Weitere Systeme | Noch nicht umgesetzt | Baugruppen/Gelenke, Explosionsansichten, technische Zeichnungen/Stücklisten, Blech, Flächenmodellierung, Simulation |
| Zusammenarbeit | Optionale lokale MCP-Verbindung | Mehrbenutzerbetrieb, Freigaben, Versionszweige und gemeinsame Cloud-Dokumente; eigene Architekturentscheidung erforderlich |

## Umgesetzter weiterer Ausbau vom 26. Oktober 2026

Die folgenden Funktionen sind implementiert; dies schließt die gesamte Liste ausdrücklich noch nicht ab:

- **Linienzüge und Langlöcher:** Zeichnen durch Klicken, Kontur schließen/wieder öffnen, Punkte ziehen oder numerisch ändern. Auch konkave, nicht selbstschneidende Konturen und Aussparungen erzeugen echte CAD-Körper. Offene Linienzüge werden als Entwurf erhalten. Punkt-IDs bleiben beim Bearbeiten erhalten; ein allgemeines Skizzenelement-/Abhängigkeitssystem ist das noch nicht.
- **Rotationskörper:** Winkel bis 360° und versetzte Drehachse in der Skizzenebene. Vorschau und spätere Parameteränderung. Die Oberfläche erstellt eigenständige Körper von der Grundebene aus.
- **Loft:** Zwei Querschnitte derselben Kontur mit Endmaß-Faktor, Winkel, U/V-Versatz und Ebenenabstand. Die Endtransformation wirkt um den Skizzenursprung. Unabhängige Querschnittsformen, Zwischenprofile und Leitkurven sind noch offen.
- **Sweep:** Querschnitt entlang eines ebenen Linienpfads mit 2–32 Punkten; Start im Ursprung und erster Abschnitt senkrecht nach oben. Pfadkoordinaten sind numerisch änderbar; keine frei gezeichneten 3D-Leitkurven. Aussparungen im Querschnitt werden mitgeführt. Der CAD-Kern prüft den resultierenden Körper.
- **Direkte Bearbeitung:** Dreh- und gleichmäßige Skalierungsgriffe mit gemeinsamer Auswahlmitte, numerischem Gegenstück und Raster. Esc bricht laufende Bewegungen ab. Auswahlrahmen nimmt vollständig eingeschlossene sichtbare Körper auf, Umschalt ergänzt die Auswahl.
- **Körpersperren und Zwischenablage:** Gesperrte Körper lassen sich ansehen, ausblenden, kopieren und separat entsperren. Modelländerungen und Löschen sind blockiert. Kopieren/Ausschneiden/Einfügen verwendet eine lokale Formraum-Zwischenablage im Browser-Tab; sie ist keine Betriebssystem-Zwischenablage. Kopien sind unabhängig und ungesperrt.
- **Analyse:** Schnittansicht mit echten geschlossenen Schnittflächen, ohne Änderung der Projektrevision oder Exporte. Achse X/Y/Z, Position und Seite sind wählbar. Schwerpunkt ist der Volumenschwerpunkt; Masse setzt eine einheitliche, vom Nutzer eingetragene Dichte voraus. Überschneidungsvolumen ergänzt die Abstandsmessung.
- **Modellverlauf:** Unterdrücken, Aktivieren, Umordnen und Rollback bis zum ausgewählten Schritt. Spätere Schritte bleiben gespeichert. Abhängigkeiten werden erneut geprüft; bei ungültiger Reihenfolge bleibt die vorherige Version erhalten.

### Noch kein vollständiger Ersatz für Tinkercad oder Onshape

Insbesondere Skizzensolver, assoziative Feature-/Flächenmuster, freie Arbeitsebenen, erweiterte Importe, Baugruppen, Zeichnungen, Blech, Flächenmodellierung und Simulation fehlen weiterhin. Mehrbenutzer- und Cloudfunktionen sind ebenfalls offen und müssen mit der Vorgabe „Dateien bleiben lokal“ abgestimmt werden. Die Tabelle oben bleibt die vollständige Arbeitsliste; Teilumsetzungen werden nicht als abgeschlossene Kategorien gezählt.

## Nächste zusammenhängende Ausbauschritte

1. **Werkzeugbedienung vereinheitlichen:** Vorschau, Anwenden und Abbrechen für Transformationen; Auswahlzustand und Werkzeugzustand vom großen UI-Modul trennen. Bestehende Dateien und Undo dürfen dabei nicht verändert werden.
2. **Freie Skizzen erweitern und vereinheitlichen:** Linien-/Kreisskizzen mit auswählbaren Bereichen sind vorhanden. Stabile Punktbeziehungen und frei gezeichnete Bögen ergänzen; Trimmen, Konstruktionselemente und direkte Bearbeitung. Vorhandene Rechteck-/Kreisprojekte müssen weiterhin laden.
3. **Abhängigkeiten lösen:** Einen geeigneten browserfähigen Solver auswählen und getrennt testen. Unter-, voll- und überbestimmte Skizzen sichtbar unterscheiden. Widersprüchliche Maße dürfen die letzte gültige Kontur nicht zerstören.
4. **Parametrische Modellierung erweitern:** Rotation, danach Sweep/Loft auf den eigenständigen Skizzen; Formeln auf beliebige Skizzen- und Featuremaße erweitern, weitere Endbedingungen und assoziative Feature-Muster. Referenzen müssen bei Änderungen nachvollziehbar bleiben oder eine gezielte Reparatur anbieten.
5. **Direkte 3D-Bedienung vertiefen:** Transformationsgriffe, Fläche als Arbeitsebene, Flächenfang, Auswahlrahmen, Lineal und Kontextmenüs. Dieselben Operationen sollen über Ziehen und genaue Eingaben ausführbar sein.
6. **Konstruktion prüfen und weitergeben:** Schnittansicht, detaillierte Messungen, Materialdaten, technische Zeichnungen und erweiterte Dateiformate. Baugruppen folgen als eigener Bereich.

Die Reihenfolge 2–5 beschreibt Abhängigkeiten, keine endgültigen Zeit- oder Vollständigkeitszusagen. Jede Stufe braucht reale CAD-Tests, Fehlerfälle, Speichern/Laden und eine nutzbare Oberfläche. Funktionen mit nur einem sichtbaren Knopf gelten nicht als umgesetzt.

## Abnahmekriterien

- Kopien erhalten Maße und bestehende Bearbeitungen; Eingaben und Ursprungsobjekte bleiben unverändert, bis die Aktion erfolgreich übernommen wird.
- Kreisverteilung funktioniert bei gedrehten Ausgangsteilen, versetztem Zentrum, negativen Winkeln, Teil- und Vollkreisen.
- Spiegeln erhält das Volumen, spiegelt auch asymmetrische Geometrie korrekt und erlaubt nachfolgende Features sowie STEP-Export.
- Gemeinsames Verschieben erhält die relativen Abstände; Ebene, Achse, Raster und Esc werden berücksichtigt.
- Körperabstände stammen aus dem CAD-Kern; Messen schreibt keine Projektrevision und erzeugt keinen Undo-Schritt.
- Ungültige Maße und die Körpergrenze werden ohne Datenverlust gemeldet. Bestehende Tests müssen weiterhin bestehen.

## Prüfungen des weiteren Ausbaus

- `tests/free-sketch.spec.js`: konkave Konturen, ungültige Linienzüge, genaue Langlochvolumina, Rotation, Entwurfswiederherstellung und Punktbearbeitung.
- `tests/profile-operations.spec.js`: Loft- und Sweep-Volumina, innere Aussparungen, Parameterfehler, Vorschau, Wiederherstellung und spätere Maßänderungen.
- `tests/direct-editing.spec.js`: Sperren, Zwischenablage, Auswahlrahmen, Schnitt ohne Modelländerung, Schwerpunkt, Überschneidung und Verlauf mit ungültigen Abhängigkeiten.
- `tests/transform-handles.spec.js`: gemeinsamer Dreh-/Skalierungsmittelpunkt, numerische Eingaben, echte Mausbewegungen an den Griffen und Abbruch.
- Bestehende CAD-, Daten-, MCP-, Offline- und Produktionstests bleiben Teil der Gesamtabnahme.

## Referenzen für die Funktionsplanung

- [Tinkercad: offizielle Tastatur- und Werkzeugübersicht](https://images.tinkercad.com/jl5ii4oqrdmc/6TNFVIF89KMN9CPLLH97U0/a847b794b1b579f1529d87863783df8d/Tinkercad_keyboard_shortcuts_2_up.pdf)
- [Onshape: Skizzenwerkzeuge](https://cad.onshape.com/help/Content/Sketch/sketch_tools.htm)
- [Onshape: lineare Muster](https://cad.onshape.com/help/Content/PartStudio/linear_pattern.htm)
- [Onshape: Rotation](https://cad.onshape.com/help/Content/PartStudio/revolve.htm), [Loft](https://cad.onshape.com/help/Content/PartStudio/loft.htm), [Sweep](https://cad.onshape.com/help/Content/PartStudio/sweep.htm)
- [Onshape: Konfigurationen](https://cad.onshape.com/help/Content/PartStudio/part_studio_and_assembly_configurations.htm), [Zeichnungen](https://www.onshape.com/en/features/drawings), [Simulation](https://www.onshape.com/en/features/simulation)

Quellen dienen als Vergleich für Arbeitsabläufe und Fähigkeiten; Formraum entwickelt eine eigene Oberfläche und Implementierung.

## Variablen, Generatoren und Children

Über **ƒx Variablen & Generatoren** werden Projektvariablen und Generatorquellen bearbeitet. Zahlen oder sichere Formeln sind in Grundkörper-Maßfeldern erlaubt; im Generator zusätzlich in Position, Drehung, gleichmäßiger Skalierung, Anzahl, Schritt, Winkel und Zentrum. Abhängige Variablen werden in passender Reihenfolge aufgelöst. Unbekannte Namen, Zyklen, ungültige Geometrie und Budgetüberschreitungen lassen den letzten gültigen Stand bestehen. Änderungen wirken auch auf gebundene Maße in gespeicherten Boolean-/Spiegelquellen; Sperren schützen weiterhin vor indirekten Geometrieänderungen.

Ein Generator enthält Gruppen und Körper mit optionalem Elternelement. Elterntransformationen werden auf Kinder vererbt; ein Muster wiederholt den gesamten Teilbaum. Lineare Schritte und Kreiszentren beziehen sich auf das Koordinatensystem des Elternteils. Bei neu zugewiesenem Elternteil bleiben die eingegebenen lokalen Koordinaten erhalten; Weltpositionen können sich dadurch ändern. Ausgewählte freie Körper können einschließlich bestehender Geometrie/Modellschritte als Children übernommen werden. Die Generatorausgabe ist im normalen Modellfenster schreibgeschützt. „In freie Körper umwandeln“ löst die Bindung für die ganze Gruppe; Duplizieren erzeugt eine freie Kopie eines Ergebniskörpers.

Grenzen: 64 Projektvariablen, 16 Generatoren, jeweils 64 Quellelemente, höchstens acht Hierarchieebenen und 30 erzeugte/freie Körper insgesamt. Formeln sind keine JavaScript-/OpenSCAD-Skripte. Es gibt noch keine Formelbindung für beliebige Skizzenkonturen oder Features und keine assoziativen Booleschen Operationen über Generatorausgaben. Bohrkörper werden vom Export ausgeschlossen; sie erzeugen alleine keine Bohrung. STEP/STL exportieren die jeweils neu berechnete Geometrie.

`tests/generators.spec.js` prüft Formelauflösung, Abhängigkeitsfehler, Elterntransformationen, Muster ganzer Teilbäume, Zahländerungen ohne veraltete Kopien, Browserbedienung, Speicherwiederherstellung, Undo, Sperren und echte CAD-Exporte.

## Freie Skizzenflächen und Rotation vom 27. Oktober 2026

Ein eigener Editor ermöglicht Punkt-zu-Punkt-Linien und Kreise, mehrere getrennte Linienketten, Fangraster, Fang an Endpunkten/Konturen, Punktverschiebung und numerische Elementbearbeitung. Schnittpunkte zerlegen Linien und Kreise in gerichtete Kanten; offene Äste bilden keine Fläche. Geschlossene Teilflächen und innere Löcher werden erkannt und einzeln ausgewählt. Die native Rotation verwendet Linien und exakte Kreisbögen. Ausgewählte benachbarte Bereiche werden vereinigt, ungewählte innere Bereiche bleiben ausgespart. Eine durch das Material laufende Achse oder ein nicht zusammenhängendes Ergebnis wird abgewiesen.

Projektfeld `sketches` enthält benannte Quellen mit Linien/Kreisen; Körper der Art `region` verweisen auf die Quelle und ihre ausgewählten Bereiche. Quellen bleiben nach Speichern, Dateiöffnung und STEP-/STL-Export bearbeitbar. Quellen werden beim Einfügen von Körpern in andere Projekte mitgeführt, kollidierende Kennungen werden umbenannt. Körpersperren schützen auch indirekte Änderungen über die Quellskizze. MCP bewahrt die Skizzen und blockiert Modellschreibzugriffe bei geöffnetem Editor. Nicht übernommene Entwürfe liegen im Tab-Sitzungsspeicher; ältere Fassungen werden nicht stillschweigend über einen neueren Projektstand geschrieben.

Grenzen: XZ-Ebene, 128 Elemente / 128 erkannte Bereiche / 32 ausgewählte Flächen pro Rotation, 32 Skizzen pro Projekt. Noch keine allgemeinen Constraints oder freie Bögen/Splines, keine Rotation als Flächenfeature und keine automatische Aufteilung in mehrere getrennte Volumenkörper. Die bisherige Kontur-Skizzenbedienung bleibt zusätzlich verfügbar.

Prüfungen in `tests/sketch-regions.spec.js`: Flächenaufteilung, offene Äste, doppelte/überlappende Linien, Kreisschnitte, geschachtelte Löcher, genaue native Volumina, Halbkreis zu Kugel, schräge Drehachse, Achsendurchtritt, ungültige Bezüge, Quellenkopien und Sperren; Browserklicks, 3D-Vorschau, Speichern/Wiederöffnen, Punktbewegung, Undo und Entwurfswiederherstellung. Produktions- und MCP-Tests schließen die neuen Skizzen ein.
