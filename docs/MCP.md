# Mit einer KI gemeinsam in Formraum arbeiten

Formraum bietet eine optionale lokale MCP-Brücke. Ein MCP-Client wie Codex kann das aktive Browser-Projekt einschließlich Flächen, Kanten, Maßen und Auswahl lesen, die Ansicht sehen und geprüfte Änderungen durchführen. Du siehst die Änderungen sofort und kannst sie mit **Strg Z** rückgängig machen.

Die Brücke läuft auf deinem Rechner; die CAD-Berechnung und Projektspeicherung bleiben im Browser. Jeder Nutzer verbindet seinen eigenen Client mit seinem eigenen Browserprofil. Es gibt kein gemeinsames Cloud-Konto und keine Synchronisierung zwischen Personen oder Geräten.

## Einmal einrichten

1. **Node.js ab 22.12** installieren.
2. Dieses Repository herunterladen oder klonen:

   ```sh
   git clone https://github.com/Kami-00/formraum.git
   cd formraum
   npm ci
   ```

3. Im MCP-Client einen **lokalen STDIO-Server** mit folgendem Befehl eintragen:

   - Name: `formraum`
   - Programm: `node` (bei Bedarf den vollständigen Pfad zu Node angeben)
   - Argument: der **absolute Pfad** zu `formraum/mcp/server.js`

   Beispiel für Clients mit `mcpServers`-JSON-Konfiguration:

   ```json
   {
     "mcpServers": {
       "formraum": {
         "command": "node",
         "args": ["/absoluter/pfad/formraum/mcp/server.js"]
       }
     }
   }
   ```

   Unter Windows beispielsweise `"C:\\Users\\Name\\formraum\\mcp\\server.js"` verwenden. Der Server startet unabhängig vom Arbeitsverzeichnis. Die genaue Konfigurationsdatei hängt vom MCP-Client ab.

### Codex

Mit der Codex-CLI:

```sh
codex mcp add formraum -- node /absoluter/pfad/formraum/mcp/server.js
codex mcp list
```

Alternativ in der MCP-Konfiguration:

```toml
[mcp_servers.formraum]
command = "node"
args = ["/absoluter/pfad/formraum/mcp/server.js"]
tool_timeout_sec = 150
```

Die Argumente an deinen Installationspfad anpassen. Den Client nach der Einrichtung neu starten beziehungsweise eine Sitzung mit neu geladenen MCP-Werkzeugen öffnen. Bei großen Modellen das Werkzeug-Zeitlimit des Clients auf mindestens 150 Sekunden setzen. Formraum selbst bricht CAD-Berechnungen nach 120 Sekunden ab.

