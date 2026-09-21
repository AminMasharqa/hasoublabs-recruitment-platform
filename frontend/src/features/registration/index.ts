/**
 * The registration feature slice (Requirement 6).
 *
 * Task 15.1 covers the Registration_Link validation and the role-fixed form. The
 * screen is registered on the already-declared public `/register/:token` route
 * through the shell's screen table, keyed by the `register` path id; nothing here
 * imports the router's route tree or decides anything about access — the route
 * carries no guard because Requirement 6 AC1 requires it to be reachable without
 * a session.
 *
 * Task 15.2 adds the Verification_Code entry screen on the already-declared
 * public `/verify` route, keyed by the `verification` path id. It reads the
 * account identifier this slice hands it through {@link registrationHandoffFrom},
 * so the two halves of the navigation agree on one shape defined in
 * `verificationHandoff.ts`.
 */

export { RegistrationScreen } from './RegistrationScreen'
export { VerificationScreen } from './VerificationScreen'
export { RegistrationForm, type RegistrationFormProps } from './RegistrationForm'
export { submitRegistration } from './registerAccount'
export {
  addressPartPath,
  composedResidencyProofValue,
  initialRegistrationValues,
  registrationEndpoint,
  renderedRegistrationInputs,
  toRegistrationRequest,
  validateRegistrationValues,
  ADDRESS_PATH_PREFIX,
  REGISTRATION_PATHS,
  type RegistrationFormValues,
  type RegistrationPath,
  type RegistrationRequest,
  type RegistrationTarget,
} from './registrationFormModel'
export {
  fetchRegistrationLink,
  isLinkRejection,
  registrationLinkQueryKey,
  selfRegistrationRole,
  REGISTRATION_LINK_PATH,
  type RegistrationLink,
  type SelfRegistrationRole,
} from './registrationLink'
export {
  fieldViolationCatalogueKey,
  isEmailConflict,
  isValidationIssue,
  localizeIssuePartition,
  localizeRegistrationIssue,
  partitionRegistrationIssues,
  validationIssueCatalogueKey,
  EMAIL_CONFLICT_ERROR_KEYS,
  NO_ISSUES,
  type FieldMessages,
  type RegistrationIssue,
  type RegistrationIssuePartition,
} from './registrationMessages'
export {
  composeAddressProofValue,
  isAddressProof,
  residencyProofValue,
  ADDRESS_PROOF_PARTS,
  ADDRESS_PROOF_TYPE,
  EMPTY_ADDRESS_PROOF_PARTS,
  type AddressProofPart,
  type AddressProofParts,
} from './residencyProof'
export {
  isCodeEntryLocked,
  resendCodeBody,
  resendVerificationCode,
  submitVerificationCode,
  validateVerificationValues,
  verifyCodeBody,
  CODE_ENTRY_LOCKED_ERROR_KEY,
  VERIFICATION_CODE_PATH,
  VERIFICATION_INPUTS,
  VERIFY_CODE_PATH,
  VERIFY_RESEND_PATH,
  type ResendCodeRequest,
  type VerifyCodeRequest,
} from './verifyCode'
export {
  registrationHandoffFrom,
  verificationHandoffState,
  type RegisteredAccount,
  type RegistrationHandoff,
  type VerificationHandoffState,
} from './verificationHandoff'
