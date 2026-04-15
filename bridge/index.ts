import { existsSync, readFileSync, readlinkSync } from "node:fs";
import { basename } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { defaultStateFile } from "../shared/paths";
import type { Annotation } from "../shared/protocol";
import {
  discoverTranscriptByBirthtime,
  discoverTranscriptPath,
  type TranscriptEntry,
  TranscriptWatcher,
  type UsageData,
} from "./transcript-watcher";

// Zod schemas for MCP SDK ≥1.27 (requires method literal)
const ChannelNotificationSchema = z
  .object({
    method: z.literal("notifications/claude/channel"),
    params: z.object({}).passthrough().optional(),
  })
  .passthrough();

const PermissionRequestSchema = z
  .object({
    method: z.literal("notifications/claude/channel/permission_request"),
    params: z.object({
      request_id: z.string(),
      tool_name: z.string(),
      description: z.string(),
      input_preview: z.string(),
    }),
  })
  .passthrough();

export function formatAnnotationsForNotification(annotations: Annotation[]): string {
  if (annotations.length === 0) return "";
  const open = annotations.filter((a) => a.status === "open");
  const lines: string[] = [`📍 Annotations (${open.length} open):`];
  for (const a of open) {
    const shortId = a.id.slice(0, 8);
    if (a.kind === "pin") {
      const label = a.note ? `  "${a.note}"` : "";
      lines.push(`  #${a.number} pin  (${a.at[0]}, ${a.at[1]})${label}       [id: ${shortId}…]`);
    } else if (a.kind === "text") {
      lines.push(`  text  "${a.text}" @ (${a.bbox[0]}, ${a.bbox[1]})       [id: ${shortId}…]`);
    } else {
      lines.push(`  callout → (${a.target[0]}, ${a.target[1]})  "${a.text}"  [id: ${shortId}…]`);
    }
  }
  lines.push("");
  lines.push("<annotations-json>");
  lines.push(JSON.stringify(annotations, null, 2));
  lines.push("</annotations-json>");
  return lines.join("\n");
}

/** Resolve the project directory. The bridge is spawned as an MCP subprocess —
 *  its own cwd may not match the project. On Linux, read the parent process
 *  (Claude Code) cwd from /proc as the authoritative source. */
function resolveProjectDir(): string {
  try {
    const parentCwd = readlinkSync(`/proc/${process.ppid}/cwd`);
    if (parentCwd) return parentCwd;
  } catch {
    // Not on Linux or /proc unavailable — fall through
  }
  return process.cwd();
}

// Discover connection info from env or state.json
function readState(): { host: string; port: string; token: string } {
  const stateFile = process.env.TRAYCE_STATE_FILE ?? defaultStateFile();
  let host = process.env.TRAYCE_HOST ?? "";
  let port = process.env.TRAYCE_PORT ?? "";
  let token = process.env.TRAYCE_TOKEN ?? "";

  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(readFileSync(stateFile, "utf-8"));
      if (!token) token = state.token ?? "";
      if (!port && state.port) port = String(state.port);
      if (!host) host = "localhost";
    } catch {}
  }

  if (!host) host = "localhost";
  if (!port) port = "9740";

  return { host, port, token };
}

let { host, port, token } = readState();

const projectDir = resolveProjectDir();
const bridgeStartTime = Date.now();
const label = process.env.TRAYCE_LABEL ?? basename(projectDir);
const sessionId = crypto.randomUUID();

// MCP Channel server
const mcpServer = new Server(
  { name: "trayce", version: "1.0.0" },
  {
    capabilities: {
      tools: {},
      experimental: {
        "claude/channel": {},
        "claude/channel/permission": {},
      },
    },
    instructions: `When you receive a trayce channel notification, read the PNG image at the provided path using the Read tool. The image is a hand-drawn sketch from the user. Treat the accompanying prompt text as the user's request about or relating to the sketch.`,
  },
);

type ResolveUpdate = {
  id: string;
  status: "addressed" | "rejected" | "needs-clarification";
  reply?: string;
};

