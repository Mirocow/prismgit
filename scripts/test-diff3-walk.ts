import { diff3 } from '../src/lib/merge/diff3';

const base = ['line1', 'line2', 'line3'];
const ours = ['line1', 'MAIN-BRANCH-CHANGE', 'line3'];
const theirs = ['line1', 'FEATURE-CHANGE-HERE', 'line3'];

const regions = diff3(base, ours, theirs);
console.log('Regions:');
for (const r of regions) {
  const baseSlice = base.slice(r.baseStart, r.baseStart + r.baseLen);
  const oursSlice = ours.slice(r.oursStart, r.oursStart + r.oursLen);
  const theirsSlice = theirs.slice(r.theirsStart, r.theirsStart + r.theirsLen);
  console.log(`  kind=${r.kind}`);
  console.log(`    base[${r.baseStart}..${r.baseStart + r.baseLen}] = ${JSON.stringify(baseSlice)}`);
  console.log(`    ours[${r.oursStart}..${r.oursStart + r.oursLen}] = ${JSON.stringify(oursSlice)}`);
  console.log(`    theirs[${r.theirsStart}..${r.theirsStart + r.theirsLen}] = ${JSON.stringify(theirsSlice)}`);
}

// Check: line1 (index 0) should be 'stable' (both sides agree)
// Check: line2 (index 1) should be 'conflict' (both sides changed)
// Check: line3 (index 2) should be 'stable'
