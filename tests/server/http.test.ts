import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHttpHandler } from "../../server/http";
import { testDir } from "../helpers/paths";

const TEST_DIR = testDir("http-static");

function req(path: string): Request {
  return new Request(`http://localhost${path}`);
}

beforeAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, "assets"), { recursive: true });

  writeFileSync(join(TEST_DIR, "index.html"), "<html><body>hello</body></html>");
  writeFileSync(join(TEST_DIR, "style.css"), "body { color: red; }");
  writeFileSync(join(TEST_DIR, "app.js"), "console.log('hi');");
  writeFileSync(join(TEST_DIR, "data.json"), '{"ok":true}');
  writeFileSync(join(TEST_DIR, "logo.svg"), "<svg/>");
  writeFileSync(join(TEST_DIR, "favicon.ico"), "ico-data");
  writeFileSync(join(TEST_DIR, "photo.png"), "png-data");
  writeFileSync(join(TEST_DIR, "file.bin"), "binary");
  writeFileSync(join(TEST_DIR, "assets", "nested.js"), "// nested");
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("routing", () => {
  it("GET / serves index.html", async () => {
    const handler = createHttpHandler(TEST_DIR);
    const res = await handler(req("/"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("hello");
  });

  it("GET /index.html serves directly", async () => {
    const handler = createHttpHandler(TEST_DIR);
    const res = await handler(req("/index.html"));
    expect(res.status).toBe(200);
  });

  it("GET /assets/nested.js serves nested files", async () => {
    const handler = createHttpHandler(TEST_DIR);
    const res = await handler(req("/assets/nested.js"));
    expect(res.status).toBe(200);
  });

  it("GET /missing returns 404", async () => {
    const handler = createHttpHandler(TEST_DIR);
    const res = await handler(req("/missing.html"));
    expect(res.status).toBe(404);
  });
});

describe("MIME types", () => {
  const cases: [string, string][] = [
    ["/index.html", "text/html"],
    ["/style.css", "text/css"],
    ["/app.js", "text/javascript"],
    ["/data.json", "application/json"],
    ["/logo.svg", "image/svg+xml"],
    ["/favicon.ico", "image/x-icon"],
    ["/photo.png", "image/png"],
  ];

  for (const [path, expectedMime] of cases) {
    it(`${path} → ${expectedMime}`, async () => {
      const handler = createHttpHandler(TEST_DIR);
      const res = await handler(req(path));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain(expectedMime);
    });
  }

  it("unknown extension → application/octet-stream", async () => {
    const handler = createHttpHandler(TEST_DIR);
    const res = await handler(req("/file.bin"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
  });
});

describe("security headers on 200", () => {
  it("X-Content-Type-Options: nosniff", async () => {
    const handler = createHttpHandler(TEST_DIR);
    const res = await handler(req("/"));
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("X-Frame-Options: DENY", async () => {
    const handler = createHttpHandler(TEST_DIR);
    const res = await handler(req("/"));
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("Referrer-Policy: no-referrer", async () => {
    const handler = createHttpHandler(TEST_DIR);
    const res = await handler(req("/"));
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});

describe("CSP directives", () => {
  async function getCsp(): Promise<string> {
    const handler = createHttpHandler(TEST_DIR);
    const res = await handler(req("/"));
    return res.headers.get("Content-Security-Policy") ?? "";
  }

  it("default-src 'self'", async () => {
    expect(await getCsp()).toContain("default-src 'self'");
  });

  it("script-src 'self'", async () => {
    expect(await getCsp()).toContain("script-src 'self'");
  });

  it("style-src 'self' 'unsafe-inline'", async () => {
    expect(await getCsp()).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("img-src 'self' blob: data:", async () => {
    expect(await getCsp()).toContain("img-src 'self' blob: data:");
  });

  it("connect-src 'self' ws: wss:", async () => {
    expect(await getCsp()).toContain("connect-src 'self' ws: wss:");
  });

  it("object-src 'none'", async () => {
    expect(await getCsp()).toContain("object-src 'none'");
  });

  it("frame-ancestors 'none'", async () => {
    expect(await getCsp()).toContain("frame-ancestors 'none'");
  });
});

describe("security headers on error responses", () => {
  it("404 has security headers", async () => {
    const handler = createHttpHandler(TEST_DIR);
    const res = await handler(req("/missing"));
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("403 has security headers", async () => {
    const handler = createHttpHandler(TEST_DIR);
    // Use encoded dots to bypass URL normalization and trigger real traversal check
    const res = await handler(req("/%2e%2e%2fetc%2fpasswd"));
    expect(res.status).toBe(403);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("path traversal protection", () => {
  it("URL-normalized /../ resolves to / and returns 404 (not a file outside root)", async () => {
    // new URL() normalizes /../etc/passwd to /etc/passwd before handler sees it
    // The file /etc/passwd doesn't exist in clientDir, so it's a 404
    const handler = createHttpHandler(TEST_DIR);
    const res = await handler(req("/../etc/passwd"));
    expect([403, 404]).toContain(res.status);
  });

  it("blocks percent-encoded traversal %2e%2e%2f", async () => {
    const handler = createHttpHandler(TEST_DIR);
    // Encoded dots bypass URL normalization but decodeURIComponent + resolve catches them
    const res = await handler(req("/%2e%2e%2fetc%2fpasswd"));
    expect(res.status).toBe(403);
  });

  it("blocks encoded traversal %2F..%2F", async () => {
    const handler = createHttpHandler(TEST_DIR);
    const res = await handler(req("/%2F..%2Fetc%2Fpasswd"));
    expect(res.status).toBe(403);
  });

  it("allows nested paths within clientDir", async () => {
    const handler = createHttpHandler(TEST_DIR);
    const res = await handler(req("/assets/nested.js"));
    expect(res.status).toBe(200);
  });
});

describe("CSP auto-hashing", () => {
  const INLINE_DIR = testDir("http-csp-inline");
  const EXTERNAL_DIR = testDir("http-csp-external");
  const HANDLER_DIR = testDir("http-csp-handler");
  const MISSING_DIR = testDir("http-csp-missing");

  beforeAll(() => {
    rmSync(INLINE_DIR, { recursive: true, force: true });
    rmSync(EXTERNAL_DIR, { recursive: true, force: true });
    rmSync(HANDLER_DIR, { recursive: true, force: true });

    mkdirSync(INLINE_DIR, { recursive: true });
    mkdirSync(EXTERNAL_DIR, { recursive: true });
    mkdirSync(HANDLER_DIR, { recursive: true });
    // MISSING_DIR intentionally not created — no index.html

    writeFileSync(join(INLINE_DIR, "index.html"), "<html><script>FOO</script></html>");
    writeFileSync(join(EXTERNAL_DIR, "index.html"), '<html><script src="foo.js"></script></html>');
    writeFileSync(
      join(HANDLER_DIR, "index.html"),
      '<html><button onclick="x()">click</button></html>',
    );
  });

  afterAll(() => {
    rmSync(INLINE_DIR, { recursive: true, force: true });
    rmSync(EXTERNAL_DIR, { recursive: true, force: true });
    rmSync(HANDLER_DIR, { recursive: true, force: true });
    rmSync(MISSING_DIR, { recursive: true, force: true });
  });

  it("inline <script> body is hashed and appended to script-src", async () => {
    const handler = createHttpHandler(INLINE_DIR);
    const res = await handler(new Request("http://localhost/index.html"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    const expectedHash = createHash("sha256").update("FOO").digest("base64");
    expect(csp).toContain(`'sha256-${expectedHash}'`);
    expect(csp).toContain("script-src 'self'");
  });

  it("<script src=...> does NOT add a hash", async () => {
    const handler = createHttpHandler(EXTERNAL_DIR);
    const res = await handler(new Request("http://localhost/index.html"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("sha256-");
  });

  it("inline event handler attribute causes createHttpHandler to throw", () => {
    expect(() => createHttpHandler(HANDLER_DIR)).toThrow(/inline event handler/i);
  });

  it("missing index.html does not throw and serves default CSP without extra hashes", async () => {
    let handler: (req: Request) => Promise<Response>;
    expect(() => {
      handler = createHttpHandler(MISSING_DIR);
    }).not.toThrow();
    const res = await handler!(new Request("http://localhost/index.html"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("sha256-");
  });
});
