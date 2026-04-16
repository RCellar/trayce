import { existsSync, readFileSync } from "node:fs";
import { defaultStateFile } from "../../shared/paths";

async function main() {
  // Read hook payload from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  const payload = Buffer.concat(chunks).toString("utf-8");
  if (!payload.trim()) process.exit(0);

  // Discover server from state.json
  const stateFile = defaultStateFile();
  if (!existsSync(stateFile)) process.exit(0);

  let state: { port?: number; token?: string };
  try {
    state = JSON.parse(readFileSync(stateFile, "utf-8"));
  } catch {
    process.exit(0);
  }

  const port = state.port ?? 9740;
  const token = state.token ?? "";

  // POST to server
  try {
    await fetch(`http://localhost:${port}/hook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: payload,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Server unreachable — exit silently. Hooks must never block Claude.
  }
}

main().catch(() => process.exit(0));
