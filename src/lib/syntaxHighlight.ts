/**
 * Lightweight syntax highlighter for the conflict merge view.
 *
 * Design goals:
 *   - Tokenize source code into spans with semantic CSS classes — the
 *     CONFLICT HIGHLIGHT (background color) is applied SEPARATELY by
 *     `buildHighlightedHtml` so it doesn't clobber the syntax colors.
 *   - Support popular languages: Python, Go, JSON, CSV, JavaScript/TypeScript,
 *     Java, C/C++, Rust, YAML, Bash, Markdown.
 *   - Regex-based tokenizer — no dependency on a syntax highlighting
 *     library (keep bundle small). For ~99% of files this is good enough;
 *     complex constructs (nested template literals, heredocs) fall back
 *     to plain text.
 *
 * Color scheme (semantic classes — themed via CSS variables):
 *   - tok-keyword   (if/else/for/func/def/class/etc.)
 *   - tok-string    (single/double/triple-quoted, template literals)
 *   - tok-number    (123, 0x1f, 1.5e-3)
 *   - tok-comment   (# ... or // ... or slash-star ... star-slash)
 *   - tok-function  (function-call identifiers)
 *   - tok-type      (TypeScript types, Go struct names, Java classes)
 *   - tok-operator  (+ - * / = == != etc.)
 *   - tok-punct     (, ; { } ( ) [ ])
 *   - tok-plain     (default text)
 *
 * The highlighter returns an array of {text, cls} tokens. Caller joins them
 * into HTML with proper escaping.
 */

export interface Token {
  text: string;
  cls: string;
}

/** Language identifiers supported by the highlighter. */
export type SupportedLang =
  | 'python' | 'go' | 'json' | 'csv' | 'javascript' | 'typescript'
  | 'java' | 'c' | 'cpp' | 'rust' | 'yaml' | 'bash' | 'markdown'
  | 'text';

/** Map file extensions to SupportedLang. */
const EXT_MAP: Record<string, SupportedLang> = {
  py: 'python',
  go: 'go',
  json: 'json',
  csv: 'csv', tsv: 'csv',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  java: 'java', kt: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  rs: 'rust',
  yml: 'yaml', yaml: 'yaml',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  md: 'markdown', markdown: 'markdown',
};

/** Detect language from a file path. */
export function detectLang(filePath: string): SupportedLang {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return EXT_MAP[ext] || 'text';
}

/** Escape a string for safe insertion into HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Tokenize a single line of source code for the given language.
 * Returns an array of tokens — each token is a {text, cls} pair.
 * Whitespace is preserved as a 'plain' token so the line layout stays intact.
 *
 * The tokenizer is a hybrid: a single master regex per language captures
 * the next token (string / comment / number / keyword / identifier), and
 * everything in between is emitted as plain text.
 */
export function tokenizeLine(line: string, lang: SupportedLang): Token[] {
  if (lang === 'text' || lang === 'csv' || lang === 'markdown') {
    // CSV: highlight the separator (comma) and quoted fields
    if (lang === 'csv') return tokenizeCsv(line);
    // Markdown: simple # header / * list / `code` highlighting
    if (lang === 'markdown') return tokenizeMarkdown(line);
    return [{ text: line, cls: 'tok-plain' }];
  }
  return TOKENIZERS[lang](line);
}

/** Build HTML from a token array. */
export function tokensToHtml(tokens: Token[]): string {
  let html = '';
  for (const t of tokens) {
    const escaped = escapeHtml(t.text);
    if (t.cls === 'tok-plain' || !t.cls) {
      html += escaped || '&nbsp;';
    } else {
      html += `<span class="${t.cls}">${escaped || '&nbsp;'}</span>`;
    }
  }
  return html;
}

// ===== Per-language tokenizers =============================================

const TOKENIZERS: Record<Exclude<SupportedLang, 'text' | 'csv' | 'markdown'>, (line: string) => Token[]> = {
  python: tokenizePython,
  go: tokenizeGo,
  json: tokenizeJson,
  javascript: tokenizeJsLike,
  typescript: tokenizeJsLike,
  java: tokenizeJava,
  c: tokenizeC,
  cpp: tokenizeCpp,
  rust: tokenizeRust,
  yaml: tokenizeYaml,
  bash: tokenizeBash,
};

