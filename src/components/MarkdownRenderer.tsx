import { useState, useMemo, useCallback } from 'react';
import { tokenizeLine, tokensToHtml, type SupportedLang } from '../lib/syntaxHighlight';
import { Copy, Check } from './icons';

/**
 * Full-featured Markdown renderer for AI chat messages.
 *
 * No external dependency (no react-markdown / marked / etc.) — keeps the
 * bundle small. Supports the subset LLMs commonly produce:
 *
 *   - ```lang\ncode``` fenced code blocks with syntax highlighting
 *     (uses src/lib/syntaxHighlight.ts — same highlighter as ConflictMergeView)
 *   - `inline code`
 *   - **bold** and *italic* and ***bold-italic***
 *   - [link text](url) — opens in default browser via api.app.openExternal
 *   - # / ## / ### / #### / ##### / ###### headings
 *   - > blockquote
 *   - --- (horizontal rule)
 *   - - / * / + bullet lists (with **nested** indentation by 2 spaces)
 *   - 1. / 2. / 3. numbered lists (with nesting)
 *   - [x] / [ ] task lists (GitHub-style)
 *   - | col | col | markdown tables (GitHub-style)
 *   - Auto-link bare URLs
 *
 * Used by:
 *   - src/components/AiAssistant.tsx (popup) — MessageBubble
 *   - src/pages/AiChatPage.tsx (page) — MessageBubble
 *
 * Both surfaces import this so markdown rendering is consistent.
 */

// ── Language detection for fenced code blocks ──────────────────────────────
const LANG_ALIASES: Record<string, SupportedLang> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  javascript: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  typescript: 'typescript',
  py: 'python', python3: 'python', python: 'python',
  sh: 'bash', shell: 'bash', zsh: 'bash', bash: 'bash',
  yml: 'yaml', yaml: 'yaml',
  json: 'json',
  go: 'go', golang: 'go',
  rs: 'rust', rust: 'rust',
  java: 'java', kt: 'java', kotlin: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  'c++': 'cpp',
  cs: 'java', // C# falls back to java tokenizer (similar keywords)
  php: 'java',
  sql: 'text',
  html: 'text', xml: 'text',
  css: 'text',
  diff: 'text',
  text: 'text', plain: 'text', txt: 'text',
  md: 'markdown', markdown: 'markdown',
  csv: 'csv', tsv: 'csv',
};

function resolveLang(raw?: string): SupportedLang {
  if (!raw) return 'text';
  const k = raw.toLowerCase().trim();
  return LANG_ALIASES[k] ?? 'text';
}

// ── Block-level parser ─────────────────────────────────────────────────────

type Block =
  | { kind: 'code'; lang: string; content: string }
  | { kind: 'text'; content: string };

