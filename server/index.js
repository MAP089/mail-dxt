#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { LIMITS } from "./config.js";
import { writeAuditLog } from "./audit.js";
import {
  validateAccountName,
  validateMailboxName,
  validateMessageId,
  validateMessageIds,
  validateEmailList,
  validateSubject,
  validateBody,
  validateSearchLimit,
  validateSearchOffset,
} from "./validator.js";
import {
  runAppleScript,
  buildListAccounts,
  buildListMailboxes,
  buildSearch,
  buildReadMessage,
  buildComposeDraft,
  buildMoveMessage,
  buildDeleteToTrash,
  LIST_SEPARATOR,
} from "./applescript.js";
import { accountsCache, mailboxesCache } from "./cache.js";

const server = new Server(
  { name: "mail-dxt", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "mail_list_accounts",
      description: "Listet alle in Mail.app eingerichteten Konten auf.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "mail_list_mailboxes",
      description: "Listet alle Mailboxen/Ordner eines Kontos auf.",
      inputSchema: {
        type: "object",
        properties: {
          account_name: { type: "string", description: "Name des Mail-Kontos" },
        },
        required: ["account_name"],
      },
    },
    {
      name: "mail_search",
      description:
        "Sucht Mails in einer Mailbox (neueste zuerst). Gibt Trefferliste mit Metadaten zurück. " +
        "Ist has_more true, gibt es weitere Mails: Aufruf mit offset = next_offset wiederholen, bis has_more false ist.",
      inputSchema: {
        type: "object",
        properties: {
          account_name: { type: "string" },
          mailbox_name: { type: "string" },
          query: { type: "string", description: "Suchbegriff in Betreff/Absender (optional)" },
          unread_only: { type: "boolean", description: "Nur ungelesene Mails (default: false)" },
          limit: { type: "number", description: "Max. Anzahl Ergebnisse (default: 20, max: 100)" },
          offset: { type: "number", description: "Startposition für Folgeseiten (default: 0). Wert next_offset aus der vorigen Antwort verwenden." },
        },
        required: ["account_name", "mailbox_name"],
      },
    },
    {
      name: "mail_read",
      description: "Liest den Inhalt einer einzelnen Mail anhand ihrer ID.",
      inputSchema: {
        type: "object",
        properties: {
          account_name: { type: "string" },
          mailbox_name: { type: "string" },
          message_id: { type: "number", description: "ID der Mail (aus mail_search)" },
        },
        required: ["account_name", "mailbox_name", "message_id"],
      },
    },
    {
      name: "mail_compose_draft",
      description: "Erstellt eine neue Mail als Entwurf in Mail.app. Sendet NIEMALS automatisch.",
      inputSchema: {
        type: "object",
        properties: {
          account_name: { type: "string", description: "Von welchem Konto aus" },
          to: { type: "array", items: { type: "string" }, description: "Empfänger-Adressen" },
          cc: { type: "array", items: { type: "string" }, description: "CC-Adressen (optional)" },
          bcc: { type: "array", items: { type: "string" }, description: "BCC-Adressen (optional)" },
          subject: { type: "string" },
          body: { type: "string" },
        },
        required: ["account_name", "to", "subject", "body"],
      },
    },
    {
      name: "mail_move",
      description:
        "Verschiebt eine oder mehrere Mails von einer Mailbox in eine andere desselben Kontos. " +
        `Mehrere Mails IMMER gesammelt über message_ids (max. ${LIMITS.move_batch_max}) in einem Aufruf übergeben, ` +
        "nicht das Tool pro Mail einzeln aufrufen.",
      inputSchema: {
        type: "object",
        properties: {
          account_name: { type: "string" },
          source_mailbox: { type: "string" },
          message_ids: {
            type: "array",
            items: { type: "number" },
            description: `IDs der Mails (aus mail_search), max. ${LIMITS.move_batch_max}`,
          },
          message_id: { type: "number", description: "Einzelne ID – nur noch aus Kompatibilitätsgründen, besser message_ids" },
          target_mailbox: { type: "string" },
        },
        required: ["account_name", "source_mailbox", "target_mailbox"],
      },
    },
    {
      name: "mail_delete_to_trash",
      description:
        "Verschiebt eine oder mehrere Mails derselben Mailbox in den Papierkorb. Löscht NIEMALS permanent. " +
        `Mehrere Mails IMMER gesammelt über message_ids (max. ${LIMITS.move_batch_max}) in einem Aufruf übergeben, ` +
        "nicht das Tool pro Mail einzeln aufrufen.",
      inputSchema: {
        type: "object",
        properties: {
          account_name: { type: "string" },
          mailbox_name: { type: "string" },
          message_ids: {
            type: "array",
            items: { type: "number" },
            description: `IDs der Mails (aus mail_search), max. ${LIMITS.move_batch_max}`,
          },
          message_id: { type: "number", description: "Einzelne ID – nur noch aus Kompatibilitätsgründen, besser message_ids" },
        },
        required: ["account_name", "mailbox_name"],
      },
    },
  ],
}));

// message_ids (Liste) oder – aus Kompatibilitätsgründen – eine einzelne message_id.
function messageIdsFromArgs(args) {
  return validateMessageIds(args.message_ids ?? (args.message_id === undefined ? [] : [args.message_id]));
}