// Common keyword sets per language
const PY_KEYWORDS = new Set('def class return if elif else for while break continue pass try except finally raise with lambda yield global nonlocal import from as assert del in is not and or None True False self cls'.split(/\s+/));
const GO_KEYWORDS = new Set('func var const type struct interface package import return if else for range switch case default break continue fallthrough go defer select chan map make new nil append print println'.split(/\s+/));
const JS_KEYWORDS = new Set('const let var function class import export from default extends implements public private protected readonly static async await new return if else for while do switch case break continue throw try catch finally typeof instanceof in of void delete yield this super null undefined true false as'.split(/\s+/));
const TS_EXTRA = new Set('type enum namespace abstract declare readonly keyof infer is interface implements'.split(/\s+/));
const JAVA_KEYWORDS = new Set('public private protected class interface extends implements static final void int long double float boolean char byte short new return if else for while do switch case break continue throw throws try catch finally import package this super null true false'.split(/\s+/));
const C_KEYWORDS = new Set('int long short char float double void unsigned signed const static extern struct union enum typedef return if else for while do switch case break continue goto sizeof'.split(/\s+/));
const CPP_KEYWORDS = new Set('int long short char float double void unsigned signed const static extern struct class union enum typedef return if else for while do switch case break continue new delete try catch throw namespace using template typename virtual override public private protected nullptr true false'.split(/\s+/));
const RUST_KEYWORDS = new Set('fn let mut const static struct enum trait impl pub use mod crate self super as return if else for while loop break continue match true false Some None Ok Err'.split(/\s+/));
const BASH_KEYWORDS = new Set('if then else elif fi for in do done while case esac function return exit echo export local readonly unset shift source alias'.split(/\s+/));

/**
 * Generic identifier-and-keyword tokenizer.
 * Takes a line + a keyword set, returns tokens.
 * Strings, comments and numbers are detected first; remaining identifiers
 * are checked against the keyword set.
 */
function tokenizeIdentifiers(line: string, keywords: Set<string>, types: Set<string> = new Set()): Token[] {
  const tokens: Token[] = [];
  // Master regex: matches strings, comments, numbers, identifiers, operators
  // Order matters: longest match wins for the first matching alternative.
  const re = /(#.*$|\/\/.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?[fFuUlL]*\b|0[xX][0-9a-fA-F_]+)|([A-Za-z_$][A-Za-z0-9_$]*)|(\s+)|([+\-*/%=<>!&|^~?:]+)|([{}()\[\];,.])/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) {
      tokens.push({ text: line.slice(last, m.index), cls: 'tok-plain' });
    }
    if (m[1]) tokens.push({ text: m[1], cls: 'tok-comment' });
    else if (m[2]) tokens.push({ text: m[2], cls: 'tok-string' });
    else if (m[3]) tokens.push({ text: m[3], cls: 'tok-number' });
    else if (m[4]) {
      const id = m[4];
      if (keywords.has(id)) tokens.push({ text: id, cls: 'tok-keyword' });
      else if (types.has(id)) tokens.push({ text: id, cls: 'tok-type' });
      // Function call detection: identifier followed by '('
      else if (line[re.lastIndex] === '(') tokens.push({ text: id, cls: 'tok-function' });
      // Capitalized identifier → likely a type/class
      else if (/^[A-Z]/.test(id)) tokens.push({ text: id, cls: 'tok-type' });
      else tokens.push({ text: id, cls: 'tok-plain' });
    }
    else if (m[5]) tokens.push({ text: m[5], cls: 'tok-plain' });
    else if (m[6]) tokens.push({ text: m[6], cls: 'tok-operator' });
    else if (m[7]) tokens.push({ text: m[7], cls: 'tok-punct' });
    last = re.lastIndex;
  }
  if (last < line.length) {
    tokens.push({ text: line.slice(last), cls: 'tok-plain' });
  }
  return tokens;
}

