// Test matchingBlocks in isolation
function matchingBlocks(a: string[], b: string[]): Array<[number, number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const blocks: Array<[number, number, number]> = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      const startI = i, startJ = j;
      while (i < n && j < m && a[i] === b[j]) { i++; j++; }
      blocks.push([startI, startJ, i - startI]);
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return blocks;
}

const base = ['line1', 'line2', 'line3'];
const ours = ['line1', 'MAIN-BRANCH-CHANGE', 'line3'];
const theirs = ['line1', 'FEATURE-CHANGE-HERE', 'line3'];

console.log('base vs ours:', matchingBlocks(base, ours));
console.log('base vs theirs:', matchingBlocks(base, theirs));
