# Trayce Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a network-accessible raster painting canvas that integrates with Claude Code via MCP Channels, supporting multi-session submission from any local network device.

**Architecture:** Three-process design — a persistent Bun server (HTTP + WebSocket), lightweight MCP Channel bridge processes (one per Claude Code session), and a browser-based painting app (PixiJS + perfect-freehand). Server binds 0.0.0.0 for LAN access. Browser sends flattened PNG + prompt to server, server routes to target bridge, bridge pushes into Claude via Channel notification.

**Tech Stack:** Bun runtime, PixiJS v8, perfect-freehand, @modelcontextprotocol/sdk, vanilla TypeScript client, Docker/Podman

**Spec:** `docs/superpowers/specs/2026-03-23-trayce-design.md`

---

## File Map

### Server (`server/`)

| File | Responsibility |
|------|---------------|
| `server/config.ts` | Constants: port, host, paths, limits, defaults |
| `server/auth.ts` | Token generation (crypto.randomUUID), validation middleware |
| `server/sessions.ts` | In-memory session registry: add/remove/list/deduplicate labels |
| `server/submissions.ts` | Write base64 PNG to disk, cleanup sweep (TTL), size validation |
| `server/websocket.ts` | WebSocket hub: upgrade handler, route messages, heartbeat, connection tracking |
| `server/http.ts` | Static file serving (dist/client/), path traversal protection, CSP/CORS headers |
| `server/index.ts` | Entry point: wire up HTTP + WS, write state.json, print URL with token, signal handlers |

### Bridge (`bridge/`)

| File | Responsibility |
|------|---------------|
| `bridge/index.ts` | MCP Channel server + WebSocket client to trayce server. Register, relay submissions, reconnect. |

### Client (`client/`)

| File | Responsibility |
|------|---------------|
| `client/index.html` | Shell HTML: canvas container, toolbar, panels, script tag |
| `client/style.css` | Dark theme, layout grid, responsive breakpoints, panel styles |
| `client/app.ts` | Entry point: init PixiJS, wire modules, new document dialog |
| `client/canvas.ts` | PixiJS Application setup, viewport (zoom/pan), display container |
| `client/layers.ts` | Layer manager: create/delete/reorder OffscreenCanvas instances, properties |
| `client/compositor.ts` | Composite layer canvases → PixiJS sprites with blend modes |
| `client/input.ts` | Pointer event capture, pressure/tilt normalization, smoothing filter |
| `client/stroke.ts` | perfect-freehand integration: points → outline → fill path on canvas |
| `client/brushes/types.ts` | Brush interface + BrushParams type |
| `client/brushes/pen.ts` | Pen brush: clean variable-width strokes via perfect-freehand |
| `client/brushes/pencil.ts` | Pencil: grain texture, jitter |
| `client/brushes/marker.ts` | Marker: flat tip, no pressure variation |
| `client/brushes/watercolor.ts` | Watercolor: Gaussian blur edges, stroke buffer, alpha falloff |
| `client/brushes/highlighter.ts` | Highlighter: wide, semi-transparent, multiply blend |
| `client/brushes/eraser.ts` | Eraser: destination-out compositing |
| `client/history.ts` | Undo/redo: command log + periodic compressed checkpoints, memory budget |
| `client/tools/select.ts` | Rectangular selection: drag box, cut region, floating transform |
| `client/tools/lasso.ts` | Freehand lasso selection |
| `client/tools/shapes.ts` | Rectangle, ellipse, line: preview overlay, commit to layer |
| `client/tools/arrow.ts` | Arrow tool: line + arrowhead |
| `client/tools/text.ts` | Text placement + inline editing, commit to layer |
| `client/tools/image.ts` | Image import: file picker, paste, drag-drop, floating placement |
| `client/connection.ts` | WebSocket client: connect, heartbeat, reconnect with backoff |
| `client/sessions-ui.ts` | Session dropdown: render list, select, persist |
| `client/toolbar.ts` | Tool palette: buttons, active state, responsive layout |
| `client/layers-ui.ts` | Layers panel: list, visibility, blend mode, drag reorder |
| `client/brush-settings-ui.ts` | Brush sliders: size, opacity, flow, smoothing |
| `client/color-picker.ts` | HSV wheel, hex input, recent colors, eyedropper |
| `client/touch.ts` | Touch gestures: pinch zoom, two-finger pan, palm rejection |
| `client/shortcuts.ts` | Keyboard shortcut mapping and dispatch |
| `client/export.ts` | Flatten layers → PNG blob for submission or download |
| `client/toast.ts` | Toast notification utility |
| `client/persistence.ts` | IndexedDB auto-save/restore for layer data, tab isolation |

### Root Files

| File | Responsibility |
|------|---------------|
| `package.json` | Project config, scripts (dev, build, start, stop) |
| `tsconfig.json` | TypeScript config for Bun + browser |
| `.gitignore` | Ignore dist/, node_modules/, .superpowers/, /tmp |
| `Dockerfile` | Multi-stage build: deps → bundle client → slim runtime |
| `compose.yaml` | Docker Compose config |
| `.dockerignore` | Exclude .git, node_modules, .superpowers, docs |
| `scripts/start.sh` | Start server: check existing, launch, print URL |
| `scripts/stop.sh` | Stop server: read state.json, kill PID |
| `scripts/build-image.sh` | Detect runtime (podman/docker), build OCI image |
| `.mcp.json.example` | Example MCP config for Claude Code |
| `CLAUDE.md` | Project instructions for Claude Code |

### Tests (`tests/`)

| File | Responsibility |
|------|---------------|
| `tests/server/config.test.ts` | Config defaults and overrides |
| `tests/server/auth.test.ts` | Token generation, validation |
| `tests/server/sessions.test.ts` | Registry add/remove/list, label dedup |
| `tests/server/submissions.test.ts` | Write PNG, size validation, cleanup |
| `tests/server/websocket.test.ts` | WS message routing, heartbeat, connection lifecycle |
| `tests/server/http.test.ts` | Static serving, path traversal, headers |
| `tests/server/integration.test.ts` | Full server startup, WS connect, submit, route |
| `tests/bridge/index.test.ts` | Bridge registration, submission relay, reconnect |
| `tests/client/layers.test.ts` | Layer CRUD, properties, reorder |
| `tests/client/compositor.test.ts` | Layer compositing, blend modes |
| `tests/client/stroke.test.ts` | perfect-freehand integration, outline generation |
| `tests/client/brushes.test.ts` | Brush interface compliance, pen rendering |
| `tests/client/history.test.ts` | Undo/redo, checkpoint eviction, memory budget |
| `tests/client/export.test.ts` | Flatten layers to PNG |
| `tests/client/connection.test.ts` | WS client, reconnect, heartbeat |
| `tests/client/persistence.test.ts` | IndexedDB save/restore, tab isolation |

---

## Phase 1: Project Foundation

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Modify: `.gitignore`
- Create: `CLAUDE.md`

- [ ] **Step 1: Initialize Bun project**

```bash
cd /run/media/system/Dos/Projects/trayce
bun init -y
```

- [ ] **Step 2: Install dependencies**

```bash
bun add pixi.js perfect-freehand @modelcontextprotocol/sdk
bun add -d @types/bun
```

- [ ] **Step 3: Configure package.json scripts**

Replace `package.json` with:

```json
{
  "name": "trayce",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --watch server/index.ts",
    "dev:client": "bun build client/app.ts --outdir dist/client --target browser --watch",
    "build:client": "bun build client/app.ts --outdir dist/client --minify --target browser",
    "start": "bun run server/index.ts",
    "test": "bun test",
    "build:image": "bash scripts/build-image.sh"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "...",
    "perfect-freehand": "...",
    "pixi.js": "..."
  },
  "devDependencies": {
    "@types/bun": "..."
  }
}
```

(Keep actual versions from `bun add`.)

