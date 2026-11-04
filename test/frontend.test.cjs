const test = require('node:test');
const assert = require('node:assert/strict');
const { renderApp } = require('./helpers/forge-ui.cjs');

function snapshot(status = 'unreviewed', overrides = {}) {
  return {
    issue: { id: '10001', key: 'DD-1', summary: 'Review export policy', updated: '2026-10-29T15:00:00Z', text: 'Only project admins can export records.\nKeep audit logs.', textComplete: true },
    source: {
      id: '12345', title: 'Restricted decision title', version: 3,
      url: 'https://test.atlassian.net/wiki/pages/viewpage.action?pageId=12345',
      text: 'Only admins may export the source records.', hasUnrepresentedContent: false,
    },
    tracking: {
      status,
      baseline: status === 'unreviewed' ? null : {
        revision: 1, sourceId: '12345', sourceVersion: status === 'source_changed' ? 2 : 3,
        reviewedAt: '2026-10-29T14:00:00Z',
      },
      sourceChanged: status === 'source_changed', issueChanged: false,
      diff: status === 'source_changed'
        ? { status: 'available', removed: ['All members may export the source records.'], added: ['Only admins may export the source records.'], limited: false }
        : { status: 'not_needed', added: [], removed: [], limited: false },
    },
    ...overrides,
  };
}

function preview(status = 'unreviewed') {
  return {
    ...snapshot(status), previewId: '11111111-2222-4333-8444-555555555555',
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    reviewScope: { mode: 'page', sourceQuote: null, requirementQuote: null },
  };
}

const MODE_LABEL = 'Link specific decision and requirement passages';
const SOURCE_QUOTE = 'Only admins may export the source records.';
const REQUIREMENT_QUOTE = 'Only project admins can export records.';
const SECOND_SOURCE_QUOTE = 'Exports include audit trails.';
const SECOND_REQUIREMENT_QUOTE = 'Keep audit logs.';

function focusedSnapshot(status = 'unchanged', focusOverrides = {}) {
  const result = snapshot(status);
  result.source.text = `${SOURCE_QUOTE}\n${SECOND_SOURCE_QUOTE}`;
  result.tracking.focus = {
    status: 'unchanged', sourceStatus: 'unchanged', requirementStatus: 'unchanged',
    reviewedSourceQuote: SOURCE_QUOTE, currentSourceQuote: SOURCE_QUOTE,
    currentRequirementQuote: REQUIREMENT_QUOTE,
    ...focusOverrides,
  };
  return result;
}

function passagePreview(sourceQuote = SOURCE_QUOTE, requirementQuote = REQUIREMENT_QUOTE, current = snapshot('unchanged')) {
  return {
    ...preview('unchanged'), ...current,
    reviewScope: { mode: 'passage', sourceQuote, requirementQuote },
  };
}

async function choosePassages(app, source = SOURCE_QUOTE, requirement = REQUIREMENT_QUOTE) {
  await app.event(app.checkbox(MODE_LABEL), 'onChange', { target: { checked: true } });
  await app.passageInput('sourceQuote', source);
  await app.passageInput('requirementQuote', requirement);
}

for (const status of ['source_changed', 'unchanged']) {
  test(`opening an issue loads its tracked source and renders ${status} from the resolver`, async t => {
    const app = await renderApp(t, {
      loadTrackedSource: () => ({ tracked: true, ...snapshot(status) }),
    });
    await app.until(() => app.text().includes(status === 'source_changed'
      ? 'Source changed since review' : 'Source unchanged since review'), 'tracked source status');
    assert.deepEqual(app.calls, [{ name: 'loadTrackedSource', payload: {} }]);
    assert.equal(app.nodes('Textfield')[0].props.value, '12345');
    if (status === 'source_changed') {
      assert.ok(app.text().includes('All members may export the source records.'));
      assert.ok(app.text().includes('Only admins may export the source records.'));
      assert.equal(app.button('Review current version').props.isDisabled, false);
    } else {
      assert.equal(app.button('Current version reviewed').props.isDisabled, true);
      assert.ok(!app.text().includes('All members may export the source records.'));
    }
  });
}

