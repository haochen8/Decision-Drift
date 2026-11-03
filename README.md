# Decision Drift

A Forge app for software teams that keeps the Confluence decision behind a Jira issue in view. It remembers a reviewed source version, restores that source on the next visit, and shows when the page or work item changes.

The current feature adds a shared reviewed source per Jira issue. Inspect a page, review its complete supported text, and explicitly save that version as the comparison point. Subsequent checks show reviewed versus published versions, work-item changes, and bounded text differences fetched from Confluence history with the current user's permissions. Saving a review does not post a Jira comment.

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

`npm run lint` runs the same manifest/compilation check as `npm run check`; it is not a separate ESLint check. The suite currently contains 56 checks, including backend scenarios, bounded document parsing, and 11 journeys through the real bundled React/UI Kit event handlers.

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

On November 3, 2026, all 56 local checks, compilation and official Forge lint passed for persistent reviewed-source tracking. Independent implementation reviews caught and fixed the auto-load form API mismatch, an idempotent receipt that could name the wrong reviewed version, and a misleading historical-access warning for a different source. Development version **2.3.0** deployed successfully at `2026-11-03T17:17:59.773Z`; the `decision-baseline` entity's default index is **ACTIVE** and the existing Jira/Confluence installation is up to date.

The **live source-review flow passed in Chrome Incognito**: explicitly save page 557057/version 1, reload and automatically restore it, publish a synthetic admins-only-to-members-only constraint change, detect v1 → v2 with the exact historical text difference, explicitly save v2, and reload with v2 reviewed and unchanged. An independent Jira API check confirmed its original description was unchanged and no additional comment appeared; only `10003` remained. The fixture is now published and reviewed at **version 2**. [Sanitized live evidence](docs/evidence/2026-11-03-source-review.json) · [Live verification steps](docs/atlassian-setup.md#persistent-source-review-verification).

The earlier access/comment spike passed on October 29 on `decision-drift.atlassian.net`: authentication, registration, official Forge lint, development deployment, installation in both products, Forge current-user reads, a preview without a comment, and one explicitly approved comment. It read source page **557057** at **version 1** and created [comment 10003 on DD-1](https://decision-drift.atlassian.net/browse/DD-1?focusedCommentId=10003). No source title or body was copied into that comment. [Verification status and limitations](docs/spike-status.md).

The deployed and live-verified development version is **2.3.0** in **Chrome Incognito**. The regular browser session's loading issue remains unresolved; AdBlock is active again after its earlier diagnostic. No payment method, billing settings, product subscription or licensed seat was changed. [Earlier access/comment evidence](docs/evidence/live-review-result.json). Native browser screenshots remain local because they include personal browser bookmarks.

Production judge installation and live stale/expired/concurrent/denied-user/replay checks remain separate follow-up work. Local/runtime tests and the successful single-user source-review flow do not establish those results.

## Next features and winning strategy

Codegeist gives equal weight to platform implementation, coherent design, credible audience impact, originality and presentation. The feature sequence therefore prioritizes a working review story that a judge can reproduce in a fresh site. [Official judging criteria](https://codegeist2026.devpost.com/#judging-criteria).

1. **Persistent source review — implemented, reviewed, deployed and live-verified.** The v1 → v2 review/reopen/change/diff/rereview sequence passed without another Jira comment. Evidence records the actual versions and the remaining untested live failure cases.
2. **Relevant decision passage — next implementation.** Let a reviewer select an exact decision passage and map it to a Jira requirement. Verify the selection on the server and distinguish a change to that passage from an unrelated page edit. Ambiguous, deleted or inaccessible passages must request review. The demo should contrast an unrelated edit with an admin-only-to-member-access decision change.
3. **Release review queue.** Present a small, bounded set of linked issues with changed/unresolved/reviewed states and clear next actions. The queue must respect each viewer's current permissions. Measure the complete manual review task against the app on a declared synthetic dataset before claiming time savings.
4. **Judge-ready delivery.** Verify installation on a separate site, provide repeatable synthetic setup data, complete the remaining live failure tests, and record an end-to-end demo designed to fit three minutes. Production distribution and submission are later milestones.

After every implementation, review correctness and the product flow, fix findings, run relevant checks, and commit and push the completed change. No external AI service, paid model call or billing change is needed for the current feature or the next passage-comparison slice.

The [live verification runbook](docs/atlassian-setup.md#live-verification-runbook) covers source reads, preview, confirmed writes, permission failures and duplicate submissions. Use synthetic issues and pages in the development site.

## Hackathon target

[Codegeist 2026](https://codegeist2026.devpost.com/) closes December 22, 2026 at 21:00 Europe/Stockholm. The intended category is Apps for Software Teams. The main submission needs a functioning Forge app, a judge installation link with setup instructions, explanatory text and a public YouTube demo under five minutes; design the core demonstration to fit three minutes. Recruited customer testers and Marketplace publication are not main-entry requirements. [Official rules](https://codegeist2026.devpost.com/rules).

Keep the production app and installation instructions usable through the January 5–February 3, 2027 judging period. Review the current official rules again before submitting.
