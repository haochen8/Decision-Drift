const test = require('node:test');
const assert = require('node:assert/strict');
const { createDrift, baselineKey, lineDiff, MAX_DIFF_LINES, MAX_DIFF_CHANGES } = require('../src/drift.cjs');
const { SpikeError, digest, PREVIEW_MS } = require('../src/spike.cjs');

const context = { accountId: 'reviewer-a', cloudId: 'cloud-a', extension: { issue: { id: '10001' } } };
const otherReviewer = { ...context, accountId: 'reviewer-b' };
const BASELINE_KEY = baselineKey({ cloudId: context.cloudId, issueId: context.extension.issue.id });
const rejectsCode = (promise, code) => assert.rejects(promise, error => error instanceof SpikeError && error.code === code);

function makeSource(text = 'Export links expire after seven days.', version = 1, id = '12345') {
  return {
    id, title: 'Restricted source title', version,
    url: `https://test.atlassian.net/wiki/pages/viewpage.action?pageId=${id}`,
    text, hash: digest({ text }), textHash: digest(text), hasUnrepresentedContent: false
  };
}

function fixture() {
  let clock = 100000;
  let sequence = 0;
  let writes = 0;
  const records = new Map();
  const baselines = new Map();
  const sources = new Map();
  const history = new Map();
  const historyCalls = [];
  const issue = {
    id: '10001', key: 'DD-1', summary: 'Build export links',
    updated: '2026-11-03T09:00:00Z', description: { text: 'Private issue acceptance criteria' }
  };
  function setSource(source) {
    sources.set(source.id, structuredClone(source));
    history.set(`${source.id}:${source.version}`, structuredClone(source));
  }
  setSource(makeSource());
  const gateway = {
    async readSite() { return 'https://test.atlassian.net'; },
    async readIssue(id) { return { ...structuredClone(issue), id }; },
    async readSource(id) {
      if (!sources.has(id)) throw new SpikeError('ACCESS_DENIED', 'Source denied');
      return structuredClone(sources.get(id));
    },
    async readSourceVersion(id, origin, version) {
      historyCalls.push({ id, origin, version });
      const source = history.get(`${id}:${version}`);
      if (!source) throw new SpikeError('ACCESS_DENIED', 'History denied');
      return structuredClone(source);
    }
  };
  const store = {
    async get(key) { return structuredClone(records.get(key)); },
    async put(key, value) { records.set(key, structuredClone(value)); }
  };
  const baselineStore = {
    async get(key) { return structuredClone(baselines.get(key)); },
    async compareAndSet(key, expectedRevision, value) {
      if ((baselines.get(key)?.revision ?? 0) !== expectedRevision) return false;
      baselines.set(key, structuredClone(value));
      writes += 1;
      return true;
    }
  };
  const reload = () => createDrift({
    gateway, store, baselineStore, now: () => clock,
    newId: () => `11111111-2222-4333-8444-${String(++sequence).padStart(12, '0')}`
  });
  return {
    service: reload(), reload, gateway, store, baselineStore, records, baselines, sources, history,
    historyCalls, issue, setSource, writes: () => writes, advance: milliseconds => { clock += milliseconds; }
  };
}

const prepare = (f, actor = context, pageInput = '12345') => f.service.prepareBaseline(actor, { pageInput });
const confirm = (f, preview, actor = context) => f.service.confirmBaseline(actor, { previewId: preview.previewId, approved: true });
async function capture(f) { return confirm(f, await prepare(f)); }

test('untracked state still requires a signed-in trusted issue and a fresh Jira permission read', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.loadTrackedSource(context), { tracked: false });
  await rejectsCode(f.service.loadTrackedSource({ ...context, accountId: null }), 'INVALID_CONTEXT');
  f.gateway.readIssue = async () => { throw new SpikeError('ACCESS_DENIED', 'Jira denied'); };
  await rejectsCode(f.service.loadTrackedSource(context), 'ACCESS_DENIED');
});

