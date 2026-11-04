// Offline authoring and verification only. This module is not a Forge entrypoint.
const { sourceFromPage, issueEvidenceText } = require('./spike.cjs');
const { prepareFocus } = require('./passage.cjs');
const { createDrift, createAuthorizedTracker } = require('./drift.cjs');
const { createQueue } = require('./queue.cjs');

const EXPECTED = { matching: 'matches_review', context: 'context_changed', edited: 'needs_review', unlinked: 'not_linked' };
const PHASE = { matching: 'current', context: 'initial', edited: 'initial' };
const clone = value => structuredClone(value);
const fail = (message, code = 'INVALID_FIXTURE') => { const error = new Error(message); error.code = code; throw error; };
const must = (condition, message) => { if (!condition) fail(message); };
const verify = (condition, message) => { if (!condition) fail(message, 'DEMO_VERIFICATION_FAILED'); };
const adf = paragraphs => ({ type: 'doc', version: 1, content: paragraphs.map(text => ({
  type: 'paragraph', content: [{ type: 'text', text }]
})) });
const textOf = paragraphs => issueEvidenceText({ description: adf(paragraphs) });

function exactKeys(value, keys, label) {
  must(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
  must(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), `${label} has missing or unsupported fields.`);
}
function boundedText(value, limit, label) {
  must(typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= limit, `${label} must be nonempty, trimmed text within ${limit} characters.`);
}
function paragraphs(value, label) {
  must(Array.isArray(value) && value.length > 0 && value.length <= 40, `${label} needs one to forty paragraphs.`);
  for (const paragraph of value) boundedText(paragraph, 16000, label);
  must(value.join('\n').length <= 16000, `${label} exceeds the complete-text limit.`);
  textOf(value);
}
function pageFor(fixture, phase, version, id = '20001') {
  return {
    id, title: fixture.source.title, status: 'current', version: { number: version },
    body: { atlas_doc_format: { value: JSON.stringify(adf(fixture.source[`${phase}Paragraphs`])) } }
  };
}

function validateFixture(value) {
  exactKeys(value, ['schemaVersion', 'demoId', 'source', 'cases'], 'Fixture');
  must(value.schemaVersion === 1, 'Unsupported fixture schema version.');
  must(typeof value.demoId === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value.demoId), 'demoId must be a portable lowercase identifier.');
  exactKeys(value.source, ['title', 'initialParagraphs', 'currentParagraphs'], 'Source');
  boundedText(value.source.title, 200, 'Source title');
  for (const phase of ['initial', 'current']) paragraphs(value.source[`${phase}Paragraphs`], `${phase} source`);
  must(JSON.stringify(value.source.initialParagraphs) !== JSON.stringify(value.source.currentParagraphs), 'The current source must change from the initial source.');
  must(Array.isArray(value.cases) && value.cases.length === 4, 'The demo needs exactly four issue roles.');
  const roles = new Set();
  for (const entry of value.cases) {
    must(entry && Object.hasOwn(EXPECTED, entry.role) && !roles.has(entry.role), 'Issue roles must be matching, context, edited and unlinked exactly once.');
    roles.add(entry.role);
    exactKeys(entry, ['role', 'summary', 'descriptionParagraphs', 'review', 'expectedQueueStatus', ...(entry.role === 'edited' ? ['repair'] : [])], `Issue ${entry.role}`);
    boundedText(entry.summary, 255, 'Issue summary');
    paragraphs(entry.descriptionParagraphs, 'Issue description');
    must(entry.expectedQueueStatus === EXPECTED[entry.role], `Unexpected status assertion for ${entry.role}.`);
    if (entry.role === 'unlinked') { must(entry.review === null, 'The unlinked issue must never receive a review.'); continue; }
    exactKeys(entry.review, ['phase', 'sourceQuote', 'requirementQuote'], 'Review');
    must(entry.review.phase === PHASE[entry.role], `Unexpected review phase for ${entry.role}.`);
    const checkQuotes = (selection, phase, issueParagraphs) => {
      for (const key of ['sourceQuote', 'requirementQuote']) boundedText(selection[key], 1000, key);
      const source = sourceFromPage(pageFor(value, phase, phase === 'initial' ? 1 : 2), 'https://demo.invalid');
      try { prepareFocus(source, textOf(issueParagraphs), selection.sourceQuote, selection.requirementQuote); }
      catch (error) { fail(`The ${entry.role} ${phase} passages are invalid: ${error.code ?? 'INVALID_PASSAGE'}.`); }
    };
    checkQuotes(entry.review, entry.review.phase, entry.descriptionParagraphs);
    if (entry.role === 'edited') {
      exactKeys(entry.repair, ['descriptionParagraphs', 'sourceQuote', 'requirementQuote'], 'Edited issue repair');
      paragraphs(entry.repair.descriptionParagraphs, 'Repaired Jira description');
      must(textOf(entry.repair.descriptionParagraphs) !== textOf(entry.descriptionParagraphs), 'The declared human repair must change the Jira description.');
      checkQuotes(entry.repair, 'current', entry.repair.descriptionParagraphs);
    }
  }
  return clone(value);
}

