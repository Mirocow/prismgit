import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the api module
vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      configGet: vi.fn(),
      raw: vi.fn(),
      createBranch: vi.fn(),
      checkout: vi.fn(),
      deleteBranch: vi.fn(),
      merge: vi.fn(),
      rebase: vi.fn(),
      push: vi.fn(),
      pushTag: vi.fn(),
      createTag: vi.fn(),
      branches: vi.fn(),
    },
  },
}));

import { api } from '../../src/lib/api';
import {
  DEFAULT_GIT_FLOW_CONFIG,
  detectGitFlowConfig,
  detectGitFlowStatus,
  readGitFlowConfigMap,
  gitFlowConfigFromMap,
  gitFlowStatusFrom,
  flowListsFrom,
  startFeature,
  finishFeature,
  startRelease,
  finishRelease,
  startHotfix,
  finishHotfix,
  listFlowBranches,
} from '../../src/lib/gitflow';

/**
 * PERF (v3.1): `git config --get-regexp ^gitflow\.` exits 1 (→ simple-git
 * THROWS) when nothing is configured — that is the "not initialized" case
 * every default-config test needs. (The old mocks used configGet →
 * undefined; the new single-call implementation reads via api.git.raw.)
 */
function mockNoGitFlow(): void {
  vi.mocked(api.git.raw).mockRejectedValue(new Error('git config exited with code 1'));
}

/** Mock a fully configured repo: ONE raw call returns all keys at once. */
function mockGitFlowConfigured(): void {
  vi.mocked(api.git.raw).mockResolvedValue(
    'gitflow.branch.master master\n' +
    'gitflow.branch.develop dev\n' +
    'gitflow.prefix.feature feat/\n' +
    'gitflow.prefix.release rel/\n' +
    'gitflow.prefix.hotfix fix/\n' +
    'gitflow.prefix.support sup/\n' +
    'gitflow.prefix.versiontag version-\n' +
    'gitflow.origin.remote upstream\n',
  );
}

describe('DEFAULT_GIT_FLOW_CONFIG', () => {
  it('has correct default values', () => {
    expect(DEFAULT_GIT_FLOW_CONFIG.masterBranch).toBe('main');
    expect(DEFAULT_GIT_FLOW_CONFIG.developBranch).toBe('develop');
    expect(DEFAULT_GIT_FLOW_CONFIG.featurePrefix).toBe('feature/');
    expect(DEFAULT_GIT_FLOW_CONFIG.releasePrefix).toBe('release/');
    expect(DEFAULT_GIT_FLOW_CONFIG.hotfixPrefix).toBe('hotfix/');
    expect(DEFAULT_GIT_FLOW_CONFIG.versionTagPrefix).toBe('v');
    expect(DEFAULT_GIT_FLOW_CONFIG.originRemote).toBe('origin');
  });
});

describe('detectGitFlowConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns default config when gitflow is not configured', async () => {
    mockNoGitFlow();
    const cfg = await detectGitFlowConfig('/repo');
    expect(cfg).toEqual(DEFAULT_GIT_FLOW_CONFIG);
  });

  it('returns configured values from the single config call', async () => {
    mockGitFlowConfigured();

    const cfg = await detectGitFlowConfig('/repo');
    expect(cfg.masterBranch).toBe('master');
    expect(cfg.developBranch).toBe('dev');
    expect(cfg.featurePrefix).toBe('feat/');
    expect(cfg.releasePrefix).toBe('rel/');
    expect(cfg.hotfixPrefix).toBe('fix/');
    expect(cfg.supportPrefix).toBe('sup/');
    expect(cfg.versionTagPrefix).toBe('version-');
    expect(cfg.originRemote).toBe('upstream');
  });

  it('PERF: reads all 9 keys with ONE git subprocess (was 9 sequential configGet spawns)', async () => {
    mockGitFlowConfigured();
    await detectGitFlowConfig('/repo');
    expect(api.git.raw).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.git.raw).mock.calls[0][1]).toEqual([
      'config', '--get-regexp', '^gitflow\\.',
    ]);
    // The old per-key configGet calls are gone entirely.
    expect(api.git.configGet).not.toHaveBeenCalled();
  });
});

describe('readGitFlowConfigMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('splits each line at the FIRST space so values may contain spaces', async () => {
    vi.mocked(api.git.raw).mockResolvedValue(
      'gitflow.branch.master main line\ngitflow.prefix.feature feat/\n',
    );
    const map = await readGitFlowConfigMap('/repo');
    expect(map['gitflow.branch.master']).toBe('main line');
    expect(map['gitflow.prefix.feature']).toBe('feat/');
  });

  it('returns an empty map when git exits 1 (nothing configured)', async () => {
    mockNoGitFlow();
    const map = await readGitFlowConfigMap('/repo');
    expect(map).toEqual({});
  });

  it('returns an empty map for empty output', async () => {
    vi.mocked(api.git.raw).mockResolvedValue('');
    const map = await readGitFlowConfigMap('/repo');
    expect(map).toEqual({});
  });
});