test('baseline creation is explicit, metadata-only, and survives service reload and a day passing', async () => {
  const f = fixture();
  const preview = await prepare(f);
  assert.equal(preview.tracking.status, 'unreviewed');
  assert.equal(f.baselines.size, 0);
  const result = await confirm(f, preview);
  assert.equal(result.tracking.status, 'unchanged');
  assert.equal(result.tracking.baseline.revision, 1);
  assert.equal(result.alreadyReviewed, false);
  assert.equal(f.writes(), 1);
  const persisted = JSON.stringify([...f.records.values(), ...f.baselines.values()]);
  for (const privateText of [f.issue.summary, f.issue.description.text, f.sources.get('12345').title, f.sources.get('12345').text]) {
    assert.ok(!persisted.includes(privateText));
  }
  f.advance(2 * 24 * 60 * 60 * 1000);
  f.records.clear();
  const loaded = await f.reload().loadTrackedSource(context);
  assert.equal(loaded.tracked, true);
  assert.equal(loaded.tracking.baseline.sourceVersion, 1);
  assert.equal(loaded.tracking.status, 'unchanged');
});

test('a baseline is shared with another permitted reviewer but isolated by cloud and issue', async () => {
  const f = fixture(); await capture(f);
  assert.equal((await f.service.loadTrackedSource(otherReviewer)).tracking.baseline.revision, 1);
  for (const actor of [
    { ...context, cloudId: 'cloud-b' },
    { ...context, extension: { issue: { id: '10002' } } }
  ]) assert.deepEqual(await f.service.loadTrackedSource(actor), { tracked: false });
});

test('approval and actor/issue/tenant-bound preview identity cannot be bypassed', async () => {
  const f = fixture(); const preview = await prepare(f);
  for (const approved of [undefined, false, 'true', 1]) {
    await rejectsCode(f.service.confirmBaseline(context, { previewId: preview.previewId, approved }), 'APPROVAL_REQUIRED');
  }
  for (const actor of [otherReviewer, { ...context, cloudId: 'other' }, { ...context, extension: { issue: { id: '20000' } } }]) {
    await rejectsCode(confirm(f, preview, actor), 'INVALID_PREVIEW');
  }
  await rejectsCode(f.service.confirmBaseline(context, { approved: true, previewId: '../bad' }), 'INVALID_PREVIEW');
  assert.equal(f.writes(), 0);
});

test('caller-provided issue IDs, baseline values, and source hashes are ignored', async () => {
  const f = fixture();
  const preview = await f.service.prepareBaseline(context, { pageInput: '12345', issueId: '999', sourceHash: 'injected' });
  await f.service.confirmBaseline(context, { previewId: preview.previewId, approved: true, revision: 99, sourceId: '999', sourceHash: 'injected' });
  const record = f.baselines.get(BASELINE_KEY);
  assert.equal(record.revision, 1);
  assert.equal(record.sourceId, '12345');
  assert.equal(record.sourceHash, f.sources.get('12345').hash);
});

test('expiry is checked before a new baseline write even when the preview remains stored', async () => {
  const f = fixture(); const preview = await prepare(f); f.advance(PREVIEW_MS);
  await rejectsCode(confirm(f, preview), 'EXPIRED_PREVIEW');
  assert.equal(f.writes(), 0);
});

test('source version, body, or Jira edits after preview invalidate confirmation', async () => {
  for (const mutate of [
    f => f.setSource(makeSource(undefined, 2)),
    f => f.setSource(makeSource('Changed without a version bump.')),
    f => { f.issue.summary = 'Changed summary'; },
    f => { f.issue.description = { text: 'Changed criteria' }; },
    f => { f.issue.updated = '2026-11-03T10:00:00Z'; }
  ]) {
    const f = fixture(); const preview = await prepare(f); mutate(f);
    await rejectsCode(confirm(f, preview), 'STALE_PREVIEW');
    assert.equal(f.writes(), 0);
  }
});

test('denied source access blocks inspection and confirmation without returning cached evidence', async () => {
  const f = fixture(); const preview = await prepare(f);
  f.gateway.readSource = async () => { throw new SpikeError('ACCESS_DENIED', 'Source denied'); };
  await rejectsCode(confirm(f, preview), 'ACCESS_DENIED');
  await rejectsCode(f.service.inspectDecisionSource(context, { pageInput: '12345' }), 'ACCESS_DENIED');
  assert.equal(f.writes(), 0);
});

test('confirmed replay checks fresh permissions and never advances revision twice', async () => {
  const f = fixture(); const preview = await prepare(f); await confirm(f, preview);
  f.advance(PREVIEW_MS);
  assert.equal((await confirm(f, preview)).alreadyReviewed, true);
  assert.equal(f.writes(), 1);
  f.gateway.readIssue = async () => { throw new SpikeError('ACCESS_DENIED', 'Jira denied'); };
  await rejectsCode(confirm(f, preview), 'ACCESS_DENIED');
});

