const test = require('node:test');
const assert = require('node:assert/strict');
const { createQueue, MAX_SELECTED_ISSUES, CONCURRENCY } = require('../src/queue.cjs');
const { createDrift, createAuthorizedTracker, baselineKey, issueContentHash } = require('../src/drift.cjs');
const { prepareFocus } = require('../src/passage.cjs');
const { SpikeError, digest } = require('../src/spike.cjs');

const context = {
  accountId: 'reviewer-a', cloudId: 'cloud-a',
  extension: { type: 'jira:projectPage', project: { id: '10000', key: 'DD' } }
};
const sourceQuote = 'Export links expire after seven days.';
const requirementQuote = 'Expire every exported download link.';
const date = '2026-11-04T09:00:00.000Z';
const description = text => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const clone = value => structuredClone(value);
const rejectsCode = (promise, code) => assert.rejects(promise, error => error instanceof SpikeError && error.code === code);

function makeSource(id, text = `${sourceQuote}\nRollout starts in November.`, version = 1) {
  return {
    id, version, text, title: `Restricted source title ${id}`, hash: digest({ text }), textHash: digest(text),
    hasUnrepresentedContent: false, url: `https://test.atlassian.net/wiki/pages/${id}`
  };
}

function fixture() {
  const issues = new Map();
  const sources = new Map();
  const history = new Map();
  const baselines = new Map();
  const calls = [];
  let writes = 0;
  for (let i = 1; i <= MAX_SELECTED_ISSUES; i += 1) {
    issues.set(`DD-${i}`, {
      id: String(10000 + i), key: `DD-${i}`, summary: `Authorized issue ${i}`, updated: date,
      description: description(requirementQuote), project: { id: '10000', key: 'DD' }
    });
  }
  const sourceId = key => String(20000 + Number(key.split('-')[1]));
  const actorFor = (key, cloudId = context.cloudId) => ({ accountId: context.accountId, cloudId, issueId: issues.get(key).id });
  function setSource(source) {
    sources.set(source.id, clone(source));
    history.set(`${source.id}:${source.version}`, clone(source));
  }
  function link(key, focused = false) {
    const issue = issues.get(key);
    const source = makeSource(sourceId(key)); setSource(source);
    const focus = focused ? prepareFocus(source, requirementQuote, sourceQuote, requirementQuote).focus : undefined;
    baselines.set(baselineKey(actorFor(key)), {
      revision: 1, sourceId: source.id, sourceVersion: source.version, sourceHash: source.hash, textHash: source.textHash,
      issueHash: issueContentHash(issue), reviewedAt: date, reviewerAccountId: context.accountId,
      reviewId: `11111111-2222-4333-8444-${String(Number(key.split('-')[1])).padStart(12, '0')}`,
      ...(focus ? { focus } : {})
    });
  }
  const gateway = {
    async readProject(id) { calls.push({ type: 'project', id }); return { id: '10000', key: 'DD' }; },
    async readSite() { calls.push({ type: 'site' }); return 'https://test.atlassian.net'; },
    async readIssueByKey(key) {
      calls.push({ type: 'issue', key });
      if (!issues.has(key)) throw new SpikeError('ACCESS_DENIED', 'Private issue error detail');
      return clone(issues.get(key));
    },
    async readIssue() { throw new Error('Queue must reuse its freshly authorized issue read'); },
    async readSource(id, origin) {
      calls.push({ type: 'source', id, origin });
      if (!sources.has(id)) throw new SpikeError('ACCESS_DENIED', 'Private source error detail');
      return clone(sources.get(id));
    },
    async readSourceVersion(id, origin, version) {
      calls.push({ type: 'history', id, origin, version });
      if (!history.has(`${id}:${version}`)) throw new SpikeError('ACCESS_DENIED', 'Private history error detail');
      return clone(history.get(`${id}:${version}`));
    },
    async postComment() { writes += 1; throw new Error('Queue attempted a Jira write'); }
  };
  const baselineStore = {
    async get(key) { calls.push({ type: 'baseline', key }); return clone(baselines.get(key)); },
    async compareAndSet() { writes += 1; throw new Error('Queue attempted a baseline write'); }
  };
  const store = {
    async put() { writes += 1; throw new Error('Queue attempted a preview write'); },
    async claim() { writes += 1; throw new Error('Queue attempted a write claim'); }
  };
  const checkAuthorizedIssue = createAuthorizedTracker({ gateway, baselineStore });
  const queue = createQueue({ gateway, checkAuthorizedIssue, now: () => new Date(date).getTime() });
  return { queue, gateway, baselineStore, store, issues, sources, history, baselines, calls, link, setSource, sourceId, actorFor, writes: () => writes };
}
const check = (f, keys = ['DD-1'], actor = context, extras = {}) => f.queue.checkSelectedIssues(actor, { issueKeys: keys, ...extras });
const oneRow = async f => (await check(f)).rows[0];

