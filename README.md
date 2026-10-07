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

Jeder Tool-Aufruf wird in `~/.mail-dxt-audit.log` protokolliert (eine JSON-Zeile pro Aufruf: Zeitpunkt, Tool, Status). Wichtig zu wissen:

- Im Log stehen **alle übergebenen Argumente im Klartext**, bei `mail_compose_draft` also auch Betreff, Empfänger und Text des Entwurfs.
- Mit `MAIL_DXT_DEBUG=1` zusätzlich das vollständige AppleScript und bei Fehlern die Ausgabe von `osascript`. Im mitgelieferten `manifest.json` ist dieser Schalter derzeit auf `1` gesetzt.
- Die Datei wird nie rotiert oder gekürzt. Bei Bedarf manuell löschen.

## Lizenz

MIT – siehe [LICENSE.md](LICENSE.md).
