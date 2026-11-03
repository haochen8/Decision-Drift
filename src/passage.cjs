const { SpikeError, digest } = require('./spike.cjs');

const MAX_TEXT_LENGTH = 16000;
const MIN_QUOTE_LENGTH = 8;
const MAX_QUOTE_LENGTH = 1000;
const FOCUS_KEYS = [
  'schemaVersion', 'sourceStart', 'sourceLength', 'sourcePassageHash',
  'requirementField', 'requirementStart', 'requirementLength', 'requirementPassageHash'
];
const fail = (code, message) => { throw new SpikeError(code, message); };
const supportedText = text => typeof text === 'string' && text.length <= MAX_TEXT_LENGTH;

function validateFocus(focus, code = 'INVALID_BASELINE') {
  const valid = focus && typeof focus === 'object' && !Array.isArray(focus) &&
    Object.keys(focus).length === FOCUS_KEYS.length && FOCUS_KEYS.every(key => Object.hasOwn(focus, key)) &&
    focus.schemaVersion === 1 && focus.requirementField === 'description' && ['source', 'requirement'].every(prefix =>
      Number.isInteger(focus[`${prefix}Start`]) && focus[`${prefix}Start`] >= 0 &&
      Number.isInteger(focus[`${prefix}Length`]) && focus[`${prefix}Length`] >= MIN_QUOTE_LENGTH &&
      focus[`${prefix}Length`] <= MAX_QUOTE_LENGTH &&
      focus[`${prefix}Start`] + focus[`${prefix}Length`] <= MAX_TEXT_LENGTH &&
      typeof focus[`${prefix}PassageHash`] === 'string' && /^[0-9a-f]{64}$/.test(focus[`${prefix}PassageHash`])
    );
  if (!valid) fail(code, 'The saved passage metadata could not be verified. Prepare a fresh review.');
  return focus;
}

// Object key order is not part of a passage link; storage may reorder keys.
const sameFocus = (left, right) => !left || !right ? (left ?? null) === (right ?? null)
  : FOCUS_KEYS.every(key => left[key] === right[key]);

// Search the complete supported text, including overlapping occurrences. Two is
// enough to reject uniqueness; offsets are UTF-16, matching JavaScript slicing.
function matches(text, quote) {
  let first = -1;
  let count = 0;
  let next = 0;
  while (next <= text.length - quote.length) {
    const index = text.indexOf(quote, next);
    if (index < 0) break;
    if (first < 0) first = index;
    if (++count === 2) break;
    next = index + 1;
  }
  return { first, count };
}

function prepareFocus(source, issueText, sourceInput, requirementInput) {
  if (!supportedText(source.text) || source.hasUnrepresentedContent || !supportedText(issueText)) {
    fail('UNSUPPORTED_FOCUS', 'Passage links require complete supported source and Jira text within the 16,000-character limit.');
  }
  const quoteFor = (input, text, label) => {
    if (typeof input !== 'string' || input.length > MAX_TEXT_LENGTH) fail('INVALID_PASSAGE', `Enter an exact ${label} passage of 8–1,000 characters.`);
    const quote = input.trim();
    if (quote.length < MIN_QUOTE_LENGTH || quote.length > MAX_QUOTE_LENGTH) {
      fail('INVALID_PASSAGE', `Enter an exact ${label} passage of 8–1,000 characters.`);
    }
    const found = matches(text, quote);
    if (!found.count) fail('PASSAGE_NOT_FOUND', `The ${label} passage does not exactly match the current text. Copy from the displayed evidence.`);
    if (found.count > 1) fail('AMBIGUOUS_PASSAGE', `The ${label} passage appears more than once. Choose a longer unique passage.`);
    return { quote, start: found.first };
  };
  const sourcePassage = quoteFor(sourceInput, source.text, 'source');
  const requirement = quoteFor(requirementInput, issueText, 'requirement');
  return {
    focus: {
      schemaVersion: 1,
      sourceStart: sourcePassage.start, sourceLength: sourcePassage.quote.length,
      sourcePassageHash: digest(sourcePassage.quote),
      requirementField: 'description',
      requirementStart: requirement.start, requirementLength: requirement.quote.length,
      requirementPassageHash: digest(requirement.quote)
    },
    reviewScope: { mode: 'passage', sourceQuote: sourcePassage.quote, requirementQuote: requirement.quote }
  };
}

const unavailableFocus = () => ({
  status: 'unavailable', sourceStatus: 'unavailable', requirementStatus: 'unavailable',
  reviewedSourceQuote: null, currentSourceQuote: null, currentRequirementQuote: null
});

function recoverRequirement(text, focus) {
  const { requirementStart: start, requirementLength: length, requirementPassageHash: hash } = focus;
  let quote = null;
  const atOriginal = text.slice(start, start + length);
  if (atOriginal.length === length && digest(atOriginal) === hash) quote = atOriginal;
  else {
    // The baseline contains no Jira plaintext or historical Jira body. Recover a
    // candidate only by hashing every complete window of the recorded length.
    for (let offset = 0; offset <= text.length - length; offset += 1) {
      const candidate = text.slice(offset, offset + length);
      if (digest(candidate) === hash) { quote = candidate; break; }
    }
  }
  if (quote === null) return { status: 'changed_or_missing', quote: null };
  return { status: matches(text, quote).count === 1 ? 'unchanged' : 'ambiguous', quote };
}

function trackFocus(focus, previousSource, currentSource, issueText) {
  validateFocus(focus);
  if (!previousSource || previousSource.hasUnrepresentedContent || currentSource.hasUnrepresentedContent ||
      !supportedText(previousSource.text) || !supportedText(currentSource.text) || !supportedText(issueText)) return unavailableFocus();
  const reviewed = previousSource.text.slice(focus.sourceStart, focus.sourceStart + focus.sourceLength);
  if (reviewed.length !== focus.sourceLength || digest(reviewed) !== focus.sourcePassageHash ||
      matches(previousSource.text, reviewed).count !== 1) return unavailableFocus();
  const sourceMatches = matches(currentSource.text, reviewed);
  const sourceStatus = sourceMatches.count === 1 ? 'unchanged' : sourceMatches.count > 1 ? 'ambiguous' : 'changed_or_missing';
  const requirement = recoverRequirement(issueText, focus);
  const status = sourceStatus === 'ambiguous' || requirement.status === 'ambiguous' ? 'ambiguous'
    : sourceStatus === 'changed_or_missing' ? 'source_changed_or_missing'
      : requirement.status === 'changed_or_missing' ? 'requirement_changed_or_missing' : 'unchanged';
  return {
    status, sourceStatus, requirementStatus: requirement.status,
    reviewedSourceQuote: reviewed,
    currentSourceQuote: sourceMatches.count ? reviewed : null,
    currentRequirementQuote: requirement.quote
  };
}

module.exports = {
  MAX_TEXT_LENGTH, MIN_QUOTE_LENGTH, MAX_QUOTE_LENGTH,
  validateFocus, sameFocus, prepareFocus, trackFocus, unavailableFocus, matches
};