export function handleResolveAnnotations(
  args: { updates?: ResolveUpdate[] } | undefined,
  ws: WebSocket | null,
): { content: { type: "text"; text: string }[] } {
  const updates = args?.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    return { content: [{ type: "text", text: "Error: updates must be a non-empty array" }] };
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return { content: [{ type: "text", text: "Error: not connected to trayce server" }] };
  }
  // Stamp each entry with the bridge clock. The client uses `at` as a stable
  // dedupe key so a buffered annotation-update replayed to a late-joining
  // browser doesn't re-append the same reply to `replies[]`.
  const now = Date.now();
  const stamped = updates.map((u) => ({ ...u, at: now }));
  ws.send(JSON.stringify({ type: "annotation-update", updates: stamped }));
  return {
    content: [{ type: "text", text: `Updated ${updates.length} annotation(s).` }],
  };
}

type PushAnnotationInput =
  | { kind: "text"; text: string; bbox: [number, number, number, number] }
  | { kind: "pin"; at: [number, number]; note?: string }
  | {
      kind: "callout";
      text: string;
      bbox: [number, number, number, number];
      target: [number, number];
    };

export function handlePushAnnotations(
  args: { annotations?: PushAnnotationInput[] } | undefined,
  ws: WebSocket | null,
  nextPinNumber: () => number,
): { content: { type: "text"; text: string }[] } {
  const input = args?.annotations;
  if (!Array.isArray(input) || input.length === 0) {
    return { content: [{ type: "text", text: "Error: annotations must be a non-empty array" }] };
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return { content: [{ type: "text", text: "Error: not connected to trayce server" }] };
  }
  const now = Date.now();
  let pinCounter = nextPinNumber();
  const annotations = input.map((a) => {
    const base = {
      id: crypto.randomUUID(),
      author: "claude" as const,
      status: "open" as const,
      createdAt: now,
      updatedAt: now,
      replies: [] as never[],
    };
    if (a.kind === "pin") {
      return { ...base, kind: "pin" as const, number: pinCounter++, at: a.at, note: a.note };
    }
    if (a.kind === "text") {
      return {
        ...base,
        kind: "text" as const,
        text: a.text,
        bbox: a.bbox,
        style: { fontSize: 14, color: "#dc2626", weight: "normal" as const },
      };
    }
    return {
      ...base,
      kind: "callout" as const,
      text: a.text,
      bbox: a.bbox,
      target: a.target,
      style: { fontSize: 14, color: "#dc2626" },
    };
  });
  ws.send(JSON.stringify({ type: "annotations-push", annotations }));
  return {
    content: [{ type: "text", text: `Pushed ${annotations.length} annotation(s) to canvas.` }],
  };
}

// Track current WebSocket, watcher, and the last known good transcript path
let currentWs: WebSocket | null = null;
let transcriptWatcher: TranscriptWatcher | null = null;
let lastTranscriptPath: string | null = null;

// MCP reverse notification handler — receives canvas-push from Claude, forwards to server
mcpServer.setNotificationHandler(ChannelNotificationSchema, async (params: any) => {
  const meta = params?.params?.meta;
  if (
    meta?.type === "canvas-push" &&
    typeof meta.image === "string" &&
    currentWs?.readyState === WebSocket.OPEN
  ) {
    const imageSize = Math.ceil((meta.image.length * 3) / 4);
    if (imageSize <= 20 * 1024 * 1024) {
      currentWs.send(
        JSON.stringify({
          type: "canvas-push",
          image: meta.image,
          label:
            typeof meta.label === "string"
              ? meta.label
              : `Claude: ${new Date().toLocaleTimeString()}`,
          visible: false,
        }),
      );
    }
  }
});

// Permission request handler — forwards from Claude Code to server/browser
mcpServer.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
  if (currentWs?.readyState === WebSocket.OPEN) {
    currentWs.send(
      JSON.stringify({
        type: "permission-request",
        requestId: params.request_id,
        toolName: params.tool_name,
        description: params.description,
        inputPreview: params.input_preview,
      }),
    );
  }
});

