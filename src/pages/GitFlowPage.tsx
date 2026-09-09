import { useState, useEffect, useCallback } from 'react';
import { GitBranch, Tag, AlertCircle, Loader, Plus, GitMerge, Check, RefreshCw } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { GitFlowDialog } from '../components/GitFlowDialog';
import { listFlowBranches, type GitFlowConfig } from '../lib/gitflow';
import { detectGitFlowConfig } from '../lib/gitflow';
import { cn, formatDate, shortHash } from '../lib/utils';

type FlowType = 'feature' | 'release' | 'hotfix';
type Action = 'start' | 'finish';

export function GitFlowPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
  const [config, setConfig] = useState<GitFlowConfig | null>(null);
  const [features, setFeatures] = useState<any[]>([]);
  const [releases, setReleases] = useState<any[]>([]);
  const [hotfixes, setHotfixes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogFlow, setDialogFlow] = useState<FlowType>('feature');
  const [dialogAction, setDialogAction] = useState<Action>('start');
  const [dialogName, setDialogName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await detectGitFlowConfig(repo.path);
      setConfig(cfg);
      const lists = await listFlowBranches(repo.path, cfg);
      setFeatures(lists.features);
      setReleases(lists.releases);
      setHotfixes(lists.hotfixes);
    } catch (e) {
      toast.error('Failed to load Git-Flow status', String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openDialog = (flow: FlowType, action: Action, name = '') => {
    setDialogFlow(flow);
    setDialogAction(action);
    setDialogName(name);
    setDialogOpen(true);
  };

  const renderBranchRow = (branch: any, flow: FlowType) => (
    <div
      key={branch.name}
      className="group flex items-center gap-3 px-3 py-2 border-b border-border-subtle hover:bg-bg-hover"
    >
      <GitBranch size={14} className={branch.current ? 'text-accent' : 'text-text-tertiary'} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary truncate">{branch.name}</span>
          {branch.current && <span className="badge badge-added">CURRENT</span>}
          {branch.tracking && <span className="text-2xs text-text-tertiary">→ {branch.tracking}</span>}
        </div>
        {branch.lastCommit && (
          <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
            <code className="font-mono">{shortHash(branch.lastCommit.hash)}</code>
            <span className="truncate">{branch.lastCommit.message}</span>
            <span>· {formatDate(branch.lastCommit.date)}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
        <button
          className="btn btn-secondary text-2xs"
          onClick={() => openDialog(flow, 'finish', branch.name.replace(config?.[`${flow}Prefix` as keyof GitFlowConfig] || '', ''))}
        >
          <GitMerge size={11} />
          Finish
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <GitBranch size={14} />
          <span className="text-sm font-medium">Git-Flow</span>
          {config && (
            <span className="text-2xs text-text-tertiary">
              main: <code className="mono">{config.masterBranch}</code>
              {' · '}
              develop: <code className="mono">{config.developBranch}</code>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title="Refresh" onClick={load}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">Loading...</div>
        ) : (
          <>
            {/* Features */}
            <div>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-b border-border-default flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <GitBranch size={11} /> Features ({features.length})
                </span>
                <button
                  className="icon-btn !w-5 !h-5"
                  title="Start feature"
                  onClick={() => openDialog('feature', 'start')}
                >
                  <Plus size={11} />
                </button>
              </div>
              {features.length === 0 ? (
                <div className="px-3 py-3 text-xs text-text-tertiary">No active features</div>
              ) : (
                features.map((b) => renderBranchRow(b, 'feature'))
              )}
            </div>

            {/* Releases */}
            <div>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-y border-border-default flex items-center justify-between mt-2">
                <span className="flex items-center gap-2">
                  <Tag size={11} /> Releases ({releases.length})
                </span>
                <button
                  className="icon-btn !w-5 !h-5"
                  title="Start release"
                  onClick={() => openDialog('release', 'start')}
                >
                  <Plus size={11} />
                </button>
              </div>
              {releases.length === 0 ? (
                <div className="px-3 py-3 text-xs text-text-tertiary">No active releases</div>
              ) : (
                releases.map((b) => renderBranchRow(b, 'release'))
              )}
            </div>

            {/* Hotfixes */}
            <div>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-y border-border-default flex items-center justify-between mt-2">
                <span className="flex items-center gap-2">
                  <AlertCircle size={11} /> Hotfixes ({hotfixes.length})
                </span>
                <button
                  className="icon-btn !w-5 !h-5"
                  title="Start hotfix"
                  onClick={() => openDialog('hotfix', 'start')}
                >
                  <Plus size={11} />
                </button>
              </div>
              {hotfixes.length === 0 ? (
                <div className="px-3 py-3 text-xs text-text-tertiary">No active hotfixes</div>
              ) : (
                hotfixes.map((b) => renderBranchRow(b, 'hotfix'))
              )}
            </div>

            {/* Info card */}
            <div className="m-3 p-3 bg-bg-tertiary rounded border border-border-default">
              <div className="text-xs text-text-secondary mb-2 font-medium">About Git-Flow</div>
              <div className="text-2xs text-text-tertiary leading-relaxed">
                Git-Flow is a structured workflow for managing features, releases, and hotfixes.
                Features branch off <code className="mono">develop</code> and merge back.
                Releases branch off <code className="mono">develop</code>, merge into both
                <code className="mono">main</code> and <code className="mono">develop</code>, and are tagged.
                Hotfixes branch off <code className="mono">main</code> and merge back to both.
              </div>
            </div>
          </>
        )}
      </div>

      <GitFlowDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        initialFlow={dialogFlow}
        initialAction={dialogAction}
        initialName={dialogName}
      />
    </div>
  );
}
