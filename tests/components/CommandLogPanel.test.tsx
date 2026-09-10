import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CommandLogPanel } from '../../src/components/CommandLogPanel';
import { api } from '../../src/lib/api';
import { useCommandLogStore } from '../../src/stores/commandLogStore';
import { useOperationLogStore } from '../../src/stores/operationLogStore';
import type { CommandLogEntry } from '../../src/lib/api';

// --- api mock -----------------------------------------------------------------

const mockList = vi.fn<[], Promise<CommandLogEntry[]>>();
const mockClear = vi.fn<[], Promise<void>>();
const mockWriteText = vi.fn();

vi.mock('../../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      commandLog: {
        list: (...args: unknown[]) => mockList(...(args as [])),
        clear: (...args: unknown[]) => mockClear(...(args as [])),
        onEntry: vi.fn(() => vi.fn()),
      },
      clipboard: {
        writeText: (...args: unknown[]) => mockWriteText(...(args as [string])),
      },
    },
  };
});

// LogEntry (Operations tab) reads currentRepo from the repository store.
vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: (sel?: (s: { currentRepo: { path: string; name: string } | null }) => unknown) =>
    sel ? sel({ currentRepo: { path: '/test/repo', name: 'test-repo' } }) : { currentRepo: { path: '/test/repo', name: 'test-repo' } },
}));

// --- fixtures -------------------------------------------------------------------

let idCounter = 0;
function entry(partial: Partial<CommandLogEntry>): CommandLogEntry {
  idCounter += 1;
  return {
    id: idCounter,
    timestamp: 1757500000000 + idCounter * 1000,
    repo: '/repos/project',
    args: ['push'],  // default to a user command so it's visible by default
    exitCode: 0,
    signal: null,
    durationMs: 42,
    stdout: '',
    stderr: '',
    ...partial,
  };
}

const failedPush = entry({
  args: ['push', 'origin', 'feature/x'],
  exitCode: 1,
  stdout: '',
  stderr: [
    'To http://192.168.1.2/web/git/gitclient.git',
    " ! [rejected] feature/x -> feature/x (non-fast-forward)",
    'error: failed to push some refs to http://192.168.1.2/web/git/gitclient.git',
  ].join('\n'),
  durationMs: 812,
});

const okStatus = entry({
  args: ['fetch', 'origin'],
  stdout: '## feature/x...origin/feature/x [ahead 1]\n',
  durationMs: 17,
});

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  mockClear.mockResolvedValue(undefined);
  useCommandLogStore.setState({ entries: [] });
  useOperationLogStore.setState({ ops: [], runningIds: new Set() });
});

// --- tests ----------------------------------------------------------------------

describe('CommandLogPanel — Commands tab (raw git output)', () => {
  it('renders captured git commands with status, exit code and duration', async () => {
    // Seed via the main-process list — the panel's load() effect pulls it on mount
    mockList.mockResolvedValue([failedPush, okStatus]);
    render(<CommandLogPanel onClose={() => {}} />);

    expect(await screen.findByText('git push origin feature/x')).toBeInTheDocument();
    expect(screen.getByText('git fetch origin')).toBeInTheDocument();
    expect(screen.getByText(/exit 1/)).toBeInTheDocument();
    expect(screen.getByText('812ms')).toBeInTheDocument();
    // failed counter badge in the tab
    expect(screen.getByText(/1 failed/)).toBeInTheDocument();
  });

  it('expands an entry to show the full command, directory, stdout and stderr', async () => {
    mockList.mockResolvedValue([failedPush]);
    render(<CommandLogPanel onClose={() => {}} />);

    fireEvent.click(await screen.findByText('git push origin feature/x'));

    expect(screen.getAllByText('git push origin feature/x').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('/repos/project')).toBeInTheDocument();
    // failedPush has empty stdout → no stdout block, only stderr
    expect(screen.queryByText('stdout:')).not.toBeInTheDocument();
    expect(screen.getByText('stderr:')).toBeInTheDocument();
    expect(
      screen.getByText(/! \[rejected\] feature\/x -> feature\/x \(non-fast-forward\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/error: failed to push some refs/)).toBeInTheDocument();
  });

  it('expands a successful entry showing its stdout block', async () => {
    mockList.mockResolvedValue([okStatus]);
    render(<CommandLogPanel onClose={() => {}} />);

    fireEvent.click(await screen.findByText('git fetch origin'));

    expect(screen.getByText('stdout:')).toBeInTheDocument();
    expect(screen.getByText(/## feature\/x\.\.\.origin\/feature\/x \[ahead 1\]/)).toBeInTheDocument();
    expect(screen.queryByText('stderr:')).not.toBeInTheDocument();
  });

  it('"Errors only" hides successful commands', async () => {
    mockList.mockResolvedValue([failedPush, okStatus]);
    render(<CommandLogPanel onClose={() => {}} />);

    await screen.findByText('git push origin feature/x');
    expect(screen.getByText('git fetch origin')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Show only failed commands (non-zero exit code)'));

    expect(screen.getByText('git push origin feature/x')).toBeInTheDocument();
    expect(screen.queryByText('git fetch origin')).not.toBeInTheDocument();
  });

  it('"Copy" puts all visible commands with their output on the clipboard', async () => {
    mockList.mockResolvedValue([failedPush, okStatus]);
    render(<CommandLogPanel onClose={() => {}} />);

    await screen.findByText('git push origin feature/x');
    fireEvent.click(screen.getByTitle('Copy all visible commands with their output'));

    expect(mockWriteText).toHaveBeenCalledTimes(1);
    const text = mockWriteText.mock.calls[0][0] as string;
    expect(text).toContain('$ git push origin feature/x');
    expect(text).toContain('$ git fetch origin');
    expect(text).toContain('failed to push some refs');
  });

  it('"Clear" empties the local log and calls the main process', async () => {
    mockList.mockResolvedValue([okStatus]);
    render(<CommandLogPanel onClose={() => {}} />);

    await screen.findByText('git fetch origin');
    fireEvent.click(screen.getByTitle('Clear command log'));

    await waitFor(() => expect(mockClear).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useCommandLogStore.getState().entries).toEqual([]));
    expect(screen.queryByText('git fetch origin')).not.toBeInTheDocument();
  });

  it('shows a helpful empty state when nothing was captured', async () => {
    mockList.mockResolvedValue([]);
    render(<CommandLogPanel onClose={() => {}} />);
    expect(
      await screen.findByText(/No user commands yet/),
    ).toBeInTheDocument();
  });
});

// Operations tab was removed — all operations now show in the Commands tab
// filtered by user/system classification. The operationLogStore is still
// used internally by StatusBar for the running indicator.
