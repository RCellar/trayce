import { closeSync, existsSync, openSync, readSync, watch } from "node:fs";
import { basename, dirname } from "node:path";

export interface TranscriptEntry {
  type: "message" | "response" | "tool-call" | "tool-result";
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  toolName?: string;
  toolInput?: string;
  toolUseId?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string | ContentBlock[] }
  | { type: string; [key: string]: unknown };

interface ClaudeCodeLine {
  type: string;
  message?: { role: "user" | "assistant"; content: string | ContentBlock[] };
  timestamp?: string;
}

/**
 * Slim transcript watcher. Tails a known JSONL path and emits only
 * assistant prose and user text entries. Tool-use and usage entries
 * are skipped — those arrive via hooks and OTEL respectively.
 *
 * The transcript path is provided externally (from a SessionStart
 * hook via the server's session-context message). No discovery
 * heuristics.
 */
export class TranscriptWatcher {
  private filePath: string;
  private onEntry: (entry: TranscriptEntry) => void;
  private offset: number = 0;
  private fsWatcher: ReturnType<typeof watch> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(filePath: string, onEntry: (entry: TranscriptEntry) => void) {
    this.filePath = filePath;
    this.onEntry = onEntry;
  }

  start(): void {
    this.readNewEntries();
    this.startFileWatcher();
    this.pollTimer = setInterval(() => {
      this.readNewEntries();
    }, 2000);
  }

  stop(): void {
    if (this.fsWatcher) {
      this.fsWatcher.close();
      this.fsWatcher = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private startFileWatcher(): void {
    if (this.fsWatcher) {
      this.fsWatcher.close();
      this.fsWatcher = null;
    }

    const dir = dirname(this.filePath);
    try {
      const watchFile = basename(this.filePath);
      this.fsWatcher = watch(dir, { persistent: false }, (_event, filename) => {
        if (!filename || filename === watchFile) {
          this.readNewEntries();
        }
      });
    } catch {
      // fs.watch may not be available — fall through to polling
    }
  }

  readNewEntries(): void {
    if (!existsSync(this.filePath)) return;

    const fd = openSync(this.filePath, "r");
    try {
      const chunkSize = 65536;
      const buffers: Buffer[] = [];
      let totalRead = 0;

      while (true) {
        const buf = Buffer.allocUnsafe(chunkSize);
        const bytesRead = readSync(fd, buf, 0, chunkSize, this.offset + totalRead);
        if (bytesRead === 0) break;
        buffers.push(buf.subarray(0, bytesRead));
        totalRead += bytesRead;
        if (bytesRead < chunkSize) break;
      }

      if (totalRead > 0) {
        const text = Buffer.concat(buffers).toString("utf-8");
        const lastNewline = text.lastIndexOf("\n");
        if (lastNewline !== -1) {
          const completeBytes = Buffer.byteLength(text.slice(0, lastNewline + 1), "utf-8");
          this.offset += completeBytes;
          const completeText = text.slice(0, lastNewline + 1);
          for (const line of completeText.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            this.parseLine(trimmed);
          }
        }
      }
    } finally {
      closeSync(fd);
    }
  }

  private parseLine(line: string): void {
    let raw: ClaudeCodeLine;
    try {
      raw = JSON.parse(line) as ClaudeCodeLine;
    } catch {
      return;
    }

    if (!raw || (raw.type !== "user" && raw.type !== "assistant")) return;
    const msg = raw.message;
    if (!msg?.role) return;

    const blocks: ContentBlock[] =
      typeof msg.content === "string"
        ? [{ type: "text", text: msg.content }]
        : Array.isArray(msg.content)
          ? msg.content
          : [];

    const timestamp = raw.timestamp ? new Date(raw.timestamp).getTime() : Date.now();
    const role = msg.role;

    for (const block of blocks) {
      // Only emit text blocks — tool_use and tool_result are handled by hooks
      if (block.type !== "text") continue;
      const textBlock = block as { type: "text"; text: string };
      this.onEntry({
        type: role === "user" ? "message" : "response",
        role,
        content: textBlock.text,
        timestamp,
      });
    }
  }
}
