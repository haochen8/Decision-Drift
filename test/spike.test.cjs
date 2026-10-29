const test = require('node:test');
const assert = require('node:assert/strict');
const { createSpike, SpikeError, parsePageInput, sourceFromPage, digest, PREVIEW_MS } = require('../src/spike.cjs');

const ID = '11111111-2222-4333-8444-555555555555';
const context = { accountId: 'account-a', cloudId: 'cloud-a', extension: { issue: { id: '10001', key: 'DD-1' } } };

function fixture() {
  let clock = 100000;
  const records = new Map();
  const comments = [];
  const issue = { id: '10001', key: 'DD-1', summary: 'Validate export links', updated: '2026-10-29T15:00:00Z', description: { text: 'Existing acceptance criteria remain untouched.' } };
  const source = { id: '12345', title: 'Restricted internal title', version: 3, url: 'https://test.atlassian.net/wiki/pages/viewpage.action?pageId=12345', text: 'Private source excerpt', hash: digest('source version 3') };
  const gateway = {
    async readSite() { return 'https://test.atlassian.net'; },
    async readIssue(id) { assert.equal(id, issue.id); return structuredClone(issue); },
    async readSource(id) { assert.equal(id, source.id); return structuredClone(source); },
    async postComment(issueId, body, previewId) {
      comments.push({ issueId, body, previewId });
      return { id: '50001' };
    }
  };
  const store = {
    async get(key) { return structuredClone(records.get(key)); },
    async put(key, value) { records.set(key, structuredClone(value)); },
    async claim(key, value) {
      if (records.has(key)) return false;
      records.set(key, structuredClone(value));
      return true;
    }
  };
  const service = createSpike({ gateway, store, now: () => clock, newId: () => ID });
  return { service, gateway, store, records, comments, issue, source, advance: ms => { clock += ms; } };
}

const prepare = f => f.service.prepareUpdate(context, { pageInput: '12345' });
const apply = (f, previewId = ID, actor = context) => f.service.applyUpdate(actor, { previewId, approved: true });
const rejectsCode = (promise, code) => assert.rejects(promise, error => error instanceof SpikeError && error.code === code);

test('page URLs must refer to a published page on the current site', () => {
  assert.equal(parsePageInput(' https://test.atlassian.net/wiki/spaces/ENG/pages/12345/Decision ', 'https://test.atlassian.net'), '12345');
  assert.equal(parsePageInput('https://test.atlassian.net/wiki/pages/viewpage.action?pageId=12345', 'https://test.atlassian.net'), '12345');
  for (const input of ['https://other.atlassian.net/wiki/spaces/A/pages/12345/x', 'https://test.atlassian.net@evil.test/wiki/pages/12345']) {
    assert.throws(() => parsePageInput(input, 'https://test.atlassian.net'), error => error.code === 'WRONG_SITE');
  }
  assert.throws(() => parsePageInput('https://test.atlassian.net/wiki/x/short', 'https://test.atlassian.net'), error => error.code === 'INVALID_PAGE');
});