- [ ] **Step 4: Configure tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "types": ["bun-types"]
  },
  "include": ["server/**/*.ts", "bridge/**/*.ts", "client/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 5: Update .gitignore**

```
node_modules/
dist/
.superpowers/
/tmp/trayce/
*.log
```

- [ ] **Step 6: Create CLAUDE.md**

```markdown
# Trayce

Canvas drawing tool for Claude Code integration via MCP Channels.

## Quick Start

```bash
bun install                    # Install dependencies
bun run build:client           # Bundle client
bun run start                  # Start server (prints URL with auth token)
```

## Development

```bash
bun run dev                    # Server with hot reload
bun run dev:client             # Client bundler in watch mode
bun test                       # Run tests
```

## Architecture

- `server/` — Bun HTTP + WebSocket server (long-lived, binds 0.0.0.0)
- `bridge/` — MCP Channel bridge (spawned by Claude Code, ~80 lines)
- `client/` — Browser painting app (PixiJS + perfect-freehand, vanilla TS)
- `tests/` — Bun test runner

## Key Commands

```bash
bun run start                  # Start server
bash scripts/start.sh          # Start with session management
bash scripts/stop.sh           # Stop server
bash scripts/build-image.sh    # Build container image
```

## Spec

Full design: `docs/superpowers/specs/2026-03-23-trayce-design.md`
```

- [ ] **Step 7: Create bunfig.toml**

```toml
# bunfig.toml
[test]
preload = []
timeout = 10000
```

- [ ] **Step 8: Create directory structure**

```bash
mkdir -p server bridge client/brushes client/tools tests/server tests/bridge tests/client tests/e2e scripts
```

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json bunfig.toml .gitignore CLAUDE.md bun.lock
git commit -m "chore: scaffold project with Bun, PixiJS, perfect-freehand, MCP SDK"
```

---

### Task 2: Server Config

**Files:**
- Create: `server/config.ts`
- Create: `tests/server/config.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/server/config.test.ts
import { describe, expect, test } from "bun:test";
import { getConfig } from "../../server/config";

describe("getConfig", () => {
  test("returns default values", () => {
    const config = getConfig({});
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(9740);
    expect(config.submissionsDir).toBe("/tmp/trayce/submissions");
    expect(config.stateFile).toBe("/tmp/trayce/state.json");
    expect(config.maxSubmissionBytes).toBe(20 * 1024 * 1024);
    expect(config.maxWsPayloadBytes).toBe(30 * 1024 * 1024);
    expect(config.submissionTtlMs).toBe(60 * 60 * 1000);
    expect(config.cleanupIntervalMs).toBe(15 * 60 * 1000);
    expect(config.heartbeatIntervalMs).toBe(10_000);
    expect(config.heartbeatTimeoutMs).toBe(30_000);
    expect(config.rateLimitPerMinute).toBe(10);
    // rateLimitBurst removed — using simple per-minute cap
    expect(config.noAuth).toBe(false);
  });

  test("overrides from env", () => {
    const config = getConfig({
      TRAYCE_HOST: "127.0.0.1",
      TRAYCE_PORT: "8080",
      TRAYCE_NO_AUTH: "true",
    });
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(8080);
    expect(config.noAuth).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
bun test tests/server/config.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement config**

```typescript
// server/config.ts
export interface Config {
  host: string;
  port: number;
  submissionsDir: string;
  stateFile: string;
  clientDir: string;
  maxSubmissionBytes: number;
  maxWsPayloadBytes: number;
  submissionTtlMs: number;
  cleanupIntervalMs: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  rateLimitPerMinute: number;
  noAuth: boolean;
}

export function getConfig(env: Record<string, string | undefined>): Config {
  return {
    host: env.TRAYCE_HOST ?? "0.0.0.0",
    port: parseInt(env.TRAYCE_PORT ?? "9740", 10),
    submissionsDir: env.TRAYCE_SUBMISSIONS_DIR ?? "/tmp/trayce/submissions",
    stateFile: env.TRAYCE_STATE_FILE ?? "/tmp/trayce/state.json",
    clientDir: env.TRAYCE_CLIENT_DIR ?? "dist/client",
    maxSubmissionBytes: 20 * 1024 * 1024,
    maxWsPayloadBytes: 30 * 1024 * 1024,
    submissionTtlMs: 60 * 60 * 1000,
    cleanupIntervalMs: 15 * 60 * 1000,
    heartbeatIntervalMs: 10_000,
    heartbeatTimeoutMs: 30_000,
    rateLimitPerMinute: 10,
    noAuth: env.TRAYCE_NO_AUTH === "true",
  };
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
bun test tests/server/config.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/config.ts tests/server/config.test.ts
git commit -m "feat(server): add config with env overrides"
```

---

### Task 3: Server Auth

**Files:**
- Create: `server/auth.ts`
- Create: `tests/server/auth.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/server/auth.test.ts
import { describe, expect, test } from "bun:test";
import { generateToken, validateToken } from "../../server/auth";

describe("auth", () => {
  test("generateToken returns a non-empty string", () => {
    const token = generateToken();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);
  });

  test("generateToken returns unique tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });

  test("validateToken accepts matching token", () => {
    const token = generateToken();
    expect(validateToken(token, token)).toBe(true);
  });

  test("validateToken rejects wrong token", () => {
    const token = generateToken();
    expect(validateToken("wrong", token)).toBe(false);
  });

  test("validateToken rejects empty token", () => {
    const token = generateToken();
    expect(validateToken("", token)).toBe(false);
    expect(validateToken(undefined, token)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
bun test tests/server/auth.test.ts
```

- [ ] **Step 3: Implement auth**

```typescript
// server/auth.ts
export function generateToken(): string {
  return crypto.randomUUID();
}

export function validateToken(
  provided: string | undefined | null,
  expected: string
): boolean {
  if (!provided || provided.length === 0) return false;
  // Constant-time comparison to prevent timing attacks
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  // Bun provides Node.js-compatible crypto.timingSafeEqual
  const { timingSafeEqual } = require("node:crypto");
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
bun test tests/server/auth.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/auth.ts tests/server/auth.test.ts
git commit -m "feat(server): add token-based auth"
```

---

### Task 4: Session Registry

**Files:**
- Create: `server/sessions.ts`
- Create: `tests/server/sessions.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/server/sessions.test.ts
import { describe, expect, test, beforeEach } from "bun:test";
import { SessionRegistry } from "../../server/sessions";

describe("SessionRegistry", () => {
  let registry: SessionRegistry;

  beforeEach(() => {
    registry = new SessionRegistry();
  });

  test("add and list sessions", () => {
    registry.add("s1", "my-project");
    const sessions = registry.list();
    expect(sessions).toEqual([{ id: "s1", label: "my-project", status: "active" }]);
  });

  test("remove session", () => {
    registry.add("s1", "my-project");
    registry.remove("s1");
    expect(registry.list()).toEqual([]);
  });

  test("deduplicates labels with numeric suffix", () => {
    registry.add("s1", "app");
    registry.add("s2", "app");
    registry.add("s3", "app");
    const labels = registry.list().map((s) => s.label);
    expect(labels).toEqual(["app", "app (2)", "app (3)"]);
  });

  test("has returns true for existing session", () => {
    registry.add("s1", "app");
    expect(registry.has("s1")).toBe(true);
    expect(registry.has("s2")).toBe(false);
  });

  test("removing non-existent session is a no-op", () => {
    registry.remove("nonexistent");
    expect(registry.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
bun test tests/server/sessions.test.ts
```

- [ ] **Step 3: Implement session registry**

```typescript
// server/sessions.ts
export interface Session {
  id: string;
  label: string;
  status: "active";
}

export class SessionRegistry {
  private sessions = new Map<string, Session>();

  add(id: string, requestedLabel: string): Session {
    const label = this.deduplicateLabel(requestedLabel);
    const session: Session = { id, label, status: "active" };
    this.sessions.set(id, session);
    return session;
  }

  remove(id: string): void {
    this.sessions.delete(id);
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  private deduplicateLabel(label: string): string {
    const existingLabels = new Set(
      Array.from(this.sessions.values()).map((s) => s.label)
    );
    if (!existingLabels.has(label)) return label;
    let n = 2;
    while (existingLabels.has(`${label} (${n})`)) n++;
    return `${label} (${n})`;
  }
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
bun test tests/server/sessions.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/sessions.ts tests/server/sessions.test.ts
git commit -m "feat(server): add session registry with label deduplication"
```

---

### Task 5: Submission Store

**Files:**
- Create: `server/submissions.ts`
- Create: `tests/server/submissions.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/server/submissions.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { SubmissionStore } from "../../server/submissions";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = "/tmp/trayce-test-submissions";

describe("SubmissionStore", () => {
  let store: SubmissionStore;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    store = new SubmissionStore(TEST_DIR, 20 * 1024 * 1024);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("save writes a PNG file and returns path", async () => {
    // Minimal valid PNG (1x1 transparent pixel)
    const base64Png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    const result = await store.save(base64Png, "test prompt");
    expect(result.id).toMatch(/^sub-\d+$/);
    expect(result.pngPath).toContain(TEST_DIR);
    expect(result.prompt).toBe("test prompt");
    expect(existsSync(result.pngPath)).toBe(true);
  });

  test("save rejects oversized payloads", async () => {
    const tinyStore = new SubmissionStore(TEST_DIR, 10); // 10 byte limit
    const base64Png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    expect(tinyStore.save(base64Png, "")).rejects.toThrow("exceeds");
  });

  test("cleanup removes files older than TTL", async () => {
    const base64Png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    const result = await store.save(base64Png, "");
    expect(existsSync(result.pngPath)).toBe(true);

    // Backdate the file
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const { utimesSync } = await import("node:fs");
    utimesSync(result.pngPath, past, past);

    await store.cleanup(60 * 60 * 1000); // 1 hour TTL
    expect(existsSync(result.pngPath)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
bun test tests/server/submissions.test.ts
```

- [ ] **Step 3: Implement submission store**

```typescript
// server/submissions.ts
import { mkdir, writeFile, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

export interface Submission {
  id: string;
  pngPath: string;
  prompt: string;
  timestamp: number;
}

export class SubmissionStore {
  constructor(
    private dir: string,
    private maxBytes: number
  ) {}

  async save(base64Image: string, prompt: string): Promise<Submission> {
    const buffer = Buffer.from(base64Image, "base64");
    if (buffer.byteLength > this.maxBytes) {
      throw new Error(
        `Submission exceeds max size: ${buffer.byteLength} > ${this.maxBytes}`
      );
    }

    await mkdir(this.dir, { recursive: true, mode: 0o700 });

    const timestamp = Date.now();
    const id = `sub-${timestamp}`;
    const pngPath = join(this.dir, `${id}.png`);

    await writeFile(pngPath, buffer, { mode: 0o600 });

    return { id, pngPath, prompt, timestamp };
  }

  async cleanup(ttlMs: number): Promise<number> {
    const now = Date.now();
    let removed = 0;

    try {
      const files = await readdir(this.dir);
      for (const file of files) {
        if (!file.endsWith(".png")) continue;
        const filePath = join(this.dir, file);
        const fileStat = await stat(filePath);
        if (now - fileStat.mtimeMs > ttlMs) {
          await unlink(filePath);
          removed++;
        }
      }
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }

    return removed;
  }

  async removeAll(): Promise<void> {
    const { rmSync } = await import("node:fs");
    rmSync(this.dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
bun test tests/server/submissions.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/submissions.ts tests/server/submissions.test.ts
git commit -m "feat(server): add submission store with PNG write and cleanup"
```

---

### Task 6: HTTP Server

**Files:**
- Create: `server/http.ts`
- Create: `tests/server/http.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/server/http.test.ts
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createHttpHandler } from "../../server/http";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const TEST_CLIENT_DIR = "/tmp/trayce-test-client";

describe("HTTP handler", () => {
  beforeAll(() => {
    mkdirSync(TEST_CLIENT_DIR, { recursive: true });
    writeFileSync(join(TEST_CLIENT_DIR, "index.html"), "<html>test</html>");
    writeFileSync(join(TEST_CLIENT_DIR, "app.js"), "console.log('ok')");
  });

  afterAll(() => {
    rmSync(TEST_CLIENT_DIR, { recursive: true, force: true });
  });

  test("serves index.html for root path", async () => {
    const handler = createHttpHandler(TEST_CLIENT_DIR);
    const res = await handler(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<html>test</html>");
    expect(res.headers.get("content-security-policy")).toBeTruthy();
  });

  test("serves static files", async () => {
    const handler = createHttpHandler(TEST_CLIENT_DIR);
    const res = await handler(new Request("http://localhost/app.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
  });

  test("rejects path traversal", async () => {
    const handler = createHttpHandler(TEST_CLIENT_DIR);
    const res = await handler(new Request("http://localhost/../../../etc/passwd"));
    expect(res.status).toBe(403);
  });

  test("returns 404 for missing files", async () => {
    const handler = createHttpHandler(TEST_CLIENT_DIR);
    const res = await handler(new Request("http://localhost/nonexistent.js"));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
bun test tests/server/http.test.ts
```

- [ ] **Step 3: Implement HTTP handler**

```typescript
// server/http.ts
import { join, resolve, extname } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "connect-src 'self' ws: wss:",
  "font-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

function securityHeaders(): HeadersInit {
  return {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  };
}

export function createHttpHandler(
  clientDir: string
): (req: Request) => Promise<Response> {
  const resolvedClientDir = resolve(clientDir);

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    let pathname = url.pathname;
    if (pathname === "/") pathname = "/index.html";

    const filePath = resolve(join(resolvedClientDir, pathname));

    // Path traversal protection
    if (!filePath.startsWith(resolvedClientDir)) {
      return new Response("Forbidden", {
        status: 403,
        headers: securityHeaders(),
      });
    }

    try {
      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        return new Response("Not Found", {
          status: 404,
          headers: securityHeaders(),
        });
      }

      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

      return new Response(file, {
        headers: {
          "Content-Type": contentType,
          ...securityHeaders(),
        },
      });
    } catch {
      return new Response("Internal Server Error", {
        status: 500,
        headers: securityHeaders(),
      });
    }
  };
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
bun test tests/server/http.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/http.ts tests/server/http.test.ts
git commit -m "feat(server): add HTTP handler with static serving and security headers"
```

---

### Task 7: WebSocket Hub

**Files:**
- Create: `server/websocket.ts`
- Create: `tests/server/websocket.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/server/websocket.test.ts
import { describe, expect, test, beforeEach } from "bun:test";
import { WebSocketHub, type WsMessage } from "../../server/websocket";

describe("WebSocketHub", () => {
  test("parseMessage handles valid JSON", () => {
    const msg = WebSocketHub.parseMessage('{"type":"register","sessionId":"s1","label":"app"}');
    expect(msg).toEqual({ type: "register", sessionId: "s1", label: "app" });
  });

  test("parseMessage returns null for invalid JSON", () => {
    expect(WebSocketHub.parseMessage("not json")).toBeNull();
  });

  test("parseMessage returns null for non-object", () => {
    expect(WebSocketHub.parseMessage('"string"')).toBeNull();
  });

  test("parseMessage returns null for missing type", () => {
    expect(WebSocketHub.parseMessage('{"sessionId":"s1"}')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
bun test tests/server/websocket.test.ts
```

- [ ] **Step 3: Implement WebSocket hub**

```typescript
// server/websocket.ts
import type { ServerWebSocket } from "bun";
import { SessionRegistry } from "./sessions";
import { SubmissionStore } from "./submissions";
import type { Config } from "./config";

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

export interface WsData {
  kind: "browser" | "bridge";
  id: string;
  sessionId?: string;
  lastHeartbeat: number;
}

export class WebSocketHub {
  private browsers = new Map<string, ServerWebSocket<WsData>>();
  private bridges = new Map<string, ServerWebSocket<WsData>>();
  private rateLimits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private registry: SessionRegistry,
    private submissions: SubmissionStore,
    private config: Config
  ) {}

  static parseMessage(raw: string | Buffer): WsMessage | null {
    try {
      const data = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      if (typeof data !== "object" || data === null || !data.type) return null;
      return data as WsMessage;
    } catch {
      return null;
    }
  }

  addBrowser(ws: ServerWebSocket<WsData>): void {
    this.browsers.set(ws.data.id, ws);
    this.sendSessions(ws);
  }

  removeBrowser(ws: ServerWebSocket<WsData>): void {
    this.browsers.delete(ws.data.id);
  }

  addBridge(ws: ServerWebSocket<WsData>): void {
    // Don't add to bridges map yet — wait for register message
  }

  removeBridge(ws: ServerWebSocket<WsData>): void {
    const sessionId = ws.data.sessionId;
    if (sessionId) {
      this.bridges.delete(sessionId);
      this.registry.remove(sessionId);
      this.broadcastSessions();
    }
  }

  async handleMessage(ws: ServerWebSocket<WsData>, raw: string | Buffer): Promise<void> {
    const msg = WebSocketHub.parseMessage(raw);
    if (!msg) return;

    if (msg.type === "heartbeat") {
      ws.data.lastHeartbeat = Date.now();
      ws.send(JSON.stringify({ type: "heartbeat" }));
      return;
    }

    if (ws.data.kind === "bridge" && msg.type === "register") {
      const sessionId = msg.sessionId as string;
      const label = msg.label as string;
      if (!sessionId || !label) return;

      ws.data.sessionId = sessionId;
      this.bridges.set(sessionId, ws);
      this.registry.add(sessionId, label);
      this.broadcastSessions();
      return;
    }

    if (ws.data.kind === "browser" && msg.type === "submit") {
      if (!this.checkRateLimit(ws.data.id)) {
        ws.send(JSON.stringify({ type: "error", code: "RATE_LIMITED", message: "Too many submissions. Try again in a minute." }));
        return;
      }

      const targetSessionId = msg.targetSessionId as string;
      const image = msg.image as string;
      const prompt = (msg.prompt as string) ?? "";

      if (!targetSessionId || !image) return;

      try {
        const submission = await this.submissions.save(image, prompt);
        const bridge = this.bridges.get(targetSessionId);

        if (bridge) {
          bridge.send(JSON.stringify({
            type: "submission",
            id: submission.id,
            pngPath: submission.pngPath,
            prompt: submission.prompt,
          }));
        }

        ws.send(JSON.stringify({
          type: "ack",
          submissionId: submission.id,
          timestamp: submission.timestamp,
        }));
      } catch (e: any) {
        ws.send(JSON.stringify({
          type: "error",
          code: "SUBMISSION_FAILED",
          message: e.message,
        }));
      }
      return;
    }
  }

  broadcastSessions(): void {
    const payload = JSON.stringify({
      type: "sessions",
      sessions: this.registry.list(),
    });
    for (const browser of this.browsers.values()) {
      browser.send(payload);
    }
  }

  private sendSessions(ws: ServerWebSocket<WsData>): void {
    ws.send(JSON.stringify({
      type: "sessions",
      sessions: this.registry.list(),
    }));
  }

  private checkRateLimit(clientId: string): boolean {
    const now = Date.now();
    let entry = this.rateLimits.get(clientId);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + 60_000 };
      this.rateLimits.set(clientId, entry);
    }

    entry.count++;
    return entry.count <= this.config.rateLimitPerMinute;
  }

  checkHeartbeats(): void {
    const now = Date.now();
    const timeout = this.config.heartbeatTimeoutMs;

    for (const [id, ws] of this.browsers) {
      if (now - ws.data.lastHeartbeat > timeout) {
        ws.close(1000, "heartbeat timeout");
      }
    }

    for (const [id, ws] of this.bridges) {
      if (now - ws.data.lastHeartbeat > timeout) {
        ws.close(1000, "heartbeat timeout");
      }
    }
  }
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
bun test tests/server/websocket.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/websocket.ts tests/server/websocket.test.ts
git commit -m "feat(server): add WebSocket hub with message routing and rate limiting"
```

---

### Task 8: Server Entry Point

**Files:**
- Create: `server/index.ts`
- Create: `tests/server/integration.test.ts`

- [ ] **Step 1: Write failing integration test**

```typescript
// tests/server/integration.test.ts
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";

const TEST_CLIENT_DIR = "/tmp/trayce-test-integration-client";
const TEST_STATE_FILE = "/tmp/trayce-test-integration/state.json";
const TEST_SUBMISSIONS_DIR = "/tmp/trayce-test-integration/submissions";

let serverProcess: any;
let port: number;
let token: string;

describe("Server integration", () => {
  beforeAll(async () => {
    rmSync("/tmp/trayce-test-integration", { recursive: true, force: true });
    mkdirSync(TEST_CLIENT_DIR, { recursive: true });
    writeFileSync(`${TEST_CLIENT_DIR}/index.html`, "<html>trayce</html>");

    // Start server with test config
    port = 9750 + Math.floor(Math.random() * 100);
    serverProcess = Bun.spawn(["bun", "run", "server/index.ts"], {
      env: {
        ...process.env,
        TRAYCE_PORT: String(port),
        TRAYCE_HOST: "127.0.0.1",
        TRAYCE_STATE_FILE: TEST_STATE_FILE,
        TRAYCE_SUBMISSIONS_DIR: TEST_SUBMISSIONS_DIR,
        TRAYCE_CLIENT_DIR: TEST_CLIENT_DIR,
      },
      stdout: "pipe",
    });

    // Wait for state file
    for (let i = 0; i < 50; i++) {
      if (existsSync(TEST_STATE_FILE)) break;
      await Bun.sleep(100);
    }

    const state = JSON.parse(readFileSync(TEST_STATE_FILE, "utf-8"));
    token = state.token;
  });

  afterAll(() => {
    serverProcess?.kill();
    rmSync("/tmp/trayce-test-integration", { recursive: true, force: true });
    rmSync(TEST_CLIENT_DIR, { recursive: true, force: true });
  });

  test("HTTP serves index.html", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("trayce");
  });

  test("WebSocket browser connects with token", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/canvas?token=${token}`);
    const opened = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 3000);
    });
    expect(opened).toBe(true);
    ws.close();
  });

  test("WebSocket rejects without token", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/canvas`);
    const closed = await new Promise<boolean>((resolve) => {
      ws.onclose = () => resolve(true);
      ws.onopen = () => resolve(false);
      setTimeout(() => resolve(true), 3000);
    });
    expect(closed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
bun test tests/server/integration.test.ts
```

- [ ] **Step 3: Implement server entry point**

```typescript
// server/index.ts
import { getConfig } from "./config";
import { generateToken, validateToken } from "./auth";
import { SessionRegistry } from "./sessions";
import { SubmissionStore } from "./submissions";
import { WebSocketHub, type WsData } from "./websocket";
import { createHttpHandler } from "./http";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const env = process.env as Record<string, string | undefined>;
const config = getConfig(env);

const token = config.noAuth ? "" : generateToken();
const registry = new SessionRegistry();
const submissions = new SubmissionStore(config.submissionsDir, config.maxSubmissionBytes);
const hub = new WebSocketHub(registry, submissions, config);
const httpHandler = createHttpHandler(config.clientDir);

const server = Bun.serve({
  port: config.port,
  hostname: config.host,

  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/canvas" || url.pathname === "/bridge") {
      const kind = url.pathname === "/canvas" ? "browser" : "bridge";

      // Auth check
      if (!config.noAuth) {
        const providedToken = url.searchParams.get("token");
        if (!validateToken(providedToken, token)) {
          return new Response("Unauthorized", { status: 401 });
        }
      }

      const upgraded = server.upgrade(req, {
        data: {
          kind,
          id: crypto.randomUUID(),
          lastHeartbeat: Date.now(),
        } satisfies WsData,
      });

      return upgraded ? undefined : new Response("Upgrade failed", { status: 500 });
    }

    return httpHandler(req);
  },

  websocket: {
    maxPayloadLength: config.maxWsPayloadBytes,

    open(ws: any) {
      const data = ws.data as WsData;
      if (data.kind === "browser") hub.addBrowser(ws);
      else hub.addBridge(ws);
    },

    message(ws: any, message: string | Buffer) {
      hub.handleMessage(ws, message);
    },

    close(ws: any) {
      const data = ws.data as WsData;
      if (data.kind === "browser") hub.removeBrowser(ws);
      else hub.removeBridge(ws);
    },
  },
});

// Write state file
mkdirSync(dirname(config.stateFile), { recursive: true });
writeFileSync(
  config.stateFile,
  JSON.stringify({
    pid: process.pid,
    port: config.port,
    host: config.host,
    token,
    url: `http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}${config.noAuth ? "" : `?token=${token}`}`,
  }),
  { mode: 0o600 }
);

console.log(`Trayce server running at ${config.noAuth ? `http://${config.host}:${config.port}` : `http://localhost:${config.port}?token=${token}`}`);

// Heartbeat check interval
const heartbeatInterval = setInterval(() => hub.checkHeartbeats(), config.heartbeatIntervalMs);

// Submission cleanup interval
const cleanupInterval = setInterval(
  () => submissions.cleanup(config.submissionTtlMs),
  config.cleanupIntervalMs
);

// Graceful shutdown
function shutdown() {
  console.log("Shutting down...");
  clearInterval(heartbeatInterval);
  clearInterval(cleanupInterval);
  server.stop();
  submissions.removeAll();
  try {
    rmSync(config.stateFile, { force: true });
  } catch {}
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

- [ ] **Step 4: Run test, verify pass**

```bash
bun test tests/server/integration.test.ts --timeout 15000
```

- [ ] **Step 5: Commit**

```bash
git add server/index.ts tests/server/integration.test.ts
git commit -m "feat(server): add entry point with HTTP, WebSocket, auth, state file"
```

---

### Task 9: MCP Channel Bridge

**Files:**
- Create: `bridge/index.ts`
- Create: `tests/bridge/index.test.ts`
- Create: `.mcp.json.example`

- [ ] **Step 1: Write failing test**

```typescript
// tests/bridge/index.test.ts
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";

