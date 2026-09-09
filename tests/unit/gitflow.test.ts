import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the api module
vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      configGet: vi.fn(),
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
  startFeature,
  finishFeature,
  startRelease,
  finishRelease,
  startHotfix,
  finishHotfix,
  listFlowBranches,
} from '../../src/lib/gitflow';

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
    vi.mocked(api.git.configGet).mockResolvedValue(undefined);
    const cfg = await detectGitFlowConfig('/repo');
    expect(cfg).toEqual(DEFAULT_GIT_FLOW_CONFIG);
  });

  it('returns configured values', async () => {
    vi.mocked(api.git.configGet).mockImplementation(async (_path, key) => {
      const values: Record<string, string> = {
        'gitflow.branch.master': 'master',
        'gitflow.branch.develop': 'dev',
        'gitflow.prefix.feature': 'feat/',
        'gitflow.prefix.release': 'rel/',
        'gitflow.prefix.hotfix': 'fix/',
        'gitflow.prefix.support': 'sup/',
        'gitflow.prefix.versiontag': 'version-',
        'gitflow.origin.remote': 'upstream',
      };
      return values[key];
    });

    const cfg = await detectGitFlowConfig('/repo');
    expect(cfg.masterBranch).toBe('master');
    expect(cfg.developBranch).toBe('dev');
    expect(cfg.featurePrefix).toBe('feat/');
    expect(cfg.releasePrefix).toBe('rel/');
    expect(cfg.hotfixPrefix).toBe('fix/');
    expect(cfg.versionTagPrefix).toBe('version-');
    expect(cfg.originRemote).toBe('upstream');
  });
});

describe('startFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.git.configGet).mockResolvedValue(undefined);
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
