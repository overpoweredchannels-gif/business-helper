"use client";

import React, { useMemo, useState } from "react";

interface TableData {
  headers: string[];
  rows: string[][];
}

function parseTable(block: string): TableData | null {
  const lines = block.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;
  const headerMatch = lines[0].match(/^\|(.+)\|$/);
  if (!headerMatch) return null;
  const headers = headerMatch[1].split("|").map((h) => h.trim()).filter(Boolean);
  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    const rowMatch = lines[i].match(/^\|(.+)\|$/);
    if (rowMatch) {
      const cells = rowMatch[1].split("|").map((c) => c.trim());
      rows.push(cells);
    }
  }
  return rows.length > 0 ? { headers, rows } : null;
}

function TableRenderer({ data }: { data: TableData }) {
  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50">
            {data.headers.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, ri) => (
            <tr key={ri} className="border-t border-border/50 even:bg-muted/20">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-1.5">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-foreground">{children}</code>;
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="my-3 rounded-lg border border-border bg-muted/30 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b border-border">
        <span className="text-xs text-muted-foreground">{language || "text"}</span>
        <button onClick={handleCopy} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-sm leading-relaxed"><code>{code}</code></pre>
    </div>
  );
}

function ListRenderer({ items, ordered }: { items: React.ReactNode[]; ordered: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={`my-2 ${ordered ? "list-decimal" : "list-disc"} pl-5 space-y-1`}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </Tag>
  );
}

interface ParsedBlock {
  type: "paragraph" | "heading" | "code" | "table" | "list" | "divider" | "quote";
  content?: string;
  language?: string;
  level?: number;
  table?: TableData;
  items?: React.ReactNode[];
  ordered?: boolean;
}

function parseMarkdown(text: string): (ParsedBlock | string)[] {
  const lines = text.split("\n");
  const blocks: (ParsedBlock | string)[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: "code", language, content: codeLines.join("\n") });
      continue;
    }

    const table = parseTable(line + "\n" + lines.slice(i + 1, i + 10).join("\n"));
    if (table) {
      let rowCount = 0;
      for (let j = i; j < Math.min(i + 10, lines.length); j++) {
        if (lines[j].match(/^\|(.+)\|$/)) rowCount++;
        else break;
      }
      blocks.push({ type: "table", table });
      i += rowCount;
      continue;
    }

    if (line.startsWith("#")) {
      const level = line.match(/^#{1,6}/)?.[0].length || 1;
      blocks.push({ type: "heading", level, content: line.replace(/^#+\s*/, "") });
      i++;
      continue;
    }

    if (line.startsWith("---") || line.startsWith("***")) {
      blocks.push({ type: "divider" });
      i++;
      continue;
    }

    if (line.startsWith("> ")) {
      blocks.push({ type: "quote", content: line.slice(2) });
      i++;
      continue;
    }

    if (/^[\-\*]\s/.test(line) || /^\d+[\.\)]\s/.test(line)) {
      const items: string[] = [];
      const ordered = /^\d+[\.\)]\s/.test(line);
      while (i < lines.length && (/^[\-\*]\s/.test(lines[i]) || /^\d+[\.\)]\s/.test(lines[i]))) {
        items.push(lines[i].replace(/^[\-\*\d]+[\.\)]\s*/, ""));
        i++;
      }
      blocks.push({ type: "list", items: items as unknown as React.ReactNode[], ordered });
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    blocks.push({ type: "paragraph", content: line });
    i++;
  }
  return blocks;
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);
    const codeMatch = remaining.match(/`([^`]+)`/);
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);

    const matches: { index: number; length: number; render: React.ReactNode; consumed: number }[] = [];

    if (boldMatch) matches.push({ index: boldMatch.index!, length: boldMatch[0].length, render: <strong key={key++}>{boldMatch[1]}</strong>, consumed: boldMatch[0].length });
    if (italicMatch) matches.push({ index: italicMatch.index!, length: italicMatch[0].length, render: <em key={key++}>{italicMatch[1]}</em>, consumed: italicMatch[0].length });
    if (codeMatch) matches.push({ index: codeMatch.index!, length: codeMatch[0].length, render: <InlineCode key={key++}>{codeMatch[1]}</InlineCode>, consumed: codeMatch[0].length });
    if (linkMatch) matches.push({ index: linkMatch.index!, length: linkMatch[0].length, render: <a key={key++} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">{linkMatch[1]}</a>, consumed: linkMatch[0].length });

    if (matches.length === 0) {
      parts.push(remaining);
      break;
    }

    matches.sort((a, b) => a.index - b.index);
    const first = matches[0];
    if (first.index > 0) parts.push(remaining.slice(0, first.index));
    parts.push(first.render);
    remaining = remaining.slice(first.index + first.consumed);
  }

  return parts;
}

export function MarkdownRenderer({ content }: { content: string }) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div className="prose-custom space-y-1">
      {blocks.map((block, i) => {
        if (typeof block === "string") return null;
        switch (block.type) {
          case "heading": {
            const H = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
            return <H key={i} className={`font-semibold text-foreground mt-4 mb-2 ${block.level === 1 ? "text-lg" : block.level === 2 ? "text-base" : "text-sm"}`}>{renderInline(block.content || "")}</H>;
          }
          case "paragraph":
            return <p key={i} className="text-sm leading-relaxed text-foreground/90">{renderInline(block.content || "")}</p>;
          case "code":
            return <CodeBlock key={i} language={block.language || ""} code={block.content || ""} />;
          case "table":
            return block.table ? <TableRenderer key={i} data={block.table} /> : null;
          case "list":
            return <ListRenderer key={i} items={block.items || []} ordered={block.ordered || false} />;
          case "divider":
            return <hr key={i} className="my-3 border-border/50" />;
          case "quote":
            return <blockquote key={i} className="border-l-2 border-primary/30 pl-3 text-sm text-muted-foreground italic">{renderInline(block.content || "")}</blockquote>;
          default:
            return null;
        }
      })}
    </div>
  );
}
