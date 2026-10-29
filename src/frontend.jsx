import React, { useEffect, useRef, useState } from 'react';
import ForgeReconciler, {
  ButtonGroup,
  Checkbox,
  CodeBlock,
  Form,
  Heading,
  Label,
  Link,
  LoadingButton,
  SectionMessage,
  Stack,
  Text,
  Textfield,
  useForm,
} from '@forge/react';
import { invoke } from '@forge/bridge';

function readableError(error) {
  return typeof error?.message === 'string'
    ? error.message
    : 'The request could not be completed. Try checking access again.';
}

function displayTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unavailable';
}

function httpsLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function assertSnapshot(data) {
  if (
    !data ||
    typeof data.issue?.key !== 'string' ||
    typeof data.issue?.summary !== 'string' ||
    typeof data.source?.title !== 'string' ||
    typeof data.source?.text !== 'string' ||
    !Number.isInteger(data.source?.version)
  ) {
    throw new Error('The server returned an incomplete source snapshot. Check access again.');
  }
}

function Snapshot({ issue, source }) {
  const sourceLink = httpsLink(source.url);

  return (
    <Stack space="space.150">
      <Heading as="h3" size="small">Current Jira work item</Heading>
      <Text>{issue.key}: {issue.summary}</Text>
      <Text>Last updated: {displayTime(issue.updated)}</Text>
      <Heading as="h3" size="small">Current Confluence source</Heading>
      <Text>{source.title} · Version {source.version} · Page {source.id}</Text>
      {sourceLink && <Link href={sourceLink} openNewTab>Open source page</Link>}
      <CodeBlock
        language="text"
        text={source.text || '(This page has no readable text.)'}
        shouldWrapLongLines
        showLineNumbers={false}
      />
    </Stack>
  );
}

