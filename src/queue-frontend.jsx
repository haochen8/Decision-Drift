import React, { useEffect, useRef, useState } from 'react';
import ForgeReconciler, {
  Box, DynamicTable, Heading, Inline, Label, Link, LoadingButton, Lozenge,
  SectionMessage, Stack, Strong, Text, TextArea,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import selection from './queue-selection.cjs';

const { parseIssueKeys, ISSUE_KEY } = selection;
const STATES = {
  needs_review: { label: 'Needs review', appearance: 'warning', detail: 'Open the issue to review the changed decision or requirement.' },
  context_changed: { label: 'Context changed', appearance: 'information', detail: 'Linked text still matches. Review the surrounding changes.' },
  could_not_verify: { label: 'Could not verify', appearance: 'warning', detail: 'Open the issue and check access before reviewing its source.' },
  not_linked: { label: 'Source not linked', appearance: 'neutral', detail: 'Open Decision Drift on this issue to review a decision source.' },
  matches_review: { label: 'Matches review', appearance: 'success', detail: 'The source and issue match the saved review.' },
};
const REASONS = {
  NO_REVIEWED_SOURCE: 'Choose and review a source on this issue.',
  MATCHES_REVIEW: 'The source and issue match the saved review.',
  CONTEXT_CHANGED: 'Linked passages match; review the surrounding changes.',
  SOURCE_CHANGED: 'The source changed since review.',
  SOURCE_CHANGED_HISTORY_UNAVAILABLE: 'The source changed. A complete historical text comparison is unavailable.',
  SOURCE_VERSION_CHANGED: 'A new source version was published.',
  ISSUE_CHANGED: 'The Jira summary or description changed.',
  BOTH_CHANGED: 'The source and Jira work item changed.',
  BOTH_CHANGED_HISTORY_UNAVAILABLE: 'Both sides changed. A complete historical text comparison is unavailable.',
  DIFFERENT_SOURCE: 'The tracked decision source changed. Open the issue to review it.',
  LINKED_TEXT_CHANGED: 'A linked passage was edited or removed.',
  LINKED_TEXT_AMBIGUOUS: 'A linked passage appears more than once.',
  LINKED_TEXT_UNAVAILABLE: 'Complete text or verified history is unavailable.',
  ISSUE_UNAVAILABLE: 'This issue is unavailable or you do not have access.',
  SOURCE_UNAVAILABLE: 'The source is unavailable or you do not have access.',
  SOURCE_UNSUPPORTED: 'The source cannot be checked completely.',
  ISSUE_UNSUPPORTED: 'The Jira description cannot be checked completely.',
  RATE_LIMITED: 'The service is rate limited. Wait before checking again.',
  SERVICE_UNAVAILABLE: 'The service did not complete this check. Try again later.',
  REVIEW_DATA_UNAVAILABLE: 'The saved review could not be verified. Try again later.',
  WRONG_PROJECT: 'Choose an issue from this project.',
  CHECK_FAILED: 'This check did not complete. Try again later.',
};

function selectionFromText(value) {
  if (value.length > 2048) throw new Error('Choose at most eight issue keys.');
  return parseIssueKeys(value.trim().split(/[,\s]+/).filter(Boolean));
}

function issueLink(row) {
  if (!row.key || typeof row.issueUrl !== 'string') return null;
  try {
    const url = new URL(row.issueUrl);
    return url.protocol === 'https:' && !url.username && !url.password &&
      url.pathname === `/browse/${row.key}` && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}

function assertResult(data, keys) {
  const validRow = (row, index) => {
    if (!row || row.inputKey !== keys[index] || !Object.hasOwn(STATES, row.status) ||
        typeof row.reasonCode !== 'string' || typeof row.checkedAt !== 'string' ||
        !Number.isFinite(new Date(row.checkedAt).getTime())) return false;
    const noVersions = row.reviewedVersion === null && row.currentVersion === null;
    const verifiedVersions = Number.isInteger(row.reviewedVersion) && row.reviewedVersion >= 1 &&
      Number.isInteger(row.currentVersion) && row.currentVersion >= row.reviewedVersion;
    if (row.key === null) return row.status === 'could_not_verify' && row.summary === null && row.issueUrl === null && noVersions;
    if (row.key !== row.inputKey || typeof row.summary !== 'string' || !issueLink(row)) return false;
    if (row.status === 'not_linked') return noVersions;
    if (row.status === 'could_not_verify') return noVersions || verifiedVersions;
    return verifiedVersions && (row.status !== 'matches_review' || row.reviewedVersion === row.currentVersion);
  };
  if (typeof data?.project?.key !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(data.project.key) ||
      keys.some(key => !ISSUE_KEY.test(key) || key.slice(0, key.lastIndexOf('-')) !== data.project.key) ||
      !Array.isArray(data.rows) || data.rows.length !== keys.length || !data.rows.every(validRow)) {
    throw new Error('The queue returned an incomplete check. Check this selection again.');
  }
}

const displayTime = value => new Date(value).toLocaleString();
const versionLabel = value => value === null ? '—' : `v${value}`;
const TABLE_HEAD = { cells: [
  { key: 'issue', content: 'Work item', width: 26 },
  { key: 'state', content: 'Review state', width: 34 },
  { key: 'version', content: 'Reviewed → published', width: 16 },
  { key: 'checked', content: 'Checked at', width: 14 },
  { key: 'action', content: 'Next action', width: 10 },
] };

function QueueResults({ result }) {
  const counts = Object.fromEntries(Object.keys(STATES).map(status => [status, result.rows.filter(row => row.status === status).length]));
  const rows = result.rows.map(row => ({
    key: row.inputKey,
    cells: [
      { key: `${row.inputKey}-issue`, content: <Stack space="space.050"><Text><Strong>{row.key || row.inputKey}</Strong></Text><Text>{row.summary ?? 'Jira details unavailable'}</Text></Stack> },
      { key: `${row.inputKey}-state`, content: <Stack space="space.100"><Lozenge appearance={STATES[row.status].appearance}>{STATES[row.status].label}</Lozenge><Text>{REASONS[row.reasonCode] || STATES[row.status].detail}</Text></Stack> },
      { key: `${row.inputKey}-version`, content: `${versionLabel(row.reviewedVersion)} → ${versionLabel(row.currentVersion)}` },
      { key: `${row.inputKey}-checked`, content: displayTime(row.checkedAt) },
      { key: `${row.inputKey}-action`, content: issueLink(row) ? <Link href={issueLink(row)} openNewTab>{`Open ${row.key}`}</Link> : 'Access needed' },
    ],
  }));
  return <Stack space="space.250">
    <Stack space="space.150">
      <Heading as="h3" size="small">{`${result.rows.length} selected issues · ${result.project.key}`}</Heading>
      <Inline space="space.150" shouldWrap>
        {Object.entries(STATES).map(([status, state]) => <Box key={status} padding="space.150" backgroundColor="color.background.neutral"><Stack space="space.050"><Text><Strong>{String(counts[status])}</Strong></Text><Text>{state.label}</Text></Stack></Box>)}
      </Inline>
    </Stack>
    {counts.could_not_verify > 0 && <SectionMessage appearance="warning" title="Some issues could not be verified"><Text>{`${counts.could_not_verify} of ${result.rows.length} checks could not be verified. Review their individual results before continuing.`}</Text></SectionMessage>}
    <DynamicTable head={TABLE_HEAD} rows={rows} label="Decision review results for selected issues" />
    <Text>Open an issue, then open Decision Drift to inspect its evidence and review the current version. Results reflect the time checked. Refresh this selection after reviewing an issue.</Text>
    <Text>Matches review records freshness. Review surrounding context and requirements before making a release decision.</Text>
  </Stack>;
}

export function QueueApp() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [editedWhilePending, setEditedWhilePending] = useState(false);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; sequence.current += 1; }, []);

  let selectionError = null;
  let keys = [];
  try { keys = selectionFromText(input); }
  catch (failure) { if (input.trim()) selectionError = failure.message; }

  function changeSelection(event) {
    sequence.current += 1;
    setInput(event.target.value);
    setResult(null); setError(null);
    if (inFlight.current) setEditedWhilePending(true);
  }

  async function checkSelection() {
    if (inFlight.current) return;
    let selected;
    try { selected = selectionFromText(input); }
    catch (failure) { setError(failure.message); return; }
    const current = ++sequence.current;
    inFlight.current = true;
    setPending(true); setEditedWhilePending(false); setError(null); setResult(null);
    try {
      const data = await invoke('checkSelectedIssues', { issueKeys: selected });
      if (!mounted.current || current !== sequence.current) return;
      assertResult(data, selected);
      setResult(data);
    } catch (failure) {
      if (mounted.current && current === sequence.current) {
        setError(typeof failure?.message === 'string' ? failure.message : 'The check did not complete. Try this selection again.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) { setPending(false); setEditedWhilePending(false); }
    }
  }

  return <Stack space="space.300">
    <Stack space="space.100">
      <Text><Strong>Decision Drift</Strong></Text>
      <Heading as="h2" size="large">Selected review queue</Heading>
      <Text>See which decisions need another look before this work moves forward.</Text>
      <Text>Check up to eight issues selected from this project. Results cover this selection.</Text>
    </Stack>
    <Box padding="space.250" backgroundColor="color.background.neutral">
      <Stack space="space.150">
        <Label labelFor="issueKeys">Jira issue keys</Label>
        <TextArea id="issueKeys" value={input} maxLength={2048} minimumRows={3} onChange={changeSelection} placeholder="PROJ-12, PROJ-34" />
        <Text>Enter keys from this project, separated by commas or new lines. Enter each key once.</Text>
        {selectionError && <SectionMessage appearance="warning" title="Adjust your selection"><Text>{selectionError}</Text></SectionMessage>}
        <Inline space="space.200" alignBlock="center" shouldWrap>
          <LoadingButton appearance="primary" onClick={checkSelection} isLoading={pending} isDisabled={pending || keys.length === 0 || Boolean(selectionError)}>{result ? 'Refresh selection' : 'Check selected issues'}</LoadingButton>
          {keys.length > 0 && !selectionError && <Text>{`${keys.length} of 8 issues selected`}</Text>}
        </Inline>
      </Stack>
    </Box>
    {pending && <SectionMessage appearance="information" title={editedWhilePending ? 'Selection updated' : 'Checking selected issues'}><Text>{editedWhilePending ? 'Finishing the previous check. Check your updated selection when it completes.' : 'Checking the selected issues with your current access…'}</Text></SectionMessage>}
    {error && <SectionMessage appearance="error" title="Queue check did not complete"><Text>{error}</Text><Text>Check the selection again. Each issue review remains available from its Jira issue.</Text></SectionMessage>}
    {result && <QueueResults result={result} />}
    {!pending && !result && !error && <Box padding="space.250" backgroundColor="color.background.discovery"><Stack space="space.150"><Heading as="h3" size="small">Start a focused review</Heading><Text>Select the issues you want to review together. The queue checks their saved decision sources and points you to the next review.</Text><Text>Each check is read-only. Review and approve changes from the individual issue.</Text></Stack></Box>}
  </Stack>;
}

ForgeReconciler.render(<QueueApp />);
