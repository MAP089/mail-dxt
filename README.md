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

## Audit-Log

Jeder Tool-Aufruf wird in `~/Library/Logs/mail-dxt/audit.log` protokolliert (auch in der Konsole-App sichtbar).

- Protokolliert wird, **was** getan wurde – Konto, Mailbox, Message-ID, Empfänger, Suchbegriff. Mailtexte von Entwürfen erscheinen nur als Länge, Betreffs werden auf 100 Zeichen gekürzt; gelesene Mails werden nicht protokolliert.
- Ordner und Datei sind nur für den eigenen Benutzer lesbar.
- Ab 5 MB wird das Log nach `audit.log.1` rotiert.
- `MAIL_DXT_DEBUG=1` (in `manifest.json`) schreibt zusätzlich die kompletten AppleScripts samt Inhalten mit – nur zur Fehlersuche einschalten.

## Installation

1. `mail-dxt.dxt` selbst bauen (siehe [Build](#build)) – ein offizielles Release folgt später.
2. Datei per Drag-and-Drop in Claude Desktop ziehen oder über *Settings → Extensions* installieren.
3. Beim ersten Aufruf fragt macOS nach der Automation-Berechtigung für Mail.app – einmal bestätigen.

## Voraussetzungen

- macOS mit eingerichteter Mail.app
- Claude Desktop mit DXT-Unterstützung
- Beim ersten Start: Automations-Berechtigung für Mail.app erteilen (System­einstellungen → Datenschutz & Sicherheit → Automation)

## Build

```bash
npm install
dxt pack
```

Erzeugt `mail-dxt.dxt` im Projektverzeichnis. Setup-Anleitung für das `dxt`-CLI: <https://github.com/anthropics/dxt>.

## Lizenz

MIT – siehe [LICENSE.md](LICENSE.md).
