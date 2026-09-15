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
  flowPrefix,
  startFeature,
  finishFeature,
  startRelease,
  finishRelease,
  startHotfix,
  finishHotfix,
  startFix,
  finishFix,
  startSupport,
  listFlowBranches,
  type GitFlowConfig,
  type FlowType,
} from '../lib/gitflow';

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
  const [existingBranches, setExistingBranches] = useState<{
    features: any[]; releases: any[]; hotfixes: any[]; fixes: any[]; supports: any[];
  }>({
    features: [], releases: [], hotfixes: [], fixes: [], supports: [],
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
        fixes: (lists as any).fixes ?? [],
        supports: (lists as any).supports ?? [],
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
      } else if (flow === 'hotfix') {
        if (action === 'start') {
          await startHotfix(repo.path, name, undefined, config || undefined);
          toast.success(t('pages.flowHotfixStarted', { name }));
        } else {
          await finishHotfix(repo.path, name, opts);
          toast.success(t('pages.flowHotfixFinished', { name }));
        }
      } else if (flow === 'fix') {
        if (action === 'start') {
          await startFix(repo.path, name, undefined, config || undefined);
          toast.success(t('pages.flowFixStarted', { defaultValue: 'Started fix {name}', name }));
        } else {
          await finishFix(repo.path, name, opts);
          toast.success(t('pages.flowFixFinished', { defaultValue: 'Finished fix {name}', name }));
        }
      } else if (flow === 'support') {
        // Support branches are not "finished" — they're long-lived.
        if (action === 'finish') {
          toast.warning(t('pages.flowSupportNoFinish', { defaultValue: 'Support branches are long-lived; there is no finish action.' }));
          return;
        }
        await startSupport(repo.path, name, undefined, config || undefined);
        toast.success(t('pages.flowSupportStarted', { defaultValue: 'Started support {name}', name }));
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

  const prefix = config ? flowPrefix(config, flow) : '';
  const fullBranchName = `${prefix}${name}`;
  // Hotfix + support branch off master; everything else branches off develop.
  const baseBranch = config
    ? (flow === 'hotfix' || flow === 'support') ? config.masterBranch : config.developBranch
    : '';

  const existing = flow === 'feature' ? existingBranches.features
    : flow === 'release' ? existingBranches.releases
    : flow === 'hotfix' ? existingBranches.hotfixes
    : flow === 'fix' ? existingBranches.fixes
    : existingBranches.supports;

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
            {/* Title: "Git-Flow — Start feature" — translate the flow word
                via t('pages.flowType.<flow>'). Previously `{flow}` rendered
                the raw English kind ('feature'/'release'/'hotfix'/'fix'/'support')
                which was one of the user's complaints about incomplete
                localization. */}
            {t('nav.gitflow')} — {action === 'start' ? t('pages.flowStartWord') : t('pages.flowFinishWord')} {t(`pages.flowType.${flow}`, { defaultValue: flow })}
          </h3>
          <button className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Flow type tabs */}
          <div className="flex gap-1 p-1 bg-bg-tertiary rounded flex-wrap">
            {(['feature', 'release', 'hotfix', 'fix', 'support'] as FlowType[]).map((f) => (
              <button
                key={f}
                className={`flex-1 min-w-[60px] py-1.5 text-xs font-medium rounded transition-colors ${
                  flow === f ? 'bg-accent text-text-inverse' : 'text-text-secondary hover:bg-bg-hover'
                }`}
                onClick={() => setFlow(f)}
              >
                {t(`pages.flowType.${f}`, { defaultValue: f })}
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
              {flow === 'feature' ? t('pages.flowFeatureNameLabel')
                : flow === 'release' ? t('pages.flowVersionNameLabel')
                : flow === 'hotfix' ? t('pages.flowHotfixNameLabel')
                : flow === 'fix' ? t('pages.flowFixNameLabel', { defaultValue: 'Fix name' })
                : t('pages.flowSupportNameLabel', { defaultValue: 'Support name like 1.x' })}
            </label>
            <div className="flex items-center gap-2">
              <code className="text-xs mono text-text-tertiary">{prefix}</code>
              <input
                type="text"
                className="flex-1 text-sm"
                placeholder={flow === 'feature' ? 'my-feature'
                  : flow === 'release' ? '1.2.0'
                  : flow === 'hotfix' ? '1.2.1'
                  : flow === 'fix' ? 'login-crash'
                  : '1.x'}
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
