# Requirements Document

## Introduction

The HasoubLabs Recruitment Platform is a greenfield web application designed to help the Hasoub Labs recruitment team efficiently discover, understand, manage, match, and support Arab students and graduates throughout their journey toward employment in Israel's high-tech industry.

The platform serves **three platform roles** plus **one external actor**:

* **Admin** — HasoubLabs employees who operate the platform.
* **Candidate** — Arab students and graduates seeking employment.
* **Senior** — senior professionals who post job openings and (in later phases) act as mentors and referrers.
* **Recruiter** (external actor, no platform login) — receives consolidated candidate packages by email in a later phase. 

It replaces or reduces manual coordination (spreadsheets, email threads, manual WhatsApp messages) with structured workflows, AI-assisted tooling, and persistent records that accumulate value over time.

Key outcomes the platform must achieve:

* Reduce recruiter manual effort per candidate while improving decision quality
* Give candidates self-service access to AI-powered profile improvement tools
* Give seniors a lightweight way to post openings and connect with suitable candidates
* Provide a full audit trail of every candidate's journey — CVs, reviews, notes, communications — so no context is ever lost

---

## Phasing

This document is delivered in phases. **Phase 1 (Requirements 1–4, 4A, 5–9) is the current design/spec scope.**

| Phase | Requirements | Theme |
| --- | --- | --- |
| **Phase 1 (current)** | 1–4, 4A, 5–9 | Foundational identity, access, profiles, CVs, job postings, applications, audit, Senior contact preferences, and candidate reviews. No AI_Engine dependency. |
| Phase 2 (deferred) | 10–21 | AI features (JD extraction, scoring, CV/LinkedIn improvement), notes, recruiter handoff, chat, email/WhatsApp, notifications. |

Phase 2 requirements are retained below for context but are **out of scope for the current spec cycle**. Where a Phase 1 requirement depends on infrastructure whose full form is Phase 2 (transactional email, notifications), the Phase 1 requirement defines only the minimal capability it needs; see the Cross-Cutting Constraints.

---

## Glossary

* **Admin**: A HasoubLabs employee with full platform access. Responsible for overseeing candidates, managing users, and configuring platform settings. The Admin role cannot be combined with the Candidate or Senior role on the same account.
* **Candidate**: An Arab student or graduate who registers on the platform to seek employment in Israel's high-tech industry.
* **Senior / Job_Poster**: A senior professional registered on the platform who can post job openings. A single person may hold both the Candidate and Senior roles on one account (see Requirement 1).
* **Company_Affiliation**: A free-text field (≤150 characters) on a Senior's profile naming the company the Senior is affiliated with; used to evaluate the `SameCompany` Contact_Scope_Preference (Requirement 4A).
* **Field_Of_Expertise**: 1–10 skills, drawn from the Skill_Taxonomy, on a Senior's profile identifying that Senior's area of expertise; used to evaluate the `FieldOfExpertise` Contact_Scope_Preference (Requirement 4A).
* **Contact_Channel_Preference**: A Senior profile field indicating how, if at all, the Senior may be contacted about jobs. One of: `Chat`, `Email`, `Both`, `None` (Requirement 4A).
* **Contact_Scope_Preference**: A Senior profile field indicating which Job_Descriptions the Senior is contactable for, required whenever Contact_Channel_Preference is not `None`. One of: `OwnPostingsOnly`, `SameCompany`, `FieldOfExpertise` (Requirement 4A).
* **Recruiter** *(Phase 2)*: An external company recruiter who receives consolidated candidate profiles via email. The Recruiter does not have a platform login.
* **Account_Status**: The lifecycle state of a user account. One of: `PendingVerification`, `PendingApproval`, `ApprovedPendingMeeting`, `Approved`, `Rejected`, `Suspended`, `Deactivated`.
* **Residency_Proof**: A datum submitted at registration to support Israeli residency: an Israeli mobile phone number, an Israeli national ID number, or an Israeli residential address (street, house/building number, city, and country).
* **Verification_Code**: A single-use numeric code emailed to the registrant's address during registration. Entering it confirms email ownership and drives the Email_Verification record.
* **Email_Verification**: The record tracking confirmation of a registrant's Verification_Code. State one of: `PendingCode`, `Verified`, `Expired`. This record confirms only that the registrant controls the submitted email address; it does not by itself establish Israeli residency (Requirement 2).
* **Residency_Validation**: The automated, synchronous, deterministic check the Platform runs against a submitted Residency_Proof (Requirement 2 AC2): a pass/fail outcome computed at submission time (and re-run on later changes to the underlying field), with no admin action required and no persisted status field of its own. An Admin may still reject an account on residency grounds using judgment (e.g., from the CV) even when Residency_Validation passes (Requirement 2 AC11; Requirement 1 AC20).
* **Skill**: A competency drawn from the platform **Skill_Taxonomy**. Candidate- or JD-entered terms not in the taxonomy are stored linked to a normalized term and flagged for Admin review.
* **Skill_Taxonomy**: The platform-maintained canonical list of skills used for profile entry, job requirements, and (Phase 2) matching.
* **Profile_Completeness**: A Candidate profile is `Complete` when it satisfies Requirement 4 AC6; otherwise `Draft`.
* **CV**: A candidate's resume document in PDF or DOCX format.
* **CV_Version**: A specific immutable snapshot of a Candidate's CV, stored after a successful upload with a sequential version number and checksum.
* **CV_Variant**: A named, purpose-tagged slot maintained by a Candidate (e.g., "Software Engineering", "Data Engineering"). Each CV_Variant holds its own independent sequence of CV_Versions and its own `active` designation. A Candidate may maintain 1–5 CV_Variants. One CV_Variant is designated the Candidate's `primary` variant and is used as the default when no explicit variant is selected.
* **Application-Ready**: A Candidate whose profile is `Complete` and who has at least one `CV_Version` in any CV_Variant (Requirement 4 AC7). Required to submit an Application.
* **Job_Description (JD)**: A posting describing a role's requirements, responsibilities, and qualifications. Status one of: `Draft`, `Open`, `Closed`.
* **Experience_Level**: A band on a Job_Description: `Junior-level`, `Mid-level`, `Senior-level`, or `Lead`. Indicative year ranges (for Phase 2 matching): Junior-level 0–2, Mid-level 2–5, Senior-level 5–8, Lead 8+.
* **Application**: A formal expression of interest by a Candidate for a specific Job_Description, created only when the Job_Description's Application_Channel is `Senior_Dashboard` or `Admin_Dashboard`. Status one of: `Submitted`, `Under Review`, `Forwarded to Recruiter`, `Closed`.
* **Application_Channel**: The routing configured on a Job_Description for how Candidate applications are handled: `Senior_Dashboard`, `Admin_Dashboard`, or `External_Careers_URL` (Requirement 6 AC15).
* **Audit_Log**: The append-only, tamper-evident record of every significant platform action (Requirement 8).
* **JD_Extraction** *(Phase 2)*: The structured result of automatically parsing a Job_Description.
* **Candidate_Score** *(Phase 2)*: A 0–100 match score for a Candidate against a Job_Description.
* **Review / Review_Timeline**: A structured evaluation of a Candidate and the append-only sequence of such evaluations (Requirement 9).
* **Candidate_Note** *(Phase 2)*: A free-text annotation for a Candidate in the context of a specific Job_Description.
* **Recruiter_Package** *(Phase 2)*: A consolidated document sent to an external Recruiter.
* **Chat_Message** *(Phase 2)*: A message between a Candidate and a Senior via in-app messaging.
* **AI_Engine** *(Phase 2)*: The platform's AI subsystem (CV improvement, JD-specific tailoring, LinkedIn suggestions, JD extraction, keyword scoring).
* **Profile_Suggestion** *(Phase 2)*: An AI-generated recommendation targeting a section of a Candidate's CV or LinkedIn profile.
* **Platform**: The HasoubLabs Recruitment Platform web application described in this document.
* **System**: The Platform and all its subsystems acting as a whole.

---

## Requirements

### Phase 1 Requirements (In Scope)

---

### Requirement 1: User Registration and Role Assignment

**User Story:** As an Admin, I want prospective users to register themselves as a Candidate and/or a Senior, confirm their email and residency proof during registration, and complete an onboarding meeting before gaining full access, so that every user is vetted and interacts with the platform according to their responsibilities.

#### Acceptance Criteria

