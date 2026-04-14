import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHttpHandler } from "../../server/http";
import { testDir } from "../helpers/paths";

// Helper: compute the sha256 base64 hash of a string (matches browser behaviour).
function sha256b64(s: string): string {
  return createHash("sha256").update(s).digest("base64");
}

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

  it("script-src includes 'unsafe-eval' (required by pixi.js GL renderer)", async () => {
    expect(await getCsp()).toContain("'unsafe-eval'");
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
  const BENIGN_DIR = testDir("http-csp-benign");
  const MULTI_DIR = testDir("http-csp-multi");
  const EMPTY_DIR = testDir("http-csp-empty");
  const EISDIR_DIR = testDir("http-csp-eisdir");

  beforeAll(() => {
    rmSync(INLINE_DIR, { recursive: true, force: true });
    rmSync(EXTERNAL_DIR, { recursive: true, force: true });
    rmSync(HANDLER_DIR, { recursive: true, force: true });
    rmSync(BENIGN_DIR, { recursive: true, force: true });
    rmSync(MULTI_DIR, { recursive: true, force: true });
    rmSync(EMPTY_DIR, { recursive: true, force: true });
    rmSync(EISDIR_DIR, { recursive: true, force: true });

    mkdirSync(INLINE_DIR, { recursive: true });
    mkdirSync(EXTERNAL_DIR, { recursive: true });
    mkdirSync(HANDLER_DIR, { recursive: true });
    mkdirSync(BENIGN_DIR, { recursive: true });
    mkdirSync(MULTI_DIR, { recursive: true });
    mkdirSync(EMPTY_DIR, { recursive: true });
    mkdirSync(EISDIR_DIR, { recursive: true });
    // MISSING_DIR intentionally not created — no index.html

    writeFileSync(join(INLINE_DIR, "index.html"), "<html><script>FOO</script></html>");
    writeFileSync(join(EXTERNAL_DIR, "index.html"), '<html><script src="foo.js"></script></html>');
    writeFileSync(
      join(HANDLER_DIR, "index.html"),
      '<html><button onclick="x()">click</button></html>',
    );
    // Benign fixture: on*= appears only inside a comment and a JS string — not in a tag attribute.
    writeFileSync(
      join(BENIGN_DIR, "index.html"),
      '<html><!-- onclick=bad --><script>var s = "onclick=x";</script></html>',
    );
    // Multiple inline scripts fixture.
    writeFileSync(
      join(MULTI_DIR, "index.html"),
      "<html><script>ONE</script><script>TWO</script></html>",
    );
    // Empty script tag fixture.
    writeFileSync(
      join(EMPTY_DIR, "index.html"),
      "<html><script></script><script>REAL</script></html>",
    );
    // EISDIR fixture: index.html is a directory, not a file — triggers non-ENOENT error.
    mkdirSync(join(EISDIR_DIR, "index.html"), { recursive: true });
  });

  afterAll(() => {
    rmSync(INLINE_DIR, { recursive: true, force: true });
    rmSync(EXTERNAL_DIR, { recursive: true, force: true });
    rmSync(HANDLER_DIR, { recursive: true, force: true });
    rmSync(MISSING_DIR, { recursive: true, force: true });
    rmSync(BENIGN_DIR, { recursive: true, force: true });
    rmSync(MULTI_DIR, { recursive: true, force: true });
    rmSync(EMPTY_DIR, { recursive: true, force: true });
    rmSync(EISDIR_DIR, { recursive: true, force: true });
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

  it("on*= inside comment/script body does NOT trigger inline-event-handler error", () => {
    // The HTML has onclick= only inside a comment and a JS string, not as a tag attribute.
    // createHttpHandler must succeed, and the script body gets a hash.
    let handler: (req: Request) => Promise<Response>;
    expect(() => {
      handler = createHttpHandler(BENIGN_DIR);
    }).not.toThrow();
    // The inline script body 'var s = "onclick=x";' should produce a hash in CSP.
    const body = 'var s = "onclick=x";';
    const expectedHash = sha256b64(body);
    // We need to call the handler to retrieve the CSP header.
    // Since it's async we use a sync check here via the constructed handler's closure-built CSP.
    // We verify by inspecting the handler response.
    return handler!(new Request("http://localhost/index.html")).then((res) => {
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toContain("'self'");
      expect(csp).toContain(`'sha256-${expectedHash}'`);
    });
  });

  it("multiple inline scripts each get their own hash in script-src", async () => {
    const handler = createHttpHandler(MULTI_DIR);
    const res = await handler(new Request("http://localhost/index.html"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain(`'sha256-${sha256b64("ONE")}'`);
    expect(csp).toContain(`'sha256-${sha256b64("TWO")}'`);
  });

  it("empty <script></script> does not add a hash entry", async () => {
    const handler = createHttpHandler(EMPTY_DIR);
    const res = await handler(new Request("http://localhost/index.html"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    // Only the non-empty script body "REAL" gets a hash.
    expect(csp).toContain(`'sha256-${sha256b64("REAL")}'`);
    // The sha256 of empty string must NOT appear.
    expect(csp).not.toContain(`'sha256-${sha256b64("")}'`);
  });

  it("non-ENOENT error on index.html (EISDIR) is rethrown, not silently swallowed", () => {
    // index.html is a directory in EISDIR_DIR, so readFileSync throws EISDIR, not ENOENT.
    // createHttpHandler must rethrow that error rather than silently proceeding.
    expect(() => createHttpHandler(EISDIR_DIR)).toThrow();
  });
});
