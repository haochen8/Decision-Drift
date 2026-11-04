const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, readdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const { validateFixture, buildDemoPlan, simulateDemo } = require('../src/demo-kit.cjs');

const fixture = JSON.parse(readFileSync(join(__dirname, '../fixtures/judge-demo.json'), 'utf8'));
const script = join(__dirname, '../scripts/demo-kit.mjs');
const edited = value => value.cases.find(entry => entry.role === 'edited');
const context = value => value.cases.find(entry => entry.role === 'context');
const invalid = fn => assert.throws(fn, error => error.code === 'INVALID_FIXTURE');

test('the portable fixture has four real scenarios and validation preserves its authored data', () => {
  const validated = validateFixture(fixture);
  assert.deepEqual(validated, fixture);
  assert.notEqual(validated, fixture);
  const original = JSON.stringify(fixture);
  buildDemoPlan(fixture);
  assert.equal(JSON.stringify(fixture), original);
  assert.deepEqual(fixture.cases.map(entry => entry.role), ['matching', 'context', 'edited', 'unlinked']);
  assert.match(fixture.source.initialParagraphs[0], /project admins only/);
  assert.match(fixture.source.currentParagraphs[0], /project members only/);
  assert.match(edited(fixture).repair.requirementQuote, /project members only/);
});

test('the real review and queue services derive four states and only the repaired row becomes matching', async () => {
  const result = await simulateDemo(fixture);
  assert.deepEqual(result.before.map(row => row.status), ['matches_review', 'context_changed', 'needs_review', 'not_linked']);
  assert.deepEqual(result.before.map(row => row.reviewedVersion), [2, 1, 1, null]);
  assert.deepEqual(result.before.map(row => row.currentVersion), [2, 2, 2, null]);
  assert.deepEqual(result.after.map(row => row.status), ['matches_review', 'context_changed', 'matches_review', 'not_linked']);
  assert.deepEqual(result.changedRows, ['edited']);
  assert.equal(result.after[2].reviewedVersion, 2);
  assert.equal(result.before[2].reasonCode, 'LINKED_TEXT_CHANGED');
  assert.equal(result.mode, 'offline-real-services-simulated-adapters');
  assert.equal(result.liveCloudVerified, false);
});

test('the offline result is deterministic with durable reloads, metadata-only records and zero queue/Jira writes', async () => {
  const first = await simulateDemo(fixture);
  assert.deepEqual(await simulateDemo(fixture), first);
  assert.equal(first.setupBaselineWrites, 3);
  assert.equal(first.repairBaselineWrites, 1);
  assert.equal(first.manualIssueEdits, 1);
  assert.equal(first.queueWrites, 0);
  assert.equal(first.jiraWrites, 0);
  assert.equal(first.durableReloadVerified, true);
  assert.equal(first.persistentRecordsContainNoQuotes, true);
  assert.equal(first.storedRecordsVerified, 8, 'all four preview and four baseline writes were checked, including superseded records');
  assert.ok(!JSON.stringify(first).includes('offline-demo-reviewer'));
});

test('valid authoring that does not produce the asserted state fails real execution instead of faking a status', async () => {
  const changed = structuredClone(fixture);
  context(changed).review.sourceQuote = changed.source.initialParagraphs[0];
  validateFixture(changed);
  await assert.rejects(simulateDemo(changed), error => error.code === 'DEMO_VERIFICATION_FAILED' && /context/.test(error.message));
  const retainedOldClause = structuredClone(fixture);
  retainedOldClause.source.currentParagraphs.push(retainedOldClause.source.initialParagraphs[0]);
  validateFixture(retainedOldClause);
  await assert.rejects(simulateDemo(retainedOldClause), error => error.code === 'DEMO_VERIFICATION_FAILED' && /edited/.test(error.message));
});

test('unsupported fields cannot smuggle site, account, source bindings or executable setup into portable input', () => {
  for (const mutate of [
    value => { value.siteUrl = 'https://private.example'; },
    value => { value.credentials = { token: 'secret' }; },
    value => { value.source.pageId = '20001'; },
    value => { value.cases[0].issueId = '10001'; },
    value => { value.cases[0].review.accountId = 'private'; },
    value => { edited(value).repair.command = 'anything'; }
  ]) { const changed = structuredClone(fixture); mutate(changed); invalid(() => validateFixture(changed)); }
});

