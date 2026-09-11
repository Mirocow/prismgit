/**
 * Unit tests for the syntax highlighter.
 *
 * Verifies:
 *   - detectLang correctly identifies language from file extension
 *   - tokenizeLine produces expected token classes for popular languages
 *     (Python, Go, JSON, CSV, JS, TS, Java, C, C++, Rust, YAML, Bash, Markdown)
 *   - tokensToHtml emits properly escaped HTML spans
 */
import { describe, it, expect } from 'vitest';
import {
  detectLang, tokenizeLine, tokensToHtml, type Token,
} from '../../src/lib/syntaxHighlight';

describe('syntaxHighlight — detectLang', () => {
  it('detects Python from .py extension', () => {
    expect(detectLang('foo.py')).toBe('python');
    expect(detectLang('path/to/bar.py')).toBe('python');
  });

  it('detects Go from .go extension', () => {
    expect(detectLang('main.go')).toBe('go');
  });

  it('detects JSON from .json extension', () => {
    expect(detectLang('package.json')).toBe('json');
  });

  it('detects CSV from .csv extension', () => {
    expect(detectLang('data.csv')).toBe('csv');
    expect(detectLang('data.tsv')).toBe('csv');
  });

  it('detects JavaScript / TypeScript from .js/.jsx/.ts/.tsx', () => {
    expect(detectLang('app.js')).toBe('javascript');
    expect(detectLang('app.mjs')).toBe('javascript');
    expect(detectLang('app.jsx')).toBe('javascript');
    expect(detectLang('app.ts')).toBe('typescript');
    expect(detectLang('app.tsx')).toBe('typescript');
  });

  it('detects Java from .java and .kt', () => {
    expect(detectLang('Main.java')).toBe('java');
    expect(detectLang('Main.kt')).toBe('java');
  });

  it('detects C / C++ from .c/.h/.cpp/.cc/.cxx/.hpp/.hh', () => {
    expect(detectLang('stdio.h')).toBe('c');
    expect(detectLang('main.c')).toBe('c');
    expect(detectLang('main.cpp')).toBe('cpp');
    expect(detectLang('main.cc')).toBe('cpp');
    expect(detectLang('main.cxx')).toBe('cpp');
    expect(detectLang('main.hpp')).toBe('cpp');
    expect(detectLang('main.hh')).toBe('cpp');
  });

  it('detects Rust from .rs', () => {
    expect(detectLang('main.rs')).toBe('rust');
  });

  it('detects YAML from .yml/.yaml', () => {
    expect(detectLang('config.yml')).toBe('yaml');
    expect(detectLang('config.yaml')).toBe('yaml');
  });

  it('detects Bash from .sh/.bash/.zsh', () => {
    expect(detectLang('script.sh')).toBe('bash');
    expect(detectLang('script.bash')).toBe('bash');
    expect(detectLang('script.zsh')).toBe('bash');
  });

  it('detects Markdown from .md/.markdown', () => {
    expect(detectLang('README.md')).toBe('markdown');
    expect(detectLang('README.markdown')).toBe('markdown');
  });

  it('falls back to text for unknown extensions', () => {
    expect(detectLang('unknown.xyz')).toBe('text');
    expect(detectLang('noext')).toBe('text');
  });
});

describe('syntaxHighlight — tokenizeLine (Python)', () => {
  it('tokenizes a def with comments and strings', () => {
    const tokens = tokenizeLine('def hello(name: str = "world"):', 'python');
    // Should contain 'def' as keyword
    const defTok = tokens.find((t) => t.text === 'def');
    expect(defTok).toBeDefined();
    expect(defTok?.cls).toBe('tok-keyword');
    // Should contain 'hello' as function (followed by '(')
    const fnTok = tokens.find((t) => t.text === 'hello');
    expect(fnTok).toBeDefined();
    expect(fnTok?.cls).toBe('tok-function');
    // Should contain '"world"' as string
    const strTok = tokens.find((t) => t.text === '"world"');
    expect(strTok).toBeDefined();
    expect(strTok?.cls).toBe('tok-string');
  });

  it('tokenizes a Python comment', () => {
    const tokens = tokenizeLine('# This is a comment', 'python');
    const cmtTok = tokens.find((t) => t.text.startsWith('#'));
    expect(cmtTok).toBeDefined();
    expect(cmtTok?.cls).toBe('tok-comment');
  });

  it('tokenizes Python keywords', () => {
    const tokens = tokenizeLine('if True: pass', 'python');
    const ifTok = tokens.find((t) => t.text === 'if');
    const trueTok = tokens.find((t) => t.text === 'True');
    const passTok = tokens.find((t) => t.text === 'pass');
    expect(ifTok?.cls).toBe('tok-keyword');
    expect(trueTok?.cls).toBe('tok-keyword');
    expect(passTok?.cls).toBe('tok-keyword');
  });
});

describe('syntaxHighlight — tokenizeLine (Go)', () => {
  it('tokenizes a func declaration', () => {
    const tokens = tokenizeLine('func main() {', 'go');
    const fnTok = tokens.find((t) => t.text === 'func');
    const mainTok = tokens.find((t) => t.text === 'main');
    expect(fnTok?.cls).toBe('tok-keyword');
    // 'main' followed by '(' → function
    expect(mainTok?.cls).toBe('tok-function');
  });

  it('tokenizes Go comments', () => {
    const tokens = tokenizeLine('// Golang comment', 'go');
    const cmtTok = tokens.find((t) => t.text.startsWith('//'));
    expect(cmtTok?.cls).toBe('tok-comment');
  });
});

