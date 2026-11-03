const test = require('node:test');
const assert = require('node:assert/strict');
const { SpikeError, digest } = require('../src/spike.cjs');
const { prepareFocus, validateFocus, trackFocus, matches, MAX_TEXT_LENGTH, MAX_QUOTE_LENGTH } = require('../src/passage.cjs');

const sourceQuote = 'Export links expire after seven days.';
const requirementQuote = 'Expire every exported download link.';
const source = text => ({ text, hasUnrepresentedContent: false });
const originalSource = source(`Decision\n${sourceQuote}\nContext`);
const originalIssue = `Build secure exports\n\n${requirementQuote}`;
const prepare = () => prepareFocus(originalSource, originalIssue, sourceQuote, requirementQuote);
const throwsCode = (fn, code) => assert.throws(fn, error => error instanceof SpikeError && error.code === code);

test('passage metadata uses exact UTF-16 offsets and hashes without retained quotes', () => {
  const emojiSource = source(`😀 Introduction\n${sourceQuote}`);
  const result = prepareFocus(emojiSource, originalIssue, ` \n${sourceQuote}\t`, requirementQuote);
  assert.equal(result.focus.sourceStart, emojiSource.text.indexOf(sourceQuote));
  assert.equal(result.focus.sourceLength, sourceQuote.length);
  assert.equal(result.focus.sourcePassageHash, digest(sourceQuote));
  assert.equal(result.focus.requirementField, 'description');
  assert.deepEqual(result.reviewScope, { mode: 'passage', sourceQuote, requirementQuote });
  assert.ok(!JSON.stringify(result.focus).includes(sourceQuote));
  assert.ok(!JSON.stringify(result.focus).includes(requirementQuote));
  assert.equal(validateFocus(result.focus), result.focus);
});

test('quoted passages must be trimmed, bounded, exact, and unique in each current body', () => {
  for (const input of [undefined, null, 123, '', 'short', ' '.repeat(8), 'x'.repeat(MAX_QUOTE_LENGTH + 1)]) {
    throwsCode(() => prepareFocus(originalSource, originalIssue, input, requirementQuote), 'INVALID_PASSAGE');
  }
  for (const [text, quote] of [[originalSource, sourceQuote.toLowerCase()], [originalSource, 'Export  links expire after seven days.']]) {
    throwsCode(() => prepareFocus(text, originalIssue, quote, requirementQuote), 'PASSAGE_NOT_FOUND');
  }
  throwsCode(() => prepareFocus(source(`${sourceQuote}\n${sourceQuote}`), originalIssue, sourceQuote, requirementQuote), 'AMBIGUOUS_PASSAGE');
  throwsCode(() => prepareFocus(originalSource, `${requirementQuote}\n${requirementQuote}`, sourceQuote, requirementQuote), 'AMBIGUOUS_PASSAGE');
  throwsCode(() => prepareFocus(originalSource, originalIssue, sourceQuote, 'missing requirement'), 'PASSAGE_NOT_FOUND');
  assert.equal(prepareFocus(source('12345678'), 'ABCDEFGH', '12345678', 'ABCDEFGH').focus.sourceLength, 8);
});

test('matching detects overlapping occurrences and duplicates far from the original offset', () => {
  assert.deepEqual(matches('aaaaaaaaa', 'aaaaaaaa'), { first: 0, count: 2 });
  const prepared = prepareFocus(source('aaaaaaaa'), originalIssue, 'aaaaaaaa', requirementQuote);
  const result = trackFocus(prepared.focus, source('aaaaaaaa'), source('aaaaaaaaa'), originalIssue);
  assert.equal(result.sourceStatus, 'ambiguous');
  const atOriginal = trackFocus(prepare().focus, originalSource, originalSource, `${originalIssue}\n${requirementQuote}`);
  assert.equal(atOriginal.requirementStatus, 'ambiguous');
});