describe('gitFlowConfigFromMap / gitFlowStatusFrom / flowListsFrom (pure derivations)', () => {
  it('config: per-key defaults for a partial map', () => {
    const cfg = gitFlowConfigFromMap({ 'gitflow.branch.master': 'master' });
    expect(cfg.masterBranch).toBe('master');
    expect(cfg.developBranch).toBe(DEFAULT_GIT_FLOW_CONFIG.developBranch);
    expect(cfg.fixPrefix).toBe(DEFAULT_GIT_FLOW_CONFIG.fixPrefix);
  });

  it('status: initialized when any gitflow key exists; branch existence from the list', () => {
    const branches = [
      { name: 'main', current: false, remote: false },
      { name: 'develop', current: true, remote: false },
    ] as import('../../src/lib/api').BranchInfo[];
    const st = gitFlowStatusFrom({ 'gitflow.branch.master': 'main' }, branches);
    expect(st.initialized).toBe(true);
    expect(st.masterExists).toBe(true);
    expect(st.developExists).toBe(true);
  });

  it('status: NOT initialized for an empty map', () => {
    const st = gitFlowStatusFrom({}, []);
    expect(st.initialized).toBe(false);
    expect(st.masterExists).toBe(false);
  });

  it('flow lists: categorizes local branches by prefix and skips remotes', () => {
    const branches = [
      { name: 'feature/a', current: false, remote: false },
      { name: 'feature/b', current: true, remote: false },
      { name: 'release/1.0', current: false, remote: false },
      { name: 'hotfix/1.0.1', current: false, remote: false },
      { name: 'fix/x', current: false, remote: false },
      { name: 'support/1.x', current: false, remote: false },
      { name: 'main', current: false, remote: false },
      { name: 'origin/feature/remote-feature', current: false, remote: true },
    ] as import('../../src/lib/api').BranchInfo[];
    const lists = flowListsFrom(DEFAULT_GIT_FLOW_CONFIG, branches);
    expect(lists.features).toHaveLength(2);
    expect(lists.releases).toHaveLength(1);
    expect(lists.hotfixes).toHaveLength(1);
    expect(lists.fixes).toHaveLength(1);
    expect(lists.supports).toHaveLength(1);
  });
});

describe('detectGitFlowStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PERF: config map and branch list run in PARALLEL (1 config + 1 branches call)', async () => {
    mockGitFlowConfigured();
    vi.mocked(api.git.branches).mockResolvedValue([]);
    await detectGitFlowStatus('/repo');
    expect(api.git.raw).toHaveBeenCalledTimes(1); // ONE config call — was 11 (2 dup + 9 sequential)
    expect(api.git.branches).toHaveBeenCalledTimes(1);
  });

  it('degrades to defaults when branches() fails (empty repo)', async () => {
    mockNoGitFlow();
    vi.mocked(api.git.branches).mockRejectedValue(new Error('no commits yet'));
    const st = await detectGitFlowStatus('/repo');
    expect(st.initialized).toBe(false);
    expect(st.masterExists).toBe(false);
    expect(st.developExists).toBe(false);
  });
});

describe('startFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.git.configGet).mockResolvedValue(undefined);
    mockNoGitFlow();
  });

  it('creates and checks out feature branch from develop', async () => {
    await startFeature('/repo', 'my-feature');

    expect(api.git.createBranch).toHaveBeenCalledWith(
      '/repo',
      'feature/my-feature',
      'develop',
      false,
      false
    );
    expect(api.git.checkout).toHaveBeenCalledWith('/repo', 'feature/my-feature');
  });

  it('uses custom base when provided', async () => {
    await startFeature('/repo', 'my-feature', 'custom-base');

    expect(api.git.createBranch).toHaveBeenCalledWith(
      '/repo',
      'feature/my-feature',
      'custom-base',
      false,
      false
    );
  });
});

