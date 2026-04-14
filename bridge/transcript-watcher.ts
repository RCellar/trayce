import { closeSync, existsSync, openSync, readdirSync, readSync, statSync, watch } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export interface TranscriptEntry {
  type: "message" | "response" | "tool-call" | "tool-result";
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  toolName?: string;
  toolInput?: string;
  toolUseId?: string;
  /** Per-message token counts (only on assistant entries) */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface UsageData {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
  timestamp: number;
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string | ContentBlock[] }
  | { type: string; [key: string]: unknown };

// Claude Code JSONL envelope: { type: "user"|"assistant", message: { role, content }, timestamp, ... }
interface ClaudeCodeLine {
  type: string;
  message?: { role: "user" | "assistant"; content: string | ContentBlock[] };
  timestamp?: string;
}

export class TranscriptWatcher {
  private filePath: string;
  private cwd: string;
  private startTime: number;
  private onEntry: (entry: TranscriptEntry) => void;
  private onUsage: ((usage: UsageData) => void) | undefined;
  private offset: number = 0;
  private fsWatcher: ReturnType<typeof watch> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private rediscoverTimer: ReturnType<typeof setInterval> | null = null;
  private subagentDir: string | null = null;
  private subagentOffsets = new Map<string, number>();
  private confirmed = false;
  private discoveredByBirthtime = false;
  onFileSwitch: ((newPath: string) => void) | null = null;

  constructor(
    filePath: string,
    cwd: string,
    startTime: number,
    onEntry: (entry: TranscriptEntry) => void,
    onUsage?: (usage: UsageData) => void,
    discoveredByBirthtime = false,
  ) {
    this.filePath = filePath;
    this.cwd = cwd;
    this.startTime = startTime;
    this.onEntry = onEntry;
    this.onUsage = onUsage;
    this.discoveredByBirthtime = discoveredByBirthtime;
  }

  start(): void {
    // Read existing content first
    this.readNewEntries();

    this.startFileWatcher();

    // 2-second polling fallback
    this.pollTimer = setInterval(() => {
      this.readNewEntries();
    }, 2000);

    // Periodically re-discover transcript file — the current session's .jsonl
    // may not exist yet when the bridge starts (Claude creates it on first message)
    this.rediscoverTimer = setInterval(() => {
      this.rediscover();
    }, 3000);
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
    if (this.rediscoverTimer) {
      clearInterval(this.rediscoverTimer);
      this.rediscoverTimer = null;
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
      this.fsWatcher = watch(dir, (_event, filename) => {
        if (!filename || filename === watchFile) {
          this.readNewEntries();
        }
      });
    } catch {
      // fs.watch may not be available in all environments — fall through to polling
    }
  }

  private rediscover(): void {
    if (this.confirmed) return;
    // Birthtime correlation first; only fall through to cwd if birthtime
    // found nothing. If birthtime returns the current file, that confirms
    // we're watching the right one — do NOT fall through (avoids oscillation
    // between birthtime's pick and cwd's pick).
    const birthtimePath = discoverTranscriptByBirthtime(this.startTime);
    if (birthtimePath && birthtimePath === this.filePath) {
      // Birthtime confirms we're already watching the right file
      this.discoveredByBirthtime = true;
      this.confirmed = true;
      return;
    }
    const newPath = birthtimePath ?? discoverTranscriptPath(this.cwd);
    if (!newPath || newPath === this.filePath) return;

    console.error(`[trayce watcher] switching transcript: ${this.filePath} -> ${newPath}`);
    this.filePath = newPath;
    this.offset = 0;
    this.subagentDir = null;
    this.subagentOffsets.clear();
    if (birthtimePath) this.discoveredByBirthtime = true;
    this.startFileWatcher();
    this.onFileSwitch?.(newPath);
    this.readNewEntries();
  }

  readNewEntries(): void {
    if (existsSync(this.filePath)) {
      const fd = openSync(this.filePath, "r");
      try {
        // Read from current offset to end of file
        const chunkSize = 65536; // 64KB chunks
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

          if (lastNewline === -1) {
            // No complete line yet — don't advance offset, retry next poll
          } else {
            const completeBytes = Buffer.byteLength(text.slice(0, lastNewline + 1), "utf-8");
            this.offset += completeBytes;

            const completeText = text.slice(0, lastNewline + 1);
            for (const line of completeText.split("\n")) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              this.parseLine(trimmed);
            }
            if (this.discoveredByBirthtime) this.confirmed = true;
          }
        }
      } finally {
        closeSync(fd);
      }
    }

    this.readSubagentEntries();
  }

  private computeSubagentDir(): string | null {
    const base = this.filePath.replace(/\.jsonl$/, "");
    const dir = join(base, "subagents");
    return dir;
  }

  private readSubagentEntries(): void {
    if (!this.subagentDir) {
      this.subagentDir = this.computeSubagentDir();
    }
    if (!this.subagentDir || !existsSync(this.subagentDir)) return;

    let files: string[];
    try {
      files = readdirSync(this.subagentDir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      return;
    }

    for (const file of files) {
      const fullPath = join(this.subagentDir, file);
      const currentOffset = this.subagentOffsets.get(file) ?? 0;

      let fd: number;
      try {
        fd = openSync(fullPath, "r");
      } catch {
        continue;
      }

      try {
        const chunkSize = 65536;
        const buffers: Buffer[] = [];
        let totalRead = 0;

        while (true) {
          const buf = Buffer.allocUnsafe(chunkSize);
          const bytesRead = readSync(fd, buf, 0, chunkSize, currentOffset + totalRead);
          if (bytesRead === 0) break;
          buffers.push(buf.subarray(0, bytesRead));
          totalRead += bytesRead;
          if (bytesRead < chunkSize) break;
        }

        if (totalRead === 0) continue;

        const text = Buffer.concat(buffers).toString("utf-8");
        const lastNewline = text.lastIndexOf("\n");

        if (lastNewline === -1) {
          continue;
        }

        const completeBytes = Buffer.byteLength(text.slice(0, lastNewline + 1), "utf-8");
        this.subagentOffsets.set(file, currentOffset + completeBytes);

        const completeText = text.slice(0, lastNewline + 1);
        for (const line of completeText.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          this.parseLine(trimmed);
        }
      } finally {
        closeSync(fd);
      }
    }
  }

  private parseLine(line: string): void {
    let raw: ClaudeCodeLine;
    try {
      raw = JSON.parse(line) as ClaudeCodeLine;
    } catch {
      return;
    }

    // Only process user/assistant message entries
    if (!raw || (raw.type !== "user" && raw.type !== "assistant")) return;
    const msg = raw.message;
    if (!msg?.role) return;

    // Content can be a plain string (user text) or array of blocks
    const blocks: ContentBlock[] =
      typeof msg.content === "string"
        ? [{ type: "text", text: msg.content }]
        : Array.isArray(msg.content)
          ? msg.content
          : [];

    const timestamp = raw.timestamp ? new Date(raw.timestamp).getTime() : Date.now();
    const role = msg.role;

    // Extract per-message usage for assistant entries
    const usage = raw.type === "assistant" ? (msg as any).usage : undefined;
    const tokenFields =
      usage && typeof usage.output_tokens === "number"
        ? {
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            cacheReadTokens: usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
          }
        : {};

    for (const block of blocks) {
      if (block.type === "text") {
        const textBlock = block as { type: "text"; text: string };
        this.onEntry({
          type: role === "user" ? "message" : "response",
          role,
          content: textBlock.text,
          timestamp,
          ...tokenFields,
        });
      } else if (block.type === "tool_use") {
        const toolBlock = block as { type: "tool_use"; id: string; name: string; input: unknown };
        const rawInput = JSON.stringify(toolBlock.input);
        this.onEntry({
          type: "tool-call",
          role: "assistant",
          content: toolBlock.name,
          timestamp,
          toolName: toolBlock.name,
          toolInput: rawInput.length > 200 ? rawInput.slice(0, 200) : rawInput,
          toolUseId: toolBlock.id,
          ...tokenFields,
        });
      } else if (block.type === "tool_result") {
        const resultBlock = block as {
          type: "tool_result";
          tool_use_id: string;
          content: string | ContentBlock[];
        };
        // tool_result content can be a string or an array of blocks
        let rawContent: string;
        if (typeof resultBlock.content === "string") {
          rawContent = resultBlock.content;
        } else if (Array.isArray(resultBlock.content)) {
          rawContent = resultBlock.content
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b) => b.text)
            .join("\n");
        } else {
          rawContent = "";
        }
        this.onEntry({
          type: "tool-result",
          role: "user",
          content: rawContent.length > 500 ? rawContent.slice(0, 500) : rawContent,
          timestamp,
          toolUseId: resultBlock.tool_use_id,
        });
      }
    }

    // Emit usage data for assistant messages
    if (this.onUsage && raw.type === "assistant") {
      const usage = (msg as any).usage;
      const model = (msg as any).model;
      if (usage && typeof usage.output_tokens === "number") {
        this.onUsage({
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
          model: typeof model === "string" ? model : "unknown",
          timestamp,
        });
      }
    }
  }
}

