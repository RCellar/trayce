<p align="center"><img src="assets/logo.svg" alt="trayce" width="72" height="72" /></p>

# Security

> [!IMPORTANT]
> Trayce is designed for **trusted local networks**. It provides reasonable defaults — token auth, rate limiting, CSP, bounded submission lifetime — without requiring complex setup.

---

## Defense-in-depth layers

Every incoming message passes through the same ordered pipeline. If a layer rejects, the request is dropped before reaching a handler.

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#fef2f2','primaryBorderColor':'#dc2626','primaryTextColor':'#111','lineColor':'#555','fontSize':'13px'}}}%%
flowchart LR
    In([📡 Incoming WS frame]) --> Transport["🌐 Transport<br/>TLS if reverse-proxied<br/>localhost by default"]
    Transport --> Auth["🔑 Token auth<br/>timing-safe compare<br/>at WS handshake"]:::accent
    Auth --> Size["📏 Size limits<br/>≤30 MB frame<br/>≤20 MB submission"]
    Size --> Rate["⏱️ Rate limit<br/>10 / min sliding<br/>per connection"]
    Rate --> Schema["✅ Zod validation<br/>discriminated unions<br/>at parse boundary"]
    Schema --> Handler["🎯 Message handler"]
    Handler --> Out([✅ Accepted])
    Auth -. 401 .-> Drop([❌ Dropped])
    Size -. too large .-> Drop
    Rate -. quota exceeded .-> Drop
    Schema -. invalid payload .-> Drop

    classDef accent fill:#fef2f2,stroke:#dc2626,stroke-width:2px,color:#111
```

---

## Token authentication

A random token is generated on each server start via `crypto.randomUUID`. All WebSocket connections must present it as a query parameter; validation is **timing-safe** (`crypto.timingSafeEqual`) to prevent timing attacks.

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#fef2f2','primaryBorderColor':'#dc2626','primaryTextColor':'#111','actorTextColor':'#111','fontSize':'13px'}}}%%
sequenceDiagram
    autonumber
    participant U as 👤 User
    participant Srv as 🖥️ Server
    participant SF as 📄 state.json
    participant B as 🌐 Browser
    participant Br as 🔌 Bridge

    U->>Srv: bun run start
    Srv->>Srv: Generate token<br/>(TRAYCE_TOKEN env takes priority)
    Srv->>SF: Write { port, pid, token, url }
    Srv-->>U: Print http://localhost:9740?token=abc…

    U->>B: Open URL (token in query)
    B->>Srv: WS /canvas?token=abc…
    Srv->>Srv: timingSafeEqual(provided, expected)
    Srv-->>B: ✅ 101 Switching Protocols

    Note over SF,Br: Bridge spawned by Claude Code
    Br->>SF: Read state file
    Br->>Srv: WS /bridge?token=abc…
    Srv-->>Br: ✅ 101 Switching Protocols
```

**Token priority:**

```
TRAYCE_NO_AUTH=true  →  TRAYCE_TOKEN  →  auto-generate
   (disables auth)      (explicit)       (default)
```

> [!TIP]
> Pass `TRAYCE_NO_AUTH=true` on fully-trusted networks to skip token auth entirely. This is the default inside the container ([see container deployment](container-deployment.md)).

---

## Rate limiting

Submissions, canvas pushes, and permission requests are rate-limited to **10 per minute per connection** using a sliding-window counter. Transcript and usage messages are unmetered.

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#fef2f2','primaryBorderColor':'#dc2626','primaryTextColor':'#111','fontSize':'13px'}}}%%
stateDiagram-v2
    direction LR
    [*] --> Empty
    Empty --> Accumulating : message<br/>push(now)
    Accumulating --> Accumulating : message<br/>expire(now-60s) · push(now)<br/>len ≤ 10
    Accumulating --> Throttled : len > 10<br/>emit error
    Throttled --> Accumulating : oldest ts<br/>rolls off
    Accumulating --> Empty : 60 s idle
