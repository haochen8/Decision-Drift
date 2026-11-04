const { SpikeError, siteOrigin } = require('./spike.cjs');
const { MAX_ISSUES: MAX_SELECTED_ISSUES, ISSUE_KEY, parseIssueKeys } = require('./queue-selection.cjs');

const CONCURRENCY = 2;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,127}$/;
const NUMERIC_ID = /^[1-9]\d{0,31}$/;
const fail = (code, message) => { throw new SpikeError(code, message); };

function queueIdentity(context) {
  const project = context?.extension?.project;
  const validIdentity = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
  if (context?.extension?.type !== 'jira:projectPage' || !validIdentity(context?.accountId) || !validIdentity(context?.cloudId) ||
      !project || !NUMERIC_ID.test(String(project.id)) || typeof project.key !== 'string' || !PROJECT_KEY.test(project.key)) {
    fail('INVALID_CONTEXT', 'Open the selected review queue from a Jira project while signed in.');
  }
  return { accountId: context.accountId, cloudId: context.cloudId, projectId: String(project.id), projectKey: project.key };
}

function selectedKeys(payload, projectKey) {
  let keys;
  try { keys = parseIssueKeys(payload?.issueKeys); }
  catch { fail('INVALID_SELECTION', 'Select between one and eight unique complete issue keys from the current project.'); }
  if (keys.some(key => key.slice(0, key.lastIndexOf('-')) !== projectKey)) {
    fail('WRONG_PROJECT', 'Select issues from the current Jira project only.');
  }
  return keys;
}

function statusFor(result) {
  if (result?.tracked === false) return { status: 'not_linked', reasonCode: 'NO_REVIEWED_SOURCE', reviewedVersion: null, currentVersion: null };
  const tracking = result?.tracking;
  const reviewedVersion = tracking?.baseline?.sourceVersion;
  const currentVersion = result?.sourceVersion;
  if (result?.tracked !== true || !Number.isInteger(reviewedVersion) || reviewedVersion < 1 ||
      !Number.isInteger(currentVersion) || currentVersion < 1) fail('INVALID_RESULT', 'The review result could not be verified.');
  const mappings = {
    unchanged: ['matches_review', 'MATCHES_REVIEW'],
    outside_scope: ['context_changed', 'CONTEXT_CHANGED'],
    source_changed: ['needs_review', tracking.diff?.status === 'unavailable' ? 'SOURCE_CHANGED_HISTORY_UNAVAILABLE' : 'SOURCE_CHANGED'],
    version_changed: ['needs_review', 'SOURCE_VERSION_CHANGED'],
    issue_changed: ['needs_review', 'ISSUE_CHANGED'],
    both_changed: ['needs_review', tracking.diff?.status === 'unavailable' ? 'BOTH_CHANGED_HISTORY_UNAVAILABLE' : 'BOTH_CHANGED'],
    different_source: ['needs_review', 'DIFFERENT_SOURCE'],
    focus_changed: ['needs_review', 'LINKED_TEXT_CHANGED'],
    focus_ambiguous: ['needs_review', 'LINKED_TEXT_AMBIGUOUS'],
    focus_unavailable: ['could_not_verify', 'LINKED_TEXT_UNAVAILABLE']
  };
  const mapping = Object.hasOwn(mappings, tracking.status) ? mappings[tracking.status] : null;
  if (!mapping) fail('INVALID_RESULT', 'The review result could not be verified.');
  return { status: mapping[0], reasonCode: mapping[1], reviewedVersion, currentVersion };
}