/**
 * Find the transcript file created closest to the given timestamp.
 * Scans ALL project directories — does not depend on cwd.
 * Only considers files created within a 2s grace period before startTime
 * or up to 60s after startTime, to avoid matching files from previous sessions.
 */
export function discoverTranscriptByBirthtime(startTime: number): string | null {
  const claudeProjectsDir = join(homedir(), ".claude", "projects");
  if (!existsSync(claudeProjectsDir)) return null;

  const GRACE_MS = 2_000;
  const MAX_AFTER_MS = 60_000;
  let bestPath: string | null = null;
  let bestDrift = Infinity;

  for (const dir of safeReaddir(claudeProjectsDir)) {
    const projectDir = join(claudeProjectsDir, dir);
    for (const entry of safeReaddir(projectDir)) {
      if (!entry.endsWith(".jsonl")) continue;
      const full = join(projectDir, entry);
      try {
        const stat = statSync(full);
        const born = stat.birthtimeMs;
        if (born < startTime - GRACE_MS || born > startTime + MAX_AFTER_MS) continue;
        const drift = Math.abs(born - startTime);
        if (drift < bestDrift) {
          bestDrift = drift;
          bestPath = full;
        }
      } catch {}
    }
  }

  return bestPath;
}

/**
 * Discover Claude Code conversation JSONL by matching cwd to project directory.
 *
 * Claude Code stores conversations as {session-uuid}.jsonl inside
 * ~/.claude/projects/{encoded-cwd}/. The directory name is the cwd
 * with path separators replaced by dashes.
 */
export function discoverTranscriptPath(cwd: string): string | null {
  const envPath = process.env.CLAUDE_TRANSCRIPT;
  if (envPath && existsSync(envPath)) {
    return envPath;
  }

  const claudeProjectsDir = join(homedir(), ".claude", "projects");
  if (!existsSync(claudeProjectsDir)) return null;

  // Claude Code encodes the cwd as a directory name by replacing / with -
  const encodedCwd = cwd.replace(/[\\/]/g, "-").replace(/^-/, "-");

  // Try matching project dir first, then fall back to most recent across all
  const projectDirs = safeReaddir(claudeProjectsDir);
  const matchingDir = projectDirs.find((d) => d === encodedCwd);

  if (matchingDir) {
    return mostRecentJsonl(join(claudeProjectsDir, matchingDir));
  }

  return null;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function mostRecentJsonl(dir: string): string | null {
  const entries = safeReaddir(dir);
  let best: string | null = null;
  let bestMtime = 0;

  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const full = join(dir, entry);
    try {
      const mt = statSync(full).mtimeMs;
      if (mt > bestMtime) {
        bestMtime = mt;
        best = full;
      }
    } catch {}
  }

  return best;
}
