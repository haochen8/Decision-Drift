const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { build } = require('esbuild');

// Exercise the browser bundle with the installed React and Forge reconciler.
// Only the host bridge is replaced: actions call the same component callbacks
// that UI Kit sends to the host, and resolver requests cross the real invoke API.
let bundlePromise;
function frontendBundle() {
  bundlePromise ??= build({
    entryPoints: [path.join(__dirname, '../src/frontend.jsx')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  }).then(result => result.outputFiles[0].text);
  return bundlePromise;
}

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const pause = () => new Promise(resolve => setImmediate(resolve));

async function renderApp(t, handlers) {
  const calls = [];
  const errors = [];
  const timers = new Set();
  const immediates = new Set();
  let tree;
  let disposed = false;
  let reconcileCount = 0;
  const bridge = {
    callBridge(command, data) {
      if (disposed) return Promise.resolve();
      if (command === 'reconcile') {
        // Catch transport serialization failures, including circular React fibers.
        JSON.stringify(data.forgeDoc);
        tree = data.forgeDoc;
        reconcileCount += 1;
        return Promise.resolve();
      }
      if (command === 'onError') {
        errors.push(data.error);
        return Promise.resolve();
      }
      if (command === 'invoke') {
        const { functionKey, payload } = data;
        calls.push({ name: functionKey, payload: clone(payload) });
        return Promise.resolve().then(() => {
          if (typeof handlers[functionKey] !== 'function') {
            const error = new Error(`Unexpected resolver: ${functionKey}`);
            errors.push(error);
            throw error;
          }
          return handlers[functionKey](clone(payload));
        });
      }
      throw new Error(`Unexpected host bridge command: ${command}`);
    },
  };
  const sandbox = {
    __bridge: bridge,
    console: { ...console, error: (...args) => errors.push(args) },
    crypto: webcrypto,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    performance,
    structuredClone,
    queueMicrotask,
    setTimeout(callback, delay, ...args) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!disposed) callback(...args);
      }, delay);
      timer.unref();
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
    setImmediate(callback, ...args) {
      const immediate = setImmediate(() => {
        immediates.delete(immediate);
        if (!disposed) callback(...args);
      });
      immediates.add(immediate);
      return immediate;
    },
    clearImmediate(immediate) { immediates.delete(immediate); clearImmediate(immediate); },
  };
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  t.after(() => {
    disposed = true;
    for (const timer of timers) clearTimeout(timer);
    for (const immediate of immediates) clearImmediate(immediate);
    assert.deepEqual(errors, [], 'React/Forge runtime reported an error');
  });
  vm.runInContext(await frontendBundle(), context, { filename: 'frontend.bundle.js', timeout: 3000 });

  function nodes(type) {
    const found = [];
    function visit(node) {
      if (node.type === type) found.push(node);
      for (const child of node.children || []) visit(child);
    }
    if (tree) visit(tree);
    return found;
  }
  function label(node) {
    return [node.props?.text || '', ...(node.children || []).map(label)].join('');
  }
  function text() {
    return nodes('String').map(node => node.props.text).join('\n') + '\n' +
      nodes('CodeBlock').map(node => node.props.text).join('\n');
  }
  function button(name) {
    const match = [...nodes('LoadingButton'), ...nodes('Button')].find(node => label(node) === name);
    assert.ok(match, `Button not rendered: ${name}\n${text()}`);
    return match;
  }
  async function until(predicate, description) {
    const end = Date.now() + 2000;
    while (!predicate() && Date.now() < end) await pause();
    assert.ok(predicate(), `Timed out waiting for ${description}\n${text()}`);
    assert.deepEqual(errors, [], 'React/Forge runtime reported an error');
  }
  async function settle() {
    // Flush passive effects and promise continuations, including nested updates.
    for (let i = 0; i < 6; i += 1) await pause();
    assert.deepEqual(errors, [], 'React/Forge runtime reported an error');
  }
  async function event(node, prop, value) {
    assert.equal(typeof node.props[prop], 'function', `${node.type}.${prop} must be callable`);
    await node.props[prop](value);
    await settle();
  }
  async function click(name) {
    const node = button(name);
    assert.ok(!node.props.isDisabled, `${name} is disabled`);
    if (node.props.type === 'submit') {
      const [form] = nodes('Form');
      assert.ok(form, 'Submit button must have a form');
      await event(form, 'onSubmit', { preventDefault() {}, persist() {} });
    } else await event(node, 'onClick');
  }
  async function input(value) {
    const [node] = nodes('Textfield');
    assert.ok(node, 'Source input must be rendered');
    await event(node, 'onChange', { target: { type: 'text', name: 'pageInput', value } });
  }
  await until(() => reconcileCount > 0, 'initial Forge reconciliation');
  await settle();
  return { calls, nodes, text, button, until, settle, event, click, input };
}

