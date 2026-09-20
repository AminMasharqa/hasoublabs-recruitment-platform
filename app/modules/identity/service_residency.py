"""ResidencyValidator — pure, deterministic, synchronous (R2 AC2, Task 11.2).

Three sub-validators:
1. Israeli mobile phone: E.164 parsing via phonenumbers, prefix check via
   ReferenceDataService.
2. National ID: 9 digits, Israeli Luhn-like check digit algorithm.
3. Address: non-empty city resolving against israeli_localities via
   ReferenceDataService.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

import phonenumbers
from phonenumbers import PhoneNumberFormat, PhoneNumberType, is_valid_number, number_type

from app.platform.db.enums import ResidencyProofType
from app.platform.reference.service import ReferenceDataService

logger = logging.getLogger(__name__)

# ── Version constant ───────────────────────────────────────────────────────
# Bumped whenever the validation algorithm changes (not just reference data).
# Stored in residency_proofs.validator_version alongside the dataset version
# so we can identify which algorithm accepted a proof.
VALIDATOR_VERSION_PREFIX = "identity-v1"

# Israeli country code
_IL_COUNTRY_CODE = "IL"

# Mobile number types that are acceptable
_MOBILE_TYPES = frozenset(
    {
        PhoneNumberType.MOBILE,
        PhoneNumberType.FIXED_LINE_OR_MOBILE,
    }
)


# ── Result type ────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class ResidencyValidationResult:
    """Outcome of one residency-proof validation attempt.

    Attributes:
        is_valid: True if the proof passed all checks.
        reason: Human-readable failure reason (None when is_valid is True).
        validator_version: Composite version string to stamp onto the proof row.
            Format: ``<VALIDATOR_VERSION_PREFIX>+<dataset_version>``.
    """

    is_valid: bool
    reason: str | None
    validator_version: str


# ── Validator ──────────────────────────────────────────────────────────────


class ResidencyValidator:
    """Validates residency proofs against Israeli reference data.

    The validator is constructed once per application startup and injected
    into RegistrationService. It is intentionally stateless beyond the
    ReferenceDataService reference so it is safe to share across coroutines.
    """

    def __init__(self, reference_service: ReferenceDataService) -> None:
        self._ref = reference_service

    async def validate(
        self,
        proof_type: ResidencyProofType,
        value: str,
    ) -> ResidencyValidationResult:
        """Dispatch to the correct sub-validator and return the result.

        Args:
            proof_type: The type of proof being validated.
            value: The raw string value as submitted by the registrant.

        Returns:
            A :class:`ResidencyValidationResult` describing pass/fail.
        """
        dataset_version = self._ref.current_dataset_version()
        composite_version = f"{VALIDATOR_VERSION_PREFIX}+{dataset_version}"

        if proof_type == ResidencyProofType.MOBILE_PHONE:
            ok, reason = await self._validate_mobile_phone(value)
        elif proof_type == ResidencyProofType.NATIONAL_ID:
            ok = self._validate_national_id(value)
            reason = None if ok else "National ID failed check-digit validation"
        elif proof_type == ResidencyProofType.ADDRESS:
            ok, reason = await self._validate_address(value)
        else:
            ok = False
            reason = f"Unknown residency proof type: {proof_type}"

        return ResidencyValidationResult(
            is_valid=ok,
            reason=reason,
            validator_version=composite_version,
        )

    # ── Mobile phone ───────────────────────────────────────────────────────

    async def _validate_mobile_phone(self, value: str) -> tuple[bool, str | None]:
        """Validate an Israeli mobile number.

        Returns (True, None) on success or (False, reason) on failure.
        Steps:
          1. Parse and E.164-validate via phonenumbers library (sync).
          2. Confirm the number is from Israel.
          3. Confirm the number type is MOBILE or FIXED_LINE_OR_MOBILE.
          4. Extract the local prefix (e.g. "050") and look it up in
             ReferenceDataService.
        """
        parsed_ok, parsed_number, reason = self._validate_mobile_phone_sync(value)
        if not parsed_ok or parsed_number is None:
            return False, reason

        # Extract the local prefix (first 3 digits of the national significant
        # number, without the leading 0 stripped by E.164 formatting).
        national = phonenumbers.format_number(parsed_number, PhoneNumberFormat.NATIONAL)
        # National format in IL is "0XX-XXX-XXXX"; take the leading digits.
        digits_only = "".join(c for c in national if c.isdigit())
        if len(digits_only) < 3:  # noqa: PLR2004
            return False, "Could not extract mobile prefix from number"

        prefix = digits_only[:3]
        prefix_valid = await self._validate_mobile_prefix(prefix)
        if not prefix_valid:
            return False, f"Mobile prefix {prefix!r} is not a recognised Israeli mobile prefix"

        return True, None

    def _validate_mobile_phone_sync(
        self, value: str
    ) -> tuple[bool, phonenumbers.PhoneNumber | None, str | None]:
        """Synchronous portion of mobile phone validation.

        Parses and validates the phone number using the phonenumbers library.

        Returns:
            (success, parsed_number_or_None, error_reason_or_None)
        """
        try:
            parsed = phonenumbers.parse(value, _IL_COUNTRY_CODE)
        except phonenumbers.NumberParseException as exc:
            return False, None, f"Could not parse phone number: {exc}"

        if not is_valid_number(parsed):
            return False, None, "Phone number is not valid"

        # Must be an Israeli number.
        if parsed.country_code != 972:  # noqa: PLR2004
            return False, None, "Phone number is not an Israeli number (+972)"

        # Must be a mobile number.
        ntype = number_type(parsed)
        if ntype not in _MOBILE_TYPES:
            return False, None, "Phone number is not a mobile number"

        return True, parsed, None

    async def _validate_mobile_prefix(self, prefix: str) -> bool:
        """Check whether the 3-digit prefix is an active Israeli mobile prefix.

        Delegates to :meth:`ReferenceDataService.is_valid_mobile_prefix`.
        """
        return await self._ref.is_valid_mobile_prefix(prefix)

    # ── National ID ────────────────────────────────────────────────────────

    def _validate_national_id(self, value: str) -> bool:
        """Validate an Israeli national ID using the Luhn-like check digit.

        Rules:
        - Must be exactly 9 decimal digits (leading zeros are significant).
        - Alternately multiply each digit by 1 and 2 (starting with 1 at
          position 0).
        - If the product is ≥ 10, subtract 9 from it (equivalent to summing
          its two decimal digits for single-digit results of at most 18).
        - Sum all nine (possibly adjusted) values.
        - The sum must be divisible by 10.

        Returns True if valid, False otherwise.
        """
        # Strip any formatting characters.
        stripped = value.strip().replace("-", "").replace(" ", "")

        if len(stripped) != 9 or not stripped.isdigit():  # noqa: PLR2004
            return False

        total = 0
        for i, ch in enumerate(stripped):
            digit = int(ch)
            if i % 2 == 1:  # odd positions (0-indexed): multiply by 2
                product = digit * 2
                if product > 9:  # noqa: PLR2004
                    product -= 9
                total += product
            else:
                total += digit

        return total % 10 == 0

    # ── Address ────────────────────────────────────────────────────────────

    async def _validate_address(self, value: str) -> tuple[bool, str | None]:
        """Validate that the supplied address contains a resolvable Israeli city.

        The value is expected to be a JSON string with at least a ``city`` key.
        The city is resolved against the reference-data locality table via
        :meth:`ReferenceDataService.resolve_locality`.

        Returns (True, None) on success or (False, reason) on failure.
        """
        # Parse JSON envelope.
        try:
            parsed = json.loads(value)
        except (json.JSONDecodeError, ValueError):
            # Accept plain-string city names too (backward compat / flexibility).
            city_name = value.strip()
        else:
            if not isinstance(parsed, dict):
                return False, "Address value must be a JSON object with a 'city' field"
            city_name = parsed.get("city", "").strip()

        if not city_name:
            return False, "Address city field is empty"

        match = await self._ref.resolve_locality(city_name)
        if match is None:
            return False, f"City {city_name!r} could not be resolved to an Israeli locality"

        return True, None
