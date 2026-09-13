import { useState, useEffect, useCallback } from 'react';
import { X, GitBranch, Tag, AlertCircle, Loader, GitMerge, CornerDownRight } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { api } from '../lib/api';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useI18n } from '../lib/i18n';
import {
  detectGitFlowConfig,
  startFeature,
  finishFeature,
  startRelease,
  finishRelease,
  startHotfix,
  finishHotfix,
  listFlowBranches,
  type GitFlowConfig,
} from '../lib/gitflow';

type FlowType = 'feature' | 'release' | 'hotfix';
type Action = 'start' | 'finish';

interface GitFlowDialogProps {
  open: boolean;
  onClose: () => void;
  initialFlow?: FlowType;
  initialAction?: Action;
  initialName?: string;
}

export function GitFlowDialog({
  open,
  onClose,
  initialFlow = 'feature',
  initialAction = 'start',
  initialName = '',
}: GitFlowDialogProps) {
  useEscapeKey(open, onClose);
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastActions();
  const [flow, setFlow] = useState<FlowType>(initialFlow);
  const [action, setAction] = useState<Action>(initialAction);
  const [name, setName] = useState(initialName);
  const [config, setConfig] = useState<GitFlowConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [existingBranches, setExistingBranches] = useState<{ features: any[]; releases: any[]; hotfixes: any[] }>({
    features: [], releases: [], hotfixes: [],
  });

  // Options
  const [rebase, setRebase] = useState(false);
  const [squash, setSquash] = useState(false);
  const [noFF, setNoFF] = useState(true);
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [pushToRemote, setPushToRemote] = useState(false);
  const [tagMessage, setTagMessage] = useState('');

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await detectGitFlowConfig(repo.path);
      setConfig(cfg);
      const lists = await listFlowBranches(repo.path, cfg);
      setExistingBranches({
        features: lists.features,
        releases: lists.releases,
        hotfixes: lists.hotfixes,
      });
    } catch (e) {
      toast.error(t('pages.gitflowConfigLoadFailed'), String(e));
    }
  }, [repo.path, toast]);

  useEffect(() => {
    if (open) {
      setFlow(initialFlow);
      setAction(initialAction);
      setName(initialName);
      loadConfig();
    }
  }, [open, initialFlow, initialAction, initialName, loadConfig]);

  const handleExecute = async () => {
    if (!name.trim()) {
      toast.warning(t('pages.nameRequired'));
      return;
    }
    setLoading(true);
    try {
      const opts = { rebase, squash, noFF, deleteBranch, pushToRemote, tagMessage, cfg: config || undefined };
      if (flow === 'feature') {
        if (action === 'start') {
          await startFeature(repo.path, name, undefined, config || undefined);
          toast.success(t('pages.flowFeatureStarted', { name }));
        } else {
          await finishFeature(repo.path, name, opts);
          toast.success(t('pages.flowFeatureFinished', { name }));
        }
      } else if (flow === 'release') {
        if (action === 'start') {
          await startRelease(repo.path, name, undefined, config || undefined);
          toast.success(t('pages.flowReleaseStarted', { name }));
        } else {
          await finishRelease(repo.path, name, opts);
          toast.success(t('pages.flowReleaseFinished', { name }));
        }
      } else {
        if (action === 'start') {
          await startHotfix(repo.path, name, undefined, config || undefined);
          toast.success(t('pages.flowHotfixStarted', { name }));
        } else {
          await finishHotfix(repo.path, name, opts);
          toast.success(t('pages.flowHotfixFinished', { name }));
        }
      }
      await refreshStatus(repo.path);
      onClose();
    } catch (e) {
      toast.error(t('pages.operationFailed'), String(e));
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const prefix = config
    ? flow === 'feature' ? config.featurePrefix
    : flow === 'release' ? config.releasePrefix
    : config.hotfixPrefix
    : '';
  const fullBranchName = `${prefix}${name}`;
  const baseBranch = config
    ? flow === 'hotfix' ? config.masterBranch : config.developBranch
    : '';

  const existing = flow === 'feature' ? existingBranches.features
    : flow === 'release' ? existingBranches.releases
    : existingBranches.hotfixes;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="panel w-[520px] flex flex-col shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 className="text-base font-medium flex items-center gap-2">
            <GitBranch size={16} />
            {t('nav.gitflow')} — {action === 'start' ? t('pages.flowStartWord') : t('pages.flowFinishWord')} {flow}
          </h3>
          <button className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Flow type tabs */}
          <div className="flex gap-1 p-1 bg-bg-tertiary rounded">
            {(['feature', 'release', 'hotfix'] as FlowType[]).map((f) => (
              <button
                key={f}
                className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
                  flow === f ? 'bg-accent text-text-inverse' : 'text-text-secondary hover:bg-bg-hover'
                }`}
                onClick={() => setFlow(f)}
              >
                {t(f === 'feature' ? 'pages.flowTypeFeature' : f === 'release' ? 'pages.flowTypeRelease' : 'pages.flowTypeHotfix')}
              </button>
            ))}
          </div>

          {/* Action toggle */}
          <div className="flex gap-2">
            <button
              className={`flex-1 btn ${action === 'start' ? 'btn-primary' : 'btn-secondary'} text-xs`}
              onClick={() => setAction('start')}
            >
              {t('pages.flowStartWord')}
            </button>
            <button
              className={`flex-1 btn ${action === 'finish' ? 'btn-primary' : 'btn-secondary'} text-xs`}
              onClick={() => setAction('finish')}
            >
              {t('pages.flowFinishWord')}
            </button>
          </div>

          {/* Name input */}
          <div>
            <label className="text-xs text-text-tertiary block mb-1">
              {flow === 'feature' ? t('pages.flowFeatureNameLabel') : flow === 'release' ? t('pages.flowVersionNameLabel') : t('pages.flowHotfixNameLabel')}
            </label>
            <div className="flex items-center gap-2">
              <code className="text-xs mono text-text-tertiary">{prefix}</code>
              <input
                type="text"
                className="flex-1 text-sm"
                placeholder={flow === 'feature' ? 'my-feature' : flow === 'release' ? '1.2.0' : '1.2.1'}
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                list="existing-branches"
              />
              <datalist id="existing-branches">
                {existing.map((b) => (
                  <option key={b.name} value={b.name.replace(prefix, '')} />
                ))}
              </datalist>
            </div>
            {name && (
              <div className="text-2xs text-text-tertiary mt-1">
                {t('pages.branchLabel')} <code className="mono">{fullBranchName}</code>
                {action === 'start' && baseBranch && (
                  <span> {t('pages.baseLabel')} <code className="mono">{baseBranch}</code></span>
                )}
              </div>
            )}
          </div>

          {/* Options for finish */}
          {action === 'finish' && (
            <div className="space-y-2 p-3 bg-bg-tertiary rounded">
              <div className="text-xs font-medium text-text-secondary mb-1">{t('pages.flowFinishOptions')}</div>
              {flow === 'feature' && (
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={rebase} onChange={(e) => setRebase(e.target.checked)} />
                  {t('pages.flowOptRebase')}
                </label>
              )}
              {flow === 'feature' && (
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={squash} onChange={(e) => setSquash(e.target.checked)} />
                  {t('pages.flowOptSquash')}
                </label>
              )}
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={noFF} onChange={(e) => setNoFF(e.target.checked)} />
                {t('pages.flowOptNoFF')}
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} />
                {t('pages.flowOptDeleteBranch')}
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={pushToRemote} onChange={(e) => setPushToRemote(e.target.checked)} />
                {t('pages.flowOptPush')}
              </label>
              {(flow === 'release' || flow === 'hotfix') && (
                <div className="mt-2">
                  <label className="text-xs text-text-tertiary block mb-1">{t('pages.tagMessageLabel')}</label>
                  <input
                    type="text"
                    className="w-full text-sm"
                    placeholder={t('pages.tagMessagePlaceholder', { name })}
                    value={tagMessage}
                    onChange={(e) => setTagMessage(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          {/* Info for release/hotfix */}
          {(flow === 'release' || flow === 'hotfix') && action === 'finish' && (
            <div className="flex items-start gap-2 p-2 bg-accent-muted rounded text-xs">
              <AlertCircle size={12} className="text-accent flex-shrink-0 mt-0.5" />
              <div className="text-text-secondary">
                {t('pages.flowThisWill')}
                <ul className="mt-1 space-y-0.5">
                  <li>• {t('pages.flowBulletMerge')} <code className="mono">{fullBranchName}</code> {t('pages.flowInto')} <code className="mono">{config?.masterBranch}</code></li>
                  <li>• {t('pages.flowBulletTag')} <code className="mono">{config?.versionTagPrefix}{name}</code></li>
                  <li>• {t('pages.flowBulletMergeBack')} <code className="mono">{config?.developBranch}</code></li>
                  {deleteBranch && <li>• {t('pages.flowBulletDelete')} <code className="mono">{fullBranchName}</code></li>}
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="btn btn-primary"
            onClick={handleExecute}
            disabled={loading || !name.trim()}
          >
            {loading ? <Loader size={13} className="spin" /> : action === 'start' ? <GitBranch size={13} /> : <GitMerge size={13} />}
            {action === 'start' ? t('pages.flowStartWord') : t('pages.flowFinishWord')} {flow}
          </button>
        </div>
      </div>
    </div>
  );
}
