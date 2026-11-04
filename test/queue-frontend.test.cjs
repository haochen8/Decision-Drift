const test = require('node:test');
const assert = require('node:assert/strict');
const { renderApp } = require('./helpers/forge-ui.cjs');

const CHECKED_AT = '2026-11-04T10:00:00.000Z';

function row(inputKey, overrides = {}) {
  return {
    inputKey, key: inputKey, summary: `Fresh accessible summary for ${inputKey}`,
    status: 'matches_review', reasonCode: 'MATCHES_REVIEW',
    reviewedVersion: 2, currentVersion: 2, checkedAt: CHECKED_AT,
    issueUrl: `https://test.atlassian.net/browse/${inputKey}`,
    ...overrides,
  };
}

const result = rows => ({ project: { key: 'DD' }, rows });

async function renderQueue(t, handler) {
  const app = await renderApp(t, handler ? { checkSelectedIssues: handler } : {}, {
    entryPath: 'src/queue-frontend.jsx',
  });
  async function select(value) {
    const field = app.nodes('TextArea').find(node => node.props.id?.endsWith('-issueKeys'));
    assert.ok(field, 'Issue selection text area must be rendered');
    await app.event(field, 'onChange', { target: { type: 'textarea', value } });
  }
  function action() {
    const button = [...app.nodes('LoadingButton'), ...app.nodes('Button')].find(node =>
      ['Check selected issues', 'Refresh selection'].includes(nodeText(node)));
    assert.ok(button, 'Queue check action must be rendered');
    return button;
  }
  function dispatch() {
    const button = action();
    if (button.props.type === 'submit') {
      const [form] = app.nodes('Form');
      assert.ok(form, 'Queue submit action must have a form');
      return form.props.onSubmit({ preventDefault() {}, persist() {} });
    }
    assert.equal(typeof button.props.onClick, 'function');
    return button.props.onClick();
  }
  async function check() {
    assert.ok(!action().props.isDisabled, 'Queue check must be enabled');
    await dispatch();
    await app.settle();
  }
  return { ...app, select, action, dispatch, check };
}

function nodeText(node) {
  return [node.props?.text || '', ...(node.children || []).map(nodeText)].join('');
}

test('the selected review queue stays idle until an explicit check', async t => {
  const app = await renderQueue(t);
  await app.settle();
  assert.deepEqual(app.calls, []);
  assert.equal(app.nodes('Row').length, 0);
  await app.select('DD-1');
  await app.settle();
  assert.deepEqual(app.calls, [], 'Typing a selection must not start a product read');
});

test('eight unique issue keys cross the real invoke bridge once and render eight read-only rows', async t => {
  const keys = Array.from({ length: 8 }, (_, index) => `DD-${index + 1}`);
  const app = await renderQueue(t, () => result(keys.map(key => row(key))));
  await app.select(keys.map(key => key.toLowerCase()).join(',\n'));
  await app.check();
  assert.deepEqual(app.calls, [{ name: 'checkSelectedIssues', payload: { issueKeys: keys } }]);
  assert.equal(app.nodes('Row').length, 8);
  for (const key of keys) {
    assert.ok(app.text().includes(`Fresh accessible summary for ${key}`));
    assert.ok(app.nodes('Link').some(node => node.props.href === `https://test.atlassian.net/browse/${key}`));
  }
  assert.equal(nodeText(app.action()), 'Refresh selection');
  assert.equal(app.nodes('Checkbox').length, 0, 'Queue must not offer an approval or write action');
  await app.settle();
  assert.equal(app.calls.length, 1, 'A completed check must not trigger a background refresh');
});

for (const scenario of [
  { label: 'empty', selection: '' },
  { label: 'duplicate after normalization', selection: 'DD-1, dd-1' },
  { label: 'nine issues', selection: Array.from({ length: 9 }, (_, index) => `DD-${index + 1}`).join('\n') },
  { label: 'malformed key', selection: 'DD-0' },
]) {
  test(`a selection that is ${scenario.label} cannot invoke a resolver`, async t => {
    const app = await renderQueue(t);
    await app.select(scenario.selection);
    // Even a dispatched host callback must not bypass client validation.
    await app.dispatch();
    await app.settle();
    assert.deepEqual(app.calls, []);
    assert.equal(app.nodes('Row').length, 0);
    assert.ok(app.nodes('SectionMessage').some(node => ['error', 'warning'].includes(node.props.appearance)));
  });
}