test('a user checks a source, reviews the exact baseline, and explicitly approves before saving', async t => {
  const prepared = preview();
  const pageInput = 'https://test.atlassian.net/wiki/pages/viewpage.action?pageId=12345';
  const app = await renderApp(t, {
    loadTrackedSource: () => ({ tracked: false }),
    inspectDecisionSource: () => snapshot(),
    prepareBaseline: () => prepared,
    confirmBaseline: () => ({ ...snapshot('unchanged'), alreadyReviewed: false }),
  });
  assert.equal(app.button('Check source').props.isDisabled, true);
  await app.input(` ${pageInput} `);
  await app.click('Check source');
  assert.ok(app.text().includes('Give this work a reviewed source'));
  assert.deepEqual(app.calls.at(-1), { name: 'inspectDecisionSource', payload: { pageInput } });

  await app.click('Review current version');
  assert.ok(app.text().includes(prepared.source.text), 'Preview must display the source being approved');
  const checkbox = app.approval();
  assert.equal(checkbox.props.label, 'I reviewed page 12345 at version 3 for DD-1.');
  assert.equal(checkbox.props.isChecked, false);
  assert.equal(app.button('Save reviewed version').props.isDisabled, true);
  // The callback itself must guard approval, even if a stale host event arrives.
  await app.event(app.button('Save reviewed version'), 'onClick');
  assert.ok(!app.calls.some(call => call.name === 'confirmBaseline'));
  await app.event(checkbox, 'onChange', { target: { type: 'checkbox', checked: true } });
  assert.equal(app.button('Save reviewed version').props.isDisabled, false);
  await app.click('Save reviewed version');

  assert.deepEqual(app.calls.at(-1), {
    name: 'confirmBaseline', payload: { previewId: prepared.previewId, approved: true },
  });
  assert.ok(app.text().includes('Source unchanged since review'));
  assert.ok(app.nodes('SectionMessage').some(node => node.props.title === 'Reviewed version saved'));
  assert.equal(app.approvals().length, 0);
  assert.equal(app.button('Current version reviewed').props.isDisabled, true);
  assert.ok(!app.calls.some(call => call.name === 'applyUpdate'), 'Saving a baseline must not post a Jira note');
});

test('an already-saved review receipt identifies the saved baseline when the published source has advanced', async t => {
  const original = snapshot();
  original.source.version = 1;
  const prepared = { ...preview(), ...original };
  const current = snapshot('source_changed');
  current.source.version = 2;
  current.tracking.baseline.sourceVersion = 1;
  const app = await renderApp(t, {
    loadTrackedSource: () => ({ tracked: true, ...original }),
    prepareBaseline: () => prepared,
    // A prior write succeeded; its idempotent receipt includes fresh product reads.
    confirmBaseline: () => ({ ...current, alreadyReviewed: true }),
  });
  await app.until(() => app.text().includes('Give this work a reviewed source'), 'initial source');
  await app.click('Review current version');
  assert.equal(app.approval().props.label, 'I reviewed page 12345 at version 1 for DD-1.');
  await app.event(app.approval(), 'onChange', { target: { checked: true } });
  await app.click('Save reviewed version');

  const notice = app.nodes('SectionMessage').find(node => node.props.title === 'Review already saved');
  assert.ok(notice, 'An idempotent receipt must be labeled as already saved');
  const renderedText = node => [node.props?.text || '', ...(node.children || []).map(renderedText)].join('');
  assert.ok(renderedText(notice).includes('Page 12345 at version 1 is the saved comparison point for DD-1.'));
  assert.ok(!renderedText(notice).includes('version 2'), 'Current source version must not be presented as the saved baseline');
  assert.ok(app.text().includes('Source changed since review'), 'Fresh source state must remain visible beside the earlier receipt');
  assert.equal(app.button('Review current version').props.isDisabled, false);
  assert.equal(app.approvals().length, 0);
});

test('a save response without a confirmed baseline cannot display a successful review receipt', async t => {
  const app = await renderApp(t, {
    loadTrackedSource: () => ({ tracked: true, ...snapshot('source_changed') }),
    prepareBaseline: () => preview('source_changed'),
    confirmBaseline: () => snapshot(),
  });
  await app.until(() => app.text().includes('Source changed since review'), 'tracked source');
  await app.click('Review current version');
  await app.event(app.approval(), 'onChange', { target: { checked: true } });
  await app.click('Save reviewed version');
  assert.ok(app.text().includes('The saved review was not confirmed.'));
  assert.ok(!app.nodes('SectionMessage').some(node => ['Reviewed version saved', 'Review already saved'].includes(node.props.title)));
  assert.equal(app.approvals().length, 0);
});