test('queue rejects invalid trusted context and selections before any product or storage call', async () => {
  for (const invalid of [
    {}, { ...context, accountId: null }, { ...context, cloudId: '' },
    { ...context, extension: { ...context.extension, type: 'jira:issuePanel' } },
    { ...context, extension: { ...context.extension, project: { id: '0', key: 'DD' } } },
    { ...context, extension: { ...context.extension, project: { id: '10000', key: 'dd' } } },
    { ...context, extension: { ...context.extension, project: { id: '../10000', key: 'DD' } } }
  ]) {
    const f = fixture(); await rejectsCode(check(f, ['DD-1'], invalid), 'INVALID_CONTEXT');
    assert.deepEqual(f.calls, []);
  }
  for (const keys of [undefined, null, [], 'DD-1', ['DD-0'], ['DD-1?x=y'], ['../DD-1'], [123],
    ['DD-1', ' dd-1 '], Array.from({ length: MAX_SELECTED_ISSUES + 1 }, (_, i) => `DD-${i + 1}`)]) {
    const f = fixture(); await rejectsCode(f.queue.checkSelectedIssues(context, { issueKeys: keys }), 'INVALID_SELECTION');
    assert.deepEqual(f.calls, []);
  }
  const f = fixture(); await rejectsCode(check(f, ['OTHER-1']), 'WRONG_PROJECT');
  assert.deepEqual(f.calls, []);
});

test('queue normalizes keys, preserves requested order and ignores caller project/issue identifiers', async () => {
  const f = fixture(); f.link('DD-1');
  const result = await check(f, [' dd-3 ', 'dd-1'], context, { projectId: '999', issueId: '999', siteUrl: 'https://evil.example' });
  assert.deepEqual(result.project, { key: 'DD' });
  assert.deepEqual(result.rows.map(row => row.inputKey), ['DD-3', 'DD-1']);
  assert.deepEqual(result.rows.map(row => row.status), ['not_linked', 'matches_review']);
  assert.equal(result.rows[1].issueUrl, 'https://test.atlassian.net/browse/DD-1');
  assert.equal(result.rows[1].checkedAt, date);
  assert.deepEqual(f.calls.filter(call => call.type === 'project'), [{ type: 'project', id: '10000' }]);
  assert.ok(f.calls.some(call => call.type === 'baseline' && call.key === baselineKey(f.actorFor('DD-1'))));
});

test('a fresh current-user project read must verify both trusted project ID and key', async () => {
  for (const result of [{ id: '99999', key: 'DD' }, { id: '10000', key: 'OTHER' }, null]) {
    const f = fixture(); f.gateway.readProject = async () => result;
    await rejectsCode(check(f), 'INVALID_CONTEXT');
    assert.equal(f.calls.filter(call => ['issue', 'baseline', 'source'].includes(call.type)).length, 0);
  }
  for (const failure of [new SpikeError('ACCESS_DENIED', 'Private project'), new Error('Private SDK detail')]) {
    const f = fixture(); f.gateway.readProject = async () => { throw failure; };
    await rejectsCode(check(f), 'QUEUE_UNAVAILABLE');
    assert.equal(f.calls.filter(call => call.type === 'issue').length, 0);
  }
  const f = fixture(); f.gateway.readSite = async () => 'https://person:secret@test.atlassian.net';
  await rejectsCode(check(f), 'QUEUE_UNAVAILABLE');
});

test('moved, aliased, cross-project or malformed issues reveal no returned identity and never read baselines', async () => {
  for (const mutate of [
    issue => { issue.project.id = '99999'; }, issue => { issue.project.key = 'OTHER'; },
    issue => { issue.key = 'DD-2'; }, issue => { issue.key = 'OTHER-1'; },
    issue => { issue.id = 'not-numeric'; }, issue => { issue.id = '0'; },
    issue => { issue.summary = null; }, issue => { issue.updated = 'invalid'; }
  ]) {
    const f = fixture(); f.link('DD-1'); mutate(f.issues.get('DD-1'));
    const row = await oneRow(f);
    assert.equal(row.status, 'could_not_verify');
    assert.equal(row.key, null); assert.equal(row.summary, null); assert.equal(row.issueUrl, null);
    assert.equal(row.reviewedVersion, null); assert.equal(row.currentVersion, null);
    assert.equal(f.calls.filter(call => ['baseline', 'source', 'history'].includes(call.type)).length, 0);
  }
});