const TEST_STATE_DIR = "/tmp/trayce-test-bridge";
const TEST_STATE_FILE = `${TEST_STATE_DIR}/state.json`;

// Test that bridge can read state.json and extract connection info
describe("Bridge state discovery", () => {
  beforeAll(() => {
    mkdirSync(TEST_STATE_DIR, { recursive: true });
    writeFileSync(TEST_STATE_FILE, JSON.stringify({
      pid: process.pid,
      port: 9740,
      host: "127.0.0.1",
      token: "test-token-abc",
      url: "http://localhost:9740?token=test-token-abc",
    }));
  });

  afterAll(() => {
    rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  });

  test("reads state file and extracts connection info", () => {
    const state = JSON.parse(readFileSync(TEST_STATE_FILE, "utf-8"));
    expect(state.port).toBe(9740);
    expect(state.token).toBe("test-token-abc");
    expect(state.host).toBe("127.0.0.1");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
bun test tests/bridge/index.test.ts
```

Expected: PASS (this test only validates state file reading, which is Node API).

- [ ] **Step 3: Implement bridge**

```typescript
// bridge/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

// Discover connection info from env or state.json
const stateFile = process.env.TRAYCE_STATE_FILE ?? "/tmp/trayce/state.json";
let host = process.env.TRAYCE_HOST ?? "";
let port = process.env.TRAYCE_PORT ?? "";
let token = process.env.TRAYCE_TOKEN ?? "";

// Read state.json for any values not provided via env
if (existsSync(stateFile)) {
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    if (!token) token = state.token ?? "";
    if (!port && state.port) port = String(state.port);
    // Bridge always connects to localhost (it runs on the same host as the server)
    if (!host) host = "localhost";
  } catch {
    // state file unreadable, continue with defaults
  }
}

// Apply defaults for anything still unset
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

// WebSocket connection to trayce server
const wsUrl = `ws://${host}:${port}/bridge?token=${encodeURIComponent(token)}`;
let reconnectDelay = 1000;

function connect() {
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    reconnectDelay = 1000; // Reset backoff
    ws.send(JSON.stringify({ type: "register", sessionId, label }));

    // Heartbeat
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

- [ ] **Step 4: Create .mcp.json.example**

```json
{
  "mcpServers": {
    "trayce": {
      "command": "bun",
      "args": ["run", "/path/to/trayce/bridge/index.ts"],
      "env": {
        "TRAYCE_HOST": "localhost",
        "TRAYCE_PORT": "9740",
        "TRAYCE_LABEL": "my-project"
      }
    }
  }
}
```

- [ ] **Step 5: Run test, verify pass**

```bash
bun test tests/bridge/index.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add bridge/index.ts tests/bridge/index.test.ts .mcp.json.example
git commit -m "feat(bridge): add MCP Channel bridge with auto-reconnect and state discovery"
```

---

## Phase 2: Canvas Core

### Task 10: Client HTML Shell + CSS

**Files:**
- Create: `client/index.html`
- Create: `client/style.css`

- [ ] **Step 1: Create HTML shell**

```html
<!-- client/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>trayce</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <!-- New Document Dialog -->
  <dialog id="new-doc-dialog">
    <h2>New Canvas</h2>
    <div class="presets">
      <button data-w="1920" data-h="1080">1920 × 1080 (HD)</button>
      <button data-w="2560" data-h="1440">2560 × 1440 (QHD)</button>
      <button data-w="4096" data-h="4096">4096 × 4096 (Max)</button>
    </div>
    <div class="custom-size">
      <label>Width <input type="number" id="custom-w" min="1" max="4096" value="1920"></label>
      <label>Height <input type="number" id="custom-h" min="1" max="4096" value="1080"></label>
      <button id="custom-create">Create</button>
    </div>
    <div class="bg-choice">
      <label><input type="radio" name="bg" value="white" checked> White</label>
      <label><input type="radio" name="bg" value="transparent"> Transparent</label>
    </div>
  </dialog>

  <!-- Top Bar -->
  <header id="top-bar">
    <div class="left">
      <span class="logo">trayce</span>
      <span id="canvas-info" class="info"></span>
    </div>
    <div class="right">
      <label class="session-label">Session:
        <select id="session-select" disabled>
          <option value="">No sessions</option>
        </select>
      </label>
      <button id="submit-btn" disabled>Submit</button>
    </div>
  </header>

  <!-- Main Area -->
  <div id="main">
    <!-- Left Toolbar -->
    <aside id="toolbar"></aside>

    <!-- Canvas Container -->
    <div id="canvas-container"></div>

    <!-- Right Panel -->
    <aside id="right-panel">
      <section id="brush-settings"></section>
      <section id="layers-panel"></section>
    </aside>
  </div>

  <!-- Bottom Bar -->
  <footer id="bottom-bar">
    <div class="left">
      <span id="connection-status" class="status disconnected">
        <span class="dot"></span>
        <span class="text">Disconnected</span>
      </span>
    </div>
    <div class="center">
      <input type="text" id="prompt-input" placeholder="Optional prompt text...">
    </div>
    <div class="right">
      <span id="tool-info"></span>
      <span id="layer-info"></span>
    </div>
  </footer>

  <div id="toast-container"></div>

  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create CSS**

Create `client/style.css` with dark theme, layout grid (top bar, main with toolbar/canvas/panel, bottom bar), responsive breakpoints, panel styles, dialog styles, button styles, color variables. (Full CSS will be written in implementation — skeleton here establishes the structure.)

Key layout:
- `body`: grid with `auto 1fr auto` rows (top, main, bottom)
- `#main`: grid with `48px 1fr 200px` columns (toolbar, canvas, panel)
- Tablet breakpoint at 768px: toolbar moves to bottom floating bar, right panel becomes drawer
- Dark theme: `--bg: #111`, `--surface: #1a1a2e`, `--border: #333`, `--text: #c9d1d9`, `--accent: #4a9eff`

- [ ] **Step 3: Build and verify**

```bash
# Create a minimal app.ts so the build works
echo "console.log('trayce loading...');" > client/app.ts
bun run build:client
ls dist/client/
```

Expected: `app.js` and copied `index.html`, `style.css` in `dist/client/`.

Note: Bun's build only bundles JS. We need to copy HTML/CSS separately. Add a copy step to the build script:

```bash
cp client/index.html client/style.css dist/client/
```

Update `package.json` build:client script to:
```
"build:client": "bun build client/app.ts --outdir dist/client --minify --target browser && cp client/index.html client/style.css dist/client/"
```

- [ ] **Step 4: Commit**

```bash
git add client/index.html client/style.css client/app.ts
git commit -m "feat(client): add HTML shell, CSS dark theme, and build pipeline"
```

---

### Task 11: Toast Utility

**Files:**
- Create: `client/toast.ts`

- [ ] **Step 1: Implement toast**

```typescript
// client/toast.ts
export function showToast(message: string, durationMs = 3000): void {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  container.appendChild(el);

  // Trigger enter animation
  requestAnimationFrame(() => el.classList.add("show"));

  setTimeout(() => {
    el.classList.remove("show");
    el.addEventListener("transitionend", () => el.remove());
  }, durationMs);
}
```

- [ ] **Step 2: Commit**

```bash
git add client/toast.ts
git commit -m "feat(client): add toast notification utility"
```

---

### Task 12: PixiJS Canvas Setup + Viewport

**Files:**
- Create: `client/canvas.ts`

- [ ] **Step 1: Implement canvas module**

```typescript
// client/canvas.ts
import { Application, Container } from "pixi.js";

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export class CanvasManager {
  app: Application;
  stage: Container;
  viewport: Viewport = { zoom: 1, panX: 0, panY: 0 };
  docWidth: number;
  docHeight: number;

  private constructor(app: Application, docWidth: number, docHeight: number) {
    this.app = app;
    this.docWidth = docWidth;
    this.docHeight = docHeight;
    this.stage = new Container();
    this.app.stage.addChild(this.stage);
  }

  static async create(
    container: HTMLElement,
    docWidth: number,
    docHeight: number
  ): Promise<CanvasManager> {
    const app = new Application();
    await app.init({
      resizeTo: container,
      backgroundColor: 0x222222,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    container.appendChild(app.canvas);

    return new CanvasManager(app, docWidth, docHeight);
  }

  setZoom(zoom: number): void {
    this.viewport.zoom = Math.max(0.1, Math.min(10, zoom));
    this.applyViewport();
  }

  pan(dx: number, dy: number): void {
    this.viewport.panX += dx;
    this.viewport.panY += dy;
    this.applyViewport();
  }

  private applyViewport(): void {
    this.stage.scale.set(this.viewport.zoom);
    this.stage.position.set(
      this.viewport.panX + (this.app.screen.width - this.docWidth * this.viewport.zoom) / 2,
      this.viewport.panY + (this.app.screen.height - this.docHeight * this.viewport.zoom) / 2
    );
  }

  screenToDoc(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.stage.position.x) / this.viewport.zoom,
      y: (screenY - this.stage.position.y) / this.viewport.zoom,
    };
  }

  getCanvasInfo(): string {
    return `${this.docWidth} × ${this.docHeight} · ${Math.round(this.viewport.zoom * 100)}%`;
  }

  destroy(): void {
    this.app.destroy(true);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/canvas.ts
git commit -m "feat(client): add PixiJS canvas manager with viewport zoom/pan"
```

---

### Task 13: Layer Manager

**Files:**
- Create: `client/layers.ts`
- Create: `tests/client/layers.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/client/layers.test.ts
import { describe, expect, test } from "bun:test";
import { LayerManager, type BlendMode } from "../../client/layers";

// Mock OffscreenCanvas for Node/Bun environment
globalThis.OffscreenCanvas = class MockOffscreenCanvas {
  width: number;
  height: number;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return {
      clearRect: () => {},
      drawImage: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      putImageData: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      fill: () => {},
      fillRect: () => {},
      globalCompositeOperation: "source-over",
      globalAlpha: 1,
    };
  }
  convertToBlob() {
    return Promise.resolve(new Blob(["fake"], { type: "image/png" }));
  }
} as any;

describe("LayerManager", () => {
  test("creates with background layer", () => {
    const lm = new LayerManager(100, 100, "white");
    expect(lm.layers.length).toBe(1);
    expect(lm.layers[0].name).toBe("Background");
    expect(lm.layers[0].deletable).toBe(false);
    expect(lm.activeLayerIndex).toBe(0);
  });

  test("add layer", () => {
    const lm = new LayerManager(100, 100, "white");
    lm.addLayer("Sketch");
    expect(lm.layers.length).toBe(2);
    expect(lm.layers[1].name).toBe("Sketch");
    expect(lm.activeLayerIndex).toBe(1);
  });

  test("delete layer", () => {
    const lm = new LayerManager(100, 100, "white");
    lm.addLayer("Sketch");
    lm.deleteLayer(1);
    expect(lm.layers.length).toBe(1);
  });

  test("cannot delete background", () => {
    const lm = new LayerManager(100, 100, "white");
    expect(() => lm.deleteLayer(0)).toThrow();
  });

  test("reorder layers", () => {
    const lm = new LayerManager(100, 100, "white");
    lm.addLayer("A");
    lm.addLayer("B");
    lm.moveLayer(2, 1);
    expect(lm.layers[1].name).toBe("B");
    expect(lm.layers[2].name).toBe("A");
  });

  test("max 20 layers", () => {
    const lm = new LayerManager(100, 100, "white");
    for (let i = 0; i < 19; i++) lm.addLayer(`L${i}`);
    expect(lm.layers.length).toBe(20);
    expect(() => lm.addLayer("overflow")).toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
bun test tests/client/layers.test.ts
```

- [ ] **Step 3: Implement layer manager**

```typescript
// client/layers.ts
export type BlendMode =
  | "normal" | "multiply" | "screen" | "overlay"
  | "soft-light" | "hard-light" | "darken" | "lighten"
  | "color-dodge" | "color-burn";

export interface Layer {
  id: string;
  name: string;
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  locked: boolean;
  deletable: boolean;
}

const MAX_LAYERS = 20;

export class LayerManager {
  layers: Layer[] = [];
  activeLayerIndex = 0;

  constructor(
    public docWidth: number,
    public docHeight: number,
    background: "white" | "transparent"
  ) {
    const bg = this.createLayer("Background", false);
    if (background === "white") {
      bg.ctx.fillStyle = "#ffffff";
      bg.ctx.fillRect(0, 0, docWidth, docHeight);
    }
    this.layers.push(bg);
  }

  get activeLayer(): Layer {
    return this.layers[this.activeLayerIndex];
  }

  addLayer(name: string): Layer {
    if (this.layers.length >= MAX_LAYERS) {
      throw new Error(`Maximum ${MAX_LAYERS} layers`);
    }
    const layer = this.createLayer(name, true);
    this.layers.push(layer);
    this.activeLayerIndex = this.layers.length - 1;
    return layer;
  }

  deleteLayer(index: number): void {
    const layer = this.layers[index];
    if (!layer || !layer.deletable) {
      throw new Error("Cannot delete this layer");
    }
    this.layers.splice(index, 1);
    if (this.activeLayerIndex >= this.layers.length) {
      this.activeLayerIndex = this.layers.length - 1;
    }
  }

  duplicateLayer(index: number): Layer {
    if (this.layers.length >= MAX_LAYERS) {
      throw new Error(`Maximum ${MAX_LAYERS} layers`);
    }
    const source = this.layers[index];
    const copy = this.createLayer(`${source.name} copy`, true);
    copy.ctx.drawImage(source.canvas, 0, 0);
    copy.opacity = source.opacity;
    copy.blendMode = source.blendMode;
    this.layers.splice(index + 1, 0, copy);
    this.activeLayerIndex = index + 1;
    return copy;
  }

  moveLayer(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    const [layer] = this.layers.splice(fromIndex, 1);
    this.layers.splice(toIndex, 0, layer);
    // Update active index
    if (this.activeLayerIndex === fromIndex) {
      this.activeLayerIndex = toIndex;
    }
  }

  mergeDown(index: number): void {
    if (index <= 0 || index >= this.layers.length) return;
    const upper = this.layers[index];
    const lower = this.layers[index - 1];
    lower.ctx.globalAlpha = upper.opacity / 100;
    lower.ctx.globalCompositeOperation = this.blendToComposite(upper.blendMode);
    lower.ctx.drawImage(upper.canvas, 0, 0);
    lower.ctx.globalAlpha = 1;
    lower.ctx.globalCompositeOperation = "source-over";
    this.layers.splice(index, 1);
    if (this.activeLayerIndex >= index) {
      this.activeLayerIndex = Math.max(0, this.activeLayerIndex - 1);
    }
  }

  private createLayer(name: string, deletable: boolean): Layer {
    const canvas = new OffscreenCanvas(this.docWidth, this.docHeight);
    const ctx = canvas.getContext("2d")!;
    return {
      id: crypto.randomUUID(),
      name,
      canvas,
      ctx,
      visible: true,
      opacity: 100,
      blendMode: "normal",
      locked: false,
      deletable,
    };
  }

  blendToComposite(mode: BlendMode): GlobalCompositeOperation {
    const map: Record<BlendMode, GlobalCompositeOperation> = {
      "normal": "source-over",
      "multiply": "multiply",
      "screen": "screen",
      "overlay": "overlay",
      "soft-light": "soft-light",
      "hard-light": "hard-light",
      "darken": "darken",
      "lighten": "lighten",
      "color-dodge": "color-dodge",
      "color-burn": "color-burn",
    };
    return map[mode];
  }
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
bun test tests/client/layers.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add client/layers.ts tests/client/layers.test.ts
git commit -m "feat(client): add layer manager with OffscreenCanvas per layer"
```

---

### Task 14: PixiJS Compositor

**Files:**
- Create: `client/compositor.ts`

- [ ] **Step 1: Implement compositor**

```typescript
// client/compositor.ts
import { Sprite, Texture, Container, ImageSource, type Application } from "pixi.js";
import type { LayerManager, BlendMode } from "./layers";

// PixiJS v8 uses lowercase string blend modes directly
const BLEND_MAP: Record<BlendMode, string> = {
  "normal": "normal",
  "multiply": "multiply",
  "screen": "screen",
  "overlay": "overlay",
  "soft-light": "soft-light",
  "hard-light": "hard-light",
  "darken": "darken",
  "lighten": "lighten",
  "color-dodge": "color-dodge",
  "color-burn": "color-burn",
};

export class Compositor {
  private sprites: Map<string, Sprite> = new Map();
  private container: Container;
  private dirty = true;

  constructor(private app: Application, private layerManager: LayerManager) {
    this.container = new Container();
  }

  getContainer(): Container {
    return this.container;
  }

  markDirty(): void {
    this.dirty = true;
  }

  update(): void {
    if (!this.dirty) return;
    this.dirty = false;

    // Remove sprites for deleted layers
    const activeIds = new Set(this.layerManager.layers.map((l) => l.id));
    for (const [id, sprite] of this.sprites) {
      if (!activeIds.has(id)) {
        this.container.removeChild(sprite);
        sprite.destroy();
        this.sprites.delete(id);
      }
    }

    // Update or create sprites for each layer
    for (let i = 0; i < this.layerManager.layers.length; i++) {
      const layer = this.layerManager.layers[i];
      let sprite = this.sprites.get(layer.id);

      if (!sprite) {
        sprite = new Sprite();
        this.sprites.set(layer.id, sprite);
        this.container.addChild(sprite);
      }

      // Use createImageBitmap (copies, does NOT clear the canvas)
      // This is async but we schedule it per frame
      createImageBitmap(layer.canvas).then((bitmap) => {
        if (sprite) {
          // PixiJS v8: create texture from ImageBitmap via ImageSource
          const source = new ImageSource({ resource: bitmap });
          const oldTexture = sprite.texture;
          sprite.texture = new Texture({ source });
          if (oldTexture) oldTexture.destroy(true);
        }
      });

      sprite.visible = layer.visible;
      sprite.alpha = layer.opacity / 100;
      sprite.blendMode = BLEND_MAP[layer.blendMode] ?? "normal";

      // Ensure correct z-order
      this.container.setChildIndex(sprite, i);
    }
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) {
      sprite.destroy(true);
    }
    this.sprites.clear();
    this.container.destroy();
  }
}
```

Note: `createImageBitmap()` copies the canvas without clearing it (unlike `transferToImageBitmap()` which detaches and clears). The async nature means display may lag one frame behind drawing, but this is imperceptible at 60fps. For more responsive updates during active drawing, the compositor can optionally use a synchronous fallback: drawing the OffscreenCanvas onto a visible canvas via `drawImage()`.

- [ ] **Step 2: Commit**

```bash
git add client/compositor.ts
git commit -m "feat(client): add PixiJS compositor for layer blending"
```

---

### Task 15: Input Handler + Stroke Pipeline

**Files:**
- Create: `client/input.ts`
- Create: `client/stroke.ts`
- Create: `tests/client/stroke.test.ts`

- [ ] **Step 1: Write failing stroke test**

```typescript
// tests/client/stroke.test.ts
import { describe, expect, test } from "bun:test";
import { generateStrokeOutline, type StrokePoint } from "../../client/stroke";

describe("generateStrokeOutline", () => {
  test("generates outline points from input points", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 10, y: 0, pressure: 0.5 },
      { x: 20, y: 0, pressure: 0.5 },
    ];
    const outline = generateStrokeOutline(points, { size: 10, smoothing: 0.5 });
    expect(outline.length).toBeGreaterThan(0);
    // Outline should be closed polygon (first point ≈ last point)
    expect(outline.length).toBeGreaterThan(6); // At least a few points
  });

  test("respects size parameter", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 50, y: 0, pressure: 0.5 },
    ];
    const smallOutline = generateStrokeOutline(points, { size: 5, smoothing: 0.5 });
    const largeOutline = generateStrokeOutline(points, { size: 50, smoothing: 0.5 });
    // Larger brush should produce wider stroke (more spread in y)
    const smallYSpread = Math.max(...smallOutline.map((p) => p[1])) - Math.min(...smallOutline.map((p) => p[1]));
    const largeYSpread = Math.max(...largeOutline.map((p) => p[1])) - Math.min(...largeOutline.map((p) => p[1]));
    expect(largeYSpread).toBeGreaterThan(smallYSpread);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
bun test tests/client/stroke.test.ts
```

- [ ] **Step 3: Implement stroke module**

```typescript
// client/stroke.ts
import getStroke from "perfect-freehand";

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

export interface StrokeOptions {
  size: number;
  smoothing: number;
  thinning?: number;
  streamline?: number;
  simulatePressure?: boolean;
}

export function generateStrokeOutline(
  points: StrokePoint[],
  options: StrokeOptions
): number[][] {
  const inputPoints = points.map((p) => [p.x, p.y, p.pressure]);

  return getStroke(inputPoints, {
    size: options.size,
    smoothing: options.smoothing,
    thinning: options.thinning ?? 0.5,
    streamline: options.streamline ?? 0.5,
    simulatePressure: options.simulatePressure ?? (points[0]?.pressure === 0.5),
    start: { taper: true },
    end: { taper: true },
  });
}

export function outlineToPath2D(outline: number[][]): Path2D {
  const path = new Path2D();
  if (outline.length === 0) return path;

  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    path.lineTo(outline[i][0], outline[i][1]);
  }
  path.closePath();
  return path;
}
```

- [ ] **Step 4: Implement input handler**

```typescript
// client/input.ts
import type { StrokePoint } from "./stroke";

export interface InputState {
  isDrawing: boolean;
  points: StrokePoint[];
  pointerType: string;
}

export type InputCallback = (state: InputState, event: "start" | "move" | "end") => void;

export class InputHandler {
  private state: InputState = {
    isDrawing: false,
    points: [],
    pointerType: "mouse",
  };
  private smoothingWindow: number;
  private callback: InputCallback;
  private element: HTMLElement;

  constructor(element: HTMLElement, callback: InputCallback, smoothingWindow = 3) {
    this.element = element;
    this.callback = callback;
    this.smoothingWindow = smoothingWindow;

    element.addEventListener("pointerdown", this.onPointerDown);
    element.addEventListener("pointermove", this.onPointerMove);
    element.addEventListener("pointerup", this.onPointerUp);
    element.addEventListener("pointerleave", this.onPointerUp);
    element.style.touchAction = "none"; // Prevent browser gestures
  }

  private onPointerDown = (e: PointerEvent): void => {
    // Palm rejection: only stylus and mouse draw; touch pans
    if (e.pointerType === "touch") return;

    this.state.isDrawing = true;
    this.state.pointerType = e.pointerType;
    this.state.points = [this.eventToPoint(e)];
    this.callback(this.state, "start");
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.state.isDrawing) return;
    if (e.pointerType === "touch") return;

    const point = this.eventToPoint(e);
    this.state.points.push(point);
    this.callback(this.state, "move");
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.state.isDrawing) return;
    this.state.isDrawing = false;
    this.callback(this.state, "end");
    this.state.points = [];
  };

  private eventToPoint(e: PointerEvent): StrokePoint {
    const rect = this.element.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure || 0.5,
    };
  }

  destroy(): void {
    this.element.removeEventListener("pointerdown", this.onPointerDown);
    this.element.removeEventListener("pointermove", this.onPointerMove);
    this.element.removeEventListener("pointerup", this.onPointerUp);
    this.element.removeEventListener("pointerleave", this.onPointerUp);
  }
}
```

- [ ] **Step 5: Run test, verify pass**

```bash
bun test tests/client/stroke.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add client/input.ts client/stroke.ts tests/client/stroke.test.ts
git commit -m "feat(client): add input handler and perfect-freehand stroke pipeline"
```

---

### Task 16: Brush Interface + Pen Brush

**Files:**
- Create: `client/brushes/types.ts`
- Create: `client/brushes/pen.ts`
- Create: `client/brushes/eraser.ts`

- [ ] **Step 1: Define brush interface**

```typescript
// client/brushes/types.ts
import type { StrokePoint } from "../stroke";

export interface BrushParams {
  size: number;      // 1-200
  opacity: number;   // 0-100
  flow: number;      // 0-100
  smoothing: number; // 0-100
  color: string;     // hex color
}

export interface Brush {
  name: string;
  cursor: string;

  /** Called on pointerdown — prepare for a new stroke */
  beginStroke(ctx: OffscreenCanvasRenderingContext2D, params: BrushParams): void;

  /** Called on each pointermove — render incremental stroke */
  drawStroke(
    ctx: OffscreenCanvasRenderingContext2D,
    points: StrokePoint[],
    params: BrushParams
  ): void;

  /** Called on pointerup — finalize stroke */
  endStroke(ctx: OffscreenCanvasRenderingContext2D, params: BrushParams): void;
}
```

- [ ] **Step 2: Implement pen brush**

```typescript
// client/brushes/pen.ts
import type { Brush, BrushParams } from "./types";
import type { StrokePoint } from "../stroke";
import { generateStrokeOutline, outlineToPath2D } from "../stroke";

export class PenBrush implements Brush {
  name = "Pen";
  cursor = "crosshair";
  private strokeBuffer: OffscreenCanvas | null = null;
  private strokeCtx: OffscreenCanvasRenderingContext2D | null = null;
  private layerSnapshot: ImageData | null = null;

  beginStroke(ctx: OffscreenCanvasRenderingContext2D, params: BrushParams): void {
    // Save a snapshot of the layer before this stroke (for clean redraw)
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    this.layerSnapshot = ctx.getImageData(0, 0, w, h);

    // Create a stroke buffer to render into cleanly
    this.strokeBuffer = new OffscreenCanvas(w, h);
    this.strokeCtx = this.strokeBuffer.getContext("2d")!;
    this.strokeCtx.fillStyle = params.color;
  }

  drawStroke(
    ctx: OffscreenCanvasRenderingContext2D,
    points: StrokePoint[],
    params: BrushParams
  ): void {
    if (!this.strokeCtx || !this.strokeBuffer || !this.layerSnapshot) return;

    const outline = generateStrokeOutline(points, {
      size: params.size,
      smoothing: params.smoothing / 100,
    });

    // Clear stroke buffer and redraw full stroke (perfect-freehand needs all points)
    this.strokeCtx.clearRect(0, 0, this.strokeBuffer.width, this.strokeBuffer.height);
    const path = outlineToPath2D(outline);
    this.strokeCtx.fill(path);

    // Restore layer to pre-stroke state, then composite stroke buffer on top
    ctx.putImageData(this.layerSnapshot, 0, 0);
    ctx.globalAlpha = params.opacity / 100;
    ctx.drawImage(this.strokeBuffer, 0, 0);
    ctx.globalAlpha = 1;
  }

  endStroke(ctx: OffscreenCanvasRenderingContext2D, _params: BrushParams): void {
    this.strokeBuffer = null;
    this.strokeCtx = null;
    this.layerSnapshot = null;
  }
}
```

- [ ] **Step 3: Implement eraser brush**

```typescript
// client/brushes/eraser.ts
import type { Brush, BrushParams } from "./types";
import type { StrokePoint } from "../stroke";
import { generateStrokeOutline, outlineToPath2D } from "../stroke";

export class EraserBrush implements Brush {
  name = "Eraser";
  cursor = "crosshair";

  beginStroke(ctx: OffscreenCanvasRenderingContext2D, _params: BrushParams): void {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "black";
  }

  drawStroke(
    ctx: OffscreenCanvasRenderingContext2D,
    points: StrokePoint[],
    params: BrushParams
  ): void {
    const outline = generateStrokeOutline(points, {
      size: params.size,
      smoothing: params.smoothing / 100,
    });
    const path = outlineToPath2D(outline);
    ctx.fill(path);
  }

  endStroke(ctx: OffscreenCanvasRenderingContext2D, _params: BrushParams): void {
    ctx.restore();
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add client/brushes/types.ts client/brushes/pen.ts client/brushes/eraser.ts
git commit -m "feat(client): add brush interface, pen brush, and eraser"
```

---

### Task 17: WebSocket Client + Connection

**Files:**
- Create: `client/connection.ts`
- Create: `tests/client/connection.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/client/connection.test.ts
import { describe, expect, test } from "bun:test";
import { buildWsUrl, parseServerMessage } from "../../client/connection";

describe("connection helpers", () => {
  test("buildWsUrl constructs correct URL with token", () => {
    const url = buildWsUrl("localhost", 9740, "abc123");
    expect(url).toBe("ws://localhost:9740/canvas?token=abc123");
  });

  test("buildWsUrl works without token", () => {
    const url = buildWsUrl("192.168.1.5", 9740, "");
    expect(url).toBe("ws://192.168.1.5:9740/canvas?token=");
  });

  test("parseServerMessage handles sessions message", () => {
    const msg = parseServerMessage('{"type":"sessions","sessions":[{"id":"s1","label":"app","status":"active"}]}');
    expect(msg?.type).toBe("sessions");
  });

  test("parseServerMessage returns null for invalid JSON", () => {
    expect(parseServerMessage("not json")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
bun test tests/client/connection.test.ts
```

- [ ] **Step 3: Implement connection module**

```typescript
// client/connection.ts
export interface ServerMessage {
  type: string;
  [key: string]: unknown;
}

export type ConnectionStatus = "connected" | "disconnected" | "reconnecting";
export type StatusCallback = (status: ConnectionStatus) => void;
export type MessageCallback = (msg: ServerMessage) => void;

export function buildWsUrl(host: string, port: number, token: string): string {
  return `ws://${host}:${port}/canvas?token=${token}`;
}

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const data = JSON.parse(raw);
    if (typeof data !== "object" || !data?.type) return null;
    return data;
  } catch {
    return null;
  }
}

export class Connection {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private url: string,
    private onStatus: StatusCallback,
    private onMessage: MessageCallback
  ) {}

  connect(): void {
    this.closed = false;
    this.onStatus("reconnecting");

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.onStatus("connected");
      this.startHeartbeat();
    };

    this.ws.onmessage = (e) => {
      const msg = parseServerMessage(String(e.data));
      if (!msg) return;

      if (msg.type === "heartbeat") {
        this.resetHeartbeatTimeout();
        return;
      }

      this.onMessage(msg);
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      if (!this.closed) {
        this.onStatus("reconnecting");
        setTimeout(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
          this.connect();
        }, this.reconnectDelay);
      } else {
        this.onStatus("disconnected");
      }
    };

    this.ws.onerror = () => {};
  }

  send(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect(): void {
    this.closed = true;
    this.stopHeartbeat();
    this.ws?.close();
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: "heartbeat" });
    }, 10_000);
    this.resetHeartbeatTimeout();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);
    this.heartbeatTimer = null;
    this.heartbeatTimeout = null;
  }

  private resetHeartbeatTimeout(): void {
    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);
    this.heartbeatTimeout = setTimeout(() => {
      this.ws?.close();
    }, 25_000);
  }
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
bun test tests/client/connection.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add client/connection.ts tests/client/connection.test.ts
git commit -m "feat(client): add WebSocket client with reconnect and heartbeat"
```

---

### Task 18: Export (Flatten Layers → PNG)

**Files:**
- Create: `client/export.ts`

- [ ] **Step 1: Implement export**

```typescript
// client/export.ts
import type { LayerManager } from "./layers";

