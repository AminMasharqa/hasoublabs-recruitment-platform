/**
 * The onboarding feature slice: the Status_Notice screen (Requirement 7 AC3, AC4,
 * AC5).
 *
 * The screen is registered on the already-declared `/status` route through the
 * `elements` table `routing/routes.tsx` accepts, keyed by the `statusNotice` path
 * id. This slice therefore decides nothing about access: `/status` is the sole
 * member of the `onboarding` guard group, whose {@link
 * import('../../routing/access').ONBOARDING_SCREEN_ACCESS} metadata opens it to
 * every role and every Account_Status — which is what keeps it reachable both
 * before approval (through the Requirement 7 AC2 gate) and after it (through the
 * Requirement 8 conjunction).
 */

export { StatusNoticeScreen } from './StatusNoticeScreen'
export {
  isTerminalStatus,
  offersVerification,
  ONBOARDING_NAMESPACE,
  statusNoticeKeys,
  statusNoticeSurface,
  STATUS_NOTICE_STATUS_KEYS,
  TERMINAL_STATUSES,
  VERIFICATION_STATUS,
  type StatusNoticeKeys,
  type StatusNoticeSurface,
} from './statusNotice'