test('freshly authorized issue information survives source denial but unreadable issue metadata does not', async () => {
  const f = fixture(); f.link('DD-1'); f.link('DD-2'); f.sources.delete(f.sourceId('DD-1')); f.issues.delete('DD-3');
  const result = await check(f, ['DD-1', 'DD-2', 'DD-3']);
  assert.equal(result.rows[0].status, 'could_not_verify');
  assert.equal(result.rows[0].reasonCode, 'SOURCE_UNAVAILABLE');
  assert.equal(result.rows[0].summary, 'Authorized issue 1');
  assert.equal(result.rows[0].reviewedVersion, null); assert.equal(result.rows[0].currentVersion, null);
  assert.equal(result.rows[1].status, 'matches_review');
  assert.equal(result.rows[2].reasonCode, 'ISSUE_UNAVAILABLE');
  assert.equal(result.rows[2].key, null); assert.equal(result.rows[2].summary, null); assert.equal(result.rows[2].issueUrl, null);
  assert.ok(!JSON.stringify(result).includes('Private'));
});

test('actual drift integration maps whole-page and passage states with partial inaccessible history', async () => {
  const f = fixture();
  for (const key of ['DD-1', 'DD-6', 'DD-7']) f.link(key);
  for (const key of ['DD-2', 'DD-3', 'DD-4', 'DD-8']) f.link(key, true);
  f.setSource(makeSource(f.sourceId('DD-2'), `${sourceQuote}\nRollout starts in December.`, 2));
  f.setSource(makeSource(f.sourceId('DD-3'), 'Links now expire immediately.', 2));
  f.setSource(makeSource(f.sourceId('DD-4'), `${sourceQuote}\n${sourceQuote}`, 2));
  f.sources.delete(f.sourceId('DD-6'));
  for (const key of ['DD-7', 'DD-8']) {
    f.setSource(makeSource(f.sourceId(key), `${sourceQuote}\nChanged surrounding text.`, 2));
    f.history.delete(`${f.sourceId(key)}:1`);
  }
  const result = await check(f, Array.from({ length: 8 }, (_, i) => `DD-${i + 1}`));
  assert.deepEqual(result.rows.map(row => row.status), [
    'matches_review', 'context_changed', 'needs_review', 'needs_review',
    'not_linked', 'could_not_verify', 'needs_review', 'could_not_verify'
  ]);
  assert.equal(result.rows[6].reasonCode, 'SOURCE_CHANGED_HISTORY_UNAVAILABLE');
  assert.equal(result.rows[7].reasonCode, 'LINKED_TEXT_UNAVAILABLE');
  assert.equal(f.calls.filter(call => call.type === 'history' && call.id === f.sourceId('DD-2')).length, 1);
  assert.equal(f.writes(), 0);
});

test('remaining real tracking states preserve review warnings and never infer semantic alignment', async () => {
  const cases = [
    [false, f => f.setSource(makeSource(f.sourceId('DD-1'), undefined, 2)), 'needs_review', 'SOURCE_VERSION_CHANGED'],
    [false, f => { f.issues.get('DD-1').summary = 'Changed issue summary'; }, 'needs_review', 'ISSUE_CHANGED'],
    [false, f => { f.issues.get('DD-1').summary = 'Changed summary'; f.setSource(makeSource(f.sourceId('DD-1'), 'Changed source.', 2)); }, 'needs_review', 'BOTH_CHANGED'],
    [true, f => { f.issues.get('DD-1').description = description('The acceptance criterion was removed.'); }, 'needs_review', 'LINKED_TEXT_CHANGED'],
    [true, f => { f.issues.get('DD-1').description = { type: 'unsupported' }; }, 'could_not_verify', 'LINKED_TEXT_UNAVAILABLE'],
    [true, f => { f.sources.get(f.sourceId('DD-1')).hasUnrepresentedContent = true; }, 'could_not_verify', 'LINKED_TEXT_UNAVAILABLE']
  ];
  for (const [focused, change, status, reason] of cases) {
    const f = fixture(); f.link('DD-1', focused); change(f);
    const row = await oneRow(f);
    assert.equal(row.status, status); assert.equal(row.reasonCode, reason);
  }
});

