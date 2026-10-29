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

The repository pins Node.js **22.23.4** as a local development dependency for Forge CLI **15.0.0**. After dependency installation, npm scripts pick up that project-local Node executable. This handles an older host patch release without replacing the machine's global Node installation. No global Forge install or `sudo` is necessary.

```bash
cd AI-Agents-For-Founders
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

Open the fixture issue and its **Decision Drift** issue panel. Paste its published Confluence page URL or numeric ID into **Confluence page URL or ID**, choose **Check access**, then **Preview reviewed update**. Review the exact comment, tick the approval checkbox and choose **Apply reviewed update** only when you intend to add it. Check the resulting comment in Jira itself.

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

The 15 local fixture tests exercise source-format validation, approval, preview expiry, user/issue/site binding, changes since preview, revoked source access, concurrent requests, replay, unknown outcomes and untrusted caller payloads. They use simulated gateways and storage; a passing result does not verify Atlassian's live APIs, authorization or atomic KVS behavior.

The permission check can use a controlled test account you administer; it does not require recruiting another person. If no such account is available, record the denied-user check as pending rather than inferring it passed from an administrator's successful read.

## Judge installation later

After the live spike passes, deploy the reviewed build to production:

```bash
npm run forge -- deploy --environment production
```

In the Developer Console, open the app's Distribution controls, choose **Sharing** for external judges and generate the installation link. Provide product requirements, configuration and sample-data instructions with it. Judges must be site admins to install; a logged-out preview or a link to your own Jira session does not replace installation access.

Marketplace listing is optional for the main Codegeist entry. Licensed or Marketplace-submitted apps have sharing-link restrictions, so keep the spike unlicensed and use the ordinary distribution path. [Forge app distribution](https://developer.atlassian.com/platform/forge/distribute-your-apps/).

Keep the app and instructions usable throughout judging, January 5–February 3, 2027. Recheck [the Codegeist rules](https://codegeist2026.devpost.com/rules) before submission.
