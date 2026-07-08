#!/usr/bin/env tsx
import * as fs from 'node:fs';
import * as readline from 'node:readline';

const file = process.argv[2] ?? process.env.PXPIPE_EVENTS;
const limit = Number(process.argv[3] ?? 20);
if (!file) {
  console.error('usage: tsx scripts/report-dropped-codepoints.ts <events.jsonl> [limit]');
  process.exit(2);
}

const counts = new Map<string, number>();
let parsed = 0;
let withDrops = 0;
const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  try {
    const ev = JSON.parse(line) as { dropped_codepoints_top?: Record<string, number> };
    parsed++;
    if (!ev.dropped_codepoints_top) continue;
    withDrops++;
    for (const [cp, n] of Object.entries(ev.dropped_codepoints_top)) {
      if (typeof n === 'number' && n > 0) counts.set(cp, (counts.get(cp) ?? 0) + n);
    }
  } catch { /* ignore malformed lines like stats does */ }
}

console.log('━━━ pxpipe dropped-codepoint atlas report ━━━');
console.log(`source: ${file}`);
console.log(`events parsed: ${parsed}`);
console.log(`events with drops: ${withDrops}`);
console.log('');
if (counts.size === 0) {
  console.log('No dropped codepoints observed.');
} else {
  console.log('Suggested atlas additions (highest frequency first):');
  for (const [cp, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)) {
    const code = Number.parseInt(cp.replace(/^U\+/, ''), 16);
    const chr = Number.isFinite(code) ? String.fromCodePoint(code) : '?';
    console.log(`${String(n).padStart(6)}  ${cp.padEnd(8)}  ${chr}`);
  }
  console.log('');
  console.log('Regenerate after updating scripts/gen-atlas.ts profiles: pnpm run build:atlas && pnpm test -- tests/render.test.ts');
}
