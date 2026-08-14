-- Initial schema.
--
-- Generated shape from packages/db/src/schema.ts, plus two things Drizzle cannot express
-- and that are too important to leave to application code:
--
--   1. A deferred constraint trigger asserting the ledger balances per currency.
--   2. Append-only enforcement on order_event and ledger_entry.

CREATE TYPE "order_state" AS ENUM (
  'DRAFT','QUOTING','QUOTED','AWAITING_PAYMENT','PAID','PROCUREMENT_PENDING','PURCHASED',
  'SELLER_PROCESSING','LOCAL_TRANSIT','WAREHOUSE_RECEIVED','INTERNATIONAL_TRANSIT','CUSTOMS',
  'DOMESTIC_TRANSIT','DELIVERED','PRICE_CHANGED','OUT_OF_STOCK','PAYMENT_FAILED',
  'PROCUREMENT_FAILED','CUSTOMER_ACTION_REQUIRED','SHIPMENT_EXCEPTION','CUSTOMS_EXCEPTION',
  'REFUND_PENDING','REFUNDED','CANCELLED'
);

CREATE TYPE "currency" AS ENUM ('IRR','AED','USD','TRY','EUR','GBP');

CREATE TABLE "customer" (
  "id" uuid PRIMARY KEY,
  "phone_e164" text NOT NULL,
  "display_name" text,
  "locale" text NOT NULL DEFAULT 'fa',
  "display_name_normalized" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "customer_phone_uq" ON "customer" ("phone_e164");
CREATE INDEX "customer_name_idx" ON "customer" ("display_name_normalized");

CREATE TABLE "identity" (
  "id" uuid PRIMARY KEY,
  "customer_id" uuid NOT NULL REFERENCES "customer"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "subject" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "identity_provider_subject_uq" ON "identity" ("provider","subject");
CREATE INDEX "identity_customer_idx" ON "identity" ("customer_id");

CREATE TABLE "refresh_token" (
  "id" uuid PRIMARY KEY,
  "customer_id" uuid NOT NULL REFERENCES "customer"("id") ON DELETE CASCADE,
  "family_id" uuid NOT NULL,
  "token_hash" text NOT NULL,
  "used_at" timestamptz,
  "revoked_at" timestamptz,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "refresh_token_hash_uq" ON "refresh_token" ("token_hash");
CREATE INDEX "refresh_token_family_idx" ON "refresh_token" ("family_id");

CREATE TABLE "otp_challenge" (
  "id" uuid PRIMARY KEY,
  "phone_e164" text NOT NULL,
  "code_hash" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "consumed_at" timestamptz,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "otp_phone_idx" ON "otp_challenge" ("phone_e164","created_at");

CREATE TABLE "address" (
  "id" uuid PRIMARY KEY,
  "customer_id" uuid NOT NULL REFERENCES "customer"("id") ON DELETE CASCADE,
  "recipient_name" text NOT NULL,
  "national_id" text,
  "phone_e164" text NOT NULL,
  "province" text NOT NULL,
  "city" text NOT NULL,
  "line1" text NOT NULL,
  "postal_code" text NOT NULL,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "address_customer_idx" ON "address" ("customer_id");

CREATE TABLE "product_request" (
  "id" uuid PRIMARY KEY,
  "customer_id" uuid REFERENCES "customer"("id") ON DELETE SET NULL,
  "source_url" text NOT NULL,
  "url_hash" text NOT NULL,
  "marketplace" text,
  "external_product_id" text,
  "status" text NOT NULL DEFAULT 'PENDING',
  "failure_reason" text,
  "resolution" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "product_request_hash_idx" ON "product_request" ("url_hash");
CREATE INDEX "product_request_customer_idx" ON "product_request" ("customer_id","created_at");

CREATE TABLE "quote" (
  "id" uuid PRIMARY KEY,
  "product_request_id" uuid NOT NULL REFERENCES "product_request"("id"),
  "customer_id" uuid REFERENCES "customer"("id") ON DELETE SET NULL,
  "product_snapshot" jsonb NOT NULL,
  "quantity" integer NOT NULL DEFAULT 1,
  "fx_rate_micro" bigint NOT NULL,
  "breakdown" jsonb NOT NULL,
  "final_amount_minor" bigint NOT NULL,
  "final_currency" "currency" NOT NULL,
  "max_procurement_minor" bigint NOT NULL,
  "max_procurement_currency" "currency" NOT NULL,
  "overhead_ratio" numeric(6,4) NOT NULL,
  "risk_factor" numeric(6,4) NOT NULL DEFAULT 0,
  "viable" boolean NOT NULL,
  "superseded_by_quote_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL
);
CREATE INDEX "quote_customer_idx" ON "quote" ("customer_id","created_at");
CREATE INDEX "quote_expiry_idx" ON "quote" ("expires_at");

CREATE TABLE "order" (
  "id" uuid PRIMARY KEY,
  "public_ref" text NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customer"("id"),
  "quote_id" uuid NOT NULL REFERENCES "quote"("id"),
  "address_id" uuid REFERENCES "address"("id"),
  "state" "order_state" NOT NULL DEFAULT 'DRAFT',
  "max_procurement_minor" bigint NOT NULL,
  "max_procurement_currency" "currency" NOT NULL,
  "total_amount_minor" bigint NOT NULL,
  "total_currency" "currency" NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "sandbox_session_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "order_public_ref_uq" ON "order" ("public_ref");
CREATE INDEX "order_customer_idx" ON "order" ("customer_id","created_at");
CREATE INDEX "order_state_idx" ON "order" ("state","updated_at");
CREATE INDEX "order_sandbox_idx" ON "order" ("sandbox_session_id");

CREATE TABLE "order_event" (
  "seq" bigserial PRIMARY KEY,
  "order_id" uuid NOT NULL REFERENCES "order"("id") ON DELETE CASCADE,
  "from_state" "order_state",
  "to_state" "order_state" NOT NULL,
  "actor" text NOT NULL,
  "reason" text,
  "payload" jsonb,
  "correlation_id" text NOT NULL,
  "at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "order_event_order_idx" ON "order_event" ("order_id","seq");

CREATE TABLE "payment" (
  "id" uuid PRIMARY KEY,
  "order_id" uuid NOT NULL REFERENCES "order"("id"),
  "provider" text NOT NULL,
  "provider_ref" text NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" "currency" NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "failure_reason" text,
  "idempotency_key" text NOT NULL,
  "settled_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "payment_provider_ref_uq" ON "payment" ("provider","provider_ref");
CREATE INDEX "payment_order_idx" ON "payment" ("order_id");

CREATE TABLE "procurement_order" (
  "id" uuid PRIMARY KEY,
  "order_id" uuid NOT NULL REFERENCES "order"("id"),
  "marketplace" text NOT NULL,
  "external_product_id" text NOT NULL,
  "external_order_id" text,
  "quantity" integer NOT NULL DEFAULT 1,
  "expected_price_minor" bigint NOT NULL,
  "actual_price_minor" bigint,
  "currency" "currency" NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "failure_reason" text,
  "confirmed_by" text,
  "confirmed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "procurement_order_idx" ON "procurement_order" ("order_id");
CREATE INDEX "procurement_status_idx" ON "procurement_order" ("status","created_at");

CREATE TABLE "shipment" (
  "id" uuid PRIMARY KEY,
  "order_id" uuid NOT NULL REFERENCES "order"("id"),
  "carrier_shipment_id" text,
  "status" text NOT NULL DEFAULT 'CREATED',
  "last_event_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "shipment_order_idx" ON "shipment" ("order_id");
CREATE INDEX "shipment_stall_idx" ON "shipment" ("status","last_event_at");

CREATE TABLE "tracking_event" (
  "seq" bigserial PRIMARY KEY,
  "shipment_id" uuid NOT NULL REFERENCES "shipment"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  "raw_status" text NOT NULL,
  "location" jsonb,
  "occurred_at" timestamptz NOT NULL,
  "dedupe_key" text NOT NULL
);
CREATE UNIQUE INDEX "tracking_dedupe_uq" ON "tracking_event" ("shipment_id","dedupe_key");
CREATE INDEX "tracking_shipment_idx" ON "tracking_event" ("shipment_id","occurred_at");

CREATE TABLE "ledger_entry" (
  "seq" bigserial PRIMARY KEY,
  "txn_id" uuid NOT NULL,
  "account" text NOT NULL,
  "debit_minor" bigint NOT NULL DEFAULT 0,
  "credit_minor" bigint NOT NULL DEFAULT 0,
  "currency" "currency" NOT NULL,
  "ref_type" text NOT NULL,
  "ref_id" uuid NOT NULL,
  "memo" text,
  "posted_at" timestamptz NOT NULL DEFAULT now(),
  -- A line is a debit or a credit, never both and never neither.
  CONSTRAINT "ledger_single_sided" CHECK (
    ("debit_minor" = 0) <> ("credit_minor" = 0)
  ),
  CONSTRAINT "ledger_non_negative" CHECK ("debit_minor" >= 0 AND "credit_minor" >= 0)
);
CREATE INDEX "ledger_txn_idx" ON "ledger_entry" ("txn_id");
CREATE INDEX "ledger_account_idx" ON "ledger_entry" ("account","posted_at");
CREATE INDEX "ledger_ref_idx" ON "ledger_entry" ("ref_type","ref_id");

CREATE TABLE "reconciliation_item" (
  "id" uuid PRIMARY KEY,
  "source" text NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" "currency" NOT NULL,
  "external_ref" text,
  "matched_order_id" uuid REFERENCES "order"("id"),
  "match_basis" text,
  "status" text NOT NULL DEFAULT 'UNMATCHED',
  "candidates" jsonb,
  "observed_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "recon_status_idx" ON "reconciliation_item" ("status","observed_at");

CREATE TABLE "exception" (
  "id" uuid PRIMARY KEY,
  "order_id" uuid NOT NULL REFERENCES "order"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "state" "order_state" NOT NULL,
  "margin_at_risk_minor" bigint NOT NULL DEFAULT 0,
  "currency" "currency" NOT NULL DEFAULT 'IRR',
  "rank" numeric(12,4) NOT NULL DEFAULT 0,
  "ranked_by" text NOT NULL DEFAULT 'deterministic',
  "assignee" text,
  "resolved_at" timestamptz,
  "resolution_note" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "exception_open_idx" ON "exception" ("resolved_at","rank");
CREATE INDEX "exception_order_idx" ON "exception" ("order_id");

CREATE TABLE "operator" (
  "id" uuid PRIMARY KEY,
  "email" text NOT NULL,
  "display_name" text NOT NULL,
  "password_hash" text NOT NULL,
  "role" text NOT NULL DEFAULT 'ops',
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "operator_email_uq" ON "operator" ("email");

CREATE TABLE "outbox" (
  "id" uuid PRIMARY KEY,
  "topic" text NOT NULL,
  "aggregate_id" text NOT NULL,
  "aggregate_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "correlation_id" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "published_at" timestamptz,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
-- Partial: the relay only scans unpublished rows, so the index stays proportional to the
-- backlog rather than to the whole table.
CREATE INDEX "outbox_unpublished_idx" ON "outbox" ("created_at") WHERE "published_at" IS NULL;

CREATE TABLE "idempotency_key" (
  "key" text PRIMARY KEY,
  "customer_id" uuid,
  "endpoint" text NOT NULL,
  "request_hash" text NOT NULL,
  "response_status" integer,
  "response_body" jsonb,
  "state" text NOT NULL DEFAULT 'IN_FLIGHT',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL
);
CREATE INDEX "idempotency_expiry_idx" ON "idempotency_key" ("expires_at");

CREATE TABLE "processed_event" (
  "event_id" text NOT NULL,
  "consumer" text NOT NULL,
  "processed_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("event_id","consumer")
);

CREATE TABLE "fx_snapshot" (
  "seq" bigserial PRIMARY KEY,
  "base_currency" "currency" NOT NULL,
  "quote_currency" "currency" NOT NULL,
  "rate_micro" bigint NOT NULL,
  "source" text NOT NULL,
  "observed_at" timestamptz NOT NULL
);
CREATE INDEX "fx_pair_idx" ON "fx_snapshot" ("base_currency","quote_currency","observed_at");

-- ───────────────────────── ledger balance enforcement ─────────────────────────
--
-- Deferred to COMMIT so the individual INSERTs of one balanced group can be written in any
-- order. This is the guarantee that no application path — including one written later by
-- someone who has not read the repository comments — can post a half-entry.

CREATE OR REPLACE FUNCTION assert_ledger_balanced() RETURNS trigger AS $$
DECLARE
  unbalanced RECORD;
BEGIN
  SELECT l.currency,
         SUM(l.debit_minor)  AS debits,
         SUM(l.credit_minor) AS credits
    INTO unbalanced
    FROM ledger_entry l
   WHERE l.txn_id = NEW.txn_id
   GROUP BY l.currency
  HAVING SUM(l.debit_minor) <> SUM(l.credit_minor)
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Ledger transaction % is unbalanced in %: debits % <> credits %',
      NEW.txn_id, unbalanced.currency, unbalanced.debits, unbalanced.credits
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_balance_check
  AFTER INSERT ON ledger_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_ledger_balanced();

-- ───────────────────────── append-only enforcement ─────────────────────────
--
-- The order timeline and the ledger are the audit record. If they can be rewritten they are
-- not an audit record, so UPDATE and DELETE are refused at the database rather than merely
-- omitted from the repositories.

CREATE OR REPLACE FUNCTION refuse_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER order_event_append_only
  BEFORE UPDATE OR DELETE ON "order_event"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

CREATE TRIGGER ledger_entry_append_only
  BEFORE UPDATE OR DELETE ON "ledger_entry"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