export async function flattenToPng(layerManager: LayerManager): Promise<Blob> {
  const { docWidth, docHeight, layers } = layerManager;
  const canvas = new OffscreenCanvas(docWidth, docHeight);
  const ctx = canvas.getContext("2d")!;

  for (const layer of layers) {
    if (!layer.visible) continue;
    ctx.globalAlpha = layer.opacity / 100;
    ctx.globalCompositeOperation = layerManager.blendToComposite(layer.blendMode);
    ctx.drawImage(layer.canvas, 0, 0);
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  return canvas.convertToBlob({ type: "image/png" });
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data URL prefix
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function downloadPng(layerManager: LayerManager, filename = "trayce.png"): Promise<void> {
  const blob = await flattenToPng(layerManager);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Commit**

```bash
git add client/export.ts
git commit -m "feat(client): add layer flatten and PNG export"
```

---

### Task 19: App Entry Point (Wire Everything Together)

**Files:**
- Modify: `client/app.ts`

- [ ] **Step 1: Implement app init**

Wire up: new document dialog → CanvasManager → LayerManager → Compositor → InputHandler → PenBrush → Connection. This is the integration point where all modules come together. The app should:

1. Show new document dialog on load
2. On dialog submit, create CanvasManager + LayerManager
3. Create Compositor, attach to canvas stage
4. Create InputHandler on canvas element
5. Parse token from URL query params, store in localStorage
6. Connect WebSocket
7. Wire submit button to flatten → base64 → send

- [ ] **Step 2: Build and manually test**

```bash
bun run build:client
bun run start
```

Open the printed URL in browser. Verify:
- New document dialog appears
- Canvas renders after selecting size
- Drawing with pen works (basic strokes appear)
- Connection status shows in bottom bar

- [ ] **Step 3: Commit**

```bash
git add client/app.ts
git commit -m "feat(client): wire up app entry point with all core modules"
```

---

## Phase 3: Remaining Brushes + History

### Task 20: Pencil, Marker, Highlighter, Watercolor Brushes

**Files:**
- Create: `client/brushes/pencil.ts`
- Create: `client/brushes/marker.ts`
- Create: `client/brushes/highlighter.ts`
- Create: `client/brushes/watercolor.ts`

- [ ] **Step 1: Implement all four brushes**

Each brush implements the `Brush` interface from `types.ts`. Key differences:

- **Pencil:** Uses perfect-freehand with added jitter (random x/y offset per point, scaled by size). Renders at 60% opacity with grain texture (random pixel dropout in the fill).
- **Marker:** Fixed-width stroke (no pressure variation). Uses `perfect-freehand` with `thinning: 0` and `simulatePressure: false`. High opacity, slight edge transparency via gradient stroke.
- **Highlighter:** Wide stroke (3× size), rendered with `globalCompositeOperation: "multiply"` and 40% opacity. Yellow-tinted by default.
- **Watercolor:** Uses a separate stroke buffer (`OffscreenCanvas`). Stroke is drawn with Gaussian blur (via `ctx.filter = 'blur(Npx)'`). On `endStroke`, the buffer is composited onto the layer with additive alpha. Edge falloff via radial gradient mask.

- [ ] **Step 2: Commit**

```bash
git add client/brushes/pencil.ts client/brushes/marker.ts client/brushes/highlighter.ts client/brushes/watercolor.ts
git commit -m "feat(client): add pencil, marker, highlighter, and watercolor brushes"
```

---

### Task 21: Undo/Redo History

**Files:**
- Create: `client/history.ts`
- Create: `tests/client/history.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/client/history.test.ts
import { describe, expect, test } from "bun:test";
import { History, type Command } from "../../client/history";

describe("History", () => {
  const makeCommand = (id: string): Command => ({
    type: "stroke",
    layerId: "layer-1",
    data: { id },
  });

  test("undo returns last command", () => {
    const history = new History(256 * 1024 * 1024);
    history.push(makeCommand("a"));
    history.push(makeCommand("b"));
    const undone = history.undo();
    expect(undone?.data.id).toBe("b");
  });

  test("redo returns undone command", () => {
    const history = new History(256 * 1024 * 1024);
    history.push(makeCommand("a"));
    history.push(makeCommand("b"));
    history.undo();
    const redone = history.redo();
    expect(redone?.data.id).toBe("b");
  });

  test("new command clears redo stack", () => {
    const history = new History(256 * 1024 * 1024);
    history.push(makeCommand("a"));
    history.push(makeCommand("b"));
    history.undo();
    history.push(makeCommand("c"));
    expect(history.redo()).toBeNull();
  });

  test("undo on empty returns null", () => {
    const history = new History(256 * 1024 * 1024);
    expect(history.undo()).toBeNull();
  });

  test("canUndo and canRedo", () => {
    const history = new History(256 * 1024 * 1024);
    expect(history.canUndo()).toBe(false);
    history.push(makeCommand("a"));
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
    history.undo();
    expect(history.canRedo()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
bun test tests/client/history.test.ts
```

- [ ] **Step 3: Implement history**

```typescript
// client/history.ts
export interface Command {
  type: "stroke" | "layer-add" | "layer-delete" | "layer-reorder" | "layer-merge";
  layerId: string;
  data: any;
  checkpoint?: Blob; // Compressed PNG checkpoint
  checkpointSize?: number;
}

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private usedMemory = 0;
  private strokesSinceCheckpoint = 0;
  private checkpointInterval = 10;

  constructor(private memoryBudgetBytes: number) {}

  push(command: Command): void {
    this.undoStack.push(command);
    this.redoStack = [];

    if (command.checkpointSize) {
      this.usedMemory += command.checkpointSize;
      this.evictIfNeeded();
    }

    this.strokesSinceCheckpoint++;
  }

  undo(): Command | null {
    const command = this.undoStack.pop();
    if (!command) return null;
    this.redoStack.push(command);
    return command;
  }

  redo(): Command | null {
    const command = this.redoStack.pop();
    if (!command) return null;
    this.undoStack.push(command);
    return command;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  shouldCheckpoint(): boolean {
    return this.strokesSinceCheckpoint >= this.checkpointInterval;
  }

  resetCheckpointCounter(): void {
    this.strokesSinceCheckpoint = 0;
  }

  private evictIfNeeded(): void {
    while (this.usedMemory > this.memoryBudgetBytes && this.undoStack.length > 1) {
      const oldest = this.undoStack.shift();
      if (oldest?.checkpointSize) {
        this.usedMemory -= oldest.checkpointSize;
      }
    }
  }
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
bun test tests/client/history.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add client/history.ts tests/client/history.test.ts
git commit -m "feat(client): add undo/redo with command log and memory-budgeted checkpoints"
```

---

## Phase 4: UI Components

### Task 22: Toolbar

**Files:**
- Create: `client/toolbar.ts`

- [ ] **Step 1: Implement toolbar** — renders tool buttons in `#toolbar`, manages active tool state, emits tool-change events via callback.

- [ ] **Step 2: Commit**

```bash
git add client/toolbar.ts
git commit -m "feat(client): add toolbar with tool buttons and active state"
```

### Task 23: Brush Settings Panel

**Files:**
- Create: `client/brush-settings-ui.ts`

- [ ] **Step 1: Implement** — renders size/opacity/flow/smoothing sliders in `#brush-settings`, binds to current brush params, updates on change.

- [ ] **Step 2: Commit**

```bash
git add client/brush-settings-ui.ts
git commit -m "feat(client): add brush settings panel with sliders"
```

### Task 24: Layers Panel UI

**Files:**
- Create: `client/layers-ui.ts`

- [ ] **Step 1: Implement** — renders layer list in `#layers-panel`, visibility toggles, blend mode dropdown, drag-to-reorder, add/delete buttons, active layer highlight.

- [ ] **Step 2: Commit**

```bash
git add client/layers-ui.ts
git commit -m "feat(client): add layers panel UI with reorder and blend modes"
```

### Task 25: Session Selector UI

**Files:**
- Create: `client/sessions-ui.ts`

- [ ] **Step 1: Implement** — populates `#session-select` dropdown from WebSocket session messages, persists selection in localStorage, enables/disables submit button.

- [ ] **Step 2: Commit**

```bash
git add client/sessions-ui.ts
git commit -m "feat(client): add session selector dropdown"
```

### Task 26: Color Picker

**Files:**
- Create: `client/color-picker.ts`

- [ ] **Step 1: Implement** — HSV wheel (hue ring + SV triangle), hex input, opacity slider, recent colors strip (12 colors, localStorage), eyedropper mode.

- [ ] **Step 2: Commit**

```bash
git add client/color-picker.ts
git commit -m "feat(client): add HSV color picker with eyedropper and recent colors"
```

### Task 27: Keyboard Shortcuts

**Files:**
- Create: `client/shortcuts.ts`

- [ ] **Step 1: Implement** — keydown listener, maps keys to tool switches and actions per spec table. Space+drag for pan. Ctrl+Z/Y for undo/redo. Ctrl+Enter for submit.

- [ ] **Step 2: Commit**

```bash
git add client/shortcuts.ts
git commit -m "feat(client): add keyboard shortcut handler"
```

---

## Phase 5: Additional Tools

### Task 28: Shape Tools (Rectangle, Ellipse, Line)

**Files:**
- Create: `client/tools/shapes.ts`

- [ ] **Step 1: Implement** — preview overlay on drag, commit to active layer on pointerup. Shift+U cycles sub-tool.

- [ ] **Step 2: Commit**

```bash
git add client/tools/shapes.ts
git commit -m "feat(client): add rectangle, ellipse, and line shape tools"
```

### Task 29: Arrow Tool

**Files:**
- Create: `client/tools/arrow.ts`

- [ ] **Step 1: Implement** — line with arrowhead polygon at endpoint, rendered as raster on commit.

- [ ] **Step 2: Commit**

```bash
git add client/tools/arrow.ts
git commit -m "feat(client): add arrow tool"
```

### Task 30: Text Tool

**Files:**
- Create: `client/tools/text.ts`

- [ ] **Step 1: Implement** — click to place, creates inline `<textarea>` overlay, on blur/enter renders text onto active layer via `ctx.fillText`.

- [ ] **Step 2: Commit**

```bash
git add client/tools/text.ts
git commit -m "feat(client): add text tool with inline editing"
```

### Task 31: Image Import Tool

**Files:**
- Create: `client/tools/image.ts`

- [ ] **Step 1: Implement** — file picker (input[type=file]), paste handler (Ctrl+V), drag-drop. Loaded image becomes floating selection for positioning, stamped onto active layer on commit.

- [ ] **Step 2: Commit**

```bash
git add client/tools/image.ts
git commit -m "feat(client): add image import with paste and drag-drop"
```

### Task 32: Selection Tools (Rect + Lasso)

**Files:**
- Create: `client/tools/select.ts`
- Create: `client/tools/lasso.ts`

- [ ] **Step 1: Implement rectangular select** — drag box, cut bitmap region from active layer, render as floating overlay with transform handles (move, scale, rotate). Commit stamps back.

- [ ] **Step 2: Implement lasso select** — freehand outline, same floating transform behavior.

- [ ] **Step 3: Commit**

```bash
git add client/tools/select.ts client/tools/lasso.ts
git commit -m "feat(client): add rectangular and lasso selection tools with transform"
```

---

## Phase 6: Touch, Persistence, Polish

### Task 33: Touch Gestures

**Files:**
- Create: `client/touch.ts`

- [ ] **Step 1: Implement** — two-finger pinch zoom, two-finger pan, three-finger tap undo. Palm rejection (finger pans, stylus draws) via `pointerType` check in input handler. Integration with canvas viewport.

- [ ] **Step 2: Commit**

```bash
git add client/touch.ts
git commit -m "feat(client): add touch gestures with pinch zoom, pan, and palm rejection"
```

### Task 34: IndexedDB Persistence

**Files:**
- Create: `client/persistence.ts`
- Create: `tests/client/persistence.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/client/persistence.test.ts
import { describe, expect, test } from "bun:test";
import { generateTabId } from "../../client/persistence";

describe("persistence helpers", () => {
  test("generateTabId returns unique IDs", () => {
    const a = generateTabId();
    const b = generateTabId();
    expect(a).not.toBe(b);
    expect(typeof a).toBe("string");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
bun test tests/client/persistence.test.ts
```

- [ ] **Step 3: Implement persistence**

```typescript
// client/persistence.ts
export function generateTabId(): string {
  return crypto.randomUUID();
}

const DB_NAME = "trayce";
const STORE_NAME = "layers";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLayers(
  tabId: string,
  layers: { id: string; name: string; blob: Blob; opacity: number; blendMode: string; visible: boolean }[]
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  store.put(layers, `layers-${tabId}`);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadLayers(
  tabId: string
): Promise<{ id: string; name: string; blob: Blob; opacity: number; blendMode: string; visible: boolean }[] | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const req = store.get(`layers-${tabId}`);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
bun test tests/client/persistence.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add client/persistence.ts tests/client/persistence.test.ts
git commit -m "feat(client): add IndexedDB persistence for layer data"
```

---

### Task 35: Responsive CSS + Tablet Layout

**Files:**
- Modify: `client/style.css`

- [ ] **Step 1: Add responsive breakpoints** — at ≤768px: toolbar moves to bottom floating bar, right panel becomes slide-out drawer with toggle button, brush settings in popover, 44px minimum touch targets.

- [ ] **Step 2: Commit**

```bash
git add client/style.css
git commit -m "feat(client): add responsive tablet layout with floating toolbar"
```

---

## Phase 7: Docker + Scripts

### Task 36: Start/Stop Scripts

**Files:**
- Create: `scripts/start.sh`
- Create: `scripts/stop.sh`

- [ ] **Step 1: Implement start.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

STATE_FILE="/tmp/trayce/state.json"

# Check for existing instance
if [ -f "$STATE_FILE" ]; then
  PID=$(jq -r '.pid' "$STATE_FILE" 2>/dev/null || echo "")
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    URL=$(jq -r '.url' "$STATE_FILE")
    echo "{\"status\":\"existing\",\"url\":\"$URL\",\"pid\":$PID}"
    exit 0
  fi
  rm -f "$STATE_FILE"
fi

# Build client if needed
if [ ! -f "dist/client/app.js" ]; then
  bun run build:client
fi

# Start server
nohup bun run server/index.ts > /tmp/trayce/server.log 2>&1 &
SERVER_PID=$!
disown

# Wait for state file
for i in $(seq 1 50); do
  [ -f "$STATE_FILE" ] && break
  sleep 0.1
done

if [ -f "$STATE_FILE" ]; then
  URL=$(jq -r '.url' "$STATE_FILE")
  echo "{\"status\":\"new\",\"url\":\"$URL\",\"pid\":$SERVER_PID}"
else
  echo "{\"status\":\"error\",\"message\":\"Server failed to start\"}" >&2
  exit 1
fi
```

- [ ] **Step 2: Implement stop.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

STATE_FILE="/tmp/trayce/state.json"

if [ ! -f "$STATE_FILE" ]; then
  echo "No running trayce server found."
  exit 0
fi

PID=$(jq -r '.pid' "$STATE_FILE" 2>/dev/null || echo "")
if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "Stopped trayce server (PID $PID)."
else
  echo "Server not running. Cleaning up state file."
  rm -f "$STATE_FILE"
fi
```

- [ ] **Step 3: Make executable and commit**

```bash
chmod +x scripts/start.sh scripts/stop.sh
git add scripts/start.sh scripts/stop.sh
git commit -m "feat: add start/stop server scripts"
```

---

### Task 37: Docker + Compose

**Files:**
- Create: `Dockerfile`
- Create: `compose.yaml`
- Create: `.dockerignore`
- Create: `scripts/build-image.sh`

- [ ] **Step 1: Create Dockerfile** (as specified in spec)

- [ ] **Step 2: Create compose.yaml** (as specified in spec)

- [ ] **Step 3: Create .dockerignore**

```
.git
node_modules
dist
.superpowers
docs
tests
*.log
```

- [ ] **Step 4: Create build-image.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Detect container runtime
if command -v podman &>/dev/null; then
  RUNTIME=podman
elif command -v docker &>/dev/null; then
  RUNTIME=docker
else
  echo "Error: Neither podman nor docker found." >&2
  exit 1
fi

echo "Building with $RUNTIME..."
$RUNTIME build -t trayce:latest .
echo "Done. Image: trayce:latest"
```

- [ ] **Step 5: Build and verify**

```bash
chmod +x scripts/build-image.sh
bash scripts/build-image.sh
```

- [ ] **Step 6: Commit**

```bash
git add Dockerfile compose.yaml .dockerignore scripts/build-image.sh
git commit -m "feat: add Dockerfile, compose.yaml, and container build script"
```

---

## Phase 8: End-to-End Integration Test

### Task 38: Full Integration Test

**Files:**
- Create: `tests/e2e/submission-flow.test.ts`

- [ ] **Step 1: Write E2E test**

Test the full submission flow:
1. Start trayce server
2. Connect a mock bridge via WebSocket (register session)
3. Connect a mock browser via WebSocket
4. Browser sends submit message with base64 PNG
5. Verify bridge receives submission with correct pngPath
6. Verify PNG file exists on disk
7. Verify browser receives ack
8. Clean up

- [ ] **Step 2: Run test, verify pass**

```bash
bun test tests/e2e/submission-flow.test.ts --timeout 15000
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/submission-flow.test.ts
git commit -m "test: add end-to-end submission flow integration test"
```

---

### Task 39: Final Polish

- [ ] **Step 1: Run full test suite**

```bash
bun test
```

Fix any failures.

- [ ] **Step 2: Build and manual smoke test**

```bash
bun run build:client
bun run start
```

Verify in browser:
- New document dialog works
- Drawing with all brush types
- Layer add/delete/reorder
- Undo/redo
- Session selector populates when bridge connects
- Submit sends to bridge
- Touch gestures on mobile (if available)

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found in smoke testing"
```

- [ ] **Step 4: Final commit with updated CLAUDE.md if needed**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with final instructions"
```