/** Split markdown into ```fenced code blocks``` and the text between them. */
function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  // Match ```lang\n...\n``` (greedy per block). Allow ~~~ as an alternative fence.
  const re = /(?:^|\n)(```+|~~~+)(\w*)\n([\s\S]*?)\1/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    // Trim leading newline that was part of the (?:^|\n) prefix.
    const textBefore = text.slice(lastIdx, match.index + (match[0].startsWith('\n') ? 1 : 0));
    if (textBefore.trim()) {
      blocks.push({ kind: 'text', content: textBefore });
    }
    blocks.push({ kind: 'code', lang: match[2] || '', content: match[3] });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    const tail = text.slice(lastIdx);
    if (tail.trim()) blocks.push({ kind: 'text', content: tail });
  }
  return blocks;
}

// ── Inline formatting: bold / italic / code / links ────────────────────────

/**
 * Render a string with inline markdown formatting:
 *   - `code`
 *   - **bold**
 *   - *italic*
 *   - ***bold-italic***
 *   - [text](url)
 *   - bare URLs (https://... or http://...) — auto-linked
 *
 * Returns a React fragment.
 */
function renderInline(text: string, keyPrefix: string = ''): React.ReactNode[] {
  // Split on the inline markers — preserving the markers — using a single
  // combined regex with capture groups. Order matters: code first (so its
  // backticks aren't confused with bold/italic), then links, then bold-italic,
  // then bold, then italic, then bare URLs.
  //
  // Each captured group becomes a separate part; we recurse on the non-match
  // text in between to handle nested formatting.
  const parts: React.ReactNode[] = [];
  let key = 0;

  // Combined regex: matches code, link, bold-italic, bold, italic, or bare URL.
  const re = /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*\*[^*]+\*\*\*)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(https?:\/\/[^\s)]+)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(<span key={`${keyPrefix}-${key++}`}>{text.slice(lastIdx, match.index)}</span>);
    }
    const m = match[0];
    if (m.startsWith('`') && m.endsWith('`')) {
      parts.push(
        <code
          key={`${keyPrefix}-${key++}`}
          className="px-1 py-0.5 rounded bg-bg-tertiary text-text-primary text-3xs font-mono"
        >
          {m.slice(1, -1)}
        </code>
      );
    } else if (m.startsWith('[') && m.includes('](') && m.endsWith(')')) {
      const labelStart = m.indexOf('[') + 1;
      const labelEnd = m.indexOf(']');
      const urlStart = m.indexOf('(', labelEnd) + 1;
      const url = m.slice(urlStart, -1);
      const label = m.slice(labelStart, labelEnd);
      parts.push(
        <a
          key={`${keyPrefix}-${key++}`}
          href={url}
          onClick={(e) => {
            e.preventDefault();
            // Defer the import so this module can be loaded by the renderer
            // without pulling in the IPC shim during SSR/tests.
            import('../lib/api').then(({ api }) => {
              api.app.openExternal(url);
            }).catch(() => {
              // Fallback: open in a new browser tab (works in dev mode / browser).
              window.open(url, '_blank', 'noopener,noreferrer');
            });
          }}
          className="text-accent underline hover:text-accent/80 cursor-pointer break-all"
        >
          {label}
        </a>
      );
    } else if (m.startsWith('***') && m.endsWith('***')) {
      parts.push(<strong key={`${keyPrefix}-${key++}`} className="font-bold italic text-text-primary">{m.slice(3, -3)}</strong>);
    } else if (m.startsWith('**') && m.endsWith('**')) {
      parts.push(<strong key={`${keyPrefix}-${key++}`} className="font-semibold text-text-primary">{m.slice(2, -2)}</strong>);
    } else if (m.startsWith('*') && m.endsWith('*')) {
      parts.push(<em key={`${keyPrefix}-${key++}`} className="italic text-text-primary">{m.slice(1, -1)}</em>);
    } else if (m.startsWith('http')) {
      // Bare URL — render as a clickable link, but strip trailing punctuation
      // that's not part of the URL (e.g. "https://example.com.").
      const cleanedUrl = m.replace(/[.,;:!?)]$/, '');
      parts.push(
        <a
          key={`${keyPrefix}-${key++}`}
          href={cleanedUrl}
          onClick={(e) => {
            e.preventDefault();
            import('../lib/api').then(({ api }) => {
              api.app.openExternal(cleanedUrl);
            }).catch(() => {
              window.open(cleanedUrl, '_blank', 'noopener,noreferrer');
            });
          }}
          className="text-accent underline hover:text-accent/80 cursor-pointer break-all"
        >
          {cleanedUrl}
        </a>
      );
    }
    lastIdx = match.index + m.length;
  }
  if (lastIdx < text.length) {
    parts.push(<span key={`${keyPrefix}-${key++}`}>{text.slice(lastIdx)}</span>);
  }
  return parts;
}

// ── Text segment (paragraph / list / heading / quote / table / hr) ─────────

interface ListState {
  ordered: boolean;
  /** Indentation level (number of leading 2-space groups). */
  level: number;
  items: { text: string; level: number; checked?: boolean }[];
}

function renderTextSegment(text: string, keyPrefix: string = ''): React.ReactNode {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let list: ListState | null = null;
  let key = 0;

  const flushList = () => {
    if (!list) return;
    const itemsByLevel = nestListItems(list.items);
    blocks.push(
      list.ordered
        ? <ol key={`${keyPrefix}-ol-${key++}`} className="list-decimal ml-5 space-y-0.5 text-text-primary">{renderList(itemsByLevel, keyPrefix, key)}</ol>
        : <ul key={`${keyPrefix}-ul-${key++}`} className="list-disc ml-5 space-y-0.5 text-text-primary">{renderList(itemsByLevel, keyPrefix, key)}
      </ul>
    );
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines — they flush the current list, but don't render.
    if (!line.trim()) {
      flushList();
      continue;
    }

    // Headings: # / ## / ### / #### / ##### / ######
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const cls =
        level === 1 ? 'text-base font-bold mt-2 mb-1 text-text-primary'
        : level === 2 ? 'text-sm font-bold mt-2 mb-1 text-text-primary'
        : level === 3 ? 'text-sm font-semibold mt-1.5 mb-0.5 text-text-primary'
        : 'text-xs font-semibold mt-1 mb-0.5 text-text-secondary';
      blocks.push(<p key={`${keyPrefix}-h-${key++}`} className={cls}>{renderInline(content, `${keyPrefix}-h-${key}`)}</p>);
      continue;
    }

    // Horizontal rule: --- or *** or ___ (3+ chars on a line alone)
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushList();
      blocks.push(<hr key={`${keyPrefix}-hr-${key++}`} className="border-border-default my-2" />);
      continue;
    }

    // Blockquote: > text
    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushList();
      // Collect consecutive quote lines into one block.
      const quoteLines: string[] = [quoteMatch[1]];
      while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1])) {
        i += 1;
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
      }
      blocks.push(
        <blockquote
          key={`${keyPrefix}-q-${key++}`}
          className="border-l-2 border-accent pl-3 my-1 text-text-secondary italic"
        >
          {renderInline(quoteLines.join(' '), `${keyPrefix}-q-${key}`)}
        </blockquote>
      );
      continue;
    }

    // GitHub-style task list item: - [x] / - [ ]
    const taskMatch = line.match(/^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)$/);
    if (taskMatch) {
      const indent = taskMatch[1].length;
      const checked = taskMatch[3].toLowerCase() === 'x';
      const text2 = taskMatch[4];
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, level: 0, items: [] };
      }
      list.items.push({ text: text2, level: Math.floor(indent / 2), checked });
      continue;
    }

    // Bullet list: - / * / + with optional indentation
    const bulletMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
    if (bulletMatch) {
      const indent = bulletMatch[1].length;
      const text2 = bulletMatch[3];
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, level: 0, items: [] };
      }
      list.items.push({ text: text2, level: Math.floor(indent / 2) });
      continue;
    }

    // Numbered list: 1. / 2. / 3. with optional indentation
    const numberedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (numberedMatch) {
      const indent = numberedMatch[1].length;
      const text2 = numberedMatch[3];
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, level: 0, items: [] };
      }
      list.items.push({ text: text2, level: Math.floor(indent / 2) });
      continue;
    }

    // Table: header | col2 | col3 followed by --- | --- | ---
    const tableMatch = line.match(/^\|(.+)\|\s*$/);
    const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
    if (tableMatch && /^\|?[\s-:|]+\|[\s-:|]+$/.test(nextLine)) {
      flushList();
      // Parse header
      const headerCells = tableMatch[1].split('|').map(c => c.trim());
      // Skip the separator line
      i += 1;
      // Collect body rows
      const bodyRows: string[][] = [];
      while (i + 1 < lines.length && /^\|(.+)\|\s*$/.test(lines[i + 1])) {
        i += 1;
        const rowMatch = lines[i].match(/^\|(.+)\|\s*$/);
        if (rowMatch) {
          bodyRows.push(rowMatch[1].split('|').map(c => c.trim()));
        }
      }
      blocks.push(renderTable(headerCells, bodyRows, `${keyPrefix}-tbl-${key++}`));
      continue;
    }

    // Regular paragraph
    flushList();
    blocks.push(<p key={`${keyPrefix}-p-${key++}`} className="text-text-primary leading-relaxed">{renderInline(line, `${keyPrefix}-p-${key}`)}</p>);
  }
  flushList();
  return <>{blocks}</>;
}

/** Nest flat list items (with `level`) into a tree for nested <ul>/<ol>. */
interface NestedItem {
  text: string;
  checked?: boolean;
  children: NestedItem[];
}

function nestListItems(items: { text: string; level: number; checked?: boolean }[]): NestedItem[] {
  const roots: NestedItem[] = [];
  const stack: NestedItem[] = [];
  for (const it of items) {
    while (stack.length > it.level) stack.pop();
    const node: NestedItem = { text: it.text, checked: it.checked, children: [] };
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return roots;
}

function renderList(items: NestedItem[], keyPrefix: string, keyRef: number): React.ReactNode {
  return items.map((it, i) => {
    const hasChildren = it.children.length > 0;
    const checked = it.checked;
    return (
      <li key={`${keyPrefix}-li-${keyRef}-${i}`} className={hasChildren ? 'mb-0.5' : ''}>
        {checked !== undefined ? (
          <span className="flex items-start gap-1.5">
            <input
              type="checkbox"
              checked={checked}
              readOnly
              className="mt-0.5 accent-accent"
            />
            <span className="flex-1">{renderInline(it.text, `${keyPrefix}-li-${keyRef}-${i}`)}</span>
          </span>
        ) : (
          <>{renderInline(it.text, `${keyPrefix}-li-${keyRef}-${i}`)}</>
        )}
        {hasChildren && (
          <ul className="ml-4 mt-0.5 space-y-0.5 list-disc">
            {renderList(it.children, `${keyPrefix}-li-${keyRef}-${i}`, keyRef + 1)}
          </ul>
        )}
      </li>
    );
  });
}

function renderTable(headerCells: string[], bodyRows: string[][], keyPrefix: string): React.ReactNode {
  return (
    <div key={keyPrefix} className="overflow-x-auto my-1.5">
      <table className="min-w-full border-collapse text-2xs">
        <thead>
          <tr>
            {headerCells.map((c, i) => (
              <th
                key={`${keyPrefix}-th-${i}`}
                className="border border-border-default px-2 py-1 text-left font-semibold bg-bg-tertiary text-text-primary"
              >
                {renderInline(c, `${keyPrefix}-th-${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, r) => (
            <tr key={`${keyPrefix}-tr-${r}`} className="even:bg-bg-hover/30">
              {row.map((c, ci) => (
                <td key={`${keyPrefix}-td-${r}-${ci}`} className="border border-border-default px-2 py-1 text-text-secondary">
                  {renderInline(c, `${keyPrefix}-td-${r}-${ci}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Code block with syntax highlighting + copy button ──────────────────────

function CodeBlock({ content, lang }: { content: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const supportedLang = resolveLang(lang);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => { /* ignore */ });
  }, [content]);

  // Highlight each line independently — the tokenizer is line-based.
  const highlightedHtml = useMemo(() => {
    if (supportedLang === 'text' || !supportedLang) {
      return content;
    }
    const lines = content.split('\n');
    const htmlParts: string[] = [];
    for (const line of lines) {
      htmlParts.push(tokensToHtml(tokenizeLine(line, supportedLang)));
    }
    return htmlParts.join('\n');
  }, [content, supportedLang]);

  return (
    <div className="relative my-1.5 group/code">
      <pre className="bg-bg-tertiary border border-border-subtle rounded p-2 pr-8 text-2xs font-mono overflow-x-auto max-h-80 scrollbar-thin">
        <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
      </pre>
      {lang && (
        <span className="absolute top-1 left-2 text-3xs text-text-tertiary uppercase font-mono pointer-events-none">
          {lang}
        </span>
      )}
      <button
        onClick={handleCopy}
        className="absolute top-1 right-1 icon-btn !w-5 !h-5 hover:text-accent"
        title="Copy code"
        aria-label="Copy code"
      >
        {copied ? <Check size={10} className="text-status-added" /> : <Copy size={10} />}
      </button>
    </div>
  );
}

// ── Top-level Markdown renderer ─────────────────────────────────────────────

export function MarkdownRenderer({ text }: { text: string }) {
  const blocks = useMemo(() => splitBlocks(text), [text]);
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        if (block.kind === 'code') {
          return <CodeBlock key={i} content={block.content} lang={block.lang} />;
        }
        return <div key={i}>{renderTextSegment(block.content, `b${i}`)}</div>;
      })}
    </div>
  );
}

export default MarkdownRenderer;
