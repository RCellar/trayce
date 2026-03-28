# Bug: Transcript, Response, and Usage Tabs Show Stale Data

## Symptom

Permission prompts update correctly via MCP, but the Transcript, Response, and Usage tabs display data from a previous session and never update for the current one.

## Root Cause

The bridge discovers its transcript file **once** at startup (`bridge/index.ts:95`) by calling `discoverTranscriptPath(process.cwd())`. This function picks the **most recently modified `.jsonl`** file in the matching Claude project directory (`~/.claude/projects/{encoded-cwd}/`).

The problem: the bridge is spawned as an MCP server when Claude Code launches — **before the current session's transcript file exists**. Claude Code creates a new `{session-uuid}.jsonl` for each conversation, but that file doesn't appear until the first message is exchanged. By then, `discoverTranscriptPath` has already resolved to the previous session's file and never re-evaluates.

The bridge then reads the old file from offset 0, emitting all its historical entries. The `TranscriptWatcher` polls for new bytes appended to that same file (2-second interval + `fs.watch`), but since the old session is inactive, nothing new appears. Meanwhile, the *actual* current session's transcript is being written to a different `.jsonl` file that the bridge never discovers.

## Why Permission Prompts Still Work

Permission prompts bypass the transcript file entirely. They flow through the MCP Channel protocol:

```
Claude Code  --MCP notification-->  Bridge  --WebSocket-->  Server  --WebSocket-->  Browser
Browser      --WebSocket-->         Server  --WebSocket-->  Bridge  --MCP notification-->  Claude Code
```

This path is real-time and session-aware — no file discovery involved.

## Why Transcript/Response/Usage Don't Work

These all depend on the file-based `TranscriptWatcher`:

```
Claude Code writes to ~/.claude/projects/{dir}/{session-uuid}.jsonl
Bridge reads from (wrong) .jsonl file via TranscriptWatcher
Bridge sends transcript-entry / response / usage-update messages to Server
Server buffers and forwards to watching Browser
```

If the watcher is reading the wrong file, no new data ever reaches the browser.

## Affected Files

| File | Role | Problem |
|------|------|---------|
| `bridge/transcript-watcher.ts:227-266` | `discoverTranscriptPath()` — resolves transcript file path | Called once, returns stale result if current session file doesn't exist yet |
| `bridge/transcript-watcher.ts:45-91` | `TranscriptWatcher` class — reads and polls one file | Locked to the file path given at construction, never re-evaluates |
| `bridge/index.ts:94-125` | `startTranscriptWatcher()` — wires discovery to watcher | Called once on WebSocket open, never retries discovery |

## Fix

Make the `TranscriptWatcher` periodically re-run `discoverTranscriptPath()` and switch to a newer file when one appears. Specifically:

1. **Add `cwd` as a constructor parameter** to `TranscriptWatcher` so it can re-discover later.

2. **Add a rediscovery timer** (e.g. every 3 seconds) that calls `discoverTranscriptPath(cwd)`. If the result differs from the current `filePath`:
   - Update `this.filePath` to the new path
   - Reset `this.offset` to 0
   - Restart the `fs.watch` on the new file's parent directory
   - Call `readNewEntries()` to read the new file from the start

3. **Update `bridge/index.ts`** to pass `process.cwd()` when constructing the watcher:
   ```typescript
   // bridge/index.ts line 103 — add cwd parameter
   transcriptWatcher = new TranscriptWatcher(
     transcriptPath,
     process.cwd(),  // <-- new parameter
     (entry: TranscriptEntry) => { ... },
     (usage: UsageData) => { ... },
   );
   ```

4. **Extract `startFileWatcher()` as a private method** in `TranscriptWatcher` so it can be called both at `start()` and when switching files.

### Optional: stop rediscovering after finding the current session

Once the watcher switches to a file that is actively being written to (i.e., new bytes appear within the first poll cycle), the rediscovery timer could be cleared to avoid unnecessary filesystem scans. This is an optimization, not required for correctness.

## How to Verify

1. Start the trayce server: `bun run start`
2. Launch Claude Code with trayce bridge: `claude --dangerously-load-development-channels server:trayce`
3. Open the trayce browser UI
4. Send a message in Claude Code
5. Confirm the Transcript tab shows the current conversation, not a previous one
6. Confirm Response and Usage tabs update in real-time