test('changing the page invalidates an approved preview and the next review needs fresh approval', async t => {
  const second = preview();
  second.previewId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  second.source = { ...second.source, id: '67890', title: 'Second decision', text: 'Different decision evidence.' };
  let preparations = 0;
  const app = await renderApp(t, {
    loadTrackedSource: () => ({ tracked: true, ...snapshot('source_changed') }),
    inspectDecisionSource: () => ({ ...second, previewId: undefined, expiresAt: undefined }),
    prepareBaseline: () => ++preparations === 1 ? preview('source_changed') : second,
    confirmBaseline: () => { throw new Error('Approval must not be carried across sources'); },
  });
  await app.until(() => app.text().includes('Source changed since review'), 'tracked source');
  await app.click('Review current version');
  await app.event(app.approval(), 'onChange', { target: { checked: true } });
  assert.equal(app.button('Save reviewed version').props.isDisabled, false);

  await app.input('67890');
  assert.equal(app.approvals().length, 0);
  assert.ok(!app.text().includes('Restricted decision title'));
  assert.ok(!app.text().includes('Only admins may export the source records.'));
  await app.click('Check source');
  await app.click('Review current version');
  assert.ok(app.text().includes('Different decision evidence.'));
  assert.equal(app.approval().props.isChecked, false);
  assert.equal(app.button('Save reviewed version').props.isDisabled, true);
  await app.event(app.button('Save reviewed version'), 'onClick');
  assert.ok(!app.calls.some(call => call.name === 'confirmBaseline'));
});

test('a failed permission recheck immediately removes previously visible restricted evidence', async t => {
  let deny;
  const failure = new Promise((resolve, reject) => { deny = reject; });
  const app = await renderApp(t, {
    loadTrackedSource: () => ({ tracked: true, ...snapshot('unchanged') }),
    inspectDecisionSource: () => failure,
  });
  await app.until(() => app.text().includes('Source unchanged since review'), 'tracked source');
  await app.click('Read current text');
  assert.ok(app.text().includes('Only admins may export the source records.'));

  // Dispatch without awaiting the response so the pending state is tested too.
  const [form] = app.nodes('Form');
  const pending = form.props.onSubmit({ preventDefault() {}, persist() {} });
  await app.until(() => app.calls.some(call => call.name === 'inspectDecisionSource'), 'permission recheck request');
  assert.ok(!app.text().includes('Restricted decision title'));
  assert.ok(!app.text().includes('Only admins may export the source records.'));
  deny(new Error('You no longer have access to this source.'));
  await pending;
  await app.settle();
  assert.ok(app.text().includes('You no longer have access to this source.'));
  assert.ok(!app.text().includes('Restricted decision title'));
  assert.ok(!app.text().includes('Only admins may export the source records.'));
  assert.equal(app.nodes('CodeBlock').length, 0);
  assert.equal(app.approvals().length, 0);
});

test('permission denial while saving clears the preview instead of retaining restricted source content', async t => {
  const app = await renderApp(t, {
    loadTrackedSource: () => ({ tracked: true, ...snapshot('source_changed') }),
    prepareBaseline: () => preview('source_changed'),
    confirmBaseline: () => { throw new Error('Source access was revoked before this review could be saved.'); },
  });
  await app.until(() => app.text().includes('Source changed since review'), 'tracked source');
  await app.click('Review current version');
  assert.ok(app.text().includes('Restricted decision title'));
  await app.event(app.approval(), 'onChange', { target: { checked: true } });
  await app.click('Save reviewed version');
  assert.ok(app.text().includes('Source access was revoked before this review could be saved.'));
  assert.ok(!app.text().includes('Restricted decision title'));
  assert.ok(!app.text().includes('Only admins may export the source records.'));
  assert.ok(!app.text().includes('All members may export the source records.'));
  assert.equal(app.nodes('CodeBlock').length, 0);
  assert.equal(app.approvals().length, 0);
  assert.ok(!app.nodes('SectionMessage').some(node => node.props.title === 'Reviewed version saved'));
});

