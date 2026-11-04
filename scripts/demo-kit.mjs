import { readFileSync } from 'node:fs';
import demoKit from '../src/demo-kit.cjs';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--verify')) {
  console.error('Usage: npm run demo-kit -- [--verify]');
  process.exitCode = 1;
} else {
  try {
    const fixture = JSON.parse(readFileSync(new URL('../fixtures/judge-demo.json', import.meta.url), 'utf8'));
    const verification = await demoKit.simulateDemo(fixture);
    if (args[0] === '--verify') {
      console.log(`Offline demo verified: ${verification.before.map(row => row.status).join(', ')}; repaired edited → matches_review; queue writes ${verification.queueWrites}. Live cloud results are separate.`);
    } else {
      console.log(JSON.stringify({ plan: demoKit.buildDemoPlan(fixture), offlineVerification: verification }, null, 2));
    }
  } catch (error) {
    console.error(`${error.code ?? 'DEMO_KIT_FAILED'}: ${error.message}`);
    process.exitCode = 1;
  }
}