describe('finishFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.git.configGet).mockResolvedValue(undefined);
    mockNoGitFlow();
  });

  it('merges feature into develop with no-ff by default', async () => {
    vi.mocked(api.git.merge).mockResolvedValue({ conflicts: [], fastForward: false, alreadyUpToDate: false });

    await finishFeature('/repo', 'my-feature');

    // Should checkout develop
    expect(api.git.checkout).toHaveBeenCalledWith('/repo', 'develop');
    // Should merge feature branch
    expect(api.git.merge).toHaveBeenCalledWith('/repo', 'feature/my-feature', { noFf: true, squash: undefined });
    // Should delete branch by default
    expect(api.git.deleteBranch).toHaveBeenCalledWith('/repo', 'feature/my-feature', false);
  });

  it('rebases before merge when rebase option is set', async () => {
    vi.mocked(api.git.merge).mockResolvedValue({ conflicts: [], fastForward: false, alreadyUpToDate: false });

    await finishFeature('/repo', 'my-feature', { rebase: true });

    expect(api.git.rebase).toHaveBeenCalledWith('/repo', 'develop');
  });

  it('pushes to remote when pushToRemote is true', async () => {
    vi.mocked(api.git.merge).mockResolvedValue({ conflicts: [], fastForward: false, alreadyUpToDate: false });

    await finishFeature('/repo', 'my-feature', { pushToRemote: true });

    expect(api.git.push).toHaveBeenCalledWith('/repo', 'origin', 'develop');
  });

  it('does not delete branch when deleteBranch is false', async () => {
    vi.mocked(api.git.merge).mockResolvedValue({ conflicts: [], fastForward: false, alreadyUpToDate: false });

    await finishFeature('/repo', 'my-feature', { deleteBranch: false });

    expect(api.git.deleteBranch).not.toHaveBeenCalled();
  });
});

describe('startRelease', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.git.configGet).mockResolvedValue(undefined);
    mockNoGitFlow();
  });

  it('creates release branch from develop', async () => {
    await startRelease('/repo', '1.2.0');

    expect(api.git.createBranch).toHaveBeenCalledWith('/repo', 'release/1.2.0', 'develop', false, false);
    expect(api.git.checkout).toHaveBeenCalledWith('/repo', 'release/1.2.0');
  });
});

describe('finishRelease', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.git.configGet).mockResolvedValue(undefined);
    vi.mocked(api.git.merge).mockResolvedValue({ conflicts: [], fastForward: false, alreadyUpToDate: false });
  });

  it('merges into master, tags, then merges into develop', async () => {
    await finishRelease('/repo', '1.2.0');

    // First checkout master
    expect(api.git.checkout).toHaveBeenCalledWith('/repo', 'main');
    // Merge release into master
    expect(api.git.merge).toHaveBeenCalledWith('/repo', 'release/1.2.0', { noFf: true });
    // Tag the release
    expect(api.git.createTag).toHaveBeenCalledWith(
      '/repo',
      'v1.2.0',
      'Release 1.2.0',
      undefined,
      false,
      true
    );
    // Checkout develop and merge
    expect(api.git.checkout).toHaveBeenCalledWith('/repo', 'develop');
  });

  it('pushes tags when pushToRemote is true', async () => {
    await finishRelease('/repo', '1.2.0', { pushToRemote: true });

    expect(api.git.push).toHaveBeenCalledWith('/repo', 'origin', 'main');
    expect(api.git.push).toHaveBeenCalledWith('/repo', 'origin', 'develop');
    expect(api.git.pushTag).toHaveBeenCalledWith('/repo', 'v1.2.0', 'origin');
  });
});

describe('startHotfix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.git.configGet).mockResolvedValue(undefined);
    mockNoGitFlow();
  });

  it('creates hotfix branch from master', async () => {
    await startHotfix('/repo', '1.2.1');

    expect(api.git.createBranch).toHaveBeenCalledWith('/repo', 'hotfix/1.2.1', 'main', false, false);
    expect(api.git.checkout).toHaveBeenCalledWith('/repo', 'hotfix/1.2.1');
  });
});

describe('finishHotfix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.git.configGet).mockResolvedValue(undefined);
    vi.mocked(api.git.merge).mockResolvedValue({ conflicts: [], fastForward: false, alreadyUpToDate: false });
  });

  it('merges into master and develop, tags', async () => {
    await finishHotfix('/repo', '1.2.1');

    expect(api.git.checkout).toHaveBeenCalledWith('/repo', 'main');
    expect(api.git.merge).toHaveBeenCalledWith('/repo', 'hotfix/1.2.1', { noFf: true });
    expect(api.git.createTag).toHaveBeenCalledWith(
      '/repo',
      'v1.2.1',
      'Hotfix 1.2.1',
      undefined,
      false,
      true
    );
    expect(api.git.checkout).toHaveBeenCalledWith('/repo', 'develop');
  });
});

describe('listFlowBranches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.git.configGet).mockResolvedValue(undefined);
    mockNoGitFlow();
  });

  it('categorizes branches by prefix', async () => {
    vi.mocked(api.git.branches).mockResolvedValue([
      { name: 'feature/a', current: false, remote: false },
      { name: 'feature/b', current: true, remote: false },
      { name: 'release/1.0', current: false, remote: false },
      { name: 'hotfix/1.0.1', current: false, remote: false },
      { name: 'main', current: false, remote: false },
      { name: 'develop', current: false, remote: false },
      { name: 'origin/feature/remote-feature', current: false, remote: true },
    ] as any);

    const result = await listFlowBranches('/repo');

    expect(result.features).toHaveLength(2);
    expect(result.releases).toHaveLength(1);
    expect(result.hotfixes).toHaveLength(1);
    expect(result.features[0].name).toBe('feature/a');
  });
});
