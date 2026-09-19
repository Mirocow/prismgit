/**
 * Simple markdown preview for commit messages.
 * Renders: headers, bold, italic, code, lists, links, code blocks.
 *
 * SECURITY: markdown links are sanitised — only `http:`/`https:`/`mailto:`
 * URLs are kept. `javascript:`, `data:`, `vbscript:` and other schemes are
 * stripped, because commit messages are user-controlled and a malicious
 * `[click](javascript:alert(1))` payload would otherwise render as a
 * clickable `<a href="javascript:...">` via `dangerouslySetInnerHTML`.
 */
import { useMemo } from 'react';
import { useI18n } from '../lib/i18n';

const SAFE_URL_RE = /^(https?:\/\/|mailto:)/i;

function sanitizeHref(href: string): string {
  const trimmed = href.trim();
  if (SAFE_URL_RE.test(trimmed)) return trimmed;
  return '';
}

export function CommitMarkdownPreview({ content }: { content: string }) {
  const { t } = useI18n();
  const html = useMemo(() => {
    if (!content.trim()) return '<div class="text-text-tertiary italic">' + t('changes.previewPlaceholder') + '</div>';

    let html = content
      // Escape HTML
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

      // Code blocks (```...```)
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-bg-tertiary p-2 rounded text-2xs font-mono overflow-x-auto">$2</pre>')

      // Inline code
      .replace(/`([^`]+)`/g, '<code class="bg-bg-tertiary px-1 rounded text-2xs font-mono">$1</code>')

      // Headers
      .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold mt-2 mb-1">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 class="text-sm font-semibold mt-2 mb-1">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 class="text-sm font-bold mt-2 mb-1">$1</h1>')

      // Bold and italic
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')

      // Links — sanitize href (XSS defence: only http(s)/mailto: are allowed).
      // Unsafe URLs become plain text labels with no <a> wrapper.
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) => {
        const safe = sanitizeHref(href);
        return safe
          ? `<a href="${safe}" class="text-accent underline" target="_blank" rel="noopener noreferrer">${label}</a>`
          : `<span class="text-text-tertiary">${label}</span>`;
      })

      // Lists
      .replace(/^[\s]*[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
      .replace(/^[\s]*\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')

      // Line breaks
      .replace(/\n/g, '<br/>');

    return html;
  }, [content, t]);

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
