/**
 * The auth feature slice: the login screen and its session wiring
 * (Requirement 4 AC1, AC2, AC7, AC12).
 *
 * The screen is registered on the already-declared `/login` route through the
 * `elements` table `routing/routes.tsx` accepts, keyed by the `login` path id. This
 * slice therefore imports nothing from the router tree and decides nothing about
 * access: `/login` is one of the three paths reachable without an Access_Token
 * (`PUBLIC_ROUTE_PATH_IDS`), so no guard stands above it.
 *
 * The multi-factor code step and Admin enrolment are task 14.2 and live in
 * `features/mfa`; the seam they continue from is
 * {@link classifyLoginFailure}'s `mfa-required` outcome.
 */

export { LoginScreen } from './LoginScreen'
export {
  classifyLoginFailure,
  isLoginRejection,
  LOGIN_CONTRACT_PATH,
  LOGIN_MFA_REQUIRED,
  LOGIN_REJECTED,
  loginRequestBody,
  MFA_REQUIRED_ERROR_KEY,
  NON_DISCLOSING_LOGIN_STATUSES,
  type LoginCredentials,
  type LoginOutcome,
} from './loginOutcome'
export {
  EMPTY_LOGIN_VALUES,
  fieldViolationCatalogueKey,
  issueMessage,
  LOGIN_INPUT_ID_PREFIX,
  LOGIN_INPUTS,
  LOGIN_ROLES,
  loginRole,
  validateLoginValues,
  validationCatalogueKey,
  type LoginFormValues,
  type RenderableIssue,
  type Translate,
} from './loginForm'