// Python: triple-quoted strings span multiple lines — we only do per-line here,
// so a """ string opener without a closer on the same line is treated as plain
// text. This is a known limitation; for typical conflict resolution it's fine.
function tokenizePython(line: string): Token[] {
  // Python uses # for comments and """ / ''' for triple-quoted strings
  // (handled per-line only — multi-line strings are out of scope).
  const re = /(#.*$)|(""".*?"""|'''.*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?\b|0[xX][0-9a-fA-F_]+)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|(\s+)|([+\-*/%=<>!@&|^~]+)|([(){}\[\];,.:])/g;
  return runRegex(line, re, PY_KEYWORDS);
}

function tokenizeGo(line: string): Token[] {
  // Go: // and /* */ comments, "..." and `...` strings, no Python-style triple
  const re = /(\/\/.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?[fFuUlL]*\b|0[xX][0-9a-fA-F_]+)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|(\s+)|([+\-*/%=<>!&|^~:=]+)|([(){}\[\];,.])/g;
  return runRegex(line, re, GO_KEYWORDS);
}

function tokenizeJson(line: string): Token[] {
  // JSON: only strings, numbers, true/false/null, keys (strings before ':')
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(\b-?\d+\.?\d*(?:[eE][+-]?\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)|(\s+)|([{}\[\]:,])/g;
  const tokens: Token[] = [];
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) tokens.push({ text: line.slice(last, m.index), cls: 'tok-plain' });
    if (m[1]) {
      // String — if followed by ':' it's a key (treat as 'tok-type' for color)
      tokens.push({ text: m[1], cls: m[2] ? 'tok-type' : 'tok-string' });
      if (m[2]) tokens.push({ text: m[2], cls: 'tok-plain' });
    }
    else if (m[3]) tokens.push({ text: m[3], cls: 'tok-number' });
    else if (m[4]) tokens.push({ text: m[4], cls: 'tok-keyword' });
    else if (m[5]) tokens.push({ text: m[5], cls: 'tok-plain' });
    else if (m[6]) tokens.push({ text: m[6], cls: 'tok-punct' });
    last = re.lastIndex;
  }
  if (last < line.length) tokens.push({ text: line.slice(last), cls: 'tok-plain' });
  return tokens;
}

function tokenizeJsLike(line: string): Token[] {
  const keywords = new Set([...JS_KEYWORDS]);
  // TypeScript adds a few extra keywords; both use the same tokenizer
  if (TS_EXTRA) for (const k of TS_EXTRA) keywords.add(k);
  const re = /(\/\/.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?[fFuUlL]*\b|0[xX][0-9a-fA-F_]+)|(\b[A-Za-z_$][A-Za-z0-9_$]*\b)|(\s+)|([+\-*/%=<>!&|^~?]+)|([(){}\[\];,.])/g;
  return runRegex(line, re, keywords);
}

function tokenizeJava(line: string): Token[] {
  const re = /(\/\/.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?[fFuUlLdD]*\b|0[xX][0-9a-fA-F_]+)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|(\s+)|([+\-*/%=<>!&|^~?]+)|([(){}\[\];,.])/g;
  return runRegex(line, re, JAVA_KEYWORDS);
}

function tokenizeC(line: string): Token[] {
  const re = /(\/\/.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?[fFuUlL]*\b|0[xX][0-9a-fA-F_]+)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|(\s+)|([+\-*/%=<>!&|^~?]+)|([(){}\[\];,.])/g;
  return runRegex(line, re, C_KEYWORDS);
}

function tokenizeCpp(line: string): Token[] {
  const re = /(\/\/.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?[fFuUlL]*\b|0[xX][0-9a-fA-F_]+)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|(\s+)|([+\-*/%=<>!&|^~?]+)|([(){}\[\];,.:])/g;
  return runRegex(line, re, CPP_KEYWORDS);
}

function tokenizeRust(line: string): Token[] {
  const re = /(\/\/.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"'|(?:[^'\\]|\\.)*')|(\b\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?[fFuUiL]*\b|0[xX][0-9a-fA-F_]+)|(\b[A-Za-z_][A-Za-z0-9_]*\b|!\b)|(\s+)|([+\-*/%=<>!&|^~?]+)|([(){}\[\];,.:])/g;
  return runRegex(line, re, RUST_KEYWORDS);
}

function tokenizeYaml(line: string): Token[] {
  // YAML: key: value, comments with #, lists with -, indentation-sensitive
  const tokens: Token[] = [];
  const re = /(#.*$)|(\b[A-Za-z_][A-Za-z0-9_\-]*\b)(\s*:)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b-?\d+\.?\d*\b)|(\btrue\b|\bfalse\b|\bnull\b|\byes\b|\bno\b|\bon\b|\boff\b)|(\s+)|([:\-{}\[\],])/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) tokens.push({ text: line.slice(last, m.index), cls: 'tok-plain' });
    if (m[1]) tokens.push({ text: m[1], cls: 'tok-comment' });
    else if (m[2]) {
      tokens.push({ text: m[2], cls: 'tok-type' });
      if (m[3]) tokens.push({ text: m[3], cls: 'tok-punct' });
    }
    else if (m[4]) tokens.push({ text: m[4], cls: 'tok-string' });
    else if (m[5]) tokens.push({ text: m[5], cls: 'tok-number' });
    else if (m[6]) tokens.push({ text: m[6], cls: 'tok-keyword' });
    else if (m[7]) tokens.push({ text: m[7], cls: 'tok-plain' });
    else if (m[8]) tokens.push({ text: m[8], cls: 'tok-punct' });
    last = re.lastIndex;
  }
  if (last < line.length) tokens.push({ text: line.slice(last), cls: 'tok-plain' });
  return tokens;
}

function tokenizeBash(line: string): Token[] {
  // Bash: # comments, $var, "..." and '...' strings
  const re = /(#.*$)|(\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|`(?:[^`\\]|\\.)*`)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b[A-Za-z_][A-Za-z0-9_\-]*\b)|(\s+)|([|&;<>()$]|&&|\|\||;;)/g;
  const tokens: Token[] = [];
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) tokens.push({ text: line.slice(last, m.index), cls: 'tok-plain' });
    if (m[1]) tokens.push({ text: m[1], cls: 'tok-comment' });
    else if (m[2]) tokens.push({ text: m[2], cls: 'tok-function' });
    else if (m[3]) tokens.push({ text: m[3], cls: 'tok-string' });
    else if (m[4]) {
      if (BASH_KEYWORDS.has(m[4])) tokens.push({ text: m[4], cls: 'tok-keyword' });
      else tokens.push({ text: m[4], cls: 'tok-plain' });
    }
    else if (m[5]) tokens.push({ text: m[5], cls: 'tok-plain' });
    else if (m[6]) tokens.push({ text: m[6], cls: 'tok-punct' });
    last = re.lastIndex;
  }
  if (last < line.length) tokens.push({ text: line.slice(last), cls: 'tok-plain' });
  return tokens;
}

