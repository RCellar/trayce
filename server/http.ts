import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const FALLBACK_MIME = "application/octet-stream";

export function createHttpHandler(clientDir: string): (req: Request) => Promise<Response> {
  const resolvedClientDir = resolve(clientDir);

  // Build CSP once at construction, incorporating hashes of any inline scripts in index.html.
  let html = "";
  try {
    html = readFileSync(join(resolvedClientDir, "index.html"), "utf-8");
  } catch (err) {
    if (!(err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ENOENT")) throw err;
    // index.html not present (e.g. in tests) — proceed with default CSP, no hashes.
  }

  if (html && /<(?!!--)(?:[^>]|\n)*?\son[a-z]+\s*=/i.test(html)) {
    const match = html.match(/<(?!!--)(?:[^>]|\n)*?\son([a-z]+)\s*=/i);
    const attr = match ? `on${match[1]}` : "on*";
    throw new Error(
      `CSP: inline event handlers cannot be expressed without 'unsafe-inline'. Found: ${attr} in index.html. Move them into an external script.`,
    );
  }

  // Hashes are computed over the raw body bytes verbatim — no trimming — matching browser behaviour.
  const scriptHashes: string[] = [];
  const scriptRe = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(scriptRe)) {
    const attrs = m[1] ?? "";
    if (/\bsrc\s*=/i.test(attrs)) continue; // external script — no hash needed
    const body = m[2] ?? "";
    if (!body) continue; // empty script tag — no hash needed
    const hash = createHash("sha256").update(body).digest("base64");
    scriptHashes.push(`'sha256-${hash}'`);
  }

  const scriptSrc = ["'self'", ...scriptHashes].join(" ");
  const csp =
    `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; ` +
    `img-src 'self' blob: data:; connect-src 'self' ws: wss:; font-src 'self'; ` +
    `object-src 'none'; frame-ancestors 'none'`;

  const SECURITY_HEADERS: Record<string, string> = {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  };

  function secureResponse(
    body: BodyInit | null,
    status: number,
    extraHeaders: Record<string, string> = {},
  ): Response {
    return new Response(body, {
      status,
      headers: { ...SECURITY_HEADERS, ...extraHeaders },
    });
  }

  return async function handler(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const pathname = url.pathname === "/" ? "/index.html" : url.pathname;

      let decodedPathname: string;
      try {
        decodedPathname = decodeURIComponent(pathname);
      } catch {
        return secureResponse("Bad Request", 400);
      }

      const relative = decodedPathname.replace(/^\/+/, "");
      const filePath = resolve(join(resolvedClientDir, relative));

      // Use platform-specific separator (forward slash on Unix, backslash on Windows).
      // Without this, Windows paths like "C:\...\dir\file.html" never startsWith "C:\...\dir/"
      // and every request is forbidden.
      if (!filePath.startsWith(resolvedClientDir + sep) && filePath !== resolvedClientDir) {
        return secureResponse("Forbidden", 403);
      }

      const file = Bun.file(filePath);
      const exists = await file.exists();

      if (!exists) {
        return secureResponse("Not Found", 404);
      }

      const ext = extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? FALLBACK_MIME;

      return secureResponse(file, 200, { "Content-Type": contentType });
    } catch (err) {
      console.error("[trayce] HTTP handler error:", err);
      return secureResponse("Internal Server Error", 500);
    }
  };
}
