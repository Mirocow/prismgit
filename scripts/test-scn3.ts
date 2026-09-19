import { diff3 } from '../src/lib/merge/diff3';
import { buildAutoMergeResult } from '../src/lib/merge/resolveConflicts';

const base = ['line1', 'line2'];
const ours = ['MAIN', 'line2'];
const theirs = ['line1', 'FEATURE'];

const regions = diff3(base, ours, theirs);
console.log('Regions:');
for (const r of regions) {
  const b = base.slice(r.baseStart, r.baseStart + r.baseLen);
  const o = ours.slice(r.oursStart, r.oursStart + r.oursLen);
  const t = theirs.slice(r.theirsStart, r.theirsStart + r.theirsLen);
  console.log(`  ${r.kind} base=${JSON.stringify(b)} ours=${JSON.stringify(o)} theirs=${JSON.stringify(t)}`);
}

const result = buildAutoMergeResult(base, ours, theirs, regions);
console.log('\nResult:');
for (let i = 0; i < result.length; i++) console.log(`  [${i}] "${result[i]}"`);