test('an expired baseline cannot be saved even if its approval callback is dispatched', async t => {
  const expiredPreview = { ...preview('source_changed'), expiresAt: new Date(Date.now() - 1000).toISOString() };
  const app = await renderApp(t, {
    loadTrackedSource: () => ({ tracked: true, ...snapshot('source_changed') }),
    prepareBaseline: () => expiredPreview,
  });
  await app.until(() => app.text().includes('Source changed since review'), 'tracked source');
  await app.click('Review current version');
  assert.ok(app.nodes('SectionMessage').some(node => node.props.title === 'Review expired'));
  assert.equal(app.approval().props.isDisabled, true);
  await app.event(app.approval(), 'onChange', { target: { checked: true } });
  await app.event(app.button('Save reviewed version'), 'onClick');
  assert.ok(!app.calls.some(call => call.name === 'confirmBaseline'));
});

test('canceling an approved baseline leaves the next review unapproved', async t => {
  const app = await renderApp(t, {
    loadTrackedSource: () => ({ tracked: true, ...snapshot('source_changed') }),
    prepareBaseline: () => preview('source_changed'),
  });
  await app.until(() => app.text().includes('Source changed since review'), 'tracked source');
  await app.click('Review current version');
  await app.event(app.approval(), 'onChange', { target: { checked: true } });
  await app.click('Cancel review');
  assert.equal(app.approvals().length, 0);
  assert.ok(app.text().includes('Source changed since review'));
  assert.ok(!app.calls.some(call => call.name === 'confirmBaseline'));
  await app.click('Review current version');
  assert.equal(app.approval().props.isChecked, false);
  assert.equal(app.button('Save reviewed version').props.isDisabled, true);
});

test('the optional Jira note has its own exact preview and approval, separate from the baseline', async t => {
  const prepared = {
    ...preview('unchanged'),
    commentText: 'Reviewed source reference: page 12345, version 3. No source content is copied.',
  };
  const app = await renderApp(t, {
    loadTrackedSource: () => ({ tracked: true, ...snapshot('unchanged') }),
    prepareUpdate: () => prepared,
    applyUpdate: () => ({
      issueKey: 'DD-1', commentId: '50001', sourceVersion: 3,
      commentUrl: 'https://test.atlassian.net/browse/DD-1?focusedCommentId=50001',
    }),
  });
  await app.until(() => app.text().includes('Source unchanged since review'), 'tracked source');
  await app.click('Preview source-link note');
  assert.equal(app.nodes('CodeBlock').length, 1);
  assert.equal(app.nodes('CodeBlock')[0].props.text, prepared.commentText);
  assert.ok(!app.text().includes(prepared.source.text), 'The note preview must not display the private source excerpt');
  assert.equal(app.approval().props.label, 'I reviewed this exact note and approve adding it to DD-1.');
  assert.equal(app.button('Add reviewed Jira note').props.isDisabled, true);
  await app.event(app.button('Add reviewed Jira note'), 'onClick');
  assert.ok(!app.calls.some(call => call.name === 'applyUpdate'));
  await app.event(app.approval(), 'onChange', { target: { checked: true } });
  await app.click('Add reviewed Jira note');
  assert.deepEqual(app.calls.at(-1), {
    name: 'applyUpdate', payload: { previewId: prepared.previewId, approved: true },
  });
  assert.ok(app.nodes('SectionMessage').some(node => node.props.title === 'Jira note added'));
  assert.ok(app.text().includes('Comment 50001 on DD-1 references source version 3.'));
  assert.ok(!app.calls.some(call => call.name === 'confirmBaseline'));
  assert.equal(app.approvals().length, 0);
});