test('partial results expose fresh accessible issue metadata and bounded reasons without source text', async t => {
  const rows = [
    row('DD-1'),
    row('DD-2', { status: 'context_changed', reasonCode: 'CONTEXT_CHANGED', currentVersion: 3 }),
    row('DD-3', { status: 'needs_review', reasonCode: 'SOURCE_CHANGED_HISTORY_UNAVAILABLE', currentVersion: 4 }),
    row('DD-4', { status: 'not_linked', reasonCode: 'NO_REVIEWED_SOURCE', reviewedVersion: null, currentVersion: null }),
    row('DD-5', { status: 'could_not_verify', reasonCode: 'ISSUE_UNAVAILABLE', key: null, summary: null, issueUrl: null, reviewedVersion: null, currentVersion: null }),
    row('DD-6', { status: 'could_not_verify', reasonCode: 'SOURCE_UNAVAILABLE', reviewedVersion: null, currentVersion: null }),
  ];
  // Unexpected source fields must never be copied into this metadata-only view.
  rows[0].sourceTitle = 'Restricted Confluence title that the queue must not show';
  rows[0].sourceText = 'Private decision excerpt that the queue must not show';
  const app = await renderQueue(t, () => result(rows));
  await app.select(rows.map(item => item.inputKey).join('\n'));
  await app.check();
  assert.equal(app.nodes('Row').length, 6);
  for (const item of rows.filter(item => item.summary)) assert.ok(app.text().includes(item.summary));
  const inaccessible = app.nodes('Row').find(node => nodeText(node).includes('DD-5'));
  assert.ok(inaccessible, 'An unavailable issue needs a visible unresolved row');
  assert.ok(!nodeText(inaccessible).includes('Fresh accessible summary'));
  assert.ok(!app.nodes('Link').some(node => node.props.href?.endsWith('/DD-5')));
  assert.ok(app.nodes('Link').some(node => node.props.href?.endsWith('/DD-6')), 'A denied source must not hide fresh authorized Jira metadata');
  assert.ok(!app.text().includes(rows[0].sourceTitle));
  assert.ok(!app.text().includes(rows[0].sourceText));
  assert.ok(!app.text().includes('SOURCE_CHANGED_HISTORY_UNAVAILABLE'), 'Show an explanatory reason, not an internal code');
  for (const expected of ['1Needs review', '1Context changed', '2Could not verify', '1Source not linked', '1Matches review']) {
    assert.ok(app.nodes('Box').some(node => nodeText(node) === expected), `Wrong selected-issue count: ${expected}`);
  }
  const changedRow = app.nodes('Row').find(node => node.props.rowKey === 'DD-3');
  assert.ok(changedRow);
  assert.ok(nodeText(changedRow).includes('v2 → v4'));
  assert.ok(nodeText(changedRow).includes('A complete historical text comparison is unavailable.'));
  assert.ok(nodeText(changedRow).includes(new Date(CHECKED_AT).toLocaleString()));
  assert.ok(app.calls.every(call => call.name === 'checkSelectedIssues'));
});

test('editing a completed selection clears all previous rows without checking the new selection', async t => {
  const app = await renderQueue(t, () => result([row('DD-1', { summary: 'Old selection metadata' })]));
  await app.select('DD-1');
  await app.check();
  assert.equal(app.nodes('Row').length, 1);
  await app.select('DD-2');
  assert.equal(app.nodes('Row').length, 0);
  assert.ok(!app.text().includes('Old selection metadata'));
  assert.equal(nodeText(app.action()), 'Check selected issues');
  assert.equal(app.calls.length, 1);
});

test('refresh removes prior rows while pending and replaces them with fresh permitted metadata', async t => {
  let completeRefresh;
  let checks = 0;
  const pendingRefresh = new Promise(resolve => { completeRefresh = resolve; });
  const app = await renderQueue(t, () => ++checks === 1
    ? result([row('DD-1', { summary: 'Previously authorized summary' })]) : pendingRefresh);
  await app.select('DD-1');
  await app.check();
  assert.ok(app.text().includes('Previously authorized summary'));
  const pending = app.dispatch();
  await app.until(() => app.calls.length === 2, 'explicit refresh request');
  assert.equal(app.nodes('Row').length, 0);
  assert.ok(!app.text().includes('Previously authorized summary'));
  assert.equal(app.action().props.isDisabled, true);
  completeRefresh(result([row('DD-1', {
    key: null, summary: null, issueUrl: null, status: 'could_not_verify', reasonCode: 'ISSUE_UNAVAILABLE', reviewedVersion: null, currentVersion: null,
  })]));
  await pending;
  await app.settle();
  assert.equal(app.nodes('Row').length, 1);
  assert.ok(!app.text().includes('Previously authorized summary'));
  assert.ok(!app.nodes('Link').some(node => node.props.href?.endsWith('/DD-1')));
  assert.equal(app.calls.length, 2);
});

