import { useState, useEffect, useCallback } from 'react';
import { GitBranch, Tag, AlertCircle, Loader, Plus, GitMerge, Check, RefreshCw } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { GitFlowDialog } from '../components/GitFlowDialog';
import { listFlowBranches, type GitFlowConfig } from '../lib/gitflow';
import { detectGitFlowConfig } from '../lib/gitflow';
import { cn, formatDate, shortHash } from '../lib/utils';
import { useI18n } from '../lib/i18n';

type FlowType = 'feature' | 'release' | 'hotfix';
type Action = 'start' | 'finish';

export function GitFlowPage() {
  const { t } = useI18n();
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
      toast.error(t('pages.gitflowLoadFailed'), String(e));
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
          {branch.current && <span className="badge badge-added">{t('pages.flowBadgeCurrent')}</span>}
          {branch.tracking && <span className="text-2xs text-text-tertiary">→ {branch.tracking}</span>}
        </div>
        {branch.lastCommit && (
          <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
            <code
              className="font-mono cursor-pointer hover:text-accent hover:underline"
              title={t('pages.selectCommitHint')}
              onClick={(e) => {
                e.stopPropagation();
                useSelectionStore.getState().selectCommit(branch.lastCommit!.hash);
                window.location.hash = '#/history';
              }}
            >
              {shortHash(branch.lastCommit.hash)}
            </code>
            <span className="truncate">{branch.lastCommit.message}</span>
            <span>· {formatDate(branch.lastCommit.date)}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
        {/* Cross-tool: this flow branch becomes the global selection and opens in History */}
        <button
          className="btn btn-secondary text-2xs"
          title={t('pages.showLogOf', { name: branch.name })}
          onClick={() => {
            useSelectionStore.getState().selectBranch(branch.name);
            window.location.hash = '#/history';
          }}
        >
          {t('branches.log')}
        </button>
        <button
          className="btn btn-secondary text-2xs"
          onClick={() => openDialog(flow, 'finish', branch.name.replace(config?.[`${flow}Prefix` as keyof GitFlowConfig] || '', ''))}
        >
          <GitMerge size={11} />
          {t('pages.flowFinish')}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <GitBranch size={14} />
          <span className="text-sm font-medium">{t('nav.gitflow')}</span>
          {config && (
            <span className="text-2xs text-text-tertiary">
              main: <code
                      className="mono cursor-pointer hover:text-accent hover:underline"
                      title={t('pages.selectBranchHint')}
                      onClick={() => {
                        useSelectionStore.getState().selectBranch(config.masterBranch);
                        window.location.hash = '#/history';
                      }}
                    >{config.masterBranch}</code>
              {' · '}
              develop: <code
                      className="mono cursor-pointer hover:text-accent hover:underline"
                      title={t('pages.selectBranchHint')}
                      onClick={() => {
                        useSelectionStore.getState().selectBranch(config.developBranch);
                        window.location.hash = '#/history';
                      }}
                    >{config.developBranch}</code>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title={t('common.refresh')} onClick={load}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">{t('common.loading')}</div>
        ) : (
          <>
            {/* Features */}
            <div>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-b border-border-default flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <GitBranch size={11} /> {t('pages.flowFeatures', { count: features.length })}
                </span>
                <button
                  className="icon-btn !w-5 !h-5"
                  title={t('pages.flowStartFeature')}
                  onClick={() => openDialog('feature', 'start')}
                >
                  <Plus size={11} />
                </button>
              </div>
              {features.length === 0 ? (
                <div className="px-3 py-3 text-xs text-text-tertiary">{t('pages.flowNoFeatures')}</div>
              ) : (
                features.map((b) => renderBranchRow(b, 'feature'))
              )}
            </div>

            {/* Releases */}
            <div>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-y border-border-default flex items-center justify-between mt-2">
                <span className="flex items-center gap-2">
                  <Tag size={11} /> {t('pages.flowReleases', { count: releases.length })}
                </span>
                <button
                  className="icon-btn !w-5 !h-5"
                  title={t('pages.flowStartRelease')}
                  onClick={() => openDialog('release', 'start')}
                >
                  <Plus size={11} />
                </button>
              </div>
              {releases.length === 0 ? (
                <div className="px-3 py-3 text-xs text-text-tertiary">{t('pages.flowNoReleases')}</div>
              ) : (
                releases.map((b) => renderBranchRow(b, 'release'))
              )}
            </div>

            {/* Hotfixes */}
            <div>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-y border-border-default flex items-center justify-between mt-2">
                <span className="flex items-center gap-2">
                  <AlertCircle size={11} /> {t('pages.flowHotfixes', { count: hotfixes.length })}
                </span>
                <button
                  className="icon-btn !w-5 !h-5"
                  title={t('pages.flowStartHotfix')}
                  onClick={() => openDialog('hotfix', 'start')}
                >
                  <Plus size={11} />
                </button>
              </div>
              {hotfixes.length === 0 ? (
                <div className="px-3 py-3 text-xs text-text-tertiary">{t('pages.flowNoHotfixes')}</div>
              ) : (
                hotfixes.map((b) => renderBranchRow(b, 'hotfix'))
              )}
            </div>

            {/* Info card */}
            <div className="m-3 p-3 bg-bg-tertiary rounded border border-border-default">
              <div className="text-xs text-text-secondary mb-2 font-medium">{t('pages.flowAboutTitle')}</div>
              <div className="text-2xs text-text-tertiary leading-relaxed">
                {t('pages.flowAbout1')} <code className="mono">develop</code> {t('pages.flowAbout2')}{' '}
                <code className="mono">develop</code>{t('pages.flowAbout3')}{' '}
                <code className="mono">main</code> {t('pages.flowAbout4')}{' '}
                <code className="mono">develop</code>{t('pages.flowAbout5')}{' '}
                <code className="mono">main</code> {t('pages.flowAbout6')}
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
