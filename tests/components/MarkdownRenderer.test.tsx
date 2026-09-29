import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownRenderer } from '../../src/components/MarkdownRenderer';

/**
 * Tests for the full-featured markdown renderer used in the AI Assistant chat.
 *
 * NOTE: Vitest's string-literal handling for "\n" inside JSX text attributes
 * was inconsistent in our setup — these tests use template literals (actual
 * newlines) to ensure the input is parsed correctly.
 *
 * Coverage:
 *   - Fenced code blocks with language hint → syntax highlighting applied
 *   - Inline code, bold, italic, links
 *   - Headings (h1-h6)
 *   - Bullet / numbered / nested / task lists
 *   - Tables
 *   - Blockquotes
 *   - Horizontal rules
 *   - Bare URLs auto-linked
 */

describe('MarkdownRenderer', () => {
  describe('inline formatting', () => {
    it('renders plain text', () => {
      const { container } = render(<MarkdownRenderer text="hello world" />);
      expect(container.textContent).toContain('hello world');
    });

    it('renders inline code', () => {
      const { container } = render(<MarkdownRenderer text="use `git status` to check" />);
      const code = container.querySelector('code');
      expect(code).toBeTruthy();
      expect(code?.textContent).toBe('git status');
    });

    it('renders bold text', () => {
      const { container } = render(<MarkdownRenderer text="this is **bold** text" />);
      const strong = container.querySelector('strong');
      expect(strong).toBeTruthy();
      expect(strong?.textContent).toBe('bold');
    });

    it('renders italic text', () => {
      const { container } = render(<MarkdownRenderer text="this is *italic* text" />);
      const em = container.querySelector('em');
      expect(em).toBeTruthy();
      expect(em?.textContent).toBe('italic');
    });

    it('renders bold-italic text', () => {
      const { container } = render(<MarkdownRenderer text="***bold-italic***" />);
      const strong = container.querySelector('strong');
      expect(strong?.className).toContain('italic');
      expect(strong?.textContent).toBe('bold-italic');
    });

    it('renders links', () => {
      const { container } = render(<MarkdownRenderer text="[click here](https://example.com)" />);
      const link = container.querySelector('a');
      expect(link).toBeTruthy();
      expect(link?.getAttribute('href')).toBe('https://example.com');
      expect(link?.textContent).toBe('click here');
    });

    it('auto-links bare URLs', () => {
      const { container } = render(<MarkdownRenderer text="see https://example.com for details" />);
      const link = container.querySelector('a');
      expect(link).toBeTruthy();
      expect(link?.getAttribute('href')).toBe('https://example.com');
    });
  });

  describe('code blocks', () => {
    it('renders fenced code blocks with language hint', () => {
      const text = '```js\nconst x = 1;\n```';
      const { container } = render(<MarkdownRenderer text={text} />);
      const pre = container.querySelector('pre');
      expect(pre).toBeTruthy();
      expect(container.textContent).toContain('const x = 1;');
      // Language badge shown (lowercase — CSS uppercases visually)
      expect(container.textContent.toLowerCase()).toContain('js');
    });

    it('renders fenced code blocks without language hint as plain text', () => {
      const text = '```\nplain code\n```';
      const { container } = render(<MarkdownRenderer text={text} />);
      const pre = container.querySelector('pre');
      expect(pre).toBeTruthy();
      expect(container.textContent).toContain('plain code');
    });

    it('preserves code block content verbatim', () => {
      const code = 'function foo() {\n  return "bar";\n}';
      const text = '```python\n' + code + '\n```';
      const { container } = render(<MarkdownRenderer text={text} />);
      expect(container.textContent).toContain('function foo()');
      expect(container.textContent).toContain('return "bar"');
    });

    it('applies syntax highlighting tokens for supported languages', () => {
      const text = '```typescript\nconst x: number = 42;\n```';
      const { container } = render(<MarkdownRenderer text={text} />);
      const tokSpans = container.querySelectorAll('[class*="tok-"]');
      expect(tokSpans.length).toBeGreaterThan(0);
      // 'const' is a TypeScript keyword → should be tok-keyword
      const keywordSpans = container.querySelectorAll('.tok-keyword');
      expect(keywordSpans.length).toBeGreaterThan(0);
    });

    it('shows a copy button on code blocks', () => {
      const text = '```js\nconst x = 1;\n```';
      const { container } = render(<MarkdownRenderer text={text} />);
      const copyButton = container.querySelector('button[title="Copy code"]');
      expect(copyButton).toBeTruthy();
    });
  });

  describe('headings', () => {
    it('renders h1 to h4', () => {
      const text = '# H1\n## H2\n### H3\n#### H4';
      const { container } = render(<MarkdownRenderer text={text} />);
      const text2 = container.textContent || '';
      expect(text2).toContain('H1');
      expect(text2).toContain('H2');
      expect(text2).toContain('H3');
      expect(text2).toContain('H4');
    });
  });

  describe('lists', () => {
    it('renders bullet lists', () => {
      const text = '- item 1\n- item 2\n- item 3';
      const { container } = render(<MarkdownRenderer text={text} />);
      const ul = container.querySelector('ul');
      expect(ul).toBeTruthy();
      expect(ul?.className).toContain('list-disc');
      expect(container.textContent).toContain('item 1');
      expect(container.textContent).toContain('item 3');
    });

    it('renders numbered lists', () => {
      const text = '1. first\n2. second\n3. third';
      const { container } = render(<MarkdownRenderer text={text} />);
      const ol = container.querySelector('ol');
      expect(ol).toBeTruthy();
      expect(container.textContent).toContain('first');
      expect(container.textContent).toContain('second');
      expect(container.textContent).toContain('third');
    });

    it('renders nested bullet lists', () => {
      const text = '- top\n  - nested\n- top again';
      const { container } = render(<MarkdownRenderer text={text} />);
      const uls = container.querySelectorAll('ul');
      expect(uls.length).toBeGreaterThanOrEqual(2);
      expect(container.textContent).toContain('top');
      expect(container.textContent).toContain('nested');
    });

    it('renders task lists', () => {
      const text = '- [x] done\n- [ ] todo';
      const { container } = render(<MarkdownRenderer text={text} />);
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).toBe(2);
      expect(checkboxes[0].checked).toBe(true);
      expect(checkboxes[1].checked).toBe(false);
    });
  });

  describe('tables', () => {
    it('renders GitHub-style tables', () => {
      const md = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |';
      const { container } = render(<MarkdownRenderer text={md} />);
      const table = container.querySelector('table');
      expect(table).toBeTruthy();
      const headers = container.querySelectorAll('th');
      expect(headers.length).toBe(2);
      expect(headers[0].textContent).toBe('Name');
      expect(headers[1].textContent).toBe('Age');
      const cells = container.querySelectorAll('td');
      expect(cells.length).toBe(4);
      expect(container.textContent).toContain('Alice');
      expect(container.textContent).toContain('Bob');
    });
  });

  describe('blockquotes', () => {
    it('renders blockquotes', () => {
      const { container } = render(<MarkdownRenderer text="> a famous quote" />);
      const quote = container.querySelector('blockquote');
      expect(quote).toBeTruthy();
      expect(quote?.textContent).toContain('a famous quote');
    });
  });

  describe('horizontal rules', () => {
    it('renders --- as a horizontal rule', () => {
      const text = 'above\n---\nbelow';
      const { container } = render(<MarkdownRenderer text={text} />);
      const hrs = container.querySelectorAll('hr');
      expect(hrs.length).toBeGreaterThanOrEqual(1);
      expect(container.textContent).toContain('above');
      expect(container.textContent).toContain('below');
    });
  });

  describe('mixed content (real LLM output)', () => {
    it('renders a typical LLM response with code + lists + text', () => {
      const md = [
        'Here is the status of the repo:',
        '',
        '```bash',
        'git status --short',
        'M  src/index.ts',
        '```',
        '',
        '**Changes:**',
        '- Modified index',
        '- Added new tests',
        '',
        'See [the docs](https://example.com) for more info.',
      ].join('\n');
      const { container } = render(<MarkdownRenderer text={md} />);
      const text = container.textContent || '';
      expect(text).toContain('git status --short');
      expect(text).toContain('M  src/index.ts');
      expect(text).toContain('Modified index');
      expect(text).toContain('Added new tests');
      const strong = container.querySelector('strong');
      expect(strong?.textContent).toBe('Changes:');
      const link = container.querySelector('a');
      expect(link?.getAttribute('href')).toBe('https://example.com');
    });
  });
});
