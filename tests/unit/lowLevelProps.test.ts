import { describe, it, expect } from 'vitest';
import {
  parseLowLevelProperties,
  serializeLowLevelProperties,
  getLowLevelNumber,
  getLowLevelString,
  getLowLevelBool,
  LOW_LEVEL_PROPS,
} from '../../src/lib/lowLevelProps';

describe('parseLowLevelProperties', () => {
  it('parses key=value lines and skips comments/blank lines', () => {
    const raw = [
      '# a comment',
      '',
      'renames.warnMs = 5000',
      'avatar.size=32',
      '// slash comment',
      'novalue', // no '=' → skipped
    ].join('\n');
    expect(parseLowLevelProperties(raw)).toEqual({
      'renames.warnMs': '5000',
      'avatar.size': '32',
    });
  });

  it('returns {} for undefined/empty input', () => {
    expect(parseLowLevelProperties(undefined)).toEqual({});
    expect(parseLowLevelProperties('')).toEqual({});
    expect(parseLowLevelProperties(null as unknown as string)).toEqual({});
  });

  it('keeps values containing "=" intact (only first = splits)', () => {
    expect(parseLowLevelProperties('custom.k=a=b=c')).toEqual({ 'custom.k': 'a=b=c' });
  });
});

describe('serializeLowLevelProperties', () => {
  it('round-trips through parse', () => {
    const map = { 'renames.warnMs': 5000, 'avatar.size': '32' };
    const parsed = parseLowLevelProperties(serializeLowLevelProperties(map));
    expect(parsed['renames.warnMs']).toBe('5000');
    expect(parsed['avatar.size']).toBe('32');
  });
});

describe('getLowLevelNumber', () => {
  it('reads the value from the legacy textarea string', () => {
    const s = { lowLevelProperties: 'renames.warnMs=5000\n' };
    expect(getLowLevelNumber(s, 'renames.warnMs')).toBe(5000);
  });

  it('falls back to the registry default when unset or invalid', () => {
    expect(getLowLevelNumber({}, 'renames.warnMs')).toBe(3000);
    expect(getLowLevelNumber(undefined, 'renames.warnMs')).toBe(3000);
    expect(getLowLevelNumber({ lowLevelProperties: 'renames.warnMs=abc' }, 'renames.warnMs')).toBe(3000);
  });

  it('returns 0 for unknown keys without a default', () => {
    expect(getLowLevelNumber({}, 'no.such.key')).toBe(0);
  });
});

describe('getLowLevelString / getLowLevelBool', () => {
  it('bool keys with valid values parse; unknown keys are ignored (fallback)', () => {
    // Registry has no boolean keys yet — unknown keys never resolve.
    expect(getLowLevelBool({ lowLevelProperties: 'future.flag=true' }, 'future.flag')).toBe(false);
    expect(getLowLevelBool({}, 'future.flag')).toBe(false);
  });

  it('unknown string key falls back to empty string', () => {
    expect(getLowLevelString({}, 'no.such.key')).toBe('');
    expect(getLowLevelString({ lowLevelProperties: 'custom.k=hello' }, 'custom.k')).toBe('hello');
  });
});

describe('registry sanity', () => {
  it('every registered prop has a unique key and a default', () => {
    const keys = LOW_LEVEL_PROPS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of LOW_LEVEL_PROPS) {
      expect(p.default).toBeDefined();
      expect(p.description.length).toBeGreaterThan(10);
    }
  });

  it('renames.warnMs default matches the phase-2.2 requirement (3000ms)', () => {
    const meta = LOW_LEVEL_PROPS.find((p) => p.key === 'renames.warnMs');
    expect(meta?.default).toBe(3000);
  });
});
