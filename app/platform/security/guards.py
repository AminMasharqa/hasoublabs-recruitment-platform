"""RBAC authorization guards – stub for Task 1 skeleton.

Full implementation in Section 4 (Karim, Wave A).
This stub exposes PUBLIC_ROUTE_PATHS so main.py can import it at startup.
"""

from __future__ import annotations

# Routes that are exempt from the authorization-dependency requirement (R3 AC8).
# Matched as prefix against route.path.
PUBLIC_ROUTE_PATHS: frozenset[str] = frozenset(
    {
        "/health",
        "/api/v1/auth/login",
        "/api/v1/auth/refresh",
        "/api/v1/auth/password-reset",
        "/api/v1/register",  # registration link validation + form
        "/api/v1/verify",  # verification code entry
        "/api/v1/registration-links",  # Admin-generated link fetch (public token)
    }
)
