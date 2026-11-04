const { randomUUID } = require('node:crypto');
const {
  SpikeError, identity, inspectSnapshot, publicView, siteOrigin, digest, PREVIEW_MS, UUID, issueEvidenceText
} = require('./spike.cjs');
const { validateFocus, sameFocus, prepareFocus, trackFocus, unavailableFocus, MAX_TEXT_LENGTH } = require('./passage.cjs');

const MAX_DIFF_LINES = 200;
const MAX_DIFF_CHANGES = 24;
const MAX_REVISION = 2147483647;
const fail = (code, message) => { throw new SpikeError(code, message); };
const baselineKey = actor => `baseline:${digest({ cloudId: actor.cloudId, issueId: actor.issueId })}`;
const issueContentHash = issue => digest({ summary: issue.summary, description: issue.description });
const issueReviewHash = issue => digest({ updated: issue.updated, summary: issue.summary, description: issue.description });
const noDiff = (status = 'not_needed', limited = false) => ({ status, added: [], removed: [], limited });

function validateBaseline(baseline) {
  if (baseline === undefined || baseline === null) return null;
  if (!Number.isInteger(baseline.revision) || baseline.revision < 1 || baseline.revision > MAX_REVISION ||
      typeof baseline.sourceId !== 'string' || !/^[1-9]\d*$/.test(baseline.sourceId) ||
      !Number.isInteger(baseline.sourceVersion) || baseline.sourceVersion < 1 ||
      ['sourceHash', 'textHash', 'issueHash'].some(key => !/^[0-9a-f]{64}$/.test(baseline[key])) ||
      !Number.isFinite(new Date(baseline.reviewedAt).getTime()) || !UUID.test(baseline.reviewId)) {
    fail('INVALID_BASELINE', 'The saved baseline could not be verified. No review was changed.');
  }
  if (baseline.focus !== undefined) validateFocus(baseline.focus);
  return baseline;
}

// Exact ordered text differences, not a semantic requirements assessment.
function lineDiff(before, after) {
  const oldLines = before.split('\n').filter(line => line.length > 0);
  const newLines = after.split('\n').filter(line => line.length > 0);
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) return noDiff('unavailable', true);
  const width = newLines.length + 1;
  const lengths = new Uint16Array((oldLines.length + 1) * width);
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      lengths[i * width + j] = oldLines[i] === newLines[j]
        ? lengths[(i + 1) * width + j + 1] + 1
        : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }
  const added = [];
  const removed = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) { i += 1; j += 1; }
    else if (j < newLines.length && (i === oldLines.length || lengths[i * width + j + 1] >= lengths[(i + 1) * width + j])) {
      added.push(newLines[j++]);
    } else removed.push(oldLines[i++]);
  }
  return {
    status: 'available', added: added.slice(0, MAX_DIFF_CHANGES), removed: removed.slice(0, MAX_DIFF_CHANGES),
    limited: added.length > MAX_DIFF_CHANGES || removed.length > MAX_DIFF_CHANGES
  };
}

function sameReview(baseline, snapshot, focus) {
  return baseline && baseline.sourceId === snapshot.source.id && baseline.sourceVersion === snapshot.source.version &&
    baseline.sourceHash === snapshot.source.hash && baseline.textHash === snapshot.source.textHash &&
    baseline.issueHash === issueContentHash(snapshot.issue) && sameFocus(baseline.focus, focus);
}

