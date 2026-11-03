import React, { useEffect, useRef, useState } from 'react';
import ForgeReconciler, {
  Box, Button, ButtonGroup, Checkbox, CodeBlock, Form, Heading, Inline,
  Label, Link, LoadingButton, Lozenge, SectionMessage, Stack, Strong, Text,
  Textfield, useForm,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const STATUS = {
  unreviewed: { label: 'Not reviewed', appearance: 'neutral', title: 'Give this work a reviewed source', description: 'Review this published page once. Future visits will compare it with the version you reviewed.' },
  unchanged: { label: 'Unchanged', appearance: 'success', title: 'Source unchanged since review', description: 'The source and work item match the saved review fingerprints. This records freshness, not requirements alignment.' },
  source_changed: { label: 'Needs review', appearance: 'warning', title: 'Source changed since review', description: 'The published source changed. Review what changed before saving a new reviewed version.' },
  version_changed: { label: 'New version', appearance: 'information', title: 'A new version has been published', description: 'The published version changed, while the document fingerprint stayed the same. Review it before advancing the saved version.' },
  issue_changed: { label: 'Needs review', appearance: 'warning', title: 'Work item changed since review', description: 'The source is unchanged, but the work item summary or description changed. Reconsider the source in this new context.' },
  both_changed: { label: 'Needs review', appearance: 'warning', title: 'Source and work item changed', description: 'Both sides changed since the saved review. Read the current decision in the context of the updated work item.' },
  different_source: { label: 'Different source', appearance: 'warning', title: 'You are reviewing a different source', description: 'Confirming this review will replace the issue’s currently tracked source. Until then, the existing review is preserved.' },
};

function readableError(error) {
  return typeof error?.message === 'string' ? error.message : 'The check could not be completed. Recheck the source before reviewing it.';
}

function displayTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unavailable';
}

function httpsLink(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}

function assertSnapshot(data) {
  if (typeof data?.issue?.key !== 'string' || typeof data.issue.summary !== 'string' ||
      typeof data.source?.title !== 'string' || typeof data.source.text !== 'string' || !Number.isInteger(data.source.version)) {
    throw new Error('The server returned an incomplete source check. Recheck the source.');
  }
}

function assertPreview(data, kind) {
  assertSnapshot(data);
  if (typeof data.previewId !== 'string' || !data.previewId || !Number.isFinite(new Date(data.expiresAt).getTime()) ||
      (kind === 'comment' && !data.commentText?.trim())) throw new Error('A complete review preview was not returned. Prepare a new review.');
}

function SourceText({ source }) {
  return (
    <Stack space="space.150">
      {source.hasUnrepresentedContent && (
        <SectionMessage appearance="warning" title="Review rich content in Confluence">
          <Text>This page includes content that is not represented in the text below. Its full document fingerprint is tracked; open the page to inspect diagrams, embeds or other rich content.</Text>
        </SectionMessage>
      )}
      <CodeBlock language="text" text={source.text || '(No readable text. Open the page to review its content.)'} shouldWrapLongLines showLineNumbers={false} />
    </Stack>
  );
}

function ChangeEvidence({ diff }) {
  if (!diff || diff.status === 'not_needed') return null;
  if (diff.status === 'unavailable') return (
    <SectionMessage appearance="warning" title="Earlier text is unavailable">
      <Text>The source change is detected, but the earlier version could not be verified with your current access. Review the published page directly; no cached historical content is shown.</Text>
    </SectionMessage>
  );
  const removed = diff.removed || [];
  const added = diff.added || [];
  return (
    <Stack space="space.150">
      <Heading as="h3" size="small">What changed in the text</Heading>
      {removed.length > 0 && <Box padding="space.150" backgroundColor="color.background.danger"><Stack space="space.100"><Text><Strong>Earlier version · removed</Strong></Text><CodeBlock language="text" text={removed.join('\n')} shouldWrapLongLines showLineNumbers={false} /></Stack></Box>}
      {added.length > 0 && <Box padding="space.150" backgroundColor="color.background.success"><Stack space="space.100"><Text><Strong>Current version · added</Strong></Text><CodeBlock language="text" text={added.join('\n')} shouldWrapLongLines showLineNumbers={false} /></Stack></Box>}
      {!removed.length && !added.length && <Text>No plain-text difference was found. Formatting, structure or rich content may have changed; open the page to review it.</Text>}
      {diff.limited && <Text>This is a bounded excerpt of the changes. Open the page history for the complete comparison.</Text>}
      <Text>Text changes identify what needs attention. They do not establish a conflict with the work item.</Text>
    </Stack>
  );
}

