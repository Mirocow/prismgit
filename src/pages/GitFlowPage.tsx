import { useState, useEffect, useCallback } from 'react';
import { GitBranch, Tag, AlertCircle, Loader, Plus, GitMerge, Check, RefreshCw, Settings as SettingsIcon, GitCommit } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { GitFlowDialog } from '../components/GitFlowDialog';
import {
  listFlowBranches,
  detectGitFlowConfig,
  detectGitFlowStatus,
  initGitFlow,
  checkoutFlowBranch,
  flowPrefix,
  type GitFlowConfig,
  type GitFlowStatus,
  type FlowType,
} from '../lib/gitflow';
import { api } from '../lib/api';
import { cn, formatDate, shortHash } from '../lib/utils';
import { useI18n } from '../lib/i18n';

type Action = 'start' | 'finish';

export function GitFlowPage() {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastActions();
  const [config, setConfig] = useState<GitFlowConfig | null>(null);
  const [status, setStatus] = useState<GitFlowStatus | null>(null);
  const [features, setFeatures] = useState<any[]>([]);
  const [releases, setReleases] = useState<any[]>([]);
  const [hotfixes, setHotfixes] = useState<any[]>([]);
  const [fixes, setFixes] = useState<any[]>([]);
  const [supports, setSupports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dialogFlow, setDialogFlow] = useState<FlowType>('feature');
  const [dialogAction, setDialogAction] = useState<Action>('start');
  const [dialogName, setDialogName] = useState('');
  const [initializing, setInitializing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [st, cfg] = await Promise.all([
        detectGitFlowStatus(repo.path),
        detectGitFlowConfig(repo.path),
      ]);
      setConfig(cfg);
      setStatus(st);
      const lists = await listFlowBranches(repo.path, cfg);
      setFeatures(lists.features);
      setReleases(lists.releases);
      setHotfixes(lists.hotfixes);
      setFixes(lists.fixes ?? []);
      setSupports(lists.supports ?? []);
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

  const handleInitialize = async () => {
    setInitializing(true);
    try {
      const newStatus = await initGitFlow(repo.path, config || undefined);
      setStatus(newStatus);
      toast.success(t('pages.gitflowInitialized', { defaultValue: 'Git-Flow initialized' }));
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('pages.gitflowInitFailed', { defaultValue: 'Git-Flow initialization failed' }), String(e));
    } finally {
      setInitializing(false);
    }
  };

  const handleCheckout = async (flow: FlowType, name: string) => {
    try {
      await checkoutFlowBranch(repo.path, flow, name, config || undefined);
      toast.success(t('pages.checkedOut', { defaultValue: 'Checked out {name}', name }));
      await refreshStatus(repo.path);
      await load();
    } catch (e) {
      toast.error(t('pages.checkoutFailed', { defaultValue: 'Checkout failed' }), String(e));
    }
  };

  const renderBranchRow = (branch: any, flow: FlowType) => (
    <div
      key={branch.name}
      className={cn(
        'group flex items-center gap-3 px-3 py-2 border-b border-border-subtle hover:bg-bg-hover',
        branch.current && 'bg-bg-selected'
      )}
    >
      <GitBranch size={14} className={branch.current ? 'text-accent' : 'text-text-tertiary'} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary truncate">{branch.name}</span>
          {branch.current && <span className="badge badge-added">{t('pages.flowBadgeCurrent')}</span>}
          {branch.tracking && <span className="text-2xs text-text-tertiary">→ {branch.tracking}</span>}
          {branch.upstream && !branch.tracking && <span className="text-2xs text-text-tertiary">→ {branch.upstream}</span>}
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
        {/* Checkout this flow branch — the previous UI only offered
            "show log" + "finish", missing the most basic action of all:
            switching to the branch. */}
        {!branch.current && (
          <button
            className="btn btn-secondary text-2xs"
            title={t('pages.checkoutTitle', { defaultValue: 'Checkout {name}', name: branch.name })}
            onClick={() => handleCheckout(flow, branch.name.replace(config ? flowPrefix(config, flow) : '', ''))}
          >
            <GitCommit size={11} />
            {t('branches.checkout', { defaultValue: 'Checkout' })}
          </button>
        )}
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
          onClick={() => openDialog(flow, 'finish', branch.name.replace(config ? flowPrefix(config, flow) : '', ''))}
        >
          <GitMerge size={11} />
          {t('pages.flowFinish')}
        </button>
      </div>
    </div>
  );

  // Show the "Initialize Git-Flow" banner when:
  //  - The repository has commits (master exists), but
  //  - develop branch does NOT exist locally, OR
  //  - gitflow.branch.master config is missing.
  const needsInit = !loading && status && (status.masterExists || status.developExists) &&
    (!status.initialized || !status.developExists);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch size={14} />
          <span className="text-sm font-medium">{t('nav.gitflow')}</span>
          {config && (
            <span className="text-2xs text-text-tertiary truncate">
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
          <button
            className="btn btn-secondary text-2xs"
            title={t('pages.gitflowSettings', { defaultValue: 'Git-Flow settings' })}
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon size={11} />
            {t('common.settings', { defaultValue: 'Settings' })}
          </button>
          <button className="icon-btn" title={t('common.refresh')} onClick={load}>
            <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm flex items-center justify-center gap-2">
            <Loader size={14} className="spin" />
            {t('common.loading')}
          </div>
        ) : needsInit ? (
          /* Initialize Git-Flow banner — shown when develop branch is missing
             or the gitflow.* config keys aren't set. This is THE reason the
             Git-Flow page "doesn't work" for the user: starting a feature
             branch off a non-existent develop fails with an opaque error. */
          <div className="m-4 p-5 rounded-lg border-2 border-dashed border-accent/40 bg-accent-muted/20">
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-accent flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-medium text-text-primary mb-1">
                  {t('pages.gitflowNeedsInit', { defaultValue: 'Git-Flow is not initialized in this repository' })}
                </div>
                <div className="text-xs text-text-secondary leading-relaxed mb-3">
                  {t('pages.gitflowNeedsInitHint', { defaultValue: 'Initializing will create the develop branch (off {master}) and write the gitflow.* config keys so feature/release/hotfix branches can be created off it.', master: config?.masterBranch || 'main' })}
                </div>
                {config && (
                  <div className="text-2xs text-text-tertiary mb-3 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono">
                    <span>master:</span><span>{config.masterBranch} {status?.masterExists ? '✓' : '✗'}</span>
                    <span>develop:</span><span>{config.developBranch} {status?.developExists ? '✓' : '✗'}</span>
                    <span>feature/:</span><span>{config.featurePrefix}</span>
                    <span>release/:</span><span>{config.releasePrefix}</span>
                    <span>hotfix/:</span><span>{config.hotfixPrefix}</span>
                    <span>version tag:</span><span>{config.versionTagPrefix}</span>
                  </div>
                )}
                <button
                  className="btn btn-primary text-xs"
                  onClick={handleInitialize}
                  disabled={initializing}
                >
                  {initializing ? <Loader size={12} className="spin" /> : <GitBranch size={12} />}
                  {t('pages.gitflowInitButton', { defaultValue: 'Initialize Git-Flow' })}
                </button>
              </div>
            </div>
          </div>
        ) : !status?.masterExists && !status?.developExists ? (
          /* Repo has no commits yet — can't init either. */
          <div className="p-8 text-center text-text-tertiary text-sm">
            <GitBranch size={28} className="mx-auto mb-2 opacity-40" />
            <div className="mb-1">{t('pages.gitflowEmptyRepo', { defaultValue: 'This repository has no commits yet' })}</div>
            <div className="text-xs">{t('pages.gitflowEmptyRepoHint', { defaultValue: 'Make your first commit, then come back to initialize Git-Flow.' })}</div>
          </div>
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

            {/* Fixes — develop-based bugfix branches (fix/ prefix) */}
            <div>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-y border-border-default flex items-center justify-between mt-2">
                <span className="flex items-center gap-2">
                  <AlertCircle size={11} /> {t('pages.flowFixes', { count: fixes.length, defaultValue: 'Fixes ({count})' })}
                </span>
                <button
                  className="icon-btn !w-5 !h-5"
                  title={t('pages.flowStartFix', { defaultValue: 'Start fix' })}
                  onClick={() => openDialog('fix', 'start')}
                >
                  <Plus size={11} />
                </button>
              </div>
              {fixes.length === 0 ? (
                <div className="px-3 py-3 text-xs text-text-tertiary">{t('pages.flowNoFixes', { defaultValue: 'No fix branches yet' })}</div>
              ) : (
                fixes.map((b) => renderBranchRow(b, 'fix'))
              )}
            </div>

            {/* Support — long-lived maintenance branches off master (support/ prefix) */}
            <div>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-y border-border-default flex items-center justify-between mt-2">
                <span className="flex items-center gap-2">
                  <GitBranch size={11} /> {t('pages.flowSupports', { count: supports.length, defaultValue: 'Support ({count})' })}
                </span>
                <button
                  className="icon-btn !w-5 !h-5"
                  title={t('pages.flowStartSupport', { defaultValue: 'Start support' })}
                  onClick={() => openDialog('support', 'start')}
                >
                  <Plus size={11} />
                </button>
              </div>
              {supports.length === 0 ? (
                <div className="px-3 py-3 text-xs text-text-tertiary">{t('pages.flowNoSupports', { defaultValue: 'No support branches yet' })}</div>
              ) : (
                supports.map((b) => renderBranchRow(b, 'support'))
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

      {settingsOpen && config && (
        <GitFlowSettingsDialog
          config={config}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            setSettingsOpen(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

/**
 * Settings dialog for editing the Git-Flow branch name / prefix configuration.
 * Lets the user customize masterBranch, developBranch, and the four prefixes
 * (feature/release/hotfix/versiontag). Saves to local git config and re-runs
 * initGitFlow to apply.
 */
function GitFlowSettingsDialog({
  config,
  onClose,
  onSaved,
}: {
  config: GitFlowConfig;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastActions();
  const [master, setMaster] = useState(config.masterBranch);
  const [develop, setDevelop] = useState(config.developBranch);
  const [featurePrefix, setFeaturePrefix] = useState(config.featurePrefix);
  const [releasePrefix, setReleasePrefix] = useState(config.releasePrefix);
  const [hotfixPrefix, setHotfixPrefix] = useState(config.hotfixPrefix);
  const [versionTagPrefix, setVersionTagPrefix] = useState(config.versionTagPrefix);
  const [originRemote, setOriginRemote] = useState(config.originRemote);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Persist all gitflow.* config keys to local git config.
      await Promise.all([
        api.git.configSet(repo.path, 'gitflow.branch.master', master, 'local'),
        api.git.configSet(repo.path, 'gitflow.branch.develop', develop, 'local'),
        api.git.configSet(repo.path, 'gitflow.prefix.feature', featurePrefix, 'local'),
        api.git.configSet(repo.path, 'gitflow.prefix.release', releasePrefix, 'local'),
        api.git.configSet(repo.path, 'gitflow.prefix.hotfix', hotfixPrefix, 'local'),
        api.git.configSet(repo.path, 'gitflow.prefix.versiontag', versionTagPrefix, 'local'),
        api.git.configSet(repo.path, 'gitflow.origin.remote', originRemote, 'local'),
      ]);
      toast.success(t('pages.gitflowSettingsSaved', { defaultValue: 'Git-Flow configuration saved' }));
      onSaved();
    } catch (e) {
      toast.error(t('pages.gitflowSettingsSaveFailed', { defaultValue: 'Failed to save Git-Flow configuration' }), String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="panel w-[480px] flex flex-col shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 className="text-base font-medium flex items-center gap-2">
            <SettingsIcon size={16} />
            {t('pages.gitflowSettings', { defaultValue: 'Git-Flow settings' })}
          </h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-tertiary block mb-1">{t('pages.gitflowCfgMaster', { defaultValue: 'Master branch' })}</label>
              <input type="text" className="w-full text-sm mono" value={master} onChange={(e) => setMaster(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-text-tertiary block mb-1">{t('pages.gitflowCfgDevelop', { defaultValue: 'Develop branch' })}</label>
              <input type="text" className="w-full text-sm mono" value={develop} onChange={(e) => setDevelop(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-tertiary block mb-1">{t('pages.gitflowCfgFeature', { defaultValue: 'Feature prefix' })}</label>
              <input type="text" className="w-full text-sm mono" value={featurePrefix} onChange={(e) => setFeaturePrefix(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-text-tertiary block mb-1">{t('pages.gitflowCfgRelease', { defaultValue: 'Release prefix' })}</label>
              <input type="text" className="w-full text-sm mono" value={releasePrefix} onChange={(e) => setReleasePrefix(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-tertiary block mb-1">{t('pages.gitflowCfgHotfix', { defaultValue: 'Hotfix prefix' })}</label>
              <input type="text" className="w-full text-sm mono" value={hotfixPrefix} onChange={(e) => setHotfixPrefix(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-text-tertiary block mb-1">{t('pages.gitflowCfgVersionTag', { defaultValue: 'Version tag prefix' })}</label>
              <input type="text" className="w-full text-sm mono" value={versionTagPrefix} onChange={(e) => setVersionTagPrefix(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-text-tertiary block mb-1">{t('pages.gitflowCfgOriginRemote', { defaultValue: 'Origin remote' })}</label>
            <input type="text" className="w-full text-sm mono" value={originRemote} onChange={(e) => setOriginRemote(e.target.value)} />
          </div>
          <div className="text-2xs text-text-tertiary p-2 bg-bg-tertiary rounded">
            {t('pages.gitflowCfgHint', { defaultValue: 'Changes are written to local git config (gitflow.* keys). Renaming an already-used prefix will not move existing branches.' })}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <Loader size={13} className="spin" /> : <Check size={13} />}
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
