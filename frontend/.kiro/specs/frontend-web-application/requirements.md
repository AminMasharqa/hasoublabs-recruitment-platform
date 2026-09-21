# Requirements Document

## Introduction

The HasoubLabs Recruitment Platform currently has a fully implemented FastAPI backend (identity, profiles, cvs, jobs, applications, reviews, audit, reporting — all mounted under `/api/v1`) and **no frontend beyond a bare Vite + React 19 + TypeScript scaffold**. The `frontend/` directory holds `index.html`, `src/main.tsx`, `src/App.tsx`, two CSS files, `vite.config.ts`, the `tsconfig.*.json` set and `.oxlintrc.json`. Dependencies are `react` and `react-dom` only; dev dependencies are Vite 8, `@vitejs/plugin-react`, oxlint, TypeScript ~6.0 and the React type packages. There is no router, no UI library, no state management, no internationalization, no API client and no test runner.

This document specifies the Web_Client: the browser-delivered user interface that lets Admins, Candidates and Seniors carry out every Phase 1 journey the Backend_Api already supports. It covers the application shell and routing, the session lifecycle, the registration and email-verification flow, role-based route guarding, profile and CV management, job posting and application journeys, the review timeline, Admin account management, audit browsing, reports and Excel export, internationalization with right-to-left layout for Arabic and Hebrew, accessibility, uniform error presentation, and the build, lint and test tooling the project does not yet have.

The Web_Client consumes only endpoints the Backend_Api already exposes. Where a journey described in the backend specification has no corresponding endpoint, this document records it under Assumptions and Dependencies rather than inventing a contract.

---

## Scope

### In scope (Phase 1)

User interface coverage for backend Requirements 1, 2, 3, 4, 4A, 5, 6, 7, 8, 9, 28 and 29, plus the cross-cutting Localization, Security, Accessibility and Performance constraints of the backend specification.

### Non-goals (Phase 2, deferred)

The Web_Client does not include: AI_Engine-driven CV improvement, Job_Description scoring or LinkedIn suggestions; Candidate_Note management; Recruiter handoff and Recruiter_Package delivery; in-app Chat_Message exchange; WhatsApp or outbound-email composition surfaces; Candidate_Score display; and advanced Candidate-to-Job_Description matching. Where a Phase 1 backend field points at a Phase 2 capability (for example a Senior whose Contact_Channel_Preference includes `Chat`), the Web_Client renders the Phase 1 placeholder the backend specification prescribes rather than a working Phase 2 surface.

---

## Glossary

Terms carried over from the backend specification keep their exact meaning and spelling. Web_Client-specific terms are marked **(new)**.

### Carried over from the platform specification

- **Platform**: The HasoubLabs Recruitment Platform as a whole, backend and frontend together.
- **Admin**: A HasoubLabs employee with full platform access. The Admin role cannot be combined with the Candidate or Senior role on the same account.
- **Candidate**: An Arab student or graduate who registers to seek employment.
- **Senior**: A senior professional who posts job openings. One person may hold both the Candidate and Senior roles on one account.
- **Account_Status**: The single lifecycle state of an account, one of `PendingVerification`, `PendingApproval`, `ApprovedPendingMeeting`, `Approved`, `Rejected`, `Suspended`, `Deactivated`.
- **Active_Context**: The role a dual-role account is currently acting as, carried in the `act` claim of the Access_Token. For single-role accounts the Active_Context is that account's sole role.
- **Residency_Proof**: A datum submitted at registration supporting Israeli residency: an Israeli mobile phone number, an Israeli national ID number, or an Israeli residential address.
- **Verification_Code**: The single-use 6-digit numeric code emailed to a registrant.
- **Registration_Link**: An Admin-generated, role-specific, token-bearing link that opens either the Candidate or the Senior registration flow.
- **Profile_Completeness**: The `Draft` or `Complete` classification of a Candidate profile, reported by the Backend_Api as the `state` field of the candidate profile payload.
- **Application-Ready**: A Candidate whose profile is `Complete` and who holds at least one CV_Version.
- **CV_Variant**: A named CV slot owned by a Candidate; between 1 and 5 per account; exactly one is `primary`.
- **CV_Version**: An immutable uploaded CV snapshot inside a CV_Variant, with state `PendingScan`, `Available` or `Quarantined`.
- **Job_Description**: A posting with status `Draft`, `Open` or `Closed`.
- **Application_Channel**: The routing configured on a Job_Description, one of `Senior_Dashboard`, `Admin_Dashboard`, `External_Careers_URL`.
- **Application**: A Candidate's expression of interest in a Job_Description, with status `Submitted`, `Under Review`, `Forwarded to Recruiter` or `Closed`.
- **Applicant_Card**: The three-field view of a Candidate shown to a Senior: full name, applied role title, Application status.
- **Review / Review_Timeline**: A structured Candidate evaluation and the append-only sequence of such evaluations.
- **Audit_Log**: The append-only, hash-chained record of significant platform actions.
- **Skill_Taxonomy**: The platform-maintained canonical skill list.
- **Contact_Channel_Preference**: A Senior profile field, one of `Chat`, `Email`, `Both`, `None`.
- **Contact_Scope_Preference**: A Senior profile field, one of `OwnPostingsOnly`, `SameCompany`, `FieldOfExpertise`.

### New to this document

- **Web_Client** **(new)**: The React single-page application delivered from the `frontend/` workspace. The system under specification.
- **Backend_Api** **(new)**: The existing FastAPI service. All operations are served under the `/api/v1` prefix except the unauthenticated `/health` probe.
- **Api_Client** **(new)**: The Web_Client module that owns every HTTP call to the Backend_Api, including token attachment, refresh handling, error-envelope decoding and `Accept-Language` negotiation.
- **Contract_Generator** **(new)**: The build-time tool that emits TypeScript types from the Backend_Api OpenAPI document published at `/api/openapi.json`.
- **Session_Manager** **(new)**: The Web_Client module that holds the Access_Token, the Refresh_Token and the decoded principal, and that performs refresh, context switch and logout.
- **Access_Token** **(new)**: The short-lived JWT returned as `access_token`, carrying claims `sub`, `roles`, `act`, `session_id` and `exp`.
- **Refresh_Token** **(new)**: The long-lived token returned as `refresh_token`, exchanged at `POST /api/v1/auth/refresh`.
- **Route_Guard** **(new)**: The Web_Client component that admits or redirects a navigation attempt based on authentication state, role set, Active_Context and Account_Status.
- **Navigation_Menu** **(new)**: The role-scoped set of navigation destinations presented in the application shell.
- **Error_Envelope** **(new)**: The uniform Backend_Api error body `{error, message, details, request_id}`.
- **Error_Presenter** **(new)**: The Web_Client module that maps an Error_Envelope to a localized, accessible user-facing message.
- **Field_Violation** **(new)**: One entry of the Error_Envelope `details` describing a single invalid field by `path` and `code`.
- **Form_Validator** **(new)**: The Web_Client layer that applies client-side constraints mirroring the Backend_Api Pydantic bounds before a request is issued.
- **Onboarding_Screens** **(new)**: The restricted screen set reachable by an account whose Account_Status is not `Approved`: login, Verification_Code entry, Verification_Code resend, and the status notice.
- **Status_Notice** **(new)**: The screen rendering the `status` and `next_step` values returned by `GET /api/v1/me/status`.
- **Direction_Provider** **(new)**: The layout-direction mechanism that sets `dir="rtl"` or `dir="ltr"` on the document root and propagates the same direction to the component library.
- **Locale** **(new)**: One of the three supported interface languages, `ar`, `he` or `en`. `ar` and `he` are right-to-left.
- **Build_Pipeline** **(new)**: The `npm` scripts and configuration that type-check, lint, test and bundle the Web_Client.
- **Test_Suite** **(new)**: The automated tests of the Web_Client, split into unit, component and end-to-end layers.
- **Support_Reference** **(new)**: The `request_id` value, read from the Error_Envelope body or the `X-Request-ID` response header, surfaced to the user so a failure can be traced by an operator.