function DecisionSnapshot({ snapshot, showText, onToggleText }) {
  const { issue, source, tracking } = snapshot;
  const status = STATUS[tracking?.status];
  const sourceLink = httpsLink(source.url);
  if (!status) return <SectionMessage appearance="warning" title="Review state unavailable"><Text>Recheck this source to load its saved review state.</Text></SectionMessage>;
  return (
    <Stack space="space.200">
      <Box padding="space.200" backgroundColor="color.background.neutral">
        <Stack space="space.150">
          <Lozenge appearance={status.appearance}>{status.label}</Lozenge>
          <Heading as="h3" size="small">{status.title}</Heading>
          <Text>{status.description}</Text>
          <Inline space="space.300" shouldWrap>
            <Stack space="space.050"><Text>Reviewed version</Text><Text><Strong>{tracking.baseline ? `v${tracking.baseline.sourceVersion}` : 'Not set'}</Strong></Text></Stack>
            <Stack space="space.050"><Text>Published version</Text><Text><Strong>{`v${source.version}`}</Strong></Text></Stack>
          </Inline>
          {tracking.baseline && <Text>Last reviewed {displayTime(tracking.baseline.reviewedAt)}{tracking.status === 'different_source' ? ` · Previously tracked page ${tracking.baseline.sourceId}` : ''}</Text>}
        </Stack>
      </Box>
      <Stack space="space.100">
        <Text><Strong>{issue.key}</Strong> · {issue.summary}</Text>
        <Text>{source.title} · Page {source.id}</Text>
        <Inline space="space.200" shouldWrap>
          {sourceLink && <Link href={sourceLink} openNewTab>Open Confluence source</Link>}
          <Button appearance="subtle" onClick={onToggleText}>{showText ? 'Hide current text' : 'Read current text'}</Button>
        </Inline>
      </Stack>
      <ChangeEvidence diff={tracking.diff} />
      {showText && <SourceText source={source} />}
    </Stack>
  );
}