describe('syntaxHighlight — tokenizeLine (JSON)', () => {
  it('tokenizes a key:value pair', () => {
    const tokens = tokenizeLine('"version": "1.5.0",', 'json');
    // Key string (followed by ':') is 'tok-type'
    const keyTok = tokens.find((t) => t.text === '"version"');
    expect(keyTok).toBeDefined();
    expect(keyTok?.cls).toBe('tok-type');
    // Value string is 'tok-string'
    const valTok = tokens.find((t) => t.text === '"1.5.0"');
    expect(valTok).toBeDefined();
    expect(valTok?.cls).toBe('tok-string');
  });

  it('tokenizes JSON numbers and booleans', () => {
    const tokens = tokenizeLine('"port": 8080, "enabled": true', 'json');
    const numTok = tokens.find((t) => t.text === '8080');
    const boolTok = tokens.find((t) => t.text === 'true');
    expect(numTok?.cls).toBe('tok-number');
    expect(boolTok?.cls).toBe('tok-keyword');
  });
});

describe('syntaxHighlight — tokenizeLine (CSV)', () => {
  it('tokenizes a CSV row with quoted fields', () => {
    const tokens = tokenizeLine('"name","age","city"', 'csv');
    const strTokens = tokens.filter((t) => t.cls === 'tok-string');
    expect(strTokens.length).toBe(3);
  });

  it('tokenizes numeric CSV cells as numbers', () => {
    const tokens = tokenizeLine('123,456,789', 'csv');
    const numTokens = tokens.filter((t) => t.cls === 'tok-number');
    expect(numTokens.length).toBe(3);
  });
});

describe('syntaxHighlight — tokenizeLine (JavaScript/TypeScript)', () => {
  it('tokenizes a const declaration with template literal', () => {
    const tokens = tokenizeLine('const name = "value";', 'javascript');
    const constTok = tokens.find((t) => t.text === 'const');
    const strTok = tokens.find((t) => t.text === '"value"');
    expect(constTok?.cls).toBe('tok-keyword');
    expect(strTok?.cls).toBe('tok-string');
  });

  it('tokenizes TS type keywords', () => {
    const tokens = tokenizeLine('interface Foo { bar: string }', 'typescript');
    const ifaceTok = tokens.find((t) => t.text === 'interface');
    expect(ifaceTok?.cls).toBe('tok-keyword');
    // 'Foo' is capitalized → tok-type
    const fooTok = tokens.find((t) => t.text === 'Foo');
    expect(fooTok?.cls).toBe('tok-type');
  });
});

describe('syntaxHighlight — tokenizeLine (Java)', () => {
  it('tokenizes a class declaration', () => {
    const tokens = tokenizeLine('public class Main {', 'java');
    const pubTok = tokens.find((t) => t.text === 'public');
    const classTok = tokens.find((t) => t.text === 'class');
    expect(pubTok?.cls).toBe('tok-keyword');
    expect(classTok?.cls).toBe('tok-keyword');
    // 'Main' capitalized → type
    const mainTok = tokens.find((t) => t.text === 'Main');
    expect(mainTok?.cls).toBe('tok-type');
  });
});

describe('syntaxHighlight — tokenizeLine (C)', () => {
  it('tokenizes a function declaration', () => {
    const tokens = tokenizeLine('int main(int argc) {', 'c');
    const intTok = tokens.find((t) => t.text === 'int');
    const mainTok = tokens.find((t) => t.text === 'main');
    expect(intTok?.cls).toBe('tok-keyword');
    expect(mainTok?.cls).toBe('tok-function');
  });
});

describe('syntaxHighlight — tokenizeLine (YAML)', () => {
  it('tokenizes key:value', () => {
    const tokens = tokenizeLine('version: 1.5.0', 'yaml');
    const keyTok = tokens.find((t) => t.text === 'version');
    expect(keyTok?.cls).toBe('tok-type');
  });

  it('tokenizes YAML booleans', () => {
    const tokens = tokenizeLine('enabled: true', 'yaml');
    const boolTok = tokens.find((t) => t.text === 'true');
    expect(boolTok?.cls).toBe('tok-keyword');
  });

  it('tokenizes YAML comments', () => {
    const tokens = tokenizeLine('# Comment', 'yaml');
    const cmtTok = tokens.find((t) => t.text.startsWith('#'));
    expect(cmtTok?.cls).toBe('tok-comment');
  });
});

describe('syntaxHighlight — tokenizeLine (Bash)', () => {
  it('tokenizes bash keywords and variables', () => {
    const tokens = tokenizeLine('if [ "$x" = "y" ]; then', 'bash');
    const ifTok = tokens.find((t) => t.text === 'if');
    expect(ifTok?.cls).toBe('tok-keyword');
  });
});

describe('syntaxHighlight — tokensToHtml', () => {
  it('emits proper spans for non-plain tokens', () => {
    const tokens: Token[] = [
      { text: 'def', cls: 'tok-keyword' },
      { text: ' ', cls: 'tok-plain' },
      { text: '"hi"', cls: 'tok-string' },
    ];
    const html = tokensToHtml(tokens);
    expect(html).toContain('<span class="tok-keyword">def</span>');
    // " quotes are escaped to &quot; in HTML for safety
    expect(html).toContain('<span class="tok-string">&quot;hi&quot;</span>');
    expect(html).toContain(' ');
  });

  it('escapes HTML special characters', () => {
    const tokens: Token[] = [
      { text: '<script>', cls: 'tok-plain' },
    ];
    const html = tokensToHtml(tokens);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('renders empty tokens as &nbsp;', () => {
    const tokens: Token[] = [
      { text: '', cls: 'tok-plain' },
    ];
    const html = tokensToHtml(tokens);
    expect(html).toContain('&nbsp;');
  });
});