function tokenizeCsv(line: string): Token[] {
  // CSV: comma-separated, optional "quoted fields"
  const tokens: Token[] = [];
  const re = /("(?:[^"\\]|\\.)*"|[^,]+|,)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const t = m[1];
    if (t === ',') tokens.push({ text: t, cls: 'tok-punct' });
    else if (t.startsWith('"')) tokens.push({ text: t, cls: 'tok-string' });
    else if (/^-?\d+\.?\d*$/.test(t)) tokens.push({ text: t, cls: 'tok-number' });
    else tokens.push({ text: t, cls: 'tok-plain' });
  }
  return tokens;
}

function tokenizeMarkdown(line: string): Token[] {
  // Markdown: # headers, * lists, `code`, **bold**
  const tokens: Token[] = [];
  if (/^#+\s/.test(line)) {
    tokens.push({ text: line, cls: 'tok-type' });
    return tokens;
  }
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))|([^\s`*\[]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m[1]) tokens.push({ text: m[1], cls: 'tok-string' });
    else if (m[2]) tokens.push({ text: m[2], cls: 'tok-keyword' });
    else if (m[3]) tokens.push({ text: m[3], cls: 'tok-function' });
    else if (m[4]) tokens.push({ text: m[4], cls: 'tok-type' });
    else if (m[5]) tokens.push({ text: m[5], cls: 'tok-plain' });
  }
  return tokens;
}

/** Shared regex runner for the identifier-based languages. */
function runRegex(line: string, re: RegExp, keywords: Set<string>): Token[] {
  const tokens: Token[] = [];
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) {
      tokens.push({ text: line.slice(last, m.index), cls: 'tok-plain' });
    }
    // Find the first non-undefined group
    let captured = false;
    for (let gi = 1; gi < m.length; gi++) {
      if (m[gi] !== undefined) {
        const text = m[gi];
        if (gi === 1) tokens.push({ text, cls: 'tok-comment' });
        else if (gi === 2) tokens.push({ text, cls: 'tok-string' });
        else if (gi === 3) tokens.push({ text, cls: 'tok-number' });
        else if (gi === 4) {
          if (keywords.has(text)) tokens.push({ text, cls: 'tok-keyword' });
          else if (line[re.lastIndex] === '(') tokens.push({ text, cls: 'tok-function' });
          else if (/^[A-Z]/.test(text)) tokens.push({ text, cls: 'tok-type' });
          else tokens.push({ text, cls: 'tok-plain' });
        }
        else if (gi === 5) tokens.push({ text, cls: 'tok-plain' });
        else if (gi === 6) tokens.push({ text, cls: 'tok-operator' });
        else if (gi === 7) tokens.push({ text, cls: 'tok-punct' });
        captured = true;
        break;
      }
    }
    if (!captured) {
      tokens.push({ text: m[0], cls: 'tok-plain' });
    }
    last = re.lastIndex;
  }
  if (last < line.length) {
    tokens.push({ text: line.slice(last), cls: 'tok-plain' });
  }
  return tokens;
}
