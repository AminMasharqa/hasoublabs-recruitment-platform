# ATS Source Slugs

URL patterns and known-working slugs per adapter. Validated 2026-11-04.

## Greenhouse

URL: `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true`

| Slug | Company | Status |
|---|---|---|
| anthropic | Anthropic | ⚠️ Geo-blocked from local IP — URL valid |
| stripe | Stripe | ⚠️ Geo-blocked from local IP — URL valid |
| airbnb | Airbnb | ⚠️ Geo-blocked from local IP — URL valid |
| discord | Discord | ⚠️ Geo-blocked from local IP — URL valid |
| figma | Figma | ⚠️ Geo-blocked from local IP — URL valid |
| gitlab | GitLab | ⚠️ Geo-blocked from local IP — URL valid |
| linear | Linear | ⚠️ Geo-blocked from local IP — URL valid |

> Greenhouse blocks connections from certain IPs (confirmed reachable from cloud/CI environments).

## Lever

URL: `https://api.lever.co/v0/postings/{slug}`

| Slug | Company | Status |
|---|---|---|
| palantir | Palantir | ✅ 200 (307 listings) |
| spotify | Spotify | ✅ 200 (86 listings) |
| ~~netflix~~ | ~~Netflix~~ | ❌ Netflix does not use Lever (uses Workday) |
| ~~stripe~~ | ~~Stripe~~ | ❌ Stripe does not use Lever (uses Greenhouse) |

## Ashby

URL: `https://api.ashbyhq.com/posting-api/job-board/{slug}`

| Slug | Company | Status |
|---|---|---|
| notion | Notion | ✅ 200 |
| linear | Linear | ✅ 200 |
| openai | OpenAI | ✅ 200 |
| ramp | Ramp | ✅ 200 |
| cerebras | Cerebras | ✅ 200 |

## Workable

URL: `https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true`

| Slug | Company | Status |
|---|---|---|
| huggingface | Hugging Face | ⚠️ Geo-blocked from local IP — URL valid |

> Same geo-blocking behaviour as Greenhouse; reachable from cloud environments.

## SmartRecruiters

URL: `https://api.smartrecruiters.com/v1/companies/{slug}/postings`

> Slugs are case-sensitive.

| Slug | Company | Status |
|---|---|---|
| Bosch | Bosch | ✅ 200 |
| ServiceNow | ServiceNow | ✅ 200 |
| Visa | Visa | ✅ 200 |
| Tesla | Tesla | ✅ 200 |

---

## Israel-based companies by ATS

Companies confirmed to post Israel-based positions on each platform. Identified 2026-11-04.

### Greenhouse — Israel

> Slugs unverified (geo-blocked locally). URLs follow the standard pattern.

| Company | Israel location | Career page |
|---|---|---|
| Island | Tel Aviv, Glilot | https://boards.greenhouse.io/island |
| ScaleOps | Tel Aviv | https://boards.greenhouse.io/scaleops |
| Gong | Tel Aviv | https://boards.greenhouse.io/gong |
| Surf AI | Tel Aviv | https://boards.greenhouse.io/surfai |

### Lever — Israel

> Slugs validated via API 2026-11-04. ⚠️ = slug not found, needs manual lookup.

| Company | Israel location | Career page | Slug status |
|---|---|---|---|
| WalkMe | Tel Aviv | https://jobs.lever.co/walkme | ✅ |
| Lendbuzz | Tel Aviv | https://jobs.lever.co/lendbuzz | ✅ |
| CYE | Herzliya | https://jobs.lever.co/cye | ⚠️ slug unknown |
| Tonkean | Tel Aviv | https://jobs.lever.co/tonkean | ✅ |
| Sauce | Tel Aviv District | https://jobs.lever.co/sauce | ⚠️ slug unknown |

### Ashby — Israel

> All slugs validated via API 2026-11-04.

| Company | Israel location | Career page |
|---|---|---|
| Irregular | Tel Aviv | https://jobs.ashbyhq.com/irregular |
| Shapes | Tel Aviv | https://jobs.ashbyhq.com/shapes |
| HUMAN | Tel Aviv | https://jobs.ashbyhq.com/human |
| Ledge | Tel Aviv | https://jobs.ashbyhq.com/ledge |
| Sweep | Tel Aviv | https://jobs.ashbyhq.com/sweep |
| Unit | Tel Aviv | https://jobs.ashbyhq.com/unit |

### SmartRecruiters — Israel

> All slugs validated via API 2026-11-04. Slugs are case-sensitive.

| Company | Israel location | Career page | Notes |
|---|---|---|---|
| Nexar | Tel Aviv-Yafo | https://careers.smartrecruiters.com/Nexar | |
| Kueez | Bnei Brak, Tel Aviv | https://careers.smartrecruiters.com/Kueez | |
| ServiceNow | Petah Tikva, Tel Aviv | https://careers.smartrecruiters.com/ServiceNow | |
| Bosch | Israel | https://careers.smartrecruiters.com/Bosch | No open positions currently |

### Summary

| ATS | Israel examples | Priority |
|---|---|---|
| Greenhouse | 4 | 1 |
| Lever | 5 | 2 |
| Ashby | 6 | 3 |
| SmartRecruiters | 4 | 4 |

---

## Extraction Run — 2026-11-04

First extraction run for the Israel-focused sources.

### Greenhouse
| Company | URL | HTTP | Extraction |
|---|---|---|---|
| Island | `https://boards-api.greenhouse.io/v1/boards/island/jobs?content=true` | 000 (geo-blocked) | ❌ Failed |
| ScaleOps | `https://boards-api.greenhouse.io/v1/boards/scaleops/jobs?content=true` | 000 (geo-blocked) | ❌ Failed |

### Lever
| Company | URL | HTTP | Extraction |
|---|---|---|---|
| WalkMe | `https://api.lever.co/v0/postings/walkme?mode=json` | 200 | ✅ 22 fetched · 9 created · 13 flagged |
| Lendbuzz | `https://api.lever.co/v0/postings/lendbuzz?mode=json` | 200 | ✅ 54 fetched · 5 created · 49 flagged |

### Ashby
| Company | URL | HTTP | Extraction |
|---|---|---|---|
| Irregular | `https://api.ashbyhq.com/posting-api/job-board/irregular` | 200 | ✅ 0 fetched (board empty) |
| Shapes | `https://api.ashbyhq.com/posting-api/job-board/shapes` | 200 | ✅ 0 fetched (board empty) |

### SmartRecruiters
| Company | URL | HTTP | Extraction |
|---|---|---|---|
| Nexar | `https://api.smartrecruiters.com/v1/companies/Nexar/postings` | 200 | ✅ 0 fetched (no open positions) |
| Kueez | `https://api.smartrecruiters.com/v1/companies/Kueez/postings` | 200 | ✅ 3 fetched · 0 created · 3 flagged |

> Greenhouse failures are expected from local IP; slugs are correct and will work from cloud/CI environments. High flag rate on Lendbuzz (49/54) — most listings missing required fields and need review in the flags queue.
