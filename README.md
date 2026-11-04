# Decision Drift

A Forge app for software teams that keeps the Confluence decision behind a Jira issue in view. It remembers a reviewed source version, restores that source on the next visit, and checks exact decision and requirement passages selected by the reviewer.

The **Selected review queue** adds a native Jira project page for up to eight unique issues from that project. Each explicit check shows fresh review states, reviewed/published source versions, a check timestamp and an **Open issue** link. An inaccessible issue reveals no cached details; a readable issue with an unavailable source keeps its freshly authorized Jira information. Review and approval remain in the individual issue's Decision Drift panel.

Queue checks are read-only and use two workers per batch, with no polling, automatic retries or saved selection. A full eight-issue batch performs at most 26 product reads and eight baseline reads. Typing does not invoke Forge, and the page waits for a pending batch to finish before starting another. The queue uses the existing app scopes and adds no paid AI service, subscription or storage entity.

The implemented source-review flow stores one shared reviewed source per Jira issue. Inspect a page, review its complete supported text, and explicitly save that version as the comparison point. Subsequent checks show reviewed versus published versions, work-item changes, and bounded text differences fetched from Confluence history with the current user's permissions. Saving a review does not post a Jira comment.

The passage-link feature is deployed and its core review sequence is live-verified. A reviewer can link one exact, unique Confluence passage to one exact, unique passage in the **Jira description**. The server verifies both selections against complete supported text. Durable link records add only a schema version, the description-field identifier, offsets, lengths and hashes; they retain no passage text. Later checks can recover a uniquely matching passage after it moves, flag edited or missing text, reject duplicates, and show unavailable evidence when current text or verified history cannot support the check. Movement and unavailable-evidence cases have local coverage but have not been verified live.

When both linked passages still match once but surrounding content changed, the app displays **Context changed** (`outside_scope`). The reviewer must inspect that context before deciding whether the link still applies. Matching passages establish text continuity, not semantic agreement or irrelevance of surrounding changes. Every preview needs explicit approval; changing either passage or the tracking scope invalidates that preview and its approval. Whole-page tracking remains available through a separately reviewed scope change.

Review previews expire after ten minutes. Confirmation rechecks access and source/work-item freshness; conditional Forge Custom Entity transactions prevent an older pending review from replacing a newer review. Durable records contain metadata and fingerprints, never source titles or body text. Historical excerpts are fetched afresh; inaccessible or incomplete history remains visibly unresolved. Text changes establish freshness, not semantic requirements conflict.

An optional source-link Jira note retains its own exact preview and explicit approval. It records page/version/review ID without copying source titles or text. Its operation claim blocks duplicate submission of the same review and preserves uncertain write outcomes for manual reconciliation. Neither action rewrites the issue description.

## Account and cost

You need **one Atlassian account**, a **Forge Developer Space**, and an **Atlassian cloud development site with Jira and Confluence on the same site**. Your account must be able to administer the site and install apps.

**A paid Forge subscription is not required for this non-AI spike while usage stays within the free allowance.** Atlassian provides free Jira/Confluence development instances. Forge usage above its allowance can incur charges; native Forge LLM and Rovo have separate pricing. This spike does not need either AI service. See the [account and setup guide](docs/atlassian-setup.md) for verified links, billing details and login instructions.

## Local setup

From your repository checkout, use Node.js 22 and npm to install the dependencies. The repository pins Node.js **22.23.4** and Forge CLI **15.0.0** locally; after installation, npm scripts pick up that local runtime. This meets the CLI's minimum patch requirement without changing the global Node installation. The app's deployed runtime is `nodejs22.x`.

```bash
npm ci
npm test
npm run check
npm run lint
```

These commands check local code. They do not prove that the app is registered, deployed, installed or authorized in Atlassian.

`npm run lint` runs the same manifest/compilation check as `npm run check`; it is not a separate ESLint check. The suite now includes **131 local checks**: 15 comment-spike, 40 source/passage integration, 9 passage matching, 9 source parsing, 17 queue integration and 41 real bundled React/UI Kit journeys. Product and storage boundaries in local tests are simulated.