function snapshot(status = 'unreviewed', overrides = {}) {
  return {
    issue: { id: '10001', key: 'DD-1', summary: 'Review export policy', updated: '2026-10-29T15:00:00Z' },
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
  };
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
  const checkbox = app.nodes('Checkbox')[0];
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
  assert.equal(app.nodes('Checkbox').length, 0);
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
  assert.equal(app.nodes('Checkbox')[0].props.label, 'I reviewed page 12345 at version 1 for DD-1.');
  await app.event(app.nodes('Checkbox')[0], 'onChange', { target: { checked: true } });
  await app.click('Save reviewed version');

  const notice = app.nodes('SectionMessage').find(node => node.props.title === 'Review already saved');
  assert.ok(notice, 'An idempotent receipt must be labeled as already saved');
  const renderedText = node => [node.props?.text || '', ...(node.children || []).map(renderedText)].join('');
  assert.ok(renderedText(notice).includes('Page 12345 at version 1 is the saved comparison point for DD-1.'));
  assert.ok(!renderedText(notice).includes('version 2'), 'Current source version must not be presented as the saved baseline');
  assert.ok(app.text().includes('Source changed since review'), 'Fresh source state must remain visible beside the earlier receipt');
  assert.equal(app.button('Review current version').props.isDisabled, false);
  assert.equal(app.nodes('Checkbox').length, 0);
});

test('a save response without a confirmed baseline cannot display a successful review receipt', async t => {
  const app = await renderApp(t, {
    loadTrackedSource: () => ({ tracked: true, ...snapshot('source_changed') }),
    prepareBaseline: () => preview('source_changed'),
    confirmBaseline: () => snapshot(),
  });
  await app.until(() => app.text().includes('Source changed since review'), 'tracked source');
  await app.click('Review current version');
  await app.event(app.nodes('Checkbox')[0], 'onChange', { target: { checked: true } });
  await app.click('Save reviewed version');
  assert.ok(app.text().includes('The saved review was not confirmed.'));
  assert.ok(!app.nodes('SectionMessage').some(node => ['Reviewed version saved', 'Review already saved'].includes(node.props.title)));
  assert.equal(app.nodes('Checkbox').length, 0);
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
  await app.event(app.nodes('Checkbox')[0], 'onChange', { target: { checked: true } });
  assert.equal(app.button('Save reviewed version').props.isDisabled, false);

  await app.input('67890');
  assert.equal(app.nodes('Checkbox').length, 0);
  assert.ok(!app.text().includes('Restricted decision title'));
  assert.ok(!app.text().includes('Only admins may export the source records.'));
  await app.click('Check source');
  await app.click('Review current version');
  assert.ok(app.text().includes('Different decision evidence.'));
  assert.equal(app.nodes('Checkbox')[0].props.isChecked, false);
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
  assert.equal(app.nodes('Checkbox').length, 0);
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
  await app.event(app.nodes('Checkbox')[0], 'onChange', { target: { checked: true } });
  await app.click('Save reviewed version');
  assert.ok(app.text().includes('Source access was revoked before this review could be saved.'));
  assert.ok(!app.text().includes('Restricted decision title'));
  assert.ok(!app.text().includes('Only admins may export the source records.'));
  assert.ok(!app.text().includes('All members may export the source records.'));
  assert.equal(app.nodes('CodeBlock').length, 0);
  assert.equal(app.nodes('Checkbox').length, 0);
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
  assert.equal(app.nodes('Checkbox')[0].props.isDisabled, true);
  await app.event(app.nodes('Checkbox')[0], 'onChange', { target: { checked: true } });
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
  await app.event(app.nodes('Checkbox')[0], 'onChange', { target: { checked: true } });
  await app.click('Cancel review');
  assert.equal(app.nodes('Checkbox').length, 0);
  assert.ok(app.text().includes('Source changed since review'));
  assert.ok(!app.calls.some(call => call.name === 'confirmBaseline'));
  await app.click('Review current version');
  assert.equal(app.nodes('Checkbox')[0].props.isChecked, false);
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
  assert.equal(app.nodes('Checkbox')[0].props.label, 'I reviewed this exact note and approve adding it to DD-1.');
  assert.equal(app.button('Add reviewed Jira note').props.isDisabled, true);
  await app.event(app.button('Add reviewed Jira note'), 'onClick');
  assert.ok(!app.calls.some(call => call.name === 'applyUpdate'));
  await app.event(app.nodes('Checkbox')[0], 'onChange', { target: { checked: true } });
  await app.click('Add reviewed Jira note');
  assert.deepEqual(app.calls.at(-1), {
    name: 'applyUpdate', payload: { previewId: prepared.previewId, approved: true },
  });
  assert.ok(app.nodes('SectionMessage').some(node => node.props.title === 'Jira note added'));
  assert.ok(app.text().includes('Comment 50001 on DD-1 references source version 3.'));
  assert.ok(!app.calls.some(call => call.name === 'confirmBaseline'));
  assert.equal(app.nodes('Checkbox').length, 0);
});