test('an unchanged baseline can add, change, and explicitly remove a reviewed passage link', async t => {
  const page = snapshot('unchanged');
  page.source.text = `${SOURCE_QUOTE}\n${SECOND_SOURCE_QUOTE}`;
  const firstFocused = focusedSnapshot();
  const secondFocused = focusedSnapshot('unchanged', {
    reviewedSourceQuote: SECOND_SOURCE_QUOTE, currentSourceQuote: SECOND_SOURCE_QUOTE,
    currentRequirementQuote: SECOND_REQUIREMENT_QUOTE,
  });
  const preparations = [
    passagePreview(SOURCE_QUOTE, REQUIREMENT_QUOTE, page),
    { ...passagePreview(SECOND_SOURCE_QUOTE, SECOND_REQUIREMENT_QUOTE, firstFocused), previewId: '22222222-3333-4444-8555-666666666666' },
    { ...preview('unchanged'), ...secondFocused, previewId: '33333333-4444-4555-8666-777777777777' },
  ];
  const saved = [firstFocused, secondFocused, page];
  let prepared = 0;
  let confirmed = 0;
  const app = await renderApp(t, {
    loadTrackedSource: () => ({ tracked: true, ...page }),
    prepareBaseline: () => preparations[prepared++],
    confirmBaseline: () => ({ ...saved[confirmed++], alreadyReviewed: false }),
  });
  await app.until(() => app.text().includes('Source unchanged since review'), 'unchanged baseline');
  assert.equal(app.button('Current version reviewed').props.isDisabled, true);
  await app.click('Read current text');
  assert.ok(app.nodes('CodeBlock').some(node => node.props.text === page.issue.text));
  assert.ok(app.nodes('CodeBlock').some(node => node.props.text === page.source.text));
  await choosePassages(app);
  assert.equal(app.button('Review linked passages').props.isDisabled, false);
  await app.click('Review linked passages');
  assert.deepEqual(app.calls.at(-1), {
    name: 'prepareBaseline', payload: { pageInput: '12345', mode: 'passage', sourceQuote: SOURCE_QUOTE, requirementQuote: REQUIREMENT_QUOTE },
  });
  assert.equal(app.approval().props.label, 'I reviewed these passages and approve linking them for DD-1.');
  assert.equal(app.button('Save reviewed passage link').props.isDisabled, true);
  assert.ok(app.nodes('CodeBlock').some(node => node.props.text === SOURCE_QUOTE));
  assert.ok(app.nodes('CodeBlock').some(node => node.props.text === REQUIREMENT_QUOTE));
  await app.event(app.button('Save reviewed passage link'), 'onClick');
  assert.equal(confirmed, 0, 'A passage link also requires explicit approval');
  await app.event(app.approval(), 'onChange', { target: { checked: true } });
  await app.click('Save reviewed passage link');
  assert.deepEqual(app.calls.at(-1), { name: 'confirmBaseline', payload: { previewId: preparations[0].previewId, approved: true } });
  assert.ok(app.nodes('SectionMessage').some(node => node.props.title === 'Reviewed passage link saved'));
  assert.equal(app.checkbox(MODE_LABEL).props.isChecked, true);
  assert.equal(app.button('Current version reviewed').props.isDisabled, true);

  await app.passageInput('sourceQuote', SECOND_SOURCE_QUOTE);
  await app.passageInput('requirementQuote', SECOND_REQUIREMENT_QUOTE);
  await app.click('Review linked passages');
  assert.deepEqual(app.calls.at(-1), {
    name: 'prepareBaseline', payload: { pageInput: '12345', mode: 'passage', sourceQuote: SECOND_SOURCE_QUOTE, requirementQuote: SECOND_REQUIREMENT_QUOTE },
  });
  assert.equal(app.approval().props.isChecked, false);
  await app.event(app.approval(), 'onChange', { target: { checked: true } });
  await app.click('Save reviewed passage link');
  assert.equal(app.button('Current version reviewed').props.isDisabled, true);

  await app.event(app.checkbox(MODE_LABEL), 'onChange', { target: { checked: false } });
  assert.equal(app.nodes('TextArea').length, 0);
  assert.equal(app.button('Review current version').props.isDisabled, false);
  await app.click('Review current version');
  assert.deepEqual(app.calls.at(-1), { name: 'prepareBaseline', payload: { pageInput: '12345', mode: 'page' } });
  assert.ok(app.nodes('SectionMessage').some(node => node.props.title === 'Replace passage link with whole-page tracking'));
  assert.equal(app.approval().props.label, 'I reviewed page 12345 at version 3 for DD-1.');
  await app.event(app.approval(), 'onChange', { target: { checked: true } });
  await app.click('Save reviewed version');
  assert.equal(app.checkbox(MODE_LABEL).props.isChecked, false);
  assert.equal(app.nodes('TextArea').length, 0);
  assert.equal(app.button('Current version reviewed').props.isDisabled, true);
  assert.equal(prepared, 3);
  assert.equal(confirmed, 3);
  assert.ok(!app.calls.some(call => call.name === 'applyUpdate'));
});

