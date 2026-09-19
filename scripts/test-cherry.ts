import { diff3 } from '../src/lib/merge/diff3';
import { buildAutoMergeResult } from '../src/lib/merge/resolveConflicts';

// Cherry-pick scenario: base may have different content
// From screenshot: ours=MAIN+line2, theirs=line1+FEATURE
// base might be: line1+line2 (if cherry-pick from a branch that had line1+line2)

// Scenario 1: classic conflict
{
  const base = ['line1', 'line2'];
  const ours = ['MAIN', 'line2'];
  const theirs = ['line1', 'FEATURE'];
  const regions = diff3(base, ours, theirs);
  console.log('Scenario 1 (classic conflict):');
  for (const r of regions) console.log(`  ${r.kind} base[${r.baseStart}..${r.baseStart + r.baseLen}]`);
  const result = buildAutoMergeResult(base, ours, theirs, regions);
  console.log('  Result:', result);
  console.log('  Has markers:', result.some(l => l.startsWith('<<<<<<<')));
}

// Scenario 2: base empty (no common ancestor)
{
  const base: string[] = [];
  const ours = ['MAIN', 'line2'];
  const theirs = ['line1', 'FEATURE'];
  const regions = diff3(base, ours, theirs);
  console.log('\nScenario 2 (empty base):');
  for (const r of regions) console.log(`  ${r.kind} base[${r.baseStart}..${r.baseStart + r.baseLen}]`);
  const result = buildAutoMergeResult(base, ours, theirs, regions);
  console.log('  Result:', result);
  console.log('  Has markers:', result.some(l => l.startsWith('<<<<<<<')));
}

// Scenario 3: from screenshot — base=line1+line2, ours=MAIN+line2, theirs=line1+FEATURE
{
  const base = ['line1', 'line2'];
  const ours = ['MAIN', 'line2'];
  const theirs = ['line1', 'FEATURE'];
  const regions = diff3(base, ours, theirs);
  console.log('\nScenario 3 (both sides changed different lines):');
  for (const r of regions) console.log(`  ${r.kind} base[${r.baseStart}..${r.baseStart + r.baseLen}] ours[${r.oursStart}..${r.oursStart + r.oursLen}] theirs[${r.theirsStart}..${r.theirsStart + r.theirsLen}]`);
  const result = buildAutoMergeResult(base, ours, theirs, regions);
  console.log('  Result:', result);
  console.log('  Has markers:', result.some(l => l.startsWith('<<<<<<<')));
}
