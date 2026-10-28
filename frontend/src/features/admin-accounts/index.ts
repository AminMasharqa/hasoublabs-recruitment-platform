/**
 * The Admin account-management slice (Requirement 16).
 *
 * Task 22.1 builds the whole of it: the account list with its status and role
 * filters and keyset pagination (AC1–AC3), the create-link control and the single
 * rendering of the token a 201 returns (AC4–AC6), the status-driven lifecycle
 * controls with their confirmation dialogs (AC7–AC12, AC15, AC16), the
 * complete-role-set control with the Admin-exclusivity block (AC13, AC14) and the
 * pending-skill review (AC17).
 *
 * The screen is registered on the already-declared `/admin/accounts` route through
 * `shell/screenElements.tsx`, so this slice imports nothing from the router beyond
 * the two path helpers it links with, and decides nothing about access: the route
 * group is `ADMIN_ACCESS`, so the Admin role is required above the screen (Req 8
 * AC8).
 */

export { AccountCard } from './AccountCard'
export { AccountFiltersPanel } from './AccountFiltersPanel'
export { AccountLifecycleControls } from './AccountLifecycleControls'
export { AccountRolesControl } from './AccountRolesControl'
export { AdminAccountsScreen } from './AdminAccountsScreen'
export { PendingSkillsPanel } from './PendingSkillsPanel'
export { RegistrationLinkPanel } from './RegistrationLinkPanel'
export { registrationLinkUrl } from './registrationLinks'
export {
  ACCOUNT_FILTER_PARAM_NAMES,
  ACCOUNT_STATUS_VALUES,
  ACCOUNTS_PARAM,
  accountsQueryParams,
  DEFAULT_ACCOUNTS_VIEW,
  EMPTY_ACCOUNT_FILTERS,
  hasActiveAccountFilters,
  nextAccountsPage,
  PENDING_SKILLS_VIEW,
  pendingSkillsSearch,
  readAccountCursor,
  readAccountFilters,
  readAccountsView,
  writeAccountFilters,
  type AccountFilters,
  type AccountsQueryParams,
  type AdminAccountsView,
} from './accountFilters'
export {
  useAccountLifecycleMutation,
  useAccountsQuery,
  useCreateRegistrationLink,
  usePendingSkillsQuery,
  useUpdateAccountRoles,
  type UpdateRolesVariables,
} from './accountQueries'
export {
  canSubmitRoleSet,
  combinesAdminWithOtherRole,
  CONFIRMED_ACTIONS,
  isSameRoleSet,
  LIFECYCLE_ACTIONS_BY_STATUS,
  lifecycleActionsFor,
  normalizeRoleSet,
  offersLifecycleAction,
  REASON_ACTIONS,
  REASON_PATH,
  reasonBoundsFor,
  REJECT_REASON_BOUNDS,
  replaceAccount,
  requiresConfirmation,
  requiresReason,
  roleSetRefusal,
  roleUpdateBody,
  ROLES_PATH,
  SUSPEND_REASON_BOUNDS,
  validateLifecycleReason,
  type Account,
  type LifecycleAction,
  type ReasonBounds,
  type RoleSetRefusal,
} from './accountRules'
export {
  ACCOUNT_ROLES_PATH,
  ACCOUNTS_LIST_QUERY_KEY,
  accountsQueryKey,
  ADMIN_ACCOUNTS_PATH,
  ADMIN_ACCOUNTS_QUERY_SCOPE,
  approveAccount,
  createRegistrationLink,
  deactivateAccount,
  issueLifecycleAction,
  LIFECYCLE_PATHS,
  listAccounts,
  listPendingSkills,
  PENDING_SKILLS_PATH,
  pendingSkillsQueryKey,
  reactivateAccount,
  recordAccountMeeting,
  REGISTRATION_LINKS_PATH,
  rejectAccount,
  reopenAccount,
  suspendAccount,
  updateAccountRoles,
  type LifecycleRequest,
  type RegistrationLink,
  type RegistrationLinkRole,
} from './accountsApi'
export { issueText, issueTexts, issueCatalogueKey, isValidationIssue } from './issueText'
export { decodePendingSkill, decodePendingSkills, type PendingSkill } from './pendingSkills'
