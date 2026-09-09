import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock simple-git
const mockGit = {
  status: vi.fn(),
  add: vi.fn(),
  commit: vi.fn(),
  push: vi.fn(),
  pull: vi.fn(),
  fetch: vi.fn(),
  log: vi.fn(),
  branchLocal: vi.fn(),
  branch: vi.fn(),
  checkout: vi.fn(),
  diff: vi.fn(),
  raw: vi.fn(),
  revparse: vi.fn(),
  tag: vi.fn(),
  getRemotes: vi.fn(),
  merge: vi.fn(),
  stashList: vi.fn(),
  deleteLocalBranch: vi.fn(),
  checkIsRepo: vi.fn(),
  init: vi.fn(),
  addRemote: vi.fn(),
  removeRemote: vi.fn(),
};

vi.mock('simple-git', () => ({
  default: vi.fn(() => mockGit),
  simpleGit: vi.fn(() => mockGit),
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(),
  watch: vi.fn(() => ({ close: vi.fn() })),
}));

import * as gitService from '../../electron/services/git';

describe('git service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isRepo', () => {
    it('returns true when git checkIsRepo returns true', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      const result = await gitService.isRepo('/repo');
      expect(result).toBe(true);
    });

    it('returns false on error', async () => {
      mockGit.checkIsRepo.mockRejectedValue(new Error('Not a repo'));
      const result = await gitService.isRepo('/not-a-repo');
      expect(result).toBe(false);
    });
  });

  describe('status', () => {
    it('returns structured status', async () => {
      const mockStatus = {
        not_added: ['untracked.txt'],
        conflicted: ['conflict.txt'],
        created: ['new.txt'],
        deleted: ['gone.txt'],
        modified: ['changed.txt'],
        renamed: [{ from: 'old.txt', to: 'new.txt' }],
        files: [
          { path: 'changed.txt', index: 'M', working_dir: ' ' },
          { path: 'untracked.txt', index: '?', working_dir: '?' },
        ],
        ahead: 2,
        behind: 1,
        current: 'main',
        tracking: 'origin/main',
        isClean: () => true,
      };
      mockGit.status.mockResolvedValue(mockStatus);
      mockGit.raw.mockResolvedValue(''); // for state detection

      const result = await gitService.status('/repo');

      expect(result.not_added).toEqual(['untracked.txt']);
      expect(result.conflicted).toEqual(['conflict.txt']);
      expect(result.ahead).toBe(2);
      expect(result.behind).toBe(1);
      expect(result.current).toBe('main');
      expect(result.tracking).toBe('origin/main');
      expect(result.files).toHaveLength(2);
      expect(result.isClean).toBe(true);
    });
  });

  describe('add', () => {
    it('calls git add with files', async () => {
      await gitService.add('/repo', ['file1.txt', 'file2.txt']);
      expect(mockGit.add).toHaveBeenCalledWith(['file1.txt', 'file2.txt']);
    });

    it('does nothing for empty file list', async () => {
      await gitService.add('/repo', []);
      expect(mockGit.add).not.toHaveBeenCalled();
    });
  });

  describe('commit', () => {
    it('commits with message', async () => {
      mockGit.commit.mockResolvedValue({ commit: 'abc123' });
      const result = await gitService.commit('/repo', 'Test commit');
      expect(mockGit.commit).toHaveBeenCalledWith(['-m', 'Test commit']);
      expect(result).toBe('abc123');
    });

    it('commits with amend flag', async () => {
      mockGit.commit.mockResolvedValue({ commit: 'abc123' });
      await gitService.commit('/repo', 'Amended', true);
      expect(mockGit.commit).toHaveBeenCalledWith(['-m', 'Amended', '--amend', '--no-edit']);
    });
  });

  describe('push', () => {
    it('pushes to origin with branch', async () => {
      await gitService.push('/repo', 'origin', 'main', false, false, false);
      expect(mockGit.raw).toHaveBeenCalledWith(
        expect.arrayContaining(['push', 'origin', 'HEAD:main'])
      );
    });

    it('pushes with upstream flag', async () => {
      await gitService.push('/repo', 'origin', 'main', true, false, false);
      expect(mockGit.raw).toHaveBeenCalledWith(
        expect.arrayContaining(['push', '-u', 'origin', 'HEAD:main'])
      );
    });

    it('pushes with force-with-lease when force is true', async () => {
      await gitService.push('/repo', 'origin', 'main', false, true, false);
      expect(mockGit.raw).toHaveBeenCalledWith(
        expect.arrayContaining(['push', '--force-with-lease', 'origin', 'HEAD:main'])
      );
    });
  });

  describe('branches', () => {
    it('returns local and remote branches', async () => {
      mockGit.branchLocal.mockResolvedValue({
        all: ['main', 'develop'],
        current: 'main',
      });
      mockGit.branch.mockResolvedValue({
        all: ['origin/main', 'origin/develop'],
        current: false,
      });
      mockGit.status.mockResolvedValue({ tracking: 'origin/main', ahead: 0, behind: 0 });
      mockGit.log.mockResolvedValue({ latest: { hash: 'abc123', date: '2024-01-01', message: 'Test' } });

      const result = await gitService.branches('/repo');

      expect(result).toHaveLength(4);
      expect(result[0].name).toBe('main');
      expect(result[0].current).toBe(true);
      expect(result[0].remote).toBe(false);
      expect(result[2].name).toBe('origin/main');
      expect(result[2].remote).toBe(true);
    });
  });

  describe('remotes', () => {
    it('returns structured remotes', async () => {
      mockGit.getRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'https://example.com/repo.git', push: 'https://example.com/repo.git' } },
      ]);

      const result = await gitService.remotes('/repo');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('origin');
      expect(result[0].refs.fetch).toBe('https://example.com/repo.git');
    });
  });

  describe('tags', () => {
    it('returns empty for no tags', async () => {
      mockGit.tag.mockResolvedValue('');
      const result = await gitService.tags('/repo');
      expect(result).toEqual([]);
    });

    it('parses tags with annotations', async () => {
      mockGit.tag.mockResolvedValue('v1.0.0  Release 1.0\nv2.0.0  Release 2.0');
      mockGit.revparse.mockResolvedValue('abc123');
      mockGit.raw.mockResolvedValue('abc123');

      const result = await gitService.tags('/repo');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('v1.0.0');
      expect(result[0].annotation).toBe('Release 1.0');
      expect(result[0].lightweight).toBe(false);
    });
  });

  describe('extractRepoInfo', () => {
    it('detects GitHub SSH URL', async () => {
      mockGit.getRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'git@github.com:owner/repo.git', push: 'git@github.com:owner/repo.git' } },
      ]);

      const result = await gitService.extractRepoInfo('/repo');

      expect(result.provider).toBe('github');
      expect(result.owner).toBe('owner');
      expect(result.repo).toBe('repo');
      expect(result.webUrl).toBe('https://github.com/owner/repo');
    });

    it('detects GitLab HTTPS URL', async () => {
      mockGit.getRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'https://gitlab.com/owner/repo.git', push: 'https://gitlab.com/owner/repo.git' } },
      ]);

      const result = await gitService.extractRepoInfo('/repo');

      expect(result.provider).toBe('gitlab');
      expect(result.owner).toBe('owner');
      expect(result.webUrl).toBe('https://gitlab.com/owner/repo');
    });

    it('returns unknown when no remotes', async () => {
      mockGit.getRemotes.mockResolvedValue([]);
      const result = await gitService.extractRepoInfo('/repo');
      expect(result.provider).toBe('unknown');
    });
  });

  describe('LFS', () => {
    it('returns not installed when lfs version fails', async () => {
      mockGit.raw.mockRejectedValue(new Error('LFS not installed'));
      const result = await gitService.lfsStatus('/repo');
      expect(result.installed).toBe(false);
      expect(result.files).toEqual([]);
    });

    it('returns installed and files when lfs available', async () => {
      mockGit.raw.mockResolvedValueOnce('git-lfs/3.0.0'); // version
      mockGit.raw.mockResolvedValueOnce('  file1.bin (smudge)'); // status

      const result = await gitService.lfsStatus('/repo');
      expect(result.installed).toBe(true);
    });
  });
});
