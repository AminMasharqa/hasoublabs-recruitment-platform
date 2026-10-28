/**
 * The multi-factor slice: the login code step, Admin enrolment and verification,
 * and the account screen that reports the enrolment state (Requirement 5).
 *
 * | criterion | where |
 * | --- | --- |
 * | AC1, AC2, AC3 the 6-digit code step that resubmits the login | {@link MfaCodeStep}, `mfaChallenge.ts` |
 * | AC4, AC5 enrolment: `qr_code_png_b64` and `provisioning_uri` with a text alternative | {@link MfaEnrolmentPanel} |
 * | AC6 the verification control | {@link MfaEnrolmentPanel} |
 * | AC7 the enrolment indicator on the account screen | {@link AccountScreen} |
 *
 * The code step is rendered by the auth slice's login screen, which continues from
 * the `mfa-required` outcome its own classifier produces; the account screen is
 * registered on the already-declared `/account` route through the `elements` table
 * in `shell/screenElements.tsx`. This slice therefore imports nothing from the
 * router tree and decides nothing about access.
 */

export { AccountScreen } from './AccountScreen'
export { MfaCodeStep, type MfaCodeStepProps } from './MfaCodeStep'
export { MfaEnrolmentPanel, type MfaEnrolmentPanelProps } from './MfaEnrolmentPanel'
export {
  classifyMfaSubmission,
  EMPTY_MFA_CODE_VALUES,
  isSubmittableMfaCode,
  MFA_CODE_INPUT_ID,
  MFA_CODE_INPUTS,
  MFA_CODE_LENGTH,
  MFA_CODE_PATH,
  MFA_CODE_REFUSED_ERROR_KEYS,
  MFA_INVALID_CODE_ERROR_KEY,
  MFA_LOGIN_CONTRACT_PATH,
  mfaLoginRequestBody,
  retainsCodeStep,
  sanitizeMfaCodeInput,
  validateMfaCodeValues,
  type MfaCodeValues,
  type MfaSubmissionOutcome,
} from './mfaChallenge'
export {
  ADMIN_ACCOUNTS_PATH,
  findOwnAccount,
  isVerifiedOutcome,
  MFA_ENROLL_PATH,
  MFA_QUERY_SCOPE,
  MFA_VERIFIED_MEMBER,
  MFA_VERIFY_PATH,
  OWN_ACCOUNT_MAX_PAGES,
  ownAccountQueryKey,
  qrCodeImageSource,
  startMfaEnrolment,
  verifyMfaCode,
  type Account,
  type MfaEnrolment,
} from './mfaEnrolment'
