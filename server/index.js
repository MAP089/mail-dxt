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
  validateEmailList,
  validateSubject,
  validateBody,
  validateSearchLimit,
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
} from "./applescript.js";

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
      description: "Sucht Mails in einer Mailbox. Gibt Trefferliste mit Metadaten zurück.",
      inputSchema: {
        type: "object",
        properties: {
          account_name: { type: "string" },
          mailbox_name: { type: "string" },
          query: { type: "string", description: "Suchbegriff in Betreff/Absender (optional)" },
          unread_only: { type: "boolean", description: "Nur ungelesene Mails (default: false)" },
          limit: { type: "number", description: "Max. Anzahl Ergebnisse (default: 20, max: 100)" },
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
      description: "Verschiebt eine Mail in eine andere Mailbox.",
      inputSchema: {
        type: "object",
        properties: {
          account_name: { type: "string" },
          source_mailbox: { type: "string" },
          message_id: { type: "number" },
          target_mailbox: { type: "string" },
        },
        required: ["account_name", "source_mailbox", "message_id", "target_mailbox"],
      },
    },
    {
      name: "mail_delete_to_trash",
      description: "Verschiebt eine Mail in den Papierkorb. Löscht NIEMALS permanent.",
      inputSchema: {
        type: "object",
        properties: {
          account_name: { type: "string" },
          mailbox_name: { type: "string" },
          message_id: { type: "number" },
        },
        required: ["account_name", "mailbox_name", "message_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = request.params.name;
  const args = request.params.arguments ?? {};

  try {
    let result;

    switch (tool) {
      case "mail_list_accounts": {
        const script = buildListAccounts();
        const raw = await runAppleScript(script);
        const accounts = raw.split(",").map(s => s.trim()).filter(Boolean);
        result = { accounts };
        break;
      }

      case "mail_list_mailboxes": {
        validateAccountName(args.account_name);
        const script = buildListMailboxes(args.account_name);
        const raw = await runAppleScript(script);
        const mailboxes = raw.split(",").map(s => s.trim()).filter(Boolean);
        result = { mailboxes };
        break;
      }

      case "mail_search": {
        validateAccountName(args.account_name);
        validateMailboxName(args.mailbox_name);
        const limit = validateSearchLimit(args.limit);
        const unread_only = args.unread_only === true;
        const script = buildSearch(args.account_name, args.mailbox_name, args.query, unread_only, limit);
        const raw = await runAppleScript(script);
        const lines = raw.split(",").map(s => s.trim()).filter(Boolean);
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
        result = { messages };
        break;
      }

      case "mail_read": {
        validateAccountName(args.account_name);
        validateMailboxName(args.mailbox_name);
        validateMessageId(args.message_id);
        const script = buildReadMessage(args.account_name, args.mailbox_name, args.message_id);
        const raw = await runAppleScript(script);
        const parts = raw.split("|||");
        const body = (parts[4] ?? "").slice(0, LIMITS.body_read_max_length);
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
        const draftId = await runAppleScript(script);
        result = { status: "Entwurf erstellt", draft_id: draftId };
        break;
      }

      case "mail_move": {
        validateAccountName(args.account_name);
        validateMailboxName(args.source_mailbox);
        validateMailboxName(args.target_mailbox);
        validateMessageId(args.message_id);
        const script = buildMoveMessage(args.account_name, args.source_mailbox, args.message_id, args.target_mailbox);
        await runAppleScript(script);
        result = { status: "Mail verschoben" };
        break;
      }

      case "mail_delete_to_trash": {
        validateAccountName(args.account_name);
        validateMailboxName(args.mailbox_name);
        validateMessageId(args.message_id);
        const script = buildDeleteToTrash(args.account_name, args.mailbox_name, args.message_id);
        await runAppleScript(script);
        result = { status: "Mail in Papierkorb verschoben" };
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