1. THE Platform SHALL support exactly three roles: Admin, Candidate, and Senior.
2. THE Platform SHALL provide two distinct self-service registration flows: one for the Candidate role and one for the Senior role.
3. THE Platform SHALL allow a single user account to hold the Candidate role, the Senior role, or both concurrently.
4. WHEN an account holds both the Candidate and Senior roles, THE Platform SHALL let the user select an active role context and switch it within a single session, and SHALL scope every request to the active context; WHERE an account holds exactly one role, THE Platform SHALL default the active context to that account's sole role.
5. THE Platform SHALL NOT allow the Admin role to be combined with the Candidate or Senior role on the same account.
6. THE Platform SHALL create the initial Admin account by direct insertion into the database, not through any self-service or in-app flow; thereafter only an existing Admin SHALL create or revoke Admin accounts.
7. THE Platform SHALL expose all user-management functions (record meeting completion, approve or reject a pending registration, suspend, reactivate, add or remove roles, generate registration links) only to sessions authenticated as Admin.
8. THE Platform SHALL allow an Admin to generate role-specific registration links: one that opens the Candidate registration flow and one that opens the Senior registration flow.
9. THE registration form SHALL require: full name, email address, a password satisfying the Security constraints, at least one Residency_Proof as required by Requirement 2, and a CV upload; and SHALL reject the submission with field-level errors if any requirement is unmet. The requested role SHALL NOT be a form field; it SHALL be determined by which role-specific registration link (Requirement 1 AC8) the registrant used to enter the flow.
10. IF a registration is submitted through a given role-specific registration link with an email address that (compared case-insensitively) already belongs to an existing account holding that same role (Candidate or Senior), THEN THE Platform SHALL reject the registration and return an error identifying the email conflict, without disclosing any other account details.
11. WHEN a registration passes field, password-policy, CV-upload validation, and Residency_Validation (Requirement 2 AC2), THE Platform SHALL create the account in `PendingVerification` and email a Verification_Code to the submitted address (per Requirement 2).
12. WHILE an account is in `PendingVerification`, THE Platform SHALL restrict the user to the code-entry and code-resend screens only, and SHALL deny access to every other feature.
13. WHEN the user submits the correct Verification_Code before it expires, THE Platform SHALL confirm email ownership, set the Email_Verification record to `Verified` (Requirement 2), transition the account to `PendingApproval`, and notify an Admin that a new registration is awaiting review.
14. WHILE an account is in `PendingApproval`, THE Platform SHALL restrict the user to the authentication and registration-status screens only, and SHALL deny access to every other feature.
15. WHEN an Admin reviews and approves an account that is in `PendingApproval`, THE Platform SHALL transition the account to `ApprovedPendingMeeting` and notify an Admin to arrange the onboarding meeting.
16. WHERE the onboarding meeting has already occurred for an account in `PendingApproval`, THE Platform SHALL let an Admin transition that account directly to `Approved`, bypassing `ApprovedPendingMeeting`, and record the Admin identity and a UTC timestamp.
17. IF the Verification_Code is not confirmed within 72 hours of issue, THEN THE Platform SHALL expire the registration, set the Email_Verification record to `Expired`, and release the email address for re-registration.
18. THE Platform SHALL represent every account with exactly one `Account_Status` value at all times, drawn from: `PendingVerification`, `PendingApproval`, `ApprovedPendingMeeting`, `Approved`, `Rejected`, `Suspended`, `Deactivated`.
19. WHEN an Admin records that the onboarding meeting is complete for an account in `ApprovedPendingMeeting`, THE Platform SHALL transition the account to `Approved` and record the Admin identity and a UTC timestamp.
20. WHEN an Admin rejects an account that is in `PendingVerification`, `PendingApproval`, or `ApprovedPendingMeeting`, THE Platform SHALL transition it to `Rejected`, record the Admin identity, a UTC timestamp, and a rejection reason of at least 10 characters, and notify the user.
21. WHILE an account is in any status other than `Approved`, THE Platform SHALL restrict it to the authentication, code-entry, and onboarding screens, and SHALL deny access to every other feature.
22. THE Platform SHALL allow an Admin to re-open a `Rejected` account for reconsideration or to release its email address for re-registration.
23. THE Platform SHALL record every registration submission, `Account_Status` transition, meeting-completion, rejection, and role change in the Audit_Log (Requirement 8).
24. IF the user submits an incorrect Verification_Code, THEN THE Platform SHALL reject it, allow retry, and lock code entry after 5 consecutive incorrect attempts until a new code is requested.
25. WHEN the user requests a new Verification_Code, THE Platform SHALL issue a new single-use code, invalidate any prior unexpired code, and reset the incorrect-attempt count.

---

### Requirement 2: Geographic (Residency) Verification

**User Story:** As an Admin, I want the Platform to automatically validate that every registrant's residency proof indicates Israeli residency, and to confirm an emailed verification code, so that the platform stays within its intended geographic and legal scope and each account is tied to a working email address, without requiring Admin involvement for the automated residency check itself.

> **Note on assurance:** Residency_Validation (AC2) is a synchronous, deterministic, system-run check with no Admin involvement and no persisted status of its own; passing it is a precondition of registering and of saving later edits to a Residency_Proof field, so an account can never exist with an unvalidated Residency_Proof. Email_Verification remains the asynchronous, code-based step that confirms the registrant controls the submitted email address; it does not by itself establish Israeli residency. Because Residency_Validation is mandatory and automated, the Platform tracks no separate Geographic_Verification status field — an Admin's only residency-related lever is to reject the account (Requirement 1 AC20) using judgment (for example, clues in the CV) during `PendingApproval`, even when Residency_Validation passed.

#### Acceptance Criteria

1. WHEN a user submits a registration form, THE Platform SHALL require at least one Residency_Proof (Israeli mobile phone number, Israeli national ID number, or Israeli residential address) and SHALL reject the submission synchronously if none is provided.
2. WHEN a Residency_Proof is submitted, THE Platform SHALL synchronously run Residency_Validation, an automated, deterministic check requiring no Admin action: mobile phone numbers SHALL match an Israeli local mobile prefix (the exact set of valid prefixes is configurable platform data, to be finalized separately) followed by the remaining digits of a valid Israeli mobile number; national ID numbers SHALL be exactly 9 digits and pass the Israeli ID check-digit algorithm; residential addresses SHALL contain a non-empty street name, a house or building number, a city that resolves to a locality within Israel, and a country field equal to Israel, within a 200-character field limit.
3. IF Residency_Validation fails for every submitted proof, THEN THE Platform SHALL reject the submission and return an error identifying which proof failed and listing the accepted proof types and formats.
4. WHEN a registration passes field validation and Residency_Validation, THE Platform SHALL create the account in `PendingVerification` and create an Email_Verification record in state `PendingCode` linked to the account; the submitted Residency_Proof is stored on the account and is not tracked by any separate geographic-verification status.
5. WHEN the Email_Verification record enters `PendingCode`, THE Platform SHALL send an email containing a Verification_Code to the registered address within 60 seconds; the code SHALL be 6 to 8 digits, single-use, and SHALL expire 72 hours after issue.
6. WHEN the user submits the correct Verification_Code before it expires, THE Platform SHALL set the Email_Verification record to `Verified` and allow the account to transition to `PendingApproval` (Requirement 1).
7. IF the user submits an incorrect Verification_Code, THEN THE Platform SHALL reject it and allow retry.
8. WHILE 5 or more consecutive incorrect Verification_Code attempts have been recorded and no new code has since been requested, THE Platform SHALL lock code entry.
9. WHEN the user requests a new Verification_Code, THE Platform SHALL issue a new single-use code, invalidate any prior unexpired code, and reset the incorrect-attempt count.
10. IF the Verification_Code expires before it is confirmed, THEN THE Platform SHALL set the Email_Verification record to `Expired` and apply the registration-expiry behavior in Requirement 1.
11. WHEN an Admin reviews an account in `PendingApproval`, THE Platform SHALL present the submitted Residency_Proof, the Residency_Validation result for each submitted proof, and the uploaded CV; the Admin MAY reject the account on residency grounds (Requirement 1 AC20), using their own judgment (for example, clues in the CV), even though Residency_Validation already passed at submission.
12. THE Platform SHALL deny all feature access, except the authentication, code-entry, and onboarding screens, to any account whose Email_Verification record is not `Verified`.
13. WHEN a user (including an `Approved` account) attempts to save a change to a field that served as their Residency_Proof, THE Platform SHALL re-run Residency_Validation synchronously against the new value before saving.
14. IF the re-run Residency_Validation fails, THEN THE Platform SHALL reject the save, return a field-level error identifying the violation, and retain the prior persisted value; THE Platform SHALL NOT alter `Account_Status` or the Email_Verification record, and SHALL NOT restrict feature access as a result of this failure.
15. THE Platform SHALL store national ID numbers and residency-proof data encrypted at rest, accessible only to Admin sessions, and SHALL exclude them from every Senior- and Candidate-facing view.
16. THE Platform SHALL record in the Audit_Log (Requirement 8): every Residency_Validation failure (at registration or later save) with the reason, every Email_Verification state change, and every Admin rejection made on residency grounds.

---

### Requirement 3: Role-Based Access Control

**User Story:** As an Admin, I want each role's capabilities to be fixed and enforced on the server, so that candidate data and platform operations are protected from unauthorized access.

#### Acceptance Criteria

1. THE Platform SHALL enforce authorization on the server for every request, deriving permissions solely from the account's assigned roles and, for dual-role accounts, the active role context; for a single-role account the active context SHALL be that account's sole role; THE Platform SHALL NOT provide per-user permission overrides.
2. THE Platform SHALL grant Admin sessions access to: user and role management, all Candidate profiles and CV_Versions, all Job_Descriptions in any status, all Applications and their status, every Candidate's full Review_Timeline (Requirement 9), the Audit_Log (read and search only), and platform configuration.
3. WHEN a session's active context is Candidate, THE Platform SHALL grant access only to: the user's own profile, the user's own CV_Versions, the user's own Applications, and browsing of `Open` Job_Descriptions.
4. WHEN a session's active context is Senior, THE Platform SHALL grant access only to: creating and managing the user's own Job_Descriptions, browsing all `Open` Job_Descriptions, viewing the applicant list for the user's own Job_Descriptions (each entry limited to candidate full name, applied role title, and Application status), and submitting Reviews and viewing their own submitted Reviews for a Candidate (Requirement 9).
5. THE Platform SHALL NOT expose to any Senior session in Phase 1 any Candidate field beyond the applicant-list fields permitted by criterion 4 (candidate full name, applied role title, and Application status); specifically, a Candidate's email address, phone number, national ID, residency proof, CV files, education entries, work-experience entries, skills, languages, summary, and LinkedIn URL SHALL NOT be exposed to any Senior session.
6. WHEN a session requests a resource outside its authorized capabilities, THE Platform SHALL deny the request and return an authorization error that is identical whether or not the resource exists, with no observable difference (including response timing) that would let the caller infer the resource's existence, and SHALL include no data from the resource in the response.
7. THE Platform SHALL prevent any Candidate context from accessing another Candidate's profile, CV_Versions, or Applications.
8. THE Platform SHALL require authentication for every feature and every item of platform content except: the Candidate and Senior registration flows reached through an Admin-generated registration link, Verification_Code entry, login, and password reset. Job_Descriptions SHALL NOT be visible or discoverable by unauthenticated visitors.
9. WHEN an authorization check fails, THE Platform SHALL record an Audit_Log entry capturing the actor identity, the attempted action, the target resource identifier, the denied outcome, and a UTC timestamp at millisecond precision.
10. WHEN a dual-role user switches active role context, THE Platform SHALL re-derive capabilities for the new context and SHALL NOT carry data access over from the previous context.
11. WHILE an account is `Suspended` or `Deactivated`, THE Platform SHALL deny all authenticated requests from that account except viewing a status notice.