function createTrackingReader({ gateway, baselineStore }) {
  const getBaseline = async actor => validateBaseline(await baselineStore.get(baselineKey(actor)));

  async function trackingFor(snapshot, baseline) {
    if (!baseline) return { status: 'unreviewed', baseline: null, sourceChanged: false, issueChanged: false, diff: noDiff(), focus: null };
    const publicBaseline = {
      revision: baseline.revision, sourceId: baseline.sourceId,
      sourceVersion: baseline.sourceVersion, reviewedAt: baseline.reviewedAt
    };
    const differentSource = baseline.sourceId !== snapshot.source.id;
    const sourceChanged = baseline.sourceHash !== snapshot.source.hash;
    const issueChanged = baseline.issueHash !== issueContentHash(snapshot.issue);
    const versionChanged = baseline.sourceVersion !== snapshot.source.version;
    let status = differentSource ? 'different_source' : sourceChanged && issueChanged ? 'both_changed'
      : sourceChanged ? 'source_changed' : issueChanged ? 'issue_changed' : versionChanged ? 'version_changed' : 'unchanged';
    let previousResult;
    async function previousSource() {
      if (previousResult) return previousResult;
      const validText = source => typeof source.text === 'string' && source.text.length <= MAX_TEXT_LENGTH &&
        !source.hasUnrepresentedContent && digest(source.text) === baseline.textHash;
      if (snapshot.source.hasUnrepresentedContent) return (previousResult = { source: null, limited: true });
      // Matching raw bodies need no historical call, even if only the page version changed.
      if (!sourceChanged) {
        const valid = snapshot.source.textHash === baseline.textHash && validText(snapshot.source);
        return (previousResult = { source: valid ? snapshot.source : null, limited: !valid });
      }
      try {
        const previous = await gateway.readSourceVersion(baseline.sourceId, snapshot.origin, baseline.sourceVersion);
        if (previous.id !== baseline.sourceId || previous.version !== baseline.sourceVersion ||
            previous.hash !== baseline.sourceHash || previous.textHash !== baseline.textHash ||
            !validText(previous)) return (previousResult = { source: null, limited: true });
        return (previousResult = { source: previous, limited: false });
      } catch (error) {
        if (!(error instanceof SpikeError) || !['ACCESS_DENIED', 'UNPUBLISHED_PAGE', 'UNSUPPORTED_PAGE', 'INVALID_SOURCE'].includes(error.code)) throw error;
        // Consent and unknown SDK errors propagate; denied history never becomes cached evidence.
        return (previousResult = { source: null, limited: false });
      }
    }
    let diff = noDiff();
    if (sourceChanged && !differentSource) {
      const previous = await previousSource();
      diff = previous.source ? lineDiff(previous.source.text, snapshot.source.text) : noDiff('unavailable', previous.limited);
    }
    let focus = null;
    if (baseline.focus && !differentSource) {
      let issueText;
      try { issueText = issueEvidenceText(snapshot.issue); }
      catch (error) {
        if (!(error instanceof SpikeError) || error.code !== 'UNSUPPORTED_ISSUE') throw error;
      }
      const previous = await previousSource();
      focus = typeof issueText === 'string'
        ? trackFocus(baseline.focus, previous.source, snapshot.source, issueText) : unavailableFocus();
      status = focus.status === 'unavailable' ? 'focus_unavailable' : focus.status === 'ambiguous' ? 'focus_ambiguous'
        : focus.status !== 'unchanged' ? 'focus_changed'
          : sourceChanged || issueChanged || versionChanged ? 'outside_scope' : 'unchanged';
    }
    return { status, baseline: publicBaseline, sourceChanged, issueChanged, diff, focus };
  }

  return { getBaseline, trackingFor };
}

// Server-only adapter for callers that have already read the issue as the
// current user. It is deliberately separate from the issue-panel resolvers.
function createAuthorizedTracker({ gateway, baselineStore }) {
  const { getBaseline, trackingFor } = createTrackingReader({ gateway, baselineStore });
  return async function checkAuthorizedIssue({ actor, issue, origin }) {
    const verifiedActor = identity({ ...actor, extension: { issue: { id: actor?.issueId } } });
    if (String(issue?.id) !== verifiedActor.issueId) fail('INVALID_CONTEXT', 'The authorized issue could not be verified.');
    const verifiedOrigin = siteOrigin(origin);
    const baseline = await getBaseline(verifiedActor);
    if (!baseline) return { tracked: false };
    const source = await gateway.readSource(baseline.sourceId, verifiedOrigin);
    if (source?.id !== baseline.sourceId || !Number.isInteger(source.version) || source.version < 1) {
      fail('INVALID_SOURCE', 'The linked published source could not be verified.');
    }
    if (source.version < baseline.sourceVersion) fail('SOURCE_REGRESSION', 'The linked source returned an earlier version than the reviewed comparison point.');
    const tracking = await trackingFor({ actor: verifiedActor, issue, source, origin: verifiedOrigin }, baseline);
    return { tracked: true, tracking, sourceVersion: source.version };
  };
}