---

## Requirements

### Requirement 1: Technology Foundation and Build Pipeline

**User Story:** As a frontend developer, I want a configured project foundation with routing, a component library, server-state management, internationalization and a test runner already wired, so that feature work starts from a working baseline instead of a bare scaffold.

#### Acceptance Criteria

1. THE Web_Client SHALL be built with React 19, TypeScript and Vite, retaining the existing `frontend/` workspace root.
2. THE Web_Client SHALL use Mantine as the component library for all interface primitives.
3. THE Web_Client SHALL use TanStack Query as the single mechanism for reading, caching and invalidating Backend_Api server state.
4. THE Web_Client SHALL use i18next for all user-visible text.
5. THE Web_Client SHALL use a declarative client-side router that supports nested layouts, route parameters and programmatic redirection.
6. THE Build_Pipeline SHALL expose an `npm` script that type-checks the Web_Client and SHALL exit with a non-zero status code when any TypeScript error is present.
7. THE Build_Pipeline SHALL expose an `npm` script that lints the Web_Client with oxlint and SHALL exit with a non-zero status code when any lint error is present.
8. THE Build_Pipeline SHALL expose an `npm` script that runs the Test_Suite in single-execution mode without entering watch mode.
9. THE Build_Pipeline SHALL expose an `npm` script that produces a production bundle into `frontend/dist`.
10. THE Web_Client SHALL read the Backend_Api base URL from a build-time environment variable, and WHERE that variable is absent, THE Web_Client SHALL default the base URL to `/api/v1`.
11. THE Web_Client SHALL declare every runtime dependency with a pinned exact version in `frontend/package.json`.
12. THE Test_Suite SHALL provide unit tests for pure logic, component tests that render components against a mocked Api_Client, and end-to-end tests that exercise complete journeys against a running Backend_Api.

---

### Requirement 2: Typed Contract Generation

**User Story:** As a frontend developer, I want request and response types generated from the Backend_Api OpenAPI document, so that a backend contract change surfaces as a compile error rather than a runtime defect.

#### Acceptance Criteria

1. THE Contract_Generator SHALL emit TypeScript type declarations for every Backend_Api operation, request body and response body from the OpenAPI document published at `/api/openapi.json`.
2. THE Build_Pipeline SHALL expose an `npm` script that regenerates the emitted type declarations.
3. THE Web_Client SHALL type every Api_Client function signature with the generated declarations rather than with hand-written duplicates of Backend_Api payload shapes.
4. THE Web_Client SHALL commit the generated type declarations to version control.
5. WHEN the committed generated declarations differ from the declarations produced by regeneration against the reference OpenAPI document, THE Build_Pipeline SHALL fail the verification script with a non-zero status code.
6. IF the OpenAPI document cannot be retrieved during regeneration, THEN THE Contract_Generator SHALL exit with a non-zero status code, report the endpoint that could not be reached, and leave the committed declarations unchanged.
7. THE Web_Client SHALL derive the enumerated value sets for Account_Status, role, CV_Version state, Job_Description status, Application_Channel, Application status, work model, employment type, experience level, enrolment status, Contact_Channel_Preference and Contact_Scope_Preference from the generated declarations.

---

### Requirement 3: Api_Client and Uniform Error Decoding

**User Story:** As a frontend developer, I want one HTTP layer that attaches credentials, negotiates language, decodes the Error_Envelope and distinguishes authentication failure from authorization denial, so that every screen handles Backend_Api responses identically.

#### Acceptance Criteria

1. THE Api_Client SHALL be the only Web_Client module that issues HTTP requests to the Backend_Api.
2. WHEN the Session_Manager holds an Access_Token, THE Api_Client SHALL send that token in the `Authorization` request header using the `Bearer` scheme.
3. THE Api_Client SHALL send the active Locale in the `Accept-Language` request header of every request.
4. WHEN a response status code is in the range 400 to 599, THE Api_Client SHALL decode the response body as an Error_Envelope exposing the `error`, `message`, `details` and `request_id` members.
5. IF a response body with a status code in the range 400 to 599 cannot be decoded as an Error_Envelope, THEN THE Api_Client SHALL construct an Error_Envelope whose `error` member is `unexpected_response` and whose `request_id` member is the value of the `X-Request-ID` response header when that header is present.
6. THE Api_Client SHALL record the `X-Request-ID` response header value of every response as the Support_Reference for that request.
7. WHEN a response status code is 401, THE Api_Client SHALL classify the outcome as an authentication failure and SHALL invoke the Session_Manager refresh path described in Requirement 4.
8. WHEN a response status code is 403, THE Api_Client SHALL classify the outcome as an authorization denial and SHALL NOT invoke the Session_Manager refresh path.
9. WHEN a response status code is 422 and the `error` member is `validation_error` or `validation_failed`, THE Api_Client SHALL expose the `details` member as a list of Field_Violation entries addressed by `path`.
10. WHEN a response status code is 429, THE Api_Client SHALL expose the `Retry-After` response header value to the caller.
11. THE Api_Client SHALL treat a response status code of 503 with the `error` member `upstream_unavailable` as retryable and SHALL expose the `details.service` member to the Error_Presenter.
12. THE Api_Client SHALL apply a request timeout of 30 seconds to every request, and WHEN that timeout elapses, THE Api_Client SHALL construct an Error_Envelope whose `error` member is `request_timeout`.
13. THE Api_Client SHALL NOT write an Access_Token, a Refresh_Token, a password, a Verification_Code or a Residency_Proof value to the browser console or to any client-side log.

---

### Requirement 4: Authentication and Session Lifecycle

**User Story:** As a registered user, I want to sign in, stay signed in while I am working, and be signed out cleanly when my session ends, so that my access matches the Backend_Api session state at all times.

#### Acceptance Criteria

1. THE Web_Client SHALL provide a login screen collecting an email address, a password and a selected role of `ADMIN`, `CANDIDATE` or `SENIOR`, and SHALL submit those values to `POST /api/v1/auth/login`.
2. WHEN `POST /api/v1/auth/login` returns 200, THE Session_Manager SHALL store the returned Access_Token and Refresh_Token, decode the `sub`, `roles`, `act` and `exp` claims of the Access_Token, and redirect the user to the landing destination for the decoded Active_Context.
3. THE Session_Manager SHALL hold the Access_Token and the Refresh_Token in memory for the lifetime of the browsing context and SHALL NOT place either token in `localStorage`, in `sessionStorage`, or in a cookie readable by script.
4. WHILE an authenticated session is active, THE Session_Manager SHALL exchange the Refresh_Token at `POST /api/v1/auth/refresh` no later than 60 seconds before the `exp` claim of the current Access_Token.
5. WHEN `POST /api/v1/auth/refresh` returns 200, THE Session_Manager SHALL replace both stored tokens with the returned pair and SHALL leave the in-flight request queue intact.
6. WHEN a request receives a 401 response and a Refresh_Token is held, THE Session_Manager SHALL attempt exactly one Refresh_Token exchange and SHALL replay the original request once with the new Access_Token.
7. IF a Refresh_Token exchange returns a status code in the range 400 to 499, THEN THE Session_Manager SHALL discard both stored tokens, clear every cached server-state entry, and redirect the user to the login screen with a session-expired notice.
8. WHILE more than one request is awaiting a Refresh_Token exchange, THE Session_Manager SHALL issue exactly one exchange request and SHALL resolve every waiting request with the result of that single exchange.
9. WHEN the user activates the logout control, THE Web_Client SHALL call `POST /api/v1/auth/logout`, discard both stored tokens, clear every cached server-state entry, and redirect the user to the login screen.
10. IF `POST /api/v1/auth/logout` returns a status code in the range 400 to 599, THEN THE Web_Client SHALL still discard both stored tokens and clear every cached server-state entry before redirecting to the login screen.
11. WHEN a page reload occurs, THE Session_Manager SHALL treat the session as absent and SHALL require the user to sign in again.
12. IF `POST /api/v1/auth/login` returns 401 or 403, THEN THE Error_Presenter SHALL render the localized message of the Error_Envelope without disclosing whether the submitted email address belongs to an existing account.