test('two simultaneous confirmations of one preview produce one durable baseline write', async () => {
  const f = fixture(); const preview = await prepare(f);
  const results = await Promise.all([confirm(f, preview), confirm(f, preview)]);
  assert.equal(f.writes(), 1);
  assert.ok(results.some(result => result.alreadyReviewed));
  assert.equal(f.baselines.get(BASELINE_KEY).revision, 1);
});

test('identical snapshots prepared by two reviewers coalesce without overwriting attribution', async () => {
  const f = fixture(); const a = await prepare(f); const b = await prepare(f, otherReviewer);
  await confirm(f, a);
  const result = await confirm(f, b, otherReviewer);
  assert.equal(result.alreadyReviewed, true);
  assert.equal(f.writes(), 1);
  assert.equal(f.baselines.get(BASELINE_KEY).reviewerAccountId, context.accountId);
});

test('a delayed older reviewer cannot replace a newer reviewed source through a CAS race', async () => {
  const f = fixture(); await capture(f);
  f.setSource(makeSource('Links expire after three days.', 2));
  const olderPreview = await prepare(f);
  const original = f.baselineStore.compareAndSet;
  let release;
  let entered;
  const reached = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  f.baselineStore.compareAndSet = async (key, revision, value) => {
    if (value.sourceVersion === 2) { entered(); await waiting; }
    return original(key, revision, value);
  };
  const older = confirm(f, olderPreview);
  await reached;
  f.setSource(makeSource('Links expire after one day.', 3));
  const newer = await prepare(f, otherReviewer);
  await confirm(f, newer, otherReviewer);
  release();
  await rejectsCode(older, 'BASELINE_CONFLICT');
  const baseline = f.baselines.get(BASELINE_KEY);
  assert.equal(baseline.sourceVersion, 3);
  assert.equal(baseline.revision, 2);
  assert.equal(baseline.reviewerAccountId, otherReviewer.accountId);
});

test('a transaction timeout after commit is recovered using its durable review ID', async () => {
  const f = fixture(); const preview = await prepare(f);
  const original = f.baselineStore.compareAndSet;
  f.baselineStore.compareAndSet = async (...args) => { await original(...args); throw new Error('Response lost'); };
  assert.equal((await confirm(f, preview)).alreadyReviewed, true);
  assert.equal((await confirm(f, preview)).alreadyReviewed, true);
  assert.equal(f.writes(), 1);
});

test('storage failure before commit does not pretend the baseline was saved', async () => {
  const f = fixture(); const preview = await prepare(f);
  const error = new Error('Storage unavailable');
  f.baselineStore.compareAndSet = async () => { throw error; };
  await assert.rejects(confirm(f, preview), failure => failure === error);
  assert.equal(f.baselines.size, 0);
});

test('tracking distinguishes source, version-only, issue, both, and different-source changes', async () => {
  const f = fixture(); await capture(f);
  f.setSource(makeSource(undefined, 2));
  let result = await f.service.loadTrackedSource(context);
  assert.equal(result.tracking.status, 'version_changed');
  assert.equal(result.tracking.sourceChanged, false);
  f.setSource(makeSource('Links expire after one day.', 3));
  result = await f.service.loadTrackedSource(context);
  assert.equal(result.tracking.status, 'source_changed');
  assert.deepEqual(result.tracking.diff.added, ['Links expire after one day.']);
  assert.deepEqual(result.tracking.diff.removed, ['Export links expire after seven days.']);
  f.issue.description = { text: 'Changed work criteria' };
  assert.equal((await f.service.loadTrackedSource(context)).tracking.status, 'both_changed');
  f.setSource(makeSource());
  assert.equal((await f.service.loadTrackedSource(context)).tracking.status, 'issue_changed');
  f.setSource(makeSource('Another page.', 1, '99999'));
  result = await f.service.inspectDecisionSource(context, { pageInput: '99999' });
  assert.equal(result.tracking.status, 'different_source');
  assert.deepEqual(result.tracking.diff.added, []);
});

test('comment-only updated timestamps do not create issue drift', async () => {
  const f = fixture(); await capture(f);
  f.issue.updated = '2026-11-03T12:00:00Z';
  assert.equal((await f.service.loadTrackedSource(context)).tracking.status, 'unchanged');
});