// MCP tools — allows Claude to push images to the canvas
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "push_image",
      description:
        "Push an image to the trayce canvas as a new layer. Provide either a file_path to an image on disk (preferred for large images) or image_base64 for inline data. Use this to send generated images, diagrams, or reference photos to the user's canvas.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file_path: {
            type: "string",
            description:
              "Absolute path to an image file on disk (PNG, JPEG, etc). Preferred over image_base64 for large images.",
          },
          image_base64: {
            type: "string",
            description:
              "Base64-encoded image data (no data: URI prefix). Use file_path instead for large images.",
          },
          label: {
            type: "string",
            description: "Layer name shown in the canvas UI (default: timestamp)",
          },
        },
      },
    },
    {
      name: "resolve_annotations",
      description:
        "Mark one or more canvas annotations as addressed, rejected, or needs-clarification. Optionally attach a short reply per annotation. Use after completing a task to close the loop with the user on each annotation they placed.",
      inputSchema: {
        type: "object" as const,
        properties: {
          updates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: "Annotation ID from the submission's annotation list",
                },
                status: {
                  type: "string",
                  enum: ["addressed", "rejected", "needs-clarification"],
                },
                reply: {
                  type: "string",
                  description: "Optional short note attached to the annotation",
                },
              },
              required: ["id", "status"],
            },
            minItems: 1,
          },
        },
        required: ["updates"],
      },
    },
    {
      name: "push_annotations",
      description:
        "Add annotations to the canvas (pins, text labels, or callouts). Use on pushed renders to ask clarifying questions or highlight details. Each annotation appears on the canvas with a Claude-authored visual style.",
      inputSchema: {
        type: "object" as const,
        properties: {
          annotations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["text", "pin", "callout"] },
                at: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                bbox: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
                target: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
                text: { type: "string" },
                note: { type: "string" },
              },
              required: ["kind"],
            },
            minItems: 1,
          },
        },
        required: ["annotations"],
      },
    },
  ],
}));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "push_image") {
    let image: string;
    const filePath = (args as any)?.file_path;
    const inlineB64 = (args as any)?.image_base64;

    if (typeof filePath === "string" && filePath.length > 0) {
      // Read file from disk and convert to base64
      try {
        const buf = readFileSync(filePath);
        image = buf.toString("base64");
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: failed to read file "${filePath}": ${err}` }],
        };
      }
    } else if (typeof inlineB64 === "string" && inlineB64.length > 0) {
      image = inlineB64;
    } else {
      return {
        content: [{ type: "text", text: "Error: provide either file_path or image_base64" }],
      };
    }

    const imageSize = Math.ceil((image.length * 3) / 4);
    if (imageSize > 20 * 1024 * 1024) {
      return { content: [{ type: "text", text: "Error: image exceeds 20MB limit" }] };
    }

    if (!currentWs || currentWs.readyState !== WebSocket.OPEN) {
      return { content: [{ type: "text", text: "Error: not connected to trayce server" }] };
    }

    const pushLabel =
      typeof (args as any)?.label === "string"
        ? (args as any).label
        : `Claude: ${new Date().toLocaleTimeString()}`;

    currentWs.send(
      JSON.stringify({
        type: "canvas-push",
        image,
        label: pushLabel,
        visible: false,
      }),
    );

    const sizeMB = (imageSize / (1024 * 1024)).toFixed(1);
    return {
      content: [
        { type: "text", text: `Image pushed to canvas as layer "${pushLabel}" (${sizeMB}MB)` },
      ],
    };
  }

  if (name === "resolve_annotations") {
    return handleResolveAnnotations(args as { updates?: ResolveUpdate[] }, currentWs);
  }

  if (name === "push_annotations") {
    // The bridge has no visibility into the browser's pin counter, so we
    // always start numbering at 1. The browser's AnnotationRegistry.ingestPushed
    // (Task 10) renumbers any colliding pins.
    return handlePushAnnotations(
      args as { annotations?: PushAnnotationInput[] },
      currentWs,
      () => 1,
    );
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
});

function startTranscriptWatcher(ws: WebSocket): number | undefined {
  // On reconnect, reuse the previously discovered path if it still exists.
  // Otherwise: birthtime correlation (cwd-independent), then cwd-based fallback.
  let discoveredByBirthtime = false;
  let transcriptPath =
    lastTranscriptPath && existsSync(lastTranscriptPath) ? lastTranscriptPath : null;
  if (!transcriptPath) {
    transcriptPath = discoverTranscriptByBirthtime(bridgeStartTime);
    if (transcriptPath) discoveredByBirthtime = true;
  }
  if (!transcriptPath) {
    transcriptPath = discoverTranscriptPath(projectDir);
  }
  console.error(
    `[trayce bridge] projectDir=${projectDir} cwd=${process.cwd()} label=${label} transcript=${transcriptPath ?? "null"} birthtime=${discoveredByBirthtime}`,
  );
  if (!transcriptPath) {
    ws.send(JSON.stringify({ type: "transcript-status", available: false }));
    return undefined;
  }

  lastTranscriptPath = transcriptPath;

  // Use bridge connection time, not file birthtime — this gives the toggle
  // a useful meaning: "since you connected" vs "full transcript history"
  const sessionStartedAt: number = bridgeStartTime;

  ws.send(
    JSON.stringify({
      type: "transcript-status",
      available: true,
      transcriptPath,
      projectDir,
    }),
  );

  transcriptWatcher = new TranscriptWatcher(
    transcriptPath,
    projectDir,
    bridgeStartTime,
    (entry: TranscriptEntry) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "transcript-entry", entry }));
      if (entry.type === "response") {
        ws.send(
          JSON.stringify({
            type: "response",
            content: entry.content,
            timestamp: entry.timestamp,
            format: "markdown",
            final: true,
          }),
        );
      }
    },
    (usage: UsageData) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "usage-update", usage }));
    },
    discoveredByBirthtime,
  );

  transcriptWatcher.onFileSwitch = (newPath: string) => {
    lastTranscriptPath = newPath;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({ type: "register", sessionId, label, sessionStartedAt: bridgeStartTime }),
      );
    }
  };

  transcriptWatcher.start();
  return sessionStartedAt;
}

// WebSocket connection to trayce server
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let reconnectDelay = 1000;

function connect() {
  ({ host, port, token } = readState());
  const wsUrl = `ws://${host}:${port}/bridge?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    reconnectDelay = 1000;
    currentWs = ws;
    const sessionStartedAt = startTranscriptWatcher(ws);
    ws.send(JSON.stringify({ type: "register", sessionId, label, sessionStartedAt }));

    // Clear any prior heartbeat
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "heartbeat" }));
      }
    }, 10_000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(String(event.data));
      if (msg.type === "permission-verdict") {
        mcpServer.notification({
          method: "notifications/claude/channel/permission",
          params: {
            request_id: msg.requestId,
            behavior: msg.behavior,
          },
        });
        return;
      }
      if (msg.type === "submission") {
        const meta: Record<string, unknown> = { submission_id: msg.id };
        if (msg.pngPath) meta.image_path = msg.pngPath;

        const baseContent = msg.pngPath
          ? msg.prompt || "[sketch submitted — see attached image]"
          : msg.prompt;

        const annotationBlock = formatAnnotationsForNotification(msg.annotations ?? []);
        const content = annotationBlock ? `${baseContent}\n\n${annotationBlock}` : baseContent;

        mcpServer.notification({
          method: "notifications/claude/channel",
          params: { content, meta },
        });
      }
    } catch {
      // Ignore malformed messages
    }
  };

  ws.onclose = () => {
    currentWs = null;
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (transcriptWatcher) {
      transcriptWatcher.stop();
      transcriptWatcher = null;
    }
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      connect();
    }, reconnectDelay);
  };

  ws.onerror = () => {
    // onclose will fire after onerror
  };
}

connect();

// Start MCP stdio transport
const transport = new StdioServerTransport();
await mcpServer.connect(transport);
