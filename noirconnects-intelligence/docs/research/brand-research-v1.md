# Brand research format — `brand-research/v1`

The app imports brand research in this format. You can produce it with Claude (in chat or as a scheduled task), by hand, or with any other tool. Upload or paste the result under **Brand Discovery → Import research**.

The app **checks every file and shows you a preview before saving anything**. Imported brands go into the **Brand Approvals** queue, and no email is ever sent automatically.

Reference material:

- **Examples:** [`brand-research.example.json`](brand-research.example.json) and [`brand-research.example.csv`](brand-research.example.csv). Both use synthetic data.
- **Machine-readable JSON Schema:** available in the dashboard (Brand Discovery → Import → *Format & prompt*) and from `GET /api/research/brand-schema`.

## File envelope

| Field | Required | Notes |
|---|---|---|
| `schemaVersion` | ✓ | Always `"brand-research/v1"`. |
| `configVersion` | ✓ | The **Intelligence Settings version** the research was produced under, shown in Settings and on the Overview page. |
| `niche` | ✓ | Must equal that version's niche (for example `"Gaming"`). A mismatch rejects the file. |
| `generatedAt` | ✓ | ISO 8601 timestamp. |
| `producedBy`, `notes` | | Free text. |
| `brands` | ✓ | Up to 200 brand records. |

If `configVersion` is older than the active version, the preview warns you, and the import needs an explicit confirmation. The brands are then tagged with the older version they were researched under.

## Brand record

| Field | Required | Notes |
|---|---|---|
| `name` | ✓ | |
| `website` | ✓ | Official website. It is normalized to the registrable domain, which is the **duplicate key**. For example, `https://shop.brand.co.uk/en` becomes `brand.co.uk`. |
| `industry`, `subcategory` | | Subcategory examples for gaming: peripherals, PC hardware, monitors, controllers, chairs, publishers, software, streaming gear. |
| `targetMarkets` | | Array of markets. |
| `productsServices`, `influencerActivitySummary`, `recommendationReason` | | |
| `researchedAt` | | ISO timestamp. Defaults to `generatedAt`. |
| `contactName`, `contactRole`, `contactEmail` | | `{ "value": "...", "verified": true\|false }`. **Omit the field if you don't know it. Never guess.** |
| `contactChannelUrl` | | Official partnership or contact page. |
| `evidence` | ✓ | At least one item, and **at least one must have a `sourceUrl`**. |

### Evidence item

| Field | Required | Notes |
|---|---|---|
| `type` | ✓ | One of the evidence types below. |
| `description` | ✓ | What the source shows. |
| `sourceUrl` | ✓ if `verified` | Link to the public source. |
| `date` | | `YYYY-MM-DD` or `YYYY-MM`. Use `null` if unknown. Future dates are rejected. |
| `creatorName`, `platform` | | |
| `verified` | ✓ | `true` only if the source was opened and confirms the claim. |

**Evidence types.** `AFFILIATE_PROGRAM` is kept separate from paid partnership evidence on purpose. An open affiliate program alone is *not* evidence of paid sponsorship, and it scores low.

| Type | Use it for |
|---|---|
| `PAID_SPONSORSHIP` | A disclosed paid creator post or video (#ad, "sponsored by"). |
| `AMBASSADOR_PROGRAM` | A public ambassador or creator program. |
| `CREATOR_ANNOUNCEMENT` | A public partnership announcement. |
| `AFFILIATE_PROGRAM` | An open affiliate or commission program only. |
| `OTHER` | Anything else. |

Unknown fields are rejected. This stops invented data from slipping in under new names, such as campaign budgets.

## What the import does

1. **Validates** the envelope, then validates each record on its own. One bad record doesn't block the others.
2. **Checks the configuration.** The version must exist and the niche must match it.
3. **Detects duplicates:**
   - **DUPLICATE:** the same normalized domain already exists in the database, in any status, **including declined brands**. These are never imported again.
   - **DUPLICATE_IN_FILE:** the domain appears more than once in this file.
   - **POSSIBLE_DUPLICATE:** the same normalized company name as an existing brand, but on a different domain. These are skipped unless the importer ticks them in the preview.
4. **Scores** each brand from 0 to 100 in the app, using its own rules. Any score the researcher supplies is ignored.

   | Part | Points | What earns points |
   |---|---|---|
   | Evidence strength | 40 | Verified sponsorship, ambassador and announcement evidence counts most. |
   | Recency | 25 | How the newest partnership evidence compares with the recency window setting. |
   | Contactability | 15 | Verified email beats an official contact page, which beats an unverified email. |
   | Completeness | 10 | How fully the brand's profile fields are filled in. |
   | Niche fit | 10 | How well the brand matches the configured niche. |

   Brands below the **minimum quality score** setting are not imported.
5. **Commits** in a single transaction:
   - creates a research run pinned to the configuration version, with an immutable snapshot
   - inserts the brands and their evidence
   - opens one approval request per brand
   - writes the audit log

   The commit must match the previewed file exactly (checked by hash), and the same file can't be imported twice. Failed imports are recorded in run history together with their errors.

The daily target (default 15) is shown for information only. **Never pad a file to reach it.**

## Prompt template for Claude

Paste this into Claude after filling in the values from **Settings → Configuration**.

```text
You are researching brands for NoirConnects, an influencer marketing agency.

Configuration version: {configVersion}
Niche: {niche}
Target market: {targetGeography}; language: {targetLanguage}
Find up to {dailyBrandTarget} companies with VERIFIABLE influencer marketing activity,
preferring evidence from the last {sponsorshipRecencyMonths} months.
For Gaming, prioritise: gaming peripherals, PC hardware, monitors, controllers and accessories,
chairs and furniture, game publishers, gaming software/services, gaming lifestyle products,
creator tools and streaming equipment.

Rules:
- Only include a brand if you found at least one public source URL showing creator sponsorship,
  an ambassador program, a creator partnership announcement, or (weaker) an affiliate program.
- Mark evidence "verified": true only if you opened the source and it confirms the claim.
- Distinguish PAID_SPONSORSHIP / AMBASSADOR_PROGRAM / CREATOR_ANNOUNCEMENT from AFFILIATE_PROGRAM.
- NEVER invent contact names, roles, email addresses, sponsorships, dates or budgets. If unknown,
  omit the field. If found but unconfirmed, include it with "verified": false.
- Prefer an official partnership email or contact page.
- Fewer, well-evidenced brands are better than reaching the target. Do not pad the list.
- Output ONLY a JSON object matching schemaVersion "brand-research/v1" (no prose, no markdown),
  with these envelope fields: schemaVersion, configVersion, niche, generatedAt (now, ISO 8601),
  producedBy, brands[].
```

Claude's subscription features currently can't write directly into this app. The supported workflow is to copy Claude's JSON output (or save it as a `.json` file) and import it on the Brand Discovery page. See the main README for the status of scheduled research synchronization.
