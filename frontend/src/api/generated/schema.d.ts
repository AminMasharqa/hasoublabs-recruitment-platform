/**
 * Generated Backend_Api contract declarations - DO NOT EDIT BY HAND.
 *
 * Emitted by `npm run gen:api` from the OpenAPI document at /api/openapi.json.
 * Run `npm run gen:api` after any Backend_Api contract change; `npm run verify:api`
 * fails the Build_Pipeline when this file drifts from the reference document.
 */
export interface paths {
    "/api/v1/admin/accounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Admin: list accounts
         * @description Return a paginated list of accounts with optional status/role filters.
         */
        get: operations["list_accounts_api_v1_admin_accounts_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/accounts/{account_id}:approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Admin: approve an account
         * @description Approve an account from PendingApproval.
         *
         *     If ``fast_track`` is True, the account goes directly to Approved (skipping
         *     the meeting step). Otherwise it moves to ApprovedPendingMeeting.
         */
        post: operations["approve_account_api_v1_admin_accounts__account_id__approve_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/accounts/{account_id}:deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Admin: permanently deactivate an account
         * @description Permanently deactivate an account (Approved or Suspended → Deactivated).
         *
         *     The email slot is released so the address can be reused.
         */
        post: operations["deactivate_account_api_v1_admin_accounts__account_id__deactivate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/accounts/{account_id}:reactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Admin: reactivate a suspended account
         * @description Reactivate a Suspended account back to Approved.
         */
        post: operations["reactivate_account_api_v1_admin_accounts__account_id__reactivate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/accounts/{account_id}:record-meeting": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Admin: record that the onboarding meeting was completed
         * @description Record that the onboarding meeting was held; advance to Approved.
         */
        post: operations["record_meeting_api_v1_admin_accounts__account_id__record_meeting_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/accounts/{account_id}:reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Admin: reject an account
         * @description Reject an account and release its email slot.
         */
        post: operations["reject_account_api_v1_admin_accounts__account_id__reject_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/accounts/{account_id}:reopen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Admin: re-open a rejected account for reconsideration
         * @description Re-open a Rejected account by moving it back to PendingApproval.
         */
        post: operations["reopen_account_api_v1_admin_accounts__account_id__reopen_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/accounts/{account_id}:suspend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Admin: suspend an approved account
         * @description Suspend an Approved account (reversible).
         */
        post: operations["suspend_account_api_v1_admin_accounts__account_id__suspend_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/accounts/{account_id}/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Admin: replace an account's role set
         * @description Replace the complete role set of an account.
         *
         *     Validates the ADMIN exclusivity constraint (Admin cannot be combined with
         *     Candidate or Senior).
         */
        put: operations["update_roles_api_v1_admin_accounts__account_id__roles_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/applications/{application_id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Admin: update application status
         * @description Admin-only endpoint to move an application to a new status. Records the actor identity and a UTC timestamp in the status history (R7 AC10, AC14). Sends an in-app notification and outbox email to the candidate upon status change.
         */
        patch: operations["admin_update_application_status_api_v1_admin_applications__application_id__status_patch"];
        trace?: never;
    };
    "/api/v1/admin/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search Audit
         * @description Search the audit log.
         *
         *     All filters are optional and conjunctive.  Pagination is keyset: pass the
         *     ``meta.next_after_id`` from the previous page as ``after_id`` on the next
         *     request.
         *
         *     Requirements: R8 AC4.
         */
        get: operations["search_audit_api_v1_admin_audit_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/audit/actors/{account_id}/anonymise": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Anonymise Actor Endpoint
         * @description Anonymise audit actor identity rows for a deleted account.
         *
         *     Nulls out ``display_name`` and ``email``; sets ``anonymised_at``.
         *     The hash-chained ``audit_log`` rows are left byte-identical (R8 AC7).
         *
         *     Requirements: R8 AC7.
         */
        post: operations["anonymise_actor_endpoint_api_v1_admin_audit_actors__account_id__anonymise_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/audit/chain/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Verify Chain
         * @description On-demand full chain verification (walks from ``start_id`` in windows).
         *
         *     The ARQ job calls the same verifier on a schedule; this endpoint lets Admins
         *     trigger an ad-hoc check.
         *
         *     Requirements: R8 AC8.
         */
        get: operations["verify_chain_api_v1_admin_audit_chain_verify_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/candidates/{account_id}/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Admin: get any candidate's profile
         * @description Retrieve a candidate's full profile as an Admin. Returns 403 if no profile exists for the given account_id (no 404 leak).
         */
        get: operations["admin_get_candidate_profile_api_v1_admin_candidates__account_id__profile_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/candidates/{candidate_id}/cv-variants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * [Admin] List a candidate's CV variants
         * @description Return all (including archived) variants for a candidate.
         */
        get: operations["admin_list_variants_api_v1_admin_candidates__candidate_id__cv_variants_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/candidates/{candidate_id}/cv-variants/{variant_id}/versions/{version_number}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * [Admin] Download a candidate's CV version
         * @description Stream a candidate's CV file (Admin access, integrity-verified).
         */
        get: operations["admin_download_version_api_v1_admin_candidates__candidate_id__cv_variants__variant_id__versions__version_number__download_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/exports/{entity_type}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Admin: request data export to .xlsx
         * @description Enqueues an async .xlsx export for ``entity_type`` (``candidates``, ``job_descriptions``, or ``applications``). Returns a job id to poll. Admin only (R29 AC1–AC5). Every request is recorded in the Audit_Log (R29 AC6).
         */
        post: operations["request_export_api_v1_admin_exports__entity_type__post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/exports/{job_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Admin: poll export job status
         * @description Poll the status of an async export job. When status == ``ready``, ``download_url`` contains a signed, short-lived MinIO pre-signed URL. Returns 403 if the job does not exist (constant-time denial). Admin only.
         */
        get: operations["get_export_status_api_v1_admin_exports__job_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Admin: list all Job Descriptions
         * @description List all Job Descriptions for Admin, with optional status filter.
         */
        get: operations["admin_list_jds_api_v1_admin_jobs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/registration-links": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Admin: create a registration link
         * @description Generate a new signed registration link for the specified role.
         *
         *     The raw token is included in this response only. It is never stored in
         *     plaintext and is not recoverable after this response is returned.
         */
        post: operations["create_registration_link_api_v1_admin_registration_links_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/reports/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Admin: activity summary report
         * @description Returns aggregate activity metrics for the given date range: CVs uploaded, registrations, rejections, applications by status. Filterable by date range and Job_Description. Admin only (R28 AC1, AC2, AC3). Every call is recorded in the Audit_Log (R28 AC7).
         */
        get: operations["get_activity_report_api_v1_admin_reports_activity_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/reports/candidate-progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Admin: candidate progress tracking
         * @description Returns each Candidate's current Account_Status and all their application statuses across Job_Descriptions. Paginated. Admin only (R28 AC4, AC5). Every call is recorded in the Audit_Log (R28 AC7).
         */
        get: operations["get_candidate_progress_api_v1_admin_reports_candidate_progress_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/seniors/{account_id}/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Admin: get any senior's profile
         * @description Retrieve a senior's full profile as an Admin. Returns 403 if no profile exists for the given account_id (no 404 leak).
         */
        get: operations["admin_get_senior_profile_api_v1_admin_seniors__account_id__profile_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/skills/pending": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Admin: list pending skill terms for review
         * @description Returns unmatched skill terms awaiting Admin taxonomy review (R4 AC3). Admin only.
         */
        get: operations["admin_list_pending_skills_api_v1_admin_skills_pending_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/context": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Switch active role context (dual-role accounts only)
         * @description Switch the active role context for a Candidate+Senior account.
         *
         *     Issues a new token pair with the updated ``act`` claim; the old session is
         *     invalidated. No authorization state from the previous context survives.
         */
        post: operations["switch_context_api_v1_auth_context_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Authenticate and receive a token pair
         * @description Authenticate an account and issue a JWT access + refresh token pair.
         *
         *     MFA is checked in a separate step: if the account has MFA enrolled, a
         *     ``MfaRequired`` error is returned when ``mfa_code`` is absent. The client
         *     should re-submit with ``mfa_code`` populated.
         */
        post: operations["login_api_v1_auth_login_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Invalidate the current session
         * @description Invalidate the Valkey session referenced by the current JWT.
         */
        post: operations["logout_api_v1_auth_logout_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/mfa/enroll": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Begin MFA enrolment (Admin only)
         * @description Generate a TOTP secret and return the QR code for admin MFA enrolment.
         */
        post: operations["enroll_mfa_api_v1_auth_mfa_enroll_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/mfa/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Verify a TOTP code
         * @description Verify a TOTP code against the current account's enrolled secret.
         *
         *     Returns ``{"verified": true}`` on success or raises InvalidMfaCode.
         */
        post: operations["verify_mfa_code_api_v1_auth_mfa_verify_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Exchange a refresh token for a new token pair
         * @description Issue a new access + refresh token pair from a valid refresh token.
         */
        post: operations["refresh_token_api_v1_auth_refresh_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/candidates/{candidate_id}/reviews": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Admin: list all reviews for a candidate
         * @description Returns the full review timeline for a candidate, ordered by ``(created_at ASC, seq ASC)`` for a stable total order (R9 AC7). Supports optional filters: ``reviewer_id``, ``jd_id``, ``date_from``, ``date_to``, and keyset pagination via ``after_seq`` + ``after_id``. Candidate role is denied by this guard (R9 AC8).
         */
        get: operations["admin_list_reviews_api_v1_candidates__candidate_id__reviews_get"];
        put?: never;
        /**
         * Submit a review for a candidate
         * @description Append an immutable review to the candidate's timeline. Both Admins and Seniors (in any context) may submit reviews. Set ``corrects_review_id`` to mark this as a correction of a prior review by the same reviewer for the same candidate (R9 AC3, AC5). All field violations are returned together — no partial writes (R9 AC4).
         */
        post: operations["submit_review_api_v1_candidates__candidate_id__reviews_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/candidates/{candidate_id}/reviews/mine": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Senior: list my own reviews for a candidate
         * @description Returns only the authenticated Senior's own reviews for a candidate, ordered by ``(created_at ASC, seq ASC)`` (R9 AC7, AC10). Requires SENIOR active context — a Senior acting as Candidate is denied. Candidate role is denied by this guard (R9 AC8).
         */
        get: operations["senior_list_own_reviews_api_v1_candidates__candidate_id__reviews_mine_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Browse Open Job Descriptions
         * @description Return a paginated list of Open Job Descriptions.
         *
         *     Accessible to any authenticated, Approved account.
         */
        get: operations["browse_jds_api_v1_jobs_get"];
        put?: never;
        /**
         * Create a Job Description
         * @description Create a new Job Description in DRAFT status.
         *
         *     Accessible to accounts acting in the Senior context, or Admins.
         *     Seniors must be acting in the SENIOR context (dual-role accounts switch first).
         */
        post: operations["create_jd_api_v1_jobs_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{jd_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a Job Description
         * @description Fetch a Job Description by id.
         *
         *     - Admin: sees all statuses.
         *     - Senior: sees own JDs + Open JDs.
         *     - Candidate: sees only Open JDs.
         */
        get: operations["get_jd_api_v1_jobs__jd_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Update a Job Description
         * @description Partially update a DRAFT or OPEN Job Description.
         *
         *     Only the creator or an Admin may update. Closed JDs cannot be edited.
         */
        patch: operations["update_jd_api_v1_jobs__jd_id__patch"];
        trace?: never;
    };
    "/api/v1/jobs/{jd_id}:close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Close a Job Description
         * @description Transition an OPEN Job Description to CLOSED.
         *
         *     Downstream application closure is handled by the ApplicationService.
         */
        post: operations["close_jd_api_v1_jobs__jd_id__close_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{jd_id}:publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Publish a Job Description
         * @description Transition a Job Description from DRAFT to OPEN.
         *
         *     Validates that external_url is set when channel is EXTERNAL_CAREERS_URL.
         */
        post: operations["publish_jd_api_v1_jobs__jd_id__publish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{jd_id}/applicants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List applicants for a job
         * @description Return the restricted applicant card list for a Job_Description. Seniors may only view applicants for their own JDs. Admins may view any JD's applicants. Each card contains only: full_name, applied_role_title, application_status (R3 RBAC — no contact details, CVs, or profile data exposed to Seniors).
         */
        get: operations["list_jd_applicants_api_v1_jobs__jd_id__applicants_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{jd_id}/application-channel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set the application channel
         * @description Set or replace the application channel on a DRAFT or OPEN JD.
         */
        put: operations["set_application_channel_api_v1_jobs__jd_id__application_channel_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{jd_id}/apply": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit a job application
         * @description Submit an in-platform application for the given Job_Description. Returns 201 + ApplicationDTO for dashboard channels (Senior_Dashboard / Admin_Dashboard). Returns 200 + ExternalRedirectDTO for External_Careers_URL channels — no Application row is created in that case (R7 AC8). Requires Candidate context and an Application-Ready profile (R7 AC1).
         */
        post: operations["submit_application_api_v1_jobs__jd_id__apply_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{jd_id}/contactable-seniors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get contactable Seniors for a JD
         * @description Return all Seniors contactable for the given Job Description.
         */
        get: operations["get_contactable_seniors_api_v1_jobs__jd_id__contactable_seniors_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/extract:text": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit text for JD extraction
         * @description Submit raw text for async heuristic extraction into a draft JD.
         */
        post: operations["extract_text_api_v1_jobs_extract_text_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/extract:url": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit URL for JD extraction
         * @description Submit a public URL for async heuristic extraction into a draft JD.
         */
        post: operations["extract_url_api_v1_jobs_extract_url_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/extract/{draft_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Poll an extraction draft
         * @description Poll an extraction draft for worker-populated results.
         */
        get: operations["get_extraction_draft_api_v1_jobs_extract__draft_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/extract/{draft_id}:confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Confirm an extraction draft into a Job Description
         * @description Confirm a completed extraction draft into a real DRAFT Job Description.
         */
        post: operations["confirm_extraction_draft_api_v1_jobs_extract__draft_id__confirm_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/applications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List my applications
         * @description Return the authenticated candidate's own applications, newest first. Supports keyset pagination via ``after_id`` and ``limit``. Requires Candidate context.
         */
        get: operations["list_my_applications_api_v1_me_applications_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/applications/{application_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get one of my applications
         * @description Return a single application belonging to the authenticated candidate. Returns 403 (not 404) if the application does not exist or belongs to another candidate (R3 AC6). Requires Candidate context.
         */
        get: operations["get_my_application_api_v1_me_applications__application_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/cv-variants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List own CV variants
         * @description Return all active variants for the authenticated candidate.
         */
        get: operations["list_variants_api_v1_me_cv_variants_get"];
        put?: never;
        /**
         * Create a CV variant
         * @description Create a new named CV variant (up to 5 per account).
         */
        post: operations["create_variant_api_v1_me_cv_variants_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/cv-variants/{variant_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Archive a CV variant
         * @description Archive a variant.  The last active variant cannot be archived.
         */
        delete: operations["archive_variant_api_v1_me_cv_variants__variant_id__delete"];
        options?: never;
        head?: never;
        /**
         * Update a CV variant
         * @description Update the name or description of an active variant.
         */
        patch: operations["update_variant_api_v1_me_cv_variants__variant_id__patch"];
        trace?: never;
    };
    "/api/v1/me/cv-variants/{variant_id}/primary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set a variant as primary
         * @description Designate this variant as the primary one for the account.
         */
        post: operations["set_primary_variant_api_v1_me_cv_variants__variant_id__primary_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/cv-variants/{variant_id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List versions for a variant
         * @description Return all versions for the given variant (scoped to the requesting candidate).
         */
        get: operations["list_versions_api_v1_me_cv_variants__variant_id__versions_get"];
        put?: never;
        /**
         * Upload a CV file
         * @description Upload a PDF or DOCX CV file.
         *
         *     The file is validated (size, MIME, structure), stored in the quarantine
         *     bucket, and queued for ClamAV scanning. Returns 202 Accepted.
         */
        post: operations["upload_version_api_v1_me_cv_variants__variant_id__versions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/cv-variants/{variant_id}/versions/{version_number}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download a CV version
         * @description Stream a CV file, verifying the SHA-256 digest after read.
         */
        get: operations["download_version_api_v1_me_cv_variants__variant_id__versions__version_number__download_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get my candidate profile
         * @description Returns the authenticated candidate's profile. Creates an empty profile if none exists yet. Requires Candidate context.
         */
        get: operations["get_my_candidate_profile_api_v1_me_profile_get"];
        /**
         * Update my candidate profile
         * @description Full-replace update of the authenticated candidate's profile. All provided sub-collections (education, work_experience, skills, languages) are replaced atomically. Partial updates are supported — only supplied fields are written. Requires Candidate context.
         */
        put: operations["update_my_candidate_profile_api_v1_me_profile_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/senior-profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get my senior profile
         * @description Returns the authenticated senior's profile. Creates an empty profile if none exists yet. Requires Senior context.
         */
        get: operations["get_my_senior_profile_api_v1_me_senior_profile_get"];
        /**
         * Update my senior profile
         * @description Update the authenticated senior's profile including contact preferences and field-of-expertise skills. Requires Senior context.
         */
        put: operations["update_my_senior_profile_api_v1_me_senior_profile_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get current account status and next step
         * @description Return the caller's current account status and next onboarding step.
         *
         *     Accessible from any account status so the onboarding screen can always
         *     show the right message.
         */
        get: operations["get_my_status_api_v1_me_status_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/register/candidate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Register a new Candidate account
         * @description Complete a new Candidate self-registration.
         *
         *     Requires a valid registration link token. Creates the account, queues the
         *     verification code email, and returns the new AccountDTO (PendingVerification).
         */
        post: operations["register_candidate_api_v1_register_candidate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/register/senior": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Register a new Senior account
         * @description Complete a new Senior self-registration.
         *
         *     Requires a valid registration link token. Creates the account, queues the
         *     verification code email, and returns the new AccountDTO (PendingVerification).
         */
        post: operations["register_senior_api_v1_register_senior_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/registration-links/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Validate a registration link token
         * @description Validate and return metadata for a registration link token.
         *
         *     The raw token is NOT re-exposed in the response. This endpoint is called by
         *     the registration form to confirm the link is valid before showing the form.
         */
        get: operations["get_registration_link_api_v1_registration_links__token__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/skills": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search skills taxonomy
         * @description Full-text search over the canonical skill taxonomy. Returns up to 20 matching skills. Available to all Approved accounts.
         */
        get: operations["search_skills_api_v1_skills_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/verify/code": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit the email verification code
         * @description Verify the 6-digit code emailed to the registrant.
         *
         *     On success the account transitions from PendingVerification to PendingApproval.
         */
        post: operations["verify_code_api_v1_verify_code_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/verify/resend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resend the verification code email
         * @description Issue a new 6-digit code and reset the attempt counter.
         *
         *     The previous code is immediately invalidated.
         */
        post: operations["resend_code_api_v1_verify_resend_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * AccountDTO
         * @description Public representation of an account. Never contains password or secrets.
         */
        AccountDTO: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Email */
            email: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Language Preference */
            language_preference: string;
            /** Mfa Enrolled */
            mfa_enrolled: boolean;
            /** Roles */
            roles: components["schemas"]["Role"][];
            status: components["schemas"]["AccountStatus"];
        };
        /**
         * AccountStatus
         * @description The single lifecycle state an account holds at all times (R1 AC18).
         * @enum {string}
         */
        AccountStatus: "PendingVerification" | "PendingApproval" | "ApprovedPendingMeeting" | "Approved" | "Rejected" | "Suspended" | "Deactivated";
        /**
         * ActivityReportDTO
         * @description Summary metrics for the activity report (R28 AC2).
         */
        ActivityReportDTO: {
            /**
             * Applications Closed
             * @default 0
             */
            applications_closed: number;
            /**
             * Applications Forwarded
             * @default 0
             */
            applications_forwarded: number;
            /**
             * Applications Submitted
             * @default 0
             */
            applications_submitted: number;
            /**
             * Applications Under Review
             * @default 0
             */
            applications_under_review: number;
            /**
             * Candidates Approved
             * @default 0
             */
            candidates_approved: number;
            /**
             * Candidates Registered
             * @default 0
             */
            candidates_registered: number;
            /**
             * Candidates Rejected
             * @default 0
             */
            candidates_rejected: number;
            /**
             * Cv Versions Uploaded
             * @default 0
             */
            cv_versions_uploaded: number;
            /** Period From */
            period_from: string | null;
            /** Period To */
            period_to: string | null;
        };
        /**
         * AdminApproveRequest
         * @description Admin approval; fast_track skips the meeting step.
         */
        AdminApproveRequest: {
            /**
             * Fast Track
             * @default false
             */
            fast_track: boolean;
        };
        /**
         * AdminDeactivateRequest
         * @description Admin deactivation with a mandatory reason.
         */
        AdminDeactivateRequest: {
            /** Reason */
            reason: string;
        };
        /**
         * AdminRejectRequest
         * @description Admin rejection with a mandatory reason.
         */
        AdminRejectRequest: {
            /** Reason */
            reason: string;
        };
        /**
         * AdminRoleUpdateRequest
         * @description Replace the full role set of an account.
         */
        AdminRoleUpdateRequest: {
            /** Roles */
            roles: components["schemas"]["Role"][];
        };
        /**
         * AdminSuspendRequest
         * @description Admin suspension with a mandatory reason.
         */
        AdminSuspendRequest: {
            /** Reason */
            reason: string;
        };
        /**
         * ApplicantCardDTO
         * @description RESTRICTED: only these 3 fields may ever be shown to a Senior about a Candidate.
         *
         *     This DTO is the public face of a Candidate as seen from the Senior's
         *     job-applicant list. Adding any field here requires an explicit RBAC review.
         */
        ApplicantCardDTO: {
            /** Application Status */
            application_status: string;
            /** Applied Role Title */
            applied_role_title: string;
            /** Full Name */
            full_name: string;
        };
        /**
         * ApplicationChannel
         * @description Routing configured on a Job_Description for applications (R6 AC15).
         * @enum {string}
         */
        ApplicationChannel: "Senior_Dashboard" | "Admin_Dashboard" | "External_Careers_URL";
        /**
         * ApplicationDTO
         * @description Full representation of one Application row.
         */
        ApplicationDTO: {
            /**
             * Candidate Id
             * Format: uuid
             */
            candidate_id: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Cv Version Id
             * Format: uuid
             */
            cv_version_id: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Jd Company
             * @default
             */
            jd_company: string;
            /**
             * Jd Id
             * Format: uuid
             */
            jd_id: string;
            /**
             * Jd Title
             * @default
             */
            jd_title: string;
            /** Routed Channel */
            routed_channel: string;
            /** Status */
            status: string;
            /**
             * Submitted At
             * Format: date-time
             */
            submitted_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /**
         * ApplicationStatus
         * @description Status of an in-platform Application (R7 AC6).
         * @enum {string}
         */
        ApplicationStatus: "Submitted" | "Under Review" | "Forwarded to Recruiter" | "Closed";
        /**
         * ApplyRequest
         * @description Body for POST /jobs/{jd_id}/apply.
         *
         *     A candidate may optionally name the CV variant to attach. If omitted,
         *     the service resolves the primary active variant.
         */
        ApplyRequest: {
            /** Cv Variant Id */
            cv_variant_id?: string | null;
        };
        /**
         * AuditActorDTO
         * @description Condensed actor identity snapshot in an audit entry response.
         */
        AuditActorDTO: {
            /** Account Id */
            account_id: string | null;
            /** Anonymised */
            anonymised: boolean;
            /** Display Name */
            display_name: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Is System */
            is_system: boolean;
            /** Role */
            role: string;
        };
        /**
         * AuditLogEntryDTO
         * @description Full representation of one audit log entry for Admin consumption.
         */
        AuditLogEntryDTO: {
            /** Action */
            action: string;
            actor?: components["schemas"]["AuditActorDTO"] | null;
            /** After */
            after?: Record<string, unknown> | null;
            /** Before */
            before?: Record<string, unknown> | null;
            /** Entity Id */
            entity_id: string;
            /** Entity Type */
            entity_type: string;
            /** Error Type */
            error_type?: string | null;
            /** Id */
            id: number;
            /**
             * Occurred At
             * Format: date-time
             */
            occurred_at: string;
            /** Outcome */
            outcome: string;
            /** Reason */
            reason?: string | null;
            /** Request Id */
            request_id?: string | null;
        };
        /** AuditPageMeta */
        AuditPageMeta: {
            /** Has More */
            has_more: boolean;
            /** Next After Id */
            next_after_id?: number | null;
            /** Page Size */
            page_size: number;
        };
        /**
         * AuditSearchResponse
         * @description Paginated list of audit log entries.
         */
        AuditSearchResponse: {
            /** Data */
            data: components["schemas"]["AuditLogEntryDTO"][];
            meta: components["schemas"]["AuditPageMeta"];
        };
        /** Body_upload_version_api_v1_me_cv_variants__variant_id__versions_post */
        Body_upload_version_api_v1_me_cv_variants__variant_id__versions_post: {
            /**
             * File
             * Format: binary
             */
            file: string;
        };
        /**
         * CandidateApplicationStatus
         * @description One application's status entry on the progress row.
         */
        CandidateApplicationStatus: {
            /**
             * Application Id
             * Format: uuid
             */
            application_id: string;
            /**
             * Jd Id
             * Format: uuid
             */
            jd_id: string;
            /** Jd Title */
            jd_title: string;
            /** Status */
            status: string;
            /**
             * Submitted At
             * Format: date-time
             */
            submitted_at: string;
        };
        /**
         * CandidateProfileDTO
         * @description Full candidate profile response DTO.
         */
        CandidateProfileDTO: {
            /**
             * Account Id
             * Format: uuid
             */
            account_id: string;
            /** City */
            city: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Education */
            education: components["schemas"]["EducationEntryDTO"][];
            /** Email */
            email: string | null;
            /** Full Name */
            full_name: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Languages */
            languages: components["schemas"]["LanguageEntryDTO"][];
            /** Linkedin Url */
            linkedin_url: string | null;
            /** Phone */
            phone: string | null;
            /** Skills */
            skills: components["schemas"]["SkillEntryDTO"][];
            state: components["schemas"]["ProfileState"];
            /** Summary */
            summary: string | null;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Work Experience */
            work_experience: components["schemas"]["WorkExperienceDTO"][];
        };
        /**
         * CandidateProfileUpdateRequest
         * @description Request body for PUT /me/profile.
         */
        CandidateProfileUpdateRequest: {
            /** City */
            city?: string | null;
            /** Education */
            education?: components["schemas"]["EducationEntryRequest"][] | null;
            /** Email */
            email?: string | null;
            /** Full Name */
            full_name?: string | null;
            /** Languages */
            languages?: components["schemas"]["LanguageEntryRequest"][] | null;
            /** Linkedin Url */
            linkedin_url?: string | null;
            /** Phone */
            phone?: string | null;
            /** Skills */
            skills?: components["schemas"]["SkillEntryRequest"][] | null;
            /** Summary */
            summary?: string | null;
            /** Work Experience */
            work_experience?: components["schemas"]["WorkExperienceRequest"][] | null;
        };
        /**
         * CandidateProgressReport
         * @description Paginated candidate-progress report.
         */
        CandidateProgressReport: {
            /** Has Next */
            has_next: boolean;
            /** Next Cursor */
            next_cursor: string | null;
            /** Rows */
            rows: components["schemas"]["CandidateProgressRow"][];
        };
        /**
         * CandidateProgressRow
         * @description One row in the candidate-progress report (R28 AC4).
         */
        CandidateProgressRow: {
            /**
             * Account Id
             * Format: uuid
             */
            account_id: string;
            /** Account Status */
            account_status: string;
            /** Applications */
            applications: components["schemas"]["CandidateApplicationStatus"][];
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Email */
            email: string;
        };
        /**
         * ChainVerifyResponse
         * @description Result of a manual chain-verification request.
         */
        ChainVerifyResponse: {
            /** Checked From Id */
            checked_from_id: number;
            /** First Bad Id */
            first_bad_id?: number | null;
            /** Max Id */
            max_id?: number | null;
            /** Ok */
            ok: boolean;
        };
        /**
         * ContactChannelPref
         * @description How, if at all, a Senior may be contacted about jobs (R4A AC1).
         * @enum {string}
         */
        ContactChannelPref: "Chat" | "Email" | "Both" | "None";
        /**
         * ContactScopePref
         * @description Which Job_Descriptions a Senior is contactable for (R4A AC2).
         * @enum {string}
         */
        ContactScopePref: "OwnPostingsOnly" | "SameCompany" | "FieldOfExpertise";
        /**
         * CreateRegistrationLinkRequest
         * @description Admin creation of a new registration link.
         */
        CreateRegistrationLinkRequest: {
            /**
             * Role
             * @description CANDIDATE or SENIOR
             */
            role: string;
        };
        /**
         * CreateVariantRequest
         * @description Body for POST /me/cv-variants.
         */
        CreateVariantRequest: {
            /** Description */
            description?: string | null;
            /** Name */
            name: string;
        };
        /**
         * CvUploadResponse
         * @description Response returned by the upload endpoint (202 Accepted).
         */
        CvUploadResponse: {
            /**
             * Message
             * @default Upload accepted, scan pending
             */
            message: string;
            version: components["schemas"]["CvVersionDTO"];
        };
        /**
         * CvVariantDTO
         * @description Public representation of a CV variant.
         */
        CvVariantDTO: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Description */
            description: string | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Is Archived */
            is_archived: boolean;
            /** Is Primary */
            is_primary: boolean;
            /** Name */
            name: string;
            /**
             * Version Count
             * @default 0
             */
            version_count: number;
        };
        /**
         * CvVersionDTO
         * @description Public representation of a CV version.
         */
        CvVersionDTO: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Mime Type */
            mime_type: string;
            /** Original Filename */
            original_filename: string;
            /** Size Bytes */
            size_bytes: number;
            state: components["schemas"]["CvVersionState"];
            /**
             * Variant Id
             * Format: uuid
             */
            variant_id: string;
            /** Version Number */
            version_number: number;
        };
        /**
         * CvVersionState
         * @description Availability state of a stored CV version (R5 AC3).
         * @enum {string}
         */
        CvVersionState: "PendingScan" | "Available" | "Quarantined";
        /**
         * EducationEntryDTO
         * @description Response DTO for one education entry.
         */
        EducationEntryDTO: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Degree */
            degree: string;
            /** End Year */
            end_year: number | null;
            enrolment_status: components["schemas"]["EnrolmentStatus"];
            /** Field Of Study */
            field_of_study: string | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Institution */
            institution: string;
            /** Start Year */
            start_year: number;
        };
        /**
         * EducationEntryRequest
         * @description Request schema for one education entry.
         */
        EducationEntryRequest: {
            /** Degree */
            degree: string;
            /** End Year */
            end_year?: number | null;
            enrolment_status: components["schemas"]["EnrolmentStatus"];
            /** Field Of Study */
            field_of_study?: string | null;
            /** Institution */
            institution: string;
            /** Start Year */
            start_year: number;
        };
        /**
         * EmploymentType
         * @description Job_Description employment type (R6 AC1).
         * @enum {string}
         */
        EmploymentType: "Full-time" | "Part-time" | "Contract" | "Freelance" | "Internship";
        /**
         * EnrolmentStatus
         * @description Education-entry enrolment status (R4 AC1).
         * @enum {string}
         */
        EnrolmentStatus: "Enrolled" | "Graduated";
        /**
         * ExperienceLevel
         * @description Job_Description experience band (R6 AC1).
         * @enum {string}
         */
        ExperienceLevel: "Junior-level" | "Mid-level" | "Senior-level" | "Lead";
        /**
         * ExportRequest
         * @description Body for POST /admin/exports/{entity}.
         */
        ExportRequest: {
            /** Date From */
            date_from?: string | null;
            /** Date To */
            date_to?: string | null;
            /** Jd Id */
            jd_id?: string | null;
        };
        /**
         * ExportStatus
         * @description Lifecycle state of an async report export job.
         * @enum {string}
         */
        ExportStatus: "pending" | "running" | "ready" | "failed";
        /**
         * ExportStatusDTO
         * @description Response for both POST /admin/exports/{entity} and GET /admin/exports/{job_id}.
         */
        ExportStatusDTO: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Download Url */
            download_url?: string | null;
            /** Entity Type */
            entity_type: string;
            /** Error Message */
            error_message?: string | null;
            /** Expires At */
            expires_at?: string | null;
            /**
             * Job Id
             * Format: uuid
             */
            job_id: string;
            status: components["schemas"]["ExportStatus"];
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /**
         * JdBrowsePage
         * @description Paginated list of Job Description DTOs.
         */
        JdBrowsePage: {
            /** Has Next */
            has_next: boolean;
            /** Items */
            items: components["schemas"]["JobDescriptionDTO"][];
            /** Next Cursor */
            next_cursor: string | null;
        };
        /**
         * JdCreateRequest
         * @description Request body for creating a new Job Description (POST /jobs).
         */
        JdCreateRequest: {
            application_channel?: components["schemas"]["ApplicationChannel"] | null;
            /** Company */
            company: string;
            /** Description */
            description?: string | null;
            employment_type?: components["schemas"]["EmploymentType"] | null;
            experience_level?: components["schemas"]["ExperienceLevel"] | null;
            /** External Url */
            external_url?: string | null;
            /** Location */
            location?: string | null;
            /** Required Skill Terms */
            required_skill_terms?: string[];
            /** Title */
            title: string;
            work_model?: components["schemas"]["WorkModel"] | null;
        };
        /**
         * JdExtractionDraftDTO
         * @description Polling response for an extraction draft.
         */
        JdExtractionDraftDTO: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Expires At
             * Format: date-time
             */
            expires_at: string;
            /** Extracted Fields */
            extracted_fields: Record<string, unknown>;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Skill Candidates */
            skill_candidates: unknown[];
            /** Source */
            source: string;
            /** Status */
            status: string;
        };
        /**
         * JdExtractTextRequest
         * @description Request body for POST /jobs/extract:text.
         */
        JdExtractTextRequest: {
            /** Raw Text */
            raw_text: string;
        };
        /**
         * JdExtractUrlRequest
         * @description Request body for POST /jobs/extract:url.
         */
        JdExtractUrlRequest: {
            /** Url */
            url: string;
        };
        /**
         * JdStatus
         * @description One-way Job_Description lifecycle (R6 AC2).
         * @enum {string}
         */
        JdStatus: "Draft" | "Open" | "Closed";
        /**
         * JdUpdateRequest
         * @description Request body for patching a Job Description (PATCH /jobs/{jd_id}).
         *
         *     All fields are optional; only supplied fields are applied.
         */
        JdUpdateRequest: {
            application_channel?: components["schemas"]["ApplicationChannel"] | null;
            /** Company */
            company?: string | null;
            /** Description */
            description?: string | null;
            employment_type?: components["schemas"]["EmploymentType"] | null;
            experience_level?: components["schemas"]["ExperienceLevel"] | null;
            /** External Url */
            external_url?: string | null;
            /** Location */
            location?: string | null;
            /** Required Skill Terms */
            required_skill_terms?: string[] | null;
            /** Title */
            title?: string | null;
            work_model?: components["schemas"]["WorkModel"] | null;
        };
        /**
         * JobDescriptionDTO
         * @description Full Job Description response DTO.
         */
        JobDescriptionDTO: {
            application_channel: components["schemas"]["ApplicationChannel"] | null;
            /** Closed At */
            closed_at: string | null;
            /** Company */
            company: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Creator Account Id
             * Format: uuid
             */
            creator_account_id: string;
            /** Description */
            description: string | null;
            employment_type: components["schemas"]["EmploymentType"] | null;
            experience_level: components["schemas"]["ExperienceLevel"] | null;
            /** External Url */
            external_url: string | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Location */
            location: string | null;
            /** Published At */
            published_at: string | null;
            /** Required Skill Ids */
            required_skill_ids: string[];
            status: components["schemas"]["JdStatus"];
            /** Title */
            title: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            work_model: components["schemas"]["WorkModel"] | null;
        };
        /**
         * LanguageEntryDTO
         * @description Response DTO for one language entry.
         */
        LanguageEntryDTO: {
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Language Code */
            language_code: string;
            /** Proficiency */
            proficiency: string;
        };
        /**
         * LanguageEntryRequest
         * @description Request schema for one language entry.
         */
        LanguageEntryRequest: {
            /** Language Code */
            language_code: string;
            /** Proficiency */
            proficiency: string;
        };
        /**
         * LoginRequest
         * @description Authenticate an account and receive a token pair.
         */
        LoginRequest: {
            /**
             * Email
             * Format: email
             */
            email: string;
            /** Mfa Code */
            mfa_code?: string | null;
            /** Password */
            password: string;
            /** @description ADMIN, CANDIDATE, or SENIOR */
            role: components["schemas"]["Role"];
        };
        /**
         * MfaEnrolmentDTO
         * @description Data returned when starting MFA enrolment.
         */
        MfaEnrolmentDTO: {
            /** Provisioning Uri */
            provisioning_uri: string;
            /** Qr Code Png B64 */
            qr_code_png_b64: string;
        };
        /**
         * ProfileState
         * @description Candidate profile completeness classification (R4 AC6).
         * @enum {string}
         */
        ProfileState: "Draft" | "Complete";
        /**
         * RefreshRequest
         * @description Exchange a refresh token for a new token pair.
         */
        RefreshRequest: {
            /** Refresh Token */
            refresh_token: string;
        };
        /**
         * RegistrationLinkDTO
         * @description Registration link metadata.
         *
         *     ``token`` is only populated at creation time (POST /admin/registration-links).
         *     Subsequent fetches (GET /registration-links/{token}) never re-expose it.
         */
        RegistrationLinkDTO: {
            /**
             * Expires At
             * Format: date-time
             */
            expires_at: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            role: components["schemas"]["Role"];
            /** Token */
            token?: string | null;
        };
        /**
         * RegistrationRequest
         * @description Payload for candidate or senior self-registration.
         */
        RegistrationRequest: {
            /**
             * Email
             * Format: email
             */
            email: string;
            /** Full Name */
            full_name: string;
            /**
             * Language Preference
             * @default ar
             */
            language_preference: string;
            /** Link Token */
            link_token: string;
            /** Password */
            password: string;
            /** @description MobilePhone, NationalId, or Address */
            residency_proof_type: components["schemas"]["ResidencyProofType"];
            /** Residency Proof Value */
            residency_proof_value: string;
            /**
             * Role
             * @description CANDIDATE or SENIOR
             */
            role: string;
        };
        /**
         * ResendCodeRequest
         * @description Request a new verification code email.
         */
        ResendCodeRequest: {
            /**
             * Account Id
             * Format: uuid
             */
            account_id: string;
        };
        /**
         * ResidencyProofType
         * @description The kind of residency proof stored for an account (R2 AC2).
         * @enum {string}
         */
        ResidencyProofType: "MobilePhone" | "NationalId" | "Address";
        /**
         * ReviewDTO
         * @description Read model returned from all review endpoints (R9 AC2).
         *
         *     Attributes:
         *         id:                   Review UUID.
         *         candidate_id:         UUID of the reviewed candidate account.
         *         reviewer_account_id:  UUID of the reviewer (Senior or Admin) account.
         *         jd_id:                Optional linked Job Description UUID.
         *         seq:                  Per-candidate monotonic sequence number (R9 AC9).
         *         rating_technical:     Technical rating, 1–5.
         *         rating_communication: Communication rating, 1–5.
         *         rating_culture_fit:   Culture-fit rating, 1–5.
         *         rating_overall:       Overall rating, 1–5.
         *         assessment:           Free-text assessment text.
         *         corrects_review_id:   UUID of the review this corrects, if any (R9 AC3).
         *         created_at:           UTC timestamp of submission (R9 AC2).
         */
        ReviewDTO: {
            /** Assessment */
            assessment: string;
            /**
             * Candidate Id
             * Format: uuid
             */
            candidate_id: string;
            /** Corrects Review Id */
            corrects_review_id: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Jd Id */
            jd_id: string | null;
            /** Rating Communication */
            rating_communication: number;
            /** Rating Culture Fit */
            rating_culture_fit: number;
            /** Rating Overall */
            rating_overall: number;
            /** Rating Technical */
            rating_technical: number;
            /**
             * Reviewer Account Id
             * Format: uuid
             */
            reviewer_account_id: string;
            /** Seq */
            seq: number;
        };
        /**
         * Role
         * @description The three platform roles (R1 AC1).
         * @enum {string}
         */
        Role: "ADMIN" | "CANDIDATE" | "SENIOR";
        /**
         * SeniorContactDTO
         * @description Summary of a contactable Senior, returned for JD contactability lookups.
         */
        SeniorContactDTO: {
            /**
             * Account Id
             * Format: uuid
             */
            account_id: string;
            /** Contact Channel Pref */
            contact_channel_pref: string;
            /** Full Name */
            full_name: string;
        };
        /**
         * SeniorProfileDTO
         * @description Full senior profile response DTO.
         */
        SeniorProfileDTO: {
            /**
             * Account Id
             * Format: uuid
             */
            account_id: string;
            /** Company Affiliation */
            company_affiliation: string | null;
            contact_channel_pref: components["schemas"]["ContactChannelPref"];
            contact_scope_pref: components["schemas"]["ContactScopePref"] | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Expertise Skills */
            expertise_skills: string[];
            /** Full Name */
            full_name: string;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Job Title */
            job_title: string | null;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /**
         * SeniorProfileUpdateRequest
         * @description Request body for PUT /me/senior-profile.
         */
        SeniorProfileUpdateRequest: {
            /** Company Affiliation */
            company_affiliation?: string | null;
            contact_channel_pref?: components["schemas"]["ContactChannelPref"] | null;
            contact_scope_pref?: components["schemas"]["ContactScopePref"] | null;
            /** Expertise Skills */
            expertise_skills?: string[] | null;
            /** Full Name */
            full_name?: string | null;
            /** Job Title */
            job_title?: string | null;
        };
        /**
         * SetApplicationChannelRequest
         * @description Request body for PUT /jobs/{jd_id}/application-channel.
         */
        SetApplicationChannelRequest: {
            channel: components["schemas"]["ApplicationChannel"];
        };
        /**
         * SkillEntryDTO
         * @description Response DTO for one resolved skill on a candidate profile.
         */
        SkillEntryDTO: {
            /** Name */
            name: string;
            /**
             * Skill Id
             * Format: uuid
             */
            skill_id: string;
            /** Years Experience */
            years_experience: number | null;
        };
        /**
         * SkillEntryRequest
         * @description Request schema for one skill entry — resolved to a skill_id by the service.
         */
        SkillEntryRequest: {
            /** Term */
            term: string;
            /** Years Experience */
            years_experience?: number | null;
        };
        /**
         * StatusNoticeDTO
         * @description Minimal status information for non-Approved accounts.
         */
        StatusNoticeDTO: {
            /** Next Step */
            next_step?: string | null;
            status: components["schemas"]["AccountStatus"];
        };
        /**
         * SubmitReviewRequest
         * @description Request body for POST /candidates/{candidate_id}/reviews (R9 AC2, AC3, AC5).
         *
         *     Attributes:
         *         rating_technical:     Technical skill rating, 1–5 inclusive.
         *         rating_communication: Communication skill rating, 1–5 inclusive.
         *         rating_culture_fit:   Culture-fit rating, 1–5 inclusive.
         *         rating_overall:       Overall impression rating, 1–5 inclusive.
         *         assessment:           Free-text assessment, 1–2000 characters.
         *         jd_id:                Optional — links this review to a Job Description.
         *         corrects_review_id:   Optional — marks this review as a correction of a
         *                               prior review by the same reviewer for the same
         *                               candidate (R9 AC3, AC5).
         */
        SubmitReviewRequest: {
            /**
             * Assessment
             * @description Free-text assessment
             */
            assessment: string;
            /**
             * Corrects Review Id
             * @description ID of a prior review by the same reviewer for the same candidate that this review corrects (R9 AC5). Must belong to this reviewer.
             */
            corrects_review_id?: string | null;
            /**
             * Jd Id
             * @description Optional linked Job Description ID
             */
            jd_id?: string | null;
            /**
             * Rating Communication
             * @description Communication skill rating (1–5)
             */
            rating_communication: number;
            /**
             * Rating Culture Fit
             * @description Culture-fit rating (1–5)
             */
            rating_culture_fit: number;
            /**
             * Rating Overall
             * @description Overall impression rating (1–5)
             */
            rating_overall: number;
            /**
             * Rating Technical
             * @description Technical skill rating (1–5)
             */
            rating_technical: number;
        };
        /**
         * SwitchContextRequest
         * @description Switch the active role context for a dual-role account.
         */
        SwitchContextRequest: {
            /**
             * Context
             * @description CANDIDATE or SENIOR
             */
            context: string;
        };
        /**
         * TokenResponse
         * @description OAuth2-style token response.
         */
        TokenResponse: {
            /** Access Token */
            access_token: string;
            /** Expires In */
            expires_in: number;
            /** Refresh Token */
            refresh_token: string;
            /**
             * Token Type
             * @default bearer
             */
            token_type: string;
        };
        /**
         * UpdateStatusRequest
         * @description Body for PATCH /admin/applications/{id}/status (admin only).
         */
        UpdateStatusRequest: {
            /** Reason */
            reason?: string | null;
            status: components["schemas"]["ApplicationStatus"];
        };
        /**
         * UpdateVariantRequest
         * @description Body for PATCH /me/cv-variants/{variant_id}.
         */
        UpdateVariantRequest: {
            /** Description */
            description?: string | null;
            /** Name */
            name?: string | null;
        };
        /** ValidationError */
        ValidationError: {
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
        };
        /**
         * VerifyCodeRequest
         * @description Submit the 6-digit email verification code.
         */
        VerifyCodeRequest: {
            /**
             * Account Id
             * Format: uuid
             */
            account_id: string;
            /** Code */
            code: string;
        };
        /**
         * WorkExperienceDTO
         * @description Response DTO for one work experience entry.
         */
        WorkExperienceDTO: {
            /** Company */
            company: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Description */
            description: string | null;
            /** End Date */
            end_date: string | null;
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Start Date
             * Format: date
             */
            start_date: string;
            /** Title */
            title: string;
        };
        /**
         * WorkExperienceRequest
         * @description Request schema for one work experience entry.
         */
        WorkExperienceRequest: {
            /** Company */
            company: string;
            /** Description */
            description?: string | null;
            /** End Date */
            end_date?: string | null;
            /**
             * Start Date
             * Format: date
             */
            start_date: string;
            /** Title */
            title: string;
        };
        /**
         * WorkModel
         * @description Job_Description work model (R6 AC1).
         * @enum {string}
         */
        WorkModel: "Onsite" | "Hybrid" | "Remote";
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    list_accounts_api_v1_admin_accounts_get: {
        parameters: {
            query?: {
                after_id?: string | null;
                limit?: number;
                role?: string | null;
                status?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountDTO"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    approve_account_api_v1_admin_accounts__account_id__approve_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminApproveRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    deactivate_account_api_v1_admin_accounts__account_id__deactivate_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminDeactivateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    reactivate_account_api_v1_admin_accounts__account_id__reactivate_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    record_meeting_api_v1_admin_accounts__account_id__record_meeting_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    reject_account_api_v1_admin_accounts__account_id__reject_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminRejectRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    reopen_account_api_v1_admin_accounts__account_id__reopen_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    suspend_account_api_v1_admin_accounts__account_id__suspend_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminSuspendRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_roles_api_v1_admin_accounts__account_id__roles_put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminRoleUpdateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    admin_update_application_status_api_v1_admin_applications__application_id__status_patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                application_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateStatusRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApplicationDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    search_audit_api_v1_admin_audit_get: {
        parameters: {
            query?: {
                action?: string | null;
                actor_account_id?: string | null;
                after_id?: number | null;
                entity_id?: string | null;
                entity_type?: string | null;
                from_dt?: string | null;
                page_size?: number;
                to_dt?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditSearchResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    anonymise_actor_endpoint_api_v1_admin_audit_actors__account_id__anonymise_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, unknown>;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    verify_chain_api_v1_admin_audit_chain_verify_get: {
        parameters: {
            query?: {
                start_id?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChainVerifyResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    admin_get_candidate_profile_api_v1_admin_candidates__account_id__profile_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CandidateProfileDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    admin_list_variants_api_v1_admin_candidates__candidate_id__cv_variants_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                candidate_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CvVariantDTO"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    admin_download_version_api_v1_admin_candidates__candidate_id__cv_variants__variant_id__versions__version_number__download_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                candidate_id: string;
                variant_id: string;
                version_number: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    request_export_api_v1_admin_exports__entity_type__post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                entity_type: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExportRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExportStatusDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_export_status_api_v1_admin_exports__job_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExportStatusDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    admin_list_jds_api_v1_admin_jobs_get: {
        parameters: {
            query?: {
                after_id?: string | null;
                limit?: number;
                status?: components["schemas"]["JdStatus"] | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JdBrowsePage"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_registration_link_api_v1_admin_registration_links_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateRegistrationLinkRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RegistrationLinkDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_activity_report_api_v1_admin_reports_activity_get: {
        parameters: {
            query?: {
                /** @description ISO-8601 UTC lower bound */
                date_from?: string | null;
                /** @description ISO-8601 UTC upper bound */
                date_to?: string | null;
                /** @description Filter applications by JD */
                jd_id?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActivityReportDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_candidate_progress_api_v1_admin_reports_candidate_progress_get: {
        parameters: {
            query?: {
                /** @description Pagination cursor (account id) */
                after_id?: string | null;
                /** @description Page size */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CandidateProgressReport"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    admin_get_senior_profile_api_v1_admin_seniors__account_id__profile_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SeniorProfileDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    admin_list_pending_skills_api_v1_admin_skills_pending_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, unknown>[];
                };
            };
        };
    };
    switch_context_api_v1_auth_context_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SwitchContextRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    login_api_v1_auth_login_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    logout_api_v1_auth_logout_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    enroll_mfa_api_v1_auth_mfa_enroll_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MfaEnrolmentDTO"];
                };
            };
        };
    };
    verify_mfa_code_api_v1_auth_mfa_verify_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VerifyCodeRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: boolean;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    refresh_token_api_v1_auth_refresh_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RefreshRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    admin_list_reviews_api_v1_candidates__candidate_id__reviews_get: {
        parameters: {
            query?: {
                /** @description Keyset cursor: UUID complement for equal seq */
                after_id?: string | null;
                /** @description Keyset cursor: seq lower bound */
                after_seq?: number | null;
                /** @description ISO-8601 UTC lower bound on created_at */
                date_from?: string | null;
                /** @description ISO-8601 UTC upper bound on created_at */
                date_to?: string | null;
                /** @description Filter by linked Job Description */
                jd_id?: string | null;
                /** @description Page size */
                limit?: number;
                /** @description Filter by reviewer account */
                reviewer_id?: string | null;
            };
            header?: never;
            path: {
                candidate_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReviewDTO"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    submit_review_api_v1_candidates__candidate_id__reviews_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                candidate_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubmitReviewRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReviewDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    senior_list_own_reviews_api_v1_candidates__candidate_id__reviews_mine_get: {
        parameters: {
            query?: {
                /** @description Keyset cursor: seq lower bound */
                after_seq?: number | null;
                /** @description Page size */
                limit?: number;
            };
            header?: never;
            path: {
                candidate_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReviewDTO"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    browse_jds_api_v1_jobs_get: {
        parameters: {
            query?: {
                after_id?: string | null;
                after_published_at?: string | null;
                employment_type?: components["schemas"]["EmploymentType"] | null;
                experience_level?: components["schemas"]["ExperienceLevel"] | null;
                limit?: number;
                location?: string | null;
                search?: string | null;
                skills?: string[];
                work_model?: components["schemas"]["WorkModel"] | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JdBrowsePage"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_jd_api_v1_jobs_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JdCreateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobDescriptionDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_jd_api_v1_jobs__jd_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jd_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobDescriptionDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_jd_api_v1_jobs__jd_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jd_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JdUpdateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobDescriptionDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    close_jd_api_v1_jobs__jd_id__close_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jd_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobDescriptionDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    publish_jd_api_v1_jobs__jd_id__publish_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jd_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobDescriptionDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_jd_applicants_api_v1_jobs__jd_id__applicants_get: {
        parameters: {
            query?: {
                /** @description Pagination cursor */
                after_id?: string | null;
                /** @description Page size */
                limit?: number;
                /** @description Filter by status */
                status?: components["schemas"]["ApplicationStatus"] | null;
            };
            header?: never;
            path: {
                jd_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApplicantCardDTO"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_application_channel_api_v1_jobs__jd_id__application_channel_put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jd_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetApplicationChannelRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobDescriptionDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    submit_application_api_v1_jobs__jd_id__apply_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jd_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApplyRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApplicationDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_contactable_seniors_api_v1_jobs__jd_id__contactable_seniors_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jd_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SeniorContactDTO"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    extract_text_api_v1_jobs_extract_text_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JdExtractTextRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JdExtractionDraftDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    extract_url_api_v1_jobs_extract_url_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JdExtractUrlRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JdExtractionDraftDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_extraction_draft_api_v1_jobs_extract__draft_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draft_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JdExtractionDraftDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    confirm_extraction_draft_api_v1_jobs_extract__draft_id__confirm_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                draft_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JdCreateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobDescriptionDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_my_applications_api_v1_me_applications_get: {
        parameters: {
            query?: {
                /** @description Pagination cursor (application id) */
                after_id?: string | null;
                /** @description Page size */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApplicationDTO"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_my_application_api_v1_me_applications__application_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                application_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApplicationDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_variants_api_v1_me_cv_variants_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CvVariantDTO"][];
                };
            };
        };
    };
    create_variant_api_v1_me_cv_variants_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateVariantRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CvVariantDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    archive_variant_api_v1_me_cv_variants__variant_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_variant_api_v1_me_cv_variants__variant_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateVariantRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CvVariantDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    set_primary_variant_api_v1_me_cv_variants__variant_id__primary_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CvVariantDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_versions_api_v1_me_cv_variants__variant_id__versions_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CvVersionDTO"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_version_api_v1_me_cv_variants__variant_id__versions_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_version_api_v1_me_cv_variants__variant_id__versions_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CvUploadResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    download_version_api_v1_me_cv_variants__variant_id__versions__version_number__download_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                variant_id: string;
                version_number: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_my_candidate_profile_api_v1_me_profile_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CandidateProfileDTO"];
                };
            };
        };
    };
    update_my_candidate_profile_api_v1_me_profile_put: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CandidateProfileUpdateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CandidateProfileDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_my_senior_profile_api_v1_me_senior_profile_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SeniorProfileDTO"];
                };
            };
        };
    };
    update_my_senior_profile_api_v1_me_senior_profile_put: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SeniorProfileUpdateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SeniorProfileDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_my_status_api_v1_me_status_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusNoticeDTO"];
                };
            };
        };
    };
    register_candidate_api_v1_register_candidate_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegistrationRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    register_senior_api_v1_register_senior_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegistrationRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_registration_link_api_v1_registration_links__token__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                token: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RegistrationLinkDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    search_skills_api_v1_skills_get: {
        parameters: {
            query?: {
                /** @description Search term */
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, unknown>[];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    verify_code_api_v1_verify_code_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VerifyCodeRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountDTO"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    resend_code_api_v1_verify_resend_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResendCodeRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
}
