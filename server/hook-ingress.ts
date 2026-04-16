import { z } from "zod";

export const HookPayloadSchema = z
  .object({
    session_id: z.string().min(1),
    hook_event_name: z.string().min(1),
    transcript_path: z.string().optional(),
    cwd: z.string().optional(),
    tool_name: z.string().optional(),
    tool_input: z.unknown().optional(),
    tool_output: z.unknown().optional(),
  })
  .passthrough();

export type HookPayload = z.infer<typeof HookPayloadSchema>;

interface HookIngressDeps {
  validateToken: (token: string | null) => boolean;
  sendToBridge: (sessionId: string, payload: string) => boolean;
  broadcastToWatchers: (sessionId: string, payload: string) => void;
  storeTranscriptPath: (sessionId: string, path: string) => void;
}

function truncate(s: string, maxLen: number): string {
  return s.length <= maxLen ? s : s.slice(0, maxLen);
}

export function createHookIngress(deps: HookIngressDeps) {
  return async function handleHook(req: Request): Promise<Response> {
    // 1. Auth: extract Bearer token from Authorization header
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!deps.validateToken(token)) {
      return new Response("Unauthorized", { status: 401 });
    }

    // 2. Parse JSON body, validate with HookPayloadSchema
    let payload: HookPayload;
    try {
      const body = await req.json();
      const result = HookPayloadSchema.safeParse(body);
      if (!result.success) {
        return new Response("Bad Request", { status: 400 });
      }
      payload = result.data;
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    const { session_id, hook_event_name } = payload;

    // 3. Route by hook_event_name
    switch (hook_event_name) {
      case "SessionStart": {
        if (payload.transcript_path) {
          deps.storeTranscriptPath(session_id, payload.transcript_path);
          deps.sendToBridge(
            session_id,
            JSON.stringify({
              type: "session-context",
              sessionId: session_id,
              transcriptPath: payload.transcript_path,
            }),
          );
        }
        break;
      }

      case "PostToolUse":
      case "PostToolUseFailure": {
        const entryType = hook_event_name === "PostToolUse" ? "tool-call" : "tool-result";
        const toolInputStr = truncate(JSON.stringify(payload.tool_input ?? null), 200);
        const entry = {
          type: entryType,
          role: "assistant",
          content: payload.tool_name,
          toolName: payload.tool_name,
          toolInput: toolInputStr,
          timestamp: Date.now(),
        };
        deps.broadcastToWatchers(
          session_id,
          JSON.stringify({ type: "transcript-entry", sessionId: session_id, entry }),
        );
        break;
      }

      case "Stop": {
        const entry = {
          type: "response",
          role: "assistant",
          content: "[session ended]",
          timestamp: Date.now(),
        };
        deps.broadcastToWatchers(
          session_id,
          JSON.stringify({ type: "transcript-entry", sessionId: session_id, entry }),
        );
        break;
      }

      default:
        // Unknown event — accept silently
        break;
    }

    // 4. Return 200 OK on success
    return new Response("OK", { status: 200 });
  };
}
