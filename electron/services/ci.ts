/**
 * CI/CD integration beyond GitHub Actions.
 * SmartGit Manual: Display pipeline statuses for Jenkins, TeamCity, GitLab CI.
 *
 * Each CI system has its own API shape; this module provides a unified
 * CommitCheckStatus result that HistoryPage can display.
 */
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import type { CommitCheckStatus } from '../types/github-api.js';
import { SimpleStore } from './simpleStore.js';

interface CIConfig {
  /** Jenkins base URL, e.g. https://ci.example.com */
  jenkinsUrl?: string;
  /** Jenkins API token (user:token format). */
  jenkinsToken?: string;
  /** TeamCity base URL. */
  teamcityUrl?: string;
  /** TeamCity access token. */
  teamcityToken?: string;
  /** GitLab base URL (default https://gitlab.com). */
  gitlabUrl?: string;
  /** GitLab personal access token. */
  gitlabToken?: string;
  /** GitLab project ID (numeric). */
  gitlabProjectId?: number;
}

const store = new SimpleStore({
  name: 'prismgit-ci',
  defaults: {},
});

export function getCIConfig(): CIConfig {
  return (store.get('config') || {}) as CIConfig;
}

export function setCIConfig(config: CIConfig): void {
  store.set('config', config);
}

async function fetchJson<T>(url: string, options: { headers?: Record<string, string> } = {}): Promise<T> {
  const u = new URL(url);
  const isHttps = u.protocol === 'https:';
  const lib = isHttps ? https : http;
  return new Promise<T>((resolve, reject) => {
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          'User-Agent': 'PrismGit-Electron/2.0',
          Accept: 'application/json',
          ...(options.headers || {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(data ? JSON.parse(data) : null);
            } catch (e) {
              reject(new Error(`JSON parse error: ${e}`));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * Fetch Jenkins build status for a commit SHA.
 * SmartGit Manual: Jenkins CI integration.
 */
export async function getJenkinsStatus(
  sha: string
): Promise<CommitCheckStatus> {
  const cfg = getCIConfig();
  if (!cfg.jenkinsUrl || !cfg.jenkinsToken) {
    return { sha, status: 'none', totalChecks: 0 };
  }
  try {
    // Jenkins Generic Webhook Trigger plugin or build-by-commit endpoint
    const url = `${cfg.jenkinsUrl}/api/json?tree=builds[number,result,changeSet[items[commitId]]]{0,20}`;
    const data = await fetchJson<{
      builds?: Array<{
        number: number;
        result: 'SUCCESS' | 'FAILURE' | 'ABORTED' | 'UNSTABLE' | null;
        changeSet?: { items?: Array<{ commitId: string }> };
      }>;
    }>(url, {
      headers: { Authorization: `Basic ${Buffer.from(cfg.jenkinsToken).toString('base64')}` },
    });
    const matchingBuilds = (data.builds || []).filter(b =>
      b.changeSet?.items?.some(item => item.commitId === sha || item.commitId?.startsWith(sha.substring(0, 8)))
    );
    if (matchingBuilds.length === 0) {
      return { sha, status: 'none', totalChecks: 0 };
    }
    const hasFailure = matchingBuilds.some(b => b.result === 'FAILURE' || b.result === 'UNSTABLE');
    const hasRunning = matchingBuilds.some(b => b.result === null);
    return {
      sha,
      status: 'completed',
      conclusion: hasFailure ? 'failure' : hasRunning ? 'running' : 'success',
      totalChecks: matchingBuilds.length,
    };
  } catch {
    return { sha, status: 'none', totalChecks: 0 };
  }
}

/**
 * Fetch TeamCity build status for a commit SHA.
 * SmartGit Manual: TeamCity CI integration.
 */
export async function getTeamCityStatus(
  sha: string
): Promise<CommitCheckStatus> {
  const cfg = getCIConfig();
  if (!cfg.teamcityUrl || !cfg.teamcityToken) {
    return { sha, status: 'none', totalChecks: 0 };
  }
  try {
    // TeamCity REST API: search builds by revision
    const url = `${cfg.teamcityUrl}/app/rest/builds?locator=revision:${sha},count:10`;
    const data = await fetchJson<{
      build?: Array<{
        id: number;
        status: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'UNKNOWN';
        state: 'finished' | 'running' | 'queued';
      }>;
      count: number;
    }>(url, {
      headers: {
        Authorization: `Bearer ${cfg.teamcityToken}`,
        Accept: 'application/json',
      },
    });
    if (!data.build || data.build.length === 0) {
      return { sha, status: 'none', totalChecks: 0 };
    }
    const hasFailure = data.build.some(b => b.status === 'FAILURE' || b.status === 'ERROR');
    const hasRunning = data.build.some(b => b.state !== 'finished');
    return {
      sha,
      status: 'completed',
      conclusion: hasFailure ? 'failure' : hasRunning ? 'running' : 'success',
      totalChecks: data.count,
    };
  } catch {
    return { sha, status: 'none', totalChecks: 0 };
  }
}

/**
 * Fetch GitLab CI pipeline status for a commit SHA.
 * SmartGit Manual: GitLab CI integration.
 */
export async function getGitLabCIStatus(
  sha: string
): Promise<CommitCheckStatus> {
  const cfg = getCIConfig();
  if (!cfg.gitlabUrl || !cfg.gitlabToken || !cfg.gitlabProjectId) {
    return { sha, status: 'none', totalChecks: 0 };
  }
  try {
    const url = `${cfg.gitlabUrl}/api/v4/projects/${cfg.gitlabProjectId}/pipelines?sha=${encodeURIComponent(sha)}`;
    const data = await fetchJson<Array<{
      id: number;
      sha: string;
      status: 'running' | 'pending' | 'success' | 'failed' | 'canceled' | 'skipped';
    }>>(url, {
      headers: { 'PRIVATE-TOKEN': cfg.gitlabToken },
    });
    if (data.length === 0) {
      return { sha, status: 'none', totalChecks: 0 };
    }
    const hasFailure = data.some(p => p.status === 'failed');
    const hasRunning = data.some(p => p.status === 'running' || p.status === 'pending');
    return {
      sha,
      status: 'completed',
      conclusion: hasFailure ? 'failure' : hasRunning ? 'running' : 'success',
      totalChecks: data.length,
    };
  } catch {
    return { sha, status: 'none', totalChecks: 0 };
  }
}

/**
 * Fetch CI status from all configured providers for a batch of SHAs.
 * Returns a map keyed by SHA → aggregated CommitCheckStatus.
 * If multiple providers report, the worst result wins (failure > running > success).
 */
export async function getAggregatedCIStatus(
  shas: string[]
): Promise<Record<string, CommitCheckStatus>> {
  const cfg = getCIConfig();
  const results: Record<string, CommitCheckStatus> = {};
  const batch = shas.slice(0, 25);
  for (const sha of batch) {
    let worst: CommitCheckStatus = { sha, status: 'none', totalChecks: 0 };
    if (cfg.jenkinsUrl) {
      const j = await getJenkinsStatus(sha).catch(() => ({ sha, status: 'none', totalChecks: 0 } as CommitCheckStatus));
      if (j.conclusion === 'failure') worst = { sha, status: 'completed', conclusion: 'failure', totalChecks: 1 };
      else if (j.conclusion === 'running' && worst.conclusion !== 'failure') worst = j;
      else if (j.conclusion === 'success' && worst.status === 'none') worst = j;
    }
    if (cfg.teamcityUrl) {
      const t = await getTeamCityStatus(sha).catch(() => ({ sha, status: 'none', totalChecks: 0 } as CommitCheckStatus));
      if (t.conclusion === 'failure') worst = { sha, status: 'completed', conclusion: 'failure', totalChecks: 1 };
      else if (t.conclusion === 'running' && worst.conclusion !== 'failure') worst = t;
      else if (t.conclusion === 'success' && worst.status === 'none') worst = t;
    }
    if (cfg.gitlabUrl) {
      const g = await getGitLabCIStatus(sha).catch(() => ({ sha, status: 'none', totalChecks: 0 } as CommitCheckStatus));
      if (g.conclusion === 'failure') worst = { sha, status: 'completed', conclusion: 'failure', totalChecks: 1 };
      else if (g.conclusion === 'running' && worst.conclusion !== 'failure') worst = g;
      else if (g.conclusion === 'success' && worst.status === 'none') worst = g;
    }
    results[sha] = worst;
  }
  return results;
}