test('source boundary rejects live docs, drafts, and malformed ADF', () => {
  const page = { id: '12345', title: 'Decision', status: 'current', version: { number: 3 }, body: { atlas_doc_format: { value: JSON.stringify({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Links expire after 7 days.' }] }] }) } } };
  assert.equal(sourceFromPage(page, 'https://test.atlassian.net').text, 'Links expire after 7 days.');
  assert.throws(() => sourceFromPage({ ...page, subtype: 'live' }, 'https://test.atlassian.net'), error => error.code === 'UNPUBLISHED_PAGE');
  assert.throws(() => sourceFromPage({ ...page, status: 'draft' }, 'https://test.atlassian.net'), error => error.code === 'UNPUBLISHED_PAGE');
  for (const value of ['not json', '{"type":"paragraph"}', '{"type":"doc","version":1,"content":null}']) {
    assert.throws(() => sourceFromPage({ ...page, body: { atlas_doc_format: { value } } }, 'https://test.atlassian.net'), error => error.code === 'UNSUPPORTED_PAGE');
  }
});

test('inspection reads real gateway data using the issue in resolver context', async () => {
  const f = fixture();
  const view = await f.service.inspectSource(context, { pageInput: '12345', issueId: '999' });
  assert.equal(view.issue.key, 'DD-1');
  assert.equal(view.source.version, 3);
  assert.equal(view.source.text, f.source.text);
  assert.equal(f.comments.length, 0);
});

test('preview and approval do not modify existing issue fields or copy restricted source content', async () => {
  const f = fixture();
  const original = structuredClone(f.issue);
  const preview = await prepare(f);
  assert.equal(f.comments.length, 0);
  assert.ok(preview.commentText.includes('version 3'));
  assert.ok(!preview.commentText.includes(f.source.title));
  assert.ok(!preview.commentText.includes(f.source.text));
  assert.ok(!JSON.stringify(f.records.get(`preview:${ID}`)).includes(f.source.text));
  const result = await apply(f);
  assert.equal(result.commentId, '50001');
  assert.deepEqual(f.issue, original);
  assert.equal(f.comments[0].previewId, ID);
  assert.equal(f.comments[0].body.type, 'doc');
});

test('explicit approval is mandatory on the server', async () => {
  const f = fixture(); await prepare(f);
  await rejectsCode(f.service.applyUpdate(context, { previewId: ID }), 'APPROVAL_REQUIRED');
  assert.equal(f.comments.length, 0);
});

test('preview cannot be used by another user or from another issue or tenant', async () => {
  const f = fixture(); await prepare(f);
  for (const actor of [
    { ...context, accountId: 'other' },
    { ...context, cloudId: 'other-cloud' },
    { ...context, extension: { issue: { id: '10002' } } }
  ]) await rejectsCode(apply(f, ID, actor), 'INVALID_PREVIEW');
  assert.equal(f.comments.length, 0);
});

test('expiry is enforced even while the preview remains in storage', async () => {
  const f = fixture(); await prepare(f); f.advance(PREVIEW_MS);
  await rejectsCode(apply(f), 'EXPIRED_PREVIEW');
  assert.ok(f.records.has(`preview:${ID}`));
  assert.equal(f.comments.length, 0);
});

test('source version or content changes invalidate the reviewed proposal', async () => {
  for (const change of [f => { f.source.version += 1; }, f => { f.source.hash = digest('edited content'); }]) {
    const f = fixture(); await prepare(f); change(f);
    await rejectsCode(apply(f), 'STALE_PREVIEW');
    assert.equal(f.comments.length, 0);
  }
});

test('an intervening Jira edit invalidates the reviewed proposal', async () => {
  const f = fixture(); await prepare(f); f.issue.description = { text: 'Another editor changed this.' };
  await rejectsCode(apply(f), 'STALE_PREVIEW');
  assert.equal(f.comments.length, 0);
});

test('revoked Confluence access blocks approval despite the stored preview', async () => {
  const f = fixture(); await prepare(f);
  f.gateway.readSource = async () => { throw new SpikeError('ACCESS_DENIED', 'Confluence access denied'); };
  await rejectsCode(apply(f), 'ACCESS_DENIED');
  assert.equal(f.comments.length, 0);
});

test('simultaneous approval requests result in at most one upstream POST', async () => {
  const f = fixture(); await prepare(f);
  const outcomes = await Promise.allSettled([apply(f), apply(f)]);
  assert.equal(f.comments.length, 1);
  assert.ok(outcomes.some(result => result.status === 'fulfilled'));
  for (const outcome of outcomes.filter(result => result.status === 'rejected')) {
    assert.equal(outcome.reason.code, 'OUTCOME_UNKNOWN');
  }
});

test('replaying a successfully recorded approval returns the existing comment', async () => {
  const f = fixture(); await prepare(f);
  await apply(f);
  assert.equal((await apply(f)).alreadyApplied, true);
  assert.equal(f.comments.length, 1);
});

test('timeout after upstream success is retained as unknown and never blindly retried', async () => {
  const f = fixture(); await prepare(f);
  f.gateway.postComment = async (...args) => { f.comments.push(args); throw new Error('Response lost after Jira created the comment'); };
  await rejectsCode(apply(f), 'OUTCOME_UNKNOWN');
  await rejectsCode(apply(f), 'OUTCOME_UNKNOWN');
  assert.equal(f.comments.length, 1);
  assert.equal(f.records.get(`operation:${ID}`).status, 'unknown');
});

test('a failed receipt save after Jira success does not cause a second write', async () => {
  const f = fixture(); await prepare(f);
  const put = f.store.put;
  f.store.put = async (key, value) => {
    if (key.startsWith('operation:') && value.status === 'applied') throw new Error('Storage unavailable');
    return put(key, value);
  };
  await rejectsCode(apply(f), 'OUTCOME_UNKNOWN');
  await rejectsCode(apply(f), 'OUTCOME_UNKNOWN');
  assert.equal(f.comments.length, 1);
});

test('caller-supplied comment content is ignored in favor of the reviewed server copy', async () => {
  const f = fixture(); await prepare(f);
  await f.service.applyUpdate(context, { previewId: ID, approved: true, commentBody: { text: 'injected' }, issueId: '999' });
  assert.equal(f.comments[0].issueId, '10001');
  assert.ok(!JSON.stringify(f.comments[0].body).includes('injected'));
});