---

### Requirement 4: Candidate Profile Management

**User Story:** As a Candidate, I want to build and maintain a structured profile, so that Admins (and, in later phases, recruiters) can evaluate my background accurately.

#### Acceptance Criteria

1. THE Platform SHALL let a Candidate maintain a profile containing: full name (1–100 characters); email address; phone number; 0–20 education entries (institution ≤150 characters, degree ≤100 characters, field of study ≤100 characters, enrolment status of `Enrolled` or `Graduated`, start year and graduation or expected-graduation year each in the range 1950–2100); 0–20 work-experience entries (employer ≤150 characters, role title ≤150 characters, start date, end date or "present"); 1–20 skills, each rendered in at most 50 characters; up to 10 languages; an optional summary of at most 1000 characters; and an optional LinkedIn URL of at most 200 characters.
2. THE Platform SHALL source skills from the Skill_Taxonomy.
3. WHEN a Candidate enters a skill not in the Skill_Taxonomy, THE Platform SHALL store it linked to a normalized term and flag it for Admin taxonomy review.
4. WHILE an account is `Approved`, THE Platform SHALL let the Candidate edit any field of their own profile at any time.
5. WHEN a Candidate creates or edits their profile, THE Platform SHALL record the change in the Audit_Log with actor, before and after field values, and a UTC timestamp at millisecond precision.
6. THE Platform SHALL classify a profile as `Complete` when all of the following hold, and `Draft` otherwise: full name of 1–100 characters; a verified email address; a phone number in valid E.164 form; at least one education entry; and at least one skill. This is the single definition of profile completeness used across the Platform.
7. THE Platform SHALL classify a Candidate as `Application-Ready` when their profile is `Complete` and at least one CV_Version exists in any of their CV_Variants.
8. WHEN a Candidate saves profile changes that leave the profile not `Complete`, THE Platform SHALL persist the profile in `Draft` state and list every missing or invalid field by name.
9. WHEN a Candidate attempts an action that requires `Application-Ready` while they are not, THE Platform SHALL block the action and return an error naming every unmet condition.
10. THE Platform SHALL let Admin sessions view the full Candidate profile, including all fields, the profile audit history, `Account_Status`, and the CV_Version list.
11. WHEN a Candidate saves a profile, IF an email address is not valid per RFC 5322 addr-spec or a phone number is not valid E.164, THEN THE Platform SHALL reject the save with a field-level error naming each invalid field and SHALL retain the prior persisted values.
12. WHEN a Candidate saves a profile with an email address whose domain resolvability cannot be confirmed within 5 seconds, THE Platform SHALL reject the save with a field-level error and SHALL retain the prior persisted values.
13. WHEN a Candidate provides a LinkedIn URL, IF it is not a well-formed HTTPS URL, THEN THE Platform SHALL reject the save with a field-level error.
14. WHEN a Candidate provides an education or work-experience entry, IF its end year/date precedes its start year/date, THEN THE Platform SHALL reject the save with a field-level error identifying the entry.
15. THE Platform SHALL expose Candidate profile data to Senior sessions only to the extent permitted by Requirement 3.

---

### Requirement 4A: Senior Profile Management (Phase 1)

**User Story:** As a Senior, I want to maintain my profile details and control whether and how I can be contacted about jobs, so that I only receive inquiries I am willing to handle, through channels I prefer.

#### Acceptance Criteria