function failureReason(error, phase) {
  if (!(error instanceof SpikeError)) return 'CHECK_FAILED';
  const known = {
    ACCESS_DENIED: phase === 'issue' ? 'ISSUE_UNAVAILABLE' : 'SOURCE_UNAVAILABLE',
    RATE_LIMITED: 'RATE_LIMITED', UPSTREAM_ERROR: 'SERVICE_UNAVAILABLE',
    INVALID_BASELINE: 'REVIEW_DATA_UNAVAILABLE', INVALID_SOURCE: 'SOURCE_UNAVAILABLE',
    UNPUBLISHED_PAGE: 'SOURCE_UNAVAILABLE', UNSUPPORTED_PAGE: 'SOURCE_UNSUPPORTED',
    UNSUPPORTED_ISSUE: 'ISSUE_UNSUPPORTED', SOURCE_REGRESSION: 'SOURCE_UNAVAILABLE',
    WRONG_PROJECT: 'WRONG_PROJECT', INVALID_ISSUE: 'ISSUE_UNAVAILABLE', INVALID_RESULT: 'CHECK_FAILED'
  };
  return Object.hasOwn(known, error.code) ? known[error.code] : 'CHECK_FAILED';
}

function createQueue({ gateway, checkAuthorizedIssue, now = Date.now, isConsentError = error => error?.name === 'NEEDS_AUTHENTICATION_ERR' }) {
  async function checkSelectedIssues(context, payload = {}) {
    const actor = queueIdentity(context);
    const keys = selectedKeys(payload, actor.projectKey);
    let origin;
    try {
      const reads = await Promise.allSettled([gateway.readProject(actor.projectId), gateway.readSite()]);
      for (const read of reads) if (read.status === 'rejected' && isConsentError(read.reason)) throw read.reason;
      const rejected = reads.find(read => read.status === 'rejected');
      if (rejected) throw rejected.reason;
      const [project, site] = reads.map(read => read.value);
      if (String(project?.id) !== actor.projectId || project?.key !== actor.projectKey) {
        fail('INVALID_CONTEXT', 'The current Jira project changed. Reopen the project and check the selection again.');
      }
      origin = siteOrigin(site);
    } catch (error) {
      if (isConsentError(error)) throw error;
      if (error instanceof SpikeError && error.code === 'INVALID_CONTEXT') throw error;
      fail('QUEUE_UNAVAILABLE', 'The current Jira project could not be verified. Check access and try again.');
    }

    const rows = new Array(keys.length);
    let cursor = 0;
    let consentError;
    async function worker() {
      while (!consentError && cursor < keys.length) {
        const index = cursor++;
        const inputKey = keys[index];
        let issueView = { key: null, summary: null, issueUrl: null };
        let phase = 'issue';
        let result;
        try {
          const issue = await gateway.readIssueByKey(inputKey);
          if (consentError) break;
          if (String(issue?.project?.id) !== actor.projectId || issue?.project?.key !== actor.projectKey) {
            fail('WRONG_PROJECT', 'The issue is outside the selected Jira project.');
          }
          // Aliases and moved/renamed keys are deliberately not followed: the
          // caller must select the fresh canonical key in this project.
          if (typeof issue.key !== 'string' || !ISSUE_KEY.test(issue.key) || issue.key !== inputKey ||
              !NUMERIC_ID.test(String(issue.id)) || typeof issue.summary !== 'string' || issue.summary.length > 1000 ||
              typeof issue.updated !== 'string' || !Number.isFinite(new Date(issue.updated).getTime())) {
            fail('INVALID_ISSUE', 'Jira did not return the selected canonical issue.');
          }
          issueView = { key: issue.key, summary: issue.summary, issueUrl: `${origin}/browse/${encodeURIComponent(issue.key)}` };
          phase = 'source';
          result = statusFor(await checkAuthorizedIssue({
            actor: { accountId: actor.accountId, cloudId: actor.cloudId, issueId: String(issue.id) }, issue, origin
          }));
        } catch (error) {
          if (isConsentError(error)) { consentError = error; break; }
          result = { status: 'could_not_verify', reasonCode: failureReason(error, phase), reviewedVersion: null, currentVersion: null };
        }
        rows[index] = { inputKey, ...issueView, ...result, checkedAt: new Date(now()).toISOString() };
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, keys.length) }, worker));
    // Wait for the other in-flight worker before returning the original SDK
    // consent error. No worker starts another row once consent is required.
    if (consentError) throw consentError;
    return { project: { key: actor.projectKey }, rows };
  }
  return { checkSelectedIssues };
}

module.exports = { createQueue, MAX_SELECTED_ISSUES, CONCURRENCY };
