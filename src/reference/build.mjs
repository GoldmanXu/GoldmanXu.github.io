import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const dependencies = process.env.REFERENCE_BUILD_DEPS ? path.resolve(process.env.REFERENCE_BUILD_DEPS) : here;
const require = createRequire(path.join(dependencies, 'package.json'));
const { build } = require('esbuild');
const destination = path.resolve(here, '../../docs');
const notices = path.join(destination, 'vendor/reference');
await fs.mkdir(notices, { recursive: true });

await build({
  entryPoints: [path.join(here, 'entry.ts')],
  outfile: path.join(destination, 'reference-scene.js'),
  nodePaths: [path.join(dependencies, 'node_modules')],
  bundle: true,
  loader: { '.png': 'dataurl' },
  format: 'iife',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  banner: {
    js: '/*! Jinyuan Xu particle hero. Adapted from Liangbing Zhao (MIT); includes Three.js (MIT) and rendered name artwork. Complete notices: vendor/reference/ATTRIBUTION.txt and accompanying license files. */',
  },
  logLevel: 'info',
});

for (const [source, filename] of [
  [path.join(here, 'LICENSE-original.txt'), 'LICENSE-original.txt'],
  [path.join(here, 'OFL-Space-Grotesk.txt'), 'OFL-Space-Grotesk.txt'],
  [path.join(dependencies, 'node_modules/three/LICENSE'), 'LICENSE-three.txt'],
  [path.join(here, 'ATTRIBUTION.txt'), 'ATTRIBUTION.txt'],
]) await fs.copyFile(source, path.join(notices, filename));
