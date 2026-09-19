import { diff3 } from '../src/lib/merge/diff3';
import { alignRows } from '../src/lib/merge/alignRows';

const baseLines = ['line1', 'line2', 'line3'];
const oursLines = ['line1', 'OURS_CHANGE', 'line3'];
const theirsLines = ['line1', 'THEIRS_CHANGE', 'line3'];

const regions = diff3(baseLines, oursLines, theirsLines);
console.log('Regions:', JSON.stringify(regions, null, 2));

const rows = alignRows(baseLines, oursLines, theirsLines, regions);
console.log('\nAligned rows:');
for (const row of rows) {
  const oursText = row.oursLine !== null ? oursLines[row.oursLine] : 'GHOST';
  const theirsText = row.theirsLine !== null ? theirsLines[row.theirsLine] : 'GHOST';
  console.log(
    `ours="${oursText}" ` +
    `theirs="${theirsText}" ` +
    `kind=${row.regionKind} ` +
    `ghost={ours:${row.isGhost.ours},theirs:${row.isGhost.theirs}}`
  );
}