## Connect the app

Complete the [Atlassian setup guide](docs/atlassian-setup.md), then run the interactive login locally:

```bash
npm run forge -- login
npm run forge -- whoami
npm run forge -- developer-spaces list
```

Create a scoped token for **Forge** using Atlassian's recommended scopes and paste it only into the local login prompt. Keep the token out of chat, source files and command arguments.

This checkout is registered as **Decision Drift** in **MyDevSpace** and its manifest contains the real app ID. Reuse that registration when deploying; do not register again or run `forge create` over this repository. The setup guide describes the steps for a separate, fresh checkout.

The [small synthetic Jira/Confluence fixture](docs/atlassian-setup.md#5-create-the-synthetic-live-fixture) is already available on this development site: issue **DD-1** and Confluence page **557057**. Saving a reviewed source version updates app state only. Explicitly adding a reviewed Jira note creates another comment.

## Verification status

**November 4: the selected review queue is implemented, independently reviewed and deployed as development version 2.5.0.** All 131 checks, compilation of both frontend entries and official Forge lint passed. Tests cover the eight-issue boundary, duplicate and cross-project rejection, current-user authorization, exact drift integration, partial failures, consent propagation, read-only behavior and bounded concurrency. Runtime journeys cover selection edits, refresh clearing, late responses and malformed results. Deployment succeeded at `2026-11-04T09:44:45.003Z`; the existing Jira/Confluence installation is up to date. Queue browser verification remains pending because browser control was unavailable before navigation; no live queue product requests were run. [Verification record](docs/evidence/2026-11-04-queue-review.json).

**The core passage-link sequence passed live in Chrome Incognito on development version 2.4.0.** Source commit [cf7c56c](https://github.com/haochen8/Decision-Drift/commit/cf7c56c) is pushed; deployment succeeded at `2026-11-03T19:07:34.215Z`. All 97 local checks, compilation and official Forge lint passed. The baseline index remains **ACTIVE**, and the existing Jira/Confluence installation is up to date at major version 2 with unchanged scopes.

The fresh fixture is Jira **DD-2** (ID `10042`) and source page **1605635**, **Decision Drift passage demo**. The operator explicitly saved its version 1 passage link, reloaded to restore the exact quotes, verified that editing a quote invalidated the preview and approval, observed **Context changed** after a rollout-month edit, and observed **Ambiguous link** after duplicating the linked constraint. Preparing that ambiguous link was rejected. Rewording the linked constraint produced **Needs review**, an empty current-source selection and the historical text difference. Explicitly selecting and approving the new source text saved version 4; a full reload restored reviewed/published **4/4** and the exact new quotes. An independent Jira API comparison confirmed its description was unchanged and comment count stayed **0**. DD-1/page 557057 was not edited. [Sanitized passage-review evidence](docs/evidence/2026-11-03-passage-review.json).

On November 3, 2026, the preceding persistent source-review feature passed its local suite, compilation and official Forge lint. Independent implementation reviews caught and fixed the auto-load form API mismatch, an idempotent receipt that could name the wrong reviewed version, and a misleading historical-access warning for a different source. Development version **2.3.0** deployed successfully at `2026-11-03T17:17:59.773Z`; the `decision-baseline` entity's default index is **ACTIVE** and the existing Jira/Confluence installation is up to date. These earlier 2.3.0 results establish the source-review flow; passage-link verification is recorded separately for 2.4.0 above.

The **live source-review flow passed in Chrome Incognito**: explicitly save page 557057/version 1, reload and automatically restore it, publish a synthetic admins-only-to-members-only constraint change, detect v1 → v2 with the exact historical text difference, explicitly save v2, and reload with v2 reviewed and unchanged. An independent Jira API check confirmed its original description was unchanged and no additional comment appeared; only `10003` remained. The fixture is now published and reviewed at **version 2**. [Sanitized live evidence](docs/evidence/2026-11-03-source-review.json) · [Live verification steps](docs/atlassian-setup.md#persistent-source-review-verification).

The earlier access/comment spike passed on October 29 on `decision-drift.atlassian.net`: authentication, registration, official Forge lint, development deployment, installation in both products, Forge current-user reads, a preview without a comment, and one explicitly approved comment. It read source page **557057** at **version 1** and created [comment 10003 on DD-1](https://decision-drift.atlassian.net/browse/DD-1?focusedCommentId=10003). No source title or body was copied into that comment. [Verification status and limitations](docs/spike-status.md).

The latest development deployment is **2.5.0**; the preceding live-verified sequence used **2.4.0** in **Chrome Incognito**. The regular browser session's loading issue remains unresolved; AdBlock is active again after its earlier diagnostic. No payment method, billing settings, product subscription, licensed seat or security setting was changed. [Earlier access/comment evidence](docs/evidence/live-review-result.json). Native browser screenshots remain local because they include personal browser bookmarks.

Production judge installation and live moved-text/unavailable-evidence/stale/expired/concurrent/denied-user/replay checks remain separate follow-up work. Local/runtime tests and the successful single-user review sequences do not establish those results.

## Next features and winning strategy

Codegeist gives equal weight to platform implementation, coherent design, credible audience impact, originality and presentation. The feature sequence therefore prioritizes a working review story that a judge can reproduce in a fresh site. [Official judging criteria](https://codegeist2026.devpost.com/#judging-criteria).

1. **Persistent source review — implemented, reviewed, deployed and live-verified.** The v1 → v2 review/reopen/change/diff/rereview sequence passed without another Jira comment. Evidence records the actual versions and the remaining untested live failure cases.
2. **Exact decision-to-description passage link — implemented, reviewed, deployed and core sequence live-verified.** The DD-2 flow passed save/reopen, approval invalidation, context changes, duplicate rejection and explicit rereview of edited linked text through source version 4. Matching text with changed context still needs manual review. Moved-text and unavailable-evidence cases remain locally covered but untested live.
3. **Selected review queue — implemented, reviewed and deployed.** The native project page checks at most eight manually selected issues, with fresh project/issue authorization, two workers, minimal result metadata and an individual review action. Its cloud browser check remains pending. Measure the complete manual review task against the app on a declared synthetic dataset before claiming time savings.
4. **Judge-ready delivery.** Verify installation on a separate site, provide repeatable synthetic setup data, complete the remaining live failure tests, and record an end-to-end demo designed to fit three minutes. Production distribution and submission are later milestones.

After every implementation, review correctness and the product flow, fix findings, run relevant checks, and commit and push the completed change. No external AI service, paid model call or billing change is needed for passage linking or the selected review queue.

The queue MVP implements these boundaries:

- Each row reports **Matches review**, **Context changed**, **Needs review**, **Source not linked** or **Could not verify** from fresh permission-checked evidence. It makes no release-readiness claim.
- Results return only the authorized summary and minimal review metadata, with no source bodies or hashes. An inaccessible row must not prevent accessible rows from completing.
- Editing the selection or refreshing clears old results; late responses cannot restore an obsolete selection. The MVP has no bulk approval or persistent shared selection. A later private named selection could store issue IDs only.

The next feature is a repeatable judge demo kit: four synthetic issues showing a matching review, changed context, an edited or ambiguous link and an unlinked source, with exact setup/reset steps. Follow it with a separate-site installation check and the remaining live failure cases. This gives a judge a reproducible end-to-end task before we add more features.

The [live verification runbook](docs/atlassian-setup.md#live-verification-runbook) covers source reads, preview, confirmed writes, permission failures and duplicate submissions. Use synthetic issues and pages in the development site.

## Hackathon target

[Codegeist 2026](https://codegeist2026.devpost.com/) closes December 22, 2026 at 21:00 Europe/Stockholm. The intended category is Apps for Software Teams. The main submission needs a functioning Forge app, a judge installation link with setup instructions, explanatory text and a public YouTube demo under five minutes; design the core demonstration to fit three minutes. Recruited customer testers and Marketplace publication are not main-entry requirements. [Official rules](https://codegeist2026.devpost.com/rules).

Keep the production app and installation instructions usable through the January 5–February 3, 2027 judging period. Review the current official rules again before submitting.