for (const edited of ['sourceQuote', 'requirementQuote', 'mode']) {
  test(`editing ${edited} during a passage preview invalidates its approval`, async t => {
    const app = await renderApp(t, {
      loadTrackedSource: () => ({ tracked: true, ...snapshot('unchanged') }),
      prepareBaseline: () => passagePreview(),
    });
    await app.until(() => app.text().includes('Source unchanged since review'), 'unchanged baseline');
    await choosePassages(app);
    await app.click('Review linked passages');
    await app.event(app.approval(), 'onChange', { target: { checked: true } });
    assert.equal(app.button('Save reviewed passage link').props.isDisabled, false);
    if (edited === 'mode') {
      await app.event(app.checkbox(MODE_LABEL), 'onChange', { target: { checked: false } });
      assert.equal(app.approvals().length, 0);
      assert.equal(app.nodes('TextArea').length, 0);
      assert.equal(app.button('Current version reviewed').props.isDisabled, true);
    } else {
      await app.passageInput(edited, edited === 'sourceQuote' ? SECOND_SOURCE_QUOTE : SECOND_REQUIREMENT_QUOTE);
      assert.equal(app.approvals().length, 0);
      assert.equal(app.button('Review linked passages').props.isDisabled, false);
      await app.click('Review linked passages');
      assert.equal(app.approval().props.isChecked, false);
      assert.equal(app.button('Save reviewed passage link').props.isDisabled, true);
    }
    assert.ok(!app.calls.some(call => call.name === 'confirmBaseline'));
  });
}

test('loading a focused baseline replaces local drafts with fresh current quotes', async t => {
  const app = await renderApp(t, {
    loadTrackedSource: () => ({ tracked: true, ...focusedSnapshot() }),
  });
  await app.until(() => app.text().includes('The reviewed passage link'), 'focused baseline');
  assert.equal(app.checkbox(MODE_LABEL).props.isChecked, true);
  let fields = app.nodes('TextArea');
  assert.equal(fields.find(node => node.props.id.endsWith('-sourceQuote')).props.value, SOURCE_QUOTE);
  assert.equal(fields.find(node => node.props.id.endsWith('-requirementQuote')).props.value, REQUIREMENT_QUOTE);
  await app.passageInput('sourceQuote', 'An unsaved source draft that must not survive reload.');
  await app.passageInput('requirementQuote', 'An unsaved requirement draft that must not survive reload.');
  await app.click('Load tracked source');
  fields = app.nodes('TextArea');
  assert.equal(fields.find(node => node.props.id.endsWith('-sourceQuote')).props.value, SOURCE_QUOTE);
  assert.equal(fields.find(node => node.props.id.endsWith('-requirementQuote')).props.value, REQUIREMENT_QUOTE);
  assert.equal(app.button('Current version reviewed').props.isDisabled, true);
  assert.equal(app.calls.filter(call => call.name === 'loadTrackedSource').length, 2);
});

const focusCases = [
  {
    status: 'outside_scope', title: 'Linked text matches; other content changed',
    focus: { status: 'unchanged', sourceStatus: 'unchanged', requirementStatus: 'unchanged' },
    sourceField: SOURCE_QUOTE, requirementField: REQUIREMENT_QUOTE,
    evidence: 'Exact text appears once',
  },
  {
    status: 'focus_changed', title: 'Linked decision or requirement needs review',
    focus: { status: 'source_changed_or_missing', sourceStatus: 'changed_or_missing', requirementStatus: 'unchanged', currentSourceQuote: null },
    sourceField: '', requirementField: REQUIREMENT_QUOTE,
    evidence: 'Edited or missing',
  },
  {
    status: 'focus_ambiguous', title: 'A linked passage appears more than once',
    focus: { status: 'ambiguous', sourceStatus: 'ambiguous', requirementStatus: 'unchanged' },
    sourceField: SOURCE_QUOTE, requirementField: REQUIREMENT_QUOTE,
    evidence: 'Text appears more than once',
  },
  {
    status: 'focus_unavailable', title: 'The passage link could not be verified',
    focus: { status: 'unavailable', sourceStatus: 'unavailable', requirementStatus: 'unavailable', reviewedSourceQuote: null, currentSourceQuote: null, currentRequirementQuote: null },
    sourceField: '', requirementField: '', evidence: 'Could not verify',
  },
];