```

> [!NOTE]
> Limits are tracked **per connection**, not per IP. A single browser opening multiple tabs creates multiple buckets — this is intentional (browser IDs are independent) but worth knowing.

---

## Size limits

| Limit | Value | Enforced by |
|-------|-------|-------------|
| 📏 Max WebSocket frame | **30 MB** | Bun's WebSocket handler |
| 🖼️ Max submission size | **20 MB** | `SubmitSchema` + handler check |
| 🖼️ Max `push_image` size | **20 MB** | Bridge check before base64 encoding |

Oversized payloads are rejected before reaching any handler — no partial processing, no disk write.

---

## Submission lifecycle

Submissions live on disk just long enough for Claude to read them. Automatic cleanup ensures nothing lingers.

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#fef2f2','primaryBorderColor':'#dc2626','primaryTextColor':'#111','fontSize':'13px'}}}%%
stateDiagram-v2
    [*] --> Validated : submit { image, prompt }
    Validated --> Written : save to disk<br/>mode 0o600
    Written --> Routed : bridge notified<br/>with absolute path
    Routed --> Read : Claude uses Read tool
    Read --> Expired : > 1 hour old
    Written --> Expired : > 1 hour old
    Expired --> Deleted : 15 min cleanup cycle
    Deleted --> [*]
    Written --> Deleted : server shutdown<br/>removeAll()
```

| Stage | Detail |
|-------|--------|
| 📂 Storage path | `$TMPDIR/trayce/submissions/` (`/tmp` on Linux/macOS, `%TEMP%` on Windows) |
| 🔐 File mode | `0o600` — owner read/write only |
| ⏰ TTL | **1 hour** |
| 🧹 Cleanup interval | **15 minutes** |
| 🛑 On shutdown | `removeAll()` wipes the directory |

---

## HTTP security headers

Every HTTP response includes:

| Header | Value | Prevents |
|--------|-------|----------|
| 🧱 `X-Content-Type-Options` | `nosniff` | MIME sniffing attacks |
| 🪟 `X-Frame-Options` | `DENY` | Clickjacking via iframe embedding |
| 🔒 `Content-Security-Policy` | `script-src 'self' 'sha256-…' 'unsafe-eval'; object-src 'none'; …` | Inline script injection, external resource loads |

> [!NOTE]
> The server computes SHA-256 hashes of inline `<script>` tags in the served `index.html` at startup and emits them in the CSP header. Any `on*=` attribute in the served HTML causes a fail-fast startup error — no stray inline handlers can slip through.

---

## Input validation

All browser-to-server and bridge-to-server messages are validated by **Zod discriminated unions** at the WebSocket parse boundary (`shared/protocol-schema.ts`). Invalid payloads are logged at `warn` level and dropped silently — they never reach a message handler.

Browser submissions additionally check:

- ✅ `targetSessionId` corresponds to a registered bridge
- ✅ `image` is non-empty base64
- ✅ Combined prompt + image is under the 20 MB limit
- ✅ Rate limit has not been exceeded for this connection

---

## Network exposure

> [!WARNING]
> By default the server binds to `127.0.0.1` (localhost only). To expose on the local network, set `TRAYCE_HOST=0.0.0.0`. The auth token protects against unauthorized access — **do not disable auth (`TRAYCE_NO_AUTH=true`) on a bound public interface.**

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#fef2f2','primaryBorderColor':'#dc2626','primaryTextColor':'#111','fontSize':'13px'}}}%%
flowchart LR
    A[TRAYCE_HOST unset] -->|default| B["127.0.0.1<br/>localhost only<br/>✅ safe"]:::safe
    C[TRAYCE_HOST=0.0.0.0] -->|trusted LAN| D["All interfaces<br/>+ token auth<br/>✅ reasonable"]:::ok
    C -->|public / no auth| E["All interfaces<br/>- no auth<br/>❌ dangerous"]:::danger

    classDef safe fill:#ecfdf5,stroke:#059669,color:#064e3b
    classDef ok fill:#fef2f2,stroke:#dc2626,color:#111
    classDef danger fill:#fef2f2,stroke:#991b1b,stroke-width:2px,color:#7f1d1d
```

---

## Threat model — what trayce does *not* protect against

Trayce is **not** a zero-trust system. It is designed for a developer's own machine or a trusted local network. It does **not** defend against:

- 🚫 Untrusted users on the same local network (if auth is disabled)
- 🚫 Malicious MCP bridge code (the bridge is trusted — you install it yourself)
- 🚫 A compromised Claude Code process (it has full filesystem access already)
- 🚫 Browser-side XSS if you load unknown content in the same tab as the canvas
- 🚫 Resource exhaustion beyond the rate / size limits above

If you need stronger isolation, run trayce in a container behind a reverse proxy with TLS and per-user auth.

---

## Further reading

- [🏗️ Architecture & data flow](architecture.md) — processes, flows, WebSocket protocol
- [📦 Container deployment](container-deployment.md) — running in podman / docker