---

### Requirement 5: Admin Multi-Factor Authentication

**User Story:** As an Admin, I want to enrol in and satisfy multi-factor authentication, so that administrative access carries a second factor as the platform security constraints require.

#### Acceptance Criteria

1. IF `POST /api/v1/auth/login` returns an Error_Envelope whose `error` member indicates that a multi-factor code is required, THEN THE Web_Client SHALL present a code-entry step that collects a 6-digit code and SHALL resubmit `POST /api/v1/auth/login` with the email address, the password, the role and the collected code.
2. THE Web_Client SHALL constrain the multi-factor code input to exactly 6 digits before submission.
3. IF the resubmitted login returns an Error_Envelope whose `error` member indicates an invalid multi-factor code, THEN THE Web_Client SHALL retain the code-entry step, clear the code input, and render the localized error message.
4. WHERE the authenticated account holds the Admin role, THE Web_Client SHALL provide an enrolment screen that calls `POST /api/v1/auth/mfa/enroll` and renders the returned `qr_code_png_b64` image together with the returned `provisioning_uri` as selectable text.
5. THE Web_Client SHALL render the multi-factor enrolment image with a text alternative that directs the user to the `provisioning_uri` value.
6. WHERE the authenticated account holds the Admin role, THE Web_Client SHALL provide a verification control that submits a 6-digit code to `POST /api/v1/auth/mfa/verify` and SHALL render a confirmation when the response reports a verified outcome.
7. THE Web_Client SHALL indicate on the Admin account screen whether the account is enrolled, using the `mfa_enrolled` member of the account payload.

---

### Requirement 6: Registration and Email Verification

**User Story:** As a prospective Candidate or Senior, I want to complete registration from the link an Admin sent me and confirm the code emailed to me, so that my account reaches Admin review.

#### Acceptance Criteria

1. THE Web_Client SHALL provide an unauthenticated route that accepts a Registration_Link token as a route parameter and validates that token by calling `GET /api/v1/registration-links/{token}`.
2. WHEN `GET /api/v1/registration-links/{token}` returns 200, THE Web_Client SHALL render the registration form for the role named in the `role` member of the response and SHALL NOT offer a role selection control.
3. IF `GET /api/v1/registration-links/{token}` returns a status code in the range 400 to 599, THEN THE Web_Client SHALL render an invalid-or-expired-link screen with a localized instruction to request a new Registration_Link, and SHALL NOT render the registration form.
4. THE registration form SHALL collect a full name, an email address, a password, a language preference of `ar`, `he` or `en`, a Residency_Proof type of `MobilePhone`, `NationalId` or `Address`, and the Residency_Proof value.
5. WHERE the selected Residency_Proof type is `Address`, THE Web_Client SHALL collect street, house or building number, city and country as separate inputs and SHALL submit the composed value in the `residency_proof_value` member.
6. WHEN the registration form is submitted for a Candidate Registration_Link, THE Web_Client SHALL call `POST /api/v1/register/candidate` with the collected values and the Registration_Link token.
7. WHEN the registration form is submitted for a Senior Registration_Link, THE Web_Client SHALL call `POST /api/v1/register/senior` with the collected values and the Registration_Link token.
8. WHEN a registration call returns 201, THE Web_Client SHALL retain the returned account identifier and navigate to the Verification_Code entry screen.
9. THE Verification_Code entry screen SHALL collect exactly 6 digits and SHALL submit the retained account identifier together with the collected code to `POST /api/v1/verify/code`.
10. WHEN `POST /api/v1/verify/code` returns 200, THE Web_Client SHALL navigate to the Status_Notice screen.
11. IF `POST /api/v1/verify/code` returns an Error_Envelope whose `error` member is `code_entry_locked`, THEN THE Web_Client SHALL disable the code input and SHALL present only the resend control.
12. THE Verification_Code entry screen SHALL provide a resend control that calls `POST /api/v1/verify/resend` with the retained account identifier, and WHEN that call returns 204, THE Web_Client SHALL re-enable the code input and clear any previously entered code.
13. WHEN a registration call returns an Error_Envelope whose `error` member is `conflicting_state`, THE Error_Presenter SHALL render a localized message identifying the email address conflict and SHALL NOT render any other account detail.
14. WHEN a registration call returns 422, THE Web_Client SHALL attach each Field_Violation to the form input addressed by the Field_Violation `path` and SHALL retain every other value the user entered.

---

### Requirement 7: Account Status Gating and Onboarding Screens

**User Story:** As a user whose account is not yet approved, I want the interface to show me only my current status and next step, so that I am never presented with features my Account_Status forbids.

#### Acceptance Criteria

1. WHEN an authenticated session is established, THE Web_Client SHALL call `GET /api/v1/me/status` and retain the returned `status` and `next_step` members.
2. WHILE the retained `status` member holds a value other than `Approved`, THE Route_Guard SHALL admit navigation only to the Onboarding_Screens and SHALL redirect every other navigation attempt to the Status_Notice screen.
3. THE Status_Notice screen SHALL render the localized description of the retained `status` member and, WHERE the `next_step` member is present, SHALL render the localized next step.
4. WHILE the retained `status` member is `PendingVerification`, THE Status_Notice screen SHALL present a control that navigates to the Verification_Code entry screen.
5. WHILE the retained `status` member is `Suspended`, `Rejected` or `Deactivated`, THE Web_Client SHALL present the Status_Notice screen and the logout control, and SHALL present no other action.
6. IF any request returns an Error_Envelope whose `error` member is `account_not_approved`, THEN THE Web_Client SHALL replace the retained status values with the `details.status` and `details.next_step` members of that Error_Envelope and SHALL redirect the user to the Status_Notice screen.
7. WHEN the retained `status` member becomes `Approved`, THE Web_Client SHALL admit navigation to every destination permitted by Requirement 8 for the current role set and Active_Context.

---

### Requirement 8: Role-Based Route Guarding and Navigation

**User Story:** As a user of the Platform, I want the interface to expose exactly the destinations my role permits, so that I never reach a screen the Backend_Api will refuse.

#### Acceptance Criteria

1. THE Route_Guard SHALL evaluate every navigation attempt against the required role set, the required Active_Context and the required Account_Status declared on the target route.
2. IF no Access_Token is held when a guarded route is requested, THEN THE Route_Guard SHALL redirect the user to the login screen and SHALL retain the requested location for post-login navigation.
3. THE Route_Guard SHALL admit a navigation attempt only when the `roles` claim of the Access_Token intersects the route's required role set, the `act` claim equals the route's required Active_Context where one is declared, and the retained Account_Status satisfies the route's required status set.
4. WHEN the Route_Guard refuses a navigation attempt for an authenticated session, THE Web_Client SHALL render an authorization-denied screen and SHALL NOT issue the request the target route would have made.
5. THE Navigation_Menu SHALL present only destinations the Route_Guard would admit for the current role set, Active_Context and Account_Status.
6. WHERE the Active_Context is `CANDIDATE`, THE Navigation_Menu SHALL present the Candidate profile, CV_Variant management, Job_Description browsing and own-Applications destinations, and SHALL NOT present any Admin or Senior destination.
7. WHERE the Active_Context is `SENIOR`, THE Navigation_Menu SHALL present the Senior profile, own-Job_Description management, Job_Description browsing, applicant-list and own-Review destinations, and SHALL NOT present any Admin or Candidate destination.
8. WHERE the authenticated account holds the Admin role, THE Navigation_Menu SHALL present the account management, Candidate directory, Job_Description, Application, Review, Audit_Log, reports and export destinations.
9. THE Web_Client SHALL NOT render any Candidate field other than full name, applied role title and Application status on any screen reachable while the Active_Context is `SENIOR`.
10. WHERE the authenticated account holds both the Candidate role and the Senior role, THE Web_Client SHALL present a context-switch control that calls `POST /api/v1/auth/context` with the target context.
11. WHEN `POST /api/v1/auth/context` returns 200, THE Session_Manager SHALL replace both stored tokens with the returned pair, discard every cached server-state entry, rebuild the Navigation_Menu from the new `act` claim, and navigate to the landing destination of the new Active_Context.
12. THE Web_Client SHALL NOT present a context-switch control for an account whose role set contains the Admin role.

