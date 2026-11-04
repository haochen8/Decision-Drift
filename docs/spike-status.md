# Technical spike status

## Current feature evidence — November 4, 2026

The **core selected review queue sequence PASSED live in regular Chrome on development 2.5.0**. It adds a native Jira project page for one to eight unique current-project issue keys. Deployment succeeded at `2026-11-04T09:44:45.003Z` / 10:44:45.003 CET, and the existing major-version-2 Jira/Confluence installation is up to date. Three mixed live batches verified existing reviewed sources alongside a nonexistent-issue partial failure, with no fixture, baseline, description or comment writes. Earlier 2.4.0 issue-panel evidence remains separately dated below.

- The resolver requires trusted project-page context and freshly verifies the project, then resolves each canonical issue as the signed-in user and checks its actual project ID/key. Caller-supplied project IDs, issue IDs and site URLs do not authorize access.
- A server-only tracking reader reuses the existing reviewed-source and passage logic with the already authorized Jira snapshot. It is not exposed as a resolver. The queue returns only selected keys, fresh authorized summaries, status/reason, reviewed/current versions, checked-at time and an issue link; it returns no source body, title, quotations, fingerprints or account IDs.
- The five states are Matches review, Context changed, Needs review, Source not linked and Could not verify. Only a confirmed absent baseline becomes Source not linked. Permission, history, storage, service and rate-limit failures retain unresolved states; Forge consent errors propagate to the host.
- The page clears results when editing or refreshing, rejects malformed responses, ignores obsolete responses and waits for a pending batch before allowing another check. Runtime review caught and fixed result validation for mismatched issue identity, missing timestamps, a false matching state with inaccessible metadata and a mismatched project.
- Each explicit batch has at most eight issue checks and two workers, with one project read and one site read. Worst-case product reads are 26, plus eight baseline reads. No polling, automatic retry, writes, new scopes, storage entity, dependency, AI service or billing change is introduced.
- Local verification includes 131 checks: the prior 97 plus 17 queue integration tests and 17 queue UI/runtime journeys. Compilation of both native frontends, official Forge lint and whitespace checks pass. Local product/storage boundaries remain simulated.

