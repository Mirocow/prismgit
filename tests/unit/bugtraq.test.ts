import { describe, it, expect } from 'vitest';
import { linkifyCommitMessage } from '../../src/lib/bugtraq';
import type { BugtraqConfig } from '../../src/lib/api';

describe('bugtraq.linkifyCommitMessage', () => {
  const cfg: BugtraqConfig = {
    url: 'https://jira.example.com/browse/%BUGID%',
    logregex: '(PROJ-\\d+)',
  };

  it('returns plain text when config is null', () => {
    expect(linkifyCommitMessage('fix PROJ-1', null)).toEqual([{ text: 'fix PROJ-1' }]);
  });

  it('linkifies issue ids using logregex capture group', () => {
    const segs = linkifyCommitMessage('fix PROJ-123 and PROJ-7', cfg);
    expect(segs).toEqual([
      { text: 'fix ' },
      { text: 'PROJ-123', url: 'https://jira.example.com/browse/PROJ-123' },
      { text: ' and ' },
      { text: 'PROJ-7', url: 'https://jira.example.com/browse/PROJ-7' },
    ]);
  });

  it('supports %PROJECT% substitution with project prefixes', () => {
    const p: BugtraqConfig = {
      url: 'https://t.example.com/%PROJECT%/%BUGID%',
      logregex: '([A-Z]+-\\d+)',
      projects: ['ABC'],
    };
    const segs = linkifyCommitMessage('see ABC-42', p);
    expect(segs[1]).toEqual({ text: 'ABC-42', url: 'https://t.example.com/ABC/42' });
  });

  it('degrades gracefully on an invalid regex', () => {
    const bad: BugtraqConfig = { url: 'x%BUGID%', logregex: '([unclosed' };
    expect(linkifyCommitMessage('hello', bad)).toEqual([{ text: 'hello' }]);
  });

  it('plain logregex without capture group uses the whole match', () => {
    const p: BugtraqConfig = { url: 'https://b.example.com/%BUGID%', logregex: '#\\d+' };
    const segs = linkifyCommitMessage('fix #77', p);
    expect(segs[1]).toEqual({ text: '#77', url: 'https://b.example.com/%2377' });
  });
});