function createDrift({ gateway, store, baselineStore, now = Date.now, newId = randomUUID }) {
  const { getBaseline, trackingFor } = createTrackingReader({ gateway, baselineStore });

  async function view(snapshot, baseline) {
    const result = publicView(snapshot);
    return {
      ...result,
      runtime: { ...result.runtime, writeMode: 'Reviewed source baseline' },
      tracking: await trackingFor(snapshot, baseline)
    };
  }

  async function loadTrackedSource(context) {
    const actor = identity(context);
    const issue = await gateway.readIssue(actor.issueId);
    if (String(issue.id) !== actor.issueId) fail('INVALID_CONTEXT', 'The returned issue does not match the open Jira issue.');
    const baseline = await getBaseline(actor);
    if (!baseline) return { tracked: false };
    const snapshot = await inspectSnapshot(gateway, context, baseline.sourceId);
    return { tracked: true, ...await view(snapshot, baseline) };
  }

  async function inspectDecisionSource(context, payload = {}) {
    const snapshot = await inspectSnapshot(gateway, context, payload.pageInput);
    return view(snapshot, await getBaseline(snapshot.actor));
  }

  async function prepareBaseline(context, payload = {}) {
    const snapshot = await inspectSnapshot(gateway, context, payload.pageInput);
    const baseline = await getBaseline(snapshot.actor);
    if (payload.mode === undefined && baseline?.focus) {
      fail('FOCUS_REVIEW_REQUIRED', 'This baseline links specific passages. Choose passage or whole-page tracking explicitly before reviewing.');
    }
    const mode = payload.mode === undefined ? 'page' : payload.mode;
    if (!['page', 'passage'].includes(mode)) fail('INVALID_MODE', 'Choose whole-page tracking or a specific passage link.');
    const prepared = mode === 'passage'
      ? prepareFocus(snapshot.source, issueEvidenceText(snapshot.issue), payload.sourceQuote, payload.requirementQuote)
      : { focus: undefined, reviewScope: { mode: 'page', sourceQuote: null, requirementQuote: null } };
    const previewId = newId();
    const expiresAt = now() + PREVIEW_MS;
    const result = await view(snapshot, baseline);
    await store.put(`baseline-preview:${previewId}`, {
      kind: 'baseline-review', ...snapshot.actor, previewId, expiresAt,
      expectedRevision: baseline?.revision ?? 0,
      sourceId: snapshot.source.id, sourceVersion: snapshot.source.version,
      sourceHash: snapshot.source.hash, textHash: snapshot.source.textHash,
      issueHash: issueContentHash(snapshot.issue), issueReviewHash: issueReviewHash(snapshot.issue), mode,
      ...(prepared.focus ? { focus: prepared.focus } : {})
    });
    return { ...result, previewId, expiresAt: new Date(expiresAt).toISOString(), reviewScope: prepared.reviewScope };
  }

  async function confirmBaseline(context, payload = {}) {
    const actor = identity(context);
    if (payload.approved !== true) fail('APPROVAL_REQUIRED', 'Review the source and explicitly approve saving this baseline.');
    if (typeof payload.previewId !== 'string' || !UUID.test(payload.previewId)) fail('INVALID_PREVIEW', 'Prepare a fresh baseline review first.');
    const preview = await store.get(`baseline-preview:${payload.previewId}`);
    if (!preview || preview.kind !== 'baseline-review' || preview.previewId !== payload.previewId ||
        ['accountId', 'cloudId', 'issueId'].some(key => actor[key] !== preview[key])) {
      fail('INVALID_PREVIEW', 'This baseline review no longer exists or belongs to a different user, site, or issue.');
    }

    // Fresh current-user product reads precede both writes and idempotent receipt returns.
    const snapshot = await inspectSnapshot(gateway, context, preview.sourceId);
    const baseline = await getBaseline(actor);
    if (preview.mode !== undefined && !['page', 'passage'].includes(preview.mode)) fail('INVALID_PREVIEW', 'Prepare a fresh review with an explicit tracking scope.');
    if (preview.mode === 'passage') validateFocus(preview.focus, 'INVALID_PREVIEW');
    else if (preview.focus !== undefined) fail('INVALID_PREVIEW', 'The review scope could not be verified. Prepare a fresh review.');
    if (baseline?.sourceId === snapshot.source.id && baseline.sourceVersion > snapshot.source.version) {
      fail('SOURCE_REGRESSION', 'A newer source version has already been reviewed. Refresh the source.');
    }
    if (baseline?.reviewId === preview.previewId) {
      if (baseline.sourceId !== preview.sourceId || baseline.sourceVersion !== preview.sourceVersion ||
          !sameFocus(baseline.focus, preview.focus)) fail('INVALID_PREVIEW', 'The saved receipt does not match this review.');
      return { ...await view(snapshot, baseline), alreadyReviewed: true };
    }
    if (now() >= preview.expiresAt) fail('EXPIRED_PREVIEW', 'This review expired. Prepare and approve a new baseline.');
    if (snapshot.source.version !== preview.sourceVersion || snapshot.source.hash !== preview.sourceHash ||
        snapshot.source.textHash !== preview.textHash || issueReviewHash(snapshot.issue) !== preview.issueReviewHash) {
      fail('STALE_PREVIEW', 'The source or Jira work item changed after preview. Prepare a new baseline review.');
    }
    if (preview.mode === undefined && baseline?.focus) fail('FOCUS_REVIEW_REQUIRED', 'The tracking scope changed. Prepare a fresh review and choose its scope explicitly.');
    if (preview.focus) {
      // Rebuild from the fresh exact bodies, never from apply-time client quotes.
      const issueText = issueEvidenceText(snapshot.issue);
      const sourceQuote = snapshot.source.text.slice(preview.focus.sourceStart, preview.focus.sourceStart + preview.focus.sourceLength);
      const requirementQuote = issueText.slice(preview.focus.requirementStart, preview.focus.requirementStart + preview.focus.requirementLength);
      const verified = prepareFocus(snapshot.source, issueText, sourceQuote, requirementQuote).focus;
      if (!sameFocus(verified, preview.focus)) fail('INVALID_PREVIEW', 'The passage review could not be verified. Prepare a fresh review.');
    }
    if (sameReview(baseline, snapshot, preview.focus)) return { ...await view(snapshot, baseline), alreadyReviewed: true };
    if ((baseline?.revision ?? 0) !== preview.expectedRevision) {
      fail('BASELINE_CONFLICT', 'Another reviewer changed the baseline. Refresh and review the latest state.');
    }
    if (preview.expectedRevision >= MAX_REVISION) fail('BASELINE_LIMIT', 'This baseline cannot accept another revision.');
    const next = {
      revision: preview.expectedRevision + 1,
      sourceId: snapshot.source.id, sourceVersion: snapshot.source.version,
      sourceHash: snapshot.source.hash, textHash: snapshot.source.textHash,
      issueHash: issueContentHash(snapshot.issue), reviewedAt: new Date(now()).toISOString(),
      reviewerAccountId: actor.accountId, reviewId: preview.previewId,
      ...(preview.focus ? { focus: preview.focus } : {})
    };
    let saved;
    try {
      saved = await baselineStore.compareAndSet(baselineKey(actor), preview.expectedRevision, next);
    } catch (error) {
      const recorded = await getBaseline(actor);
      if (recorded?.reviewId === preview.previewId) return { ...await view(snapshot, recorded), alreadyReviewed: true };
      throw error;
    }
    if (!saved) {
      const latest = await getBaseline(actor);
      if (latest?.reviewId === preview.previewId || sameReview(latest, snapshot, preview.focus)) {
        return { ...await view(snapshot, latest), alreadyReviewed: true };
      }
      fail('BASELINE_CONFLICT', 'Another reviewer changed the baseline. Refresh and review the latest state.');
    }
    return { ...await view(snapshot, next), alreadyReviewed: false };
  }

  return { loadTrackedSource, inspectDecisionSource, prepareBaseline, confirmBaseline };
}

module.exports = { createDrift, createAuthorizedTracker, baselineKey, issueContentHash, lineDiff, MAX_DIFF_LINES, MAX_DIFF_CHANGES };
