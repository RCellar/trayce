# Fix: Subagent Model Usage Tracking

## Problem

The Usage tab only reports tokens for the main session model (e.g. Opus 4.6). When Claude dispatches subagents via the `Agent` tool with a different model (e.g. `model: "sonnet"`), those tokens are invisible in the usage display. The user sees 100% Opus usage when the session actually consumed significant Sonnet tokens. Explore subagents using Haiku are also invisible.

## Root Cause

The transcript watcher (`bridge/transcript-watcher.ts`) only extracts usage from the main session transcript's `assistant` entries. Subagent transcripts are written to a separate directory and never read.

## Subagent Transcript Layout

Claude Code writes subagent transcripts alongside the main session transcript:

```
~/.claude/projects/{project-dir}/
  {session-uuid}.jsonl                          ← main transcript (already watched)
  {session-uuid}/
    subagents/
      agent-{agentId}.jsonl                     ← subagent transcript
      agent-{agentId}.meta.json                 ← {"agentType": "...", "description": "..."}
```

Each subagent `.jsonl` has the same format as the main transcript — `assistant` entries contain `message.model` and `message.usage` with full input/output/cache token split:

```json
{
  "type": "assistant",
  "message": {
    "model": "claude-sonnet-4-6",
    "usage": {
      "input_tokens": 27,
      "output_tokens": 4227,
      "cache_read_input_tokens": 427108,
      "cache_creation_input_tokens": 45408
    }
  }
}
```

The `.meta.json` contains the agent type and description but no usage data.

### Observed Models

From a real session with 8 subagent dispatches:

| Agent Type | Model in Transcript | Notes |
|---|---|---|
| `general-purpose` (model: "sonnet") | `claude-sonnet-4-6` | Explicit model override |
| `Explore` | `claude-haiku-4-5-20251001` | Implicit — Explore uses Haiku |
| `superpowers:code-reviewer` | `claude-sonnet-4-6` | Agent-type default |
| `general-purpose` (no model) | inherits parent | Opus in this case |

### Correlation

The `agentId` that names each subagent file is also embedded in some (but not all) Agent tool_result texts as `agentId: {id}`. However, correlation via the main transcript is unreliable:

- Explore agents do NOT include `agentId` in their tool_result text
- The `agentId` appears as free text, not structured data

**Reliable approach:** Don't correlate through the main transcript at all. Discover the `subagents/` directory from the main transcript path, watch for new `.jsonl` files, and parse each independently. The subagent transcripts contain the actual model and full usage data.

## Fix

### Transcript Watcher Changes (`bridge/transcript-watcher.ts`)

**Discover the subagents directory.** Derive its path from the main transcript path:

```
{transcriptDir}/{transcriptBasename-without-ext}/subagents/
```

For example, if the main transcript is:
`~/.claude/projects/-foo/56cf4a76-34ac-43bc-859d-a5d74b4be309.jsonl`

The subagents dir is:
`~/.claude/projects/-foo/56cf4a76-34ac-43bc-859d-a5d74b4be309/subagents/`

This directory may not exist at startup (created when the first subagent is dispatched). The watcher must handle this gracefully.

**Watch for new subagent transcripts.** Poll the `subagents/` directory on each tick (same interval as main transcript polling). When a new `.jsonl` file appears, begin tailing it alongside the main transcript. Each subagent file is parsed with the same `parseLine` logic — the `assistant` entries contain `message.model` and `message.usage` with the full token breakdown.

**Lifecycle:**
1. On `start(transcriptPath)`, compute the subagents dir path.
2. On each `poll()`, check if the subagents dir exists (it may appear mid-session).
3. When the dir exists, scan for `.jsonl` files not yet tracked.
4. For each new file, create a file offset tracker (same as the main transcript) and begin reading.
5. Parse lines identically to the main transcript — the `onUsage` callback receives the real model and full input/output/cache split.
6. On `stop()`, stop watching all subagent files.

**No changes to the `parseLine` method or `UsageData` interface.** The existing parsing logic already extracts model and usage correctly — it just needs to run on more files.

### Implementation Detail: SubagentWatcher

Add a lightweight tracker within `TranscriptWatcher` that manages multiple file offsets:

```ts
private subagentDir: string | null = null;
private subagentOffsets = new Map<string, number>();  // filename → byte offset
```

On each `poll()`:
1. If `subagentDir` is null and the directory now exists, set it.
2. If `subagentDir` is set, `readdirSync` for `.jsonl` files.
3. For each file, read from its last offset (same `readSync` chunked approach as main transcript).
4. Parse each line through `parseLine()` — this emits `onEntry` and `onUsage` callbacks with the subagent's actual model.

### Filtering

- Skip `<synthetic>` model entries (zero tokens, already handled by existing `typeof usage.output_tokens === "number"` check since synthetic entries have 0 output tokens).
- The `subagents/` directory scan should only look at `.jsonl` files (ignore `.meta.json`).

### Usage Aggregation (`server/usage.ts`)

No changes needed. The existing per-model `SessionUsage` aggregation handles multiple models correctly.

### UI (`client/usage-tab.ts`)

No changes needed. The models section already renders per-model breakdowns sorted by request count. Haiku and Sonnet entries will appear alongside Opus automatically.

## Files Modified

- `bridge/transcript-watcher.ts` — Add subagent directory discovery and multi-file tailing

## Edge Cases

- **Subagents dir doesn't exist yet**: The directory is created when the first subagent is dispatched. The watcher must tolerate `ENOENT` on directory reads and retry on subsequent polls.
- **Subagent file appears mid-poll**: A new file may be partially written when first discovered. The chunked-read approach handles this naturally — it reads whatever bytes are available and picks up the rest on the next poll.
- **Nested subagents**: If a subagent dispatches its own subagents, those nested agents have their own transcript files in the same `subagents/` directory (they appear as additional `agent-{id}.jsonl` files). The directory scan picks them all up.
- **Main transcript changes (session restart, rediscovery)**: When `TranscriptWatcher.switchTranscript()` is called, clear all subagent tracking state (`subagentDir`, `subagentOffsets`) and recompute from the new transcript path.
- **Rapid subagent completion**: A subagent may start and finish between two polls. The watcher will discover the file on the next poll and read all its data at once — no data is lost, just delayed.
- **Permission errors**: Subagent transcripts may have different permissions (observed: some are `0600`, some `0644`). Read errors should be logged and the file retried on next poll, not fatal.
- **Stale files from previous sessions**: Only watch files that appear *after* the watcher starts. Track which files existed at startup and skip them, or compare file birthtimes against the bridge start time.