---

### Requirement 9: Candidate Profile Management

**User Story:** As a Candidate, I want to build and maintain my structured profile and see exactly what is missing, so that I can reach Complete state and become Application-Ready.

#### Acceptance Criteria

1. WHILE the Active_Context is `CANDIDATE`, THE Web_Client SHALL load the authenticated Candidate's profile from `GET /api/v1/me/profile`.
2. THE Web_Client SHALL present editable inputs for full name, email address, phone number, city, summary and LinkedIn URL.
3. THE Web_Client SHALL present a repeatable editor for 0 to 20 education entries collecting institution, degree, field of study, an enrolment status of `Enrolled` or `Graduated`, a start year and an optional end year.
4. THE Web_Client SHALL present a repeatable editor for 0 to 20 work-experience entries collecting company, title, start date, an optional end date and an optional description.
5. THE Web_Client SHALL present a repeatable editor for 0 to 20 skills, each collecting a skill term and an optional years-of-experience value between 0 and 50.
6. THE Web_Client SHALL present a repeatable editor for 0 to 10 languages, each collecting a language code and a proficiency of `Native`, `Fluent`, `Professional`, `Conversational` or `Basic`.
7. WHEN a Candidate enters text into a skill term input, THE Web_Client SHALL query `GET /api/v1/skills` with that text and present the returned Skill_Taxonomy entries as selectable suggestions while still accepting a free-text term.
8. WHEN the Candidate saves the profile, THE Web_Client SHALL call `PUT /api/v1/me/profile` with every edited field and every sub-collection present in the form.
9. WHEN `PUT /api/v1/me/profile` returns 200 and the `state` member is `Draft`, THE Web_Client SHALL render a completeness panel naming each field required for `Complete` state that the returned profile does not satisfy.
10. WHEN `PUT /api/v1/me/profile` returns 200 and the `state` member is `Complete`, THE Web_Client SHALL render a confirmation that the profile is `Complete`.
11. WHEN `PUT /api/v1/me/profile` returns 422, THE Web_Client SHALL attach every Field_Violation to the input addressed by the Field_Violation `path`, including indexed paths into education, work-experience, skill and language collections, and SHALL retain every value the user entered.
12. IF a save attempt returns an Error_Envelope reporting a Residency_Proof validation failure, THEN THE Web_Client SHALL render the field-level message against the affected input and SHALL continue to display the previously persisted value as the current server state.
13. WHILE the Active_Context is `CANDIDATE` and the profile `state` member is `Draft`, THE Web_Client SHALL disable every apply control and SHALL present the unmet conditions as the reason.
14. WHERE the authenticated account holds the Admin role, THE Web_Client SHALL render any Candidate's full profile from `GET /api/v1/admin/candidates/{account_id}/profile`.

---

### Requirement 10: Senior Profile and Contact Preferences

**User Story:** As a Senior, I want to maintain my profile and control whether and how I can be contacted about jobs, so that I receive only the inquiries I am willing to handle.

#### Acceptance Criteria

1. WHILE the Active_Context is `SENIOR`, THE Web_Client SHALL load the authenticated Senior's profile from `GET /api/v1/me/senior-profile`.
2. THE Web_Client SHALL present editable inputs for full name, company affiliation and job title.
3. THE Web_Client SHALL present a Contact_Channel_Preference control offering exactly `Chat`, `Email`, `Both` and `None`.
4. WHERE the selected Contact_Channel_Preference is a value other than `None`, THE Web_Client SHALL present a required Contact_Scope_Preference control offering exactly `OwnPostingsOnly`, `SameCompany` and `FieldOfExpertise`.
5. WHERE the selected Contact_Channel_Preference is `None`, THE Web_Client SHALL hide the Contact_Scope_Preference control and SHALL omit the Contact_Scope_Preference member from the save request.
6. WHERE the selected Contact_Scope_Preference is `SameCompany`, THE Form_Validator SHALL require a non-empty company affiliation before the save request is issued.
7. WHERE the selected Contact_Scope_Preference is `FieldOfExpertise`, THE Form_Validator SHALL require at least one expertise skill before the save request is issued.
8. THE Web_Client SHALL present a repeatable editor for 1 to 10 expertise skills sourced from `GET /api/v1/skills`.
9. WHEN the Senior saves the profile, THE Web_Client SHALL call `PUT /api/v1/me/senior-profile` with every edited field.
10. WHERE the selected Contact_Channel_Preference is `Email` or `Both`, THE Web_Client SHALL display the registered account email address as the contact address and SHALL NOT present an input for an alternate contact email address.
11. WHERE the selected Contact_Channel_Preference is `Chat` or `Both`, THE Web_Client SHALL render the localized text for "chat contact not yet available" wherever a Chat contact action would otherwise appear.
12. WHERE the authenticated account holds the Admin role, THE Web_Client SHALL render any Senior's profile from `GET /api/v1/admin/seniors/{account_id}/profile`.

---

### Requirement 11: CV Variant and Version Management

**User Story:** As a Candidate, I want to maintain up to five named CV variants, upload new versions to each, and see the scan state of every upload, so that each application goes out with the most relevant CV and nothing I uploaded is ever lost.

#### Acceptance Criteria