The tested implementation is published on GitHub as [41bbc26](https://github.com/haochen8/Decision-Drift/commit/41bbc26). GitHub's Git transport rejected three ordinary fast-forward pushes with internal server errors. The authorized fallback created an API commit with the same reviewed file tree, `a9960918afba2abcf856c28c2172825a7ae15c7c`, and advanced main with an expected-parent check. The checkout was synchronized after verifying identical trees; the original local deployment commit `3f59e3e` remains on the local backup branch `codex/review-queue-local-3f59e3e`.

### November 4 core live queue evidence

| Check | Status | Observed evidence and limit |
| --- | --- | --- |
| Native project navigation | Passed — regular Chrome | Opened Decision Drift through the actual Jira project sidebar route |
| Mixed partial-success batches | Passed — three completed checks | Server check times **10:56:46**, **10:57:34** and **10:58:04 CET**; DD-1 Matches review at `2/2`, DD-2 at `4/4`, nonexistent DD-999999 Could not verify |
| Unavailable-issue response | Passed — nonexistent issue only | DD-999999 displayed no summary, reviewed/current versions or issue link; this was not a denied-user test |
| Selection validation | Passed — live client/server gates | Duplicate and ninth-key inputs disabled checking; OTHER-1 was rejected by the server with `WRONG_PROJECT` |
| Selection edit | Passed — native UI | Editing the selection cleared existing results |
| Explicit refresh | Passed — native UI | Rows and counters cleared while the check was pending, then fresh results loaded |
| Issue navigation destination | Target verified; new-tab creation not verified | Row link href and manually opened Jira issue destination verified; automation could not locate a new tab after clicking the row action |
| Independent read-only confirmation | Passed — authenticated Jira API comparison | Both descriptions exactly unchanged; DD-1 comments `1 → 1`, DD-2 `0 → 0`; no fixture edits or reviews saved |
| Denied-user / inaccessible-Confluence behavior | Not run live | A deliberately nonexistent Jira issue does not establish these permission cases |
| All five queue states | Not run live | These batches established Matches review and Could not verify; the complete synthetic state set remains to verify |
| Controlled late-response / concurrency races | Not run live | Local/runtime coverage remains separate from controlled live timing |

See the [sanitized queue record](evidence/2026-11-04-queue-review.json). The regular-profile issue panel still has its previously observed loading issue; the project queue works in that profile. Incognito issue-panel recovery is in progress, with no new result claimed here. No payment, billing, subscription, seat, scope or security setting was changed.

An earlier attempt did not start: the browser extension was unavailable and native Chrome input was stopped before navigation after fresh-state recovery. No queue request or write ran during that attempt. Browser control subsequently resumed and the successful sequence above supersedes that prerequisite as the current status.

The next feature is a reproducible four-issue synthetic judge demo kit, with setup/reset instructions for all important queue states. A separate-site installation and remaining live failure checks follow. The older selected-queue plan below is retained as the plan that led to this implementation.

## Earlier feature evidence — November 3, 2026

Current status: **the core exact source-to-Jira-description passage-link sequence PASSED live in Chrome Incognito on development version 2.4.0**. Source commit [cf7c56c](https://github.com/haochen8/Decision-Drift/commit/cf7c56c) is pushed. The fresh DD-2/page 1605635 fixture passed explicit passage save, full-reload restoration, preview-approval invalidation, context-change reporting, duplicate rejection and explicit rereview of edited linked text. Its final published/reviewed source version is **4/4**; an independent Jira API comparison confirmed the description was exactly unchanged and comments stayed at **0**. DD-1/page 557057/version 2 was not edited.

Earlier November 3 result: **the persistent source-review create, advance, reopen and historical-diff sequence PASSED live in Chrome Incognito on development version 2.3.0**. The operator explicitly reviewed and saved source version 1, verified automatic restoration after a full issue reload, published one synthetic constraint change as version 2, inspected the exact historical text difference, reviewed version 2 and verified restoration again. An independent Jira API read confirmed the original description was exactly unchanged and the only comment remained `10003`. Source page `557057` remains published and reviewed at **version 2**. The source change [1c8adab](https://github.com/haochen8/Decision-Drift/commit/1c8adab) was pushed to [haochen8/Decision-Drift](https://github.com/haochen8/Decision-Drift). October 29 evidence remains separately dated below.

### Passage-link implementation and review

- A reviewer selects an exact, unique Confluence decision passage and an exact, unique requirement passage from the **Jira description only**. Both are checked on the server against complete supported text; Jira summary text is not a requirement field for this feature.
- Durable focus metadata stores `schemaVersion`, `requirementField: description`, offsets, lengths and passage hashes. It stores no source or Jira passage plaintext. The existing metadata-only reviewed baseline and current-user permission checks remain in use.
- Checks recover exact, unique text after it shifts position. Edited or missing passages need review; duplicates are ambiguous; incomplete or inaccessible current text and unverifiable source history make the link unavailable. These outcomes must not be presented as established decision alignment.
- `outside_scope` is displayed as **Context changed**: both exact passages still appear once, but other content or version context changed. The reviewer must inspect surrounding changes. This status does not guarantee that a surrounding change is semantically irrelevant.
- Each preview requires explicit approval of its scope and passages. Editing either passage or switching between passage and whole-page tracking clears that preview and its approval; replacing an existing passage link with whole-page tracking requires a fresh review.
- All 97 local checks passed: 15 original comment-spike, 40 reviewed-source/passage integration, 9 passage matching, 9 source parsing and 24 real bundled React/UI Kit journeys. Compilation, official Forge lint and whitespace checks passed. Independent backend and product-flow reviews found and fixed storage-key-order equality, incomplete preview-scope validation and recovery-copy issues. Product/storage boundaries are simulated locally; the observed live results are recorded separately below.

### November 3 version 2.4.0 verification evidence

| Check | Status | Observed evidence and limit |
| --- | --- | --- |
| Source change | Pushed | Commit `cf7c56c`, exact decision-to-description passage linking |
| Local checks and review | Passed | 97 tests, compilation and official Forge lint; independent review findings fixed as described above |
| Development deployment | Passed — CLI success | Version `2.4.0`, deployed `2026-11-03T19:07:34.215Z` / 20:07:34.215 CET |
| Custom Entity and installation | Active / up to date | `decision-baseline` index ACTIVE; existing installation `7ca78514-4089-4bc2-b3fa-969ef8f72a46` at major version 2, Jira and Confluence connected; same scopes |
| Fresh synthetic fixture | Created and inspected | Jira `DD-2`, ID `10042`; source `1605635`, title **Decision Drift passage demo**; DD-1/page 557057 not edited |
| Version 1 passage save | Passed — explicit approval | Source constraint linked to Jira description passage; save receipt at **20:10:15 CET** |
| Version 1 durable restoration | Passed — full issue reload | Source ID and exact linked quotes restored automatically, reviewed/published `1/1` |
| Preview approval invalidation | Passed — native UI | Save enabled only after checking approval; editing the source quote revoked preview and approval; the fresh preview started unapproved |
| Version 2 context change | Passed — live recheck | Rollout changed November to December; both linked passages remained exact and unique; `outside_scope` / Context changed and the historical rollout difference displayed |
| Version 3 duplicate constraint | Passed — ambiguity gate | Duplicating the linked source constraint produced `focus_ambiguous`; Review linked passages failed with `AMBIGUOUS_PASSAGE` and no approval |
| Version 4 edited linked text | Passed — review required | Reworded constraint produced `focus_changed`; current source selection was empty, Jira quote freshly matched and historical text difference displayed |
| Version 4 explicit rereview | Passed — new selection and approval | New constraint explicitly paired with the same Jira description passage and saved at **20:12:38 CET** |
| Version 4 durable restoration | Passed — full issue reload | Source and exact new quotes automatically restored; reviewed/published `4/4`, unchanged |
| Jira unchanged by passage reviews | Passed — independent authenticated browser API comparison | DD-2 description JSON exactly equal before/after; comment count remained `0` |
| Live moved-text and unavailable/denied evidence | Not run | Local coverage does not establish these live cases |
| Live stale/expired/concurrent/replay cases | Not run | No live result claimed for stale or expired reviews, conflicting reviewers, replay or uncertain transaction recovery |
| Billing, licensing, scopes and security settings | Unchanged | No billing, payment, product-seat, subscription, scope or security-setting change; no external model service |

The version 4 source edit was:

```diff
-Constraint: Export is available to project members only.
+Constraint: Only project members may export CSV data.
```

The reviewer explicitly linked the new source text to the unchanged Jira description passage, `CSV export is available to project members only.` Exact matching detected the wording change; it did not determine semantic agreement. The final review timestamp is **2026-11-03 20:12:38 CET**. See the [sanitized live passage-review record](evidence/2026-11-03-passage-review.json). No Jira comment was created by either baseline save. No external AI service was used for passage matching.

### Live-verified version 2.3.0 behavior and review

- `loadTrackedSource`, `inspectDecisionSource`, `prepareBaseline` and `confirmBaseline` add source inspection, explicit baseline review and automatic restoration of the source tracked for a Jira issue.
- One shared baseline per Jira issue is stored in the durable `decision-baseline` Custom Entity. Conditional compare-and-set transactions check its revision before replacement. Baselines have no TTL and retain metadata, reviewer identity and fingerprints rather than source titles or body text; review previews remain a separate expiring record.
- Current and historical source text is read afresh with `asUser()` permissions. The historical page ID, version and content/text hashes must match the reviewed metadata before displaying an ordered line comparison. Differences are bounded; inaccessible, incomplete or unverifiable history remains unresolved. Text changes are not a semantic requirements verdict.
- Saving a baseline updates review metadata only. Optional source-linked Jira notes retain their own exact preview and approval; they are a separate action.
- Independent reviews found and fixed the unsupported `useForm` `setValue` call during auto-load, a replay receipt that could identify the current rather than reviewed source version, and a misleading history warning when inspecting a different page. Regression tests cover the fixes.

The feature uses the existing scopes and adds no external model service. No model billing, payment method, billing setting, licensed seat, subscription or scope change was made for this update.

### November 3 version 2.3.0 verification evidence

| Check | Status | Observed evidence and limit |
| --- | --- | --- |
| Source change | Pushed | Commit `1c8adab`, persistent source-review tracking and version drift, in the renamed canonical repository |
| Independent implementation reviews | Completed; findings fixed | Auto-load form API, reviewed-version replay receipt and different-page history warning corrected with regression coverage |
| Local test suite | Passed — 56 checks | 15 original spike + 24 drift + 6 source + 11 real bundled UI/runtime checks; product/storage boundaries are simulated |
| Local manifest/compilation check | Passed | `npm run check` |
| Official Forge lint | Passed | Official Forge linter reported no issues |
| Development deployment | Passed — CLI success | Version `2.3.0`, deployed `2026-11-03T17:17:59.773Z` / 18:17:59.773 CET |
| Custom Entity readiness | Active | `decision-baseline` entity, `by-key` index **ACTIVE**; actual create/advance and persistence results are separately recorded below |
| Existing installation | Up to date at major version 2 | Installation `7ca78514-4089-4bc2-b3fa-969ef8f72a46`, Jira required and Confluence connected |
| Browser control and Incognito authentication | Available — live sequence performed | User explicitly approved resuming control; the operator used the authenticated native Chrome Incognito form |
| Version 2.3.0 native browser UI | Passed in Incognito | Actual source inspection, review, save, recheck and full-reload restoration were operated; normal-profile loading remains unresolved |
| Fresh source inspection | Passed — live Forge UI | Page `557057` initially showed Not reviewed, published version 1 and the exact synthetic source body |
| Version 1 baseline save | Passed — explicit approval | Review version 1 displayed; Save reviewed version disabled with checkbox unchecked; after review/approval one save returned a version 1 receipt at **19:00:53 CET** |
| Version 1 durable restoration | Passed — full issue reload | Cmd+R automatically restored source ID `557057`, Source unchanged since review, reviewed/published `1/1` and the same review timestamp; no page ID retyping |
| Synthetic page publication | Passed — Confluence editor and published page | Only the constraint changed from project admins only to project members only; Update/Uppdatera published version 2, with updated notification and new body verified |
| Historical source comparison | Passed — live app recheck | Source changed since review, reviewed/published `1/2`; What Changed displayed the exact removed admin-only line and added member-only line after the historical page/version/hash checks |
| Version 2 baseline save | Passed — explicit approval | Review version 2, checkbox approval and one save returned a version 2 receipt at **19:04:19 CET**, explicitly saying no Jira comment was posted |
| Version 2 durable restoration | Passed — full issue reload | Cmd+R automatically restored `557057`, Source unchanged since review, reviewed/published `2/2` and the same 19:04:19 review timestamp |
| Jira unchanged by baseline saves | Passed — independent authenticated browser API comparison | Issue `10009` / `DD-1`; description JSON exactly equal before/after; comment count stayed `1`, with only ID `10003` |
| Live concurrent/conflicting reviewers and replay | Not run | Successful baseline create/advance does not establish competing-reviewer, replay or uncertain-transaction recovery behavior |
| Live expired/stale/denied-user cases | Not run | Local coverage remains separate; no live result claimed for these cases |
| Billing, licensing and scopes | Unchanged | No additional model service, payment, billing, seat, subscription or scope change |

The exact synthetic edit, with the title, CSV-export decision and synthetic-evidence line unchanged, was:

```diff
-Constraint: Export is available to project admins only.
+Constraint: Export is available to project members only.
```

The version 1 save receipt identified page `557057` as the comparison point for `DD-1` and said no Jira comment was posted; the version 2 receipt did the same for version 2. Both saves were followed by full issue reloads, not just reuse of the in-memory screen. The final state is published/reviewed version **2/2**, with the member-only constraint and last review at **2026-11-03 19:04:19 CET**.

See the [sanitized live source-review record](evidence/2026-11-03-source-review.json). Private screenshots remain ignored and local: `docs/evidence/2026-11-03-baseline-v1-private.jpg`, `docs/evidence/2026-11-03-source-drift-private.jpg` and `docs/evidence/2026-11-03-baseline-v2-private.jpg`. They are not public evidence attachments or commit inputs.

Earlier in this run, a browser-control call aborted before dispatch and a fresh Incognito window required sign-in. Those prerequisites were resolved before the live sequence above. The normal-profile loading problem remains unexplained; the successful Incognito run does not identify an extension or setting as its cause.

### Next verification and feature

The core [Persistent source review verification](atlassian-setup.md#persistent-source-review-verification) sequence is complete on this development site. No additional Jira comment was required or created. Live concurrency, replay, expired/stale approvals, denied-user behavior and separate-site production judge installation remain later verification work; they are not marked passed by this sequence.

The core [passage review](../README.md#verification-status) sequence is complete on DD-2/page 1605635 at version 4. Live moved-text, unavailable/denied-evidence, stale/expired, concurrent and replay checks remain pending alongside production judge installation.

### November 3 queue plan — historical

The next feature planned on November 3 was a [selected review queue](../README.md#next-features-and-winning-strategy), a read-only native Jira project page for at most eight unique issue keys selected manually from the current project. The server would resolve each key as the viewer, verify its project and derive its issue ID before bounded current-permission source checks. Rows would show an authorized summary, reviewed/current versions, an Open issue action and one of Matches review, Context changed, Needs review, Source not linked or Could not verify. This describes a bounded selection rather than complete release coverage or a release-readiness verdict.

The plan required minimal responses with no source bodies or hashes, partial row errors, clearing old results after selection edits or refresh, and ignoring late results for obsolete selections. Each issue would keep its existing explicit review flow without queue-wide approval. Persistent private named selections, storing issue IDs only, were a possible later extension. The November 4 implementation and verification status are recorded at the top of this document.

## Historical record — October 29, 2026

Date: October 29, 2026 (Europe/Stockholm).

Development site supplied by the user: `decision-drift.atlassian.net`. The app is deployed in **MyDevSpace** (ID `9a51ac9c-b744-4082-b6b8-02df00013d27`) and connected to Jira and Confluence. Forge-mediated current-user reads, persisted preview, explicit approval and one additive Jira comment have now been verified in Incognito.

## Live evidence record — October 29, 2026

Status: **core access-and-reviewed-write spike PASSED in Incognito on DD-1**. The installed development app **2.2.0** read Jira and Confluence as the signed-in user, persisted and displayed an exact review preview, required explicit approval, and created comment **10003**. An independent browser API read confirmed exactly one comment and the unchanged issue description. The normal-browser skeleton remains an unresolved environment difference; the failed site-only AdBlock test and verified restoration are preserved below. Live stale/expiry/replay/denied-user checks and production judge distribution remain pending.

The operator confirms that **no payment method, billing setting, licensed seat or subscription was changed**. Deployment and installation used no payment or billing flags. Acceptance of the mandatory agreement was separately approved by the user; it does not mean a payment method was added or a paid product subscription was purchased. Writing this record performs no account actions.

### Run identifiers

| Field | Recorded value |
| --- | --- |
| Evidence date / timezone | October 29, 2026 / Europe/Stockholm |
| Site | `https://decision-drift.atlassian.net` — supplied by the user |
| Authenticated CLI identity | `Hao` — successful `forge whoami`, reported by the operator |
| Developer Space | `MyDevSpace` / `9a51ac9c-b744-4082-b6b8-02df00013d27` — confirmed by CLI list and previously observed in browser |
| Forge app ID | `e4d59fe8-4c16-485f-8206-bbd5072713dd` — registration succeeded |
| Forge environment | `development` — deployment succeeded |
| Source code revision / build identifier | Pending deployment evidence |
| Deployment version / ID / observed time | Latest successful development deployment `2.2.0` (full frontend restored); latest timestamp/ID not reported. Initial `2.0.0` timestamp: `2026-10-29T19:08:35.022Z` (20:08:35.022 CET) |
| Forge installation ID | `7ca78514-4089-4bc2-b3fa-969ef8f72a46` — last installation-list check confirmed up-to-date major version 2; no newer list result reported |
| Jira product connection / installation | Installed as required product on `decision-drift.atlassian.net`, environment `development`; installation-list confirmation recorded |
| Confluence product connection / installation | Connected on that same site/environment; installation-list confirmation recorded |
| Installed app scopes | `read:jira-work`, `write:jira-work`, `read:page:confluence`, `storage:app` |
| Jira fixture project | Restricted Jira Service Management space **Decision Drift Test**, key `DD`, containing fixture DD-1; project URL not yet captured |
| Jira issue key / URL | [DD-1 — Validate reviewed source access](https://decision-drift.atlassian.net/browse/DD-1) — synthetic issue created after the project-role fix |
| Jira issue ID | `10009` — confirmed by authenticated browser API GET |
| Jira fixture description | `This synthetic work item tests Decision Drift. Add a reviewed source link as a comment. Keep this description unchanged.` |
| Published source page ID / URL | `557057` — published [Decision Drift spike source](https://decision-drift.atlassian.net/wiki/pages/viewpage.action?pageId=557057) in the personal space; synthetic body matches the runbook |
| Source version inspected / reviewed | Page `557057`, version **1**, verified through Forge `asUser()` inspection in Incognito and separately through browser API |
| Review ID / preview expiry | `04620db9-e451-4283-8d03-ab571f4aa10c`; preview expiry `2026-10-29T20:41:39+01:00` |
| Jira comment ID / URL | [Comment 10003 on DD-1](https://decision-drift.atlassian.net/browse/DD-1?focusedCommentId=10003); created `2026-10-29T20:32:30.579+0100` |
| Independent comment count | `0` immediately after preview; exactly `1` after approved apply |
| Loading-panel screenshot | [Live panel loading evidence](evidence/live-panel-loading.jpg) |
| Incognito success screenshot | `docs/evidence/live-review-success.jpg` — retained locally; browser bookmarks excluded from Git |
| Independent Jira UI screenshot | `docs/evidence/live-jira-comment.jpg` — retained locally; browser bookmarks excluded from Git |
| Sanitized result record | [Live review result JSON](evidence/live-review-result.json) — no email or account IDs |
| Incognito review-form render | Operator verified the working form and complete inspect/preview/approve/apply flow through native Chrome UI |
| Production judge installation link | Pending; separate from development installation |
| Billing/payment settings | Operator confirms no payment method added and no billing/payment settings modified; mandatory registration agreement accepted after explicit user approval |

Do not record an API token, login credential, cookie or private source excerpt here. App IDs, synthetic fixture links and review/comment identifiers are sufficient to connect the evidence.

### Jira permission finding and resolution

The operator reports these results from Jira's `mypermissions` check for project key `DD`:

| Permission | Initial result | After project-role fix |
| --- | --- | --- |
| `BROWSE_PROJECTS` | `false` | `true` |
| `CREATE_ISSUES` | `false` | `true` |
| `EDIT_ISSUES` | `false` | `true` |
| `ADD_COMMENTS` | `false` | `true` |

The project's People page initially showed Hao in **Administrators**, with no **Service Desk Team** membership. Admin user-detail inspection confirmed Hao already had Jira Standard User, Jira Service Management/Service Collection Standard User (agent), and Confluence Standard User access. The operator then added that existing account to the `DD` project's **Service Desk Team** role while retaining **Administrators**. Reloading the permission endpoint returned `true` for all four permissions above.

The operator confirms that the fix changed project-role membership only: no product access, licensed seat, subscription, billing or payment settings changed. The retry created synthetic issue `DD-1`. Product installation and manifest scopes alone did not establish the acting user's project permissions. At that stage, Confluence publication was browser evidence only; later Forge inspection verified the source read as recorded below.

### Native-panel diagnostics

The original frontend did not progress beyond the loading skeleton. To isolate the UI, the operator temporarily deployed a text-only native panel as version `2.1.0`; it also remained a skeleton in the original tab and a fresh `DD-1` tab. No resolver/backend invocations or error logs were observed for those attempts. The full frontend was then restored, the probe file deleted, and version `2.2.0` deployed successfully after official Forge lint reported no issues. A successful deployment is not a successful render test.

A direct navigation to a Forge `main.js` resource returned `net::ERR_BLOCKED_BY_CLIENT`. The causal source is **uncertain**. Chrome has **AdBlock** and **Adblock for Youtube** installed, while AdBlock showed **0 blocked** on the Jira page. Those observations do not establish which extension or browser control, if any, caused the panel failure.

The user approved a temporary **site-only** AdBlock pause. The operator paused AdBlock only on `decision-drift.atlassian.net`, verified the popup's paused state and reloaded the full `2.2.0` panel. The panel still showed the loading skeleton. The operator then restored AdBlock and verified that its popup again offered **Pausa på den här webbplatsen**, with **Block Ads 0**. No other extension settings were changed. This controlled check did not resolve the failure; it does **not** establish AdBlock as the cause.

The persistent normal-browser loading state is recorded in the [live-panel screenshot](evidence/live-panel-loading.jpg). The user then opened [DD-1](https://decision-drift.atlassian.net/browse/DD-1) in Incognito, signed into the same Atlassian account, clicked Decision Drift and reported: **The review form appears**.

That initial report established **form rendering in Incognito**, separately from backend access. The comparison points to a normal-browser environment difference; it does not identify a particular extension, cache, setting or other cause. The operator subsequently used the native Chrome Incognito form and verified the complete core flow below. No successful normal-profile render has been recorded.

### Authenticated browser API evidence

Using the existing authenticated browser session, a direct GET to [the Confluence page API](https://decision-drift.atlassian.net/wiki/api/v2/pages/557057?body-format=atlas_doc_format) returned JSON with:

- Page ID `557057`, title `Decision Drift spike source` and status `current`.
- Page `version.number` of `1`.
- An `atlas_doc_format` body containing an ADF `doc`, document format version `1`, and the synthetic runbook text.

An authenticated browser GET to [the Jira fixture API](https://decision-drift.atlassian.net/rest/api/3/issue/DD-1?fields=summary,updated,description,comment) returned:

- Issue ID `10009`, key `DD-1` and summary `Validate reviewed source access`.
- The exact original synthetic issue description, unchanged.
- `comment.total` of `0` and `comments: []`.

These initial reads are **authenticated browser-session API reads**, not, by themselves, evidence of Forge `asUser()` access. They establish the source and no-comment baseline. A separate browser GET immediately after the actual app preview again showed zero comments and the unchanged issue description. After the approved app write, another browser GET returned exactly one comment, ID `10003`, with the expected ADF text and review UUID, while the original issue description was still unchanged. The GET requests independently observed state; they did not create the comment.

### Verified core Forge flow

The operator performed these steps through native Chrome UI in Incognito on `DD-1`:

1. **Check access** displayed the current Jira key/summary and updated date plus Confluence page `557057`, title `Decision Drift spike source`, version `1` and the exact synthetic body. The app displayed **Access checked**. This verifies the installed app's current-user Jira/Confluence reads.
2. **Preview reviewed update** succeeded, including live KVS preview persistence. It returned review `04620db9-e451-4283-8d03-ab571f4aa10c`, expiring at `2026-10-29T20:41:39+01:00`. The independent browser check immediately afterward still showed zero Jira comments.
3. The complete proposed comment was reviewed. It identifies source page/version, `DD-1`, the source URL and review UUID, and includes the access-spike disclaimer. It excludes the Confluence title and body. The **Apply reviewed update** button was disabled until the approval checkbox was selected.
4. After selecting that checkbox, the operator clicked **Apply reviewed update** exactly once. The app displayed **Reviewed update added**, with comment `10003` on `DD-1` referencing source version `1`.
5. Independent browser API inspection confirmed exactly one comment with the same UUID and expected ADF text, created at `2026-10-29T20:32:30.579+0100`. The issue's original description was unchanged.
6. The operator opened the app's **Open Jira comment** link in Incognito. Jira Activity displayed comment `10003` with the complete matching review text and UUID, independently verified through native UI.

The approved comment's source link is `https://decision-drift.atlassian.net/wiki/pages/viewpage.action?pageId=557057`. See the [sanitized result record](evidence/live-review-result.json) and [actual Jira comment](https://decision-drift.atlassian.net/browse/DD-1?focusedCommentId=10003). The app-success and Jira Activity screenshots remain local at the paths above because they include personal browser bookmarks.

This passes the core single-user access/preview/approved additive-write spike. It does not establish semantic decision alignment, normal-profile compatibility, concurrent duplicate prevention, or the live negative-path checks listed as pending.

### Live checks

| Check | Status | Evidence required before marking passed |
| --- | --- | --- |
| Authenticated CLI identity | Passed — operator reported actual CLI success | `forge whoami` identifies Hao; no token recorded |
| Intended Developer Space | Passed — operator reported actual CLI list | `MyDevSpace` / `9a51ac9c-b744-4082-b6b8-02df00013d27` |
| Official Forge linter | Passed — operator reported actual CLI result | `forge lint`: No issues, including before the restored `2.2.0` deployment |
| App registration | Passed — operator reported actual CLI success | `e4d59fe8-4c16-485f-8206-bbd5072713dd` in MyDevSpace, following explicit terms approval |
| Development deployment | Passed — operator reported final CLI success | Latest full frontend version `2.2.0`; initial `2.0.0` also succeeded and reported Runs on Atlassian eligibility |
| Jira fixture project created | Passed — operator reported browser confirmation | Restricted JSM space Decision Drift Test (`DD`), using the existing licensed Development requests template |
| Jira installation | Passed — operator reported completed CLI installation | `decision-drift.atlassian.net`, environment `development` |
| Confluence connection | Passed — operator reported completed CLI installation | Same site/environment, completed after Jira; installed scopes recorded above |
| Published Confluence fixture | Passed — operator reported browser publication | Page `557057`; canonical URL recorded above; browser API later confirmed status current, version 1 |
| Authenticated browser Confluence API read | Passed — browser-session access only | GET returned page ID/title/current status, page version 1 and synthetic ADF body; not a Forge `asUser()` result |
| Authenticated browser Jira API read | Passed — independent state observation | Issue 10009/DD-1; zero comments after preview, exactly one after apply; original description unchanged |
| Current-user Jira project permissions | Passed — operator reloaded actual permission endpoint | All four checked permissions true after adding existing Hao account to DD Service Desk Team; Administrators retained |
| Jira fixture issue creation | Passed — operator reported actual issue creation | `DD-1` / Validate reviewed source access; canonical issue URL and original description recorded above |
| Issue-panel render | Passed in Incognito — operator verified native UI | Complete form operated on DD-1; normal-browser failure remains recorded |
| Temporary AdBlock check and restoration | Completed — diagnostic did not resolve failure | Paused only on the Jira site after approval, reloaded, then restored; original popup action and Block Ads 0 verified |
| Incognito comparison | Completed — user report followed by operator success | Same account and DD-1; successful core flow in Incognito, normal profile still failed |
| Forge-mediated current-user Jira and Confluence reads | Passed — actual app inspection | Access checked: DD-1 current data and page 557057 version 1/title/exact synthetic body |
| Preview without write | Passed — actual app plus independent API check | Review UUID/expiry returned and stored; independent check immediately afterward showed zero comments and unchanged description |
| Live KVS preview persistence | Passed for the observed core path | Preview creation and later confirmed apply succeeded; concurrent insert-only behavior not yet tested live |
| Explicit UI approval gate | Passed — observed in native UI | Apply disabled until approval checkbox; operator then selected it and clicked Apply once |
| Approved additive write | Passed — app receipt and independent API result | Comment 10003 with matching review UUID; exactly one comment after apply |
| Independent Jira UI confirmation | Passed — native UI inspected | Open Jira comment link displayed complete comment 10003/review UUID in Jira Activity; screenshot linked above |
| Source content excluded from comment | Passed — actual comment ADF inspected | Source link/page/version/review ID included; source title/body excluded |
| Issue description preserved after app write | Passed — independent before/after API checks | Exact original description unchanged after comment 10003 |
| Source/issue changed after preview | Pending | Live stale-preview rejection with no comment from that review |
| Expired preview | Pending | Live rejection after expiry with no comment |
| Duplicate confirmation | Pending | One upstream comment for the review ID, or a clearly reported blocked/unknown result |
| Denied-user permissions | Pending | Controlled test identity cannot read restricted source or write without permission |
| Unknown-outcome recovery | Pending | If observed, manual review-ID reconciliation; never infer a failed write from a missing receipt |
| Billing/payment constraint | Preserved for settings and payment methods | Operator confirms no payment method added or billing/payment settings modified; mandatory terms acceptance was explicitly approved |
| Production distribution | Pending | Separate external judge installation link and installation check |

### Observation log

Append only observed facts. A command starting, a plausible API response fixture or a screen showing a loading state is not a successful deployment or write.

| Observed time (Europe/Stockholm) | Command or browser action | Actual result | Identifiers / remaining uncertainty |
| --- | --- | --- | --- |
| Exact time not captured; reported October 29 | `npm run forge -- whoami` | Succeeded; logged in as Hao | Authentication confirmed; no credentials recorded |
| Exact time not captured; reported October 29 | `npm run forge -- developer-spaces list` | Intended space listed | `MyDevSpace` / `9a51ac9c-b744-4082-b6b8-02df00013d27` |
| Exact time not captured; reported October 29 | Register Decision Drift in the intended Developer Space | Paused at mandatory agreement covering Developer Terms, Privacy Policy and billing above the free allowance | Specific approval requested; agreement not accepted; no app ID issued |
| Exact time not captured; reported October 29 | Operator account-action confirmation | No payment method added; overage-billing agreement not accepted | Registration/deployment/installation and API checks remain pending |
| Exact time not captured; reported October 29 | Account owner approves mandatory registration terms | Explicit approval received; registration continued | No payment method authorized or added |
| Exact time not captured; reported October 29 | Register Decision Drift in MyDevSpace | Succeeded | App ID `e4d59fe8-4c16-485f-8206-bbd5072713dd` |
| Exact time not captured; reported October 29 | Official Forge lint | No issues | Distinct from the local manifest/compilation check |
| Exact time not captured; reported October 29 | Development deployment | Packaging, upload and manifest validation succeeded; deployment still in progress | Awaiting final deployment result and version/build identifier |
| Exact time not captured; reported October 29 | Browser creates Jira fixture project | Restricted JSM space Decision Drift Test (`DD`) created from existing licensed Development requests template; empty All work view displayed | Project URL not captured; issue creation remains pending |
| Exact time not captured; reported October 29 | Operator account-action confirmation after registration | No payment method added; no billing/payment settings modified | Mandatory agreement acceptance had explicit user approval |
| Exact time not captured; reported October 29 | Development deployment completes | Succeeded, version `2.0.0` | CLI reported Runs on Atlassian eligibility; this is not a live feature test |
| Exact time not captured; reported October 29 | Install app into Jira | Completed | `decision-drift.atlassian.net`, environment `development` |
| Exact time not captured; reported October 29 | Install/connect app into Confluence | Completed after Jira | Same site/environment; scopes `read:jira-work`, `write:jira-work`, `read:page:confluence`, `storage:app` |
| Exact time not captured; reported October 29 | Browser prepares Confluence source fixture | Draft page ID `557057`; publishing underway | Published state, source version and canonical URL not yet confirmed |
| Exact time not captured; reported October 29 | Operator confirms deployment/install options | No payment or billing flags used | No payment method or billing-setting change reported |
| Exact observation time not captured; reported October 29 | Forge deployment list | Confirms version `2.0.0` deployment timestamp `2026-10-29T19:08:35.022Z` | Deployment event time is 20:08:35.022 CET |
| Exact time not captured; reported October 29 | Forge installation list | Installation is up to date at major version 2; Jira required and Confluence connected | Installation `7ca78514-4089-4bc2-b3fa-969ef8f72a46` |
| Exact time not captured; reported October 29 | Publish the Confluence fixture | Page `557057` published in personal space with the exact synthetic runbook body | Canonical page URL recorded above; API-read version not yet known |
| Exact time not captured; reported October 29 | Create Jira fixture issue | Failed; no issue created | `mypermissions` for `DD` reports false for browse/create/edit/comment permissions |
| Exact time not captured; reported October 29 | Inspect DD People page | Hao appears in Administrators only, not Service Desk Team | Existing access still being inspected; no license/seat/billing changes reported |
| Exact time not captured; reported October 29 | Inspect admin user details | Hao already has Jira Standard User, JSM/Service Collection Standard User (agent), and Confluence Standard User access | Existing access confirmed; no new product access or licensed seat added |
| Exact time not captured; reported October 29 | Add the existing Hao account to the DD Service Desk Team project role | Role added; Administrators membership retained | Project-role change only; no app-seat/product-plan/billing/payment change |
| Exact time not captured; reported October 29 | Reload `mypermissions` for DD | `BROWSE_PROJECTS`, `CREATE_ISSUES`, `EDIT_ISSUES`, `ADD_COMMENTS` all return `true` | Effective project-permission check passed |
| Exact time not captured; reported October 29 | Retry synthetic Jira issue creation | Form submission in progress | Awaiting actual issue key; not marked successful |
| Exact time not captured; reported October 29 | Jira fixture creation retry completes | Created DD-1, Validate reviewed source access | `https://decision-drift.atlassian.net/browse/DD-1`; original synthetic description recorded above |
| Exact time not captured; reported October 29 | Click Decision Drift on DD-1 | Issue-panel launch attempted | App rendering, source/issue reads, preview and comment creation still unverified |
| Exact time not captured; reported October 29 | Operator reconfirms role-fix scope | Existing account's project role changed; Administrators retained | No product access, licensed seat or subscription changed |
| Exact time not captured; reported October 29 | Deploy temporary text-only native-panel probe | Version `2.1.0` deployed | Diagnostic build only; no backend features added |
| Exact time not captured; reported October 29 | Test probe in original and fresh DD-1 tabs | Loading skeleton persisted; no backend invocation/error logs observed | No successful render or Forge API call established |
| Exact time not captured; reported October 29 | Restore full frontend, delete probe and deploy | Official Forge lint: No issues; version `2.2.0` deployment succeeded | Usable live render remains unconfirmed |
| Exact time not captured; reported October 29 | Direct authenticated browser GET for Confluence page 557057 | JSON returned id/title/status current, page version 1 and synthetic ADF doc/version 1 | Browser-session API read only; not Forge-mediated access |
| Exact time not captured; reported October 29 | Direct navigation to a Forge main.js resource | `net::ERR_BLOCKED_BY_CLIENT` | Causal source uncertain; do not attribute to a particular extension without a controlled result |
| Exact time not captured; reported October 29 | Inspect Chrome extensions and AdBlock indicator | AdBlock plus Adblock for Youtube installed; AdBlock reports 0 blocked on Jira | No extension setting changed |
| Exact time not captured; reported October 29 | Request site-only temporary AdBlock-pause approval | Awaiting user approval; proposed check includes restoring it afterward | No pause performed; no billing/payment changes |
| Exact time not captured; reported October 29 | User approves site-only temporary AdBlock pause | Approval received | Scope limited to `decision-drift.atlassian.net`, with restoration afterward |
| Exact time not captured; reported October 29 | Pause AdBlock on the Jira site and reload full v2.2.0 panel | Popup confirmed paused; panel still a loading skeleton | Diagnostic did not resolve rendering; no causal attribution to AdBlock |
| Exact time not captured; reported October 29 | Restore AdBlock on the Jira site | Popup again offers Pausa på den här webbplatsen; Block Ads 0 | Prior site behavior restored and verified; no other extension setting changed |
| Exact time not captured; reported October 29 | Save loading-panel screenshot | Evidence file saved | `docs/evidence/live-panel-loading.jpg` |
| Exact time not captured; reported October 29 | Direct authenticated browser GET for DD-1 with summary/updated/description/comment | Issue ID 10009/key DD-1, correct summary, exact original description, zero comments | Browser-session read only; no Forge write proved |
| Exact time not captured; reported October 29 | Rerun local verification after restoring full manifest/frontend | All 15 local tests and npm run check passed | Official Forge lint also passed for v2.2.0; no live success inferred |
| Exact time not captured; reported October 29 | Ask user to compare DD-1 in Incognito | Awaiting the user's form-versus-loading observation | Helps distinguish browser environment from a wider Forge/rendering problem; outcome unknown |
| Exact time not captured; reported October 29 | User compares DD-1 in Incognito while signed into the same Atlassian account | User reports: The review form appears after clicking Decision Drift | User-reported render success; points to a normal-browser environment difference, not an identified cause or confirmed Forge API access |
| Exact time not captured; reported October 29 | Operate Check access through native Chrome Incognito UI | Access checked; actual current Jira DD-1 data plus Confluence page 557057/title/version 1/exact synthetic body displayed | Installed Forge current-user reads verified |
| Exact time not captured; reported October 29 | Preview reviewed update in the installed app | KVS-backed preview succeeded; review UUID 04620db9-e451-4283-8d03-ab571f4aa10c, expiry 2026-10-29T20:41:39+01:00 | Complete exact comment reviewed; Apply disabled before checkbox approval |
| Exact time not captured; reported October 29 | Independent browser API check immediately after preview | Zero comments; original issue description unchanged | Preview did not post a Jira comment |
| Exact observation time not captured; comment created 20:32:30.579 CET | Select approval checkbox and click Apply reviewed update once | Reviewed update added; receipt identifies comment 10003 on DD-1/source version 1 | Review UUID 04620db9-e451-4283-8d03-ab571f4aa10c |
| Exact time not captured; reported October 29 | Independent browser API check after apply | Exactly one comment, ID 10003, matching ADF/review UUID; original description unchanged | Created 2026-10-29T20:32:30.579+0100; source title/body excluded |
| Exact time not captured; reported October 29 | Open the app's Open Jira comment link in Incognito | Native Jira Activity displays complete matching comment 10003 and review UUID | Independent UI verification saved in docs/evidence/live-jira-comment.jpg |
| Exact time not captured; reported October 29 | Save sanitized core-flow evidence | Result JSON, app-success JPEG and actual-comment JPEG saved | docs/evidence/live-review-result.json, live-review-success.jpg, live-jira-comment.jpg |

For any failed or uncertain write, record its review ID and inspect Jira before considering another review. Keep failure evidence alongside successful steps; do not replace a failed attempt with a later success in this log.

## Implemented locally

- Native Forge Jira issue panel with Confluence page input, inspection, exact comment preview and explicit approval.
- Backend reads the current issue and published source as the signed-in user.
- Preview is bound to the server-provided user, cloud and issue; it expires after ten minutes.
- Apply rechecks issue and source state and access. A stale preview cannot be applied.
- A KVS insert-only claim prevents two concurrent submissions from posting twice.
- The first write adds a Jira comment with the source URL, version and review ID. It leaves existing issue fields alone and does not publish restricted source excerpts or titles into Jira.
- Uncertain POST outcomes retain their claim and require manual reconciliation in Jira; they are never automatically retried.

## Verification

| Check | Status |
| --- | --- |
| 15 isolated logic tests | Passed again after full manifest/frontend restoration |
| Backend and frontend compilation | npm run check passed again after restoration |
| Manifest structure checks | npm run check passed again after restoration |
| Forge CLI 15.0.0 on local Node 22.23.4 | Runs successfully |
| Confluence enabled and Developer Space exists | Browser confirmed; Developer Space also verified by CLI |
| Forge authentication | Confirmed by successful `whoami` as Hao |
| Official `forge lint` | Passed — CLI reports No issues |
| Registration | Succeeded after explicit user approval of mandatory terms; app ID recorded above |
| Development deployment | Latest succeeded: `2.2.0`, full frontend restored after text-only `2.1.0` probe; initial `2.0.0` reported Runs on Atlassian eligibility |
| Jira and Confluence installation | Both completed on `decision-drift.atlassian.net`, environment `development` |
| Installation list | Up-to-date major version 2; Jira required + Confluence connected; installation ID recorded above |
| Confluence synthetic source | Published page `557057`; Forge current-user inspection and independent browser API read both confirmed version 1 |
| Jira project-permission fix | Confirmed: existing account added to Service Desk Team; all four effective permissions now true; no license or billing changes |
| Jira synthetic issue | Created: DD-1, Validate reviewed source access; original description recorded above |
| Jira browser API baseline | ID 10009/key DD-1; original description unchanged; comment.total 0/comments empty; not Forge access |
| Issue-panel render | Operator verified and operated the complete Incognito form; normal-profile skeleton remains unresolved |
| Jira and Confluence API access | Passed through actual Forge current-user inspection of DD-1 and source 557057/version 1 |
| Review preview and KVS state | Actual preview succeeded; independent API check confirmed zero comments before approval |
| Real reviewed Jira comment | Passed: comment 10003, one approved Apply click, matching review UUID; API and native Jira Activity independently verified |
| Original Jira description | Unchanged before preview, after preview and after the approved comment |
| Core spike outcome | PASSED — access, exact persisted preview, explicit approval and one additive update; no semantic alignment claim |
| Separate-site production installation link | Pending production distribution verification |

The local tests use controlled API/storage adapters. Live deployment, current-user reads and the single reviewed-write path have now been checked separately. Concurrent duplicate behavior and live negative paths remain unverified; those results must not be inferred from the fixture tests or one successful write.

## Deliberate spike boundary

The completed core spike verifies access and one reviewed writeback in Incognito. Semantic contradiction detection, historical decision tracking and acceptance-criteria repair are outside this stage. It supports small published Confluence pages, not live documents or drafts. Source display is limited to the first 4,000 text characters; the freshness hash covers the full supported document.

Rechecking versions immediately before POST does not make a cross-product update atomic. The comment records the reviewed version. Because it is additive, it does not overwrite another editor's issue fields.

## Dependency finding

The latest vendor packages initially reported 37 audit findings. A root override pins `prosemirror-view` 1.42.3 to address the production dependency's paste-XSS advisory; all installed copies must remain at that patched version.

The production-only audit after that override reported **zero vulnerabilities**. The remaining 29 findings in the full install, including three critical advisories, are within the development-only Forge CLI 15 dependency tree. Its published shrinkwrap pins affected versions. They are not part of the deployed resolver bundle, but remain an upstream tooling limitation. Do not apply npm's suggested downgrades of Forge React/Bridge/CLI, edit the vendor shrinkwrap, or use `npm audit fix --force` without a separate compatibility review. The spike does not require a local tunnel server.

Audit output is kept in ignored `.cache/` files, not committed source. Recheck the registry before enabling further development tooling or changing dependencies.

## Remaining work beyond the completed core spike

The requested one-update core spike is complete. No further Jira comment or negative-path action is needed to establish that result.

For later hardening, the live stale/expired/replayed/concurrent and denied-user cases remain pending in the [runbook](atlassian-setup.md#live-verification-runbook). The normal browser's rendering difference is also unresolved; preserve its restored extension settings and do not infer an AdBlock cause from the completed diagnostic. Production judge installation and the full decision-drift product remain separate future work.

Continue to preserve existing licensing, licensed seats, payment methods and billing settings. The verified core flow and project-role fix did not change them.

Never paste API tokens into chat or source files.
