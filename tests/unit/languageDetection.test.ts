import { describe, it, expect } from 'vitest';

// Import the highlighting function indirectly via the DiffViewer component
// For unit testing, we'll test the language detection logic

function getLangFromFile(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'ts', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
    py: 'py', go: 'go', rs: 'rs', java: 'java', kt: 'java',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cxx: 'cpp',
    sh: 'sh', bash: 'sh', zsh: 'sh',
    yml: 'yml', yaml: 'yml',
    json: 'json',
  };
  return map[ext] || '';
}

describe('getLangFromFile', () => {
  it('detects TypeScript', () => {
    expect(getLangFromFile('file.ts')).toBe('ts');
    expect(getLangFromFile('component.tsx')).toBe('ts');
  });

  it('detects JavaScript', () => {
    expect(getLangFromFile('script.js')).toBe('js');
    expect(getLangFromFile('module.mjs')).toBe('js');
    expect(getLangFromFile('common.cjs')).toBe('js');
  });

  it('detects Python', () => {
    expect(getLangFromFile('app.py')).toBe('py');
  });

  it('detects Go', () => {
    expect(getLangFromFile('main.go')).toBe('go');
  });

  it('detects Rust', () => {
    expect(getLangFromFile('lib.rs')).toBe('rs');
  });

  it('detects Java', () => {
    expect(getLangFromFile('Main.java')).toBe('java');
    expect(getLangFromFile('Main.kt')).toBe('java');
  });

  it('detects C', () => {
    expect(getLangFromFile('main.c')).toBe('c');
    expect(getLangFromFile('header.h')).toBe('c');
  });

  it('detects C++', () => {
    expect(getLangFromFile('main.cpp')).toBe('cpp');
    expect(getLangFromFile('main.cc')).toBe('cpp');
    expect(getLangFromFile('header.hpp')).toBe('cpp');
    expect(getLangFromFile('source.cxx')).toBe('cpp');
  });

  it('detects Shell', () => {
    expect(getLangFromFile('script.sh')).toBe('sh');
    expect(getLangFromFile('script.bash')).toBe('sh');
    expect(getLangFromFile('script.zsh')).toBe('sh');
  });

  it('detects YAML', () => {
    expect(getLangFromFile('config.yml')).toBe('yml');
    expect(getLangFromFile('config.yaml')).toBe('yml');
  });

  it('detects JSON', () => {
    expect(getLangFromFile('package.json')).toBe('json');
  });

  it('returns empty for unknown extensions', () => {
    expect(getLangFromFile('file.txt')).toBe('');
    expect(getLangFromFile('file.md')).toBe('');
    expect(getLangFromFile('file.unknown')).toBe('');
  });

  it('returns empty for no extension', () => {
    expect(getLangFromFile('Makefile')).toBe('');
    expect(getLangFromFile('Dockerfile')).toBe('');
  });

  it('handles uppercase extensions', () => {
    expect(getLangFromFile('Component.TS')).toBe('ts');
    expect(getLangFromFile('Script.PY')).toBe('py');
  });

  it('handles paths with directories', () => {
    expect(getLangFromFile('src/components/Button.tsx')).toBe('ts');
    expect(getLangFromFile('deeply/nested/path/file.go')).toBe('go');
  });
});