1. THE Platform SHALL let a Senior maintain a Contact_Channel_Preference field with exactly one value: `Chat`, `Email`, `Both`, or `None`, defaulting to `None` until the Senior explicitly changes it.
2. WHERE Contact_Channel_Preference is not `None`, THE Platform SHALL require the Senior to also set a Contact_Scope_Preference of exactly one value: `OwnPostingsOnly`, `SameCompany`, or `FieldOfExpertise`.
3. WHERE Contact_Channel_Preference is `None`, THE Platform SHALL NOT require a Contact_Scope_Preference, and SHALL exclude that Senior from every contactable-Seniors list (Requirement 6 AC13).
4. THE Platform SHALL let a Senior maintain a Company_Affiliation field (≤150 characters, free text) and a Field_Of_Expertise field (1–10 skills drawn from the Skill_Taxonomy, consistent with Requirement 4 AC2's skill-sourcing rule) on their profile.
5. WHEN a Senior sets Contact_Scope_Preference to `SameCompany`, THE Platform SHALL require a non-empty Company_Affiliation before saving, and SHALL reject the save with a field-level error otherwise.
6. WHEN a Senior sets Contact_Scope_Preference to `FieldOfExpertise`, THE Platform SHALL require at least one Field_Of_Expertise skill before saving, and SHALL reject the save with a field-level error otherwise.
7. THE Platform SHALL let a Senior change their Contact_Channel_Preference and Contact_Scope_Preference at any time, and SHALL apply each change to every subsequent contactability evaluation immediately, without relying on a cached or precomputed snapshot of the prior preference.
8. WHEN Contact_Channel_Preference is `Email` or `Both`, THE Platform SHALL use the Senior's registered account email address as the contact address for that channel; THE Platform SHALL NOT accept or display an alternate contact email in Phase 1.
9. WHEN Contact_Channel_Preference is `Chat` or `Both`, THE Platform SHALL record the Chat channel as active for that Senior; because in-app Chat is a Phase 2 capability (Requirement 16) not yet built, THE Platform SHALL display "chat contact not yet available" wherever that Senior's Chat channel would otherwise be shown, and SHALL NOT exclude the Senior from a contactable-Seniors list solely because Chat is unavailable.
10. WHERE Contact_Scope_Preference is `OwnPostingsOnly`, THE Platform SHALL treat the Senior as contactable only for Job_Descriptions that the Senior personally created.
11. WHERE Contact_Scope_Preference is `SameCompany`, THE Platform SHALL treat the Senior as contactable for any Job_Description whose company name (Requirement 6 AC1) matches the Senior's Company_Affiliation, compared case-insensitively.
12. WHERE Contact_Scope_Preference is `FieldOfExpertise`, THE Platform SHALL treat the Senior as contactable for any Job_Description whose required skills (Requirement 6 AC1) intersect with at least one of the Senior's Field_Of_Expertise skills.
13. WHEN a Job_Description detail view is requested, THE Platform SHALL evaluate the contactability of every Senior using that Senior's then-current Contact_Channel_Preference, Contact_Scope_Preference, Company_Affiliation, and Field_Of_Expertise values, rather than a cached or precomputed result.
14. THE Platform SHALL let only the Senior themselves and Admin sessions view or modify that Senior's Contact_Channel_Preference, Contact_Scope_Preference, Company_Affiliation, and Field_Of_Expertise fields.

---

### Requirement 5: CV Upload and Version Control

**User Story:** As a Candidate, I want to maintain separate CV variants targeted at different role types (e.g., Software Engineering, Data Engineering), upload new versions to each independently, and choose which variant to submit when applying — so that each application goes out with the most relevant CV, and my full upload history is never lost.

#### Acceptance Criteria

1. THE Platform SHALL accept a CV upload only when the file is a valid PDF or DOCX, verified by content inspection rather than file extension alone, and is at most 10 MB.
2. IF an uploaded file is not a valid PDF or DOCX, exceeds 10 MB, or is password-protected or unreadable, THEN THE Platform SHALL reject it without storing any data and return an error identifying each specific violation (format, size, readability).
3. WHEN a CV upload passes validation, THE Platform SHALL scan it for malware before it becomes available; IF malware is detected, THEN THE Platform SHALL quarantine the file, exclude it from candidate-visible storage, and notify the Candidate and an Admin.
4. WHEN a CV upload passes validation and scanning, THE Platform SHALL store it as a new CV_Version within the target CV_Variant and SHALL never modify, overwrite, or delete any existing CV_Version.
5. THE Platform SHALL assign each CV_Version: the owning Candidate identity; the owning CV_Variant identifier; a version number starting at 1 and incrementing by exactly 1 per successful upload within that CV_Variant; an upload timestamp in UTC at millisecond precision; the file size; and a SHA-256 checksum computed at upload. Version numbers are scoped per CV_Variant and are independent across variants.
6. THE Platform SHALL allow a Candidate to maintain between 1 and 5 CV_Variants. Each CV_Variant SHALL have: a unique name within the Candidate's account of 1–100 characters (e.g., "Software Engineering", "Data Engineering"); an optional free-text description of up to 300 characters; and an `active` CV_Version designation (the highest-numbered version by default, unless an Admin or the Candidate has explicitly designated a specific version).
7. THE Platform SHALL designate exactly one CV_Variant per Candidate as `primary`. The first CV_Variant created SHALL become `primary` automatically. A Candidate or an Admin MAY change the `primary` designation to any other existing CV_Variant at any time. The `primary` designation is used as the default when no variant is explicitly selected (e.g., for scoring, AI analysis, or in contexts where variant selection is not surfaced).
8. THE Platform SHALL let a Candidate create a new CV_Variant by providing a name; the variant is created empty (no CV_Versions) until the first upload. THE Platform SHALL reject creation of a sixth CV_Variant and return an error indicating the 5-variant limit.
9. THE Platform SHALL let a Candidate rename or update the description of any of their CV_Variants at any time.
10. THE Platform SHALL NOT allow a Candidate to delete a CV_Variant if it is the only remaining variant on the account. IF a Candidate deletes a CV_Variant that is `primary`, THE Platform SHALL automatically assign the `primary` designation to the variant with the most recently uploaded CV_Version among the remaining variants.
11. THE Platform SHALL designate exactly one CV_Version per CV_Variant as `active` within that variant: by default the highest-numbered version in that variant. A new upload automatically becomes the `active` version for that variant. Explicit active version designation by Admin or Candidate is not allowed; to select a specific version, a new upload must be made.
12. WHEN a Candidate uploads a new CV_Version to a CV_Variant, THE Platform SHALL make the new version `active` within that variant and clear any prior explicit designation for that variant only.
13. THE Platform SHALL let a Candidate view their own CV_Variant list and, for each variant, the full CV_Version history (version number, upload timestamp, size, active flag) and download any version as the exact original file.
14. THE Platform SHALL let Admin sessions view every Candidate's CV_Variant list and all CV_Version histories, and download any version.
15. WHEN any CV_Version is retrieved, THE Platform SHALL recompute its checksum and, IF it does not match the stored checksum, THEN fail the retrieval and raise an integrity alert to an Admin.
16. THE Platform SHALL store CV files encrypted at rest.
17. THE Platform SHALL retain all CV_Versions per the Data Retention constraint; no role SHALL delete an individual CV_Version. Account-level data deletion follows the Data Retention constraint.
18. ~~THE Platform SHALL record every CV_Version upload, active-version designation, quarantine, and integrity-check failure in the Audit_Log.~~ *(Removed — general Audit_Log is no longer defined; see Requirement 8.)*

---

### Requirement 6: Job Description Posting

**User Story:** As a Senior or an Admin, I want to post job descriptions on the platform, so that Candidates can discover and apply to relevant opportunities.

#### Acceptance Criteria

1. THE Platform SHALL let a Senior or an Admin create a Job_Description containing: role title (≤150 characters); company name (≤150 characters); location (≤200 characters); work model (one of `Onsite`, `Hybrid`, `Remote`); employment type (one of `Full-time`, `Part-time`, `Contract`, `Freelance`, `Internship`); experience level (one of `Junior-level`, `Mid-level`, `Senior-level`, `Lead`); 1–20 required skills from the Skill_Taxonomy; an optional number of openings; an optional recruiter contact email in valid format; and a description (≤5000 characters).

1a. AS AN ALTERNATIVE to filling fields manually, THE Platform SHALL let a Senior or Admin initiate Job_Description creation by providing either:
   - a **URL** pointing to a publicly accessible job posting, OR
   - a **free-text block** (≤10 000 characters) containing a job description in any format.

1b. WHEN a URL is submitted, THE Platform SHALL fetch the page content and extract structured data (role title, company name, location, work model, employment type, experience level, skills, description), then pre-populate the Job_Description creation form with the extracted values.

1c. WHEN a free-text block is submitted, THE Platform SHALL parse it to extract the same structured fields and pre-populate the Job_Description creation form with the extracted values.

1d. IN BOTH cases, all pre-populated fields SHALL remain fully editable before the user confirms creation. Validation rules from criterion 1 (character limits, allowed enum values, skill count) SHALL be enforced at confirmation time, not at extraction time.

1e. WHEN extracted skills do not exactly match entries in the Skill_Taxonomy, THE Platform SHALL perform fuzzy matching and suggest the closest Skill_Taxonomy entries; the user SHALL manually confirm or replace any unmatched skill before the Job_Description can be saved.

1f. IF extraction yields no recognizable value for a required field, THE Platform SHALL leave that field blank and display a warning prompting the user to fill it in manually before confirming.

1g. THE Platform SHALL NOT persist any Job_Description created via URL or free-text extraction until the user explicitly confirms the pre-populated form.

1h. THE Platform SHALL rate-limit URL fetch requests per user session to prevent abuse, and SHALL reject URLs that resolve to private or non-routable IP address ranges.

2. THE Platform SHALL represent every Job_Description with one status: `Draft`, `Open`, or `Closed`.
3. WHEN a Job_Description is created, THE Platform SHALL assign a unique identifier, record the creator identity and a creation timestamp, and set its status to `Draft`.
4. WHEN the creator or an Admin publishes a `Draft` Job_Description, THE Platform SHALL transition it to `Open` and make it visible to Candidates.
5. IF a user who is neither the creator nor an Admin attempts to edit, publish, or close a Job_Description, THEN THE Platform SHALL reject the action and return an authorization error.
6. WHEN a Job_Description is `Closed`, THE Platform SHALL display a closed indicator in all list and detail views and SHALL reject any new Application for it.
7. THE Platform SHALL NOT allow a `Closed` Job_Description to be reopened; a new posting SHALL be created instead.
8. WHEN an `Open` Job_Description that has existing Applications is edited, THE Platform SHALL record the change in the Audit_Log with before and after values; existing Applications SHALL remain associated with the posting.
9. WHEN a Candidate browses Job_Descriptions, THE Platform SHALL show only `Open` postings, paginated at a maximum of 20 items per page, searchable by role title, company name, and required skills.
10. WHEN a Candidate applies one or more filters (skills, location, work model, employment type, experience level), THE Platform SHALL return only `Open` postings matching all selected filters.
11. THE Platform SHALL let a Senior view their own Job_Descriptions in any status and all `Open` Job_Descriptions; THE Platform SHALL let Admin sessions view all Job_Descriptions in any status.
12. THE Platform SHALL record every Job_Description creation, edit, publish, and close in the Audit_Log with the actor identity and a timestamp.
13. WHEN a Job_Description detail is displayed, THE Platform SHALL display a list of Seniors who are contactable for that Job_Description per Requirement 4A, each entry showing: the Senior's full name, their active contact channel(s), and — only where `Email` is an active channel — the Senior's account email address; any Senior whose Contact_Channel_Preference is `None` SHALL be excluded from this list.
14. IF no Senior is contactable for a Job_Description, THEN THE Platform SHALL display an empty-state message indicating no Seniors are currently available to contact for that role.
15. THE Platform SHALL let the Job_Description's creator or an Admin set an Application_Channel for the Job_Description, one of: `Senior_Dashboard` (route submitted Applications to the creating Senior's applicant list), `Admin_Dashboard` (route submitted Applications to the Admin portal's applicant list), or `External_Careers_URL` (redirect Candidates to an external careers page instead of submitting an in-platform Application); THE Platform SHALL default new Job_Descriptions to `Senior_Dashboard`.
16. WHEN a Job_Description's Application_Channel is set to `External_Careers_URL`, THE Platform SHALL require a well-formed HTTPS URL of at most 500 characters before the Job_Description can be published, and SHALL reject a publish attempt with a missing or malformed URL with a field-level error.
17. THE Platform SHALL allow the creator or an Admin to change a Job_Description's Application_Channel at any time before it is `Closed`; changing the Application_Channel SHALL NOT alter any Application already recorded for that Job_Description.

---

### Requirement 7: Self-Service Candidate Application

**User Story:** As a Candidate, I want to independently apply for job openings, so that I can take ownership of my job search without manual intervention from platform staff.

#### Acceptance Criteria

1. THE Platform SHALL allow a Candidate to submit an Application to an `Open` Job_Description only when the Candidate is `Application-Ready` (Requirement 4 AC7).
2. IF a Candidate attempts to apply while not `Application-Ready`, THEN THE Platform SHALL reject the submission and return an error naming each unmet condition, including each missing or invalid profile field and, where applicable, the absence of any CV_Version.
3. WHEN a Candidate clicks apply on a Job_Description, THE Platform SHALL route the request according to that Job_Description's Application_Channel (Requirement 6 AC15), abstracted from the Candidate as a single "apply" action:
   - `Senior_Dashboard`: THE Platform SHALL create an in-platform Application (per criteria 4–6 below) and list it in the creating Senior's applicant list (Requirement 3 AC4) as well as the Admin portal.
   - `Admin_Dashboard`: THE Platform SHALL create an in-platform Application (per criteria 4–6 below) and list it only in the Admin portal's applicant list; THE Platform SHALL NOT include it in any Senior's applicant list view.
   - `External_Careers_URL`: THE Platform SHALL NOT create an in-platform Application record and SHALL instead redirect the Candidate's browser to the Job_Description's configured external careers URL.
4. WHEN a Candidate submits an Application via the `Senior_Dashboard` or `Admin_Dashboard` channel, THE Platform SHALL record: the Candidate identity; the Job_Description identifier; the CV_Version that is `active` in the selected (or defaulted) CV_Variant at submission time; and a submission timestamp in UTC. When no explicit CV_Variant is selected, the Candidate's `primary` variant is used.
5. FOR ALL Applications, the CV_Version recorded at submission SHALL remain immutable regardless of later CV uploads or Admin re-designation.
6. THE Platform SHALL represent every in-platform Application with one status: `Submitted`, `Under Review`, `Forwarded to Recruiter`, or `Closed`.
7. IF a Candidate has a non-terminal Application (`Submitted` or `Under Review`) for a Job_Description and attempts to apply to it again, THEN THE Platform SHALL reject the second submission and inform the Candidate that they have already applied.
8. THE Platform SHALL allow re-application to the same Job_Description only when the Candidate has no non-terminal Application for it and the posting is `Open`.
9. THE Platform SHALL display to the Candidate a list of all their in-platform Applications, each showing current status, applied role title, company name, and submission date.
10. THE Platform SHALL let Admin sessions set any in-platform Application to any defined status and SHALL record each change with a timestamp and the Admin identity.
11. WHEN a Job_Description transitions to `Closed`, THE Platform SHALL transition every Application for it whose status is `Submitted` or `Under Review` to `Closed`.
12. WHEN an in-platform Application is successfully submitted, THE Platform SHALL send the Candidate an in-app confirmation immediately and an email confirmation within 5 minutes.
13. THE Platform SHALL limit a Candidate to at most 20 Application submissions per rolling 24-hour period, counting only in-platform Applications.
14. THE Platform SHALL record every Application creation and status transition in the Audit_Log (Requirement 8).

---

### Requirement 8: Audit Trail and Data Integrity

**User Story:** As an Admin, I want a complete, tamper-evident audit trail of all significant platform actions, so that I can review decisions, resolve disputes, and demonstrate accountability for candidate data handling.

#### Acceptance Criteria

1. THE Platform SHALL record an Audit_Log entry for every action that creates, modifies, or deletes a platform entity. In Phase 1 this covers at least: account registration and every `Account_Status` transition; Email_Verification state changes; Residency_Validation failures at registration and on later edits; Admin rejections made on residency grounds; role additions and removals; Admin approvals and rejections; profile creation and update; CV_Version upload, active-version designation, quarantine, and integrity-check failure; Job_Description creation, update, publish, and close; Application creation and status transitions; authorization-check failures; and Audit_Log tamper attempts.
2. EACH Audit_Log entry SHALL contain: the actor identity (or `system` for automated actions); the action performed; the affected entity type and identifier; the before and after values of every changed field for modification actions; the reason text where the action requires one; and a UTC timestamp at millisecond precision from an NTP-synchronized server clock.
3. THE Platform SHALL make Audit_Log entries append-only; IF any user, including an Admin, attempts to modify or delete an entry, THEN THE Platform SHALL reject the operation, return an error indicating the action is not permitted, and record the attempt as a new Audit_Log entry identifying the actor and the targeted entry identifier.
4. THE Platform SHALL let Admin sessions search and filter the Audit_Log by actor identity, action type, entity type, entity identifier, and date range, and SHALL paginate the results.
5. IF a multi-step operation fails partway through, THEN THE Platform SHALL roll back all partial changes so that every affected entity returns to its state prior to the operation, and SHALL record the failure as a single Audit_Log entry with no intermediate entity state persisted.
6. FOR every audited entity, applying the recorded before/after field changes from that entity's Audit_Log entries in ascending timestamp order SHALL reproduce the entity's current state. Binary file contents are out of scope for this reconstruction and are covered by the Requirement 5 checksum guarantee.
7. THE Platform SHALL retain Audit_Log entries for at least 7 years; the Candidate data-deletion path SHALL NOT delete Audit_Log entries, and SHALL only anonymize actor-linked personal data where legally required.
8. THE Platform SHALL store Audit_Log entries so that their integrity is independently verifiable (for example, per-entry hash chaining) and SHALL surface a tampering alert to Admins if verification fails.

---

### Requirement 9: Candidate Review System

**User Story:** As an Admin or Senior, I want to submit structured evaluations of candidates at any point during the recruitment process, so that a complete and timestamped history of impressions is preserved for every candidate.

#### Acceptance Criteria

1. THE Platform SHALL allow Admins and Seniors to submit a Review for any Candidate at any stage of the recruitment pipeline.
2. A Review SHALL contain: the reviewer's identity; a UTC timestamp; a structured rating expressed as an integer from 1 to 5 for each of technical ability, communication, culture fit, and overall impression; a free-text assessment of up to 2000 characters; and an optional association with a specific Job_Description.
3. WHEN a Review is submitted, THE Platform SHALL append it to the Candidate's Review_Timeline in chronological order.
4. IF a Review submission is missing any required field, THEN THE Platform SHALL reject the submission, return an error identifying each missing field, and not modify the Review_Timeline.
5. THE Platform SHALL NOT allow a submitted Review to be edited or deleted; corrections SHALL be a new Review referencing the identifier of the Review being corrected.
6. THE Platform SHALL display the Review_Timeline for a Candidate in chronological order to Admins, including all Reviews regardless of reviewer.
7. THE Platform SHALL allow Admins to filter a Candidate's Review_Timeline by reviewer identity, date range, and associated Job_Description.
8. THE Platform SHALL prevent Candidates from viewing their own Review_Timeline.
9. FOR ALL Reviews in a Candidate's Review_Timeline, the sequence of timestamps SHALL be strictly non-decreasing (append-only guarantee).
10. WHEN a Senior submits a Review, THE Platform SHALL allow that Senior to view only their own submitted Reviews for that Candidate, and SHALL NOT display Reviews by any other reviewer.

---

### Requirement 28: Administrative Reports and System Tracking

**User Story:** As an Admin, I want to generate reports summarizing platform activity and track candidate progress over time, so that I have visibility into the recruitment pipeline without manually querying individual records.

#### Acceptance Criteria

1. THE Platform SHALL provide an Admin-only reports section accessible from the Admin dashboard.
2. THE Platform SHALL allow an Admin to generate activity reports covering at least: number of CVs submitted in a given period, number of candidates registered, number of candidates rejected, number of Applications submitted, and number of Applications advanced by status.
3. WHEN an Admin generates a report, THE Platform SHALL allow filtering by date range and, where applicable, by Job_Description.
4. THE Platform SHALL display candidate progress tracking, showing each Candidate's current `Account_Status` and Application statuses across all Job_Descriptions.
5. THE Platform SHALL present report data in a summary view and allow the Admin to drill down into the underlying records.
6. THE Platform SHALL NOT expose reports or system tracking data to Candidate or Senior sessions.
7. THE Platform SHALL record every report generation action in the Audit_Log (Requirement 8) with the Admin identity and a UTC timestamp.

---

### Requirement 29: Data Export to Excel

**User Story:** As an Admin, I want to export platform data to Excel, so that I can perform offline analysis, share reports, and maintain records outside the platform.

#### Acceptance Criteria

1. THE Platform SHALL allow an Admin to export candidate data to an Excel-compatible format (.xlsx) from the candidate list view.
2. THE Platform SHALL allow an Admin to export Job_Description data to Excel from the job listings view.
3. THE Platform SHALL allow an Admin to export Application data to Excel, filterable by Job_Description and date range.
4. THE exported file SHALL include the same fields visible to the Admin in the corresponding platform view at the time of export.
5. THE Platform SHALL NOT allow Candidate or Senior sessions to export data to Excel.
6. THE Platform SHALL record every export action in the Audit_Log (Requirement 8) with the Admin identity, the entity type exported, any filters applied, and a UTC timestamp.

---

### Phase 2 Requirements (Deferred — Out of Scope)

> **The following requirements are retained for context and are not in scope for the current design/spec cycle.** They have known open issues to be resolved when Phase 2 planning begins. Cross-references from Phase 1 (e.g., notifications, transactional email) are limited to the minimal capability defined in the Cross-Cutting Constraints.

---

### Requirement 10: Job-Specific CV Tailoring

**User Story:** As a Candidate, I want targeted suggestions for adapting my CV to a specific job description, so that I can maximize my relevance for roles I care about.

#### Acceptance Criteria

1. WHEN a Candidate selects a Job_Description with a completed JD_Extraction and requests tailoring, THE Platform SHALL initiate a tailoring session using the Candidate's active CV_Version.
2. WHEN a Candidate requests tailoring, THE AI_Engine SHALL compare the active CV_Version against the JD_Extraction and generate targeted Profile_Suggestions covering identified skill gaps and terminology mismatches.
3. WHEN a tailoring session is initiated, THE AI_Engine SHALL return job-specific Profile_Suggestions within 30 seconds.
4. EACH tailoring Profile_Suggestion SHALL reference the specific JD requirement it addresses and include a rationale of at least one sentence.
5. THE Platform SHALL allow the Candidate to run tailoring for multiple Job_Descriptions independently, storing each session's Profile_Suggestions separately without overwriting other sessions' results.
6. IF a Job_Description has no completed JD_Extraction, THEN THE Platform SHALL indicate this and SHALL NOT offer tailoring for that Job_Description until extraction is complete.
7. IF the AI_Engine does not return Profile_Suggestions within 30 seconds, THEN THE Platform SHALL terminate the session and display an error, without modifying previously stored Profile_Suggestions.
8. FOR ALL tailoring sessions submitted with the same CV_Version and the same JD_Extraction, THE AI_Engine SHALL return Profile_Suggestions addressing the same set of JD requirements as a prior session on those identical inputs.

---

### Requirement 11: LinkedIn Profile Enhancement

**User Story:** As a Candidate, I want AI-generated suggestions to improve my LinkedIn profile, so that I am more visible to external recruiters and industry professionals.

#### Acceptance Criteria

1. THE Platform SHALL provide a LinkedIn enhancement feature accessible to Candidates from their profile dashboard.
2. WHEN a Candidate accesses the feature, THE Platform SHALL prompt them to either paste their LinkedIn profile text (up to 15,000 characters) or connect their LinkedIn account via OAuth; IF the OAuth connection fails, THEN THE Platform SHALL display an error and allow retry or switching to the paste method.
3. WHEN LinkedIn profile content is submitted, THE AI_Engine SHALL analyze it and produce Profile_Suggestions covering: headline, summary, experience descriptions, skills section, and profile completeness assessed as the presence or absence of each of those five sections.
4. EACH LinkedIn Profile_Suggestion SHALL specify the target section, a description of the identified gap, and a recommended replacement or addition.
5. THE Platform SHALL allow the Candidate to mark each LinkedIn Profile_Suggestion as accepted, dismissed, or saved for later, consistent with the CV improvement workflow.
6. THE Platform SHALL NOT store the Candidate's raw LinkedIn profile content after the submitting session ends, unless the Candidate explicitly consents to storage before submission.
7. IF the Candidate does not provide LinkedIn content, THEN THE Platform SHALL NOT generate LinkedIn Profile_Suggestions for that session.
8. IF the AI_Engine fails to analyze the submitted content, THEN THE Platform SHALL display an error and SHALL NOT store any partial Profile_Suggestions from that session.

---

### Requirement 12: AI-Powered CV Improvement

**User Story:** As a Candidate, I want AI-generated suggestions to improve my CV's structure and content, so that I can present myself more effectively to recruiters and increase my chances of being selected.

#### Acceptance Criteria

1. THE Platform SHALL provide a CV improvement feature accessible to Candidates from their profile dashboard.
2. WHEN a Candidate requests CV analysis, THE AI_Engine SHALL analyze the active CV_Version and generate between 1 and 20 Profile_Suggestions, each targeting at least one of: structure, clarity, completeness, or impact of content.
3. THE AI_Engine SHALL return all Profile_Suggestions within 30 seconds of the Candidate's request under normal load.
4. EACH Profile_Suggestion SHALL identify the CV section it addresses by name and include a recommended action of no fewer than 10 and no more than 300 characters.
5. THE Platform SHALL allow the Candidate to mark each Profile_Suggestion with exactly one of: accepted, dismissed, or saved for later.
6. THE Platform SHALL retain all Profile_Suggestions and their Candidate-assigned statuses for the duration of the Candidate's account.
7. IF the Candidate has no uploaded CV_Version, THEN THE Platform SHALL display a prompt directing the Candidate to upload a CV before the feature becomes accessible.
8. THE Platform SHALL NOT modify the Candidate's stored CV or CV_Version without the Candidate's explicit action.
9. IF the AI_Engine fails to return Profile_Suggestions within 30 seconds or encounters an error, THEN THE Platform SHALL display an error message and allow the Candidate to retry without data loss.
10. IF CV analysis is requested and Profile_Suggestions already exist for the current active CV_Version, THEN THE Platform SHALL display the existing Profile_Suggestions with their generation timestamp, without triggering a new analysis.

---

### Requirement 13: Job-Specific Candidate Notes

**User Story:** As an Admin or Senior, I want to add notes specific to a candidate's application for a particular role, so that contextual observations are captured and available during the recruiter handoff.

#### Acceptance Criteria

1. THE Platform SHALL allow Admins and Seniors to create a Candidate_Note associated with a specific Candidate and a specific Job_Description.
2. A Candidate_Note SHALL contain: the author's identity, a creation timestamp, a last-modified timestamp, and free-text content of up to 2000 characters.
3. THE Platform SHALL allow the author of a Candidate_Note to edit its content, updating the last-modified timestamp on each edit.
4. IF a Candidate_Note edit results in empty or blank content, THEN THE Platform SHALL reject the edit and return an error indicating that note content cannot be empty.
5. THE Platform SHALL retain the full edit history of each Candidate_Note as a snapshot of the content before each edit together with the timestamp of that edit.
6. THE Platform SHALL allow Admins to view all Candidate_Notes for a Candidate across all Job_Descriptions.
7. THE Platform SHALL allow Seniors to view only Candidate_Notes they authored.
8. THE Platform SHALL prevent Candidates from viewing any Candidate_Notes associated with their profile.
9. IF a Job_Description is closed, THEN THE Platform SHALL retain all associated Candidate_Notes in read-only state, preventing edits by any user including the original author, and SHALL allow Admins and the authoring Senior to continue viewing them.

---

### Requirement 14: Automated JD Extraction

**User Story:** As an Admin, I want the platform to automatically extract structured requirements from job descriptions, so that candidate scoring and matching can be performed consistently without manual tagging.

#### Acceptance Criteria

1. WHEN a Job_Description is created or updated, THE AI_Engine SHALL initiate JD_Extraction on the description field within 10 seconds of the create or update event being persisted.
2. WHEN JD_Extraction is initiated, THE AI_Engine SHALL produce a JD_Extraction containing: a non-empty list of required technical skills; a list of preferred skills (which may be empty); a minimum experience level expressed as a whole number of years between 0 and 50 inclusive; and a non-empty set of domain keywords.
3. WHEN JD_Extraction is complete, THE Platform SHALL store the result linked to the specific Job_Description and record the extraction timestamp.
4. THE Platform SHALL allow Admins to view, edit, and override any content field in a JD_Extraction (required technical skills, preferred skills, minimum experience level, domain keywords). System-managed fields (extraction timestamp, linked Job_Description identifier, audit records) SHALL NOT be editable.
5. IF JD_Extraction does not complete within 30 seconds of initiation, or terminates with an error, THEN THE Platform SHALL notify the Job_Description's creator and a designated Admin in-platform, log the failure with the Job_Description identifier and reason, and present a form for manual entry of all JD_Extraction content fields.
6. WHEN an Admin edits a JD_Extraction, THE Platform SHALL record the change with the Admin's identity and a timestamp, preserving the prior extraction result.
7. THE AI_Engine SHALL ensure that each term in the required technical skills and domain keywords fields either appears verbatim in the associated description field, or is a recognised abbreviation or industry-standard synonym of a term that appears verbatim in that field.

> **Open issue (Phase 2):** the structured JD fields in Requirement 6 (required skills, experience level) overlap with JD_Extraction output, and experience is an enum on the JD but a year count here. Reconcile before implementation.

---

### Requirement 15: Recruiter Handoff Workflow

**User Story:** As an Admin, I want to compile a candidate's complete profile, reviews, and notes into a Recruiter_Package and send it to an external recruiter, so that the recruiter receives everything needed to evaluate the candidate without additional back-and-forth.

#### Acceptance Criteria

1. THE Platform SHALL allow an Admin to initiate a Recruiter_Package for a specific Candidate and a specific Job_Description.
2. THE Platform SHALL automatically populate the Recruiter_Package with: the CV_Version recorded on the Candidate's Application for the selected Job_Description if an Application exists, otherwise the Candidate's active CV_Version; the Candidate's profile; the full Review_Timeline for that Candidate; all Candidate_Notes for that Candidate linked to the selected Job_Description; and the Candidate_Score for the Job_Description.
3. THE Platform SHALL allow the Admin to edit the contents of the Recruiter_Package before sending, including removing or annotating individual Reviews or Notes, without modifying the auto-populated version recorded at initiation.
4. WHEN an Admin edits the Recruiter_Package, THE Platform SHALL record each edit with a timestamp and the Admin's identity, and SHALL preserve the original auto-populated version as a separate read-only snapshot.
5. THE Platform SHALL allow the Admin to preview the Recruiter_Package before sending, rendered in the delivery format.
6. WHEN the Admin confirms sending, THE Platform SHALL deliver the Recruiter_Package to the Recruiter's email address associated with the Job_Description and record the delivery with a timestamp and the Admin's identity.
7. IF delivery fails, THEN THE Platform SHALL notify the Admin with an error and the Recruiter_Package SHALL remain in an unsent state.
8. THE Platform SHALL retain a read-only archived copy of each sent Recruiter_Package indefinitely.
9. IF the Recruiter's email address is not set for a Job_Description, THEN THE Platform SHALL require the Admin to enter a valid address before allowing the send action.
10. WHEN an Admin triggers a resend, THE Platform SHALL deliver the archived copy to the Recruiter's current email address and record the resend as a separate delivery event with a timestamp and the Admin's identity.

---

### Requirement 16: In-App Chat Between Seniors and Candidates

**User Story:** As a Candidate, I want to message senior professionals on the platform, so that I can ask for career guidance, referrals, and advice from people with industry experience.

#### Acceptance Criteria

1. THE Platform SHALL provide an in-app Chat feature allowing direct messaging between a Candidate and a Senior.
2. WHEN a Candidate initiates a Chat with a Senior, THE Platform SHALL create a Chat session if one does not exist, or open the existing session.
3. WHEN a Senior opts in to receiving chat requests and a Candidate initiates contact, THE Platform SHALL notify the Senior of the new Chat session.
4. WHEN a Chat_Message is sent, THE Platform SHALL store: sender identity, recipient identity, message content (up to 2000 characters), and a UTC send timestamp.
5. WHEN the recipient is online, THE Platform SHALL deliver a sent Chat_Message within 5 seconds; WHEN the recipient is offline, THE Platform SHALL queue the message for delivery on next login, retaining it for up to 30 days before expiry.
6. THE Platform SHALL allow a Senior to optionally reveal their professional email address within a Chat_Message, displayed as a clickable link to the Candidate.
7. THE Platform SHALL allow Admins to view Chat_Message histories for compliance and moderation.
8. THE Platform SHALL prevent Candidates from initiating Chat sessions with other Candidates.
9. IF a user's account is deactivated, THEN THE Platform SHALL preserve all prior Chat_Message history in read-only form and prevent new messages on that account.

---

### Requirement 17: Email Synchronization with Admin Mailbox

**User Story:** As an Admin, I want the platform to synchronize with the core admin email inbox, so that all candidate-related correspondence is logged centrally and no communication is lost.

#### Acceptance Criteria

1. THE Platform SHALL integrate with a designated admin email account via IMAP/SMTP or a supported email API to send and receive email on behalf of the Platform.
2. WHEN an outbound email is triggered by the Platform, THE Platform SHALL log the email with: recipient address, subject line, UTC timestamp, and delivery status (sent, delivered, or failed).
3. WHEN an inbound email is received on the synchronized mailbox, THE Platform SHALL attempt to associate it with a Candidate or Job_Description by matching the sender address against registered Candidate emails and by matching any reference identifier in the subject or body.
4. WHEN an inbound email is successfully associated, THE Platform SHALL append it to that record's communication log within 60 seconds of receipt.
5. THE Platform SHALL display the synchronized email log to Admins in an interface searchable by sender address, recipient address, subject line, and date range.
6. IF an inbound email cannot be associated with an existing record, THEN THE Platform SHALL log it as unmatched and notify the designated Admin for manual review.
7. THE Platform SHALL NOT expose admin email credentials or mailbox content to Candidates or Seniors.
8. THE Platform SHALL allow Admins to compose and send emails directly from the Platform interface using the synchronized account.

---

### Requirement 18: WhatsApp Integration

**User Story:** As an Admin, I want the platform to integrate with WhatsApp for candidate communications, so that I can reach candidates through their preferred messaging channel and log those interactions centrally.

#### Acceptance Criteria

1. THE Platform SHALL integrate with a WhatsApp Business API account to send and receive WhatsApp messages on behalf of the Platform.
2. THE Platform SHALL allow Admins to send WhatsApp messages to Candidates directly from the Platform interface, using the Candidate's registered phone number.
3. WHEN an outbound WhatsApp message is sent, THE Platform SHALL log: recipient phone number, message content, UTC timestamp, and delivery status (sent, delivered, read, or failed).
4. WHEN an inbound WhatsApp message is received, THE Platform SHALL match it to the corresponding Candidate record by the sender's phone number and append it to that Candidate's communication log.
5. IF an inbound WhatsApp message is received from a phone number not registered to any Candidate, THEN THE Platform SHALL log it as unmatched and notify the designated Admin for manual review.
6. THE Platform SHALL display the WhatsApp communication log for a Candidate to Admins within the Candidate's profile view.
7. IF a WhatsApp message delivery fails, THEN THE Platform SHALL log the failure with an error reason and notify the sending Admin.
8. THE Platform SHALL NOT expose WhatsApp API credentials or integration configuration to Candidates or Seniors.
9. THE Platform SHALL support sending pre-approved templated alert messages (e.g., application status updates, interview reminders) to Candidates via WhatsApp.

---

### Requirement 19: Notifications and Alerts

**User Story:** As a user, I want to receive timely in-platform and channel-specific notifications about actions relevant to me, so that I stay informed without polling the platform manually.

#### Acceptance Criteria

1. WHEN a Candidate's Application status changes, a new Job_Description matching the Candidate's top skills is posted, a Chat_Message is received by the Candidate, or a CV improvement analysis completes, THE Platform SHALL write an in-platform notification to that Candidate's queue within 10 seconds of the triggering event.
2. WHEN a new Candidate registers, a Candidate submits an Application, a JD_Extraction fails, or an inbound email is logged as unmatched, THE Platform SHALL write an in-platform notification to the Admin's queue within 10 seconds.
3. WHEN a Candidate applies to a Job_Description posted by a Senior, or a Chat_Message is received by a Senior, THE Platform SHALL write an in-platform notification to that Senior's queue within 10 seconds.
4. WHEN a notification is written, THE Platform SHALL record: the recipient identity, the notification type, the identifier of the associated entity, and a UTC timestamp with millisecond precision.
5. THE Platform SHALL allow users to mark individual notifications as read and to permanently delete all notifications in their list in a single operation.
6. WHEN a notification is marked as read, THE Platform SHALL update its state within 2 seconds and SHALL NOT revert it to unread unless a new triggering event of the same type for the same entity occurs.
7. THE Platform SHALL allow Admins to configure which notification types are delivered via in-platform UI, email, or WhatsApp for each user role.
8. IF no channel configuration has been set for a user role, THEN THE Platform SHALL deliver notifications for that role exclusively via the in-platform UI.

---

### Requirement 20: Candidate Scoring and Ranking

**User Story:** As an Admin, I want each candidate to receive an automatic match score for each job description, so that I can quickly identify the most suitable candidates for a role without manually reviewing every profile.

#### Acceptance Criteria

1. WHEN a JD_Extraction is created or updated for a Job_Description, THE AI_Engine SHALL compute a Candidate_Score for every Candidate whose profile is `Complete` and who has at least one CV_Version.
2. WHEN a Candidate updates their profile or uploads a new CV_Version, THE AI_Engine SHALL recompute that Candidate's Candidate_Score for all Job_Descriptions whose status is not `Closed`.
3. THE Candidate_Score SHALL be a numeric value on a scale of 0 to 100, computed from the degree of match between the Candidate's skills, years of experience, and education level (from structured CV data, Requirement 21) and the corresponding JD_Extraction fields.
4. WHEN an Admin views the candidate list for a specific Job_Description, THE Platform SHALL display Candidates ranked by Candidate_Score in descending order.
5. WHEN an Admin views a Candidate_Score, THE Platform SHALL expose the contributing factors: matched skills, missing skills, and experience gap (difference in whole years between the years required by the JD_Extraction and the years in the Candidate's structured CV data).
6. THE Platform SHALL NOT expose raw Candidate_Scores or rankings to Candidates.
7. IF a Candidate's profile is not `Complete` or has no CV_Version, THEN THE AI_Engine SHALL NOT compute a Candidate_Score and THE Platform SHALL display an "incomplete profile" indicator for that Candidate in the ranking view.
8. THE AI_Engine SHALL assign a Candidate_Score greater than or equal to the score of any other Candidate scored against the same Job_Description whose skill set is a strict subset of the first Candidate's skills.
9. IF THE AI_Engine fails to compute a Candidate_Score for one or more Candidates during a scoring run, THEN THE Platform SHALL retain the most recently computed score for each affected Candidate, mark it stale, and display an error to Admins identifying which Candidates could not be rescored.

---

### Requirement 21: Structured CV Data Extraction *(Phase 2 prerequisite for Requirement 20)*

**User Story:** As an Admin, I want the platform to derive structured data (skills, years of experience, education level) from an uploaded CV, so that Candidate scoring and tailoring have consistent inputs.

#### Acceptance Criteria

1. WHEN a new CV_Version becomes `active`, THE AI_Engine SHALL extract structured data from it: a list of skills mapped to the Skill_Taxonomy, total years of professional experience as a whole number, and the highest education level.
2. WHEN structured CV data extraction completes, THE Platform SHALL store the result linked to the specific CV_Version and record the extraction timestamp.
3. THE Platform SHALL allow the Candidate to review and correct extracted skills and years of experience for their own active CV_Version, and SHALL record corrections with a timestamp.
4. IF extraction fails or does not complete within 30 seconds, THEN THE Platform SHALL fall back to the Candidate's profile fields for scoring and notify an Admin.
5. THE Platform SHALL define "complete profile" for scoring purposes (Requirement 20) as: profile `Complete` per Requirement 4 AC6 and at least one CV_Version with either successful structured extraction or Candidate-confirmed fields.

---

### Requirement 22: Company- and Job-Specific Interview Preparation Tips *(Phase 2)*

**User Story:** As a Candidate, I want the platform to provide preparation tips tailored to a specific company and/or job position, so that I can focus my interview preparation on the areas that matter most for that role.

#### Acceptance Criteria

1. THE Platform SHALL provide a preparation tips feature accessible to Candidates from a Job_Description detail view.
2. WHEN a Candidate requests tips for a specific Job_Description, THE Platform SHALL return tips relevant to the company named in that Job_Description and/or the role's requirements.
3. Tips SHALL cover subjects, requirements, or areas that the company is known to emphasize during interviews.
4. IF no tips are available for a given company or position, THE Platform SHALL display an appropriate empty-state message.
5. THE Platform SHALL NOT expose preparation tips to unauthenticated visitors.

---

### Requirement 23: Automatic Job Collection from the Market *(Phase 2)*

**User Story:** As an Admin, I want the platform to automatically discover and collect new job opportunities from the market, so that the job listings stay current without requiring manual entry for every new posting.

#### Acceptance Criteria

1. THE Platform SHALL provide an automated job collection feature that identifies new job opportunities from configured external sources.
2. WHEN a new job opportunity is collected, THE Platform SHALL create a Job_Description in `Draft` status using a predefined template, populated with the data available from the source.
3. THE Platform SHALL NOT publish a collected Job_Description automatically; an Admin or Senior SHALL review and explicitly publish it.
4. THE Platform SHALL allow an Admin to configure which external sources are monitored for job collection.
5. WHEN a collected job fails to map to the predefined template (e.g., missing required fields), THE Platform SHALL flag it for Admin review rather than creating an incomplete record.
6. THE Platform SHALL record every automatically collected Job_Description in the Audit_Log (Requirement 8) with a `system` actor identity and a UTC timestamp.

---

### Requirement 24: Recorded Mock Interviews and Tips Service *(Phase 2)*

**User Story:** As a Candidate, I want to watch pre-recorded mock interviews and access categorized tips, so that I can prepare effectively for real interviews at my own pace.

#### Acceptance Criteria

1. THE Platform SHALL provide a library of pre-recorded mock interview videos created by HasoubLabs, accessible to Candidates.
2. Access to mock interview videos SHALL require payment of a nominal fee; THE Platform SHALL gate video playback behind a successful payment confirmation.
3. THE Platform SHALL provide a separate tips service containing general and/or role-specific tips organized by category (e.g., by field, experience level, or company type).
4. WHEN a Candidate selects a tips category, THE Platform SHALL display the tips available for that category.
5. THE Platform SHALL allow Admins to manage (add, edit, remove) mock interview videos and tips content.
6. THE Platform SHALL NOT expose mock interview videos or paywalled content to unauthenticated visitors.
7. IF a Candidate has not completed payment for a video, THE Platform SHALL display a preview or description and a payment prompt, without revealing the full content.

---

### Requirement 25: High-Tech Industry News Feed *(Phase 2)*

**User Story:** As a Candidate, I want to see current news from the high-tech industry on the platform, so that I can stay informed about the market while managing my job search.

#### Acceptance Criteria

1. THE Platform SHALL provide a news feed feature displaying current and relevant news from the high-tech industry and job market.
2. THE Platform SHALL surface the most recent and relevant news items at the top of the feed.
3. THE Platform SHALL allow Admins to configure the news sources or content rules used to populate the feed.
4. WHEN a Candidate clicks a news item, THE Platform SHALL open the full article or redirect to the original source.
5. THE Platform SHALL NOT expose the news feed to unauthenticated visitors.
6. THE Platform SHALL refresh news feed content at regular intervals, with the interval configurable by an Admin.

---

### Requirement 26: AI-Based Interview Simulation *(Phase 2)*

**User Story:** As a Candidate, I want to participate in an AI-driven mock interview simulation and receive feedback on my answers, so that I can practice and improve my interview performance before real interviews.

#### Acceptance Criteria

1. THE Platform SHALL provide an AI-based interview simulation feature accessible to Candidates.
2. THE AI simulation SHALL conduct a realistic interview by presenting questions to the Candidate, either through a visual AI-generated character displayed on screen or through voice with a static image.
3. WHEN a Candidate starts a simulation session, THE Platform SHALL allow them to select a focus area (e.g., role type, company, or skill domain) to tailor the questions.
4. WHEN a Candidate completes a simulation session, THE AI_Engine SHALL generate feedback covering the quality of the Candidate's answers, communication style, and areas for improvement.
5. THE Platform SHALL present the feedback to the Candidate after the session ends.
6. THE Platform SHALL retain completed simulation session results and feedback for the duration of the Candidate's account.
7. THE Platform SHALL NOT expose a Candidate's simulation sessions or feedback to any other Candidate or Senior session.
8. IF the AI_Engine fails to generate feedback after a completed session, THE Platform SHALL notify the Candidate and allow them to retry feedback generation without repeating the interview.

---

### Requirement 27: Community and Interest Groups *(Phase 2)*

**User Story:** As a Candidate, I want to join open group chats organized by field or area of interest, so that I can connect with peers, share experiences, and ask questions relevant to my background.

#### Acceptance Criteria

1. THE Platform SHALL provide a community feature with open group chats organized by predefined categories (e.g., Students, Juniors, Seniors, Hardware, Software).
2. WHEN a Candidate joins a group, THE Platform SHALL allow them to send and receive messages within that group.
3. THE Platform SHALL allow a Candidate to be a member of multiple groups simultaneously.
4. WHEN a message is sent in a group, THE Platform SHALL deliver it to all current members of that group.
5. THE Platform SHALL store group messages with: sender identity, message content (up to 2000 characters), group identifier, and a UTC send timestamp.
6. THE Platform SHALL allow Admins to create, rename, and archive group categories.
7. THE Platform SHALL allow Admins to moderate group messages, including removing messages that violate platform rules.
8. THE Platform SHALL NOT expose group chat content to unauthenticated visitors.
9. THE Platform SHALL prevent a Candidate from sending messages in a group they have not joined.
10. IF a user's account is `Suspended` or `Deactivated`, THE Platform SHALL prevent them from sending new messages and preserve their prior message history in read-only form.

---

## Cross-Cutting Constraints

### Data Retention

* Candidate data (profiles, CVs, applications; and in Phase 2 reviews, notes, messages) SHALL be retained for a minimum of 5 years after the Candidate's last activity, unless the Candidate explicitly requests deletion and applicable law permits it.
* Audit_Log entries SHALL be retained for at least 7 years and are exempt from the Candidate deletion path (personal data is anonymized in place where legally required).
* Recruiter_Package archives *(Phase 2)* SHALL be retained indefinitely.
* A Candidate data-deletion request SHALL be actioned by an Admin, recorded in the Audit_Log, and SHALL anonymize rather than hard-delete records that are referenced by retained Audit_Log entries.

### Performance

* WHILE the platform is under normal operating load (up to 500 concurrent users), THE Platform SHALL respond to any user-initiated read or write request within 3 seconds.
* THE AI_Engine *(Phase 2)* SHALL complete CV analysis, tailoring, JD extraction, and structured CV extraction within 30 seconds under normal operating conditions. This 30-second budget is authoritative; individual Phase 2 requirements SHALL NOT specify a different timeout.

### Availability

* THE Platform SHALL maintain availability of at least 99.5% measured monthly, excluding scheduled maintenance windows communicated at least 24 hours in advance.

### Localization

* THE Platform SHALL support Arabic, English, and Hebrew in the user interface, with the language preference set per user account.
* WHEN content is submitted in Arabic or Hebrew, THE Platform SHALL store and display it without transliteration or modification.
* *(Phase 2)* THE AI_Engine SHALL accept CV and Job_Description content in Arabic, English, or Hebrew and SHALL produce suggestions in the language of the source content unless the user selects otherwise.

### Security

* THE Platform SHALL enforce HTTPS for all communications between clients and the platform.
* THE Platform SHALL require passwords of at least 10 characters, screen them against a known-breached-password list, impose no maximum length below 64, and store them using a salted algorithm at a minimum of bcrypt cost factor 12 or equivalent.
* THE Platform SHALL require Verification_Code confirmation (email ownership) before an account can leave `PendingVerification`.
* THE Platform SHALL offer multi-factor authentication for all accounts and SHALL require it for Admin accounts in production.
* THE Platform SHALL enforce session expiration after 30 minutes of inactivity.
* THE Platform SHALL rate-limit login attempts (per source and per account), registration submissions, CV uploads, and Application submissions, and SHALL lock an account after repeated failed logins pending user-initiated recovery.
* THE Platform SHALL encrypt at rest: national ID numbers, residency-proof documents, and CV files.
* THE Platform SHALL provide transactional outbound email (provider API or SMTP) for Verification_Codes, rejection notices, and Application confirmations in Phase 1. Full mailbox synchronization is Requirement 17 (Phase 2).
* *(Phase 2)* THE Platform SHALL disclose to Candidates and Seniors that CV and Job_Description content is transmitted to a third-party AI provider for analysis, and SHALL obtain consent before first use of an AI feature.

### Accessibility

* THE Platform SHALL be accessible and fully usable on mobile phones via a responsive web interface, supporting both portrait and landscape orientations.
* All core features available on desktop SHALL be available on mobile, with a layout adapted to smaller screen sizes.

### Phase 1 Notifications (Minimal)

Until Requirement 19 is delivered, the Platform SHALL support in-app notifications plus email for exactly these events:

* Registration submitted → email the Verification_Code to the registrant.
* Verification_Code confirmed (account reached `PendingApproval`) → notify Admins that a new registration is awaiting review.
* Admin approves a `PendingApproval` account (account reaches `ApprovedPendingMeeting`) → notify Admins to arrange the onboarding meeting.
* Account moved to `Approved` or `Rejected` → notify the user (rejection includes the reason).
* In-platform Application submitted → notify the Candidate (in-app immediate, email within 5 minutes).
* In-platform Application status changed → notify the Candidate.
* CV quarantined or CV integrity-check failed → notify the Candidate and an Admin.

---

## Correctness Properties for Testing

The following properties are amenable to property-based testing.

### Phase 1

#### Account Lifecycle (Requirement 1)

* **Single status invariant**: At every point in time, an account has exactly one `Account_Status`, drawn from `PendingVerification`, `PendingApproval`, `ApprovedPendingMeeting`, `Approved`, `Rejected`, `Suspended`, `Deactivated`.
* **No access before Approved**: For any account not in `Approved`, every request to a non-onboarding endpoint is denied.
* **Admin review gate**: Every account that reaches `ApprovedPendingMeeting` or `Approved` has a preceding Admin approval event recorded while the account was in `PendingApproval`.
* **Meeting gate**: Every account that reaches `Approved` via `ApprovedPendingMeeting` has an Admin-recorded meeting-completion event preceding that transition; an account fast-tracked directly from `PendingApproval` to `Approved` instead has an Admin-recorded fast-track decision noting the meeting already occurred.
* **Admin exclusivity**: No account simultaneously holds Admin and (Candidate or Senior).

#### Geographic Verification (Requirement 2)

* **Validation precondition**: No account is ever created, and no Residency_Proof field is ever saved, without first passing Residency_Validation for at least one Residency_Proof; there is no persisted state in which an account holds a Residency_Proof that failed validation.
* **Gate invariant**: Any account granted feature access has an Email_Verification record in `Verified`.
* **Code precondition**: No account leaves `PendingVerification` without a confirmed Verification_Code.
* **Expiry release**: Any Verification_Code unconfirmed 72 hours after issue leaves its account non-`Approved` and its email address re-registrable.
* **Rejection completeness**: Every Admin rejection (including one made on residency grounds) has a non-empty reason of ≥10 characters, an actor, and a timestamp (Requirement 1 AC20).

#### CV Version Control (Requirement 5)

* **Monotonic version numbers**: For all Candidates and all CV_Variants, each successive CV_Version's number within a variant is strictly greater than all prior numbers in that same variant. ∀ v₁, v₂ ∈ CV_Versions(candidate, variant): upload_time(v₁) < upload_time(v₂) → version_number(v₁) < version_number(v₂). Version numbers across different variants of the same Candidate are independent.
* **Upload integrity round-trip**: For any CV file uploaded, the file retrieved is byte-for-byte identical. retrieve(store(file)) == file
* **Version count invariant**: After N successful uploads to a given CV_Variant, the number of stored CV_Versions for that Candidate in that variant equals N.
* **Exactly one active per variant**: For any CV_Variant with ≥1 CV_Version, exactly one CV_Version in that variant is `active`.
* **Exactly one primary variant**: For any Candidate with ≥1 CV_Variant, exactly one CV_Variant is `primary`.
* **Variant count bounds**: For any Candidate, the number of CV_Variants is in [1, 5].
* **Application CV snapshot**: The CV_Version recorded on an Application is the `active` version of the selected (or defaulted) CV_Variant at submission time, and never changes thereafter.

#### Job Description (Requirement 6)

* **Status monotonicity**: A Job_Description never transitions out of `Closed`.
* **Closed rejects applications**: No Application is created for a Job_Description in `Closed`.

#### Application (Requirement 7)

* **Idempotent application**: For a given Candidate + Job_Description pair, at most one non-terminal Application exists at any time. submit(c, jd); submit(c, jd) → count(non_terminal_applications(c, jd)) == 1
* **CV snapshot immutability**: The CV_Version recorded on an Application never changes after submission.
* **Close cascade**: After a Job_Description transitions to `Closed`, no Application for it remains in `Submitted` or `Under Review`.
* **Application-Ready gate**: Every successfully submitted Application belongs to a Candidate who was `Application-Ready` at submission time.

#### Audit Log (Requirement 8)

* **Completeness**: For every entity modification, the Audit_Log contains at least one entry referencing that entity and that modification type.
* **Immutability / append-only**: Reading the Audit_Log at T₂ > T₁ returns all entries present at T₁ plus any new entries; no entry present at T₁ is absent at T₂.
* **State reconstruction**: Applying an entity's recorded field-level changes in ascending timestamp order reproduces its current state (binary file contents excluded).
* **Transaction atomicity**: For any failed multi-step operation, no affected entity retains an intermediate state, and exactly one failure entry is recorded.

#### Review Timeline (Requirement 9)

* **Append-only ordering**: ∀ r₁, r₂ ∈ timeline: index(r₁) < index(r₂) → timestamp(r₁) ≤ timestamp(r₂)
* **Count invariant after append**: After submitting N Reviews for a Candidate, len(review_timeline(candidate)) == N.

### Phase 2 (deferred)

#### Candidate Scoring (Requirements 20, 21)

* **Monotone skill superset**: For any two Candidates A and B scored against the same Job_Description, if skills(A) ⊇ skills(B) then score(A, JD) ≥ score(B, JD).
* **Score range invariant**: For all computed Candidate_Scores, the value is in [0, 100].
* **Score determinism**: Running the scoring algorithm twice with the same Candidate structured data and JD_Extraction produces the same score.

#### JD Extraction Round-Trip (Requirement 14)

* **Keyword containment**: For all keywords in a completed JD_Extraction, each keyword appears in or is semantically derivable from the source Job_Description text.
* **Idempotent application**: For a given Candidate + Job_Description pair, at most one non-terminal Application exists at any time. submit(c, jd); submit(c, jd) → count(non_terminal_applications(c, jd)) == 1
* **CV snapshot immutability**: The CV_Version recorded on an Application (from whichever CV_Variant was selected at submission) never changes after submission.