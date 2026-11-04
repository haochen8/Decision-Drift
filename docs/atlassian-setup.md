# Atlassian setup and live verification

Checked against Atlassian documentation on October 29, 2026. This guide prepares the Decision Drift technical spike; cloud actions below have not been performed by writing this guide.

## What you need

| Item | Purpose | Paid subscription needed for this spike? |
| --- | --- | --- |
| Atlassian account | One identity for the developer console, Forge CLI, Jira and Confluence | No |
| Developer Space | Owns and manages the Forge app and its billing account | No paid plan needed within free usage allowances |
| Cloud development site | Hosts Jira issues and Confluence pages used by the app | Free development instances are available |
| Scoped Forge API token | Authenticates your local Forge CLI | No |
| Jira/Confluence site administration | Lets you install the app and approve its requested scopes | Required permission, not a subscription |

A Developer Space is an app-development container, not a Confluence content space. The cloud site and the Developer Space are separate resources associated with your Atlassian account. [Developer Spaces overview](https://developer.atlassian.com/platform/forge/developer-space/developer-spaces-introduction/).

## 1. Create the account and free development site

1. Create or use your own [Atlassian account](https://id.atlassian.com/).
2. Open the official [free cloud developer site signup](https://go.atlassian.com/cloud-dev) while signed into that account.
3. Complete the setup wizard for Jira and Confluence on one cloud site. The current project site is `decision-drift.atlassian.net`.
4. Confirm you can open Jira and Confluence and administer the site. Use synthetic project data rather than a workplace's production site.

Traditional developer sites provide five Jira users and five Confluence users for development/testing. The official signup describes these development instances as free; this is different from buying a normal production subscription. [Cloud Developer Bundle](https://www.atlassian.com/try/cloud/signup?developer=true&product=confluence.ondemand%2Cjira-software.ondemand%2Cjira-servicedesk.ondemand%2Cjira-core.ondemand).

The app uses Jira and Confluence on the **same Atlassian site**. Forge's multi-app compatibility does not support bridging two unrelated cloud sites. Its manifest selects one required app and an optional connection to the other; install into the required app first. [App compatibility](https://developer.atlassian.com/platform/forge/app-compatibility/).

Alternative: `forge site provision` creates a seeded demo development site, but it expires after 90 days by default. A site provisioned October 29 would expire around January 27, before Codegeist judging ends February 3. The traditional development site is the preferred starting point here. [Demo-site lifecycle](https://developer.atlassian.com/platform/forge/provision-a-demo-development-site/).

## 2. Create a Developer Space and check billing

1. Open [Atlassian Developer](https://developer.atlassian.com/), then your profile menu → Developer Console.
2. In the console's space switcher, choose **Create Developer Space**.
3. Name the space, review the displayed terms and create it. The creator becomes its first admin and billing admin.
4. Check Settings and the linked billing account. The setup may display billing consent or a payment-method prompt; do not select a paid product upgrade just to run this spike.

Current billing documentation permits use without adding a payment method when usage stays within free allowances. This is not an unlimited free-service promise: overages can create charges and eventually interrupt app access. Check the Developer Console's usage metrics during development. [Create a Developer Space](https://developer.atlassian.com/platform/forge/developer-space/create-developer-space/), [billing and payment methods](https://developer.atlassian.com/platform/forge/developer-space/billing-for-developer-spaces/).

Forge compute, storage and logging have monthly free allowances. Native Forge LLM has no free allowance, and Rovo credits are separate from Forge compute billing. The non-AI technical spike does not require either service. [Current Forge pricing](https://developer.atlassian.com/platform/forge/forge-platform-pricing/).

## 3. Authenticate the local CLI

The repository pins Node.js **22.23.4** as a local development dependency for Forge CLI **15.0.0**. Run these commands from your repository checkout. After dependency installation, npm scripts pick up that project-local Node executable. This handles an older host patch release without replacing the machine's global Node installation. No global Forge install or `sudo` is necessary.

```bash
npm ci
npm run forge -- --version
```

The deployed Forge runtime remains `nodejs22.x`. `npm run lint` is currently an alias for the repository's static manifest/compilation check, not an independent ESLint run.

Create the login token:

1. Open [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
2. Select **Create API token with scopes**.
3. Give it a recognizable name and an expiry covering the intended development period.
4. Select **Forge** as the app.
5. Keep the recommended default Forge scopes for the initial developer workflow. Atlassian's setup guide does not enumerate a fixed list of scope IDs; use the current Forge defaults rather than a guessed list.
6. Create and copy the token.

Run the interactive login in your own terminal:

```bash
npm run forge -- login
npm run forge -- whoami
npm run forge -- developer-spaces list
```

Answer the CLI analytics preference yourself, enter your Atlassian email, and paste the token into the token prompt. On macOS, Forge uses the operating system's credential store. The CLI may request Keychain access. [Official setup and scoped-token instructions](https://developer.atlassian.com/platform/forge/getting-started/#log-in-with-an-atlassian-api-scoped-token), [login reference](https://developer.atlassian.com/platform/forge/cli-reference/login/).

Do not paste the token into chat or save it in the repository. Avoid putting it in a `--token` command argument, where shell history or process listings can expose it. If authentication fails, check the account email, token expiry and selection of Forge in the token setup. Do not share the token to troubleshoot.

### Login scopes and app scopes are different

The **Forge API token** authenticates you as the developer running registration, deployment and installation commands. The **manifest permissions** grant the installed app access to Jira/Confluence operations. Creating a login token does not bypass site administration, user access or installed-app scope approval.

Review the actual `permissions.scopes` in `manifest.yml` before approving installation. The spike needs source reads and an additive Jira comment write; scope changes require redeployment and installation upgrade. Use the manifest and `forge lint` as the exact app-scope reference for the current code revision. The CLI token does not need to be embedded in the app.

The current manifest declares:

| App scope | Used for |
| --- | --- |
| `read:jira-work` | Read the current Jira work item and site information |
| `write:jira-work` | Add the reviewed comment; this broad Jira scope does not itself limit writes to comments |
| `read:page:confluence` | Read the selected Confluence source page |
| `storage:app` | Store server-side review/confirmation state |

These are app installation scopes, not the scopes to select for the CLI login token. The implementation must still enforce the intended read/preview/comment-only workflow and the acting user's permissions.

## 4. Register once, deploy and install

This checkout is already registered as **Decision Drift** and its manifest contains the real app ID. Skip registration for this app and continue with the deployment commands below. Only register when deliberately creating a separate new app from a copy of this project:

```bash
npm run forge -- register "Decision Drift"
```

Select the Developer Space created above. If the CLI requires an explicit space, use the ID from `developer-spaces list`:

```bash
npm run forge -- register "Decision Drift" --developer-space-id YOUR_DEVELOPER_SPACE_ID
```

These are alternative forms of the **same one-time step**. Running registration again assigns another app ID and disconnects this checkout from the old app's environments, variables and storage. Do not use repeated registration as a routine fix. [Register reference](https://developer.atlassian.com/platform/forge/cli-reference/register/).

Run local checks, then deploy:

```bash
npm test
npm run check
npm run lint
npm run forge -- lint
npm run forge -- deploy --environment development
npm run forge -- install --environment development
```

Choose your development site and the manifest's required product, then connect its optional product on that same site. Follow the current CLI prompts and confirm both Jira and Confluence access before continuing. For a manifest with Jira required and Confluence optional, the explicit CLI forms are:

```bash
npm run forge -- install --environment development --site decision-drift.atlassian.net --product jira
npm run forge -- install --environment development --site decision-drift.atlassian.net --product confluence
```

Use either the interactive flow or the explicit forms as appropriate; do not repeat a successful installation unnecessarily. The cross-product configuration and UI must still be proved on the live site. [Install reference](https://developer.atlassian.com/platform/forge/cli-reference/install/), [multi-app tutorial](https://developer.atlassian.com/platform/forge/build-an-app-compatible-with-confluence-and-jira/).

After adding permissions, deploy and upgrade the existing installation so the changed scopes are approved:

```bash
npm run forge -- deploy --environment development
npm run forge -- install --upgrade --environment development
```

## 5. Create the synthetic live fixture

Use a small, empty development project and a published text page. No real customer data is needed.

1. In Jira, create a project named **Decision Drift Test** with key **DD**. A basic Kanban/software template is sufficient. If `DD` is already taken, use another key and record the actual issue key.
2. Create one task with the summary **Validate reviewed source access** and this description:

   ```text
   This synthetic work item tests Decision Drift.
   Add a reviewed source link as a comment.
   Keep this description unchanged.
   ```

3. Record its actual key, for example `DD-1`.
4. In Confluence on the **same site**, create or use a development space. Create a normal page titled **Decision Drift spike source** with this plain-text body:

   ```text
   Decision: Release 1 includes CSV export.
   Constraint: Export is available to project admins only.
   Evidence: This page is synthetic development data for the Decision Drift access spike.
   ```

5. **Publish** the page. Drafts and live docs are outside this spike. Note the actual page version shown by Confluence or returned by the app; the first published version is commonly version 1.
6. Copy the full page URL from the browser address bar. The app accepts a canonical `/wiki/spaces/.../pages/PAGE_ID/...` URL, `/wiki/pages/PAGE_ID/...`, the older `viewpage.action?pageId=PAGE_ID` form, or a numeric page ID. Short `/wiki/x/...` share links are unsupported.

After local account/login setup, send only:

```text
Site URL: https://your-site.atlassian.net
Jira issue key: DD-1
Confluence page URL: https://your-site.atlassian.net/wiki/spaces/SPACE/pages/PAGE_ID/...
```

Use your actual values. Do not include an API token, password, recovery code or session cookie.

## Live verification runbook

For each new run, treat a check as unverified until its actual result is recorded. See the [spike status](spike-status.md) for completed live results. Record the code revision, environment, date, expected outcome and observed outcome when running checks. Keep access tokens and private content out of evidence.

### Browser startup verification

First compare an ordinary native Chrome tab with any tab that stalled under automation. Keep browser protections and settings in place during this comparison.

1. In regular Chrome, use the native **Cmd+T** shortcut and paste the canonical Jira issue URL, such as `https://decision-drift.atlassian.net/browse/DD-2`. Open its Decision Drift panel. Record the actual app controls and restored source/review versions, rather than treating Jira's host loading skeleton as the app.
2. Use **Cmd+R** for a full page reload, reopen the panel if needed, and verify the same tracked source, reviewed/published versions and saved review timestamp return automatically.
3. Choose **Recheck source** and inspect its completed result. Visible app controls and their loading indicators establish that the app UI started; Jira's grey host skeleton alone does not. Choose **Read current text** and verify supported source and Jira description text. These checks require no saved review or Jira comment.
4. If startup still stalls, record only observed diagnostics: whether the iframe document is pending, any captured response/error and the UI state. Missing frontend or resolver logs do not by themselves prove that no app code or request ran. Keep raw HARs, iframe context URLs, account IDs and private captures out of committed evidence. Do not disable protections, change speculative preconnect or update the SDK as a default diagnostic step.

On November 4, regular Chrome DD-5 survived a full reload through the browser controller with source 2129921 at `2/2`. An ordinary native new DD-2 tab loaded source 1605635 at `4/4`, restored the same state and **2026-11-03 20:12:38 CET** review timestamp after native Cmd+R, completed Recheck source and displayed the current constraint `Constraint: Only project members may export CSV data.` plus the correct Jira description. Native address-bar navigation in that same tab then loaded DD-1/source 557057 at `2/2`, last reviewed **November 3 19:04:19 CET**, and DD-5/source 2129921 at `2/2`, last reviewed **November 4 11:32:52 CET**. No Save, approval, comment or document edit was performed. Claiming the already working DD-5 tab afterward for a screenshot preserved its visible app controls; reload after that claim was not tested.

Some automation-associated navigations instead remained at the host skeleton, with one Forge iframe document pending/Stalled at 0 B and no captured response code or network error. The observed document URL matched the working panel's URL; opening that document directly returned its HTML/script references, which does not establish successful embedded startup. No runtime patch or redeployment was needed. [Sanitized regular-browser evidence](evidence/2026-11-04-regular-browser.json).

[Atlassian ECO-1823](https://jira.atlassian.com/browse/ECO-1823) describes a similar host skeleton after an iframe document fails with status 0/a network error. Our captured request was still pending, so this is a related report, **not a confirmed match or root cause**.

For the optional Jira note, open the fixture issue and its **Decision Drift** issue panel. Paste the published Confluence page URL or numeric ID into **Confluence decision source**, choose **Check source** (or **Recheck source**), then **Preview source-link note**. Review the exact note, tick its approval checkbox and choose **Add reviewed Jira note** only when you intend to post it. Check the resulting comment in Jira itself. Saving a tracked source version is a separate action, described below.

The proposed comment contains a source URL, page ID/version and review ID. It deliberately excludes the source title and quoted text because the Jira audience may differ from the Confluence audience. It records a review, not a judgment that the requirements align. A preview expires after **ten minutes**, and confirmation rereads the issue and source as the acting user.

| Check | Action | Pass condition |
| --- | --- | --- |
| Developer identity | Run `whoami` and list Developer Spaces | Correct account and intended space are selected |
| Deployment | Register once, lint, deploy and install | Real app ID; successful deployment and installation |
| Same-site integration | Open the app while logged into the development site | Jira and Confluence reads succeed through the installed app |
| Source inspection | Create a synthetic Confluence decision page and inspect it through the app | Actual title, content and source version are returned; no fixture is presented as live data |
| Issue read | Inspect a synthetic Jira issue | Returned key and issue content match Jira |
| Preview | Prepare an update from the inspected source | The proposed source-linked comment is visible; Jira is unchanged |
| Confirmed write | Review and confirm the proposed update | Exactly the intended additive comment appears; the original issue description is unchanged; the source title and body are absent from the comment |
| No approval | Prepare a second update, leave approval unchecked and close the panel | No extra Jira comment is created |
| Stale source | Prepare an update, edit and republish the source page, then attempt confirmation | `STALE_PREVIEW`; no comment is created from the old review |
| Stale issue | Prepare an update, edit the Jira description, then attempt confirmation | `STALE_PREVIEW`; no comment is created from the old review |
| Expired review | Prepare an update, wait over ten minutes, then attempt confirmation | The UI or server blocks the expired preview; create and review a fresh one |
| Permissions | Repeat with a test identity denied access to the source or issue | Access is denied without exposing restricted content or writing a comment |
| Duplicate submit | Submit the same confirmation twice | At most one comment for that review ID; a saved success is reused or a concurrent attempt is blocked |
| Unconfirmed write | If a write returns `OUTCOME_UNKNOWN`, inspect Jira for its review ID | No automatic retry; record whether the comment exists before starting any new review |
| Failure recovery | Use an invalid issue/page identifier | A useful error appears; no unintended write occurs |

Source reads and reviewed writes require real Atlassian credentials and a real installed app. Local tests can validate logic and failure handling; they cannot establish that these cloud checks passed.

The original 15 spike tests exercise source-format validation, approval, preview expiry, user/issue/site binding, changes since preview, revoked source access, concurrent requests, replay, unknown outcomes and untrusted caller payloads. The current suite additionally covers durable review baselines, conditional revision races, complete source parsing and real bundled UI event journeys. Tests use simulated product/storage boundaries; a passing result does not verify Atlassian's live APIs or cloud transaction behavior.

The permission check can use a controlled test account you administer; it does not require recruiting another person. If no such account is available, record the denied-user check as pending rather than inferring it passed from an administrator's successful read.

## Persistent source review verification

This feature stores one shared source-review baseline per Jira issue in the `decision-baseline` Custom Entity. It uses the existing scopes. Entity records have no TTL and contain only page/version, issue/source fingerprints, reviewer identity and review metadata. Historical text is fetched with current-user access instead of being retained in storage.

Use the existing synthetic issue **DD-1** and source page **557057** in Chrome Incognito. This sequence saves review metadata and edits only the synthetic source page; it does not require another Jira comment.

The existing fixture is already reviewed at version 2. For a **repeat run**, first verify automatic restoration of page 557057 with reviewed/published versions 2/2 and record Jira's current description/comment count, then continue at **step 4**. The first-time save path in steps 1–3 applies to a fresh unreviewed synthetic fixture; substitute its actual issue/page IDs. An unchanged fixture shows a disabled **Current version reviewed** button, so it does not need another save.

1. Open the Decision Drift issue panel. Enter `557057` and select **Check source**. Record the actual published version; do not assume it is still version 1.
2. Select **Review current version**, inspect the source, select the approval checkbox, and select **Save reviewed version**. Confirm the receipt identifies the saved version and says no Jira comment was posted.
3. Reopen the issue. The source must restore automatically, with the same reviewed and published versions and **Source unchanged since review**. Confirm that the Jira description and comment count have not changed.
4. Change the synthetic Confluence page's constraint to a different value from its current one, for example between project-admins-only and project-members-only, then publish the next version. The November 3 run left it at project-members-only/version 2, so another run must make an actual new change. Do not edit the Jira issue. Recheck the tracked source: it must report **Source changed since review**, show the old and current versions, and display verified removed/added text when history is accessible. An unavailable comparison must remain a warning.
5. Review and explicitly save the new source version. Reopen again and verify the unchanged state. The optional **Preview source-link note** action is separate and is not needed for this test.
6. For a separate stale-review check after the source is marked unchanged, publish one new synthetic edit, recheck and prepare its review, then publish a second edit before confirming that preview. Expect `STALE_PREVIEW`; the prior saved review must remain in effect. Reload and prepare a fresh review of the latest published version.

Record each observation and the deployed version in the status document. The November 3 core sequence passed on development 2.3.0, including initial baseline creation, conditional advancement, history comparison and reloads. See the [sanitized live evidence](evidence/2026-11-03-source-review.json). Separate live stale/expired/concurrent/denied-user/replay checks remain pending; the 56 local/runtime checks do not substitute for those cloud results.

## Passage-link verification

Use a separate synthetic issue and published page so the DD-1/page 557057 source-review fixture remains stable. The November 3 passage fixture is **DD-2** (`10042`) and **Decision Drift passage demo**, page **1605635**. Its initial Jira description includes `CSV export is available to project members only.`; the initial source contains `Constraint: Export is available to project members only.` and a separate November rollout sentence.

1. Record the synthetic issue's description JSON and comment count before testing, using an authenticated read of `/rest/api/3/issue/DD-2?fields=description,comment`. Keep full responses and account data out of public evidence. Open DD-2 in Chrome Incognito and open **Decision Drift**. Check page `1605635`, then **Read current text**. Confirm the app displays the current Confluence text and Jira description.
2. Enable **Link specific decision and requirement passages**. Copy the complete constraint sentence from Confluence and the acceptance-criterion sentence from the Jira description. Each selection must be exact, unique and 8–1,000 characters. The summary is not an eligible requirement field.
3. Choose **Review linked passages**. Inspect both server-verified passages. The save button must stay disabled until the passage-link approval checkbox is selected. Changing either passage or the tracking mode must discard the preview and approval.
4. Approve and **Save reviewed passage link**. Reload the whole Jira page, reopen the app and verify automatic source restoration, both matching passages, and the saved reviewed version. No Jira comment should be created and the description must stay unchanged.
5. Edit only the source rollout sentence and publish a new version. Recheck: expect **Linked text matches; other content changed** with both passages appearing once. Review surrounding changes; this result does not establish that a contextual edit is semantically irrelevant.
6. Duplicate the exact source constraint, publish, and recheck: expect an ambiguous link. A preview of that duplicated selection must fail; a reviewer must choose unique text. Then replace the duplicated constraint with edited wording and publish: expect **Linked decision or requirement needs review**, a verified earlier source passage, and no automatically selected replacement source quote. The November 3 run reworded it as `Constraint: Only project members may export CSV data.`; this tests exact-text changes, not semantic-conflict detection.
7. Choose a fresh unique source passage explicitly, review both passages and save. Reload again to verify the advanced comparison point. Independently compare the Jira description and comment count with the values recorded before the sequence.

Record actual versions, states, deployment version and limitations in [the status document](spike-status.md), with sanitized evidence only. Local tests cover moved text, unavailable evidence, stale/expired approvals, replay and competing reviewers; these do not substitute for separate live checks. Never change product subscriptions, billing, payment methods or licensed seats to run this sequence.

The November 3 sequence above passed on development **2.4.0**: page 1605635 moved through published versions 1–4 and is now reviewed at **version 4**. Both full reloads restored the saved passage pair. The final independent Jira read confirmed the original DD-2 description was exactly unchanged and comments stayed **0 → 0**. [Sanitized passage evidence](evidence/2026-11-03-passage-review.json). For a repeat run, create a new pair or explicitly review the current version before changing it; the existing fixture no longer starts at version 1.

## Selected review queue verification

Open **Decision Drift** from the Jira project's app navigation, rather than from an issue. The native project page is supported in Jira and Jira Service Management. [Official project-page reference](https://developer.atlassian.com/platform/forge/manifest-reference/modules/jira-project-page/).

1. Confirm no product check starts before submitting a selection. Enter one to eight unique keys from that project, separated by commas or new lines. Duplicate keys, a ninth key and malformed keys must be rejected before a resolver call. A different-project key must be rejected by the server before reading issue details.
2. Check a small synthetic selection, starting with DD-1 and DD-2 on this development site. Inspect the state, reviewed/published versions, check timestamp and distinct **Open DD-1** / **Open DD-2** actions. Both existing fixtures were last reviewed at versions 2 and 4 respectively. Add a deliberately nonexistent key to exercise a partial failure without changing anyone's permissions.
3. Refresh after a completed check. Previous rows and counters must disappear while fresh authorization runs. Editing the selection must clear results immediately. If edited while pending, an old response must stay hidden, and the new check must wait until that batch finishes.
4. Open a readable issue through its row action, inspect Decision Drift and perform any review through its existing preview/approval flow. Refresh the queue to observe its new state. Queue refresh itself must never change a baseline, preview, description or comment.
5. For denied issues, verify that only the submitted key and a generic reason appear. For readable Jira issues with inaccessible Confluence, the fresh Jira summary/link may remain, while source versions are hidden. Do not alter security settings merely to run this check; use an already configured restricted synthetic fixture when available.

The local queue tests exercise all five statuses, history limitations, rate/service/storage failures, consent, privacy and concurrency. They do not establish live cloud results. The maximum is one explicit batch of eight issues with two workers, at most 26 product reads and eight baseline reads, and no background refresh. Keep full API responses and private browser captures out of public evidence.

The **core sequence passed live in regular Chrome on development 2.5.0 on November 4**. The operator opened the queue from the actual project sidebar and completed three batches at server times **10:56:46**, **10:57:34** and **10:58:04 CET**. DD-1 matched review at `2/2`, DD-2 at `4/4`, and nonexistent DD-999999 showed Could not verify without summary, versions or an issue link. Duplicate and ninth-key selections disabled checking; OTHER-1 was rejected by the server with `WRONG_PROJECT`. Selection edits cleared results, and refresh cleared rows/counters while pending before fresh results appeared. Independent Jira API comparisons confirmed exact description equality and comment counts `1 → 1` for DD-1 and `0 → 0` for DD-2. No fixture edit, saved review or comment was required. [Sanitized queue verification record](evidence/2026-11-04-queue-review.json).

The row link href and manually opened Jira issue destination were verified; creation of a new tab by clicking the row action was not verified because browser automation could not locate that tab. During that earlier check the regular-profile issue panel showed a loading skeleton. The later [ordinary native-tab checks](#browser-startup-verification) succeeded in the same regular profile; the remaining startup difference is associated with some automation-controlled tabs, with its exact cause unproven. The earlier attempt blocked before navigation is historical; it does not describe the current queue result.

The later judge-demo sequence below verified all five states live. Denied-user and inaccessible-Confluence behavior, controlled late-response/concurrency races and a separate-site installation remain unverified live. DD-999999 was deliberately nonexistent, so its result does not establish permission-denial behavior. The deployment and checks added no payment, billing, subscription, seat, scope or security-setting changes.

## Reproducible judge demo

Run `npm run demo-kit` for the canonical copyable text and selections, or `npm run demo-kit -- --verify` to check the scenario offline. The portable input is [judge-demo.json](../fixtures/judge-demo.json). This tool exercises the real app services through simulated adapters and performs no account or network actions. Keep its offline result separate from observed cloud evidence.

Create four fresh issues in one project and one published Confluence page. Record actual keys and versions by role. Keep DD-1 and DD-2 as the earlier verification fixtures. Use the fixture's exact summaries/descriptions and its `source.initialParagraphs` for the initial published page.

1. In **Context**, inspect the shared page, select the declared expiration sentence and Jira requirement, preview both, explicitly approve and save. Repeat for **Edited** using its initial admin-only access pair. Complete each save before the next review.
2. Publish `source.currentParagraphs` as the next version of that same page. It changes the access decision from admins-only to members-only and the rollout month from November to December. Record the actual version; never assume a reset starts at v1.
3. In **Matching**, explicitly review the declared column-order pair against the current page. Leave **Unlinked** without any saved review. Reload the issue panels, then check the four keys in the project queue. Expect Matches review, Context changed, Needs review and Source not linked respectively.
4. Inspect Context's matching expiration passages and surrounding changes. Context still requires human judgment. In Edited, compare the verified earlier access passage with the current decision. A human then edits only that synthetic issue's description to `repair.descriptionParagraphs`, rechecks, explicitly selects the new source/requirement pair, previews, approves and saves. The app does not rewrite the requirement.
5. Refresh the queue. Only Edited should move to Matches review; Context and Unlinked keep their states. Confirm that the three other Jira descriptions and all comment counts stay unchanged. Record the intended human description change separately from app behavior.

For a repeat run, publish the initial text as a **new current version**, restore Edited's initial synthetic description, and explicitly rereview Context and Edited against that version. Publish the current text as the next version, then explicitly rereview Matching. This advances page versions and reviews through the normal workflow. Preserve app storage and page history. Once Unlinked has a saved baseline, replace it with a fresh issue for that role; the app has no unlink action.

The kit is implemented and independently reviewed, with all **140 local tests** passing. The offline verifier uses simulated adapters; those tests do not establish cloud behavior.

The live setup used shared source page **2129921**. DD-4 (Context) saved its expiration passage against version 1 at **11:16:56 CET**; DD-5 (Edited) saved its initial admin-only access pair at **11:25:45 CET**. After publishing the fixture's members-only decision and December rollout as version 2, DD-3 (Matching) saved its column-order pair at **11:29:09 CET**. DD-6 (Unlinked) was never reviewed. The **11:29:18 CET** queue check showed DD-3 Matches review `2/2`, DD-4 Context changed `1/2`, DD-5 Needs review `1/2`, DD-6 Source not linked, and nonexistent DD-999999 Could not verify without summary, versions or link.

The human-repair sequence also passed on development **2.5.0**. Through Jira's ordinary inline editor, the operator changed only DD-5's description to `CSV export is available to project members only.` In Incognito, reopening DD-5 restored its tracked version 1/current version 2 and Needs review state, with exact history showing both the access and rollout changes. The fresh version 2 passage preview showed the exact current pair and an unchecked approval with Save disabled. After explicit approval, saving at **11:32:52 CET** returned a version 2 receipt saying no Jira comment was posted. The **11:33:02 CET** queue refresh changed only DD-5 to Matches review `2/2`; DD-3 stayed matching, DD-4 stayed Context changed, DD-6 stayed unlinked and DD-999999 stayed unavailable. Independent before/after Jira API comparisons confirmed unchanged DD-3/DD-4/DD-6 descriptions, only the intended manual DD-5 edit and all four comment counts **0 → 0**. [Sanitized judge-demo record](evidence/2026-11-04-judge-demo.json).

The cloud fixture is left **after repair**, with DD-5 reviewed at source version 2. The forward-reset procedure above is documented; it has not been run live. A repeat demonstration must intentionally prepare the initial review states again through that workflow.

The planned presentation lasts 2:40: selected queue (0:00–0:25), changed context (0:25–0:50), human correction and approved rereview (0:50–1:55), queue refresh (1:55–2:20), then the unlinked starting state and evidence limits (2:20–2:40). This is a script target, not a measured recording duration or time-saving claim. Separate-site judge installation remains a later check. No new app deployment, scope, dependency, security-setting or payment change was required for this fixture sequence.

## Judge installation later

After the live spike passes, deploy the reviewed build to production:

```bash
npm run forge -- deploy --environment production
```

In the Developer Console, open the app's Distribution controls, choose **Sharing** for external judges and generate the installation link. Provide product requirements, configuration and sample-data instructions with it. Judges must be site admins to install; a logged-out preview or a link to your own Jira session does not replace installation access.

Marketplace listing is optional for the main Codegeist entry. Licensed or Marketplace-submitted apps have sharing-link restrictions, so keep the spike unlicensed and use the ordinary distribution path. [Forge app distribution](https://developer.atlassian.com/platform/forge/distribute-your-apps/).

Keep the app and instructions usable throughout judging, January 5–February 3, 2027. Recheck [the Codegeist rules](https://codegeist2026.devpost.com/rules) before submission.
