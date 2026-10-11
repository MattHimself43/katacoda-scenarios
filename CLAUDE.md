# CLAUDE.md

The NoirConnects Intelligence app lives in `noirconnects-intelligence/`. Its README covers setup, architecture and the status of each phase.

## Standing instructions from the owner

These apply to every Claude Code session working on this project.

After completing every development phase or significant update:

1. Launch the latest version of NoirConnects Intelligence.
2. Provide an interactive browser preview link that the owner can open, including on an iPad.
3. Make sure the owner can navigate the dashboard and test its features. For example, provide sign-in details for a preview-only account.
4. Keep the preview accessible for as long as the development environment supports it.
5. If the preview URL changes, provide the updated link.
6. Do not start the next phase until the owner has had the opportunity to review the interface and says to continue.

The owner does not want additional testing reports when asking for a preview. Give the link and how to sign in.

If the environment cannot host a reachable preview, say so plainly and point to the stable deployment option documented in `noirconnects-intelligence/docs/deployment.md`.

## Project rules (from the build specification)

- **Approval-first.** Never send external email or take a material action without explicit human approval through the approval engine.
- **No fabricated data.** Never invent metrics, contacts, sponsorships or budgets. Unverified data must be labelled as unverified.
- **Zero paid AI APIs.** Never use a paid AI API, an undocumented Claude endpoint, or session scraping.
- **Honest integration status.** Don't claim an integration is connected (Hostinger, scheduled Claude research) until an end-to-end test has succeeded.
- **Tests stay safe.** Run `npm test` in `noirconnects-intelligence/` before pushing. Tests use synthetic `.example` data and never send real email.
