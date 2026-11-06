/**
 * Clearly labelled SYNTHETIC pose sessions in apps/web/public/poses/, for tests and Judge Mode, until real
 * recordings exist. A real recording from /record with the same name replaces the file, with
 * `synthetic: false` in its header. Usage: pnpm poses:gen
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { POSE_LIBRARY, toPoseJsonl } from '../../packages/pose/src/index';

const out = resolve(import.meta.dirname, '../../apps/web/public/poses');
mkdirSync(out, { recursive: true });
for (const [name, make] of Object.entries(POSE_LIBRARY)) {
  const s = make();
  writeFileSync(resolve(out, `${name}.pose.jsonl`), toPoseJsonl(s.header, s.frames));
  console.log(`${name}: ${s.frames.length} frames`);
}
