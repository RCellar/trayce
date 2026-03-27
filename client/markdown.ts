/**
 * Lightweight markdown renderer (~150 lines, zero dependencies).
 * Used by the Response and Transcript tabs to render Claude assistant messages.
 *
 * Security: all HTML entities are escaped before rendering to prevent XSS.
 */

/** Escape HTML special characters to prevent XSS. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Apply inline markdown (bold, italic, inline code, links) to already-escaped text. */
function applyInline(escaped: string): string {
  // Inline code — protect from further substitution
  const codeSegments: string[] = [];
  let result = escaped.replace(/`([^`]+)`/g, (_match, inner) => {
    const idx = codeSegments.length;
    codeSegments.push(`<code>${inner}</code>`);
    return `\x00CODE${idx}\x00`;
  });

  // Links: [text](url)  — url must be re-escaped since escapeHtml already ran on the line
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, url) => {
    return `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
  });

  // Bold (**text**)
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic (*text*) — only single asterisks not preceded/followed by another
  result = result.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Restore inline code segments
  result = result.replace(/\x00CODE(\d+)\x00/g, (_m, idx) => codeSegments[Number(idx)]);

  return result;
}

/**
 * Render a markdown source string to an HTML string.
 * Supports: headings (h1–h6), code blocks (with optional language), inline code,
 * bold, italic, links, unordered lists, ordered lists, and paragraphs.
 */
export function renderMarkdown(source: string): string {
  const lines = source.split("\n");
  const output: string[] = [];

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Code fence ──────────────────────────────────────────────────────────
    const fenceMatch = line.match(/^```([a-zA-Z0-9_+#.-]*)$/);
    if (fenceMatch) {
      const lang = fenceMatch[1];
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      i++; // consume closing ```
      const classAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      output.push(`<pre><code${classAttr}>${codeLines.join("\n")}</code></pre>`);
      continue;
    }

    // ── Heading ─────────────────────────────────────────────────────────────
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = applyInline(escapeHtml(headingMatch[2]));
      output.push(`<h${level}>${text}</h${level}>`);
      i++;
      continue;
    }

    // ── Unordered list ──────────────────────────────────────────────────────
    if (/^- /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^- /.test(lines[i])) {
        items.push(`<li>${applyInline(escapeHtml(lines[i].slice(2)))}</li>`);
        i++;
      }
      output.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // ── Ordered list ────────────────────────────────────────────────────────
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        const text = lines[i].replace(/^\d+\. /, "");
        items.push(`<li>${applyInline(escapeHtml(text))}</li>`);
        i++;
      }
      output.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // ── Blank line (paragraph separator) ────────────────────────────────────
    if (line.trim() === "") {
      i++;
      continue;
    }

    // ── Paragraph ───────────────────────────────────────────────────────────
    // Collect consecutive non-blank, non-special lines into one paragraph.
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].match(/^```/) &&
      !lines[i].match(/^- /) &&
      !lines[i].match(/^\d+\. /)
    ) {
      paraLines.push(applyInline(escapeHtml(lines[i])));
      i++;
    }
    if (paraLines.length > 0) {
      output.push(`<p>${paraLines.join(" ")}</p>`);
    }
  }

  return output.join("");
}
