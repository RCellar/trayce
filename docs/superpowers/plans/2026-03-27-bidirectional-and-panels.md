# Bidirectional Communication & Side Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bridge bidirectional (transcript streaming + canvas push) and add a side panel with Response and Transcript tabs to the browser client.

**Architecture:** The bridge gains a transcript file watcher and an MCP reverse-notification handler. Both send new message types over the existing WebSocket to the server, which routes them to browsers. The client adds a resizable side panel with two tabs that render incoming data.

**Tech Stack:** Bun, TypeScript, PixiJS (existing), MCP SDK (existing), `fs.watch` for transcript tailing.

**Spec:** `docs/superpowers/specs/2026-03-27-bidirectional-and-panels-design.md`

**Security note:** The markdown renderer (`client/markdown.ts`) escapes all HTML entities via `escapeHtml()` before rendering, preventing XSS. All `innerHTML` assignments receive only pre-escaped content from `renderMarkdown()`.

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `bridge/transcript-watcher.ts` | Discovers and tails Claude's transcript JSONL, classifies entries, emits callbacks |
| `client/side-panel.ts` | Side panel container: open/close, resize drag, tab switching |
| `client/response-tab.ts` | Response tab: renders markdown messages, canvas-push notifications |
| `client/transcript-tab.ts` | Transcript tab: renders conversation with collapsible tool calls |
| `client/markdown.ts` | Lightweight markdown to HTML renderer (all output HTML-escaped) |
| `tests/bridge/transcript-watcher.test.ts` | Unit tests for transcript watcher |
| `tests/server/bridge-routing.test.ts` | Tests for new message type routing |
| `tests/client/markdown.test.ts` | Markdown renderer unit tests |
| `tests/client/side-panel.test.ts` | Side panel open/close/resize tests |

### Modified Files

| File | Changes |
|------|---------|
| `bridge/index.ts` | Import and start transcript watcher, register MCP reverse-notification handler, send new message types |
| `server/websocket.ts` | Route `transcript-entry`, `response`, `canvas-push`, `transcript-status` from bridges to browsers |
| `client/app.ts` | Import side panel, wire new message types, add canvas-push layer handler |
| `client/toolbar.ts` | Add panel toggle buttons below existing actions |
| `client/index.html` | Add side panel container div |
| `client/style.css` | Side panel styles, tab styles, markdown content styles |

---

## Task 1: Markdown Renderer

**Files:**
- Create: `client/markdown.ts`
- Test: `tests/client/markdown.test.ts`

- [ ] **Step 1: Write failing tests for the markdown renderer**

```typescript
// tests/client/markdown.test.ts
import { describe, expect, it } from "bun:test";
import { renderMarkdown } from "../../client/markdown";

describe("renderMarkdown", () => {
  it("renders plain text as a paragraph", () => {
    expect(renderMarkdown("Hello world")).toBe("<p>Hello world</p>");
  });

  it("renders headings", () => {
    expect(renderMarkdown("# Title")).toBe('<h1>Title</h1>');
    expect(renderMarkdown("## Subtitle")).toBe('<h2>Subtitle</h2>');
    expect(renderMarkdown("### H3")).toBe('<h3>H3</h3>');
  });

  it("renders bold and italic", () => {
    expect(renderMarkdown("**bold**")).toBe("<p><strong>bold</strong></p>");
    expect(renderMarkdown("*italic*")).toBe("<p><em>italic</em></p>");
  });

  it("renders inline code", () => {
    expect(renderMarkdown("`code`")).toBe("<p><code>code</code></p>");
  });

  it("renders code blocks with language class", () => {
    const input = "```typescript\nconst x = 1;\n```";
    const result = renderMarkdown(input);
    expect(result).toContain('<pre><code class="language-typescript">');
    expect(result).toContain("const x = 1;");
    expect(result).toContain("</code></pre>");
  });

  it("renders code blocks without language", () => {
    const input = "```\nplain code\n```";
    const result = renderMarkdown(input);
    expect(result).toContain("<pre><code>");
    expect(result).toContain("plain code");
  });

  it("renders unordered lists", () => {
    const input = "- one\n- two\n- three";
    const result = renderMarkdown(input);
    expect(result).toContain("<ul>");
    expect(result).toContain("<li>one</li>");
    expect(result).toContain("<li>two</li>");
    expect(result).toContain("<li>three</li>");
    expect(result).toContain("</ul>");
  });

  it("renders ordered lists", () => {
    const input = "1. first\n2. second";
    const result = renderMarkdown(input);
    expect(result).toContain("<ol>");
    expect(result).toContain("<li>first</li>");
    expect(result).toContain("<li>second</li>");
    expect(result).toContain("</ol>");
  });

  it("renders links", () => {
    expect(renderMarkdown("[text](http://example.com)")).toContain(
      '<a href="http://example.com" target="_blank" rel="noopener">text</a>'
    );
  });

  it("escapes HTML in content", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("<script>");
  });

  it("handles multiple paragraphs", () => {
    const input = "First paragraph.\n\nSecond paragraph.";
    const result = renderMarkdown(input);
    expect(result).toContain("<p>First paragraph.</p>");
    expect(result).toContain("<p>Second paragraph.</p>");
  });

  it("renders mixed content", () => {
    const input = "# Title\n\nSome **bold** text.\n\n```js\nalert(1);\n```\n\n- item";
    const result = renderMarkdown(input);
    expect(result).toContain("<h1>Title</h1>");
    expect(result).toContain("<strong>bold</strong>");
    expect(result).toContain('<pre><code class="language-js">');
    expect(result).toContain("<li>item</li>");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/client/markdown.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement the markdown renderer**

```typescript
// client/markdown.ts

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );
}

