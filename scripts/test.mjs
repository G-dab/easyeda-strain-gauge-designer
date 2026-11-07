import { spawnSync } from 'node:child_process';
import process from 'node:process';

import { build } from 'esbuild';

await build({ entryPoints: ['tests/design.test.ts'], outfile: '.cache/tests.cjs', bundle: true, platform: 'node', format: 'cjs' });

const result = spawnSync(process.execPath, ['--test', '.cache/tests.cjs'], { stdio: 'inherit' });

process.exit(result.status ?? 1);