test('a different page with identical text remains a different source without inventing a body change', async () => {
  const f = fixture(); await capture(f);
  f.setSource(makeSource(undefined, 1, '99999'));
  const result = await f.service.inspectDecisionSource(context, { pageInput: '99999' });
  assert.equal(result.tracking.status, 'different_source');
  assert.equal(result.tracking.sourceChanged, false);
  assert.equal(result.tracking.diff.status, 'not_needed');
});

test('a newer body hash with the same supported text stays a source change, not alignment', async () => {
  const f = fixture(); await capture(f);
  const source = makeSource(undefined, 2); source.hash = digest({ formatted: true, text: source.text });
  f.setSource(source);
  const result = await f.service.loadTrackedSource(context);
  assert.equal(result.tracking.status, 'source_changed');
  assert.deepEqual(result.tracking.diff, { status: 'available', added: [], removed: [], limited: false });
});

test('denied or unsupported history yields no old text; consent and unknown errors propagate', async () => {
  for (const code of ['ACCESS_DENIED', 'UNSUPPORTED_PAGE', 'UNPUBLISHED_PAGE']) {
    const f = fixture(); await capture(f); f.setSource(makeSource('New policy.', 2));
    f.gateway.readSourceVersion = async () => { throw new SpikeError(code, 'History unavailable'); };
    const result = await f.service.loadTrackedSource(context);
    assert.equal(result.tracking.status, 'source_changed');
    assert.deepEqual(result.tracking.diff, { status: 'unavailable', added: [], removed: [], limited: false });
  }
  for (const error of [new Error('NEEDS_AUTHENTICATION'), new SpikeError('RATE_LIMITED', 'Wait')]) {
    const f = fixture(); await capture(f); f.setSource(makeSource('New policy.', 2));
    f.gateway.readSourceVersion = async () => { throw error; };
    await assert.rejects(f.service.loadTrackedSource(context), failure => failure === error);
  }
});

test('historical page identity, exact version, both hashes, and extraction coverage are verified', async () => {
  for (const mutate of [
    source => { source.id = '999'; }, source => { source.version = 99; },
    source => { source.hash = digest('wrong'); }, source => { source.textHash = digest('wrong'); },
    source => { source.hasUnrepresentedContent = true; }
  ]) {
    const f = fixture(); await capture(f); f.setSource(makeSource('New policy.', 2));
    const old = f.history.get('12345:1'); mutate(old);
    const result = await f.service.loadTrackedSource(context);
    assert.equal(result.tracking.diff.status, 'unavailable');
    assert.deepEqual(result.tracking.diff.removed, []);
  }
});

test('current unsupported content cannot yield a misleading complete textual comparison', async () => {
  const f = fixture(); await capture(f);
  const source = makeSource('Current supported text.', 2); source.hasUnrepresentedContent = true;
  f.setSource(source);
  const result = await f.service.loadTrackedSource(context);
  assert.equal(result.tracking.diff.status, 'unavailable');
  assert.equal(result.tracking.diff.limited, true);
});

test('a change beyond the old 4000-character display boundary is included', async () => {
  const f = fixture();
  f.setSource(makeSource(`${'x'.repeat(4100)}\nOld clause.`)); await capture(f);
  f.setSource(makeSource(`${'x'.repeat(4100)}\nNew clause.`, 2));
  const result = await f.service.loadTrackedSource(context);
  assert.deepEqual(result.tracking.diff.added, ['New clause.']);
  assert.deepEqual(result.tracking.diff.removed, ['Old clause.']);
});

test('ordered line diff preserves duplicate counts and declares bounded output', () => {
  assert.deepEqual(lineDiff('A\nA\nB', 'A\nB'), { status: 'available', added: [], removed: ['A'], limited: false });
  assert.deepEqual(lineDiff('A\nB', 'A\nC\nB').added, ['C']);
  assert.equal(lineDiff(Array.from({ length: MAX_DIFF_LINES + 1 }, (_, i) => `Old ${i}`).join('\n'), 'New').status, 'unavailable');
  const diff = lineDiff('', Array.from({ length: MAX_DIFF_CHANGES + 1 }, (_, i) => `New ${i}`).join('\n'));
  assert.equal(diff.added.length, MAX_DIFF_CHANGES);
  assert.equal(diff.limited, true);
});

test('corrupt baseline metadata fails closed rather than reporting an unreviewed issue', async () => {
  const f = fixture(); await capture(f);
  f.baselines.get(BASELINE_KEY).sourceHash = 'invalid';
  await rejectsCode(f.service.loadTrackedSource(context), 'INVALID_BASELINE');
});