Die offizielle [MCP-Dokumentation von OpenAI](https://developers.openai.com/codex/mcp) beschreibt STDIO-Konfiguration und CLI. Die Brücke verwendet den [offiziellen MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server).

## Eine Browser-Sitzung verbinden

1. Den MCP-Client starten und die KI bitten: **„Rufe `formraum_connection` auf und zeige mir den Verbindungslink.“**
2. Den Link in **dem Browserprofil öffnen, in dem deine Projekte gespeichert sind**. Ein anderer Browser oder ein privates Fenster hat einen anderen Projektspeicher.
3. In Formraum **„Diesen Tab verbinden“** klicken. Der Link befüllt nur den Code; er verbindet nicht automatisch. Alternativ auf **KI verbinden** klicken und Code sowie Port manuell eintragen.
4. Falls der Browser nach **Zugriff auf das lokale Netzwerk** fragt, diesen für Formraum erlauben. Die Verbindung geht ausschließlich an `127.0.0.1` auf deinem Gerät.
5. Den Tab geöffnet lassen. Nun etwa sagen: **„Lies das aktive Projekt und mache den Quader 50 mm breit.“**

Oben steht **KI verbunden**, solange der Client Zugriff hat. Im Verbindungsdialog stehen die letzten KI-Aktionen. **Verbindung trennen** beendet den Zugriff; Neuladen oder Schließen des Tabs trennt ebenfalls. Bereits begonnene CAD-Berechnungen können noch fertig werden. Im Zweifelsfall vor dem Wiederholen den Modellstand lesen.

Der Sitzungscode wird bei jedem Neustart der Brücke neu erzeugt, nicht im Browser-Speicher abgelegt und nach dem Koppeln aus dem Eingabefeld entfernt. Ein Verbindungslink enthält den Code nur im URL-Fragment; dieses wird nicht an GitHub gesendet und von Formraum sofort aus der Adresszeile entfernt. Den Code nur mit deinem lokalen Client verwenden.

## Was die KI kann

| Werkzeug | Funktion |
| --- | --- |
| `formraum_connection` | Verbindungscode, Link und Verbindungsstatus |
| `formraum_list_projects` | Namen, Kennungen und Änderungsstände der gespeicherten Projekte |
| `formraum_get_project` | Aktives Projekt, Revision, Auswahl und CAD-Flächen/Kanten samt Geometriebezügen |
| `formraum_get_view` | PNG der aktuellen 3D-Ansicht |
| `formraum_apply_project` | Vollständige neue Projektversion prüfen und als rückgängig machbaren Schritt übernehmen |
| `formraum_create_project` | Eigenes neues Projekt anlegen; das vorherige bleibt gespeichert |
| `formraum_open_project` | Ein gespeichertes Projekt öffnen |
| `formraum_undo` | Letzten Modellschritt rückgängig machen |

Jede Änderung benötigt die beim letzten Lesen erhaltene **Projekt-ID und Revision**. Falls du zwischenzeitlich etwas änderst oder das Projekt wechselst, wird ein veralteter Schreibversuch abgewiesen. Während einer Skizze, beim Bearbeiten eines Eingabefelds oder während einer Berechnung führt die KI keine Änderungen aus. Nach einem Fehler muss der Client den Stand erneut lesen. Ein Fehler ist kein Anlass, dieselbe Änderung blind zu wiederholen.

Die Brücke führt keinen übermittelten Programmcode aus und liest keine beliebigen Dateien auf dem Rechner. Sie gewährt nach dem Koppeln Zugriff auf die Projektliste und das aktive Projekt einschließlich importierter STEP-Quelldaten; über Projektwechsel können auch andere Projekte dieses Browserprofils geöffnet werden. Dein MCP-Client kann diese Daten an seinen KI-Anbieter senden. Ohne MCP-Verbindung werden keine Projektdaten aus Formraum übertragen.

## Verbindungsprobleme

- **Kein Werkzeug sichtbar:** Der MCP-Client muss den lokalen Server starten. Nur `npm run mcp` in einem separaten Terminal zu starten verbindet diesen Prozess nicht mit dem Client. `node` und der absolute Skriptpfad müssen stimmen; nach der Einrichtung neu starten.
- **Port belegt:** Nur einen Client pro Brücke starten oder im Client `FORMRAUM_PORT=8789` setzen. `formraum_connection` liefert dann den passenden Port. Jeder Brückenprozess verbindet genau einen Browser-Tab.
- **Lokaler Netzwerkzugriff blockiert:** In den Website-Berechtigungen erlauben und erneut verbinden. Automatisiert getestet ist Chromium einschließlich HTTPS-Seite und lokaler Netzwerkberechtigung. Browser mit grundsätzlich gesperrtem Loopback-Zugriff werden nicht unterstützt.
- **Code abgewiesen:** Nach einem Serverneustart einen neuen Code abrufen. Ein bereits verbundenes Tab zuerst trennen.
- **Projekte fehlen:** Browser, Profil und Website-Adresse prüfen. `localhost`, `127.0.0.1` und GitHub Pages haben getrennte Local-Storage-Daten. Mit Projektdateien lassen sich Modelle übertragen.
- **Projekt in anderem Tab geändert:** Über **Projekte** neu öffnen; die aktuelle Änderung wird nicht automatisch über die neuere Version geschrieben.
- **Browser-Speicher voll:** Bestehende Projekte mit **Speichern** als Datei sichern, dann nicht mehr benötigte Projekte entfernen. Die vorherige Version bleibt bei einem Speicherfehler erhalten.

Die Brücke bindet nur an IPv4-Loopback und prüft Host, Origin und Sitzungscode. Standardmäßig zugelassen sind die GitHub-Pages-Origin `https://kami-00.github.io` sowie lokale Entwicklung/Vorschau auf Port 5173/4173. Für eine eigene Bereitstellung `FORMRAUM_ORIGIN` auf deren exakte Origin setzen, zum Beispiel `https://cad.example.org` (ohne Pfad). Das ändert nur die Zulassung; den Sitzungscode dann auf deiner eigenen Formraum-Seite eingeben.
