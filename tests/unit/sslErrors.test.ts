/**
 * sslErrors — the TLS certificate classifier behind offerSslBypass().
 *
 * Pins the contract for every certificate failure the app can meet:
 *  - the REPORTED case verbatim: git pull to a corporate server with an
 *    expired certificate (host + URL must be extracted for the dialog);
 *  - the full curl/OpenSSL/Node error zoo (self-signed, unknown CA,
 *    not-yet-valid, hostname mismatch, revoked);
 *  - NON-certificates must classify as null (transport failures, auth
 *    errors, push rejections) — those keep their generic error paths,
 *    and a wrong positive would pop the bypass dialog for problems the
 *    bypass cannot fix.
 */
import { describe, it, expect } from 'vitest';
import { classifySslFailure, SSL_KIND_LABELS } from '../../src/lib/sslErrors';

const REPORTED = `fatal: unable to access 'https://git.nbgi.cloud.rt-dc.ru/project/sp/service_bus.git/': SSL certificate problem: certificate has expired`;

describe('classifySslFailure — the reported case (expired corporate cert)', () => {
  it('classifies as expired and extracts host + url from git stderr', () => {
    const info = classifySslFailure(new Error(REPORTED));
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('expired');
    expect(info!.host).toBe('git.nbgi.cloud.rt-dc.ru');
    expect(info!.url).toBe('https://git.nbgi.cloud.rt-dc.ru/project/sp/service_bus.git/');
    expect(info!.message).toContain('certificate has expired');
  });

  it('survives the Electron IPC wrapper prefix around the message', () => {
    // What the renderer actually receives: Error invoking remote method 'git:pull': Error: fatal: …
    const info = classifySslFailure(
      new Error(`Error invoking remote method 'git:pull': Error: ${REPORTED}`),
    );
    expect(info!.kind).toBe('expired');
    expect(info!.host).toBe('git.nbgi.cloud.rt-dc.ru');
  });

  it('accepts a plain string error payload', () => {
    const info = classifySslFailure(REPORTED);
    expect(info!.kind).toBe('expired');
  });
});

describe('classifySslFailure — git / curl message zoo', () => {
  it('self-signed certificate (curl + OpenSSL wordings)', () => {
    expect(classifySslFailure("fatal: unable to access 'https://git.internal/': SSL certificate problem: self-signed certificate")?.kind).toBe('self-signed');
    expect(classifySslFailure('SSL certificate problem: self signed certificate in certificate chain')?.kind).toBe('self-signed');
  });

  it('unknown / incomplete chain (curl + OpenSSL + GnuTLS + curl-8 wordings)', () => {
    expect(classifySslFailure('SSL certificate problem: unable to get local issuer certificate')?.kind).toBe('untrusted');
    expect(classifySslFailure('server certificate verification failed. CAfile: /etc/ssl/certs/ca-certificates.crt')?.kind).toBe('untrusted');
    expect(classifySslFailure('SSL routines::certificate verify failed')?.kind).toBe('untrusted');
    // git 2.47 + curl 8: "server verification failed: certificate signer not trusted"
    expect(
      classifySslFailure("fatal: unable to access 'https://127.0.0.1/repo.git/': server verification failed: certificate signer not trusted. (CAfile: /etc/ssl/certs/ca-certificates.crt CRLfile: none)")?.kind,
    ).toBe('untrusted');
  });

  it('not yet valid', () => {
    expect(classifySslFailure('SSL certificate problem: certificate is not yet valid')?.kind).toBe('not-yet-valid');
  });

  it('hostname mismatch (curl + OpenSSL wordings)', () => {
    expect(
      classifySslFailure("SSL: no alternative certificate subject name matches target host name 'git.example.com'")?.kind,
    ).toBe('hostname');
    expect(classifySslFailure("certificate is not valid for 'git.example.com'")?.kind).toBe('hostname');
  });

  it('revoked', () => {
    expect(classifySslFailure('SSL certificate problem: certificate has been revoked')?.kind).toBe('revoked');
  });

  it('generic certificate problem → kind other (still actionable)', () => {
    expect(classifySslFailure('SSL certificate problem: something exotic')?.kind).toBe('other');
  });
});

describe('classifySslFailure — Node https error codes (provider API path)', () => {
  it('Error object codes from the tls module', () => {
    const err = new Error('unable to verify the first certificate') as Error & { code?: string };
    err.code = 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';
    expect(classifySslFailure(err)?.kind).toBe('untrusted');
  });

  it('CERT_HAS_EXPIRED message form', () => {
    expect(classifySslFailure('certificate has expired')?.kind).toBe('expired');
  });

  it('DEPTH_ZERO_SELF_SIGNED_CERT code in the message', () => {
    expect(classifySslFailure('DEPTH_ZERO_SELF_SIGNED_CERT: self-signed certificate')?.kind).toBe('self-signed');
  });
});

describe('classifySslFailure — negatives (NOT certificate problems)', () => {
  it.each([
    ['fatal: not a git repository'],
    ['fatal: unable to access \'https://git.example.com/\': Failed to connect: Connection refused'],
    ['fatal: unable to access \'https://git.example.com/\': gnutls_handshake() failed: The TLS connection was non-properly terminated'],
    ['SSL_ERROR_SYSCALL: Connection reset by peer'],
    ['error: RPC failed; curl 56 OpenSSL SSL_read: Connection was reset'],
    ['remote: HTTP Basic: Access denied'],
    ['! [rejected] main -> main (fetch first)'],
    ['Everything up-to-date'],
    [''],
  ])('%s → null', (msg) => {
    expect(classifySslFailure(new Error(msg))).toBeNull();
  });

  it('null/undefined payloads → null', () => {
    expect(classifySslFailure(null)).toBeNull();
    expect(classifySslFailure(undefined)).toBeNull();
  });
});

describe('classifySslFailure — host extraction edge cases', () => {
  it('http (non-TLS) URLs in messages are still extracted (proxy cases)', () => {
    const info = classifySslFailure(
      "fatal: unable to access 'http://proxy.local/git/repo.git/': SSL certificate problem: self-signed certificate",
    );
    expect(info!.host).toBe('proxy.local');
  });

  it('no URL in the message → host undefined, kind still set', () => {
    const info = classifySslFailure('certificate verify failed');
    expect(info!.host).toBeUndefined();
    expect(info!.url).toBeUndefined();
    expect(info!.kind).toBe('untrusted');
  });

  it('message is capped at 1600 chars', () => {
    const long = 'SSL certificate problem: certificate has expired ' + 'x'.repeat(5000);
    expect(classifySslFailure(long)!.message.length).toBeLessThanOrEqual(1600);
  });
});

describe('SSL_KIND_LABELS — every kind has a label', () => {
  it('covers all kinds', () => {
    const kinds = ['expired', 'not-yet-valid', 'self-signed', 'untrusted', 'hostname', 'revoked', 'other'] as const;
    for (const k of kinds) expect(SSL_KIND_LABELS[k].length).toBeGreaterThan(0);
  });
});
