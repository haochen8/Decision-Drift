import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import YAML from 'yaml';

const manifest = YAML.parse(readFileSync('manifest.yml', 'utf8'));
if (manifest.app.runtime.name !== 'nodejs22.x') throw new Error('Unexpected runtime');
if (manifest.app.compatibility.jira.required !== true || manifest.app.compatibility.confluence.required !== false) {
  throw new Error('Expected same-site Jira + optional Confluence compatibility');
}
for (const scope of ['read:jira-work', 'write:jira-work', 'read:page:confluence', 'storage:app']) {
  if (!manifest.permissions.scopes.includes(scope)) throw new Error(`Missing scope: ${scope}`);
}
await build({ entryPoints: ['src/index.js'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, logLevel: 'warning' });
const queueModule = manifest.modules['jira:projectPage']?.find(module => module.key === 'decision-drift-review-queue');
if (queueModule?.resource !== 'review-queue' || queueModule.render !== 'native' ||
    manifest.resources.find(resource => resource.key === 'review-queue')?.path !== 'src/queue-frontend.jsx') {
  throw new Error('Expected a separate native project review queue resource');
}
await build({ entryPoints: ['src/frontend.jsx', 'src/queue-frontend.jsx'], bundle: true, platform: 'browser', format: 'esm', packages: 'external', write: false, outdir: '.cache/check', logLevel: 'warning' });
console.log('Manifest structure and backend/frontend compilation passed.');
if (manifest.app.id.includes('00000000-0000-0000-0000-000000000000')) {
  console.log('Cloud registration pending: run npm run forge -- register after local login.');
}