for (const outcome of ['success', 'failure']) {
  test(`editing a pending selection suppresses its late ${outcome} and prevents overlapping checks`, async t => {
    let complete;
    let fail;
    let checks = 0;
    const previous = new Promise((resolve, reject) => { complete = resolve; fail = reject; });
    const app = await renderQueue(t, () => ++checks === 1 ? previous : result([row('DD-2')]));
    await app.select('DD-1');
    const pending = app.dispatch();
    await app.until(() => app.calls.length === 1, 'first selection request');
    await app.select('DD-2');
    assert.equal(app.nodes('Row').length, 0);
    assert.equal(app.action().props.isDisabled, true, 'The previous request must retain the in-flight guard');
    await app.dispatch();
    await app.settle();
    assert.equal(app.calls.length, 1, 'A stale host event must not start a second overlapping check');
    if (outcome === 'success') complete(result([row('DD-1', { summary: 'Late stale summary must stay hidden' })]));
    else fail(new Error('Late stale failure must stay hidden'));
    await pending;
    await app.settle();
    assert.equal(app.nodes('Row').length, 0);
    assert.ok(!app.text().includes('Late stale'));
    assert.equal(app.action().props.isDisabled, false);
    await app.check();
    assert.deepEqual(app.calls.map(call => call.payload), [{ issueKeys: ['DD-1'] }, { issueKeys: ['DD-2'] }]);
    assert.equal(app.nodes('Row').length, 1);
    assert.ok(app.text().includes('Fresh accessible summary for DD-2'));
    assert.ok(!app.text().includes('Late stale summary'));
  });
}

for (const outcome of ['failure', 'malformed']) {
  test(`a ${outcome} refresh clears earlier successful rows`, async t => {
    let checks = 0;
    const app = await renderQueue(t, () => {
      if (++checks === 1) return result([row('DD-1', { summary: 'Prior successful summary must be cleared' })]);
      if (outcome === 'failure') throw new Error('The project check could not be completed.');
      return { project: { key: 'DD' }, rows: [{ inputKey: 'DD-1', status: 'invented-success' }] };
    });
    await app.select('DD-1');
    await app.check();
    assert.equal(app.nodes('Row').length, 1);
    await app.check();
    assert.equal(app.nodes('Row').length, 0);
    assert.ok(!app.text().includes('Prior successful summary must be cleared'));
    assert.ok(app.nodes('SectionMessage').some(node => node.props.appearance === 'error'));
    assert.equal(app.calls.length, 2);
  });
}

for (const scenario of [
  { label: 'a different canonical issue', data: result([row('DD-1', { key: 'DD-99', issueUrl: 'https://test.atlassian.net/browse/DD-99' })]) },
  { label: 'an unavailable issue marked as matching', data: result([row('DD-1', { key: null, summary: null, issueUrl: null, reviewedVersion: null, currentVersion: null })]) },
  { label: 'a null check timestamp', data: result([row('DD-1', { checkedAt: null })]) },
  { label: 'a different project', data: { project: { key: 'OTHER' }, rows: [row('DD-1')] } },
]) {
  test(`a response with ${scenario.label} is rejected and clears previous results`, async t => {
    let checks = 0;
    const app = await renderQueue(t, () => ++checks === 1
      ? result([row('DD-1', { summary: 'Prior permitted summary must disappear' })]) : scenario.data);
    await app.select('DD-1');
    await app.check();
    assert.equal(app.nodes('Row').length, 1);
    await app.check();
    assert.equal(app.nodes('Row').length, 0);
    assert.ok(!app.text().includes('Prior permitted summary must disappear'));
    assert.ok(app.nodes('SectionMessage').some(node => node.props.appearance === 'error'));
    assert.ok(!app.nodes('Link').some(node => node.props.href?.endsWith('/DD-99')));
    assert.equal(app.calls.length, 2);
  });
}