function buildDemoPlan(input) {
  const fixture = validateFixture(input);
  return {
    schemaVersion: fixture.schemaVersion, demoId: fixture.demoId,
    notice: 'Synthetic setup instructions. Offline verification uses simulated product/storage adapters; it is not live cloud evidence. Choose a project and record its actual issue keys, page ID and version numbers. No credentials or installer account details belong in this plan.',
    source: { title: fixture.source.title, initialText: fixture.source.initialParagraphs.join('\n\n'), currentText: fixture.source.currentParagraphs.join('\n\n') },
    issues: fixture.cases.map(entry => ({
      role: entry.role, summary: entry.summary, descriptionText: entry.descriptionParagraphs.join('\n\n'),
      review: entry.review, expectedQueueStatus: entry.expectedQueueStatus,
      ...(entry.repair ? { humanRepair: { descriptionText: entry.repair.descriptionParagraphs.join('\n\n'), sourceQuote: entry.repair.sourceQuote, requirementQuote: entry.repair.requirementQuote } } : {})
    })),
    setup: [
      'Create four fresh synthetic issues in one project. Record their keys by role. Publish one shared source page with initialText; record its actual version.',
      'In each context and edited issue panel, inspect that page, select its declared exact passages, preview, explicitly approve and save. Do not review unlinked.',
      'Publish currentText as the next version of the same page. Do not assume published versions are numbered 1 and 2.',
      'In matching, explicitly review and save its declared pair against the current source. Reload the issue panels before checking all four keys in the queue.',
      'For repair, a human edits only the edited issue description to humanRepair.descriptionText, then rechecks the source. Select the new exact pair, preview, approve and save. Refresh the queue: only edited should change to matches_review.'
    ],
    reset: [
      'Publish initialText as a new current page version. Restore the edited Jira description to its initial descriptionText before preparing any review.',
      'Explicitly review context and edited against that current version. Publish currentText as the next version, then explicitly review matching. Reload and check the queue.',
      'Never rewind page versions or edit/delete app storage. Keep unlinked never reviewed; if someone saves a baseline for it, create a fresh issue for that role.',
      'These steps change synthetic fixture data and review metadata. They do not require another Jira comment or any billing, license or security-setting change.'
    ],
    demo: [
      { seconds: '0:00–0:25', action: 'Explicitly check four selected keys. Show matching, context changed, needs review and unlinked; this is a selected scope, not release coverage.' },
      { seconds: '0:25–0:50', action: 'Open context: the linked expiration text still matches once while surrounding source text changed. Explain that context requires human judgment.' },
      { seconds: '0:50–1:55', action: 'Open edited: compare the old admin-only passage with the new members-only policy. A human corrects the Jira description first, rechecks, selects the fresh pair, previews, approves and saves.' },
      { seconds: '1:55–2:20', action: 'Refresh the queue. Edited now matches its review; context remains changed. The app did not edit Jira criteria or infer semantic agreement.' },
      { seconds: '2:20–2:40', action: 'Show the unlinked issue without saving a review. Close on fresh permitted evidence, explicit review and repeatable synthetic setup; claim no measured time saving.' }
    ]
  };
}