export function renderMarkdown(source: string): string {
  const lines = source.split("\n");
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    const codeMatch = line.match(/^```(\w*)$/);
    if (codeMatch) {
      const lang = codeMatch[1];
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      i++; // skip closing ```
      const langAttr = lang ? ` class="language-${lang}"` : "";
      blocks.push(`<pre><code${langAttr}>${codeLines.join("\n")}</code></pre>`);
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${renderInline(escapeHtml(headingMatch[2]))}</h${level}>`);
      i++;
      continue;
    }

    // Unordered list
    if (line.match(/^[-*]\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-*]\s/)) {
        items.push(`<li>${renderInline(escapeHtml(lines[i].replace(/^[-*]\s/, "")))}</li>`);
        i++;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (line.match(/^\d+\.\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        items.push(`<li>${renderInline(escapeHtml(lines[i].replace(/^\d+\.\s/, "")))}</li>`);
        i++;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].match(/^(#{1,6}\s|[-*]\s|\d+\.\s|```)/) ) {
      paraLines.push(escapeHtml(lines[i]));
      i++;
    }
    blocks.push(`<p>${renderInline(paraLines.join(" "))}</p>`);
  }

  return blocks.join("");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/client/markdown.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add client/markdown.ts tests/client/markdown.test.ts
git commit -m "feat(client): add lightweight markdown renderer"
```

---

## Task 2: Transcript Watcher Module

**Files:**
- Create: `bridge/transcript-watcher.ts`
- Test: `tests/bridge/transcript-watcher.test.ts`

- [ ] **Step 1: Write failing tests for transcript watcher**

```typescript
// tests/bridge/transcript-watcher.test.ts
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, appendFileSync } from "node:fs";
import { TranscriptWatcher, type TranscriptEntry } from "../../bridge/transcript-watcher";

const TEST_DIR = "/tmp/trayce-test-transcript";
const TEST_FILE = `${TEST_DIR}/transcript.jsonl`;

const USER_MSG = JSON.stringify({
  role: "user",
  content: [{ type: "text", text: "Hello Claude" }],
});

const ASSISTANT_MSG = JSON.stringify({
  role: "assistant",
  content: [{ type: "text", text: "Hi! How can I help?" }],
});

const TOOL_USE_MSG = JSON.stringify({
  role: "assistant",
  content: [
    { type: "text", text: "Let me read that file." },
    { type: "tool_use", id: "tu_123", name: "Read", input: { file_path: "/src/main.ts" } },
  ],
});

const TOOL_RESULT_MSG = JSON.stringify({
  role: "user",
  content: [
    { type: "tool_result", tool_use_id: "tu_123", content: "file contents here" },
  ],
});

