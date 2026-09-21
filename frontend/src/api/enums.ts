/**
 * Enumerated value sets, derived from the generated Backend_Api contract
 * (Requirement 2 AC3, AC7).
 *
 * Every union below is a projection of `components['schemas'][...]` from
 * `./generated/schema`. Nothing here is hand-typed: if the Backend_Api renames,
 * adds or drops a member, the change lands in the regenerated declarations and
 * every consumer that assumed the old set fails the typecheck. Writing the
 * members out again — even "temporarily" — reintroduces exactly the silent drift
 * the requirement exists to prevent, so don't.
 *
 * Types only, deliberately. TypeScript cannot materialize a runtime array from a
 * union type, so any `readonly T[]` of members would have to restate them by
 * hand. Where a runtime set is genuinely needed (select options, membership
 * tests) `src/forms/validators.ts` builds it with `enumValues<T>()`, whose
 * `Record<T, true>` argument forces exhaustiveness against the union imported
 * from here — so the members are listed in exactly one place and the compiler
 * checks that list against the contract.
 *
 * Naming follows the Backend_Api schema names rather than the domain vocabulary
 * of the requirements (`JdStatus`, not `Job_Description_Status`) so the mapping
 * back to the generated declarations stays mechanical.
 */

import type { components } from './generated/schema'

type Schemas = components['schemas']

// ── Identity, roles and account lifecycle (Req 1, Req 4, Req 7, Req 16) ───────

/** The three platform roles. */
export type Role = Schemas['Role']

/** The single lifecycle state an account holds at all times. */
export type AccountStatus = Schemas['AccountStatus']

/** The kind of residency proof collected at registration. */
export type ResidencyProofType = Schemas['ResidencyProofType']

// ── Candidate profile (Req 9) ─────────────────────────────────────────────────

/** Education-entry enrolment status. */
export type EnrolmentStatus = Schemas['EnrolmentStatus']

/** Candidate profile completeness classification. */
export type ProfileState = Schemas['ProfileState']

// ── Senior profile and contact preferences (Req 10) ───────────────────────────

/** How, if at all, a Senior may be contacted about jobs. */
export type ContactChannelPref = Schemas['ContactChannelPref']

/** Which Job_Descriptions a Senior is contactable for. */
export type ContactScopePref = Schemas['ContactScopePref']

// ── CV versions (Req 11) ──────────────────────────────────────────────────────

/** Availability state of a stored CV version. */
export type CvVersionState = Schemas['CvVersionState']

// ── Job_Descriptions (Req 12, Req 13) ─────────────────────────────────────────

/** One-way Job_Description lifecycle status. */
export type JdStatus = Schemas['JdStatus']

/** Job_Description work model. */
export type WorkModel = Schemas['WorkModel']

/** Job_Description employment type. */
export type EmploymentType = Schemas['EmploymentType']

/** Job_Description experience band. */
export type ExperienceLevel = Schemas['ExperienceLevel']

/** Routing configured on a Job_Description for applications. */
export type ApplicationChannel = Schemas['ApplicationChannel']

// ── Applications (Req 14) ─────────────────────────────────────────────────────

/** Status of an in-platform Application. */
export type ApplicationStatus = Schemas['ApplicationStatus']