1. WHILE the Active_Context is `CANDIDATE`, THE Web_Client SHALL list the authenticated Candidate's CV_Variants from `GET /api/v1/me/cv-variants`, showing the name, description, primary designation, archived designation and version count of each CV_Variant.
2. THE Web_Client SHALL present a create control that calls `POST /api/v1/me/cv-variants` with a name of 1 to 100 characters and an optional description of at most 300 characters.
3. WHILE five active CV_Variants exist, THE Web_Client SHALL disable the create control and SHALL present the 5-variant limit as the reason.
4. THE Web_Client SHALL present an edit control per CV_Variant that calls `PATCH /api/v1/me/cv-variants/{variant_id}` with the changed name or description.
5. THE Web_Client SHALL present an archive control per CV_Variant that calls `DELETE /api/v1/me/cv-variants/{variant_id}` after the Candidate confirms the action in a dialog.
6. WHILE exactly one active CV_Variant exists, THE Web_Client SHALL disable the archive control for that CV_Variant.
7. THE Web_Client SHALL present a primary control per CV_Variant that calls `POST /api/v1/me/cv-variants/{variant_id}/primary`, and WHEN that call returns 200, THE Web_Client SHALL render exactly one CV_Variant as primary.
8. THE Web_Client SHALL present a file input per CV_Variant that accepts the `application/pdf` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document` media types.
9. WHEN a selected file exceeds 10 MB, THE Form_Validator SHALL reject the selection with a localized size message and SHALL NOT issue the upload request.
10. WHEN the Candidate confirms an upload, THE Web_Client SHALL submit the file to `POST /api/v1/me/cv-variants/{variant_id}/versions` as multipart form data and SHALL render a progress indicator reporting the transferred byte percentage.
11. WHEN `POST /api/v1/me/cv-variants/{variant_id}/versions` returns 202, THE Web_Client SHALL render the returned CV_Version with its `state` member and SHALL present the localized scan-pending notice.
12. WHILE a listed CV_Version holds the `state` member `PendingScan`, THE Web_Client SHALL re-query `GET /api/v1/me/cv-variants/{variant_id}/versions` at an interval of at most 10 seconds until that CV_Version reports a different `state` member or the Candidate leaves the screen.
13. WHILE a listed CV_Version holds the `state` member `PendingScan`, THE Web_Client SHALL disable the download control for that CV_Version.
14. WHERE a listed CV_Version holds the `state` member `Quarantined`, THE Web_Client SHALL render a quarantine indicator, SHALL disable the download control for that CV_Version, and SHALL NOT remove that CV_Version from the version list.
15. THE Web_Client SHALL list every CV_Version of a CV_Variant with its version number, state, original filename, size in bytes and creation timestamp, ordered by descending version number.
16. WHERE a listed CV_Version holds the `state` member `Available`, THE Web_Client SHALL present a download control that requests `GET /api/v1/me/cv-variants/{variant_id}/versions/{version_number}/download` and SHALL deliver the response to the browser as a file download using the original filename.
17. IF a download request returns an Error_Envelope whose `error` member is `integrity_violation`, THEN THE Error_Presenter SHALL render a localized integrity-failure message stating that an Admin has been alerted.
18. IF a download response terminates before the declared content length is received, THEN THE Web_Client SHALL discard the partial file and render a localized incomplete-download message carrying the Support_Reference.
19. WHERE the authenticated account holds the Admin role, THE Web_Client SHALL list any Candidate's CV_Variants from `GET /api/v1/admin/candidates/{candidate_id}/cv-variants` and SHALL present a download control per CV_Version that requests `GET /api/v1/admin/candidates/{candidate_id}/cv-variants/{variant_id}/versions/{version_number}/download`.
20. THE Web_Client SHALL NOT present any control that deletes an individual CV_Version.

---

### Requirement 12: Job Description Browsing

**User Story:** As an authenticated user, I want to search and filter open job postings and read their detail, so that I can find roles relevant to me.

#### Acceptance Criteria

1. THE Web_Client SHALL list Job_Descriptions from `GET /api/v1/jobs`, rendering the role title, company, location, work model, employment type, experience level and publication timestamp of each entry.
2. THE Web_Client SHALL present filter controls for a free-text search term, Skill_Taxonomy skills, location, work model, employment type and experience level, and SHALL send every applied filter as a query parameter of `GET /api/v1/jobs`.
3. THE Web_Client SHALL request at most 20 Job_Descriptions per page.
4. WHEN the `has_next` member of the browse response is true, THE Web_Client SHALL present a next-page control that sends the `next_cursor` value as the keyset cursor of the following request.
5. WHEN the browse response contains zero items, THE Web_Client SHALL render a localized empty-state message and SHALL retain the applied filter values.
6. THE Web_Client SHALL load a Job_Description detail from `GET /api/v1/jobs/{jd_id}` and render every returned field including the description text and the resolved required skills.
7. WHERE a loaded Job_Description holds the `status` member `Closed`, THE Web_Client SHALL render a closed indicator in both the list entry and the detail view and SHALL disable the apply control.
8. THE Web_Client SHALL load the contactable Seniors for a Job_Description from `GET /api/v1/jobs/{jd_id}/contactable-seniors` and render the full name and active contact channels of each returned Senior.
9. WHERE a returned contactable Senior reports `Email` or `Both` as the contact channel, THE Web_Client SHALL render that Senior's account email address as a mail action.
10. WHEN the contactable-Seniors response contains zero entries, THE Web_Client SHALL render a localized message stating that no Seniors are currently available to contact for that role.
11. THE Web_Client SHALL NOT render any Job_Description on an unauthenticated route.

---

### Requirement 13: Job Description Authoring

**User Story:** As a Senior or an Admin, I want to create, pre-fill, edit, publish and close job postings, so that Candidates can discover the roles I am hiring for.

#### Acceptance Criteria

1. WHERE the Active_Context is `SENIOR` or the authenticated account holds the Admin role, THE Web_Client SHALL present a Job_Description creation form collecting role title, company, location, work model, employment type, experience level, description, required skill terms, Application_Channel and external URL.
2. WHEN the creation form is submitted, THE Web_Client SHALL call `POST /api/v1/jobs` and SHALL render the returned Job_Description with the `status` member `Draft`.
3. THE Web_Client SHALL present a URL-extraction control that calls `POST /api/v1/jobs/extract:url` with a URL of at most 500 characters.
4. THE Web_Client SHALL present a text-extraction control that calls `POST /api/v1/jobs/extract:text` with raw text of 1 to 10000 characters.
5. WHEN an extraction call returns 202, THE Web_Client SHALL poll `GET /api/v1/jobs/extract/{draft_id}` at an interval of at most 5 seconds until the returned `status` member reports a value other than `pending` or the user leaves the screen.
6. WHEN a polled extraction draft reports a `status` member of `ready`, THE Web_Client SHALL pre-populate the creation form from the `extracted_fields` member and SHALL leave every pre-populated input editable.
7. WHERE a polled extraction draft reports a `skill_candidates` member, THE Web_Client SHALL present each candidate skill for explicit confirmation or replacement and SHALL block submission until every candidate skill is confirmed or replaced.
8. WHERE a pre-populated input holds no extracted value, THE Web_Client SHALL render a localized warning against that input prompting manual entry.
9. WHEN the user confirms a pre-populated form, THE Web_Client SHALL call `POST /api/v1/jobs/extract/{draft_id}:confirm` with the confirmed field values.
10. THE Web_Client SHALL NOT issue any Job_Description persistence request for an extraction draft before the user confirms the pre-populated form.
11. THE Web_Client SHALL present an edit control for a Job_Description whose `status` member is `Draft` or `Open` that calls `PATCH /api/v1/jobs/{jd_id}` with the changed fields only.
12. THE Web_Client SHALL present a publish control for a Job_Description whose `status` member is `Draft` that calls `POST /api/v1/jobs/{jd_id}:publish`.
13. WHERE the selected Application_Channel is `External_Careers_URL`, THE Form_Validator SHALL require a well-formed HTTPS URL of at most 500 characters before the publish request is issued.
14. THE Web_Client SHALL present a close control for a Job_Description whose `status` member is `Open` that calls `POST /api/v1/jobs/{jd_id}:close` after the user confirms the action in a dialog that states that closing is irreversible.
15. WHERE a Job_Description holds the `status` member `Closed`, THE Web_Client SHALL present no edit, publish or reopen control for that Job_Description.
16. THE Web_Client SHALL present an Application_Channel control for a Job_Description whose `status` member is `Draft` or `Open` that calls `PUT /api/v1/jobs/{jd_id}/application-channel`.
17. WHERE the authenticated account holds the Admin role, THE Web_Client SHALL list Job_Descriptions of every status from `GET /api/v1/admin/jobs` with a status filter control.
18. IF a Job_Description mutation returns an Error_Envelope whose `error` member is `illegal_transition`, THEN THE Error_Presenter SHALL render a localized message naming the `details.from` and `details.to` members and SHALL refresh the displayed Job_Description from the Backend_Api.

---

### Requirement 14: Application Submission and Tracking

**User Story:** As a Candidate, I want to apply to an open posting with the CV variant I choose and follow the status of every application I submitted, so that I can manage my job search without staff involvement.

#### Acceptance Criteria

1. WHILE the Active_Context is `CANDIDATE` and the loaded Job_Description holds the `status` member `Open`, THE Web_Client SHALL present a single apply control regardless of the Job_Description Application_Channel.
2. WHEN the Candidate activates the apply control, THE Web_Client SHALL present a CV_Variant selection defaulting to the primary CV_Variant and SHALL call `POST /api/v1/jobs/{jd_id}/apply` with the selected CV_Variant identifier.
3. WHEN `POST /api/v1/jobs/{jd_id}/apply` returns 201, THE Web_Client SHALL render a submission confirmation carrying the returned Application status and submission timestamp.
4. WHEN `POST /api/v1/jobs/{jd_id}/apply` returns 200 with a `redirect_url` member, THE Web_Client SHALL present an explicit control that opens the `redirect_url` value in a new browsing context and SHALL state that no in-platform Application was recorded.
5. THE Web_Client SHALL NOT navigate to an external `redirect_url` value without an explicit user action.
6. IF `POST /api/v1/jobs/{jd_id}/apply` returns an Error_Envelope whose `error` member is `precondition_unmet`, THEN THE Error_Presenter SHALL render every entry of the `details.unmet` member as a separate localized unmet condition.
7. IF `POST /api/v1/jobs/{jd_id}/apply` returns an Error_Envelope whose `error` member is `conflicting_state`, THEN THE Error_Presenter SHALL render a localized message stating that an application for that Job_Description has already been submitted.
8. IF `POST /api/v1/jobs/{jd_id}/apply` returns an Error_Envelope whose `error` member is `rate_limited`, THEN THE Error_Presenter SHALL render a localized message naming the `details.retry_after_seconds` member.
9. WHILE the Active_Context is `CANDIDATE`, THE Web_Client SHALL list the Candidate's own Applications from `GET /api/v1/me/applications`, rendering the role title, company, status and submission date of each entry, ordered newest first.
10. THE Web_Client SHALL request at most 20 Applications per page and SHALL present a next-page control that sends the last returned Application identifier as the `after_id` query parameter.
11. THE Web_Client SHALL load a single Application from `GET /api/v1/me/applications/{application_id}` and render every returned field.
12. WHERE the Active_Context is `SENIOR` or the authenticated account holds the Admin role, THE Web_Client SHALL list applicants for a Job_Description from `GET /api/v1/jobs/{jd_id}/applicants` and SHALL render exactly the full name, applied role title and Application status of each Applicant_Card.
13. WHERE the authenticated account holds the Admin role, THE Web_Client SHALL present a status control on each Application that calls `PATCH /api/v1/admin/applications/{application_id}/status` with a target status of `Submitted`, `Under Review`, `Forwarded to Recruiter` or `Closed` and an optional reason.
14. WHEN a status change returns 200, THE Web_Client SHALL invalidate the cached applicant list and the cached Application detail for the affected Job_Description.

---

### Requirement 15: Review Submission and Timeline

**User Story:** As an Admin or a Senior, I want to submit structured candidate reviews and read the timeline I am permitted to see, so that a timestamped history of impressions is preserved.

#### Acceptance Criteria

1. WHERE the authenticated account holds the Admin role or the Senior role, THE Web_Client SHALL present a review form collecting four integer ratings between 1 and 5 for technical ability, communication, culture fit and overall impression, a free-text assessment of 1 to 2000 characters, and an optional Job_Description association.
2. WHEN the review form is submitted, THE Web_Client SHALL call `POST /api/v1/candidates/{candidate_id}/reviews` with the collected values.
3. WHEN a review submission returns 422, THE Web_Client SHALL attach every Field_Violation to the input addressed by the Field_Violation `path` and SHALL retain every value the user entered.
4. THE Web_Client SHALL present a correction control on a submitted Review that opens the review form pre-filled with the prior values and submits the new Review with the prior Review identifier in the `corrects_review_id` member.
5. THE Web_Client SHALL NOT present any control that edits or deletes a submitted Review.
6. WHERE a Review carries a `corrects_review_id` member, THE Web_Client SHALL render a correction indicator linking that Review to the corrected Review.
7. WHERE the authenticated account holds the Admin role, THE Web_Client SHALL list a Candidate's full Review_Timeline from `GET /api/v1/candidates/{candidate_id}/reviews` in ascending creation order.
8. WHERE the authenticated account holds the Admin role, THE Web_Client SHALL present timeline filter controls for reviewer, Job_Description, a lower creation bound and an upper creation bound, and SHALL send each applied filter as a query parameter.
9. WHILE the Active_Context is `SENIOR`, THE Web_Client SHALL list only the authenticated Senior's own Reviews for a Candidate from `GET /api/v1/candidates/{candidate_id}/reviews/mine`.
10. THE Web_Client SHALL NOT present any Review_Timeline destination while the Active_Context is `CANDIDATE`.
11. THE Web_Client SHALL request at most 20 Reviews per page and SHALL present a next-page control that sends the last returned `seq` value as the keyset cursor.

---

### Requirement 16: Admin Account Management

**User Story:** As an Admin, I want to issue registration links and move accounts through their lifecycle, so that every user is vetted before gaining full access.

#### Acceptance Criteria

1. WHERE the authenticated account holds the Admin role, THE Web_Client SHALL list accounts from `GET /api/v1/admin/accounts`, rendering the email address, role set, Account_Status, language preference, creation timestamp and enrolment indicator of each account.
2. THE Web_Client SHALL present filter controls for Account_Status and role, and SHALL send each applied filter as a query parameter of `GET /api/v1/admin/accounts`.
3. THE Web_Client SHALL request at most 20 accounts per page and SHALL present a next-page control that sends the last returned account identifier as the `after_id` query parameter.
4. THE Web_Client SHALL present a create-link control that calls `POST /api/v1/admin/registration-links` with a role of `CANDIDATE` or `SENIOR`.
5. WHEN `POST /api/v1/admin/registration-links` returns 201, THE Web_Client SHALL render the returned `token` member once as copyable text together with the `expires_at` value, and SHALL state that the token value is not retrievable afterwards.
6. THE Web_Client SHALL NOT retain a Registration_Link token value in any cached server-state entry after the creating screen is left.
7. WHERE a listed account holds the Account_Status `PendingApproval`, THE Web_Client SHALL present an approve control that calls `POST /api/v1/admin/accounts/{account_id}:approve` with a fast-track indicator.
8. WHERE a listed account holds the Account_Status `PendingVerification`, `PendingApproval` or `ApprovedPendingMeeting`, THE Web_Client SHALL present a reject control that calls `POST /api/v1/admin/accounts/{account_id}:reject` with a reason of 10 to 500 characters.
9. WHERE a listed account holds the Account_Status `ApprovedPendingMeeting`, THE Web_Client SHALL present a meeting-recorded control that calls `POST /api/v1/admin/accounts/{account_id}:record-meeting`.
10. WHERE a listed account holds the Account_Status `Approved`, THE Web_Client SHALL present a suspend control that calls `POST /api/v1/admin/accounts/{account_id}:suspend` with a reason of 1 to 500 characters and a deactivate control that calls `POST /api/v1/admin/accounts/{account_id}:deactivate` with a reason of 1 to 500 characters.
11. WHERE a listed account holds the Account_Status `Suspended`, THE Web_Client SHALL present a reactivate control that calls `POST /api/v1/admin/accounts/{account_id}:reactivate` and a deactivate control that calls `POST /api/v1/admin/accounts/{account_id}:deactivate`.
12. WHERE a listed account holds the Account_Status `Rejected`, THE Web_Client SHALL present a reopen control that calls `POST /api/v1/admin/accounts/{account_id}:reopen`.
13. THE Web_Client SHALL present a role control that calls `PUT /api/v1/admin/accounts/{account_id}/roles` with the complete target role set.
14. WHILE the target role set of the role control contains `ADMIN` together with any other role, THE Form_Validator SHALL block submission and SHALL render a localized message that the Admin role cannot be combined with another role.
15. WHEN an account lifecycle call returns 200, THE Web_Client SHALL invalidate the cached account list and render the returned Account_Status.
16. THE Web_Client SHALL require a confirmation dialog before issuing a reject, suspend or deactivate request.
17. WHERE the authenticated account holds the Admin role, THE Web_Client SHALL present a pending-skill review destination listing entries from `GET /api/v1/admin/skills/pending`.

---

### Requirement 17: Audit Log Browsing

**User Story:** As an Admin, I want to search the audit trail and verify its integrity, so that I can review decisions and demonstrate accountability.

#### Acceptance Criteria

1. WHERE the authenticated account holds the Admin role, THE Web_Client SHALL list Audit_Log entries from `GET /api/v1/admin/audit`, rendering the occurrence timestamp, action, entity type, entity identifier, outcome and reason of each entry.
2. THE Web_Client SHALL present filter controls for actor account, action, entity type, entity identifier, a lower time bound and an upper time bound, and SHALL send each applied filter as a query parameter.
3. THE Web_Client SHALL request at most 20 Audit_Log entries per page and SHALL present a next-page control that sends the `meta.next_after_id` value as the `after_id` query parameter.
4. WHILE the `meta.has_more` member of the response is false, THE Web_Client SHALL disable the next-page control.
5. THE Web_Client SHALL render the `before` and `after` members of a selected Audit_Log entry as a field-level comparison.
6. THE Web_Client SHALL present a verify control that calls `GET /api/v1/admin/audit/chain/verify` and renders the returned `ok`, `first_bad_id`, `checked_from_id` and `max_id` members.
7. WHEN a chain verification response reports an `ok` member of false, THE Web_Client SHALL render a tampering alert naming the `first_bad_id` value.
8. THE Web_Client SHALL NOT present any control that edits or deletes an Audit_Log entry.
9. THE Web_Client SHALL render every Audit_Log timestamp in UTC with millisecond precision alongside the viewer's local-time equivalent.

---

### Requirement 18: Reports and Excel Export

**User Story:** As an Admin, I want to read activity and progress reports and download them as Excel files, so that I have pipeline visibility and can analyse data offline.

#### Acceptance Criteria

1. WHERE the authenticated account holds the Admin role, THE Web_Client SHALL load the activity report from `GET /api/v1/admin/reports/activity` and render every returned metric.
2. THE Web_Client SHALL present a date-range control and a Job_Description control for the activity report and SHALL send each applied value as a query parameter.
3. WHERE the authenticated account holds the Admin role, THE Web_Client SHALL load candidate progress from `GET /api/v1/admin/reports/candidate-progress` and render each row with the account email address, Account_Status, creation timestamp and every associated Application status.
4. THE Web_Client SHALL request at most 20 candidate-progress rows per page and SHALL present a next-page control that sends the `next_cursor` value as the `after_id` query parameter.
5. THE Web_Client SHALL present a drill-down control on each report row that navigates to the underlying account, Job_Description or Application destination.
6. THE Web_Client SHALL present an export control that calls `POST /api/v1/admin/exports/{entity_type}` for an `entity_type` of `candidates`, `job_descriptions` or `applications` with the currently applied date-range and Job_Description filters.
7. WHEN an export call returns 202, THE Web_Client SHALL retain the returned `job_id` member and poll `GET /api/v1/admin/exports/{job_id}` at an interval of at most 5 seconds until the returned `status` member reports a terminal value or the user dismisses the export.
8. WHEN a polled export reports a `status` member indicating readiness and a populated `download_url` member, THE Web_Client SHALL present a download control that opens the `download_url` value and SHALL render the `expires_at` value.
9. WHEN a polled export reports a `status` member indicating failure, THE Error_Presenter SHALL render the `error_message` member together with the Support_Reference.
10. WHILE an export is polling, THE Web_Client SHALL render a progress indicator and SHALL keep the reports destination usable.
11. THE Web_Client SHALL NOT present any report or export destination while the Active_Context is `CANDIDATE` or `SENIOR`.

---

### Requirement 19: Internationalization and Right-to-Left Layout

**User Story:** As a user who reads Arabic, Hebrew or English, I want the entire interface in my language with a layout that matches its reading direction, so that the Platform is usable in my language as a first-class experience.

#### Acceptance Criteria

1. THE Web_Client SHALL provide complete message catalogues for the `ar`, `he` and `en` Locales.
2. THE Web_Client SHALL render every user-visible string from a message catalogue entry and SHALL NOT embed a user-visible string literal in a component.
3. WHEN an authenticated session is established, THE Web_Client SHALL set the active Locale from the `language_preference` member of the account payload.
4. WHERE no authenticated session exists, THE Web_Client SHALL set the active Locale from the browser language preference when that preference names a supported Locale, and SHALL otherwise set the active Locale to `en`.
5. THE Web_Client SHALL present a Locale control that changes the active Locale without a full page reload.
6. WHEN the active Locale is `ar` or `he`, THE Direction_Provider SHALL set the `dir` attribute of the document root element to `rtl` and SHALL set the component library direction to `rtl`.
7. WHEN the active Locale is `en`, THE Direction_Provider SHALL set the `dir` attribute of the document root element to `ltr` and SHALL set the component library direction to `ltr`.
8. WHILE the active direction is `rtl`, THE Web_Client SHALL mirror horizontal layout: inline content order, navigation placement, table column order, directional icons, progress direction and drawer and menu anchoring.
9. THE Web_Client SHALL express every directional style with logical CSS properties rather than with physical left and right properties.
10. THE Web_Client SHALL render Arabic and Hebrew content retrieved from the Backend_Api byte-identically to the retrieved value, without transliteration, normalization, character substitution or bidirectional reordering of the stored characters.
11. THE Web_Client SHALL submit Arabic and Hebrew text entered by a user byte-identically to the entered value.
12. THE Web_Client SHALL render dates, times and numbers using the formatting conventions of the active Locale while retaining UTC as the authoritative value for every Backend_Api timestamp.
13. THE Test_Suite SHALL exercise the registration, profile, CV upload, job browsing, application and review journeys in each of the three Locales.

---

### Requirement 20: Accessibility

**User Story:** As a user relying on assistive technology or a keyboard, I want every feature to be operable and understandable, so that the Platform is usable regardless of how I interact with it.

#### Acceptance Criteria

1. THE Web_Client SHALL conform to WCAG 2.1 Level AA success criteria for every screen.
2. THE Web_Client SHALL make every interactive control reachable and operable by keyboard alone, in an order that matches the visual reading order of the active direction.
3. THE Web_Client SHALL render a visible focus indicator on every focused interactive control with a contrast ratio of at least 3 to 1 against the adjacent background.
4. THE Web_Client SHALL render text and images of text with a contrast ratio of at least 4.5 to 1 against the background, except for large-scale text which SHALL meet a ratio of at least 3 to 1.
5. THE Web_Client SHALL associate every form input with a programmatically determinable label.
6. WHEN a form submission produces a Field_Violation, THE Web_Client SHALL associate the rendered message with the affected input through the input's accessible description and SHALL move focus to the first affected input.
7. WHEN an asynchronous operation completes, THE Web_Client SHALL announce the outcome through a live region without moving focus.
8. THE Web_Client SHALL render every non-text control with a text alternative that conveys the control's purpose.
9. THE Web_Client SHALL remain fully usable at a viewport width of 320 CSS pixels in both portrait and landscape orientation, and SHALL expose every desktop feature at that width.
10. THE Web_Client SHALL remain usable when text is resized to 200 percent without loss of content or functionality.
11. THE Web_Client SHALL confine keyboard focus to an open modal dialog and SHALL restore focus to the invoking control when that dialog closes.
12. THE Web_Client SHALL respect the operating-system reduced-motion preference by suppressing non-essential animation.
13. THE Build_Pipeline SHALL run an automated accessibility check over every rendered route and SHALL fail with a non-zero status code when a violation of a Level AA success criterion is reported.

---

### Requirement 21: Error, Loading and Empty State Handling

**User Story:** As a user, I want every failure, wait and empty result explained in my language with something I can act on, so that I am never left guessing what happened.

#### Acceptance Criteria

1. THE Error_Presenter SHALL map the `error` member of every Error_Envelope to a localized message catalogue entry.
2. WHERE the `error` member of an Error_Envelope has no message catalogue entry, THE Error_Presenter SHALL render a generic localized failure message together with the Support_Reference.
3. WHEN a request fails with a status code of 403 and the `error` member `not_authorized`, THE Error_Presenter SHALL render one single localized authorization message that is identical for every resource, and SHALL NOT state, imply or vary by whether the requested resource exists.
4. THE Web_Client SHALL present the same authorization-denied screen, with the same text and the same available actions, for every 403 `not_authorized` outcome regardless of the requested route or resource identifier.
5. THE Web_Client SHALL NOT vary the time between receiving a 403 `not_authorized` response and rendering the authorization-denied screen based on the requested resource identifier.
6. THE Web_Client SHALL render a loading indicator for every asynchronous read that has not resolved.
7. WHEN a read resolves with zero items, THE Web_Client SHALL render a localized empty-state message naming the destination and, WHERE a filter is applied, SHALL present a clear-filter control.
8. WHEN a read fails, THE Web_Client SHALL render an error state carrying the localized message, the Support_Reference and a retry control.
9. WHERE an Error_Envelope reports a retryable outcome, THE Api_Client SHALL retry the failed read at most twice with an increasing delay before the error state is rendered.
10. THE Api_Client SHALL NOT automatically retry a request that mutates Backend_Api state.
11. WHEN an unhandled rendering error occurs, THE Web_Client SHALL render a recovery boundary that retains the application shell, presents a reload control and presents the Support_Reference of the most recent failed request.
12. WHILE a mutation request is in flight, THE Web_Client SHALL disable the submitting control and SHALL prevent a duplicate submission of the same mutation.

---

### Requirement 22: Client-Side Form Validation

**User Story:** As a user filling a form, I want invalid input flagged before submission and server-reported violations shown against the right field, so that I can correct mistakes without losing my work.

#### Acceptance Criteria

1. THE Form_Validator SHALL apply the same field bounds the Backend_Api declares for each request body, including minimum and maximum lengths, numeric ranges, collection size limits and enumerated value sets.
2. THE Form_Validator SHALL require a password of at least 10 Unicode code points and SHALL accept a password of up to at least 64 Unicode code points.
3. THE Form_Validator SHALL count password length in Unicode code points rather than in UTF-16 code units.
4. THE Form_Validator SHALL reject an email address that is not a well-formed address per the RFC 5322 addr-spec form, with a localized field-level message.
5. THE Form_Validator SHALL reject a LinkedIn URL that is not a well-formed HTTPS URL of at most 200 characters, with a localized field-level message.
6. THE Form_Validator SHALL reject an education or work-experience entry whose end value precedes its start value, with a localized field-level message naming the affected entry index.
7. THE Form_Validator SHALL restrict a Verification_Code input and a multi-factor code input to exactly 6 digits.
8. THE Form_Validator SHALL restrict a rating input to an integer between 1 and 5 inclusive.
9. WHEN a Backend_Api response reports Field_Violation entries, THE Web_Client SHALL render every reported violation simultaneously rather than only the first.
10. WHEN a Backend_Api response reports a Field_Violation whose `path` addresses no rendered input, THE Web_Client SHALL render that violation in a form-level message region.
11. WHEN a submission fails, THE Web_Client SHALL retain every value the user entered.
12. THE Form_Validator SHALL treat client-side validation as an aid only and SHALL submit every form to the Backend_Api for authoritative validation.

---

### Requirement 23: Observability and Support Traceability

**User Story:** As a user reporting a problem and as an operator diagnosing it, I want a reference that ties what I saw to what the server recorded, so that a failure can be traced without guesswork.

#### Acceptance Criteria

1. THE Web_Client SHALL render the Support_Reference of a failed request in every error state, error dialog and recovery boundary.
2. THE Web_Client SHALL present a copy control that places the Support_Reference on the clipboard.
3. THE Web_Client SHALL retain the Support_Reference of the most recent failed request for the lifetime of the browsing context.
4. THE Web_Client SHALL NOT render a Support_Reference on a successful outcome.
5. THE Web_Client SHALL report the bundle version identifier on a diagnostics surface reachable from the application shell.
6. THE Web_Client SHALL call `GET /health` from the diagnostics surface and render the returned status.
7. THE Web_Client SHALL NOT transmit an Access_Token, a Refresh_Token, a password, a Verification_Code, a national ID number or a Residency_Proof value to any destination other than the Backend_Api.

---

## Assumptions and Dependencies

The following are recorded rather than designed around, because the Backend_Api does not currently expose the capability the corresponding backend requirement implies. Each is a dependency on backend work, not a Web_Client design decision.

1. **Password reset has no endpoint.** `PUBLIC_ROUTE_PATHS` in `backend/app/platform/security/guards.py` allowlists `/api/v1/auth/password-reset`, but no route implements that path in any module router. The Web_Client will present no password-reset flow until the endpoint exists.
2. **Registration does not accept a CV upload.** Backend Requirement 1 AC9 makes a CV upload part of the registration form, but `RegistrationRequest` carries no file field and `POST /api/v1/register/{role}` accepts JSON only. The Web_Client collects the first CV after approval, through the CV_Variant upload path of Requirement 11.
3. **Number of openings and recruiter contact email are not in the Job_Description contract.** Backend Requirement 6 AC1 names both fields; `JdCreateRequest` and `JobDescriptionDTO` carry neither. The Web_Client omits both inputs.
4. **Required skills are returned as identifiers.** `JobDescriptionDTO.required_skill_ids` holds UUID values with no accompanying names, and no batch skill-resolution endpoint exists. The Web_Client resolves display names through `GET /api/v1/skills`, which searches by term rather than by identifier, so skill names on a Job_Description detail may be unresolved until a lookup-by-identifier capability exists.
5. **In-app notifications have no endpoint.** The Phase 1 notification constraint names in-app notification for application confirmation, status change and CV quarantine, and the backend holds a notifications model, but no router exposes a notification list. The Web_Client derives these signals from the affected resource state (Application status, CV_Version state) instead of from a notification feed.
6. **Application status history is not exposed.** `ApplicationStatusTransitionDTO` exists in the applications schemas but no route returns a transition list. The Web_Client renders only the current Application status.
7. **Audit entries do not carry actor identity.** `GET /api/v1/admin/audit` returns `actor` as `null` by design, to avoid an N+1 query. The Web_Client renders an actor-filter control and an unresolved actor column until enrichment is available.
8. **Job applicant lists are keyset-paginated without a `has_next` signal.** `GET /api/v1/jobs/{jd_id}/applicants` returns a bare list. The Web_Client infers that a further page exists when a full page is returned.
9. **Residency proof re-validation on profile edit is server-side only.** The Web_Client mirrors format constraints where they are deterministic but relies on the Backend_Api for the authoritative Israeli mobile-prefix set, national-ID check digit and locality resolution.
10. **Session state does not survive a reload.** Requirement 4 AC3 keeps both tokens in memory to avoid script-readable token storage, which means a reload requires a new sign-in. A refresh-token cookie issued by the Backend_Api would remove that cost; no such cookie exists today.

---

## Traceability to Platform Requirements

| Web_Client requirement | Platform requirements covered |
| --- | --- |
| 1 Technology Foundation and Build Pipeline | Cross-cutting: Performance, Accessibility |
| 2 Typed Contract Generation | Cross-cutting: all module contracts |
| 3 Api_Client and Uniform Error Decoding | R3 AC6; cross-cutting error envelope |
| 4 Authentication and Session Lifecycle | R3 AC8; Security: session expiry |
| 5 Admin Multi-Factor Authentication | Security: MFA required for Admin |
| 6 Registration and Email Verification | R1 AC8–AC13, AC24, AC25; R2 AC1–AC10 |
| 7 Account Status Gating | R1 AC12, AC14, AC21; R3 AC11 |
| 8 Role-Based Route Guarding and Navigation | R1 AC4; R3 AC1–AC5, AC7, AC10 |
| 9 Candidate Profile Management | R4 AC1–AC14; R2 AC13, AC14 |
| 10 Senior Profile and Contact Preferences | R4A AC1–AC11 |
| 11 CV Variant and Version Management | R5 AC1–AC17 |
| 12 Job Description Browsing | R6 AC9, AC10, AC13, AC14; R3 AC8 |
| 13 Job Description Authoring | R6 AC1–AC8, AC11, AC15–AC17 |
| 14 Application Submission and Tracking | R7 AC1–AC13; R3 AC4 |
| 15 Review Submission and Timeline | R9 AC1–AC10 |
| 16 Admin Account Management | R1 AC7, AC8, AC15–AC20, AC22; R4 AC3 |
| 17 Audit Log Browsing | R8 AC3, AC4, AC8 |
| 18 Reports and Excel Export | R28 AC1–AC6; R29 AC1–AC5 |
| 19 Internationalization and RTL | Localization constraints |
| 20 Accessibility | Accessibility constraints |
| 21 Error, Loading and Empty State Handling | R3 AC6; cross-cutting error envelope |
| 22 Client-Side Form Validation | R1 AC9; R4 AC11–AC14; Security: password policy |
| 23 Observability and Support Traceability | Cross-cutting: request correlation |
