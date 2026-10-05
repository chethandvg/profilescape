import { build } from 'esbuild';

/**
 * Bundles the Action and CLI into single dependency-free files. dist/ is
 * committed because GitHub runs the Action straight from the repository.
 */
const common = {
  bundle: true,
  platform: 'node' as const,
  target: 'node22',
  format: 'esm' as const,
  legalComments: 'none' as const,
  logLevel: 'info' as const,
};

await build({ ...common, entryPoints: ['src/action/main.ts'], outfile: 'dist/index.mjs' });
await build({
  ...common,
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/cli.mjs',
  banner: { js: '#!/usr/bin/env node' },
});