describe("TranscriptWatcher", () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("classifies user text messages", () => {
    writeFileSync(TEST_FILE, USER_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (e) => entries.push(e));
    watcher.readNewEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].role).toBe("user");
    expect(entries[0].type).toBe("message");
    expect(entries[0].content).toBe("Hello Claude");
    watcher.stop();
  });

  it("classifies assistant text as response", () => {
    writeFileSync(TEST_FILE, ASSISTANT_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (e) => entries.push(e));
    watcher.readNewEntries();
    const responses = entries.filter((e) => e.type === "response");
    expect(responses.length).toBe(1);
    expect(responses[0].content).toBe("Hi! How can I help?");
    watcher.stop();
  });

  it("classifies tool_use as tool-call entry", () => {
    writeFileSync(TEST_FILE, TOOL_USE_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (e) => entries.push(e));
    watcher.readNewEntries();
    const toolCalls = entries.filter((e) => e.type === "tool-call");
    expect(toolCalls.length).toBe(1);
    expect(toolCalls[0].toolName).toBe("Read");
    expect(toolCalls[0].toolInput).toContain("/src/main.ts");
    watcher.stop();
  });

  it("pairs tool_result with tool_use", () => {
    writeFileSync(TEST_FILE, TOOL_USE_MSG + "\n" + TOOL_RESULT_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (e) => entries.push(e));
    watcher.readNewEntries();
    const results = entries.filter((e) => e.type === "tool-result");
    expect(results.length).toBe(1);
    expect(results[0].toolUseId).toBe("tu_123");
    expect(results[0].content).toContain("file contents");
    watcher.stop();
  });

  it("reads incrementally from byte offset", () => {
    writeFileSync(TEST_FILE, USER_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (e) => entries.push(e));
    watcher.readNewEntries();
    expect(entries.length).toBeGreaterThan(0);

    const countBefore = entries.length;
    appendFileSync(TEST_FILE, ASSISTANT_MSG + "\n");
    watcher.readNewEntries();
    expect(entries.length).toBeGreaterThan(countBefore);
    watcher.stop();
  });

  it("emits both response and tool-call for mixed assistant message", () => {
    writeFileSync(TEST_FILE, TOOL_USE_MSG + "\n");
    const entries: TranscriptEntry[] = [];
    const watcher = new TranscriptWatcher(TEST_FILE, (e) => entries.push(e));
    watcher.readNewEntries();
    const responses = entries.filter((e) => e.type === "response");
    const toolCalls = entries.filter((e) => e.type === "tool-call");
    expect(responses.length).toBe(1);
    expect(toolCalls.length).toBe(1);
    watcher.stop();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/bridge/transcript-watcher.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement the transcript watcher**

```typescript
// bridge/transcript-watcher.ts
import { readFileSync, statSync, watch, existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

type EntryCallback = (entry: TranscriptEntry) => void;

export class TranscriptWatcher {
  private offset = 0;
  private watcher: ReturnType<typeof watch> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private filePath: string,
    private onEntry: EntryCallback,
  ) {}

  start(): void {
    this.readNewEntries();

    try {
      this.watcher = watch(dirname(this.filePath), () => {
        this.readNewEntries();
      });
    } catch {
      // fs.watch not supported — rely on polling
    }

    this.pollTimer = setInterval(() => {
      this.readNewEntries();
    }, 2000);
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  readNewEntries(): void {
    if (!existsSync(this.filePath)) return;

    let size: number;
    try {
      size = statSync(this.filePath).size;
    } catch {
      return;
    }

    if (size <= this.offset) return;

    let chunk: string;
    try {
      const full = readFileSync(this.filePath, "utf-8");
      chunk = full.slice(this.offset);
      this.offset = size;
    } catch {
      return;
    }

    const lines = chunk.split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        this.classifyMessage(msg);
      } catch {
        // Skip malformed lines
      }
    }
  }

  private classifyMessage(msg: { role?: string; content?: unknown[] }): void {
    if (!msg.role || !Array.isArray(msg.content)) return;
    const now = Date.now();

    for (const block of msg.content) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as Record<string, unknown>;

      if (b.type === "text" && typeof b.text === "string") {
        this.onEntry({
          type: msg.role === "assistant" ? "response" : "message",
          role: msg.role as "user" | "assistant",
          content: b.text,
          timestamp: now,
        });
      }

      if (b.type === "tool_use" && typeof b.name === "string") {
        const inputStr = typeof b.input === "object"
          ? JSON.stringify(b.input).slice(0, 200)
          : String(b.input ?? "").slice(0, 200);
        this.onEntry({
          type: "tool-call",
          role: "assistant",
          content: `${b.name}: ${inputStr}`,
          timestamp: now,
          toolName: b.name,
          toolInput: inputStr,
          toolUseId: typeof b.id === "string" ? b.id : undefined,
        });
      }

      if (b.type === "tool_result") {
        const resultContent = typeof b.content === "string"
          ? b.content.slice(0, 500)
          : JSON.stringify(b.content ?? "").slice(0, 500);
        this.onEntry({
          type: "tool-result",
          role: "user",
          content: resultContent,
          timestamp: now,
          toolUseId: typeof b.tool_use_id === "string" ? b.tool_use_id : undefined,
        });
      }
    }
  }
}

export function discoverTranscriptPath(cwd: string): string | null {
  const envPath = process.env.CLAUDE_TRANSCRIPT;
  if (envPath && existsSync(envPath)) return envPath;

  const claudeDir = resolve(homedir(), ".claude", "projects");
  if (!existsSync(claudeDir)) return null;

  try {
    const entries = readdirSync(claudeDir, { withFileTypes: true });
    let bestPath: string | null = null;
    let bestMtime = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const transcriptPath = resolve(claudeDir, entry.name, "transcript.jsonl");
      if (existsSync(transcriptPath)) {
        try {
          const stat = statSync(transcriptPath);
          if (stat.mtimeMs > bestMtime) {
            bestMtime = stat.mtimeMs;
            bestPath = transcriptPath;
          }
        } catch {
          continue;
        }
      }
    }

    return bestPath;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/bridge/transcript-watcher.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add bridge/transcript-watcher.ts tests/bridge/transcript-watcher.test.ts
git commit -m "feat(bridge): add transcript file watcher with entry classification"
```

---

## Task 3: Server Message Routing for New Types

**Files:**
- Modify: `server/websocket.ts`
- Test: `tests/server/bridge-routing.test.ts`

- [ ] **Step 1: Write failing tests for new message routing**

```typescript
// tests/server/bridge-routing.test.ts
import { describe, expect, it, beforeEach } from "bun:test";
import { WebSocketHub, type WsData } from "../../server/websocket";
import { SessionRegistry } from "../../server/sessions";
import { SubmissionStore } from "../../server/submissions";
import { getConfig } from "../../server/config";
import { rmSync } from "node:fs";

const TEST_DIR = "/tmp/trayce-test-routing";

interface MockWs {
  data: WsData;
  sent: string[];
  closed: boolean;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

function makeMockWs(overrides: Partial<WsData> = {}): MockWs {
  return {
    data: {
      kind: "browser",
      id: crypto.randomUUID(),
      sessionId: undefined,
      lastHeartbeat: 1_000_000,
      ...overrides,
    },
    sent: [],
    closed: false,
    send(data: string) { this.sent.push(data); },
    close() { this.closed = true; },
  } as MockWs;
}

function sentOfType(ws: MockWs, type: string): Record<string, unknown>[] {
  return ws.sent
    .map((s) => JSON.parse(s) as Record<string, unknown>)
    .filter((m) => m.type === type);
}

function makeHub() {
  const registry = new SessionRegistry();
  const store = new SubmissionStore(TEST_DIR, 20 * 1024 * 1024);
  const config = getConfig({});
  const now = { value: 1_000_000 };
  const hub = new WebSocketHub(registry, store, config, () => now.value);
  return { hub, registry };
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("bridge-to-browser routing", () => {
  it("routes transcript-entry from bridge to browsers watching that session", async () => {
    const { hub } = makeHub();
    const bridge = makeMockWs({ kind: "bridge" }) as any;
    const browser = makeMockWs({ kind: "browser" }) as any;

    hub.addBridge(bridge);
    hub.addBrowser(browser);
    await hub.handleMessage(bridge, JSON.stringify({
      type: "register", sessionId: "sess-1", label: "test",
    }));
    await hub.handleMessage(browser, JSON.stringify({
      type: "watch-session", sessionId: "sess-1",
    }));

    await hub.handleMessage(bridge, JSON.stringify({
      type: "transcript-entry",
      entry: { role: "user", type: "message", content: "hello", timestamp: 123 },
    }));

    const entries = sentOfType(browser, "transcript-entry");
    expect(entries.length).toBe(1);
    expect((entries[0] as any).sessionId).toBe("sess-1");
  });

  it("routes response from bridge to browsers", async () => {
    const { hub } = makeHub();
    const bridge = makeMockWs({ kind: "bridge" }) as any;
    const browser = makeMockWs({ kind: "browser" }) as any;

    hub.addBridge(bridge);
    hub.addBrowser(browser);
    await hub.handleMessage(bridge, JSON.stringify({
      type: "register", sessionId: "sess-1", label: "test",
    }));
    await hub.handleMessage(browser, JSON.stringify({
      type: "watch-session", sessionId: "sess-1",
    }));

    await hub.handleMessage(bridge, JSON.stringify({
      type: "response",
      content: "Here is the answer",
      format: "markdown",
      final: true,
    }));

    const responses = sentOfType(browser, "response");
    expect(responses.length).toBe(1);
    expect((responses[0] as any).content).toBe("Here is the answer");
    expect((responses[0] as any).sessionId).toBe("sess-1");
  });

  it("routes canvas-push from bridge to browsers", async () => {
    const { hub } = makeHub();
    const bridge = makeMockWs({ kind: "bridge" }) as any;
    const browser = makeMockWs({ kind: "browser" }) as any;

    hub.addBridge(bridge);
    hub.addBrowser(browser);
    await hub.handleMessage(bridge, JSON.stringify({
      type: "register", sessionId: "sess-1", label: "test",
    }));
    await hub.handleMessage(browser, JSON.stringify({
      type: "watch-session", sessionId: "sess-1",
    }));

    await hub.handleMessage(bridge, JSON.stringify({
      type: "canvas-push",
      image: "iVBORw0KGgo=",
      label: "Mockup",
      visible: false,
    }));

    const pushes = sentOfType(browser, "canvas-push");
    expect(pushes.length).toBe(1);
    expect((pushes[0] as any).label).toBe("Mockup");
    expect((pushes[0] as any).sessionId).toBe("sess-1");
  });

  it("routes transcript-status from bridge to browsers", async () => {
    const { hub } = makeHub();
    const bridge = makeMockWs({ kind: "bridge" }) as any;
    const browser = makeMockWs({ kind: "browser" }) as any;

    hub.addBridge(bridge);
    hub.addBrowser(browser);
    await hub.handleMessage(bridge, JSON.stringify({
      type: "register", sessionId: "sess-1", label: "test",
    }));
    await hub.handleMessage(browser, JSON.stringify({
      type: "watch-session", sessionId: "sess-1",
    }));

    await hub.handleMessage(bridge, JSON.stringify({
      type: "transcript-status",
      available: false,
    }));

    const statuses = sentOfType(browser, "transcript-status");
    expect(statuses.length).toBe(1);
    expect((statuses[0] as any).available).toBe(false);
  });

  it("does not route bridge messages to browsers watching a different session", async () => {
    const { hub } = makeHub();
    const bridge = makeMockWs({ kind: "bridge" }) as any;
    const browser = makeMockWs({ kind: "browser" }) as any;

    hub.addBridge(bridge);
    hub.addBrowser(browser);
    await hub.handleMessage(bridge, JSON.stringify({
      type: "register", sessionId: "sess-1", label: "test",
    }));
    await hub.handleMessage(browser, JSON.stringify({
      type: "watch-session", sessionId: "sess-OTHER",
    }));

    await hub.handleMessage(bridge, JSON.stringify({
      type: "transcript-entry",
      entry: { role: "user", type: "message", content: "hello", timestamp: 123 },
    }));

    const entries = sentOfType(browser, "transcript-entry");
    expect(entries.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/server/bridge-routing.test.ts`
Expected: FAIL — `watch-session` not handled, bridge messages not routed

- [ ] **Step 3: Add new message routing to WebSocketHub**

In `server/websocket.ts`, make these changes:

Add a new field to the class (after `private readonly rateBuckets`):

```typescript
private readonly browserWatchSession = new Map<string, string>();
```

In `removeBrowser` method, add this line before `this.rateBuckets.delete`:

```typescript
this.browserWatchSession.delete(ws.data.id);
```

In the `handleMessage` method, add this block after the `if (ws.data.kind === "browser" && msg.type === "submit")` block:

```typescript
if (ws.data.kind === "browser" && msg.type === "watch-session") {
  const sid = msg.sessionId;
  if (typeof sid === "string") {
    this.browserWatchSession.set(ws.data.id, sid);
  }
  return;
}

const BRIDGE_ROUTED_TYPES = ["transcript-entry", "response", "canvas-push", "transcript-status"];
if (ws.data.kind === "bridge" && BRIDGE_ROUTED_TYPES.includes(msg.type)) {
  const sessionId = ws.data.sessionId;
  if (!sessionId) return;
  const payload = JSON.stringify({ ...msg, sessionId });
  for (const [browserId, browser] of this.browsers) {
    if (this.browserWatchSession.get(browserId) === sessionId) {
      safeSend(browser, payload);
    }
  }
  return;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/server/bridge-routing.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run existing server tests to verify no regressions**

Run: `bun test tests/server/`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add server/websocket.ts tests/server/bridge-routing.test.ts
git commit -m "feat(server): route transcript/response/canvas-push from bridges to watching browsers"
```

---

## Task 4: Bridge Bidirectional Integration

**Files:**
- Modify: `bridge/index.ts`

- [ ] **Step 1: Replace bridge/index.ts with bidirectional version**

Replace the full contents of `bridge/index.ts`:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { TranscriptWatcher, discoverTranscriptPath, type TranscriptEntry } from "./transcript-watcher";

// Discover connection info from env or state.json
const stateFile = process.env.TRAYCE_STATE_FILE ?? "/tmp/trayce/state.json";
let host = process.env.TRAYCE_HOST ?? "";
let port = process.env.TRAYCE_PORT ?? "";
let token = process.env.TRAYCE_TOKEN ?? "";

if (existsSync(stateFile)) {
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    if (!token) token = state.token ?? "";
    if (!port && state.port) port = String(state.port);
    if (!host) host = "localhost";
  } catch {
    // state file unreadable — continue with defaults
  }
}

if (!host) host = "localhost";
if (!port) port = "9740";

const label = process.env.TRAYCE_LABEL ?? basename(process.cwd());
const sessionId = crypto.randomUUID();

// MCP Channel server
const mcpServer = new Server(
  { name: "trayce", version: "1.0.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
    },
    instructions: `When you receive a trayce channel notification, read the PNG image at the provided path using the Read tool. The image is a hand-drawn sketch from the user. Treat the accompanying prompt text as the user's request about or relating to the sketch.`,
  }
);