async function simulateDemo(input) {
  const fixture = validateFixture(input);
  const origin = 'https://demo.invalid';
  const accountId = 'offline-demo-reviewer';
  const cloudId = 'offline-demo-cloud';
  const project = { id: '10000', key: 'DEMO' };
  const pageId = '20001';
  let clock = Date.parse('2026-11-04T12:00:00Z');
  let sequence = 0;
  let phase = 'setup';
  let currentVersion = 1;
  const pages = new Map([[1, pageFor(fixture, 'initial', 1, pageId)]]);
  const issues = new Map(fixture.cases.map((entry, index) => [entry.role, {
    id: String(10001 + index), key: `DEMO-${index + 1}`, summary: entry.summary,
    description: adf(entry.descriptionParagraphs), updated: new Date(clock).toISOString(), project: clone(project)
  }]));
  const records = new Map();
  const baselines = new Map();
  const writtenRecords = [];
  const counts = { setupBaselineWrites: 0, repairBaselineWrites: 0, queueWrites: 0, jiraWrites: 0, manualIssueEdits: 0 };
  function writeGuard() { if (phase === 'queue') { counts.queueWrites += 1; fail('The queue attempted a write.', 'DEMO_VERIFICATION_FAILED'); } }
  const gateway = {
    async readSite() { return origin; },
    async readProject(id) { verify(id === project.id, 'Wrong synthetic project.'); return clone(project); },
    async readIssue(id) {
      const issue = [...issues.values()].find(value => value.id === id);
      verify(Boolean(issue), 'Unknown synthetic issue.'); return clone(issue);
    },
    async readIssueByKey(key) {
      const issue = [...issues.values()].find(value => value.key === key);
      verify(Boolean(issue), 'Unknown synthetic key.'); return clone(issue);
    },
    async readSource(id) { verify(id === pageId, 'Unknown synthetic page.'); return sourceFromPage(clone(pages.get(currentVersion)), origin); },
    async readSourceVersion(id, requestedOrigin, version) {
      verify(id === pageId && requestedOrigin === origin && pages.has(version), 'Unknown synthetic historical page.');
      return sourceFromPage(clone(pages.get(version)), origin, { expectedVersion: version });
    },
    async postComment() { counts.jiraWrites += 1; writeGuard(); fail('The demo must never post a Jira comment.', 'DEMO_VERIFICATION_FAILED'); }
  };
  const store = {
    async get(key) { return clone(records.get(key)); },
    async put(key, value) { writeGuard(); records.set(key, clone(value)); writtenRecords.push(clone(value)); }
  };
  const baselineStore = {
    async get(key) { return clone(baselines.get(key)); },
    async compareAndSet(key, revision, value) {
      writeGuard();
      if ((baselines.get(key)?.revision ?? 0) !== revision) return false;
      baselines.set(key, clone(value));
      writtenRecords.push(clone(value));
      counts[phase === 'repair' ? 'repairBaselineWrites' : 'setupBaselineWrites'] += 1;
      return true;
    }
  };
  const makeDrift = () => createDrift({ gateway, store, baselineStore, now: () => clock,
    newId: () => `11111111-2222-4333-8444-${String(++sequence).padStart(12, '0')}` });
  const issueContext = role => ({ accountId, cloudId, extension: { issue: { id: issues.get(role).id } } });
  async function saveReview(entry, selection) {
    clock += 1000;
    const service = makeDrift();
    const preview = await service.prepareBaseline(issueContext(entry.role), { pageInput: pageId, mode: 'passage', sourceQuote: selection.sourceQuote, requirementQuote: selection.requirementQuote });
    const receipt = await service.confirmBaseline(issueContext(entry.role), { previewId: preview.previewId, approved: true });
    verify(receipt.alreadyReviewed === false && receipt.tracking.status === 'unchanged', 'A synthetic review was not saved through the real service.');
  }
  for (const entry of fixture.cases.filter(entry => entry.review?.phase === 'initial')) await saveReview(entry, entry.review);
  pages.get(1).status = 'historical';
  pages.set(2, pageFor(fixture, 'current', 2, pageId)); currentVersion = 2;
  for (const entry of fixture.cases.filter(entry => entry.review?.phase === 'current')) await saveReview(entry, entry.review);

  async function queueSnapshot() {
    // Discard transient previews and recreate both readers before every check.
    records.clear();
    const service = makeDrift();
    for (const entry of fixture.cases) {
      const loaded = await service.loadTrackedSource(issueContext(entry.role));
      verify(loaded.tracked === (entry.role !== 'unlinked'), 'Durable review restoration failed.');
    }
    const queue = createQueue({ gateway, checkAuthorizedIssue: createAuthorizedTracker({ gateway, baselineStore }), now: () => clock });
    const issueBefore = JSON.stringify([...issues.values()]);
    const baselineBefore = JSON.stringify([...baselines]);
    phase = 'queue';
    const result = await queue.checkSelectedIssues({ accountId, cloudId, extension: { type: 'jira:projectPage', project } }, { issueKeys: [...issues.values()].map(issue => issue.key) });
    verify(JSON.stringify([...issues.values()]) === issueBefore && JSON.stringify([...baselines]) === baselineBefore && records.size === 0, 'A queue check changed synthetic product or storage data.');
    verify(result.rows.length === fixture.cases.length, 'The queue did not return four results.');
    return result.rows.map((row, index) => ({ role: fixture.cases[index].role, status: row.status, reasonCode: row.reasonCode, reviewedVersion: row.reviewedVersion, currentVersion: row.currentVersion }));
  }
  const before = await queueSnapshot();
  for (const entry of fixture.cases) verify(before.find(row => row.role === entry.role)?.status === entry.expectedQueueStatus, `The real queue did not produce the expected ${entry.role} state.`);
  const edited = fixture.cases.find(entry => entry.role === 'edited');
  const editedIssue = issues.get('edited');
  phase = 'repair'; clock += 1000;
  // This models an external human Jira edit, not an app operation or gateway POST.
  editedIssue.description = adf(edited.repair.descriptionParagraphs);
  editedIssue.updated = new Date(clock).toISOString(); counts.manualIssueEdits += 1;
  await saveReview(edited, edited.repair);
  const after = await queueSnapshot();
  const changedRows = before.filter((row, index) => row.status !== after[index].status).map(row => row.role);
  verify(JSON.stringify(changedRows) === JSON.stringify(['edited']) && after.find(row => row.role === 'edited').status === 'matches_review', 'Repair changed unexpected queue rows.');
  const privateText = [fixture.source.title, ...fixture.source.initialParagraphs, ...fixture.source.currentParagraphs,
    ...fixture.cases.flatMap(entry => [...entry.descriptionParagraphs, ...(entry.repair?.descriptionParagraphs ?? []),
      ...(entry.review ? [entry.review.sourceQuote, entry.review.requirementQuote] : []), ...(entry.repair ? [entry.repair.sourceQuote, entry.repair.requirementQuote] : [])])];
  function containsPrivateText(value) {
    if (typeof value === 'string') return privateText.some(text => value.includes(text));
    return value && typeof value === 'object' && Object.values(value).some(containsPrivateText);
  }
  verify(!containsPrivateText(writtenRecords), 'Persistent metadata retained synthetic document text.');
  verify(baselines.size === 3 && counts.setupBaselineWrites === 3 && counts.repairBaselineWrites === 1 && counts.queueWrites === 0 && counts.jiraWrites === 0, 'The demo wrote unexpected state.');
  return {
    mode: 'offline-real-services-simulated-adapters', liveCloudVerified: false,
    before, after, changedRows, ...counts,
    durableReloadVerified: true, persistentRecordsContainNoQuotes: true, storedRecordsVerified: writtenRecords.length,
    note: 'Expected statuses were asserted after real service execution. The human Jira correction and review approvals are simulated; no network, installation or account action occurred. Text changes are not a semantic-conflict verdict.'
  };
}

module.exports = { validateFixture, buildDemoPlan, simulateDemo };
