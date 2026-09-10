/**
 * Simple markdown preview for commit messages.
 * Renders: headers, bold, italic, code, lists, links, code blocks.
 */
import { useMemo } from 'react';
import { useI18n } from '../lib/i18n';

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

      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-accent underline">$1</a>')

      // Lists
      .replace(/^[\s]*[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
      .replace(/^[\s]*\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')

      // Line breaks
      .replace(/\n/g, '<br/>');

    return html;
  }, [content, t]);

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
