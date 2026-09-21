# Implementation Plan: Frontend Web Application

## Overview

This plan builds the Web_Client from the existing bare Vite + React 19 + TypeScript scaffold into the full localized, RTL-aware, role-guarded SPA described in the design. It follows the design's dependency rule: cross-cutting infrastructure (contract types, Api_Client, Session_Manager, routing/guards, error presentation, form validation, i18n/direction) is built first, then the feature slices compose that infrastructure, and finally the shell, accessibility gate and end-to-end journeys wire everything together.

Implementation language and stack are fixed by the design: React 19 + TypeScript + Vite with Mantine, TanStack Query, i18next, React Router, `openapi-typescript`/`openapi-fetch`, and a test stack of Vitest + Testing Library + Playwright + `fast-check` + MSW + `@axe-core/playwright`.

Each correctness property from the design is realized as a single `fast-check` property test (minimum 100 iterations, tagged `Feature: frontend-web-application, Property {n}`) placed next to the pure-logic unit it validates. Property test sub-tasks are marked optional (`*`) along with unit, component, integration, e2e and accessibility sub-tasks; core implementation tasks are never optional.

## Tasks

- [x] 1. Establish the project baseline, tooling and build pipeline
  - [x] 1.1 Install and pin dependencies and configure the toolchain
    - Add and pin exact versions in `frontend/package.json` for Mantine, TanStack Query, i18next + react-i18next, React Router, `openapi-fetch`; dev deps `openapi-typescript`, Vitest, Testing Library, jsdom, Playwright, `fast-check`, MSW, `@axe-core/playwright`
    - Configure `vitest.config.ts` (jsdom, single-run capable), `playwright.config.ts`, and read `VITE_API_BASE_URL` with a `/api/v1` default in a small `src/lib/env.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.10, 1.11_
  - [x] 1.2 Wire the npm script contracts
    - Add `typecheck` (`tsc -b --noEmit`), `lint` (`oxlint`), `test` (`vitest run`), `test:e2e` (`playwright test`), `build` (`tsc -b && vite build` → `frontend/dist`), `gen:api`, `verify:api`, `test:a11y`
    - Add an oxlint rule forbidding `console` usage in the `src/api` layer as a secret-hygiene backstop
    - _Requirements: 1.6, 1.7, 1.8, 1.9, 1.12, 3.13, 23.7_
  - [x] 1.3 Add build-pipeline smoke tests for exit-code contracts
    - Assert `typecheck`, `lint`, `build` exit non-zero on an injected error; assert `test` runs in single-execution mode
    - _Requirements: 1.6, 1.7, 1.8, 1.9_

- [x] 2. Generate and verify the typed API contract
  - [x] 2.1 Implement the Contract_Generator scripts
    - `scripts/gen-api.ts`: fetch `/api/openapi.json`, run `openapi-typescript`, emit committed `src/api/generated/schema.d.ts`
    - `scripts/verify-api.ts`: regenerate to a temp file and diff against committed types; exit non-zero on drift; on unreachable document exit non-zero, name the endpoint, and leave committed declarations unchanged
    - Commit the initial generated `schema.d.ts`
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6_
  - [x] 2.2 Derive enum unions from generated declarations
    - `src/api/enums.ts` re-exports Role, AccountStatus, ResidencyProofType, EnrolmentStatus, ProfileState, ContactChannelPref, ContactScopePref, CvVersionState, JdStatus, WorkModel, EmploymentType, ExperienceLevel, ApplicationChannel, ApplicationStatus as `components['schemas'][...]` unions (never hand-typed)
    - _Requirements: 2.3, 2.7_
  - [x] 2.3 Add verify:api smoke tests
    - Assert `verify:api` exits non-zero on drift and reports the unreachable endpoint when the document cannot be retrieved
    - _Requirements: 2.5, 2.6_

- [x] 3. Build the Error_Envelope decoder (pure logic)
  - [x] 3.1 Implement error decoding and Field_Violation mapping
    - `src/api/errors.ts`: decode any 400–599 body into `{error, message, details, request_id}`; synthesize `unexpected_response` for undecodable bodies; take `request_id` from `X-Request-ID` when body lacks it; classify 401 (refresh-eligible) vs 403/other (never); map 422 `validation_error`/`validation_failed` `details` to a complete `Field_Violation[]` of `{path, code}`
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_
  - [x] 3.2 Property test — error decoding always yields a well-formed envelope
    - **Property 1: Error decoding always yields a well-formed envelope**
    - **Validates: Requirements 3.4, 3.5, 3.6**
    - Generators: arbitrary JSON bodies and header maps
  - [x] 3.3 Property test — 401/403 refresh classification
    - **Property 2: 401/403 refresh classification**
    - **Validates: Requirements 3.7, 3.8**
    - Generator: full status-code range
  - [x] 3.4 Property test — validation details map to a complete Field_Violation list
    - **Property 3: Validation details map to a complete Field_Violation list**
    - **Validates: Requirements 3.9**

- [x] 4. Build the Session_Manager (in-memory tokens, refresh, single-flight)
  - [x] 4.1 Implement refresh-time computation and principal decoding (pure logic)
    - `src/lib/refresh.ts`: decode `exp`/`sub`/`roles`/`act`/`session_id`; compute a refresh time no later than `exp − 60s` and no earlier than now
    - _Requirements: 4.2, 4.4_
  - [x] 4.2 Property test — refresh scheduled at least 60 seconds before expiry
    - **Property 4: Refresh is scheduled at least 60 seconds before expiry**
    - **Validates: Requirements 4.4**
    - Generator: future `exp` values
  - [x] 4.3 Implement the single-flight refresh primitive and SessionManager core
    - `src/session/SessionManager.ts`: in-memory `accessToken`/`refreshToken`/principal only (no storage/cookie); `login`, `getAccessToken`, `getPrincipal`, `ensureFresh` (single-flight), `onUnauthorized` (one refresh + one replay), `logout`, `clear(reason)`; proactive refresh timer replaces both tokens and leaves the in-flight queue intact; refresh 4xx discards tokens, clears cache, redirects to login with session-expired notice; page reload treats session as absent
    - _Requirements: 4.3, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11_
  - [x] 4.4 Provide the SessionContext
    - `src/session/SessionContext.tsx` exposing session state to the app without persisting tokens
    - _Requirements: 4.3_
  - [x] 4.5 Property test — refresh is single-flight and replays once
    - **Property 5: Refresh is single-flight and replays once**
    - **Validates: Requirements 4.6, 4.8**
    - Generator: concurrency-count model with a stubbed exchange
  - [x] 4.6 Unit tests — refresh-4xx session-clear and logout-always-clears transitions
    - Cover representative 4xx codes for refresh clear (4.7) and logout clear regardless of status (4.10)
    - _Requirements: 4.7, 4.9, 4.10, 4.11_

- [x] 5. Build the Api_Client (sole HTTP layer)
  - [x] 5.1 Implement the retry-decision predicate (pure logic)
    - `src/lib/retry.ts`: given (is-mutation, is-retryable, attempts-so-far) permit a retry iff read AND retryable AND fewer than two retries; never retry a mutation
    - _Requirements: 21.9, 21.10_
  - [x] 5.2 Property test — retry policy applies only to idempotent reads
    - **Property 19: Retry policy applies only to idempotent reads**
    - **Validates: Requirements 21.9, 21.10**
  - [x] 5.3 Implement the Api_Client over openapi-fetch
    - `src/api/client.ts`: only module issuing HTTP; attach `Bearer` when a token is held and `Accept-Language` from the active Locale on every request; decode errors via `errors.ts`; record `X-Request-ID` as Support_Reference (surfaced on failure only); route 401 to Session_Manager refresh, 403 to denial without refresh; expose 429 `Retry-After` and 503 `upstream_unavailable` `details.service`; 30s timeout → `request_timeout`; retry idempotent reads at most twice with increasing delay via `retry.ts`; never log tokens/passwords/codes/Residency_Proof
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.10, 3.11, 3.12, 3.13, 21.9, 21.10_
  - [x] 5.4 Unit tests — secret hygiene and timeout/retry behaviour
    - Console/network spies over representative sensitive values (never logged, only Backend_Api targeted); timeout synthesizes `request_timeout`; read retry clamp
    - _Requirements: 3.12, 3.13, 23.7_

- [x] 6. Build i18n, Direction_Provider and locale resolution (pure logic + provider)
  - [x] 6.1 Implement locale and direction resolution helpers (pure logic)
    - `src/lib/locale.ts`: resolve unauthenticated locale from an ordered browser-preference list (first supported, else `en`); `src/lib/direction.ts`: `rtl` iff `ar`/`he`, else `ltr`
    - _Requirements: 19.4, 19.6, 19.7_
  - [x] 6.2 Property test — unauthenticated locale resolution
    - **Property 9: Unauthenticated locale resolution**
    - **Validates: Requirements 19.4**
  - [x] 6.3 Property test — direction resolution
    - **Property 10: Direction resolution**
    - **Validates: Requirements 19.6, 19.7**
  - [x] 6.4 Initialize i18next and author baseline catalogues
    - `src/i18n/index.ts` init; `src/i18n/locales/{ar,he,en}/*.json` shared catalogues (shell, errors, validation); set active locale from `language_preference` on login, else resolved browser preference
    - _Requirements: 19.1, 19.2, 19.3, 19.4_
  - [x] 6.5 Implement Direction_Provider and bidi-safe text handling
    - `src/i18n/DirectionProvider.tsx` sets `document.documentElement.dir` and Mantine direction; establish logical-CSS-property conventions and a byte-identical passthrough for backend Arabic/Hebrew content (no transliteration/normalization/reordering); locale/date/number formatting per active Locale with UTC authoritative
    - _Requirements: 19.6, 19.7, 19.8, 19.9, 19.10, 19.11, 19.12_
  - [x] 6.6 Property test — bidirectional text round-trips byte-identically
    - **Property 11: Bidirectional text round-trips byte-identically**
    - **Validates: Requirements 19.10, 19.11**
    - Generator: Unicode strings with astral, combining and bidi-control characters

- [x] 7. Build the Form_Validator (pure logic)
  - [x] 7.1 Implement the validation schema layer mirroring Pydantic bounds
    - `src/forms/validators.ts`: min/max lengths, numeric ranges, collection sizes and enum sets; password ≥10 code points counted in Unicode code points; RFC 5322 addr-spec email; HTTPS LinkedIn URL ≤200; education/work end-not-before-start naming the entry index; 6-digit verification/MFA codes; integer 1–5 ratings
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6, 22.7, 22.8, 22.12_
  - [x] 7.2 Implement the server violation → input placement mapper
    - `src/forms/violations.ts`: partition a `Field_Violation[]` against rendered inputs — matched paths to their input, unmatched to a form-level region — each placed exactly once, none dropped or duplicated; retain entered values; focus first affected input and wire `aria-describedby`
    - _Requirements: 22.9, 22.10, 22.11, 20.6_
  - [x] 7.3 Property test — password length counted in code points
    - **Property 12: Password length is counted in Unicode code points**
    - **Validates: Requirements 22.2, 22.3**
  - [x] 7.4 Property test — email addr-spec acceptance
    - **Property 13: Email validation accepts exactly well-formed addr-specs**
    - **Validates: Requirements 22.4**
    - Generators: addr-spec and non-addr-spec
  - [x] 7.5 Property test — LinkedIn URL validation
    - **Property 14: LinkedIn URL validation**
    - **Validates: Requirements 22.5**
  - [x] 7.6 Property test — date-range ordering with index reporting
    - **Property 15: Date-range ordering with index reporting**
    - **Validates: Requirements 22.6**
    - Generator: start/end/index tuples
  - [x] 7.7 Property test — fixed-format code and rating bounds
    - **Property 16: Fixed-format code and rating bounds**
    - **Validates: Requirements 22.7, 22.8**
  - [x] 7.8 Property test — Field_Violation partition is total and placement-correct
    - **Property 17: Field_Violation partition is total and placement-correct**
    - **Validates: Requirements 22.9, 22.10**
    - Generator: violation lists paired with rendered-input sets

- [x] 8. Build the keyset-cursor derivation helper (pure logic)
  - [x] 8.1 Implement the pagination cursor deriver
    - `src/lib/cursor.ts`: derive the next-page cursor from the endpoint's advertised token (`next_cursor`, last returned id, or `meta.next_after_id`); enable the next-page control iff a further page is reported
    - _Requirements: 12.4, 14.10, 16.3, 17.3, 18.4_
  - [x] 8.2 Property test — keyset cursor derivation
    - **Property 18: Keyset cursor derivation**
    - **Validates: Requirements 12.4, 14.10, 16.3, 17.3, 18.4**
    - Generator: page-response shapes per endpoint

- [x] 9. Checkpoint - infrastructure complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Build the Error_Presenter, recovery boundary and shared state primitives
  - [x] 10.1 Implement Error_Presenter and state primitives
    - `src/errors/ErrorPresenter.tsx`: map every `error` key to a localized catalogue entry, generic fallback + Support_Reference for unknown keys; uniform 403 `not_authorized` surface identical in text, actions and timing regardless of resource id; loading/empty (naming destination + clear-filter when filtered)/error (message + Support_Reference + retry) primitives
    - `src/errors/SupportReference.tsx`: copy-to-clipboard, retained for browsing-context lifetime, never shown on success
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.7, 21.8, 23.1, 23.2, 23.3, 23.4_
  - [x] 10.2 Implement the recovery boundary
    - `src/errors/RecoveryBoundary.tsx`: retain the shell, offer reload, show the most-recent failed Support_Reference on an unhandled rendering error
    - _Requirements: 21.11, 23.1_
  - [x] 10.3 Component tests — uniform denial, empty/error states, live-region announcements
    - Identical 403 surface across resources; empty-state clear-filter; error retry; async completion announced via live region without moving focus
    - _Requirements: 21.3, 21.4, 21.7, 21.8, 20.7_

- [x] 11. Build routing, Route_Guard and Navigation_Menu (pure logic + components)
  - [x] 11.1 Implement the admission predicate and onboarding gate (pure logic)
    - `src/routing/access.ts`: admit iff `roles ∩ requiredRoles ≠ ∅` AND (`requiredContext` absent or `=== act`) AND retained status ∈ `requiredStatuses`; while status ≠ `Approved` admit only Onboarding_Screens else redirect to Status_Notice; compute the Navigation_Menu as the subset of admitted destinations
    - _Requirements: 7.2, 8.3, 8.4, 8.5_
  - [x] 11.2 Property test — onboarding gating admits only Onboarding_Screens
    - **Property 6: Onboarding gating admits only Onboarding_Screens**
    - **Validates: Requirements 7.2**
  - [x] 11.3 Property test — route admission equals role/context/status conjunction
    - **Property 7: Route admission equals the role/context/status conjunction**
    - **Validates: Requirements 8.3, 8.4**
    - Generators: arbitrary principals + route metadata
  - [x] 11.4 Property test — Navigation_Menu is a subset of admitted destinations
    - **Property 8: The Navigation_Menu is a subset of admitted destinations**
    - **Validates: Requirements 8.5**
  - [x] 11.5 Implement RouteGuard, NavigationMenu and the declarative router
    - `src/routing/RouteGuard.tsx` (layout-route wrapper; no token → redirect to login retaining requested location; refusal → uniform denied screen, target request never issued; `GET /me/status` on session establish; `account_not_approved` replaces retained values and redirects); `src/routing/NavigationMenu.tsx` (role/context/status-scoped, per-context destinations); `src/routing/routes.tsx` (`createBrowserRouter`, nested layouts, route access metadata)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_
  - [x] 11.6 Component tests — guard redirects, denied screen, menu scoping, onboarding gate
    - _Requirements: 7.2, 7.4, 8.2, 8.4, 8.5_

- [x] 12. Build the application shell, TanStack Query provider, locale and context-switch controls
  - [x] 12.1 Implement the shell and providers
    - `src/shell/AppShell.tsx` composing DirectionProvider, MantineProvider, QueryClientProvider, SessionContext, router and RecoveryBoundary; wire `App.tsx`/`main.tsx`; entire cache cleared on logout, session expiry and context switch
    - _Requirements: 1.2, 1.3, 4.7, 4.9, 8.11_
  - [x] 12.2 Implement LocaleControl and ContextSwitch
    - `src/shell/LocaleControl.tsx` (change locale without full reload); `src/shell/ContextSwitch.tsx` (dual-role only; `POST /auth/context` replaces both tokens, discards cache, rebuilds menu, lands on new context; hidden for Admin-role accounts)
    - _Requirements: 19.5, 8.10, 8.11, 8.12_
  - [x] 12.3 Implement the diagnostics surface
    - `src/features/diagnostics`: report bundle version; call `GET /health` and render status
    - _Requirements: 23.5, 23.6_

- [x] 13. Checkpoint - shell and navigation runnable
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Build the auth and MFA feature slice
  - [x] 14.1 Implement login and session wiring
    - `src/features/auth`: login screen (email, password, role) → `POST /auth/login`; on 200 store tokens and land on Active_Context; 401/403 rendered without disclosing account existence
    - _Requirements: 4.1, 4.2, 4.12_
  - [x] 14.2 Implement the MFA code step and Admin enrolment
    - `src/features/mfa`: `mfa_required` → 6-digit step, resubmit login with code; invalid-code retains step and clears input; Admin enrolment renders `qr_code_png_b64` + `provisioning_uri` selectable text with image text-alternative; verify posts 6-digit code; account screen shows `mfa_enrolled`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  - [x] 14.3 Component tests — MFA code step and enrolment rendering
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6_

- [x] 15. Build the registration and email-verification slice
  - [x] 15.1 Implement registration link validation and the role-fixed form
    - `src/features/registration`: unauthenticated route validates token via `GET /registration-links/{token}`; success renders role-fixed form (no role selector); failure renders invalid-or-expired; Address proof composes street/number/city/country into `residency_proof_value`; submit to `POST /register/candidate|senior`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.13, 6.14_
  - [x] 15.2 Implement the verification-code screen
    - Post code + retained account id to `POST /verify/code`; on 200 navigate to Status_Notice; `code_entry_locked` disables input and shows only resend; resend `POST /verify/resend` re-enables and clears input
    - _Requirements: 6.9, 6.10, 6.11, 6.12_
  - [x] 15.3 Implement onboarding Status_Notice screen
    - `src/features/onboarding`: render localized `status`/`next_step`; PendingVerification → link to verification; Suspended/Rejected/Deactivated → only status + logout
    - _Requirements: 7.3, 7.4, 7.5_
  - [x] 15.4 Component tests — registration/verification flows including lock and resend
    - _Requirements: 6.3, 6.11, 6.12, 6.13, 6.14_

- [x] 16. Build the Candidate and Senior profile slices
  - [x] 16.1 Implement Candidate profile management
    - `src/features/profiles`: load `GET /me/profile`; editable core fields + repeatable education (0–20), work (0–20), skills (0–20 with `GET /skills` suggestions), languages (0–10); save via `PUT /me/profile`; render completeness panel on Draft, confirmation on Complete; map 422 violations onto indexed inputs retaining values; disable apply controls while Draft; Admin view via `GET /admin/candidates/{account_id}/profile`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 9.13, 9.14_
  - [x] 16.2 Implement Senior profile and contact preferences
    - Load `GET /me/senior-profile`; Contact_Channel_Preference control; conditional Contact_Scope_Preference (hidden/omitted when `None`); require company for `SameCompany`, ≥1 expertise skill for `FieldOfExpertise`; expertise editor (1–10) from `GET /skills`; save via `PUT /me/senior-profile`; email-as-contact for Email/Both; Phase 1 chat placeholder; Admin view via `GET /admin/seniors/{account_id}/profile`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11, 10.12_
  - [x] 16.3 Component tests — completeness panel, violation mapping, contact-preference conditionals
    - _Requirements: 9.9, 9.11, 10.4, 10.5, 10.6, 10.7_

- [x] 17. Build the CV variant and version slice
  - [x] 17.1 Implement CV variant management
    - `src/features/cvs`: list `GET /me/cv-variants`; create (`POST`, name 1–100, description ≤300), disable at 5 active with reason; edit (`PATCH`); archive (`DELETE` with confirm), disabled for last active; set primary (`POST .../primary`) rendering exactly one primary
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_
  - [x] 17.2 Implement version upload, scan polling and download
    - File input (pdf/docx), reject >10MB client-side; multipart upload with byte-percentage progress → 202 renders version + scan-pending; poll versions ≤10s while `PendingScan`; disable download for `PendingScan`/`Quarantined` (keep in list); list versions descending; download `Available` via download endpoint delivering original filename; handle `integrity_violation` and truncated download with Support_Reference; Admin listing/download endpoints; no per-version delete control
    - _Requirements: 11.8, 11.9, 11.10, 11.11, 11.12, 11.13, 11.14, 11.15, 11.16, 11.17, 11.18, 11.19, 11.20_
  - [x] 17.3 Component tests — upload progress, scan-state polling (fake timers), download gating
    - _Requirements: 11.10, 11.12, 11.13, 11.14, 11.16_

- [x] 18. Build the job browsing slice
  - [x] 18.1 Implement job browse and detail
    - `src/features/jobs`: list `GET /jobs` with filters as query params, ≤20/page, keyset next-page via `cursor.ts` (`next_cursor`/`has_next`); empty-state retaining filters; detail `GET /jobs/{jd_id}` with resolved required skills via `GET /skills`; Closed indicator disables apply in list + detail; contactable seniors `GET /jobs/{jd_id}/contactable-seniors` with mail action for Email/Both and empty message; no job on unauthenticated route
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 12.11_

- [x] 19. Build the job authoring slice
  - [x] 19.1 Implement creation, extraction and lifecycle controls
    - Creation form (Senior context or Admin) → `POST /jobs` (Draft); URL/text extraction (`extract:url` ≤500, `extract:text` 1–10000) polling draft ≤5s; on `ready` pre-populate editable fields, warn on missing values, force skill-candidate confirmation, block persistence until confirm via `extract/{draft_id}:confirm`; edit (`PATCH`, changed fields), publish (`:publish`, HTTPS URL ≤500 required for External_Careers_URL), close (`:close` with irreversible confirm); no edit/publish/reopen when Closed; Application_Channel control (`PUT .../application-channel`); Admin all-status listing `GET /admin/jobs`; `illegal_transition` names from/to and refreshes
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 13.13, 13.14, 13.15, 13.16, 13.17, 13.18_
  - [x] 19.2 Component tests — extraction confirmation gating and illegal_transition refresh
    - _Requirements: 13.5, 13.7, 13.10, 13.18_

- [x] 20. Build the application submission and tracking slice
  - [x] 20.1 Implement apply flow and application tracking
    - `src/features/applications`: single apply control for Open jobs regardless of channel; CV_Variant selection defaulting to primary → `POST /jobs/{jd_id}/apply`; 201 confirmation; 200 `redirect_url` opened only on explicit user action stating no Application recorded; handle `precondition_unmet` (list each unmet), `conflicting_state`, `rate_limited` (`details.retry_after_seconds`); own applications list `GET /me/applications` (≤20/page, `after_id`, newest first); detail `GET /me/applications/{id}`; applicant list for Senior/Admin rendering exactly the three Applicant_Card fields; Admin status control `PATCH /admin/applications/{id}/status` invalidating applicant list and detail
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.11, 14.12, 14.13, 14.14_
  - [x] 20.2 Component tests — apply outcomes and applicant-card three-field constraint
    - _Requirements: 14.4, 14.6, 14.7, 14.8, 14.12_

- [x] 21. Build the review submission and timeline slice
  - [x] 21.1 Implement review form, correction and timelines
    - `src/features/reviews`: form (four 1–5 ratings, 1–2000 char assessment, optional JD) → `POST /candidates/{candidate_id}/reviews`; 422 violation mapping retaining values; correction control pre-fills and submits `corrects_review_id`; no edit/delete control; correction indicator linking reviews; Admin full timeline `GET .../reviews` ascending with reviewer/JD/date filters; Senior own-only `GET .../reviews/mine`; no timeline for Candidate; ≤20/page keyset via last `seq`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10, 15.11_
  - [x] 21.2 Component tests — append-only (no edit/delete) and correction pre-fill
    - _Requirements: 15.4, 15.5, 15.6_

- [x] 22. Build the admin account management slice
  - [x] 22.1 Implement account listing, links and lifecycle controls
    - `src/features/admin-accounts`: list `GET /admin/accounts` with status/role filters, ≤20/page via `after_id`; create-link `POST /admin/registration-links` rendering `token` once as copyable text with `expires_at`, never cached after leaving screen; status-driven controls (approve, reject 10–500, record-meeting, suspend/deactivate 1–500, reactivate, reopen); role control `PUT .../roles` blocking Admin+other client-side; invalidate list and render status on 200; confirmation dialogs before reject/suspend/deactivate; pending-skill review `GET /admin/skills/pending`
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 16.10, 16.11, 16.12, 16.13, 16.14, 16.15, 16.16, 16.17_
  - [x] 22.2 Component tests — lifecycle controls, confirmation dialogs, token-shown-once, admin-exclusivity block
    - _Requirements: 16.5, 16.6, 16.14, 16.16_

- [x] 23. Build the audit log browsing slice
  - [x] 23.1 Implement audit list, comparison and chain verify
    - `src/features/audit`: read-only list `GET /admin/audit` rendering timestamp/action/entity/outcome/reason; filters as query params; ≤20/page via `meta.next_after_id`, next disabled when `meta.has_more` false; before/after field comparison; chain verify `GET /admin/audit/chain/verify` rendering `ok`/`first_bad_id`/`checked_from_id`/`max_id` with tampering alert naming `first_bad_id`; no edit/delete; UTC millisecond timestamps beside local equivalents
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9_

- [x] 24. Build the reports and Excel export slice
  - [x] 24.1 Implement reports and export polling
    - `src/features/reports`: activity report `GET /admin/reports/activity` with date-range + JD filters; candidate-progress `GET /admin/reports/candidate-progress` (≤20/page, `next_cursor` as `after_id`) with drill-down controls; export `POST /admin/exports/{entity_type}` → 202 polls `GET /admin/exports/{job_id}` ≤5s to terminal; ready → download control + `expires_at`; failure → `error_message` + Support_Reference; reports usable while polling; hidden entirely for Candidate/Senior contexts
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10, 18.11_
  - [x] 24.2 Component tests — export polling with fake timers and terminal-state handling
    - _Requirements: 18.7, 18.8, 18.9, 18.10_

- [x] 25. Checkpoint - all feature slices complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 26. Apply accessibility conformance across the app
  - [x] 26.1 Implement cross-cutting accessibility behaviours
    - Keyboard operability in visual/direction reading order; visible focus indicators (≥3:1); label association; live-region announcements without moving focus; text alternatives for non-text controls; 320px and 200% text usability; modal focus confinement/restoration; reduced-motion suppression
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9, 20.10, 20.11, 20.12_
  - [x] 26.2 Component tests — focus trap/restore, focus indicators, label association, reduced motion
    - _Requirements: 20.2, 20.3, 20.5, 20.11, 20.12_
  - [x] 26.3 Accessibility gate over every route
    - Wire `@axe-core/playwright` `test:a11y` to run over every rendered route and fail on any Level AA violation
    - _Requirements: 20.1, 20.13_

- [x] 27. Wire end-to-end journeys against a running Backend_Api
  - [x] 27.1 Playwright journeys including tri-locale coverage
    - registration → verification → onboarding gating; login/refresh/logout and context switch; profile completion; CV upload/download; job browse → apply → track; review submission; admin account lifecycle; audit browse; report + Excel export; run registration, profile, CV-upload, job-browsing, application and review journeys in ar/he/en asserting `dir` and mirrored layout
    - _Requirements: 1.12, 19.13_

- [-] 28. Final checkpoint - full pipeline green
  - Ensure all tests pass, ask the user if questions arise.
  - Run 2026-09-22: `typecheck`, `lint`, `test` (112 files / 1259 tests), `build`, `verify:api` and `test:a11y` (40/40 routes) all green. `test:e2e` fails 34/39 against a live Backend_Api, on three backend defects and one MFA-login defect — see `TASK-28-BLOCKERS.md` in this folder for tracebacks, failure attribution and repro steps.

## Notes

- Tasks marked with `*` are optional (unit, component, property, integration, e2e and accessibility sub-tasks) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific granular requirement clauses for traceability.
- Each correctness property is a single `fast-check` test (≥100 iterations, tagged `Feature: frontend-web-application, Property {n}`) placed next to the pure-logic unit it validates.
- Checkpoints ensure incremental validation at infrastructure, shell, feature and pipeline boundaries.
- Property tests cover pure logic (Properties 1–19); component/e2e/accessibility strategies cover rendering, lifecycle-control visibility, network/timer loops and conformance per the design's Testing Strategy.
- Assumptions 1–10 from the design are respected (no password-reset flow, no registration CV upload, omitted openings/recruiter-email fields, skill resolution by term, resource-derived notifications, current-status-only applications, unresolved audit actor, inferred applicant paging, server-side residency re-validation, no reload session survival).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.3"] },
    { "id": 2, "tasks": ["2.2", "3.1", "6.1", "7.1", "8.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "4.1", "6.2", "6.3", "6.4", "7.2", "7.3", "7.4", "7.5", "7.6", "7.7", "7.8", "8.2", "11.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "5.1", "6.5", "11.2", "11.3", "11.4"] },
    { "id": 5, "tasks": ["4.4", "4.5", "4.6", "5.2", "5.3", "6.6", "10.1", "10.2"] },
    { "id": 6, "tasks": ["5.4", "10.3", "11.5"] },
    { "id": 7, "tasks": ["11.6", "12.1"] },
    { "id": 8, "tasks": ["12.2", "12.3"] },
    { "id": 9, "tasks": ["14.1", "15.1", "16.1", "16.2", "17.1", "18.1", "21.1", "22.1", "23.1", "24.1"] },
    { "id": 10, "tasks": ["14.2", "15.2", "15.3", "17.2", "19.1", "20.1"] },
    { "id": 11, "tasks": ["14.3", "15.4", "16.3", "17.3", "19.2", "20.2", "21.2", "22.2", "24.2"] },
    { "id": 12, "tasks": ["26.1"] },
    { "id": 13, "tasks": ["26.2", "26.3"] },
    { "id": 14, "tasks": ["27.1"] }
  ]
}
```
