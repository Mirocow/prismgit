// SmartGit-like Git-Flow implementation
// Supports: Feature, Release, Hotfix branches
// Based on AVH Edition of git-flow

import { api } from './api';

export interface GitFlowConfig {
  masterBranch: string;
  developBranch: string;
  featurePrefix: string;
  releasePrefix: string;
  hotfixPrefix: string;
  supportPrefix: string;
  versionTagPrefix: string;
  originRemote: string;
}

export const DEFAULT_GIT_FLOW_CONFIG: GitFlowConfig = {
  masterBranch: 'main',
  developBranch: 'develop',
  featurePrefix: 'feature/',
  releasePrefix: 'release/',
  hotfixPrefix: 'hotfix/',
  supportPrefix: 'support/',
  versionTagPrefix: 'v',
  originRemote: 'origin',
};

export async function detectGitFlowConfig(repoPath: string): Promise<GitFlowConfig> {
  const cfg = await api.git.configGet(repoPath, 'gitflow.branch.master');
  if (!cfg) {
    return DEFAULT_GIT_FLOW_CONFIG;
  }
  return {
    masterBranch: (await api.git.configGet(repoPath, 'gitflow.branch.master')) || DEFAULT_GIT_FLOW_CONFIG.masterBranch,
    developBranch: (await api.git.configGet(repoPath, 'gitflow.branch.develop')) || DEFAULT_GIT_FLOW_CONFIG.developBranch,
    featurePrefix: (await api.git.configGet(repoPath, 'gitflow.prefix.feature')) || DEFAULT_GIT_FLOW_CONFIG.featurePrefix,
    releasePrefix: (await api.git.configGet(repoPath, 'gitflow.prefix.release')) || DEFAULT_GIT_FLOW_CONFIG.releasePrefix,
    hotfixPrefix: (await api.git.configGet(repoPath, 'gitflow.prefix.hotfix')) || DEFAULT_GIT_FLOW_CONFIG.hotfixPrefix,
    supportPrefix: (await api.git.configGet(repoPath, 'gitflow.prefix.support')) || DEFAULT_GIT_FLOW_CONFIG.supportPrefix,
    versionTagPrefix: (await api.git.configGet(repoPath, 'gitflow.prefix.versiontag')) || DEFAULT_GIT_FLOW_CONFIG.versionTagPrefix,
    originRemote: (await api.git.configGet(repoPath, 'gitflow.origin.remote')) || DEFAULT_GIT_FLOW_CONFIG.originRemote,
  };
}

// Feature operations
export async function startFeature(repoPath: string, name: string, base?: string, cfg?: GitFlowConfig): Promise<void> {
  const config = cfg || await detectGitFlowConfig(repoPath);
  const branchName = `${config.featurePrefix}${name}`;
  const startPoint = base || config.developBranch;
  await api.git.createBranch(repoPath, branchName, startPoint, false, false);
  await api.git.checkout(repoPath, branchName);
}

export async function finishFeature(repoPath: string, name: string, options: {
  rebase?: boolean;
  squash?: boolean;
  noFF?: boolean;
  deleteBranch?: boolean;
  pushToRemote?: boolean;
  cfg?: GitFlowConfig;
} = {}): Promise<void> {
  const cfg = options.cfg || await detectGitFlowConfig(repoPath);
  const branchName = `${cfg.featurePrefix}${name}`;
  const { rebase, squash, noFF = true, deleteBranch = true, pushToRemote = false } = options;

  if (rebase) {
    await api.git.rebase(repoPath, cfg.developBranch);
  }

  // Merge into develop
  await api.git.checkout(repoPath, cfg.developBranch);
  await api.git.merge(repoPath, branchName, { noFf: noFF, squash });

  if (deleteBranch) {
    await api.git.deleteBranch(repoPath, branchName, false);
  }

  if (pushToRemote) {
    await api.git.push(repoPath, cfg.originRemote, cfg.developBranch);
  }
}