// Wertet die Rückgabe von buildMoveMessage/buildDeleteToTrash aus: Das Script meldet
// Positionen in ids zurück, nicht die IDs selbst.
function parseMoveResult(raw, ids) {
  const [target, movedRaw = "", failedRaw = ""] = raw.split("|||");
  const toIds = (s) => s.split(",").map(x => x.trim()).filter(Boolean).map(i => ids[Number(i) - 1]);
  const moved = toIds(movedRaw);
  const notMoved = toIds(failedRaw);
  if (moved.length === 0) {
    throw new Error(`Keine der Mails gefunden bzw. verschiebbar (IDs: ${notMoved.join(", ")}).`);
  }
  return { target, moved, notMoved };
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = request.params.name;
  const args = request.params.arguments ?? {};

  try {
    let result;

    switch (tool) {
      case "mail_list_accounts": {
        const cached = accountsCache.get("all");
        if (cached) {
          await writeAuditLog(tool, args, "cache_hit");
          return { content: [{ type: "text", text: JSON.stringify({ accounts: cached }, null, 2) }] };
        }
        const script = buildListAccounts();
        const raw = await runAppleScript(script);
        const accounts = raw.split(LIST_SEPARATOR).map(s => s.trim()).filter(Boolean);
        accountsCache.set("all", accounts);
        result = { accounts };
        break;
      }

      case "mail_list_mailboxes": {
        validateAccountName(args.account_name);
        const cached = mailboxesCache.get(args.account_name);
        if (cached) {
          await writeAuditLog(tool, args, "cache_hit");
          return { content: [{ type: "text", text: JSON.stringify({ mailboxes: cached }, null, 2) }] };
        }
        const script = buildListMailboxes(args.account_name);
        const raw = await runAppleScript(script);
        const mailboxes = raw.split(LIST_SEPARATOR).map(s => s.trim()).filter(Boolean);
        mailboxesCache.set(args.account_name, mailboxes);
        result = { mailboxes };
        break;
      }

      case "mail_search": {
        validateAccountName(args.account_name);
        validateMailboxName(args.mailbox_name);
        const limit = validateSearchLimit(args.limit);
        const unread_only = args.unread_only === true;
        const offset = validateSearchOffset(args.offset);
        const script = buildSearch(args.account_name, args.mailbox_name, args.query, unread_only, limit, offset);
        const raw = await runAppleScript(script);
        const [meta, ...lines] = raw.split(LIST_SEPARATOR).map(s => s.trim()).filter((s, i) => i === 0 || s);
        const [scannedTo, total] = meta.split("/").map(Number);
        const messages = lines.map(line => {
          const parts = line.split("|||");
          return {
            id: parseInt(parts[0], 10),
            subject: parts[1] ?? "",
            sender: parts[2] ?? "",
            date: parts[3] ?? "",
            is_read: parts[4] === "true",
          };
        });
        result = { messages, has_more: scannedTo < total, next_offset: scannedTo, total_in_mailbox: total };
        break;
      }

      case "mail_read": {
        validateAccountName(args.account_name);
        validateMailboxName(args.mailbox_name);
        validateMessageId(args.message_id);
        const script = buildReadMessage(args.account_name, args.mailbox_name, args.message_id);
        const raw = await runAppleScript(script);
        const parts = raw.split("|||");
        const body = parts.slice(4).join("|||").slice(0, LIMITS.body_read_max_length);
        result = {
          subject: parts[0] ?? "",
          sender: parts[1] ?? "",
          date: parts[2] ?? "",
          recipients: (parts[3] ?? "").split(",").map(s => s.trim()).filter(Boolean),
          body,
        };
        break;
      }

      case "mail_compose_draft": {
        validateAccountName(args.account_name);
        validateEmailList(args.to, "to");
        if (args.cc?.length) validateEmailList(args.cc, "cc");
        if (args.bcc?.length) validateEmailList(args.bcc, "bcc");
        validateSubject(args.subject);
        validateBody(args.body);
        const script = buildComposeDraft(
          args.account_name, args.to, args.cc ?? [], args.bcc ?? [],
          args.subject, args.body
        );
        const draftId = await runAppleScript(script, { retry: false });
        result = { status: "Entwurf erstellt", draft_id: draftId };
        break;
      }

      case "mail_move": {
        validateAccountName(args.account_name);
        validateMailboxName(args.source_mailbox);
        validateMailboxName(args.target_mailbox);
        const ids = messageIdsFromArgs(args);
        const script = buildMoveMessage(args.account_name, args.source_mailbox, ids, args.target_mailbox);
        const { target, moved, notMoved } = parseMoveResult(await runAppleScript(script, { retry: false }), ids);
        result = {
          status: `${moved.length} Mail(s) verschoben`,
          target_mailbox: target,
          moved_ids: moved,
          ...(notMoved.length ? { not_moved_ids: notMoved } : {}),
        };
        break;
      }

      case "mail_delete_to_trash": {
        validateAccountName(args.account_name);
        validateMailboxName(args.mailbox_name);
        const ids = messageIdsFromArgs(args);
        const script = buildDeleteToTrash(args.account_name, args.mailbox_name, ids);
        const { target, moved, notMoved } = parseMoveResult(await runAppleScript(script, { retry: false }), ids);
        result = {
          status: `${moved.length} Mail(s) in Papierkorb verschoben`,
          trash_mailbox: target,
          moved_ids: moved,
          ...(notMoved.length ? { not_moved_ids: notMoved } : {}),
        };
        break;
      }

      default:
        throw new Error(`Unbekanntes Tool: ${tool}`);
    }

    await writeAuditLog(tool, args, "success");
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };

  } catch (error) {
    await writeAuditLog(tool, args, "error", error.message);
    return {
      content: [{ type: "text", text: `Fehler: ${error.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("mail-dxt MCP Server gestartet");