export function App() {
  const [pageInput, setPageInput] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [preview, setPreview] = useState(null);
  const [approved, setApproved] = useState(false);
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState('loadTrackedSource');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [showText, setShowText] = useState(false);
  const requestSequence = useRef(0);
  const inFlight = useRef(false);
  const { register, getFieldId, handleSubmit } = useForm();
  const pageField = register('pageInput');
  const busy = pending !== null;

  useEffect(() => {
    void readSource('loadTrackedSource');
    return () => { requestSequence.current += 1; };
  }, []);

  useEffect(() => {
    setExpired(false);
    if (!preview) return undefined;
    const remaining = new Date(preview.data.expiresAt).getTime() - Date.now();
    if (remaining <= 0) { setExpired(true); setApproved(false); return undefined; }
    const timer = setTimeout(() => { setExpired(true); setApproved(false); }, Math.min(remaining, 2147483647));
    return () => clearTimeout(timer);
  }, [preview]);

  function changePage(event) {
    pageField.onChange(event);
    requestSequence.current += 1;
    inFlight.current = false;
    setPageInput(event.target.value);
    setSnapshot(null); setPreview(null); setApproved(false); setExpired(false);
    setError(null); setNotice(null); setShowText(false); setPending(null);
  }

  async function readSource(name) {
    if (inFlight.current) return;
    if (name !== 'loadTrackedSource' && !pageInput.trim()) { setError('Enter a Confluence page URL or page ID.'); return; }
    const sequence = ++requestSequence.current;
    inFlight.current = true;
    setPending(name); setError(null); setNotice(null); setSnapshot(null);
    setPreview(null); setApproved(false); setShowText(false);
    try {
      const data = await invoke(name, name === 'loadTrackedSource' ? {} : { pageInput: pageInput.trim() });
      if (sequence !== requestSequence.current) return;
      if (name === 'loadTrackedSource' && data?.tracked === false) return;
      assertSnapshot(data);
      if (name === 'loadTrackedSource') { setPageInput(data.source.id); pageField.onChange({ target: { type: 'text', value: data.source.id } }); }
      if (name === 'prepareBaseline' || name === 'prepareUpdate') {
        const kind = name === 'prepareBaseline' ? 'baseline' : 'comment';
        assertPreview(data, kind);
        setPreview({ kind, data });
        if (kind === 'baseline') setSnapshot(data);
      } else setSnapshot(data);
    } catch (failure) {
      if (sequence === requestSequence.current) setError(readableError(failure));
    } finally {
      if (sequence === requestSequence.current) { inFlight.current = false; setPending(null); }
    }
  }

  async function confirmReview() {
    if (inFlight.current || !preview || !approved) return;
    if (new Date(preview.data.expiresAt).getTime() <= Date.now()) { setExpired(true); setApproved(false); return; }
    const sequence = ++requestSequence.current;
    const kind = preview.kind;
    inFlight.current = true;
    setPending(kind === 'baseline' ? 'confirmBaseline' : 'applyUpdate');
    setError(null); setSnapshot(null);
    try {
      const data = await invoke(kind === 'baseline' ? 'confirmBaseline' : 'applyUpdate', { previewId: preview.data.previewId, approved: true });
      if (sequence !== requestSequence.current) return;
      if (kind === 'baseline') {
        assertSnapshot(data);
        const baseline = data.tracking?.baseline;
        if (!baseline || !Number.isInteger(baseline.sourceVersion) || typeof baseline.sourceId !== 'string') {
          throw new Error('The saved review was not confirmed. Reload the tracked source to verify its reviewed version.');
        }
        setSnapshot(data);
        setNotice({ title: data.alreadyReviewed ? 'Review already saved' : 'Reviewed version saved', text: `Page ${baseline.sourceId} at version ${baseline.sourceVersion} is the saved comparison point for ${data.issue.key}. No Jira comment was posted.` });
      } else {
        if (!data?.commentId || typeof data.issueKey !== 'string') throw new Error('Jira did not confirm the comment. Check the issue before preparing another note.');
        setNotice({ title: 'Jira note added', text: `Comment ${data.commentId} on ${data.issueKey} references source version ${data.sourceVersion}.`, url: httpsLink(data.commentUrl) });
      }
      setPreview(null); setApproved(false);
    } catch (failure) {
      if (sequence === requestSequence.current) {
        setError(readableError(failure));
        // Never leave previously authorized source content visible after a failed permission recheck.
        setPreview(null); setApproved(false);
      }
    } finally {
      if (sequence === requestSequence.current) { inFlight.current = false; setPending(null); }
    }
  }

  return (
    <Stack space="space.250">
      <Stack space="space.100">
        <Heading as="h2" size="medium">Decision Drift</Heading>
        <Text>Keep the decision behind this work in view.</Text>
      </Stack>
      <Form onSubmit={handleSubmit(() => readSource('inspectDecisionSource'))}>
        <Stack space="space.100">
          <Label labelFor={getFieldId('pageInput')}>Confluence decision source</Label>
          <Textfield {...pageField} id={getFieldId('pageInput')} value={pageInput} onChange={changePage} isDisabled={busy} placeholder="Paste a page URL or numeric page ID" />
          <ButtonGroup>
            <LoadingButton type="submit" isLoading={pending === 'inspectDecisionSource'} isDisabled={busy || !pageInput.trim()}>{snapshot ? 'Recheck source' : 'Check source'}</LoadingButton>
            <LoadingButton type="button" onClick={() => readSource('loadTrackedSource')} isLoading={pending === 'loadTrackedSource'} isDisabled={busy}>Load tracked source</LoadingButton>
          </ButtonGroup>
        </Stack>
      </Form>
      {pending === 'loadTrackedSource' && <Text>Checking the source tracked for this issue…</Text>}
      {error && <SectionMessage appearance="error" title="Review could not be completed"><Text>{error}</Text><Text>Reload the tracked source to verify its current review state. If a Jira note was being added, inspect the issue for its review ID before preparing another note.</Text></SectionMessage>}
      {notice && <SectionMessage appearance="success" title={notice.title}><Text>{notice.text}</Text>{notice.url && <Text><Link href={notice.url} openNewTab>Open Jira comment</Link></Text>}</SectionMessage>}
      {!busy && !error && !snapshot && !preview && !notice && (
        <Box padding="space.200" backgroundColor="color.background.discovery">
          <Stack space="space.150"><Heading as="h3" size="small">A decision worth keeping in view</Heading><Text>Link the Confluence page behind this work item. Review its published version once, then return here to see what changed.</Text><Text>Your team shares one reviewed source per issue. Every check uses your current access.</Text></Stack>
        </Box>
      )}
      {snapshot && <DecisionSnapshot snapshot={snapshot} showText={showText} onToggleText={() => setShowText(value => !value)} />}
      {snapshot && !preview && (
        <Stack space="space.100">
          <ButtonGroup>
            <LoadingButton appearance="primary" onClick={() => readSource('prepareBaseline')} isLoading={pending === 'prepareBaseline'} isDisabled={busy || snapshot.tracking?.status === 'unchanged'}>{snapshot.tracking?.status === 'unchanged' ? 'Current version reviewed' : 'Review current version'}</LoadingButton>
            <LoadingButton onClick={() => readSource('prepareUpdate')} isLoading={pending === 'prepareUpdate'} isDisabled={busy}>Preview source-link note</LoadingButton>
          </ButtonGroup>
          <Text>Saving a reviewed version tracks this source in the app. A Jira note is optional and reviewed separately.</Text>
        </Stack>
      )}
      {preview && (
        <Box padding="space.200" backgroundColor="color.background.discovery">
          <Stack space="space.150">
            <Lozenge appearance="discovery">Your review</Lozenge>
            <Heading as="h3" size="small">{preview.kind === 'baseline' ? `Review version ${preview.data.source.version}` : 'Proposed Jira note'}</Heading>
            <Text>{preview.data.issue.key} · Page {preview.data.source.id} · Published version {preview.data.source.version}</Text>
            {preview.kind === 'baseline' ? <><SourceText source={preview.data.source} /><Text>Saving this review makes the displayed version the team’s new comparison point for this issue. It does not modify the Jira issue or publish source content.</Text></> : <CodeBlock language="text" text={preview.data.commentText} shouldWrapLongLines showLineNumbers={false} />}
            <Text>Review expires {displayTime(preview.data.expiresAt)}</Text>
            {expired && <SectionMessage appearance="warning" title="Review expired"><Text>Recheck and prepare a new review of the latest published version.</Text></SectionMessage>}
            <Checkbox label={preview.kind === 'baseline' ? `I reviewed page ${preview.data.source.id} at version ${preview.data.source.version} for ${preview.data.issue.key}.` : `I reviewed this exact note and approve adding it to ${preview.data.issue.key}.`} isChecked={approved} isDisabled={busy || expired} onChange={event => setApproved(Boolean(event.target?.checked))} />
            <LoadingButton appearance="primary" onClick={confirmReview} isLoading={pending === 'confirmBaseline' || pending === 'applyUpdate'} isDisabled={busy || !approved || expired}>{preview.kind === 'baseline' ? 'Save reviewed version' : 'Add reviewed Jira note'}</LoadingButton>
            <Button appearance="subtle" isDisabled={busy} onClick={() => { setPreview(null); setApproved(false); }}>Cancel review</Button>
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

ForgeReconciler.render(<App />);
