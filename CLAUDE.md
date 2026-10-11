# CLAUDE.md

The NoirConnects Intelligence app lives in `noirconnects-intelligence/`. Its README covers setup, architecture and the status of each phase.

## Platform roles (decided by the owner)

| Platform | Role |
|---|---|
| Claude Code | Primary development: features, maintenance, debugging, testing, migrations, integrations. |
| Lovable (paid) | Hosting and infrastructure: dashboard URL, auth, Lovable Cloud database (PostgreSQL), production deployment. |
| GitHub | Source control. `MattHimself43/katacoda-scenarios` is the preserved SQLite-era backup; never overwrite or delete it. The Lovable project uses its own separate repository. |
| Claude Pro | Primary AI research system. No paid Anthropic API. |
| Hostinger | Email provider. |

- **Approval gates.** Don't migrate code or data into Lovable without the owner's explicit approval of the migration plan. Database changes must be non-destructive and tested.
- **Cost control.** Don't introduce paid services (including paid AI APIs). If more infrastructure is needed, explain the cost and alternatives first.

## Standing instructions from the owner

These apply to every Claude Code session working on this project.

After completing every development phase or significant update:

1. Deploy or update the application where the platform supports it.
2. Give the owner an interactive preview URL that works on an iPad.
3. Make sure the owner can navigate the dashboard and test its features. For example, provide sign-in details for a preview-only account.
4. **Label every link as either a temporary preview or the published (production) application.**
5. **Never claim a deployment succeeded without verifying it** (for example, by loading the URL and signing in).
6. If the preview URL changes, provide the updated link.
7. Do not start the next phase until the owner has reviewed the interface and says to continue.

The owner does not want additional testing reports when asking for a preview. Give the link and how to sign in.

If the environment cannot host a reachable preview, say so plainly. Point to the Lovable deployment, or as a fallback, to `noirconnects-intelligence/docs/deployment.md`.

## Security (internal agency platform)

- Admin authentication must be secure, and every dashboard route must be protected.
- Authorization happens server-side, and the database is protected (RLS on Lovable Cloud).
- Hostinger credentials live only in server-side secrets.
- Audit logs are persistent, and every external action requires approval.
- Never expose private agency information publicly.

## Project rules (from the build specification)

- **Approval-first.** Never send external email or take a material action without explicit human approval through the approval engine.
- **No fabricated data.** Never invent metrics, contacts, sponsorships or budgets. Unverified data must be labelled as unverified.
- **Zero paid AI APIs.** Never use a paid AI API, an undocumented Claude endpoint, or session scraping.
- **Honest integration status.** Don't claim an integration is connected (Hostinger, scheduled Claude research) until an end-to-end test has succeeded.
- **Tests stay safe.** Run `npm test` in `noirconnects-intelligence/` before pushing. Tests use synthetic `.example` data and never send real email.
