import {
  existsSync,
  openSync,
  readSync,
  closeSync,
  readdirSync,
  statSync,
  watch,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface TranscriptEntry {
  type: "message" | "response" | "tool-call" | "tool-result";
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  toolName?: string;
  toolInput?: string;
  toolUseId?: string;
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string }
  | { type: string; [key: string]: unknown };

interface TranscriptLine {
  role: "user" | "assistant";
  content: ContentBlock[];
}

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
    // Read existing content first
    this.readNewEntries();

    // Watch parent directory for changes (more reliable than watching the file directly)
    const dir = dirname(this.filePath);
    try {
      this.fsWatcher = watch(dir, (_event, filename) => {
        if (!filename || filename === "transcript.jsonl" || this.filePath.endsWith(filename)) {
          this.readNewEntries();
        }
      });
    } catch {
      // fs.watch may not be available in all environments — fall through to polling
    }

    // 2-second polling fallback
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

  readNewEntries(): void {
    if (!existsSync(this.filePath)) return;

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

      if (totalRead === 0) return;

      this.offset += totalRead;

      const text = Buffer.concat(buffers).toString("utf-8");
      const lines = text.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        this.parseLine(trimmed);
      }
    } finally {
      closeSync(fd);
    }
  }

  private parseLine(line: string): void {
    let parsed: TranscriptLine;
    try {
      parsed = JSON.parse(line) as TranscriptLine;
    } catch {
      return; // Skip malformed lines
    }

    if (!parsed || !parsed.role || !Array.isArray(parsed.content)) return;

    const timestamp = Date.now();
    const role = parsed.role;

    for (const block of parsed.content) {
      if (block.type === "text") {
        const textBlock = block as { type: "text"; text: string };
        const entry: TranscriptEntry = {
          type: role === "user" ? "message" : "response",
          role,
          content: textBlock.text,
          timestamp,
        };
        this.onEntry(entry);
      } else if (block.type === "tool_use") {
        const toolBlock = block as { type: "tool_use"; id: string; name: string; input: unknown };
        const rawInput = JSON.stringify(toolBlock.input);
        const truncatedInput = rawInput.length > 200 ? rawInput.slice(0, 200) : rawInput;
        const entry: TranscriptEntry = {
          type: "tool-call",
          role: "assistant",
          content: toolBlock.name,
          timestamp,
          toolName: toolBlock.name,
          toolInput: truncatedInput,
          toolUseId: toolBlock.id,
        };
        this.onEntry(entry);
      } else if (block.type === "tool_result") {
        const resultBlock = block as { type: "tool_result"; tool_use_id: string; content: string };
        const rawContent = resultBlock.content ?? "";
        const truncatedContent =
          rawContent.length > 500 ? rawContent.slice(0, 500) : rawContent;
        const entry: TranscriptEntry = {
          type: "tool-result",
          role: "user",
          content: truncatedContent,
          timestamp,
          toolUseId: resultBlock.tool_use_id,
        };
        this.onEntry(entry);
      }
    }
  }
}

/**
 * Discover the most relevant Claude transcript JSONL file.
 * 1. Check CLAUDE_TRANSCRIPT env var — if set and file exists, return it
 * 2. Look in ~/.claude/projects/ for most recently modified transcript.jsonl
 * 3. Return null if not found
 */
export function discoverTranscriptPath(cwd: string): string | null {
  // 1. Explicit env override
  const envPath = process.env.CLAUDE_TRANSCRIPT;
  if (envPath && existsSync(envPath)) {
    return envPath;
  }

  // 2. Scan ~/.claude/projects/ for most recently modified transcript.jsonl
  const claudeProjectsDir = join(homedir(), ".claude", "projects");
  if (!existsSync(claudeProjectsDir)) return null;

  let bestPath: string | null = null;
  let bestMtime = 0;

  try {
    const projectDirs = readdirSync(claudeProjectsDir);
    for (const projectDir of projectDirs) {
      const transcriptPath = join(claudeProjectsDir, projectDir, "transcript.jsonl");
      if (existsSync(transcriptPath)) {
        try {
          const stat = statSync(transcriptPath);
          if (stat.mtimeMs > bestMtime) {
            bestMtime = stat.mtimeMs;
            bestPath = transcriptPath;
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch {
    // Unable to read projects directory
    return null;
  }

  // Suppress unused parameter warning — cwd is available for future use
  void cwd;

  return bestPath;
}
