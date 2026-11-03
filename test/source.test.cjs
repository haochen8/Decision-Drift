const test = require('node:test');
const assert = require('node:assert/strict');
const { adfText, sourceFromPage } = require('../src/spike.cjs');

const document = text => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const page = doc => ({ id: '123', title: 'Decision', status: 'current', version: { number: 2 }, body: { atlas_doc_format: { value: JSON.stringify(doc) } } });

test('complete source text includes changes beyond the former 4,000-character limit', () => {
  const prefix = 'Context '.repeat(600);
  const before = sourceFromPage(page(document(`${prefix}Admins only.`)), 'https://test.atlassian.net');
  const after = sourceFromPage(page(document(`${prefix}All members.`)), 'https://test.atlassian.net');
  assert.ok(after.text.endsWith('All members.'));
  assert.notEqual(before.textHash, after.textHash);
  assert.equal(after.hasUnrepresentedContent, false);
});

test('oversize and overdeep pages fail instead of silently hiding source text', () => {
  assert.throws(() => sourceFromPage(page(document('x'.repeat(16001))), 'https://test.atlassian.net'), { code: 'UNSUPPORTED_PAGE' });
  let deep = { type: 'text', text: 'Hidden decision' };
  for (let i = 0; i < 42; i++) deep = { type: 'blockquote', content: [deep] };
  assert.throws(() => adfText(deep), { code: 'UNSUPPORTED_PAGE' });
});

test('non-text nodes are explicitly marked as incomplete textual coverage', () => {
  const doc = document('See the diagram');
  doc.content.push({ type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'image-id' } }] });
  const source = sourceFromPage(page(doc), 'https://test.atlassian.net');
  assert.equal(source.text, 'See the diagram');
  assert.equal(source.hasUnrepresentedContent, true);
});

test('table cells preserve separations between values', () => {
  const doc = { type: 'doc', version: 1, content: [{ type: 'table', content: [{ type: 'tableRow', content: [
    { type: 'tableCell', content: document('Admins').content },
    { type: 'tableCell', content: document('Only').content }
  ] }] }] };
  assert.notEqual(adfText(doc), 'AdminsOnly');
  assert.match(adfText(doc), /Admins\s+Only/);
});

test('malformed nested content cannot silently become an empty source excerpt', () => {
  assert.throws(() => adfText({ type: 'paragraph', content: { type: 'text', text: 'Hidden' } }), { code: 'UNSUPPORTED_PAGE' });
  assert.throws(() => adfText({ type: 'text' }), { code: 'UNSUPPORTED_PAGE' });
});

test('historical reads accept only the exact requested published version', () => {
  const historical = { ...page(document('Prior decision')), status: 'historical' };
  assert.equal(sourceFromPage(historical, 'https://test.atlassian.net', { expectedVersion: 2 }).text, 'Prior decision');
  assert.throws(() => sourceFromPage(historical, 'https://test.atlassian.net'), { code: 'UNPUBLISHED_PAGE' });
  assert.throws(() => sourceFromPage(historical, 'https://test.atlassian.net', { expectedVersion: 1 }), { code: 'UNPUBLISHED_PAGE' });
  assert.throws(() => sourceFromPage({ ...historical, status: 'draft' }, 'https://test.atlassian.net', { expectedVersion: 2 }), { code: 'UNPUBLISHED_PAGE' });
});
