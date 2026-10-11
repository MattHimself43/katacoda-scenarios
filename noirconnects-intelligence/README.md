# NoirConnects Intelligence

An approval-first influencer marketing intelligence platform for NoirConnects. The app helps the team discover brands, run outreach, manage replies, source creators and send proposals. Every external communication and every material decision needs explicit approval from a person.

**Build status: Phases 1 and 2 of 7 are complete.** See [Phase status](#phase-status) for what works today and what doesn't yet.

---

## Quick start (local)

Requirements: **Node.js 22 LTS** (22.9 or newer) and npm 10. No paid APIs or external services are needed.

```bash
cd noirconnects-intelligence
npm install
cp .env.example .env            # optional: adjust port and database path
npm run migrate                 # creates ./data/noirconnects.db and settings version 1
npm run create-admin            # creates the owner administrator (asks for email, name, password)
```

**Development** (API with hot reload on :4000, dashboard on :5173, proxied):

```bash
npm run dev
# open http://localhost:5173
```

**Production-style** (one process; the API serves the built dashboard):

```bash
npm run build
npm start
# open http://127.0.0.1:4000
```

**Tests:**

```bash
npm test          # server test suite (Vitest). Uses temporary databases and sends no email.
npm run typecheck # server + web
```

`create-admin` works only while the database has no users. After that, manage the team in the dashboard under **Settings → Team & access**. For non-interactive setup, set `OWNER_EMAIL`, `OWNER_NAME` and `OWNER_PASSWORD`.

The server binds to `127.0.0.1` only. If you serve it over HTTPS behind a reverse proxy, set `COOKIE_SECURE=true`.

---

## Architecture

```
noirconnects-intelligence/
├── server/                     Express 5 + TypeScript API
│   ├── src/db/migrations/      Numbered SQL migrations (checksummed; never edited after applying)
│   ├── src/domain/             Configuration schema (zod), status vocabularies
│   ├── src/auth/               Password hashing (scrypt), sessions, RBAC matrix, CSRF/auth middleware
│   ├── src/services/           Business logic: approvals engine, settings, research runs, audit, users, overview
│   ├── src/routes/             HTTP endpoints (thin; validate input, then call services)
│   └── test/                   Vitest + supertest
└── web/                        React 19 + Vite + Tailwind CSS 4 dashboard
```

**Persistence.** SQLite in WAL mode through better-sqlite3. All business state lives in the database, never in Claude conversation history. Writes that read, check and then write run inside `BEGIN IMMEDIATE` transactions, so concurrent requests can't interleave.

**Approval engine** (`server/src/services/approvals.ts`). Every approval request records:

- the action type and target entity
- the exact proposed action, plus its SHA-256 content hash
- who requested it and when
- the role required to approve it
- its status: `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `EXPIRED` or `EXECUTED`
- who decided it, when, and the execution result

The engine enforces these rules:

- **Exact content.** Approvers submit the hash of the content they reviewed. If the content has changed since, the decision is refused.
- **Single use.** State changes use compare-and-set, so an approval can only be decided once and executed once. A partial unique index allows only one open approval per target and action.
- **Exact execution.** `consumeApproval()` re-hashes the action that is about to run and refuses if it differs from what was approved. Background jobs must go through it too.
- **Expiry.** Expired approvals are refused at both decision time and execution time.

**Versioned configuration** (`server/src/services/settings.ts`). Intelligence settings form one validated document.

- A change creates a `settings_change_requests` row plus an approval. Opening or editing the Settings page never counts as approval.
- When an administrator approves, one transaction does all of this:
  - checks that the request was based on the current version (stale requests are marked `SUPERSEDED`)
  - checks the reviewed hash
  - writes an immutable `settings_versions` row and updates the active `settings` rows
  - marks the approval `EXECUTED` and writes to the audit log
- Database triggers stop anyone from updating or deleting a settings version.

**Research-run snapshots.** `startResearchRun()` pins each run to the configuration version that is active at that moment. It also stores a full JSON snapshot, inside the same transaction. A trigger makes the snapshot immutable, so a run that starts during an approval always uses one consistent configuration.

**Audit log.** Append-only: `UPDATE` and `DELETE` are blocked by triggers. It records every proposal, decision, cancellation, supersession, approval execution, user change and login attempt.

**Security**

- Passwords are hashed with scrypt.
- Session tokens are 256-bit random values. Only their SHA-256 hash is stored, in an httpOnly, `SameSite=Strict` cookie.
- Sessions are revoked immediately when a user's role changes, they are deactivated, or their password is reset.
- Login attempts are rate-limited.
- State-changing requests need a custom header (`X-Requested-With: NoirConnects`) as CSRF protection.
- Responses carry a CSP, `X-Frame-Options: DENY` and `nosniff`.
- No secret ever reaches the browser.

### Roles

| Permission | ADMIN | MANAGER | RESEARCHER | VIEWER |
|---|:-:|:-:|:-:|:-:|
| View dashboard & settings | ✓ | ✓ | ✓ | ✓ |
| Propose settings changes | ✓ | ✓ | ✓ | |
| Propose follow-up policy / time zone changes | ✓ | | | |
| Approve or reject settings changes | ✓ | | | |
| Import brand research | ✓ | ✓ | ✓ | |
| Approve or decline brands | ✓ | ✓ | | |
| View audit log | ✓ | ✓ | | |
| Manage users | ✓ | | | |
| Authorize external email, approve proposals, change integrations *(enforced from Phase 3)* | ✓ | | | |

The owner account can't be demoted or deactivated, and the system always keeps at least one active administrator. Administrators may approve changes they proposed themselves, because NoirConnects currently has a single owner. A second-approver rule can be added later if the team grows.

### Database tables

These tables are created by `001_initial_schema.sql`:

| Area | Tables |
|---|---|
| Users and access | `users`, `roles`, `sessions` |
| Configuration | `settings`, `settings_change_requests`, `settings_versions` |
| Brand research | `research_runs`, `brands`, `brand_evidence`, `brand_approvals` |
| Outreach and mail | `outreach_drafts`, `email_messages`, `email_send_attempts`, `followup_jobs`, `suppression_list` |
| Creators and matching | `creator_profiles`, `creator_evidence`, `brand_requirements`, `creator_matches`, `shortlist_decisions` |
| Proposals | `proposals` |
| Approvals and audit | `approvals`, `audit_logs` |

All the spec's tables exist now, with their uniqueness constraints. Examples:

- one brand per normalized domain
- one send attempt per approval
- unique idempotency keys
- one follow-up job per brand, outreach cycle and sequence number
- unique suppression entries

This means the Overview counts already come from real tables, even for features built in later phases.

---

## Phase status

### Phase 1: done

**Implemented**

- **Foundation.** Project scaffolding, migration runner (it refuses to run if an applied migration has been edited) and the complete relational schema.
- **Accounts.** The `create-admin` bootstrap, session sign-in and sign-out, the RBAC matrix, and user management: add user, change role, deactivate, reset password.
- **Approval engine.** The universal approval engine described above.
- **Intelligence Settings:**
  - Active configuration and its version.
  - Research scheduling status, shown honestly as *Not configured*.
  - Last successful research run.
  - Propose → review the old and new values → submit.
  - Administrator approve, reject or cancel, with notes and the content fingerprint.
  - Stale-request detection.
  - Version history with per-version changes and full snapshots.
- **Default configuration.** Gaming niche, 15 brands per day as a target, Global — English-speaking, English, daily research, brands with verifiable influencer activity. Automatic external communication is **locked off** and human approval is **locked on**.
- **Other configurable settings:**
  - Minimum quality score and sponsorship evidence recency.
  - Business time zone, which defines "today" and will drive business-day calculations.
  - Creators per research assignment.
  - Creator ranking weights (30/25/20/15/10), which must sum to 100.
  - Follow-up policy (4 / 4 business days, maximum 2, weekends excluded, approval always required).
  - Whether creator availability must be confirmed before a proposal is sent.
- **Research-run snapshots** at the service and database level. They are used for imports from Phase 2.
- **Overview.** All ten counts come from the database at request time. Nothing is estimated.
- **Search.** Global search across brands and creators. Declined and dormant brands stay searchable.
- **Audit log viewer.** Filter by action, search text, expand a row for details, and page back through older entries.
- **Navigation.** A responsive black-and-white dashboard: collapsible sidebar on desktop and a drawer on mobile. Sections from later phases are marked **P2–P6** and say plainly that they aren't active yet. They contain no inert controls.

**Tests:** 49 at the end of Phase 1. They cover:

- authentication, sessions, CSRF and rate limiting
- unauthorized access attempts for every role
- settings change approval, rejection and cancellation
- configuration versioning and version immutability
- hash mismatch, double and concurrent approval, and supersession
- discovery-run configuration snapshots
- the approval engine: role checks, exact-content execution, single use, invalidation and expiry
- restart persistence and migration integrity
- append-only audit logs
- overview counts and time-zone day boundaries

I also ran the full UI flow in a headless browser:

- the owner creates a researcher
- the researcher proposes Gaming → Fitness
- the owner approves
- version 2 becomes active and the change appears in the audit log
- the mobile layout at 390 px has no horizontal overflow

### Needs external configuration

Nothing yet. Phase 1 runs entirely on your machine. Phase 3 will need Hostinger Mail credentials, supplied as server-side environment variables only.

### Known limitations

- The login rate limiter keeps its state in memory, which assumes a single process. That's fine for local hosting, but it resets on restart.
- Hostinger Mail isn't integrated yet (Phase 3), and nothing is shown as connected.
- No direct Claude research sync exists. Research is brought in through the validated JSON/CSV import (Phase 2). Phase 7 will look into whether Claude Pro's supported scheduled features can deliver results to a place the app can read. It will not use the paid API, undocumented endpoints or session scraping.
- **Verification flags come from the researcher.** The app enforces structure (a source URL is required for verified evidence), but it doesn't open the source links itself. Reviewers should click through the evidence before approving.
- **Domain matching** uses a built-in list of common two-part suffixes (`.co.uk`, `.com.au`, …) rather than the full Public Suffix List. Rare suffixes may be treated as the registrable domain itself.
- **The quality score** is a transparent heuristic, not a prediction. You can change its threshold (minimum score) and recency window in Settings.
- There is no job scheduler yet (Phase 4). Approval expiry is checked at decision and execution time, and the `expireDueApprovals()` job is ready to be scheduled.

### Phase 2: done

**Implemented**

- **Research format.** `brand-research/v1` covers JSON, plus a CSV form with one row per piece of evidence. It is documented in [`docs/research/brand-research-v1.md`](docs/research/brand-research-v1.md), alongside synthetic JSON and CSV examples, a Claude prompt template, and a JSON Schema you can download (`GET /api/research/brand-schema`).
  - Unknown fields are rejected, so invented data such as budgets can't slip in.
  - Each contact field carries its own `verified` flag.
  - Evidence marked verified must have a source URL.
  - Every brand needs at least one sourced piece of evidence.
  - Future dates are rejected.
- **Import screen** (Brand Discovery → Import research):
  1. Upload or paste a file.
  2. **Preview** it. Nothing is written yet.
  3. Review each record's outcome, score and warnings.
  4. Optionally tick any possible duplicates you want imported anyway.
  5. Confirm. The commit must match the previewed file exactly (checked by hash) and runs in a single transaction.
  - The same file can't be imported twice.
  - Failed imports are recorded in run history with their errors.
- **Duplicate prevention:**
  - **Domain:** websites are normalized to the registrable domain, which handles `www`, subdomains and two-part suffixes like `.co.uk`. A database uniqueness rule backs this up.
  - **Within a file:** repeats of the same domain are skipped.
  - **Same name, different domain:** flagged as a possible duplicate and skipped unless included explicitly.
  - **Declined brands** are never rediscovered as new leads.
- **Configuration version check:**
  - The file must name an existing settings version, and its niche must match that version.
  - Research produced under an older version needs explicit confirmation, and is tagged with that older version.
  - Each run keeps an immutable snapshot of its configuration.
- **Quality score.** The app works out its own 0–100 score with a visible breakdown:

  | Part | Points |
  |---|---|
  | Evidence strength | 40 |
  | Recency | 25 |
  | Contactability | 15 |
  | Completeness | 10 |
  | Niche fit | 10 |

  - Paid sponsorship, ambassador and creator-announcement evidence is clearly separated from open affiliate programs, which score low.
  - Brands below the minimum quality score setting are not imported.
- **Brand Approvals queue:**
  - Pending, Approved and Declined views, sorted by score.
  - Each card shows evidence badges, contact verification and review warnings.
  - **Approve** and **Decline** both ask for confirmation and take optional notes.
  - Each brand has an approval request in the universal engine (managers or admins can decide it), tied to the brand data the reviewer saw. If the data changes afterwards, approval is refused.
  - **Approve** moves the brand to `APPROVED_FOR_OUTREACH`. It **only authorizes preparing an outreach draft**; nothing is sent or queued.
  - **Decline** moves the brand to `DECLINED`. It stays searchable.
  - The approver, time and notes are stored, and the audit log records each decision.
- **Brand profile page:**
  - full profile
  - evidence with type, verification, date and source link
  - score breakdown
  - contact details, each labelled verified or unverified
  - review notes
  - decision history
- **Other dashboard changes:**
  - The **Discovered brands** list has search, status and niche filters, sorting and pagination.
  - **Run history** shows the outcome of each record.
  - Global search results now link to brand profiles.

**Tests:** 95 passing, 46 of them new in Phase 2. The new tests cover:

- validation of whole files and of individual records
- configuration version checks, including outdated versions
- all duplicate cases, including declined brands and the database-level uniqueness rule
- the preview/commit hash check and re-import prevention
- failed-run history and minimum-score exclusion
- CSV parsing and grouping, and domain normalization
- the scoring model
- the documentation examples (both must validate)
- brand approve and decline, single decision, concurrent decisions and stale data
- role enforcement, and a check that approval sends or queues nothing

**Browser check:** I ran this flow in a headless browser:

- A researcher uploaded a synthetic file of 8 records: 5 new, 1 repeated in the file, 1 below the minimum score, 1 invalid.
- They previewed and imported it.
- A manager approved one brand and declined another.
- The profile, overview and run history all reflected the decisions.
- There were no console errors, and the mobile layout had no horizontal overflow.

### Next: Phase 3

1. Read Hostinger's official Mail API and MCP documentation to confirm what authenticated send, inbox read, search and thread retrieval support. Then build a separate server-side mail service with a mock provider for development and tests.
2. Build the outreach drafting workflow. Approving a brand creates a drafting job. Drafts are generated from verified brand data only. Admins can edit a draft, ask for it to be regenerated, reject it, or save it without sending. Any edit cancels the earlier approval.
3. Add controlled sending. Before each send, the app re-checks the exact approved content, the suppression list and opt-outs, and that the message hasn't already been sent. Sends are idempotent, every attempt is recorded, and an unclear provider response is flagged for manual reconciliation instead of being retried.

