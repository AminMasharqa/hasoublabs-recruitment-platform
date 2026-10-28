"""Audit foundation: audit_actor_identities, audit_log (partitioned), triggers.

Revision ID: 0002_audit_foundation
Revises: 0001_platform_baseline
Create Date: 2026-09-20

Creates:
* ``audit_actor_identities`` — identity snapshot store (anonymisable sidecar).
* ``audit_log`` — append-only, RANGE-partitioned by ``occurred_at`` (monthly).
  The parent table is created here; child partitions for the current and next
  calendar month are created by a separate call to ``ensure_current_partition``
  and ``ensure_next_partition`` (triggered at startup and monthly by ARQ).
* BEFORE UPDATE OR DELETE trigger on ``audit_log`` that raises an exception,
  making the append-only guarantee a two-layer defence (application role grants
  + DB trigger).
* INSERT + SELECT grants on both tables for the application role
  (``hasoub_app``). If the role does not exist the GRANT is skipped.

Note on partitioned indexes
---------------------------
PostgreSQL propagates indexes declared on the parent partitioned table to all
child partitions automatically (PostgreSQL 11+). The migration therefore creates
them on the parent; no per-partition DDL is needed.

Note on FK from audit_log to audit_actor_identities
----------------------------------------------------
A FK on a partitioned table's column works in PostgreSQL 12+ when the FK column
is part of the partition key OR when it references the parent table. Because
``actor_identity_id`` is NOT the partition key, we declare the FK as a plain
CHECK CONSTRAINT naming the referenced table name instead of a REFERENCES clause,
to avoid the PostgreSQL limitation on FKs from partitioned tables to non-
partitioned tables in some older minor versions. The application layer enforces
referential integrity via the upsert pattern in ``repository.py``.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0002_audit_foundation"
down_revision = "0001_platform_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── audit_actor_identities ────────────────────────────────────────────────
    op.create_table(
        "audit_actor_identities",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("role", sa.String(50), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column(
            "is_system",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "anonymised_at",
            postgresql.TIMESTAMP(timezone=True, precision=3),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_audit_actor_identities"),
        sa.UniqueConstraint(
            "account_id",
            "role",
            name="uq_audit_actor_identities_account_id_role",
        ),
    )
    op.create_index(
        "idx_audit_actor_identities_account_id",
        "audit_actor_identities",
        ["account_id"],
    )

    # Insert the system sentinel row (zero UUID).
    op.execute(
        """
        INSERT INTO audit_actor_identities (id, account_id, role, display_name, is_system)
        VALUES (
            '00000000-0000-0000-0000-000000000000',
            NULL,
            'system',
            'system',
            true
        )
        ON CONFLICT DO NOTHING
        """
    )

    # ── audit_log (partitioned parent) ────────────────────────────────────────
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_log (
            id              BIGSERIAL,
            occurred_at     TIMESTAMPTZ(3) NOT NULL,
            actor_identity_id UUID NOT NULL
                REFERENCES audit_actor_identities(id)
                    ON DELETE RESTRICT
                    ON UPDATE RESTRICT,
            action          VARCHAR(200)   NOT NULL,
            entity_type     VARCHAR(100)   NOT NULL,
            entity_id       VARCHAR(200)   NOT NULL,
            before          JSONB,
            after           JSONB,
            reason          TEXT,
            request_id      VARCHAR(64),
            outcome         VARCHAR(20)    NOT NULL DEFAULT 'success',
            error_type      VARCHAR(200),
            prev_hash       BYTEA,
            entry_hash      BYTEA,
            PRIMARY KEY (id, occurred_at)
        ) PARTITION BY RANGE (occurred_at)
        """
    )

    # Propagated indexes (PostgreSQL auto-creates these on each child partition).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_audit_log_entity_type_entity_id_occurred_at
        ON audit_log (entity_type, entity_id, occurred_at)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_audit_log_actor_identity_id_occurred_at
        ON audit_log (actor_identity_id, occurred_at)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_audit_log_action_occurred_at
        ON audit_log (action, occurred_at)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at_brin
        ON audit_log USING BRIN (occurred_at)
        """
    )

    # ── BEFORE UPDATE OR DELETE reject trigger ────────────────────────────────
    op.execute(
        """
        CREATE OR REPLACE FUNCTION audit_log_reject_mutation()
        RETURNS TRIGGER LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION
                'audit_log is append-only: UPDATE and DELETE are not permitted (entry id=%)',
                OLD.id
                USING ERRCODE = 'insufficient_privilege';
            RETURN NULL;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_audit_log_no_mutation
        BEFORE UPDATE OR DELETE ON audit_log
        FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation()
        """
    )

    # ── INSERT + SELECT grants ─────────────────────────────────────────────────
    # The hasoub_app role may not exist in all environments (e.g. fresh CI
    # containers use the default postgres superuser). Skip gracefully.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hasoub_app') THEN
                GRANT INSERT, SELECT ON audit_log TO hasoub_app;
                GRANT INSERT, SELECT ON audit_actor_identities TO hasoub_app;
                -- Allow the BIGSERIAL sequence to advance.
                GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO hasoub_app;
            END IF;
        END;
        $$
        """
    )

    # ── Default partitions for current and next month ─────────────────────────
    # We create them inline here so the migration is self-contained.  The ARQ
    # monthly job keeps them rolling forward after initial deployment.
    op.execute(
        """
        DO $$
        DECLARE
            this_month DATE := DATE_TRUNC('month', NOW())::DATE;
            next_month DATE := (DATE_TRUNC('month', NOW()) + INTERVAL '1 month')::DATE;
            after_next  DATE := (DATE_TRUNC('month', NOW()) + INTERVAL '2 months')::DATE;
            tbl_this TEXT := 'audit_log_' || TO_CHAR(this_month, 'YYYY_MM');
            tbl_next TEXT := 'audit_log_' || TO_CHAR(next_month, 'YYYY_MM');
        BEGIN
            EXECUTE format(
                'CREATE TABLE IF NOT EXISTS %I
                 PARTITION OF audit_log
                 FOR VALUES FROM (%L) TO (%L)',
                tbl_this, this_month, next_month
            );
            EXECUTE format(
                'CREATE TABLE IF NOT EXISTS %I
                 PARTITION OF audit_log
                 FOR VALUES FROM (%L) TO (%L)',
                tbl_next, next_month, after_next
            );
        END;
        $$
        """
    )


def downgrade() -> None:
    # Drop partitions first (child tables must go before parent).
    op.execute(
        """
        DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN
                SELECT inhrelid::regclass AS child
                FROM   pg_inherits
                WHERE  inhparent = 'audit_log'::regclass
            LOOP
                EXECUTE 'DROP TABLE IF EXISTS ' || r.child;
            END LOOP;
        END;
        $$
        """
    )
    op.execute("DROP TRIGGER IF EXISTS trg_audit_log_no_mutation ON audit_log")
    op.execute("DROP FUNCTION IF EXISTS audit_log_reject_mutation()")
    op.execute("DROP TABLE IF EXISTS audit_log")
    op.execute("DROP TABLE IF EXISTS audit_actor_identities")
