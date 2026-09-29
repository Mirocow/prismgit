/**
 * authErrors — classify HTTP(S) authentication failures into actionable kinds.
 *
 * User report (the NEXT step of the corporate-server story after sslErrors):
 *   «Ошибка pull
 *    Error invoking remote method 'git:pull': Error: Authentication failed — …
 *    fatal: could not read Username for
 *    'https://git.nbgi.cloud.rt-dc.ru': terminal prompts disabled»
 *   — «должен быть запрос логина и пароля у пользователя когда приходит эта
 *      ошибка и потом пароль и логин сохранять в сторадже»
 *
 * Pins the contract:
 *  1. The REPORTED message classifies as no-credentials with the host
 *     extracted from the quoted URL (this is exactly what offerAuthBypass()
 *     relies on to open RemoteAuthDialog).
 *  2. Wrong/expired stored credentials → bad-credentials.
 *  3. 403 → forbidden.
 *  4. Everything credentials CANNOT fix → null: TLS certificate problems
 *     (sslErrors owns them), transport failures, SSH publickey problems,
 *     remote-side push rejections (pushFailures owns them).
 */
import { describe, it, expect } from 'vitest';
import {
  classifyAuthFailure,
  AUTH_KIND_LABELS,
  type AuthFailureKind,
} from '../../src/lib/authErrors';

const REPORTED = `Authentication failed — enter Username + Password/token in the authentication dialog (it saves them and retries). fatal: could not read Username for 'https://git.nbgi.cloud.rt-dc.ru': terminal prompts disabled`;

describe('classifyAuthFailure — the reported pull failure', () => {
  it('classifies the user-reported message as no-credentials with host+url', () => {
    const info = classifyAuthFailure(new Error(REPORTED));
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('no-credentials');
    expect(info!.host).toBe('git.nbgi.cloud.rt-dc.ru');
    expect(info!.url).toBe('https://git.nbgi.cloud.rt-dc.ru');
    expect(info!.message).toContain('terminal prompts disabled');
  });

  it('the RAW git stderr (without the hint wrapper) classifies too', () => {
    const raw = `fatal: could not read Username for 'https://git.nbgi.cloud.rt-dc.ru': terminal prompts disabled`;
    const info = classifyAuthFailure(new Error(raw));
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('no-credentials');
    expect(info!.host).toBe('git.nbgi.cloud.rt-dc.ru');
  });
});

describe('classifyAuthFailure — rejected credentials', () => {
  it('git Authentication failed → bad-credentials', () => {
    const info = classifyAuthFailure(
      new Error(`fatal: Authentication failed for 'https://gitlab.example.com/owner/repo.git/'`)
    );
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('bad-credentials');
    expect(info!.host).toBe('gitlab.example.com');
  });

  it('GitLab HTTP Basic: Access denied → bad-credentials', () => {
    const info = classifyAuthFailure(
      new Error(`remote: HTTP Basic: Access denied. The provided password or token for user "ivan" is wrong.`)
    );
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('bad-credentials');
  });

  it('HTTP 401 from the server → bad-credentials', () => {
    const info = classifyAuthFailure(
      new Error(`error: The requested URL returned error: 401 while accessing https://corp.example.com/repo.git/info/refs`)
    );
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('bad-credentials');
  });
});

describe('classifyAuthFailure — forbidden (403)', () => {
  it('HTTP 403 → forbidden', () => {
    const info = classifyAuthFailure(
      new Error(`error: The requested URL returned error: 403 while accessing https://corp.example.com/repo.git/info/refs`)
    );
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('forbidden');
  });
});

describe('classifyAuthFailure — NOT our class (returns null)', () => {
  it('TLS certificate problems belong to sslErrors', () => {
    expect(
      classifyAuthFailure(
        new Error(`fatal: unable to access 'https://git.nbgi.cloud.rt-dc.ru/x.git/': SSL certificate problem: certificate has expired`)
      )
    ).toBeNull();
    expect(
      classifyAuthFailure(new Error('server verification failed: certificate signer not trusted'))
    ).toBeNull();
  });

  it('transport failures cannot be fixed by credentials', () => {
    expect(classifyAuthFailure(new Error('fatal: unable to access: Failed to connect'))).toBeNull();
    expect(classifyAuthFailure(new Error('Connection timed out'))).toBeNull();
    expect(classifyAuthFailure(new Error('SSL_ERROR_SYSCALL'))).toBeNull();
  });

  it('SSH publickey problems belong to the SSH integration', () => {
    expect(classifyAuthFailure(new Error('git@host: Permission denied (publickey).'))).toBeNull();
    expect(classifyAuthFailure(new Error('Host key verification failed.'))).toBeNull();
  });

  it('remote-side push rejections belong to pushFailures', () => {
    expect(classifyAuthFailure(new Error('remote: error: GH006: Protected branch update failed.'))).toBeNull();
    expect(classifyAuthFailure(new Error('remote rejected (protected branch hook declined)'))).toBeNull();
  });

  it('empty input → null', () => {
    expect(classifyAuthFailure(undefined)).toBeNull();
    expect(classifyAuthFailure(null)).toBeNull();
    expect(classifyAuthFailure('')).toBeNull();
  });
});

describe('classifyAuthFailure — ordering (most specific wins)', () => {
  it('"could not read Username" wins over the generic Authentication-failed marker', () => {
    // A server that answers 401 AND git refusing to prompt: the actionable
    // story is "nothing was sent" → ask + save, not "what you sent is wrong".
    const info = classifyAuthFailure(
      new Error(`Authentication failed: could not read Username for 'https://h/': terminal prompts disabled`)
    );
    expect(info!.kind).toBe('no-credentials');
  });
});

describe('AUTH_KIND_LABELS — diagnostics surface', () => {
  it('labels every kind (UI uses i18n, this is for logs/tests)', () => {
    const kinds: AuthFailureKind[] = ['no-credentials', 'bad-credentials', 'forbidden', 'other'];
    for (const k of kinds) {
      expect(AUTH_KIND_LABELS[k].length).toBeGreaterThan(5);
    }
  });
});
