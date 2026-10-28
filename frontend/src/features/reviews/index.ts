/**
 * The Review submission and timeline slice (Requirement 15).
 *
 * The shell registers four screens: {@link AdminCandidateReviewsScreen} on
 * `/admin/candidates/:accountId/reviews`, {@link AdminReviewsScreen} on
 * `/admin/reviews`, {@link SeniorReviewsScreen} on `/senior/reviews` and
 * {@link SeniorReviewNewScreen} on `/senior/reviews/new`. There is no Candidate
 * screen and no Candidate route, which is how Requirement 15 AC10 is satisfied.
 *
 * Nothing exported here can edit or delete a Review (AC5): `reviewsApi.ts` offers
 * one append, two reads, and no third verb.
 *
 * The pure modules are exported as well, so the Admin account slice (task 22.1)
 * can link into a Candidate's timeline without restating the address rules.
 */

export { AdminCandidateReviewsScreen } from './AdminCandidateReviewsScreen'
export { AdminReviewsScreen } from './AdminReviewsScreen'
export { SeniorReviewNewScreen } from './SeniorReviewNewScreen'
export { SeniorReviewsScreen } from './SeniorReviewsScreen'
export { ReviewCard } from './ReviewCard'
export { ReviewForm, type ReviewFormSubmission } from './ReviewForm'
export { ReviewSubmissionPanel } from './ReviewSubmissionPanel'
export { ReviewTimeline } from './ReviewTimeline'
export { TimelineFilterPanel } from './TimelineFilterPanel'
export { CandidateSelector } from './CandidateSelector'
export {
  CANDIDATE_PARAM,
  readCandidateId,
  writeCandidateId,
} from './candidateSelection'
export {
  ASSESSMENT_BOUNDS,
  ASSESSMENT_PATH,
  correctionLinks,
  draftFromReview,
  EMPTY_REVIEW_DRAFT,
  isCorrection,
  JD_PATH,
  lastReviewId,
  nextReviewPage,
  orderTimelineAscending,
  parseRatingInput,
  RATING_BOUNDS,
  REVIEW_PAGE_SIZE,
  REVIEW_RATING_PATHS,
  reviewDraftValues,
  reviewElementId,
  submitReviewBody,
  validateReviewDraft,
  type CorrectionIndex,
  type CorrectionLink,
  type Review,
  type ReviewDraft,
  type ReviewRatingPath,
  type SubmitReviewBody,
} from './reviewRules'
export {
  EMPTY_TIMELINE_FILTERS,
  endOfDayUtc,
  hasActiveTimelineFilters,
  ownTimelineQueryParams,
  readTimelineCursor,
  readTimelineFilters,
  startOfDayUtc,
  TIMELINE_FILTER_PARAM_NAMES,
  TIMELINE_PARAM,
  timelineQueryParams,
  writeTimelineCursor,
  writeTimelineFilters,
  type OwnTimelineQueryParams,
  type TimelineCursor,
  type TimelineFilters,
  type TimelineQueryParams,
} from './timelineFilters'
export {
  CANDIDATE_REVIEWS_PATH,
  OWN_CANDIDATE_REVIEWS_PATH,
  candidateReviewsQueryKey,
  candidateReviewsScopeKey,
  listCandidateReviews,
  listOwnReviews,
  ownReviewsQueryKey,
  ownReviewsScopeKey,
  REVIEWS_QUERY_SCOPE,
  submitReview,
} from './reviewsApi'
export {
  useCandidateReviewsQuery,
  useOwnReviewsQuery,
  useSubmitReview,
  type SubmitReviewVariables,
} from './reviewQueries'
