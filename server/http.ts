import { resolve, join, extname } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png":  "image/png",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
};

const FALLBACK_MIME = "application/octet-stream";

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' blob: data:; connect-src 'self' ws: wss:; font-src 'self'; " +
    "object-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options":        "DENY",
  "Referrer-Policy":        "no-referrer",
};

function secureResponse(
  body: BodyInit | null,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(body, {
    status,
    headers: { ...SECURITY_HEADERS, ...extraHeaders },
  });
}

export function createHttpHandler(
  clientDir: string
): (req: Request) => Promise<Response> {
  const resolvedClientDir = resolve(clientDir);

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

      if (!filePath.startsWith(`${resolvedClientDir}/`) && filePath !== resolvedClientDir) {
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
