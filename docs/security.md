# Security

Trayce is designed for use on trusted local networks. It provides reasonable security defaults without requiring complex setup.

## Token Authentication

A random token is generated on each server start (via `crypto.randomBytes`). All WebSocket connections must include this token as a query parameter (`?token=...`). Token validation uses timing-safe comparison to prevent timing attacks.

**Token discovery:**
- Browsers get the token from the URL printed at startup
- Bridges read it from `/tmp/trayce/state.json` (written by the server) or the `TRAYCE_TOKEN` environment variable

**Token priority:** `TRAYCE_NO_AUTH=true` (disables auth) > `TRAYCE_TOKEN` (explicit token) > auto-generate.

Pass `TRAYCE_NO_AUTH=true` to disable token auth entirely on fully trusted networks.

## Rate Limiting

Submissions are rate-limited to **10 per minute per client** using a sliding window counter. Exceeding the limit returns an error message via WebSocket. Rate limits are tracked per-connection, not per-IP.

## Size Limits

| Limit | Value |
|-------|-------|
| Max submission size | 20 MB |
| Max WebSocket payload | 30 MB |

Oversized payloads are rejected before processing.

## Submission Lifecycle

- PNGs are written to `/tmp/trayce/submissions/`
- Automatic cleanup runs every 15 minutes
- Submissions older than 1 hour are deleted
- All submissions are removed on server shutdown

## HTTP Security Headers

All HTTP responses include:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Content-Security-Policy` — no inline scripts, no external resources

## Input Validation

All WebSocket messages from bridges are validated at the parse boundary using Zod discriminated unions (`shared/protocol-schema.ts`). Invalid payloads are logged at warn level and dropped silently — they never reach message handlers.

Browser submissions are validated for required fields, valid session targets, and size constraints before processing.

## Network Exposure

By default, the server binds to `127.0.0.1` (localhost only). To expose on the local network, set `TRAYCE_HOST=0.0.0.0`. The auth token protects against unauthorized access when exposed.