for (const scenario of focusCases) {
  test(`rechecking ${scenario.status} renders verified passage evidence without filling missing quotes from history`, async t => {
    const checked = focusedSnapshot(scenario.status, scenario.focus);
    checked.source.version = 4;
    const app = await renderApp(t, {
      loadTrackedSource: () => ({ tracked: true, ...focusedSnapshot() }),
      inspectDecisionSource: () => checked,
    });
    await app.until(() => app.text().includes('Source unchanged since review'), 'initial focused source');
    await app.click('Recheck source');
    assert.ok(app.text().includes(scenario.title));
    assert.ok(app.text().includes(scenario.evidence));
    const fields = app.nodes('TextArea');
    assert.equal(fields.find(node => node.props.id.endsWith('-sourceQuote')).props.value, scenario.sourceField);
    assert.equal(fields.find(node => node.props.id.endsWith('-requirementQuote')).props.value, scenario.requirementField);
    if (!scenario.sourceField || !scenario.requirementField) assert.equal(app.button('Review linked passages').props.isDisabled, true);
    if (scenario.status === 'outside_scope') {
      assert.ok(app.text().includes('matching text alone cannot establish that the decision still applies'));
    }
    if (scenario.status === 'focus_changed') {
      assert.ok(app.nodes('CodeBlock').some(node => node.props.text === SOURCE_QUOTE), 'Authorized history remains review evidence without becoming the new selection');
    }
    if (scenario.status === 'focus_unavailable') {
      assert.ok(!app.nodes('CodeBlock').some(node => node.props.text === SOURCE_QUOTE || node.props.text === REQUIREMENT_QUOTE));
    }
    assert.ok(!app.calls.some(call => call.name === 'confirmBaseline'));
  });
}

test('failed passage confirmation clears source and requirement quotes along with its approval', async t => {
  const app = await renderApp(t, {
    loadTrackedSource: () => ({ tracked: true, ...focusedSnapshot('outside_scope') }),
    prepareBaseline: () => passagePreview(SOURCE_QUOTE, REQUIREMENT_QUOTE, focusedSnapshot('outside_scope')),
    confirmBaseline: () => { throw new Error('You no longer have access to these documents.'); },
  });
  await app.until(() => app.text().includes('Linked text matches; other content changed'), 'focused source');
  await app.click('Review linked passages');
  await app.event(app.approval(), 'onChange', { target: { checked: true } });
  await app.click('Save reviewed passage link');
  assert.ok(app.text().includes('You no longer have access to these documents.'));
  assert.ok(!app.text().includes(SOURCE_QUOTE));
  assert.ok(!app.text().includes(REQUIREMENT_QUOTE));
  assert.equal(app.nodes('TextArea').length, 0);
  assert.equal(app.nodes('CodeBlock').length, 0);
  assert.equal(app.approvals().length, 0);
});

for (const reviewScope of [undefined, { mode: 'unknown' }, { mode: 'passage', sourceQuote: SOURCE_QUOTE, requirementQuote: '' }]) {
  const label = reviewScope === undefined ? 'missing' : reviewScope.mode === 'unknown' ? 'unknown' : 'incomplete passage';
  test(`a ${label} server review scope cannot become an approvable baseline`, async t => {
    const app = await renderApp(t, {
      loadTrackedSource: () => ({ tracked: true, ...snapshot('source_changed') }),
      prepareBaseline: () => ({ ...preview('source_changed'), reviewScope }),
    });
    await app.until(() => app.text().includes('Source changed since review'), 'tracked source');
    await app.click('Review current version');
    assert.ok(app.nodes('SectionMessage').some(node => node.props.appearance === 'error'));
    assert.equal(app.approvals().length, 0);
    assert.equal(app.nodes('CodeBlock').length, 0);
    assert.ok(!app.calls.some(call => call.name === 'confirmBaseline'));
  });
}
