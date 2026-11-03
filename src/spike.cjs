const { createHash, randomUUID } = require('node:crypto');

const PREVIEW_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class SpikeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SpikeError';
    this.code = code;
  }
}

const fail = (code, message) => { throw new SpikeError(code, message); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function identity(context) {
  const issue = context?.extension?.issue;
  if (!context?.accountId || !context?.cloudId || !issue?.id || !/^\d+$/.test(String(issue.id))) {
    fail('INVALID_CONTEXT', 'Open Decision Drift from a Jira issue while signed in.');
  }
  return { accountId: context.accountId, cloudId: context.cloudId, issueId: String(issue.id) };
}

function siteOrigin(value) {
  let url;
  try { url = new URL(value); } catch { fail('INVALID_SITE', 'Jira did not return a valid site URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password) {
    fail('INVALID_SITE', 'This spike requires an HTTPS Atlassian Cloud site.');
  }
  return url.origin;
}

function parsePageInput(input, origin) {
  if (typeof input !== 'string' || input.length > 2048) {
    fail('INVALID_PAGE', 'Enter a Confluence page ID or a full page URL from this site.');
  }
  const value = input.trim();
  if (/^[1-9]\d*$/.test(value)) return value;
  let url;
  try { url = new URL(value); } catch { fail('INVALID_PAGE', 'Enter a numeric page ID or a full Confluence page URL.'); }
  if (url.origin !== origin || url.username || url.password) {
    fail('WRONG_SITE', 'The Confluence page must be on the same site as this Jira issue.');
  }
  const match = url.pathname.match(/^\/wiki\/(?:spaces\/[^/]+\/pages\/|pages\/)([1-9]\d*)(?:\/|$)/);
  const legacy = url.pathname === '/wiki/pages/viewpage.action' ? url.searchParams.get('pageId') : null;
  const id = match?.[1] || legacy;
  if (!id || !/^[1-9]\d*$/.test(id)) {
    fail('INVALID_PAGE', 'Use the full published page URL or its numeric page ID. Short share links are unsupported.');
  }
  return id;
}

function adfText(document) {
  let nodes = 0;
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string' ||
        (node.content !== undefined && !Array.isArray(node.content)) || depth > 40 || ++nodes > 20000) {
      fail('UNSUPPORTED_PAGE', 'This document is too complex to inspect completely. Use a smaller published text page.');
    }
    if (node.type === 'text') {
      if (typeof node.text !== 'string') fail('UNSUPPORTED_PAGE', 'This document contains malformed text and cannot be reviewed completely.');
      return node.text;
    }
    if (node.type === 'hardBreak') return '\n';
    const text = Array.isArray(node.content) ? node.content.map(child => walk(child, depth + 1)).join('') : '';
    if (['tableCell', 'tableHeader'].includes(node.type)) return `${text}\t`;
    return ['paragraph', 'heading', 'listItem', 'tableRow'].includes(node.type) ? `${text}\n` : text;
  };
  return walk(document).trim();
}

function sourceFromPage(page, origin, { expectedVersion } = {}) {
  const historical = expectedVersion !== undefined;
  if ((historical && (!Number.isInteger(expectedVersion) || expectedVersion < 1 || page.version?.number !== expectedVersion)) ||
      !(historical ? ['current', 'historical'] : ['current']).includes(page.status) || page.subtype === 'live') {
    fail('UNPUBLISHED_PAGE', historical ? 'The requested published source version is unavailable.' : 'Use a published Confluence page. Drafts and live docs cannot be reviewed.');
  }
  const value = page.body?.atlas_doc_format?.value;
  let document;
  try {
    if (typeof value !== 'string' || value.length > 500000) throw new Error('Unsupported body');
    document = JSON.parse(value);
    if (document?.type !== 'doc' || document.version !== 1 || !Array.isArray(document.content)) {
      throw new Error('Unsupported document');
    }
  } catch {
    fail('UNSUPPORTED_PAGE', 'This page did not provide a supported document body. Use a small published text page.');
  }
  const text = adfText(document);
  if (text.length > 16000) fail('UNSUPPORTED_PAGE', 'This page exceeds the 16,000-character review limit. Use a smaller decision page so its complete text can be reviewed.');
  const representedTypes = new Set(['doc', 'text', 'hardBreak', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'table', 'tableRow', 'tableCell', 'tableHeader', 'blockquote', 'codeBlock', 'rule', 'panel', 'expand', 'nestedExpand']);
  const hasUnrepresentedContent = node => !representedTypes.has(node.type) || Boolean(node.content?.some(hasUnrepresentedContent));
  return {
    id: String(page.id), title: page.title, version: page.version?.number,
    url: `${origin}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(page.id)}`,
    text, hash: digest(document), textHash: digest(text), hasUnrepresentedContent: hasUnrepresentedContent(document)
  };
}

async function inspectSnapshot(gateway, context, pageInput) {
  const actor = identity(context);
  const [site, issue] = await Promise.all([gateway.readSite(), gateway.readIssue(actor.issueId)]);
  const origin = siteOrigin(site);
  const sourceId = parsePageInput(pageInput, origin);
  const source = await gateway.readSource(sourceId, origin);
  if (String(issue.id) !== actor.issueId) fail('INVALID_CONTEXT', 'The returned issue does not match the open Jira issue.');
  if (String(source.id) !== sourceId) fail('INVALID_SOURCE', 'Confluence returned a different page.');
  if (!Number.isInteger(source.version) || source.version < 1) fail('INVALID_SOURCE', 'The page has no published version.');
  return { actor, issue, source, origin };
}

