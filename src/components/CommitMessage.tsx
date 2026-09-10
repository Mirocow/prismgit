import { useState, useEffect, useMemo } from 'react';
import { api } from '../lib/api';
import { segmentMessageWithBugTraq, type BugTraqConfig } from '../lib/bugtraq';
import { useRepositoryStore } from '../stores/repositoryStore';

/**
 * Render a commit message with BugTraq link substitution.
 * Reads .gitbugtraq config from the repo (best-effort, cached per repo).
 * If no BugTraq config exists, renders the message as plain text.
 *
 * Usage:
 *   <CommitMessage text={entry.subject} />
 */
export function CommitMessage({ text, className = '' }: { text: string; className?: string }) {
  const repo = useRepositoryStore((s) => s.currentRepo);
  const [configs, setConfigs] = useState<BugTraqConfig[]>([]);

  // Load .gitbugtraq from repo root (best-effort, may not exist)
  useEffect(() => {
    if (!repo) return;
    let cancelled = false;
    (async () => {
      try {
        // Read .gitbugtraq via api.fs.readFile (works through IPC)
        const content = await api.fs.readFile(`${repo.path}/.gitbugtraq`).catch(() => '');
        if (cancelled) return;
        if (content && content.trim()) {
          setConfigs(parseBugTraqSafe(content));
        } else {
          // Try git config [bugtraq "..."] sections
          const list = await api.git.configList(repo.path, 'local').catch(() => []);
          if (cancelled) return;
          const bugtraqConfigs = parseBugTraqFromGitConfig(list.map(e => `${e.key} = ${e.value}`).join('\n'));
          if (bugtraqConfigs.length > 0) setConfigs(bugtraqConfigs);
        }
      } catch {
        /* ignore — fall back to plain text */
      }
    })();
    return () => { cancelled = true; };
  }, [repo]);

  const segments = useMemo(() => segmentMessageWithBugTraq(text, configs), [text, configs]);

  if (segments.length === 1 && !segments[0].link) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.link ? (
          <a
            key={i}
            href={seg.link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
            title={`Open in ${seg.link.source}: ${seg.link.url}`}
            onClick={(e) => {
              e.preventDefault();
              api.app.openExternal(seg.link!.url);
            }}
          >
            {seg.text}
          </a>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </span>
  );
}

/** Parse .gitbugtraq file content safely (no exceptions). */
function parseBugTraqSafe(content: string): BugTraqConfig[] {
  try {
    // Reuse the lib's parser
    const { parseBugTraqConfig } = require('../lib/bugtraq');
    return parseBugTraqConfig(content);
  } catch {
    return [];
  }
}

/** Parse bugtraq sections from `git config --list` output. */
function parseBugTraqFromGitConfig(configText: string): BugTraqConfig[] {
  // Convert "bugtraq.jira.url = https://..." → "[bugtraq "jira"]\nurl = ..."
  const sections = new Map<string, { [k: string]: string }>();
  for (const line of configText.split('\n')) {
    const m = line.match(/^bugtraq\.([^.\s]+)\.([a-z]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    const [, section, key, value] = m;
    if (!sections.has(section)) sections.set(section, {});
    let v = value.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    sections.get(section)![key.toLowerCase()] = v;
  }
  const configs: BugTraqConfig[] = [];
  for (const [name, kv] of sections.entries()) {
    if (kv.url && (kv.logregex || kv.loglinkregex)) {
      configs.push({
        name,
        url: kv.url,
        logregex: kv.logregex,
        loglinkregex: kv.loglinkregex,
        logfilterregex: kv.logfilterregex,
        projects: kv.projects ? kv.projects.split(',').map(s => s.trim()).filter(Boolean) : undefined,
      });
    }
  }
  return configs;
}
