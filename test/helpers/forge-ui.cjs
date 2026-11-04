const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { build } = require('esbuild');

// Exercise the browser bundle with the installed React and Forge reconciler.
// Only the host bridge is replaced: actions call the same component callbacks
// that UI Kit sends to the host, and resolver requests cross the real invoke API.
const bundlePromises = new Map();
function frontendBundle(entryPath) {
  const absoluteEntry = path.resolve(__dirname, '../..', entryPath);
  if (!bundlePromises.has(absoluteEntry)) bundlePromises.set(absoluteEntry, build({
    entryPoints: [absoluteEntry],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  }).then(result => result.outputFiles[0].text));
  return bundlePromises.get(absoluteEntry);
}

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const pause = () => new Promise(resolve => setImmediate(resolve));

async function renderApp(t, handlers, { entryPath = 'src/frontend.jsx' } = {}) {
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
  vm.runInContext(await frontendBundle(entryPath), context, { filename: 'frontend.bundle.js', timeout: 3000 });

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
  function checkbox(name) {
    const node = nodes('Checkbox').find(item => item.props.label === name);
    assert.ok(node, `Checkbox not rendered: ${name}`);
    return node;
  }
  function approvals() { return nodes('Checkbox').filter(node => node.props.label?.startsWith('I reviewed ')); }
  function approval() {
    assert.equal(approvals().length, 1, 'Exactly one explicit review approval must be rendered');
    return approvals()[0];
  }
  async function passageInput(id, value) {
    const node = nodes('TextArea').find(item => item.props.id?.endsWith(`-${id}`));
    assert.ok(node, `Passage text area not rendered: ${id}`);
    await event(node, 'onChange', { target: { type: 'textarea', value } });
  }
  return { calls, nodes, text, button, until, settle, event, click, input, checkbox, approvals, approval, passageInput };
}


module.exports = { renderApp };
