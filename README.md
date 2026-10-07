# mail-dxt

Sichere Mail.app-Steuerung für Claude Desktop – als Desktop Extension (DXT) verpacktes MCP-Server-Projekt.

## Overview

`mail-dxt` erlaubt Claude Desktop, die macOS Mail.app über fest definierte, geprüfte Funktionen zu steuern. Es gibt **kein freies AppleScript**, **kein automatisches Senden**, **keine permanente Löschung** und **keinen Shell-Zugriff** – nur die unten aufgelisteten Tools.

## Features

| Tool | Beschreibung |
| --- | --- |
| `mail_list_accounts` | Alle Mail-Konten auflisten |
| `mail_list_mailboxes` | Mailboxen eines Kontos auflisten |
| `mail_search` | Mails in einer Mailbox suchen |
| `mail_read` | Eine einzelne Mail lesen |
| `mail_compose_draft` | Entwurf erstellen (kein automatisches Senden) |
| `mail_move` | Mail in eine andere Mailbox verschieben |
| `mail_delete_to_trash` | Mail in den Papierkorb verschieben (nicht permanent) |

## Sicherheitsmodell

- **Whitelist statt freies Scripting:** Claude kann nur die oben aufgeführten Operationen ausführen – kein beliebiges AppleScript, kein `do shell script`.
- **Kein direkter Versand:** Mails werden ausschließlich als Entwurf erstellt; das tatsächliche Senden bleibt manuell beim Nutzer.
- **Keine permanente Löschung:** Mails wandern höchstens in den Papierkorb und können von dort wiederhergestellt werden.
- **Eingabevalidierung:** Alle Parameter (Konto, Mailbox, IDs) werden vor der Übergabe an osascript validiert.

## Installation

1. `mail-control.dxt` selbst bauen (siehe [Build](#build)) – ein offizielles Release folgt später.
2. Datei per Drag-and-Drop in Claude Desktop ziehen oder über *Settings → Extensions* installieren.
3. Beim ersten Aufruf fragt macOS nach der Automation-Berechtigung für Mail.app – einmal bestätigen.

## Voraussetzungen

- macOS mit eingerichteter Mail.app
- Claude Desktop mit DXT-Unterstützung
- Beim ersten Start: Automations-Berechtigung für Mail.app erteilen (System­einstellungen → Datenschutz & Sicherheit → Automation)

## Build

```bash
npm install
npm run build
```

Erzeugt `mail-control.dxt` im Projektverzeichnis (das Build-Skript ruft `@anthropic-ai/dxt pack` auf). Hintergründe zum DXT-Format: <https://github.com/anthropics/dxt>.

## Audit-Log

Jeder Tool-Aufruf wird in `~/.mail-dxt-audit.log` protokolliert (eine JSON-Zeile pro Aufruf: Zeitpunkt, Tool, Parameter, Status).

- `body` (Entwurfstext) und `query` (Suchbegriff) stehen **nicht** im Klartext im Log, nur ihre Länge (z. B. `<120 Zeichen>`). Betreff, Konto, Mailbox und Empfänger werden im Klartext protokolliert.
- Die Datei wird mit den Rechten `600` angelegt (nur du kannst sie lesen). Für bereits vorhandene Logdateien ändert sich nichts.
- Mit `MAIL_DXT_DEBUG=1` wird zusätzlich das vollständige AppleScript protokolliert, **einschließlich Entwurfstext und Suchbegriff**. Im mitgelieferten `manifest.json` ist der Schalter aus (`0`); nur zur Fehlersuche einschalten.
- Die Datei wird nie rotiert oder gekürzt. Bei Bedarf manuell löschen.

## Konfiguration

Umgebungsvariablen (im `manifest.json` unter `mcp_config.env`):

| Variable | Wirkung |
|---|---|
| `MAIL_DXT_OSASCRIPT_TIMEOUT_MS` | Timeout für `osascript` in Millisekunden |
| `MAIL_DXT_APPLESCRIPT_TIMEOUT_S` | Timeout innerhalb des AppleScripts in Sekunden |
| `MAIL_DXT_DEBUG` | `1` protokolliert zusätzlich das vollständige AppleScript (siehe Audit-Log) |
| `MAIL_DXT_TRASH_MAILBOX` | Name des Papierkorbs, falls er bei deinem Konto anders heißt |

`mail_delete_to_trash` sucht den Papierkorb des Kontos der Reihe nach unter `Trash`, `Deleted Messages`, `Deleted Items`, `Papierkorb`, `Gelöschte Objekte`, `Gelöschte Elemente`, `[Gmail]/Trash` und `[Google Mail]/Papierkorb`. Wird keiner gefunden, bricht der Aufruf mit einer Fehlermeldung ab, die Mail wird dann nicht verschoben.

## Tests

```bash
npm test
```

Die Tests prüfen das erzeugte AppleScript (Escaping, Sicherheitsfilter, Papierkorb-Namen) und das Audit-Log. Sie führen kein `osascript` aus und laufen daher auch ohne macOS.

## Lizenz

MIT – siehe [LICENSE.md](LICENSE.md).