// Handle reverse notifications from Claude (canvas push)
mcpServer.setNotificationHandler("notifications/claude/channel", async (params: any) => {
  const meta = params?.params?.meta;
  if (meta?.type === "canvas-push" && typeof meta.image === "string" && currentWs?.readyState === WebSocket.OPEN) {
    const imageSize = Math.ceil(meta.image.length * 3 / 4);
    if (imageSize <= 20 * 1024 * 1024) {
      currentWs.send(JSON.stringify({
        type: "canvas-push",
        image: meta.image,
        label: typeof meta.label === "string" ? meta.label : `Claude: ${new Date().toLocaleTimeString()}`,
        visible: false,
      }));
    }
  }
});

// WebSocket connection to trayce server
const wsUrl = `ws://${host}:${port}/bridge?token=${encodeURIComponent(token)}`;
let reconnectDelay = 1000;
let currentWs: WebSocket | null = null;
let transcriptWatcher: TranscriptWatcher | null = null;

function startTranscriptWatcher(ws: WebSocket): void {
  const transcriptPath = discoverTranscriptPath(process.cwd());
  if (!transcriptPath) {
    ws.send(JSON.stringify({ type: "transcript-status", available: false }));
    return;
  }

  ws.send(JSON.stringify({ type: "transcript-status", available: true }));

  transcriptWatcher = new TranscriptWatcher(transcriptPath, (entry: TranscriptEntry) => {
    if (ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({ type: "transcript-entry", entry }));

    if (entry.type === "response") {
      ws.send(JSON.stringify({
        type: "response",
        content: entry.content,
        format: "markdown",
        final: true,
      }));
    }
  });

  transcriptWatcher.start();
}