test('schema, duplicate/missing roles, review phases and expected status assertions are bounded and explicit', () => {
  for (const mutate of [
    value => { value.schemaVersion = 2; }, value => { value.demoId = '../unsafe'; },
    value => { value.cases.pop(); }, value => { value.cases[1].role = 'matching'; },
    value => { value.cases[0].role = '__proto__'; }, value => { context(value).review.phase = 'current'; },
    value => { value.cases[0].expectedQueueStatus = 'needs_review'; },
    value => { value.cases[3].review = structuredClone(value.cases[0].review); },
    value => { delete edited(value).repair; }
  ]) { const changed = structuredClone(fixture); mutate(changed); invalid(() => validateFixture(changed)); }
});

test('empty/oversized templates and invalid or nonunique quotes fail before simulation', () => {
  for (const mutate of [
    value => { value.source.initialParagraphs = []; }, value => { value.source.title = ''; },
    value => { value.source.currentParagraphs = structuredClone(value.source.initialParagraphs); },
    value => { value.source.initialParagraphs = ['x'.repeat(16001)]; },
    value => { value.cases[0].descriptionParagraphs = ['x'.repeat(8000), 'y'.repeat(8000)]; },
    value => { value.cases[0].summary = 'x'.repeat(256); },
    value => { context(value).review.sourceQuote = 'short'; },
    value => { context(value).review.sourceQuote = ` ${context(value).review.sourceQuote}`; },
    value => { context(value).review.sourceQuote = 'x'.repeat(1001); },
    value => { context(value).review.requirementQuote = 'A missing requirement.'; },
    value => { value.source.initialParagraphs.push(context(value).review.sourceQuote); },
    value => { context(value).descriptionParagraphs.push(context(value).review.requirementQuote); },
    value => { edited(value).repair.descriptionParagraphs = structuredClone(edited(value).descriptionParagraphs); }
  ]) { const changed = structuredClone(fixture); mutate(changed); invalid(() => validateFixture(changed)); }
});

test('the copyable plan contains exact text, human repair order and reset-forward/unlinked safeguards', () => {
  const plan = buildDemoPlan(fixture);
  assert.equal(plan.source.initialText, fixture.source.initialParagraphs.join('\n\n'));
  assert.equal(plan.source.currentText, fixture.source.currentParagraphs.join('\n\n'));
  assert.equal(plan.issues.find(entry => entry.role === 'edited').humanRepair.descriptionText, edited(fixture).repair.descriptionParagraphs.join('\n\n'));
  assert.match(plan.setup.join(' '), /human edits.*then rechecks/);
  assert.match(plan.reset.join(' '), /Never rewind/);
  assert.match(plan.reset.join(' '), /create a fresh issue/);
  assert.match(plan.notice, /not live cloud evidence/);
  assert.equal(plan.demo.at(-1).seconds, '2:20–2:40');
  assert.ok(!JSON.stringify(plan).includes('https://'));
});

test('the CLI prints portable JSON or a short verification summary from any working directory without creating files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'decision-drift-demo-'));
  try {
    const output = execFileSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });
    const result = JSON.parse(output);
    assert.equal(result.plan.demoId, fixture.demoId);
    assert.equal(result.offlineVerification.liveCloudVerified, false);
    const summary = execFileSync(process.execPath, [script, '--verify'], { cwd: directory, encoding: 'utf8' });
    assert.match(summary, /Offline demo verified/);
    assert.match(summary, /queue writes 0/);
    assert.deepEqual(readdirSync(directory), []);
    const invalidOption = spawnSync(process.execPath, [script, '--deploy'], { cwd: directory, encoding: 'utf8' });
    assert.equal(invalidOption.status, 1);
    assert.match(invalidOption.stderr, /Usage:/);
    assert.equal(invalidOption.stdout, '');
  } finally { rmSync(directory, { recursive: true }); }
});
