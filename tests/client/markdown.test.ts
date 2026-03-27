import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../../client/markdown";

describe("renderMarkdown — plain text", () => {
  test("renders plain text as a paragraph", () => {
    const result = renderMarkdown("Hello, world!");
    expect(result).toBe("<p>Hello, world!</p>");
  });

  test("handles multiple paragraphs separated by blank lines", () => {
    const result = renderMarkdown("First paragraph.\n\nSecond paragraph.");
    expect(result).toContain("<p>First paragraph.</p>");
    expect(result).toContain("<p>Second paragraph.</p>");
  });
});

describe("renderMarkdown — headings", () => {
  test("renders h1", () => {
    expect(renderMarkdown("# Heading One")).toContain("<h1>Heading One</h1>");
  });

  test("renders h2", () => {
    expect(renderMarkdown("## Heading Two")).toContain("<h2>Heading Two</h2>");
  });

  test("renders h3", () => {
    expect(renderMarkdown("### Heading Three")).toContain("<h3>Heading Three</h3>");
  });
});

describe("renderMarkdown — inline formatting", () => {
  test("renders bold with **", () => {
    expect(renderMarkdown("This is **bold** text.")).toContain("<strong>bold</strong>");
  });

  test("renders italic with *", () => {
    expect(renderMarkdown("This is *italic* text.")).toContain("<em>italic</em>");
  });

  test("renders inline code", () => {
    expect(renderMarkdown("Use `console.log()` to debug.")).toContain("<code>console.log()</code>");
  });
});

describe("renderMarkdown — code blocks", () => {
  test("renders code block without language", () => {
    const result = renderMarkdown("```\nconst x = 1;\n```");
    expect(result).toContain("<pre><code>");
    expect(result).toContain("const x = 1;");
    expect(result).toContain("</code></pre>");
  });

  test("renders code block with language", () => {
    const result = renderMarkdown("```typescript\nconst x: number = 1;\n```");
    expect(result).toContain('<pre><code class="language-typescript">');
    expect(result).toContain("const x: number = 1;");
    expect(result).toContain("</code></pre>");
  });

  test("renders code block with c++ language", () => {
    const result = renderMarkdown("```c++\n#include <iostream>\nint main() { return 0; }\n```");
    expect(result).toContain('<pre><code class="language-c++">');
    expect(result).toContain("#include &lt;iostream&gt;");
    expect(result).toContain("int main() { return 0; }");
    expect(result).toContain("</code></pre>");
  });
});

describe("renderMarkdown — lists", () => {
  test("renders unordered list", () => {
    const result = renderMarkdown("- Item one\n- Item two\n- Item three");
    expect(result).toContain("<ul>");
    expect(result).toContain("<li>Item one</li>");
    expect(result).toContain("<li>Item two</li>");
    expect(result).toContain("<li>Item three</li>");
    expect(result).toContain("</ul>");
  });

  test("renders ordered list", () => {
    const result = renderMarkdown("1. First\n2. Second\n3. Third");
    expect(result).toContain("<ol>");
    expect(result).toContain("<li>First</li>");
    expect(result).toContain("<li>Second</li>");
    expect(result).toContain("<li>Third</li>");
    expect(result).toContain("</ol>");
  });
});

describe("renderMarkdown — links", () => {
  test("renders link with target=_blank and rel=noopener", () => {
    const result = renderMarkdown("[Click here](https://example.com)");
    expect(result).toContain('<a href="https://example.com"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener"');
    expect(result).toContain(">Click here</a>");
  });
});

describe("renderMarkdown — XSS prevention", () => {
  test("escapes HTML in plain text", () => {
    const result = renderMarkdown("<script>alert('xss')</script>");
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  test("escapes HTML entities in content", () => {
    const result = renderMarkdown("5 > 3 & 2 < 4");
    expect(result).toContain("&gt;");
    expect(result).toContain("&amp;");
    expect(result).toContain("&lt;");
  });

  test("does not let script tags pass through headings", () => {
    const result = renderMarkdown("# <script>evil()</script>");
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });
});

describe("renderMarkdown — mixed content", () => {
  test("renders heading + bold + code block + list together", () => {
    const source = [
      "# My Title",
      "",
      "This has **bold** text.",
      "",
      "```js",
      "console.log('hi');",
      "```",
      "",
      "- alpha",
      "- beta",
    ].join("\n");

    const result = renderMarkdown(source);
    expect(result).toContain("<h1>My Title</h1>");
    expect(result).toContain("<strong>bold</strong>");
    expect(result).toContain('<pre><code class="language-js">');
    expect(result).toContain("console.log(&#39;hi&#39;);");
    expect(result).toContain("<ul>");
    expect(result).toContain("<li>alpha</li>");
    expect(result).toContain("<li>beta</li>");
  });
});