export function App() {
  const [pageInput, setPageInput] = useState('');
  const [inspection, setInspection] = useState(null);
  const [preview, setPreview] = useState(null);
  const [approved, setApproved] = useState(false);
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [applied, setApplied] = useState(null);
  const requestSequence = useRef(0);
  const inFlight = useRef(false);
  const { register, getFieldId, handleSubmit } = useForm();
  const pageField = register('pageInput');
  const busy = pending !== null;
  const snapshot = preview || inspection;

  useEffect(() => () => {
    requestSequence.current += 1;
  }, []);

  useEffect(() => {
    setExpired(false);
    if (!preview) return undefined;

    const remaining = new Date(preview.expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      setExpired(true);
      setApproved(false);
      return undefined;
    }

    const timer = setTimeout(() => {
      setExpired(true);
      setApproved(false);
    }, Math.min(remaining, 2147483647));
    return () => clearTimeout(timer);
  }, [preview]);

  function changePage(event) {
    const value = event.target.value;
    pageField.onChange(event);
    requestSequence.current += 1;
    inFlight.current = false;
    setPageInput(value);
    setInspection(null);
    setPreview(null);
    setApproved(false);
    setExpired(false);
    setApplied(null);
    setError(null);
    setPending(null);
  }

  async function readSource(resolverName) {
    if (inFlight.current) return;
    if (!pageInput.trim()) {
      setError('Enter a Confluence page URL or page ID.');
      return;
    }

    const sequence = ++requestSequence.current;
    inFlight.current = true;
    setPending(resolverName);
    setError(null);
    setApplied(null);
    setPreview(null);
    setApproved(false);
    if (resolverName === 'inspectSource') setInspection(null);

    try {
      // The resolver derives the work item and permissions from trusted context.
      const data = await invoke(resolverName, { pageInput: pageInput.trim() });
      if (sequence !== requestSequence.current) return;
      assertSnapshot(data);

      if (resolverName === 'prepareUpdate') {
        if (
          typeof data.previewId !== 'string' ||
          !data.previewId ||
          typeof data.commentText !== 'string' ||
          !data.commentText.trim() ||
          !Number.isFinite(new Date(data.expiresAt).getTime())
        ) {
          throw new Error('The server did not return a valid preview. Prepare a new preview.');
        }
        setPreview(data);
      } else {
        setInspection(data);
      }
    } catch (failure) {
      if (sequence === requestSequence.current) setError(readableError(failure));
    } finally {
      if (sequence === requestSequence.current) {
        inFlight.current = false;
        setPending(null);
      }
    }
  }

  async function applyReviewedUpdate() {
    if (inFlight.current || !preview || !approved || applied) return;
    if (new Date(preview.expiresAt).getTime() <= Date.now()) {
      setExpired(true);
      setApproved(false);
      setError('This preview has expired. Prepare and review a new preview.');
      return;
    }

    const sequence = ++requestSequence.current;
    inFlight.current = true;
    setPending('applyUpdate');
    setError(null);
    try {
      const result = await invoke('applyUpdate', {
        previewId: preview.previewId,
        approved: true,
      });
      if (sequence !== requestSequence.current) return;
      if (typeof result?.issueKey !== 'string' || !result.commentId) {
        throw new Error('The server did not confirm the comment. Check the work item before retrying this preview.');
      }
      setApplied(result);
      setApproved(false);
    } catch (failure) {
      if (sequence === requestSequence.current) setError(readableError(failure));
    } finally {
      if (sequence === requestSequence.current) {
        inFlight.current = false;
        setPending(null);
      }
    }
  }

  return (
    <Stack space="space.250">
      <Heading as="h2" size="medium">Review a decision source</Heading>
      <Text>Check a Confluence page against this Jira work item, then review the exact comment before adding it.</Text>

      <Form onSubmit={handleSubmit(() => readSource('inspectSource'))}>
        <Stack space="space.150">
          <Label labelFor={getFieldId('pageInput')}>Confluence page URL or ID</Label>
          <Textfield
            {...pageField}
            id={getFieldId('pageInput')}
            value={pageInput}
            onChange={changePage}
            isDisabled={pending === 'applyUpdate'}
            placeholder="Paste a page URL or numeric page ID"
          />
          <Text>Use a page you can access on this Atlassian site.</Text>
          <ButtonGroup>
            <LoadingButton
              type="submit"
              isLoading={pending === 'inspectSource'}
              isDisabled={busy || !pageInput.trim()}
            >Check access</LoadingButton>
            <LoadingButton
              type="button"
              onClick={() => readSource('prepareUpdate')}
              isLoading={pending === 'prepareUpdate'}
              isDisabled={busy || !inspection}
              appearance="primary"
            >Preview reviewed update</LoadingButton>
          </ButtonGroup>
        </Stack>
      </Form>

      {error && (
        <SectionMessage appearance="error" title="Unable to complete this step">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {snapshot && <Snapshot issue={snapshot.issue} source={snapshot.source} />}

      {inspection && !preview && !busy && !error && (
        <SectionMessage appearance="success" title="Access checked">
          <Text>The current work item and source are available. Prepare a preview to review the proposed comment.</Text>
        </SectionMessage>
      )}

      {preview && (
        <Stack space="space.150">
          <Heading as="h3" size="small">Proposed Jira comment</Heading>
          <CodeBlock
            language="text"
            text={preview.commentText}
            shouldWrapLongLines
            showLineNumbers={false}
          />
          <Text>Preview expires: {displayTime(preview.expiresAt)}</Text>
          {expired && !applied && (
            <SectionMessage appearance="warning" title="Preview expired">
              <Text>Prepare a new preview to check the latest source and work item.</Text>
            </SectionMessage>
          )}
          <Checkbox
            label={`I reviewed this exact comment and approve adding it to ${preview.issue.key}.`}
            isChecked={approved}
            isDisabled={busy || expired || Boolean(applied)}
            onChange={(event) => setApproved(Boolean(event.target?.checked))}
          />
          <LoadingButton
            appearance="primary"
            onClick={applyReviewedUpdate}
            isLoading={pending === 'applyUpdate'}
            isDisabled={busy || !approved || expired || Boolean(applied)}
          >Apply reviewed update</LoadingButton>
        </Stack>
      )}

      {applied && (
        <SectionMessage
          appearance="success"
          title={applied.alreadyApplied ? 'Reviewed update already added' : 'Reviewed update added'}
        >
          <Text>Comment {applied.commentId} on {applied.issueKey} references source version {applied.sourceVersion}.</Text>
          {httpsLink(applied.commentUrl) && (
            <Text><Link href={httpsLink(applied.commentUrl)} openNewTab>Open Jira comment</Link></Text>
          )}
        </SectionMessage>
      )}
    </Stack>
  );
}

ForgeReconciler.render(<App />);