test('queue responses have a fixed minimal shape without source bodies, quotations, hashes or IDs', async () => {
  const f = fixture(); f.link('DD-1', true);
  const row = await oneRow(f);
  assert.deepEqual(Object.keys(row).sort(), [
    'checkedAt', 'currentVersion', 'inputKey', 'issueUrl', 'key', 'reasonCode', 'reviewedVersion', 'status', 'summary'
  ]);
  const json = JSON.stringify(row);
  for (const privateText of [sourceQuote, requirementQuote, 'Restricted source title', f.sourceId('DD-1'),
    f.sources.get(f.sourceId('DD-1')).hash, context.accountId, context.cloudId, '10001']) assert.ok(!json.includes(privateText));
  assert.equal(row.reviewedVersion, 1); assert.equal(row.currentVersion, 1);
  const unlinked = (await check(f, ['DD-2'])).rows[0];
  assert.deepEqual(Object.keys(unlinked).sort(), Object.keys(row).sort());
  assert.equal(unlinked.reviewedVersion, null); assert.equal(unlinked.currentVersion, null);
});

test('storage, rate, service, unsupported-source and unknown SDK failures are safe row failures, never not linked', async () => {
  const cases = [
    [new SpikeError('RATE_LIMITED', 'Private quota detail'), 'RATE_LIMITED'],
    [new SpikeError('UPSTREAM_ERROR', 'Private service detail'), 'SERVICE_UNAVAILABLE'],
    [new SpikeError('UNSUPPORTED_PAGE', 'Private source body'), 'SOURCE_UNSUPPORTED'],
    [new SpikeError('UNPUBLISHED_PAGE', 'Private draft'), 'SOURCE_UNAVAILABLE'],
    [new Error('Private SDK error with user content'), 'CHECK_FAILED']
  ];
  for (const [error, reasonCode] of cases) {
    const f = fixture(); f.link('DD-1'); let attempts = 0;
    f.gateway.readSource = async () => { attempts += 1; throw error; };
    const row = await oneRow(f);
    assert.equal(row.status, 'could_not_verify'); assert.equal(row.reasonCode, reasonCode);
    assert.equal(row.summary, 'Authorized issue 1'); assert.equal(row.reviewedVersion, null);
    assert.equal(attempts, 1); assert.ok(!JSON.stringify(row).includes('Private'));
  }
  for (const error of [new Error('Private storage failure'), new SpikeError('INVALID_BASELINE', 'Corrupt private metadata')]) {
    const f = fixture(); f.link('DD-1'); f.baselineStore.get = async () => { throw error; };
    const row = await oneRow(f);
    assert.equal(row.status, 'could_not_verify'); assert.notEqual(row.reasonCode, 'NO_REVIEWED_SOURCE');
    assert.equal(row.currentVersion, null);
  }
});

test('invalid source identities, versions and version regressions cannot become matches or expose baseline versions', async () => {
  for (const mutate of [
    source => { source.id = '99999'; }, source => { source.version = 0; }, source => { source.version = '1'; }
  ]) {
    const f = fixture(); f.link('DD-1'); mutate(f.sources.get(f.sourceId('DD-1')));
    const row = await oneRow(f);
    assert.equal(row.status, 'could_not_verify'); assert.equal(row.reviewedVersion, null); assert.equal(row.currentVersion, null);
  }
  const f = fixture(); f.link('DD-1'); f.baselines.get(baselineKey(f.actorFor('DD-1'))).sourceVersion = 2;
  const row = await oneRow(f);
  assert.equal(row.reasonCode, 'SOURCE_UNAVAILABLE'); assert.equal(row.status, 'could_not_verify');
});

test('unknown tracker states fail closed instead of manufacturing a review result', async () => {
  const f = fixture();
  const states = ['new_unknown', 'toString', '__proto__'].map(status => ({ tracked: true, sourceVersion: 1, tracking: { status, baseline: { sourceVersion: 1 } } }));
  for (const invalid of [undefined, {}, { tracked: true }, ...states]) {
    const queue = createQueue({ gateway: f.gateway, checkAuthorizedIssue: async () => invalid });
    const row = (await queue.checkSelectedIssues(context, { issueKeys: ['DD-1'] })).rows[0];
    assert.equal(row.status, 'could_not_verify'); assert.equal(row.reasonCode, 'CHECK_FAILED');
    assert.equal(row.reviewedVersion, null);
  }
  f.gateway.readIssueByKey = async () => { throw new SpikeError('toString', 'Private unexpected code'); };
  const row = await oneRow(f);
  assert.equal(row.reasonCode, 'CHECK_FAILED');
});

