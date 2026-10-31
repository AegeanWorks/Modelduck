const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

function renderInline(value) {
  let html = escapeHtml(value).replaceAll("\u0000", "");
  const codes = [];

  html = html.replace(/`([^`\n]+)`/g, (_match, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });

  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, href) => {
    return `<a href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>`;
  });

  html = html.replace(/\u0000(\d+)\u0000/g, (_match, index) => {
    return `<code>${codes[Number(index)]}</code>`;
  });

  return html;
}

function renderCodeBlock(code, language) {
  const label = escapeHtml(language || "code");
  const payload = escapeHtml(encodeURIComponent(code));
  return (
    `<div class="code-block">` +
    `<div class="code-head"><span>${label}</span>` +
    `<button type="button" class="code-copy" data-copy="${payload}" title="Copy code">Copy</button></div>` +
    `<pre><code>${escapeHtml(code)}</code></pre>` +
    `</div>`
  );
}

function isSpecialLine(line) {
  return (
    /^#{1,4}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^\s*---+\s*$/.test(line)
  );
}

function renderBlocks(source) {
  const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");
  const output = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      output.push("<hr>");
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      output.push(`<blockquote>${quote.map(renderInline).join("<br>")}</blockquote>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      output.push(`<ul>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      output.push(`<ol>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isSpecialLine(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    output.push(`<p>${paragraph.map(renderInline).join("<br>")}</p>`);
  }

  return output.join("");
}

/**
 * Render a deliberately small Markdown subset. Raw HTML is always escaped;
 * the only tags in the result are the ones built here.
 */
export function renderMarkdown(source) {
  const text = String(source ?? "").replace(/\r\n/g, "\n").replaceAll("\u0000", "");
  const fence = /```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g;
  let html = "";
  let lastIndex = 0;
  let match;

  while ((match = fence.exec(text)) !== null) {
    html += renderBlocks(text.slice(lastIndex, match.index));
    html += renderCodeBlock(match[2].replace(/\n$/, ""), match[1].trim());
    lastIndex = fence.lastIndex;
  }
  html += renderBlocks(text.slice(lastIndex));
  return html;
}
