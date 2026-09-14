import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Copy, Eye, KeyRound, Loader, Lock, Pencil, Plus, Save, Trash, Upload } from '../icons';
import { api, type CredentialsStatus, type SecretEntryMeta, type SshKeyMeta } from '../../lib/api';
import { confirmDialog } from '../ConfirmDialog';
import { useSettingsStore } from '../../stores/settingsStore';
import { useToastActions } from '../../stores/toastStore';
import { useI18n } from '../../lib/i18n';
import { cn } from '../../lib/utils';

/**
 * Settings → Security & SSH tab.
 *
 * Three sections:
 *  1. Credential storage — honest status of the encrypted vault
 *     (OS keychain via safeStorage / 0600 fallback file) + secret count.
 *  2. Stored secrets — the secrets MANAGER: every vault entry listed
 *     (metadata only), each one copyable / replaceable / deletable, plus a
 *     form to register new secrets manually. Values are never rendered.
 *  3. SSH keys — generate/import/test/delete managed keys, pick the default
 *     key, strict host key checking. Passphrases never appear in this UI;
 *     they live in the vault from the moment of creation.
 */

const KNOWN_SECRET_GROUPS = ['tokens', 'remoteAuth', 'ai', 'github', 'ssh'] as const;

/** Human-readable label for one vault entry (metadata → display name). */
function secretLabel(entry: SecretEntryMeta): string {
  if (entry.ns === 'remoteAuth') {
    // key = "<repoPath>|<remote>" — split at the LAST separator
    const idx = entry.key.lastIndexOf('|');
    return idx > 0
      ? `${entry.key.slice(idx + 1)}  ·  ${entry.key.slice(0, idx)}`
      : entry.key;
  }
  if (entry.ns === 'ssh') return entry.key.replace(/^pass:/, '');
  if (entry.ns === 'ai') return entry.key.replace(/^provider:/, '');
  return entry.key;
}
export function SecuritySettings() {
  const { t } = useI18n();
  const toast = useToastActions();
  const { settings, setSetting } = useSettingsStore();

  const [status, setStatus] = useState<CredentialsStatus | null>(null);
  const [keys, setKeys] = useState<SshKeyMeta[]>([]);
  const [secrets, setSecrets] = useState<SecretEntryMeta[]>([]);
  const [loading, setLoading] = useState(true);

  // Add-secret form state
  const [showAdd, setShowAdd] = useState(false);
  const [addNs, setAddNs] = useState<'tokens' | 'remoteAuth' | 'ai' | 'ssh' | 'github' | 'other'>('tokens');
  const [addKey, setAddKey] = useState('');
  const [addValue, setAddValue] = useState('');
  const [addRepoPath, setAddRepoPath] = useState('');
  const [addRemote, setAddRemote] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  // Replace-value state (one entry at a time)
  const [editing, setEditing] = useState<{ ns: string; key: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [st, ks, entries] = await Promise.all([
        Promise.resolve(api.credentials?.status?.()).catch(() => null),
        Promise.resolve(api.ssh?.list?.()).catch(() => [] as SshKeyMeta[]),
        Promise.resolve(api.credentials?.list?.()).catch(() => [] as SecretEntryMeta[]),
      ]);
      setStatus((st as CredentialsStatus | null) ?? null);
      setKeys((ks as SshKeyMeta[]) ?? []);
      setSecrets((entries as SecretEntryMeta[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCopySecret = async (ns: string, key: string) => {
    try {
      const value = await api.credentials?.reveal?.(ns, key);
      if (!value) {
        toast.warning(t('security.secrets.notFound'));
        return;
      }
      await navigator.clipboard.writeText(value);
      toast.success(t('security.secrets.copied'));
    } catch (e) {
      toast.error(t('common.error'), String(e));
    }
  };

  const handleDeleteSecret = async (entry: SecretEntryMeta) => {
    const label = secretLabel(entry);
    if (!(await confirmDialog({
      title: t('security.secrets.delete'),
      message: t('security.secrets.deleteConfirm', { name: label }),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) return;
    try {
      await api.credentials?.delete?.(entry.ns, entry.key);
      toast.success(t('security.secrets.deleted'));
      await reload();
    } catch (e) {
      toast.error(t('common.error'), String(e));
    }
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setEditBusy(true);
    try {
      await api.credentials?.set?.(editing.ns, editing.key, editValue);
      toast.success(t('security.secrets.saved'));
      setEditing(null);
      setEditValue('');
      await reload();
    } catch (e) {
      toast.error(t('common.error'), String(e));
    } finally {
      setEditBusy(false);
    }
  };

  const handleAddSecret = async () => {
    if (addNs === 'remoteAuth') {
      if (!addRepoPath.trim() || !addRemote.trim()) {
        toast.warning(t('security.secrets.keyRequired'));
        return;
      }
    } else if (!addKey.trim()) {
      toast.warning(t('security.secrets.keyRequired'));
      return;
    }
    if (!addValue) {
      toast.warning(t('security.secrets.valueRequired'));
      return;
    }
    const ns = addNs;
    const key = addNs === 'remoteAuth'
      ? `${addRepoPath.trim().replace(/[\\/]+$/, '')}|${addRemote.trim()}`
      : addKey.trim();
    setAddBusy(true);
    try {
      await api.credentials?.set?.(ns, key, addValue);
      toast.success(t('security.secrets.saved'));
      setShowAdd(false);
      setAddKey(''); setAddValue(''); setAddRepoPath(''); setAddRemote('');
      await reload();
    } catch (e) {
      toast.error(t('common.error'), String(e));
    } finally {
      setAddBusy(false);
    }
  };

  const [genLabel, setGenLabel] = useState('');

  // Generate dialog state
  const [showGenerate, setShowGenerate] = useState(false);
  const [genComment, setGenComment] = useState('');
  const [genPassphrase, setGenPassphrase] = useState('');
  const [genBusy, setGenBusy] = useState(false);

  // Import dialog state
  const [showImport, setShowImport] = useState(false);
  const [importLabel, setImportLabel] = useState('');
  const [importPath, setImportPath] = useState('');
  const [importPassphrase, setImportPassphrase] = useState('');
  const [importBusy, setImportBusy] = useState(false);

  // Connectivity test state (per key id)
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; output: string } | null>(null);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleGenerate = async () => {
    if (!genLabel.trim()) {
      toast.warning(t('security.ssh.keyLabel'));
      return;
    }
    setGenBusy(true);
    try {
      await api.ssh.generate({
        label: genLabel.trim(),
        comment: genComment.trim() || undefined,
        passphrase: genPassphrase || undefined,
      });
      toast.success(t('security.ssh.generated'));
      setShowGenerate(false);
      setGenLabel('');
      setGenComment('');
      setGenPassphrase('');
      await reload();
    } catch (e) {
      toast.error(t('security.ssh.testFailed'), String(e));
    } finally {
      setGenBusy(false);
    }
  };

  const handleImport = async () => {
    if (!importPath.trim()) {
      toast.warning(t('security.ssh.importPath'));
      return;
    }
    setImportBusy(true);
    try {
      const fallbackLabel = importPath.trim().split(/[\\/]/).pop() || 'imported key';
      await api.ssh.importKey({
        label: importLabel.trim() || fallbackLabel,
        sourcePath: importPath.trim(),
        passphrase: importPassphrase || undefined,
      });
      toast.success(t('security.ssh.imported'));
      setShowImport(false);
      setImportLabel('');
      setImportPath('');
      setImportPassphrase('');
      await reload();
    } catch (e) {
      toast.error(t('security.ssh.testFailed'), String(e));
    } finally {
      setImportBusy(false);
    }
  };

  const handleCopyPub = async (id: string) => {
    try {
      const pub = await api.ssh.copyPublicKey(id);
      await navigator.clipboard.writeText(pub);
      toast.success(t('security.ssh.copyPubDone'));
    } catch (e) {
      toast.error(t('common.error'), String(e));
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const res = await api.ssh.test(id, {});
      setTestResult({ id, ok: res.ok, output: res.output });
      if (res.ok) toast.success(t('security.ssh.testOk'));
      else toast.warning(t('security.ssh.testFailed'));
    } catch (e) {
      setTestResult({ id, ok: false, output: String(e) });
      toast.error(t('security.ssh.testFailed'), String(e));
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (key: SshKeyMeta) => {
    if (!(await confirmDialog({
      title: t('security.ssh.delete'),
      message: t('security.ssh.deleteConfirm', { label: key.label }),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) return;
    try {
      await api.ssh.remove(key.id);
      toast.success(t('security.ssh.deleted'));
      await reload();
    } catch (e) {
      toast.error(t('common.error'), String(e));
    }
  };

  const backendLabel = !status
    ? '…'
    : status.backend === 'keychain'
      ? t('security.storage.backend.keychain')
      : status.backend === 'file-0600'
        ? t('security.storage.backend.file-0600')
        : t('security.storage.backend.unavailable');

  const inputCls =
    'w-full bg-bg-primary border border-border-default rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:border-accent';

  return (
    <div>
      {/* ── Credential storage ── */}
      <section className="panel mb-4">
        <div className="panel-header flex items-center gap-2">
          <Lock size={12} />
          {t('security.storage.title')}
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-text-tertiary">{t('security.storage.desc')}</p>
          {status && (
            <div
              className={cn(
                'flex items-center gap-2 text-xs rounded-md border px-3 py-2',
                status.backend === 'keychain'
                  ? 'border-status-added/30 bg-status-added/10 text-text-primary'
                  : 'border-status-warning/40 bg-status-warning/10 text-text-primary'
              )}
            >
              {status.backend === 'keychain' ? (
                <CheckCircle size={14} className="text-status-added flex-shrink-0" />
              ) : (
                <AlertCircle size={14} className="text-status-warning flex-shrink-0" />
              )}
              <span className="font-medium">{backendLabel}</span>
              <span className="text-text-tertiary">
                · {t('security.storage.secrets', { count: status.secretCount })}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* ── Stored secrets (manager) ── */}
      <section className="panel mb-4">
        <div className="panel-header flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Eye size={12} />
            {t('security.secrets.title')}
            {secrets.length > 0 && (
              <span className="badge badge-added text-2xs">{secrets.length}</span>
            )}
          </span>
          <button className="btn btn-secondary !py-1 !px-2.5 !text-xs" onClick={() => setShowAdd((v) => !v)}>
            <Plus size={12} /> {t('security.secrets.add')}
          </button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-text-tertiary">{t('security.secrets.desc')}</p>

          {/* Add-secret form */}
          {showAdd && (
            <div className="rounded-md border border-border-default bg-bg-secondary/40 p-3 space-y-2.5">
              <div className="text-xs font-semibold">{t('security.secrets.addTitle')}</div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  className={inputCls}
                  value={addNs}
                  onChange={(e) => setAddNs(e.target.value as typeof addNs)}
                >
                  {KNOWN_SECRET_GROUPS.map((g) => (
                    <option key={g} value={g}>{t(`security.secrets.group.${g}`)}</option>
                  ))}
                </select>
                {addNs === 'remoteAuth' ? (
                  <input
                    className={inputCls}
                    placeholder={t('security.secrets.remoteName')}
                    value={addRemote}
                    onChange={(e) => setAddRemote(e.target.value)}
                  />
                ) : (
                  <input
                    className={inputCls}
                    placeholder={t('security.secrets.keyLabel')}
                    value={addKey}
                    onChange={(e) => setAddKey(e.target.value)}
                  />
                )}
                {addNs === 'remoteAuth' && (
                  <input
                    className={inputCls + ' col-span-2'}
                    placeholder={t('security.secrets.repoPath')}
                    value={addRepoPath}
                    onChange={(e) => setAddRepoPath(e.target.value)}
                  />
                )}
                <input
                  className={inputCls + ' col-span-2'}
                  type="password"
                  autoComplete="off"
                  placeholder={t('security.secrets.valueLabel')}
                  value={addValue}
                  onChange={(e) => setAddValue(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button className="btn btn-secondary !py-1 !px-2.5 !text-xs" onClick={() => setShowAdd(false)}>{t('common.cancel')}</button>
                <button className="btn btn-primary !py-1 !px-2.5 !text-xs flex items-center gap-1.5" disabled={addBusy} onClick={handleAddSecret}>
                  {addBusy ? <Loader size={12} className="animate-spin" /> : <Save size={12} />}
                  {t('security.secrets.save')}
                </button>
              </div>
            </div>
          )}

          {/* Entries */}
          {loading ? (
            <div className="flex justify-center py-4"><Loader size={16} className="animate-spin text-text-tertiary" /></div>
          ) : secrets.length === 0 ? (
            <div className="text-xs text-text-tertiary py-3 text-center">{t('security.secrets.empty')}</div>
          ) : (
            KNOWN_SECRET_GROUPS.map((group) => {
              const groupEntries = secrets.filter((s) => s.ns === group);
              if (groupEntries.length === 0) return null;
              return (
                <div key={group} className="space-y-2">
                  <div className="text-2xs uppercase text-text-tertiary font-bold tracking-wider">
                    {t(`security.secrets.group.${group}`)} · {groupEntries.length}
                  </div>
                  {groupEntries.map((entry) => {
                    const isEditing = editing?.ns === entry.ns && editing?.key === entry.key;
                    return (
                      <div key={`${entry.ns}\u001f${entry.key}`} className="rounded-md border border-border-default bg-bg-secondary/40 px-3 py-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <KeyRound size={12} className="text-accent flex-shrink-0" />
                          <span className="text-xs font-medium font-mono truncate max-w-[45%]" title={secretLabel(entry)}>
                            {secretLabel(entry)}
                          </span>
                          <span
                            className={cn(
                              'badge text-2xs uppercase',
                              entry.encrypted ? 'badge-added' : 'badge-modified'
                            )}
                            title={entry.encrypted ? t('security.storage.backend.keychain') : t('security.storage.backend.file-0600')}
                          >
                            {entry.encrypted ? t('security.secrets.encrypted') : t('security.secrets.plainFile')}
                          </span>
                          <div className="flex-1" />
                          <button
                            className="icon-btn !w-6 !h-6"
                            title={t('security.secrets.copy')}
                            onClick={() => handleCopySecret(entry.ns, entry.key)}
                          >
                            <Copy size={12} />
                          </button>
                          <button
                            className="icon-btn !w-6 !h-6"
                            title={t('security.secrets.replace')}
                            onClick={() => { setEditing(isEditing ? null : { ns: entry.ns, key: entry.key }); setEditValue(''); }}
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            className="icon-btn !w-6 !h-6 hover:text-status-deleted"
                            title={t('security.secrets.delete')}
                            onClick={() => handleDeleteSecret(entry)}
                          >
                            <Trash size={12} />
                          </button>
                        </div>
                        {isEditing && (
                          <div className="flex items-center gap-2 mt-2">
                            <input
                              className={inputCls + ' flex-1'}
                              type="password"
                              autoComplete="off"
                              placeholder={t('security.secrets.replaceHint')}
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                            />
                            <button
                              className="btn btn-primary !py-1 !px-2.5 !text-xs flex items-center gap-1.5"
                              disabled={editBusy || !editValue}
                              onClick={handleSaveEdit}
                            >
                              {editBusy ? <Loader size={12} className="animate-spin" /> : <Save size={12} />}
                              {t('security.secrets.save')}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* ── SSH keys ── */}
      <section className="panel mb-4">
        <div className="panel-header flex items-center justify-between">
          <span className="flex items-center gap-2">
            <KeyRound size={12} />
            {t('security.ssh.title')}
          </span>
          <span className="flex items-center gap-2">
            <button className="btn btn-secondary !py-1 !px-2.5 !text-xs" onClick={() => { setShowGenerate((v) => !v); setShowImport(false); }}>
              <Plus size={12} /> {t('security.ssh.generate')}
            </button>
            <button className="btn btn-secondary !py-1 !px-2.5 !text-xs" onClick={() => { setShowImport((v) => !v); setShowGenerate(false); }}>
              <Upload size={12} /> {t('security.ssh.import')}
            </button>
          </span>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-text-tertiary">{t('security.ssh.desc')}</p>

          {/* Generate form */}
          {showGenerate && (
            <div className="rounded-md border border-border-default bg-bg-secondary/40 p-3 space-y-2.5">
              <div className="text-xs font-semibold">{t('security.ssh.generateTitle')}</div>
              <div className="grid grid-cols-2 gap-2">
                <input className={inputCls} placeholder={t('security.ssh.keyLabel')} value={genLabel} onChange={(e) => setGenLabel(e.target.value)} />
                <input className={inputCls} placeholder={t('security.ssh.keyComment')} value={genComment} onChange={(e) => setGenComment(e.target.value)} />
              </div>
              <input
                className={inputCls}
                type="password"
                autoComplete="new-password"
                placeholder={t('security.ssh.keyPassphrase')}
                value={genPassphrase}
                onChange={(e) => setGenPassphrase(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button className="btn btn-secondary !py-1 !px-2.5 !text-xs" onClick={() => setShowGenerate(false)}>{t('common.cancel')}</button>
                <button className="btn btn-primary !py-1 !px-2.5 !text-xs flex items-center gap-1.5" disabled={genBusy} onClick={handleGenerate}>
                  {genBusy ? <Loader size={12} className="animate-spin" /> : <KeyRound size={12} />}
                  {t('security.ssh.generateBtn')}
                </button>
              </div>
            </div>
          )}

          {/* Import form */}
          {showImport && (
            <div className="rounded-md border border-border-default bg-bg-secondary/40 p-3 space-y-2.5">
              <div className="text-xs font-semibold">{t('security.ssh.importTitle')}</div>
              <div className="grid grid-cols-2 gap-2">
                <input className={inputCls} placeholder={t('security.ssh.keyLabel')} value={importLabel} onChange={(e) => setImportLabel(e.target.value)} />
                <input className={inputCls} placeholder="~/.ssh/id_ed25519" value={importPath} onChange={(e) => setImportPath(e.target.value)} />
              </div>
              <input
                className={inputCls}
                type="password"
                autoComplete="new-password"
                placeholder={t('security.ssh.keyPassphrase')}
                value={importPassphrase}
                onChange={(e) => setImportPassphrase(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button className="btn btn-secondary !py-1 !px-2.5 !text-xs" onClick={() => setShowImport(false)}>{t('common.cancel')}</button>
                <button className="btn btn-primary !py-1 !px-2.5 !text-xs flex items-center gap-1.5" disabled={importBusy} onClick={handleImport}>
                  {importBusy ? <Loader size={12} className="animate-spin" /> : <Upload size={12} />}
                  {t('security.ssh.importBtn')}
                </button>
              </div>
            </div>
          )}

          {/* Key list */}
          {loading ? (
            <div className="flex justify-center py-4"><Loader size={16} className="animate-spin text-text-tertiary" /></div>
          ) : keys.length === 0 ? (
            <div className="text-xs text-text-tertiary py-3 text-center">{t('security.ssh.empty')}</div>
          ) : (
            <div className="space-y-2">
              {keys.map((k) => {
                const isDefault = settings.sshDefaultKeyId === k.id;
                return (
                  <div key={k.id} className="rounded-md border border-border-default bg-bg-secondary/40 p-3 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <KeyRound size={12} className="text-accent flex-shrink-0" />
                      <span className="text-xs font-medium">{k.label}</span>
                      <span className="badge badge-renamed uppercase">{k.type}</span>
                      {k.hasPassphrase && <span className="badge badge-modified">{t('security.ssh.passphraseProtected')}</span>}
                      {isDefault && <span className="badge badge-added">{t('security.ssh.defaultBadge')}</span>}
                      <div className="flex-1" />
                      {!isDefault && (
                        <button
                          className="icon-btn !w-6 !h-6"
                          title={t('security.ssh.setDefault')}
                          onClick={() => setSetting('sshDefaultKeyId', k.id)}
                        >
                          <CheckCircle size={12} />
                        </button>
                      )}
                      <button
                        className="icon-btn !w-6 !h-6"
                        title={t('security.ssh.copyPub')}
                        onClick={() => handleCopyPub(k.id)}
                      >
                        <Copy size={12} />
                      </button>
                      <button
                        className="icon-btn !w-6 !h-6"
                        title={t('security.ssh.test')}
                        disabled={testingId === k.id}
                        onClick={() => handleTest(k.id)}
                      >
                        {testingId === k.id ? <Loader size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                      </button>
                      <button
                        className="icon-btn !w-6 !h-6 hover:text-status-deleted"
                        title={t('security.ssh.delete')}
                        onClick={() => handleDelete(k)}
                      >
                        <Trash size={12} />
                      </button>
                    </div>
                    {k.fingerprint && (
                      <div className="text-2xs font-mono text-text-tertiary truncate" title={k.fingerprint}>
                        {k.fingerprint}
                      </div>
                    )}
                    {testResult?.id === k.id && (
                      <div className={cn('text-2xs rounded-md border px-2 py-1.5 whitespace-pre-wrap max-h-32 overflow-y-auto font-mono',
                        testResult.ok ? 'border-status-added/30 bg-status-added/10' : 'border-status-deleted/30 bg-status-deleted/10')}>
                        {testResult.ok ? t('security.ssh.testOk') : t('security.ssh.testFailed')}
                        {testResult.output ? `\n${testResult.output}` : ''}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Strict host key checking */}
          <label className="flex items-start gap-3 cursor-pointer" title={t('security.ssh.strictHostKeysHint')}>
            <input
              type="checkbox"
              className="mt-0.5"
              checked={settings.sshStrictHostKeyChecking === true}
              onChange={(e) => setSetting('sshStrictHostKeyChecking', e.target.checked)}
            />
            <span>
              <span className="text-xs font-medium">{t('security.ssh.strictHostKeys')}</span>
              <span className="block text-2xs text-text-tertiary">{t('security.ssh.strictHostKeysHint')}</span>
            </span>
          </label>

          <p className="text-2xs text-text-tertiary">{t('security.ssh.repoHint')}</p>
        </div>
      </section>
    </div>
  );
}