test('queue concurrency is two with one project/site/issue read and no writes or automatic retries', async () => {
  const f = fixture(); for (let i = 1; i <= 8; i += 1) f.link(`DD-${i}`);
  const original = f.gateway.readSource;
  let active = 0; let peak = 0;
  f.gateway.readSource = async (...args) => {
    active += 1; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 4));
    try { return await original(...args); } finally { active -= 1; }
  };
  await check(f, Array.from({ length: 8 }, (_, i) => `DD-${i + 1}`));
  assert.equal(CONCURRENCY, 2); assert.equal(peak, 2);
  for (const type of ['site', 'project']) assert.equal(f.calls.filter(call => call.type === type).length, 1);
  for (const type of ['issue', 'baseline', 'source']) assert.equal(f.calls.filter(call => call.type === type).length, 8);
  assert.equal(f.calls.filter(call => call.type === 'history').length, 0);
  assert.equal(f.writes(), 0);
});

test('the original SDK consent error propagates from project, site, issue, storage, source or history', async () => {
  for (const phase of ['project', 'site', 'issue', 'storage', 'source', 'history']) {
    const f = fixture(); f.link('DD-1', true);
    const consent = new Error('Authentication Required'); consent.name = 'NEEDS_AUTHENTICATION_ERR';
    const reject = async () => { throw consent; };
    if (phase === 'project') f.gateway.readProject = reject;
    if (phase === 'site') f.gateway.readSite = reject;
    if (phase === 'issue') f.gateway.readIssueByKey = reject;
    if (phase === 'storage') f.baselineStore.get = reject;
    if (phase === 'source') f.gateway.readSource = reject;
    if (phase === 'history') {
      f.setSource(makeSource(f.sourceId('DD-1'), `${sourceQuote}\nChanged context.`, 2));
      f.gateway.readSourceVersion = reject;
    }
    await assert.rejects(check(f), error => error === consent);
    assert.equal(f.writes(), 0);
  }
});

test('parallel project/site failure does not swallow a later consent error', async () => {
  const f = fixture(); const consent = new Error('Authentication Required'); consent.name = 'NEEDS_AUTHENTICATION_ERR';
  f.gateway.readProject = async () => { throw new Error('Immediate private failure'); };
  f.gateway.readSite = async () => { await new Promise(resolve => setImmediate(resolve)); throw consent; };
  await assert.rejects(check(f), error => error === consent);
});

test('consent stops further queue rows and waits for already-running work to settle', async () => {
  const f = fixture(); const consent = new Error('Authentication Required'); consent.name = 'NEEDS_AUTHENTICATION_ERR';
  let secondSettled = false; const started = [];
  f.gateway.readIssueByKey = async key => {
    started.push(key);
    if (key === 'DD-1') throw consent;
    await new Promise(resolve => setTimeout(resolve, 4)); secondSettled = true;
    return clone(f.issues.get(key));
  };
  await assert.rejects(check(f, ['DD-1', 'DD-2', 'DD-3', 'DD-4']), error => error === consent);
  assert.deepEqual(started, ['DD-1', 'DD-2']); assert.equal(secondSettled, true);
  assert.equal(f.calls.filter(call => call.type === 'baseline').length, 0);
});

test('shared tracking is isolated by the trusted cloud and freshly resolved numeric issue ID', async () => {
  const f = fixture(); f.link('DD-1');
  assert.equal((await check(f, ['DD-1'], { ...context, accountId: 'other-permitted-reviewer' })).rows[0].status, 'matches_review');
  assert.equal((await check(f, ['DD-1'], { ...context, cloudId: 'different-cloud' })).rows[0].status, 'not_linked');
  assert.equal((await check(f, ['DD-2'])).rows[0].status, 'not_linked');
});

test('authorized tracker remains separate from exposed issue-panel resolver handlers', async () => {
  const f = fixture();
  const handlers = createDrift({ gateway: f.gateway, store: f.store, baselineStore: f.baselineStore });
  assert.deepEqual(Object.keys(handlers).sort(), ['confirmBaseline', 'inspectDecisionSource', 'loadTrackedSource', 'prepareBaseline']);
  const tracker = createAuthorizedTracker({ gateway: f.gateway, baselineStore: f.baselineStore });
  await rejectsCode(tracker({ actor: { ...f.actorFor('DD-1'), issueId: '99999' }, issue: f.issues.get('DD-1'), origin: 'https://test.atlassian.net' }), 'INVALID_CONTEXT');
  assert.equal(f.calls.length, 0);
});
