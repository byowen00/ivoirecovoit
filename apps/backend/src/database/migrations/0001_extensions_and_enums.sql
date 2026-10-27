-- 0001 : extensions et types énumérés
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;

-- unaccent() n'est pas IMMUTABLE ; ce wrapper l'est (dictionnaire fixé) pour pouvoir l'indexer.
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

CREATE OR REPLACE FUNCTION normalize_search(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT lower(immutable_unaccent($1)) $$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TYPE user_status            AS ENUM ('PENDING_VERIFICATION','ACTIVE','SUSPENDED','BANNED','DELETED');
CREATE TYPE verification_status    AS ENUM ('NOT_SUBMITTED','PENDING','APPROVED','REJECTED','EXPIRED');
CREATE TYPE document_type          AS ENUM ('NATIONAL_ID','PASSPORT','CONSULAR_CARD','DRIVING_LICENSE',
                                            'VEHICLE_REGISTRATION','INSURANCE','TECHNICAL_INSPECTION','VEHICLE_PHOTO');
CREATE TYPE place_kind             AS ENUM ('CITY','COMMUNE','NEIGHBORHOOD','LANDMARK','STATION');
CREATE TYPE trip_status            AS ENUM ('DRAFT','PUBLISHED','FULL','IN_PROGRESS','COMPLETED','CANCELLED');
CREATE TYPE trip_kind              AS ENUM ('URBAN','INTERCITY');
CREATE TYPE acceptance_mode        AS ENUM ('AUTO','MANUAL');
CREATE TYPE booking_status         AS ENUM ('PENDING_ACCEPTANCE','PENDING_PAYMENT','CONFIRMED','REJECTED',
                                            'EXPIRED','CANCELLED_BY_PASSENGER','CANCELLED_BY_DRIVER',
                                            'CANCELLED_BY_ADMIN','NO_SHOW','COMPLETED');
CREATE TYPE booking_payment_status AS ENUM ('NOT_REQUIRED','UNPAID','PROCESSING','PAID','PARTIALLY_REFUNDED',
                                            'REFUND_PENDING','REFUNDED','CASH_DUE');
CREATE TYPE payment_method         AS ENUM ('WAVE','ORANGE_MONEY','MTN_MOMO','MOOV_MONEY','CASH');
CREATE TYPE payment_status         AS ENUM ('CREATED','PENDING','SUCCEEDED','FAILED','EXPIRED','CANCELLED');
CREATE TYPE refund_status          AS ENUM ('REQUESTED','APPROVED','PROCESSING','SUCCEEDED','FAILED','REJECTED','MANUAL_REQUIRED');
CREATE TYPE payout_status          AS ENUM ('DRAFT','APPROVED','PROCESSING','PAID','FAILED','CANCELLED');
CREATE TYPE report_status          AS ENUM ('OPEN','IN_REVIEW','ACTION_TAKEN','DISMISSED');
CREATE TYPE report_severity        AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');
CREATE TYPE dispute_status         AS ENUM ('OPEN','AWAITING_RESPONSE','IN_REVIEW','RESOLVED','REJECTED','CLOSED');
CREATE TYPE notification_channel   AS ENUM ('IN_APP','PUSH','SMS','WHATSAPP','EMAIL');
CREATE TYPE discount_type          AS ENUM ('FIXED','PERCENT');
