import api, { route } from '@forge/api';
import { kvs, Filter, FilterConditions } from '@forge/kvs';
import Resolver from '@forge/resolver';
import spike from './spike.cjs';
import drift from './drift.cjs';

const { createSpike, SpikeError, sourceFromPage } = spike;
const { createDrift } = drift;
const resolver = new Resolver();

async function checked(response, product, expected = 200) {
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new SpikeError('ACCESS_DENIED', `${product} access failed (${response.status}). Check your permissions, app consent, and that both products are connected on this site.`);
  }
  if (response.status === 429) throw new SpikeError('RATE_LIMITED', `${product} is rate limited. Wait and retry the read. Never blindly retry a write.`);
  if (response.status !== expected) throw new SpikeError('UPSTREAM_ERROR', `${product} returned ${response.status}. No successful write has been confirmed.`);
  return response.json();
}

const gateway = {
  async readSite() {
    const response = await api.asUser().requestJira(route`/rest/api/3/serverInfo`);
    return (await checked(response, 'Jira')).baseUrl;
  },
  async readIssue(issueId) {
    const response = await api.asUser().requestJira(route`/rest/api/3/issue/${issueId}?fields=summary,updated,description`);
    const issue = await checked(response, 'Jira');
    return { id: issue.id, key: issue.key, summary: issue.fields?.summary, updated: issue.fields?.updated, description: issue.fields?.description ?? null };
  },
  async readSource(pageId, origin) {
    const response = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format`);
    const page = await checked(response, 'Confluence');
    return sourceFromPage(page, origin);
  },
  async readSourceVersion(pageId, origin, version) {
    const response = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}?version=${version}&body-format=atlas_doc_format`);
    const page = await checked(response, 'Confluence history');
    return sourceFromPage(page, origin, { expectedVersion: version });
  },
  async postComment(issueId, body, previewId) {
    const response = await api.asUser().requestJira(route`/rest/api/3/issue/${issueId}/comment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ body, properties: [{ key: 'decision-drift.review', value: { previewId, kind: 'source-reference' } }] })
    });
    return checked(response, 'Jira comment', 201);
  }
};

const store = {
  get: key => kvs.get(key),
  put: (key, value) => kvs.set(key, value, { ttl: { unit: 'DAYS', value: 1 } }),
  async claim(key, value) {
    try {
      await kvs.set(key, value, { keyPolicy: 'FAIL_IF_EXISTS', ttl: { unit: 'DAYS', value: 1 } });
      return true;
    } catch (error) {
      if (await kvs.get(key)) return false;
      throw error;
    }
  }
};

const service = createSpike({ gateway, store });
const entityName = 'decision-baseline';
const baselineStore = {
  get: key => kvs.entity(entityName).get(key),
  async compareAndSet(key, expectedRevision, value) {
    const conditions = new Filter().and('revision', expectedRevision === 0
      ? FilterConditions.notExists() : FilterConditions.equalTo(expectedRevision));
    try {
      // No TTL: baselines outlive expiring previews. The condition and write are atomic.
      await kvs.transact().set(key, value, { entityName, conditions }).execute();
      return true;
    } catch (error) {
      // Never treat quota/validation/outage failures as successful conditional writes.
      const current = await kvs.entity(entityName).get(key);
      if ((current?.revision ?? 0) !== expectedRevision) return false;
      throw error;
    }
  }
};
const decisionService = createDrift({ gateway, store, baselineStore });
const handlers = { ...service, ...decisionService };
for (const name of Object.keys(handlers)) {
  resolver.define(name, async ({ context, payload }) => {
    try {
      return await handlers[name](context, payload);
    } catch (error) {
      if (error instanceof SpikeError) throw new Error(`${error.code}: ${error.message}`);
      // SDK consent errors must propagate so Forge can request current-user consent.
      throw error;
    }
  });
}

export const handler = resolver.getDefinitions();
