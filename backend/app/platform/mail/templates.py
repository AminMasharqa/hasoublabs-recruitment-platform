"""Email templates for the Phase 1 notification events.

Exactly the events the requirements' "Phase 1 Notifications (Minimal)"
constraint lists — no more, so Requirement 19 (Phase 2) extends this enum rather
than reworking it. Bodies come from the Babel catalogs, so every mail is
localized to the recipient's stored language preference.

Required parameters are declared per template and checked at *enqueue* time. A
missing parameter discovered at send time would mean an already-committed row
that can never render; catching it in the caller's transaction turns a
permanently stuck email into an ordinary programming error.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING, Any, Final

from app.platform.i18n.catalog import translate

if TYPE_CHECKING:
    from collections.abc import Mapping

    from app.platform.mail.secrets import ShortLivedSecretStore

#: Payload member holding ``{parameter_name: secret_reference}``. This is a
#: payload field *name*, not a credential (hence the bandit waiver).
SECRET_REFS_KEY: Final[str] = "secret_refs"  # noqa: S105


class EmailTemplate(StrEnum):
    """The Phase 1 transactional emails."""

    VERIFICATION_CODE = "verification_code"
    REGISTRATION_AWAITING_REVIEW = "registration_awaiting_review"
    ONBOARDING_MEETING_REQUIRED = "onboarding_meeting_required"
    ACCOUNT_APPROVED = "account_approved"
    ACCOUNT_REJECTED = "account_rejected"
    APPLICATION_SUBMITTED = "application_submitted"
    APPLICATION_STATUS_CHANGED = "application_status_changed"
    CV_QUARANTINED = "cv_quarantined"
    CV_INTEGRITY_FAILED = "cv_integrity_failed"

    @property
    def subject_key(self) -> str:
        return f"email.{self.value}.subject"

    @property
    def body_key(self) -> str:
        return f"email.{self.value}.body"


#: Parameters each template's body interpolates. A parameter may be supplied
#: either directly in the payload or as a secret reference.
REQUIRED_PARAMS: Final[dict[EmailTemplate, frozenset[str]]] = {
    EmailTemplate.VERIFICATION_CODE: frozenset({"full_name", "code", "expiry_hours"}),
    EmailTemplate.REGISTRATION_AWAITING_REVIEW: frozenset({"full_name", "role"}),
    EmailTemplate.ONBOARDING_MEETING_REQUIRED: frozenset({"full_name"}),
    EmailTemplate.ACCOUNT_APPROVED: frozenset({"full_name"}),
    EmailTemplate.ACCOUNT_REJECTED: frozenset({"full_name", "reason"}),
    EmailTemplate.APPLICATION_SUBMITTED: frozenset({"full_name", "job_title", "company"}),
    EmailTemplate.APPLICATION_STATUS_CHANGED: frozenset({"full_name", "job_title", "status"}),
    EmailTemplate.CV_QUARANTINED: frozenset({"full_name", "file_name"}),
    EmailTemplate.CV_INTEGRITY_FAILED: frozenset({"full_name", "file_name"}),
}


class TemplateRenderError(RuntimeError):
    """A template cannot be rendered, and retrying will not help.

    Raised for a missing parameter or an expired secret reference. The drainer
    treats it as a permanent failure rather than burning retries on a row that
    can never succeed.
    """


@dataclass(frozen=True, slots=True)
class RenderedEmail:
    """A localized, ready-to-send message."""

    subject: str
    text_body: str


def missing_params(
    template: EmailTemplate,
    payload: Mapping[str, Any],
) -> frozenset[str]:
    """Return required parameters absent from ``payload`` and its secret refs."""
    provided = set(payload) | set(payload.get(SECRET_REFS_KEY, {}))
    return frozenset(REQUIRED_PARAMS.get(template, frozenset()) - provided)


async def render(
    template: EmailTemplate,
    *,
    locale: str,
    payload: Mapping[str, Any],
    secret_store: ShortLivedSecretStore | None = None,
) -> RenderedEmail:
    """Render ``template`` in ``locale``, redeeming secret references first."""
    params: dict[str, Any] = {
        key: value for key, value in payload.items() if key != SECRET_REFS_KEY
    }

    secret_refs: Mapping[str, str] = payload.get(SECRET_REFS_KEY) or {}
    if secret_refs:
        if secret_store is None:
            msg = f"{template}: payload has secret refs but no secret store is configured"
            raise TemplateRenderError(msg)
        for name, ref in secret_refs.items():
            value = await secret_store.pop(ref)
            if value is None:
                msg = f"{template}: secret reference for {name!r} expired"
                raise TemplateRenderError(msg)
            params[name] = value

    absent = REQUIRED_PARAMS.get(template, frozenset()) - set(params)
    if absent:
        msg = f"{template}: missing parameters {sorted(absent)}"
        raise TemplateRenderError(msg)

    subject = translate(template.subject_key, locale)
    body = translate(template.body_key, locale, **params)
    signature = translate("email.signature", locale)
    return RenderedEmail(subject=subject, text_body=f"{body}\n\n-- \n{signature}\n")
