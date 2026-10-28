/**
 * Which Candidate a Review screen is about, when the route does not say.
 *
 * Every review endpoint is scoped to one Candidate (`candidate_id` is a path
 * member), and two of the four review destinations carry no Candidate in their
 * path: `/senior/reviews` and `/admin/reviews` are menu destinations, not
 * per-Candidate addresses. Those two read the Candidate from a `candidate` query
 * parameter, so the address remains the whole state of the screen — linkable,
 * reload-proof, back-button-navigable — exactly as the filters are.
 *
 * The Admin per-Candidate timeline (`/admin/candidates/:accountId/reviews`) takes
 * its Candidate from the path instead and does not use this module; the Senior has
 * no Candidate directory in the contract, so the query parameter is the only way a
 * Senior addresses one.
 *
 * Pure: no React, no router.
 *
 * Requirements: 15.7, 15.9.
 */

/** Query parameter naming the Candidate a review screen is about. */
export const CANDIDATE_PARAM = 'candidate'

/** Anything that reads like a `URLSearchParams`. */
export interface ReadableSearchParams {
  get(name: string): string | null
}

/**
 * The Candidate identifier the address names, or `''` when it names none.
 *
 * `''` rather than `null` so the value can be fed straight into a controlled text
 * input; the screens treat it as "no Candidate selected" and issue no request.
 */
export function readCandidateId(params: ReadableSearchParams): string {
  const value = params.get(CANDIDATE_PARAM)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The address for one Candidate's reviews, dropping every other parameter.
 *
 * Selecting a different Candidate starts a new keyset walk and a new filter set:
 * a cursor and a reviewer filter both name positions in one Candidate's timeline
 * and mean nothing in another's.
 */
export function writeCandidateId(candidateId: string): URLSearchParams {
  const params = new URLSearchParams()
  const id = candidateId.trim()
  if (id !== '') {
    params.set(CANDIDATE_PARAM, id)
  }
  return params
}
