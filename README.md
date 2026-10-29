# Decision Drift

A Forge technical spike for Codegeist 2026. The product direction is to connect Jira work with the Confluence decisions behind it, then make changed or missing evidence visible before a release.

The spike focuses on one reviewable path: inspect a Confluence source, prepare an update, and add a source-linked Jira comment only after the user reviews it. The comment records the source URL, page version and review ID without copying the page's title or text into Jira.

Reviews expire after ten minutes. Confirmation rechecks the acting user's access and rejects changes to the issue or source since preview. Server-side operation claims block duplicate writes, and an unconfirmed write is reported as an unknown outcome rather than retried automatically. The comment is additive; the spike does not rewrite an issue description or decide whether a release should ship. The successful read, preview and approved write have passed live verification; failure cases and concurrent submissions remain covered by local tests pending separate cloud checks.

## Account and cost

You need **one Atlassian account**, a **Forge Developer Space**, and an **Atlassian cloud development site with Jira and Confluence on the same site**. Your account must be able to administer the site and install apps.

**A paid Forge subscription is not required for this non-AI spike while usage stays within the free allowance.** Atlassian provides free Jira/Confluence development instances. Forge usage above its allowance can incur charges; native Forge LLM and Rovo have separate pricing. This spike does not need either AI service. See the [account and setup guide](docs/atlassian-setup.md) for verified links, billing details and login instructions.

## Local setup

Use Node.js 22 and npm to install the dependencies. The repository pins Node.js **22.23.4** and Forge CLI **15.0.0** locally; after installation, npm scripts pick up that local runtime. This meets the CLI's minimum patch requirement without changing the global Node installation. The app's deployed runtime is `nodejs22.x`.

```bash
cd AI-Agents-For-Founders
npm ci
npm test
npm run check
npm run lint
```

These commands check local code. They do not prove that the app is registered, deployed, installed or authorized in Atlassian.

`npm run lint` currently runs the same manifest/compilation check as `npm run check`; it is not a separate ESLint check. The test suite contains 15 fixture-based logic tests.

## Connect the app

Complete the [Atlassian setup guide](docs/atlassian-setup.md), then run the interactive login locally:

```bash
npm run forge -- login
npm run forge -- whoami
npm run forge -- developer-spaces list
```

Create a scoped token for **Forge** using Atlassian's recommended scopes and paste it only into the local login prompt. Keep the token out of chat, source files and command arguments.

This checkout is registered as **Decision Drift** in **MyDevSpace** and its manifest contains the real app ID. Reuse that registration when deploying; do not register again or run `forge create` over this repository. The setup guide describes the steps for a separate, fresh checkout.

The [small synthetic Jira/Confluence fixture](docs/atlassian-setup.md#5-create-the-synthetic-live-fixture) is already available on this development site: issue **DD-1** and Confluence page **557057**. Reuse these fixtures for read-only checks. A new approved review creates another comment.

## Verification status

Local verification: 15 focused tests cover the reviewed-write flow, source format validation, approval binding, staleness, permission loss, concurrent approvals and uncertain write outcomes. These use an in-memory API adapter, not live Atlassian services.

The core live spike passed on `decision-drift.atlassian.net`: authentication, registration, official Forge lint, development deployment, installation in both products, Forge current-user reads from Jira and Confluence, a preview without a comment, and one explicitly approved comment. The app read source page **557057** at **version 1** and created [comment 10003 on DD-1](https://decision-drift.atlassian.net/browse/DD-1?focusedCommentId=10003). Independent Jira API inspection confirmed exactly one comment, the matching review ID and unchanged original description. No source title or body was copied into the comment. [Current spike status and limitations](docs/spike-status.md).

The current development version is **2.2.0**. Use **Chrome Incognito** for the verified flow. The regular browser session remained on loading bars, including with a text-only probe and a temporary site-only AdBlock pause; its exact cause is unresolved. The full interface is restored and AdBlock is active again. No payment method, billing settings, product subscription or licensed seat was changed. [Sanitized API evidence](docs/evidence/live-review-result.json). The native browser success screenshots remain local because they include personal browser bookmarks.

Production judge installation and live stale/expired/concurrent/denied-user checks remain separate follow-up work. The successful development-site flow does not establish those results.

The [live verification runbook](docs/atlassian-setup.md#live-verification-runbook) covers source reads, preview, confirmed writes, permission failures and duplicate submissions. Use synthetic issues and pages in the development site.

## Hackathon target

[Codegeist 2026](https://codegeist2026.devpost.com/) closes December 22, 2026 at 21:00 Europe/Stockholm. The intended category is Apps for Software Teams. The main submission needs a functioning Forge app, a judge installation link with setup instructions, explanatory text and a public YouTube demo under five minutes; design the core demonstration to fit three minutes. Recruited customer testers and Marketplace publication are not main-entry requirements. [Official rules](https://codegeist2026.devpost.com/rules).

Keep the production app and installation instructions usable through the January 5–February 3, 2027 judging period. Review the current official rules again before submitting.