// Release operations
export async function startRelease(repoPath: string, version: string, base?: string, cfg?: GitFlowConfig): Promise<void> {
  const config = cfg || await detectGitFlowConfig(repoPath);
  const branchName = `${config.releasePrefix}${version}`;
  const startPoint = base || config.developBranch;
  await api.git.createBranch(repoPath, branchName, startPoint, false, false);
  await api.git.checkout(repoPath, branchName);
}

export async function finishRelease(repoPath: string, version: string, options: {
  tagMessage?: string;
  noFF?: boolean;
  deleteBranch?: boolean;
  pushToRemote?: boolean;
  cfg?: GitFlowConfig;
} = {}): Promise<void> {
  const cfg = options.cfg || await detectGitFlowConfig(repoPath);
  const branchName = `${cfg.releasePrefix}${version}`;
  const tagName = `${cfg.versionTagPrefix}${version}`;
  const { tagMessage, noFF = true, deleteBranch = true, pushToRemote = false } = options;

  // Merge into master
  await api.git.checkout(repoPath, cfg.masterBranch);
  await api.git.merge(repoPath, branchName, { noFf: noFF });

  // Tag the release
  await api.git.createTag(repoPath, tagName, tagMessage || `Release ${version}`, undefined, false, true);

  // Merge back into develop
  await api.git.checkout(repoPath, cfg.developBranch);
  await api.git.merge(repoPath, branchName, { noFf: noFF });

  if (deleteBranch) {
    await api.git.deleteBranch(repoPath, branchName, false);
  }

  if (pushToRemote) {
    await api.git.push(repoPath, cfg.originRemote, cfg.masterBranch);
    await api.git.push(repoPath, cfg.originRemote, cfg.developBranch);
    await api.git.pushTag(repoPath, tagName, cfg.originRemote);
  }
}

// Hotfix operations
export async function startHotfix(repoPath: string, version: string, base?: string, cfg?: GitFlowConfig): Promise<void> {
  const config = cfg || await detectGitFlowConfig(repoPath);
  const branchName = `${config.hotfixPrefix}${version}`;
  const startPoint = base || config.masterBranch;
  await api.git.createBranch(repoPath, branchName, startPoint, false, false);
  await api.git.checkout(repoPath, branchName);
}

export async function finishHotfix(repoPath: string, version: string, options: {
  tagMessage?: string;
  noFF?: boolean;
  deleteBranch?: boolean;
  pushToRemote?: boolean;
  cfg?: GitFlowConfig;
} = {}): Promise<void> {
  const cfg = options.cfg || await detectGitFlowConfig(repoPath);
  const branchName = `${cfg.hotfixPrefix}${version}`;
  const tagName = `${cfg.versionTagPrefix}${version}`;
  const { tagMessage, noFF = true, deleteBranch = true, pushToRemote = false } = options;

  // Merge into master
  await api.git.checkout(repoPath, cfg.masterBranch);
  await api.git.merge(repoPath, branchName, { noFf: noFF });

  // Tag the hotfix
  await api.git.createTag(repoPath, tagName, tagMessage || `Hotfix ${version}`, undefined, false, true);

  // Merge back into develop
  await api.git.checkout(repoPath, cfg.developBranch);
  await api.git.merge(repoPath, branchName, { noFf: noFF });

  if (deleteBranch) {
    await api.git.deleteBranch(repoPath, branchName, false);
  }

  if (pushToRemote) {
    await api.git.push(repoPath, cfg.originRemote, cfg.masterBranch);
    await api.git.push(repoPath, cfg.originRemote, cfg.developBranch);
    await api.git.pushTag(repoPath, tagName, cfg.originRemote);
  }
}

// List current feature/release/hotfix branches
export async function listFlowBranches(repoPath: string, cfg?: GitFlowConfig) {
  const config = cfg || await detectGitFlowConfig(repoPath);
  const allBranches = await api.git.branches(repoPath);
  return {
    features: allBranches.filter((b) => b.name.startsWith(config.featurePrefix) && !b.remote),
    releases: allBranches.filter((b) => b.name.startsWith(config.releasePrefix) && !b.remote),
    hotfixes: allBranches.filter((b) => b.name.startsWith(config.hotfixPrefix) && !b.remote),
    config,
  };
}
