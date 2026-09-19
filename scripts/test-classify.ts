// Simulate classifyResultLines exactly as in MergeResultEditor.tsx
type ResultLineKind = 'context' | 'marker-start' | 'ours' | 'marker-sep' | 'theirs' | 'marker-end';

const KIND_BG: Record<ResultLineKind, string> = {
  'context':      'transparent',
  'marker-start': 'rgba(220, 38, 38, 0.35)',
  'marker-sep':   'rgba(220, 38, 38, 0.35)',
  'marker-end':   'rgba(220, 38, 38, 0.35)',
  'ours':         'rgba(34, 197, 94, 0.35)',
  'theirs':       'rgba(59, 130, 246, 0.35)',
};

function classifyResultLines(lines: string[]) {
  const out: { kind: ResultLineKind; bgClass: string }[] = new Array(lines.length);
  let state: 'outside' | 'ours' | 'theirs' = 'outside';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('<<<<<<<')) {
      out[i] = { kind: 'marker-start', bgClass: KIND_BG['marker-start'] };
      state = 'ours';
    } else if (line.startsWith('=======') && state === 'ours') {
      out[i] = { kind: 'marker-sep', bgClass: KIND_BG['marker-sep'] };
      state = 'theirs';
    } else if (line.startsWith('>>>>>>>') && state === 'theirs') {
      out[i] = { kind: 'marker-end', bgClass: KIND_BG['marker-end'] };
      state = 'outside';
    } else if (state === 'ours') {
      out[i] = { kind: 'ours', bgClass: KIND_BG['ours'] };
    } else if (state === 'theirs') {
      out[i] = { kind: 'theirs', bgClass: KIND_BG['theirs'] };
    } else {
      out[i] = { kind: 'context', bgClass: '' };
    }
  }
  return out;
}

// Test with actual conflict markers
const result = [
  'line1',
  '<<<<<<< ours',
  'OURS_CHANGE',
  '=======',
  'THEIRS_CHANGE',
  '>>>>>>> theirs',
  'line3',
];

const classified = classifyResultLines(result);
console.log('Classification result:');
let hasGreen = false;
let hasBlue = false;
for (let i = 0; i < result.length; i++) {
  const c = classified[i];
  const isGreen = c.bgClass.includes('34, 197, 94');
  const isBlue = c.bgClass.includes('59, 130, 246');
  if (isGreen) hasGreen = true;
  if (isBlue) hasBlue = true;
  console.log(`  [${i}] kind=${c.kind.padEnd(12)} bg="${c.bgClass}" ${isGreen ? '🟢' : isBlue ? '🔵' : ''} text="${result[i]}"`);
}
console.log(`\nHas GREEN: ${hasGreen}`);
console.log(`Has BLUE: ${hasBlue}`);