function connect() {
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    reconnectDelay = 1000;
    currentWs = ws;
    ws.send(JSON.stringify({ type: "register", sessionId, label }));
    startTranscriptWatcher(ws);

    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "heartbeat" }));
      } else {
        clearInterval(heartbeat);
      }
    }, 10_000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(String(event.data));
      if (msg.type === "submission") {
        mcpServer.notification({
          method: "notifications/claude/channel",
          params: {
            content: msg.prompt || "[sketch submitted — see attached image]",
            meta: {
              image_path: msg.pngPath,
              submission_id: msg.id,
            },
          },
        });
      }
    } catch {
      // Ignore malformed messages
    }
  };

  ws.onclose = () => {
    currentWs = null;
    transcriptWatcher?.stop();
    transcriptWatcher = null;
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
```

- [ ] **Step 2: Run all bridge and server tests**

Run: `bun test tests/bridge/ tests/server/`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add bridge/index.ts
git commit -m "feat(bridge): add transcript streaming and canvas push reverse channel"
```

---

## Task 5: Client Side Panel Container

**Files:**
- Create: `client/side-panel.ts`
- Modify: `client/index.html`
- Modify: `client/style.css`
- Test: `tests/client/side-panel.test.ts`

- [ ] **Step 1: Write failing tests for side panel**

```typescript
// tests/client/side-panel.test.ts
import { describe, expect, it } from "bun:test";
import { SidePanel } from "../../client/side-panel";

describe("SidePanel", () => {
  it("exports SidePanel class", () => {
    expect(SidePanel).toBeDefined();
  });

  it("tracks active tab state", () => {
    const panel = new SidePanel();
    expect(panel.activeTab).toBe(null);
    panel.setActiveTab("response");
    expect(panel.activeTab).toBe("response");
    panel.setActiveTab("transcript");
    expect(panel.activeTab).toBe("transcript");
  });

  it("toggles open state", () => {
    const panel = new SidePanel();
    expect(panel.isOpen).toBe(false);
    panel.toggle("response");
    expect(panel.isOpen).toBe(true);
    expect(panel.activeTab).toBe("response");
    panel.toggle("response"); // same tab closes
    expect(panel.isOpen).toBe(false);
  });

  it("switches tab without closing when different tab clicked", () => {
    const panel = new SidePanel();
    panel.toggle("response");
    expect(panel.isOpen).toBe(true);
    panel.toggle("transcript");
    expect(panel.isOpen).toBe(true);
    expect(panel.activeTab).toBe("transcript");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/client/side-panel.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement SidePanel class**

```typescript
// client/side-panel.ts

export type PanelTab = "response" | "transcript";

export class SidePanel {
  isOpen = false;
  activeTab: PanelTab | null = null;

  private container: HTMLElement | null = null;
  private tabBar: HTMLElement | null = null;
  private responseContent: HTMLElement | null = null;
  private transcriptContent: HTMLElement | null = null;
  private resizeHandle: HTMLElement | null = null;
  private width = 340;
  private readonly minWidth = 240;
  private onResize: (() => void) | null = null;

  mount(container: HTMLElement, onResize?: () => void): void {
    this.container = container;
    this.onResize = onResize ?? null;
    this.render();
    this.setupResize();
  }

  toggle(tab: PanelTab): void {
    if (this.isOpen && this.activeTab === tab) {
      this.isOpen = false;
      this.activeTab = null;
    } else {
      this.isOpen = true;
      this.activeTab = tab;
    }
    this.updateDOM();
  }

  setActiveTab(tab: PanelTab): void {
    this.activeTab = tab;
    if (this.isOpen) this.updateDOM();
  }

  getResponseContainer(): HTMLElement | null {
    return this.responseContent;
  }

  getTranscriptContainer(): HTMLElement | null {
    return this.transcriptContent;
  }

  private render(): void {
    if (!this.container) return;
    this.container.textContent = "";

    // Resize handle
    this.resizeHandle = document.createElement("div");
    this.resizeHandle.className = "panel-resize-handle";
    this.container.appendChild(this.resizeHandle);

    // Tab bar
    this.tabBar = document.createElement("div");
    this.tabBar.className = "panel-tabs";

    const responseTab = document.createElement("button");
    responseTab.className = "panel-tab";
    responseTab.dataset.tab = "response";
    responseTab.textContent = "Response";
    responseTab.addEventListener("click", () => this.setActiveTab("response"));

    const transcriptTab = document.createElement("button");
    transcriptTab.className = "panel-tab";
    transcriptTab.dataset.tab = "transcript";
    transcriptTab.textContent = "Transcript";
    transcriptTab.addEventListener("click", () => this.setActiveTab("transcript"));

    const closeBtn = document.createElement("button");
    closeBtn.className = "panel-close";
    closeBtn.textContent = "\u2715";
    closeBtn.addEventListener("click", () => {
      this.isOpen = false;
      this.activeTab = null;
      this.updateDOM();
    });

    this.tabBar.appendChild(responseTab);
    this.tabBar.appendChild(transcriptTab);
    this.tabBar.appendChild(closeBtn);
    this.container.appendChild(this.tabBar);

    // Content areas
    this.responseContent = document.createElement("div");
    this.responseContent.className = "panel-content response-content";

    this.transcriptContent = document.createElement("div");
    this.transcriptContent.className = "panel-content transcript-content";

    this.container.appendChild(this.responseContent);
    this.container.appendChild(this.transcriptContent);

    this.updateDOM();
  }

  private updateDOM(): void {
    if (!this.container) return;

    if (this.isOpen) {
      this.container.classList.add("open");
      this.container.style.width = `${this.width}px`;
    } else {
      this.container.classList.remove("open");
      this.container.style.width = "0";
    }

    const tabs = this.tabBar?.querySelectorAll(".panel-tab") ?? [];
    for (const tab of tabs) {
      const t = tab as HTMLElement;
      t.classList.toggle("active", t.dataset.tab === this.activeTab);
    }

    if (this.responseContent) {
      this.responseContent.style.display = this.activeTab === "response" ? "block" : "none";
    }
    if (this.transcriptContent) {
      this.transcriptContent.style.display = this.activeTab === "transcript" ? "block" : "none";
    }

    this.onResize?.();
  }

  private setupResize(): void {
    if (!this.resizeHandle || !this.container) return;

    let startX = 0;
    let startWidth = 0;

    const onMouseMove = (e: MouseEvent) => {
      const delta = startX - e.clientX;
      const maxWidth = window.innerWidth * 0.5;
      this.width = Math.max(this.minWidth, Math.min(maxWidth, startWidth + delta));
      if (this.container) this.container.style.width = `${this.width}px`;
      this.onResize?.();
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    this.resizeHandle.addEventListener("mousedown", (e) => {
      startX = e.clientX;
      startWidth = this.width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }
}
```

- [ ] **Step 4: Add side panel HTML to index.html**

In `client/index.html`, after the `</aside>` closing tag for `#right-panel`, add:

```html
    <!-- Side Panel (response + transcript) -->
    <aside id="side-panel"></aside>
```

- [ ] **Step 5: Add side panel styles to style.css**

In `client/style.css`, change the `#main` grid rule from:

```css
grid-template-columns: var(--toolbar-width) 1fr var(--panel-width);
```

to:

```css
grid-template-columns: var(--toolbar-width) 1fr var(--panel-width) auto;
```

Then append the full set of side panel CSS (see spec file `client/style.css` additions in the File Map — the complete CSS is listed in the spec at `docs/superpowers/specs/2026-03-27-bidirectional-and-panels-design.md` under "Client: Side Panel"). The CSS covers: `#side-panel`, `.panel-resize-handle`, `.panel-tabs`, `.panel-tab`, `.panel-close`, `.panel-content`, `.response-content` markdown styles, `.canvas-push-notification`, `.transcript-content` entry styles, `.tool-call`, `.tool-detail`, `.no-transcript`, and `.panel-toggle`.

Refer to the full CSS block in Task 5 of the original plan draft for the exact rules to append.

- [ ] **Step 6: Run tests**

Run: `bun test tests/client/side-panel.test.ts`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add client/side-panel.ts client/index.html client/style.css tests/client/side-panel.test.ts
git commit -m "feat(client): add side panel container with tabs, resize, and styling"
```

---

## Task 6: Response Tab Renderer

**Files:**
- Create: `client/response-tab.ts`

- [ ] **Step 1: Implement the response tab renderer**

```typescript
// client/response-tab.ts
import { renderMarkdown } from "./markdown";

export class ResponseTab {
  private container: HTMLElement | null = null;
  private autoScroll = true;

  mount(container: HTMLElement): void {
    this.container = container;
    this.container.addEventListener("scroll", () => {
      const el = this.container!;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
      this.autoScroll = atBottom;
    });
  }

  addResponse(content: string): void {
    if (!this.container) return;

    const block = document.createElement("div");
    block.className = "msg-block";

    const label = document.createElement("div");
    label.className = "msg-label";
    label.textContent = "Claude";
    block.appendChild(label);

    const body = document.createElement("div");
    body.className = "msg-body";
    // renderMarkdown escapes all HTML before rendering
    body.innerHTML = renderMarkdown(content);
    block.appendChild(body);

    this.container.appendChild(block);
    this.scrollToBottom();
  }

  addCanvasPushNotification(imageBase64: string, layerLabel: string): void {
    if (!this.container) return;

    const notification = document.createElement("div");
    notification.className = "canvas-push-notification";

    const img = document.createElement("img");
    img.src = `data:image/png;base64,${imageBase64}`;
    notification.appendChild(img);

    const text = document.createElement("span");
    text.textContent = `Image received \u2014 added as hidden layer "${layerLabel}"`;
    notification.appendChild(text);

    this.container.appendChild(notification);
    this.scrollToBottom();
  }

  showUnavailable(): void {
    if (!this.container) return;
    this.container.textContent = "";
    const msg = document.createElement("div");
    msg.className = "no-transcript";
    msg.textContent = "No transcript available for this session.";
    this.container.appendChild(msg);
  }

  clear(): void {
    if (this.container) this.container.textContent = "";
  }

  private scrollToBottom(): void {
    if (this.autoScroll && this.container) {
      this.container.scrollTop = this.container.scrollHeight;
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/response-tab.ts
git commit -m "feat(client): add response tab with markdown rendering and canvas-push notifications"
```

---

## Task 7: Transcript Tab Renderer

**Files:**
- Create: `client/transcript-tab.ts`

- [ ] **Step 1: Implement the transcript tab renderer**

```typescript
// client/transcript-tab.ts
import { renderMarkdown } from "./markdown";

interface TranscriptEntry {
  type: "message" | "response" | "tool-call" | "tool-result";
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  toolName?: string;
  toolInput?: string;
  toolUseId?: string;
}

export class TranscriptTab {
  private container: HTMLElement | null = null;
  private autoScroll = true;
  private toolCallElements = new Map<string, HTMLElement>();

  mount(container: HTMLElement): void {
    this.container = container;
    this.container.addEventListener("scroll", () => {
      const el = this.container!;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
      this.autoScroll = atBottom;
    });
  }

  addEntry(entry: TranscriptEntry): void {
    if (!this.container) return;

    if (entry.type === "message" || entry.type === "response") {
      this.addMessage(entry.role, entry.content);
    } else if (entry.type === "tool-call") {
      this.addToolCall(entry);
    } else if (entry.type === "tool-result") {
      this.addToolResult(entry);
    }

    this.scrollToBottom();
  }

  showUnavailable(): void {
    if (!this.container) return;
    this.container.textContent = "";
    const msg = document.createElement("div");
    msg.className = "no-transcript";
    msg.textContent = "No transcript available for this session.";
    this.container.appendChild(msg);
  }

  clear(): void {
    if (this.container) this.container.textContent = "";
    this.toolCallElements.clear();
  }

  private addMessage(role: string, content: string): void {
    if (!this.container) return;

    const entry = document.createElement("div");
    entry.className = "entry";

    const label = document.createElement("div");
    label.className = `entry-label ${role}`;
    label.textContent = role === "user" ? "You" : "Claude";
    entry.appendChild(label);

    const body = document.createElement("div");
    body.className = "entry-body";
    if (role === "assistant") {
      // renderMarkdown escapes all HTML before rendering
      body.innerHTML = renderMarkdown(content);
    } else {
      body.textContent = content;
    }
    entry.appendChild(body);

    this.container.appendChild(entry);
  }

  private addToolCall(entry: TranscriptEntry): void {
    if (!this.container) return;

    const wrapper = document.createElement("div");
    wrapper.className = "entry";

    const summary = document.createElement("div");
    summary.className = "tool-call";

    const toolName = document.createElement("span");
    toolName.className = "tool-name";
    toolName.textContent = entry.toolName ?? "Tool";
    summary.appendChild(toolName);

    const toolSummary = document.createElement("span");
    toolSummary.className = "tool-summary";
    toolSummary.textContent = this.summarizeToolInput(entry.toolName ?? "", entry.toolInput ?? "");
    summary.appendChild(toolSummary);

    wrapper.appendChild(summary);

    const detail = document.createElement("div");
    detail.className = "tool-detail";
    detail.textContent = entry.toolInput ?? "";
    wrapper.appendChild(detail);

    summary.addEventListener("click", () => {
      detail.classList.toggle("expanded");
    });

    if (entry.toolUseId) {
      this.toolCallElements.set(entry.toolUseId, detail);
    }

    this.container.appendChild(wrapper);
  }

  private addToolResult(entry: TranscriptEntry): void {
    if (entry.toolUseId) {
      const detail = this.toolCallElements.get(entry.toolUseId);
      if (detail) {
        const resultSection = document.createElement("div");
        resultSection.style.marginTop = "8px";
        resultSection.style.borderTop = "1px solid var(--border)";
        resultSection.style.paddingTop = "8px";

        const truncated = entry.content.length > 2000;
        resultSection.textContent = truncated
          ? entry.content.slice(0, 2000)
          : entry.content;

        if (truncated) {
          const fullContent = entry.content;
          const showAll = document.createElement("button");
          showAll.textContent = "Show all";
          showAll.style.cssText = "background:none;border:1px solid var(--border);color:var(--accent);padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;margin-top:4px;display:block;";
          showAll.addEventListener("click", () => {
            resultSection.textContent = fullContent;
          });
          resultSection.appendChild(showAll);
        }

        detail.appendChild(resultSection);
        return;
      }
    }

    // Orphan tool result
    if (!this.container) return;
    const el = document.createElement("div");
    el.className = "entry";
    const body = document.createElement("div");
    body.className = "tool-detail expanded";
    body.textContent = entry.content.slice(0, 500);
    el.appendChild(body);
    this.container.appendChild(el);
  }

  private summarizeToolInput(toolName: string, input: string): string {
    try {
      const parsed = JSON.parse(input);
      if (toolName === "Read" && parsed.file_path) return parsed.file_path;
      if (toolName === "Bash" && parsed.command) return parsed.command.slice(0, 80);
      if (toolName === "Grep" && parsed.pattern) return `/${parsed.pattern}/`;
      if (toolName === "Glob" && parsed.pattern) return parsed.pattern;
      if (toolName === "Edit" && parsed.file_path) return parsed.file_path;
      if (toolName === "Write" && parsed.file_path) return parsed.file_path;
    } catch {
      // not JSON
    }
    return input.slice(0, 60);
  }

  private scrollToBottom(): void {
    if (this.autoScroll && this.container) {
      this.container.scrollTop = this.container.scrollHeight;
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/transcript-tab.ts
git commit -m "feat(client): add transcript tab with collapsible tool calls"
```

---

## Task 8: Wire Everything Together in app.ts and toolbar.ts

**Files:**
- Modify: `client/app.ts`
- Modify: `client/toolbar.ts`

- [ ] **Step 1: Add panel toggle buttons to toolbar**

In `client/toolbar.ts`:

Add `PanelId` type export and update `ToolbarConfig`:

```typescript
export type PanelId = "response" | "transcript";

export interface ToolbarConfig {
  onToolChange: (toolId: ToolId) => void;
  onAction: (actionId: ActionId) => void;
  onPanelToggle?: (panelId: PanelId) => void;
}
```

Add panel button definitions after `ACTIONS`:

```typescript
const PANEL_BUTTONS: Array<{ id: PanelId; icon: string; title: string }> = [
  { id: "response", icon: "\uD83D\uDCAC", title: "Response Panel" },
  { id: "transcript", icon: "\uD83D\uDCDC", title: "Transcript Panel" },
];
```

Add `panelButtons` field and `setPanelActive` method to the `Toolbar` class:

```typescript
private panelButtons = new Map<PanelId, HTMLButtonElement>();

setPanelActive(id: PanelId | null): void {
  for (const [pid, btn] of this.panelButtons) {
    btn.classList.toggle("active", pid === id);
  }
}
```

At the end of the `render` method, after the action buttons loop, add:

```typescript
// Panel toggle buttons
const panelSep = document.createElement("div");
panelSep.className = "separator";
this.container.appendChild(panelSep);

for (const panel of PANEL_BUTTONS) {
  const btn = document.createElement("button");
  btn.textContent = panel.icon;
  btn.title = panel.title;
  btn.className = "panel-toggle";
  btn.dataset.panel = panel.id;
  btn.addEventListener("click", () => this.config.onPanelToggle?.(panel.id));
  this.container.appendChild(btn);
  this.panelButtons.set(panel.id, btn);
}
```

- [ ] **Step 2: Wire side panel and new message types in app.ts**

Add imports at the top of `client/app.ts`:

```typescript
import { SidePanel } from "./side-panel";
import { ResponseTab } from "./response-tab";
import { TranscriptTab } from "./transcript-tab";
```

Add state after existing state block:

```typescript
let sidePanel: SidePanel | null = null;
let responseTab: ResponseTab | null = null;
let transcriptTab: TranscriptTab | null = null;
```

In `initUIComponents`, after color picker init, add:

```typescript
// Side panel
const sidePanelEl = document.getElementById("side-panel")!;
sidePanel = new SidePanel();
sidePanel.mount(sidePanelEl, () => {
  canvasManager?.resize();
});

responseTab = new ResponseTab();
transcriptTab = new TranscriptTab();
```

Update the `Toolbar` constructor call to add `onPanelToggle`:

```typescript
onPanelToggle: (panelId) => {
  sidePanel?.toggle(panelId);
  toolbar?.setPanelActive(sidePanel?.isOpen ? sidePanel.activeTab : null);

  if (sidePanel?.isOpen) {
    const responseContainer = sidePanel.getResponseContainer();
    const transcriptContainer = sidePanel.getTranscriptContainer();
    if (responseContainer && responseTab && !responseContainer.dataset.mounted) {
      responseTab.mount(responseContainer);
      responseContainer.dataset.mounted = "true";
    }
    if (transcriptContainer && transcriptTab && !transcriptContainer.dataset.mounted) {
      transcriptTab.mount(transcriptContainer);
      transcriptContainer.dataset.mounted = "true";
    }
  }
},
```

Replace `handleServerMessage` with:

```typescript
function handleServerMessage(msg: ServerMessage): void {
  if (msg.type === "sessions") {
    sessions = msg.sessions as typeof sessions;
    updateSessionSelect();
  } else if (msg.type === "ack") {
    showToast("Submitted!");
  } else if (msg.type === "error") {
    showToast(`Error: ${msg.message}`);
  } else if (msg.type === "response") {
    responseTab?.addResponse(msg.content as string);
  } else if (msg.type === "transcript-entry") {
    transcriptTab?.addEntry(msg.entry as any);
  } else if (msg.type === "canvas-push") {
    handleCanvasPush(msg);
  } else if (msg.type === "transcript-status") {
    if (!(msg as any).available) {
      responseTab?.showUnavailable();
      transcriptTab?.showUnavailable();
    }
  }
}
```

Add `handleCanvasPush` function:

```typescript
function handleCanvasPush(msg: ServerMessage): void {
  if (!layerManager || !compositor) return;

  const image = msg.image as string;
  const label = (msg.label as string) || `Claude: ${new Date().toLocaleTimeString()}`;

  try {
    const layer = layerManager.addLayer(label);
    layer.visible = false;

    const imgElement = new Image();
    imgElement.onload = () => {
      const sw = Math.min(imgElement.width, layerManager!.docWidth);
      const sh = Math.min(imgElement.height, layerManager!.docHeight);
      layer.ctx.drawImage(imgElement, 0, 0, sw, sh);
      compositor?.markDirty();
      layersUI?.render();
      updateLayerInfo();
    };
    imgElement.src = `data:image/png;base64,${image}`;

    responseTab?.addCanvasPushNotification(image, label);
    showToast(`Image received as hidden layer "${label}"`);
  } catch {
    showToast("Failed to add image layer");
  }
}
```

In the `sessionSelect` change listener, add after existing code:

```typescript
// Tell server which session to watch for transcript/response data
connection?.send({ type: "watch-session", sessionId: selectedSessionId });
responseTab?.clear();
transcriptTab?.clear();
```

In `updateSessionSelect`, after `selectedSessionId` is set, add:

```typescript
if (selectedSessionId) {
  connection?.send({ type: "watch-session", sessionId: selectedSessionId });
}
```

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 4: Build client and verify**

Run: `bun run build:client`
Expected: Build succeeds with no errors

- [ ] **Step 5: Commit**

```bash
git add client/app.ts client/toolbar.ts
git commit -m "feat(client): wire side panel, response tab, transcript tab, and canvas push handler"
```

---

## Task 9: Integration Smoke Test

- [ ] **Step 1: Run all tests**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 2: Build client**

Run: `bun run build:client`
Expected: Build succeeds

- [ ] **Step 3: Start server and verify UI loads**

Run: `bun run start`

Open the printed URL in a browser. Verify:
1. Canvas loads and drawing works
2. Toolbar shows panel toggle buttons at the bottom
3. Clicking the response icon opens the side panel with Response tab
4. Clicking the transcript icon switches to Transcript tab
5. Clicking the same icon again closes the panel
6. Panel is resizable by dragging the left edge
7. Close button works

- [ ] **Step 4: Commit final state**

```bash
git add -A
git commit -m "feat: complete bidirectional communication and side panel implementation"
```