const publicView = ({ issue, source, origin }) => ({
  issue: { key: issue.key, summary: issue.summary, updated: issue.updated },
  source: { id: source.id, title: source.title, version: source.version, url: source.url, text: source.text, hasUnrepresentedContent: Boolean(source.hasUnrepresentedContent) },
  runtime: { siteUrl: origin, access: 'Current signed-in user', writeMode: 'Reviewed Jira comment' }
});

function makeComment(previewId, issueKey, source) {
  // Keep source quotations and restricted titles out of the broader Jira comment audience.
  const lines = [
    'Decision Drift — reviewed source reference',
    `I reviewed Confluence page ${source.id} at version ${source.version} from ${issueKey}.`,
    `Source: ${source.url}`,
    'This note records a reviewed source reference. The tracked review version is saved separately in Decision Drift.',
    `Review ID: ${previewId}`
  ];
  return {
    text: lines.join('\n\n'),
    body: {
      type: 'doc', version: 1,
      content: lines.map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] }))
    }
  };
}

function createSpike({ gateway, store, now = Date.now, newId = randomUUID }) {
  const inspect = (context, pageInput) => inspectSnapshot(gateway, context, pageInput);

  async function inspectSource(context, payload = {}) {
    return publicView(await inspect(context, payload.pageInput));
  }

  async function prepareUpdate(context, payload = {}) {
    const snapshot = await inspect(context, payload.pageInput);
    const previewId = newId();
    const comment = makeComment(previewId, snapshot.issue.key, snapshot.source);
    const expiresAt = now() + PREVIEW_MS;
    const preview = {
      ...snapshot.actor, previewId, expiresAt, origin: snapshot.origin,
      issueKey: snapshot.issue.key,
      issueHash: digest({ updated: snapshot.issue.updated, summary: snapshot.issue.summary, description: snapshot.issue.description }),
      sourceId: snapshot.source.id, sourceVersion: snapshot.source.version,
      sourceHash: snapshot.source.hash,
      commentText: comment.text, commentBody: comment.body
    };
    await store.put(`preview:${previewId}`, preview);
    return { ...publicView(snapshot), previewId, commentText: comment.text, expiresAt: new Date(expiresAt).toISOString() };
  }

  async function applyUpdate(context, payload = {}) {
    const actor = identity(context);
    if (payload.approved !== true) fail('APPROVAL_REQUIRED', 'Review the exact comment and explicitly approve it first.');
    if (typeof payload.previewId !== 'string' || !UUID.test(payload.previewId)) fail('INVALID_PREVIEW', 'Prepare a fresh review first.');
    const preview = await store.get(`preview:${payload.previewId}`);
    if (!preview) fail('INVALID_PREVIEW', 'The review no longer exists. Prepare a new one.');
    if (['accountId', 'cloudId', 'issueId'].some(key => actor[key] !== preview[key])) {
      fail('INVALID_PREVIEW', 'This review belongs to a different user, site, or issue.');
    }
    if (now() >= preview.expiresAt) fail('EXPIRED_PREVIEW', 'This review expired. Prepare and approve a new one.');

    // All display/read/write requests use asUser; no cached source is returned on approval.
    const [issue, source] = await Promise.all([
      gateway.readIssue(actor.issueId), gateway.readSource(preview.sourceId, preview.origin)
    ]);
    const operationKey = `operation:${payload.previewId}`;
    const existing = await store.get(operationKey);
    if (existing?.status === 'applied') return { ...existing.result, alreadyApplied: true };
    if (existing) fail('OUTCOME_UNKNOWN', 'This review has already started. Check Jira for its Review ID before preparing another comment. Automatic retries are blocked.');
    if (source.version !== preview.sourceVersion || source.hash !== preview.sourceHash ||
      digest({ updated: issue.updated, summary: issue.summary, description: issue.description }) !== preview.issueHash) {
      fail('STALE_PREVIEW', 'The source or issue changed after preview. Prepare and approve a new review.');
    }

    // Atomic insert, rather than get-then-set, prevents concurrent clicks posting twice.
    const claimed = await store.claim(operationKey, { status: 'started', previewId: preview.previewId });
    if (!claimed) fail('OUTCOME_UNKNOWN', 'This review is already being applied. Check Jira for its Review ID; do not create another comment.');
    let result;
    try {
      const comment = await gateway.postComment(actor.issueId, preview.commentBody, preview.previewId);
      if (!comment?.id || !/^\d+$/.test(String(comment.id))) throw new Error('Missing comment ID');
      result = {
        issueKey: preview.issueKey, commentId: String(comment.id),
        commentUrl: `${preview.origin}/browse/${encodeURIComponent(preview.issueKey)}?focusedCommentId=${encodeURIComponent(comment.id)}`,
        sourceVersion: preview.sourceVersion, alreadyApplied: false
      };
    } catch (error) {
      // Even a timeout can follow a successful POST. Never release/retry this operation.
      try { await store.put(operationKey, { status: 'unknown', previewId: preview.previewId }); } catch { /* original claim remains */ }
      fail('OUTCOME_UNKNOWN', `Jira did not confirm a completed write. Check the issue for Review ID ${preview.previewId} before starting another review. Automatic retries are blocked.`);
    }
    try {
      await store.put(operationKey, { status: 'applied', result });
    } catch {
      fail('OUTCOME_UNKNOWN', `Jira created comment ${result.commentId}, but saving its receipt failed. Check Jira; do not repeat this review.`);
    }
    return result;
  }

  return { inspectSource, prepareUpdate, applyUpdate };
}

module.exports = { createSpike, SpikeError, parsePageInput, siteOrigin, adfText, sourceFromPage, digest, PREVIEW_MS, UUID, identity, inspectSnapshot, publicView };