test('passage mode refuses incomplete or over-limit supported text', () => {
  for (const current of [{ ...originalSource, hasUnrepresentedContent: true }, source('x'.repeat(MAX_TEXT_LENGTH + 1))]) {
    throwsCode(() => prepareFocus(current, originalIssue, sourceQuote, requirementQuote), 'UNSUPPORTED_FOCUS');
  }
  throwsCode(() => prepareFocus(originalSource, 'x'.repeat(MAX_TEXT_LENGTH + 1), sourceQuote, requirementQuote), 'UNSUPPORTED_FOCUS');
});

test('stored focus validation rejects unknown fields, nulls, invalid lengths, offsets, schema, and hashes', () => {
  for (const mutate of [
    focus => { focus.schemaVersion = 2; }, focus => { focus.requirementField = 'summary'; }, focus => { focus.sourceStart = -1; },
    focus => { focus.sourceStart = 0.5; }, focus => { focus.requirementLength = 7; },
    focus => { focus.requirementLength = 1001; }, focus => { focus.sourceStart = 15999; },
    focus => { focus.requirementPassageHash = 'bad'; }, focus => { focus.sourceQuote = sourceQuote; },
    focus => { delete focus.sourceLength; }
  ]) {
    const focus = structuredClone(prepare().focus); mutate(focus);
    throwsCode(() => validateFocus(focus), 'INVALID_BASELINE');
  }
  for (const value of [null, [], 'focus']) throwsCode(() => validateFocus(value), 'INVALID_BASELINE');
});

test('literal passages recover after movement or unrelated source and Jira edits', () => {
  const result = trackFocus(prepare().focus, originalSource,
    source(`New surrounding disclaimer\n${originalSource.text}\nMore context`),
    `😀 New title\n\nMoved requirement\n${requirementQuote}\nUnrelated work`);
  assert.equal(result.status, 'unchanged');
  assert.equal(result.reviewedSourceQuote, sourceQuote);
  assert.equal(result.currentSourceQuote, sourceQuote);
  assert.equal(result.currentRequirementQuote, requirementQuote);
});

test('missing source and requirement passages never invent replacement or lost Jira quotations', () => {
  let result = trackFocus(prepare().focus, originalSource, source('Links now expire immediately.'), originalIssue);
  assert.equal(result.status, 'source_changed_or_missing');
  assert.equal(result.reviewedSourceQuote, sourceQuote);
  assert.equal(result.currentSourceQuote, null);
  result = trackFocus(prepare().focus, originalSource, originalSource, 'Build exports without expiration.');
  assert.equal(result.status, 'requirement_changed_or_missing');
  assert.equal(result.currentRequirementQuote, null);
  assert.ok(!JSON.stringify(result).includes(requirementQuote));
});

test('ambiguity has precedence over a missing passage on the other side', () => {
  let result = trackFocus(prepare().focus, originalSource, source('Changed source clause.'), `${requirementQuote}\n${requirementQuote}`);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.sourceStatus, 'changed_or_missing');
  result = trackFocus(prepare().focus, originalSource, source(`${sourceQuote}\n${sourceQuote}`), 'Changed requirement.');
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.requirementStatus, 'changed_or_missing');
});

test('unverifiable historical anchors and unsupported current text expose no stored quotations', () => {
  for (const [before, after, issue] of [
    [null, originalSource, originalIssue],
    [source('Corrupt historical body.'), originalSource, originalIssue],
    [{ ...originalSource, hasUnrepresentedContent: true }, originalSource, originalIssue],
    [originalSource, { ...originalSource, hasUnrepresentedContent: true }, originalIssue],
    [originalSource, source('x'.repeat(MAX_TEXT_LENGTH + 1)), originalIssue],
    [originalSource, originalSource, 'x'.repeat(MAX_TEXT_LENGTH + 1)]
  ]) {
    const result = trackFocus(prepare().focus, before, after, issue);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reviewedSourceQuote, null);
    assert.equal(result.currentSourceQuote, null);
    assert.equal(result.currentRequirementQuote, null);
  }
});
