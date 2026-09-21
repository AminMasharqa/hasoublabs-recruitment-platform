/**
 * The TanStack Query bindings of the Application slice: three reads and two
 * mutations.
 *
 * ## What each mutation invalidates
 *
 * - **Applying** (AC2–AC4) invalidates the Candidate's own Application list: a
 *   recorded Application belongs on every page of it, and only the Backend_Api knows
 *   the identifier and the submission instant it was given. An external redirect
 *   records nothing, so it invalidates nothing.
 * - **A status change** (AC13) invalidates the cached applicant list of the affected
 *   Job_Description and the cached Application detail, which is Requirement 14 AC14
 *   verbatim. The Job_Description is taken from the Application the 200 returned, so
 *   the screen does not have to know it beforehand; when the response names none, the
 *   whole applicant-list subtree goes rather than a guessed one.
 *
 * Nothing here writes a status or a list optimistically. An Application's status is
 * the Backend_Api's, and an Applicant_Card carries no identifier to patch a row by
 * (AC12), so a local edit could not be reconciled reliably.
 *
 * Requirements: 14.2, 14.3, 14.4, 14.9, 14.10, 14.11, 14.12, 14.13, 14.14.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import type { ApplicationStatus } from '../../api/enums'
import { useApiClient } from '../../shell/appServices'

import type { Application, ApplicantCard, ApplyOutcome } from './applicationRules'
import {
  applicantsQueryKey,
  applicantsScopeKey,
  APPLICANTS_SCOPE_KEY,
  applicationQueryKey,
  APPLICATION_DETAIL_SCOPE_KEY,
  fetchMyApplication,
  listApplicants,
  listMyApplications,
  MY_APPLICATIONS_SCOPE_KEY,
  myApplicationsQueryKey,
  submitApplication,
  updateApplicationStatus,
} from './applicationsApi'

/** One page of the Candidate's own Applications (AC9, AC10). */
export function useMyApplicationsQuery(
  cursor: string | null = null,
): UseQueryResult<readonly Application[]> {
  const api = useApiClient()
  return useQuery({
    queryKey: myApplicationsQueryKey(cursor),
    queryFn: ({ signal }) => listMyApplications(api, cursor, signal),
  })
}

/**
 * One of the Candidate's own Applications (AC11).
 *
 * Disabled for a blank identifier: an address that carries none is a defective link,
 * and the screen says so rather than issuing a request the Backend_Api would refuse.
 */
export function useMyApplicationQuery(
  applicationId: string | null | undefined,
): UseQueryResult<Application> {
  const api = useApiClient()
  const id = (applicationId ?? '').trim()
  return useQuery({
    queryKey: applicationQueryKey(id),
    queryFn: ({ signal }) => fetchMyApplication(api, id, signal),
    enabled: id !== '',
  })
}

/** The Applicant_Cards of one Job_Description (AC12). */
export function useApplicantsQuery(
  jdId: string | null | undefined,
  status: ApplicationStatus | null = null,
): UseQueryResult<readonly ApplicantCard[]> {
  const api = useApiClient()
  const id = (jdId ?? '').trim()
  return useQuery({
    queryKey: applicantsQueryKey(id, status),
    queryFn: ({ signal }) => listApplicants(api, id, status, signal),
    enabled: id !== '',
  })
}

/** The variables of an apply submission: the role and the chosen CV_Variant (AC2). */
export interface SubmitApplicationVariables {
  readonly jdId: string
  /** `null` lets the Backend_Api resolve the primary variant, as the contract does. */
  readonly cvVariantId: string | null
}

/**
 * `POST /jobs/{jd_id}/apply` as a mutation (AC2, AC3, AC4).
 *
 * Resolves with the classified outcome, so the dialog renders the confirmation of
 * AC3 or the explicit external control of AC4 from one value. The own-Application
 * list is invalidated only for the outcome that actually recorded one.
 */
export function useSubmitApplication(): UseMutationResult<
  ApplyOutcome,
  unknown,
  SubmitApplicationVariables
> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ jdId, cvVariantId }: SubmitApplicationVariables) =>
      submitApplication(api, jdId, cvVariantId),
    onSuccess: (outcome) => {
      if (outcome.kind === 'recorded') {
        void queryClient.invalidateQueries({ queryKey: MY_APPLICATIONS_SCOPE_KEY })
      }
    },
  })
}

/** The variables of a status change (AC13). */
export interface UpdateApplicationStatusVariables {
  readonly applicationId: string
  readonly status: ApplicationStatus
  /** The optional reason; `null` omits the member. */
  readonly reason: string | null
  /**
   * The Job_Description whose applicant list to invalidate (AC14), when the caller
   * knows it. Otherwise it is taken from the returned Application, and failing that
   * every applicant list is invalidated.
   */
  readonly jdId?: string
}

/**
 * `PATCH /admin/applications/{application_id}/status` as a mutation (AC13, AC14).
 *
 * On a 200 the cached applicant list of the affected Job_Description and the cached
 * Application detail are both invalidated, so whichever of the two surfaces is
 * mounted re-reads rather than rendering the status it held before the change.
 */
export function useUpdateApplicationStatus(): UseMutationResult<
  Application,
  unknown,
  UpdateApplicationStatusVariables
> {
  const api = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ applicationId, status, reason }: UpdateApplicationStatusVariables) =>
      updateApplicationStatus(api, applicationId, status, reason),
    onSuccess: (application, variables) => {
      // AC14: the applicant list of the affected Job_Description…
      const jdId = (variables.jdId ?? application.jd_id ?? '').trim()
      void queryClient.invalidateQueries({
        queryKey: jdId === '' ? APPLICANTS_SCOPE_KEY : applicantsScopeKey(jdId),
      })
      // …and the Application detail. The whole detail subtree, because the Candidate
      // list carries the same status and a stale page would contradict this one.
      void queryClient.invalidateQueries({ queryKey: APPLICATION_DETAIL_SCOPE_KEY })
      void queryClient.invalidateQueries({ queryKey: MY_APPLICATIONS_SCOPE_KEY })
    },
  })
}
