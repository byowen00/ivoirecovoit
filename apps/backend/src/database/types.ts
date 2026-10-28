import type { ColumnType, Generated } from 'kysely';

/*
 * Types Kysely des tables utilisées par le code. Ils sont complétés module par module
 * (étapes 5 à 9) ; la source de vérité du schéma reste les migrations SQL.
 */

export interface PlacesTable {
  id: string;
  kind: 'CITY' | 'COMMUNE' | 'NEIGHBORHOOD' | 'LANDMARK' | 'STATION';
  name: string;
  parent_id: string | null;
  aliases: string[];
  search_text: Generated<string>;
  location: string; // geography : lu et écrit via les fonctions PostGIS
  location_precision: 'EXACT' | 'APPROX';
  country_code: Generated<string>;
  population_rank: number | null;
  is_active: Generated<boolean>;
  created_at: ColumnType<Date, never, never>;
}


type CreatedAt = ColumnType<Date, Date | undefined, never>;
export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'DELETED';
export type SessionKind = 'USER' | 'STAFF';
export type ConsentType = 'TERMS' | 'PRIVACY' | 'LOCATION_LIVE' | 'MARKETING';

export interface UsersTable {
  id: string;
  phone_e164: string | null;
  phone_verified_at: Date | null;
  email: string | null;
  email_verified_at: Date | null;
  first_name: string | null;
  last_name: string | null;
  display_name: ColumnType<string | null, never, never>;
  photo_object_key: string | null;
  bio: string | null;
  preferences: ColumnType<Record<string, unknown>, string | undefined, string>;
  locale: Generated<string>;
  country_code: Generated<string>;
  status: Generated<UserStatus>;
  is_passenger: Generated<boolean>;
  is_demo: Generated<boolean>;
  suspended_until: Date | null;
  deleted_at: Date | null;
  created_at: CreatedAt;
  updated_at: ColumnType<Date, never, never>;
}

export interface AuthIdentitiesTable {
  id: string;
  user_id: string;
  provider: 'PHONE' | 'EMAIL' | 'GOOGLE' | 'APPLE';
  provider_uid: string;
  created_at: CreatedAt;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  kind: SessionKind;
  refresh_token_hash: Buffer;
  family_id: string;
  device_label: string | null;
  ip_created: string | null;
  user_agent: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
  replaced_by: string | null;
  created_at: CreatedAt;
  last_used_at: Date | null;
}

export interface OtpRequestsLogTable {
  id: Generated<number>;
  phone_e164: string;
  ip: string | null;
  purpose: 'LOGIN' | 'SIGNUP' | 'PHONE_CHANGE' | 'ACCOUNT_DELETION';
  outcome: 'SENT' | 'VERIFIED' | 'FAILED' | 'BLOCKED';
  created_at: CreatedAt;
}

export interface UserConsentsTable {
  id: string;
  user_id: string;
  consent_type: ConsentType;
  version: string;
  granted: boolean;
  ip: string | null;
  created_at: CreatedAt;
}

export interface EmergencyContactsTable {
  id: string;
  user_id: string;
  name: string;
  phone_e164: string;
  created_at: CreatedAt;
}

export interface StaffAccountsTable {
  user_id: string;
  password_hash: string;
  totp_secret_enc: Buffer;
  totp_last_step: number | null;
  is_active: Generated<boolean>;
  last_login_at: Date | null;
  created_at: CreatedAt;
}

export interface StaffRolesTable {
  code: string;
  label: string;
  permissions: string[];
}

export interface StaffRoleAssignmentsTable {
  user_id: string;
  role_code: string;
  granted_by: string | null;
  granted_at: CreatedAt;
}

export interface AuditLogsTable {
  id: Generated<number>;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  reason: string | null;
  changes: ColumnType<Record<string, unknown> | null, string | null | undefined, never>;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: CreatedAt;
}

export interface SettingsTable {
  key: string;
  value: ColumnType<unknown, string, string>;
  version: number;
  updated_by: string | null;
  updated_at: CreatedAt;
}

export type VerificationStatus = 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
export type TripStatus = 'DRAFT' | 'PUBLISHED' | 'FULL' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type TripKind = 'URBAN' | 'INTERCITY';
export type DriverDocType = 'NATIONAL_ID' | 'PASSPORT' | 'CONSULAR_CARD' | 'DRIVING_LICENSE';
export type VehicleDocType = 'VEHICLE_REGISTRATION' | 'INSURANCE' | 'TECHNICAL_INSPECTION' | 'VEHICLE_PHOTO';
type UpdatedAt = ColumnType<Date, never, never>;
/** Date SQL (sans heure) : lue en chaîne AAAA-MM-JJ grâce au parseur configuré dans database.module. */
type SqlDate = ColumnType<string, string, string>;

export interface DriverProfilesTable {
  user_id: string;
  verification_status: Generated<VerificationStatus>;
  verification_level: Generated<number>;
  license_number_enc: Buffer | null;
  license_expires_on: SqlDate | null;
  rejection_reason: string | null;
  verified_at: Date | null;
  verified_by: string | null;
  submitted_at: Date | null;
  rating_avg: ColumnType<number | null, never, never>;
  rating_count: Generated<number>;
  completed_trips_count: Generated<number>;
  cancellation_count_90d: Generated<number>;
  is_professional: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface VehiclesTable {
  id: string;
  driver_id: string;
  make: string;
  model: string;
  color: string;
  year: number | null;
  plate_number: string;
  plate_normalized: ColumnType<string, never, never>;
  seats_capacity: number;
  verification_status: Generated<VerificationStatus>;
  submitted_at: Date | null;
  rejection_reason: string | null;
  verified_at: Date | null;
  verified_by: string | null;
  is_active: Generated<boolean>;
  deleted_at: Date | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

interface DocumentColumns {
  id: string;
  object_key: string;
  mime_type: string;
  size_bytes: number;
  sha256: Buffer;
  expires_on: SqlDate | null;
  status: Generated<VerificationStatus>;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  uploaded_at: Date | null;
  created_at: CreatedAt;
}

export interface DriverDocumentsTable extends DocumentColumns {
  driver_id: string;
  doc_type: DriverDocType;
  side: 'FRONT' | 'BACK' | null;
}

export interface VehicleDocumentsTable extends DocumentColumns {
  vehicle_id: string;
  doc_type: VehicleDocType;
}

export interface DeviceTokensTable {
  id: string;
  user_id: string;
}

export interface CancellationPoliciesTable {
  code: string;
  label: string;
  rules: ColumnType<Record<string, unknown>, string, string>;
  is_active: Generated<boolean>;
}

export interface TripsTable {
  id: string;
  public_ref: string;
  driver_id: string;
  vehicle_id: string;
  kind: TripKind;
  status: Generated<TripStatus>;
  departure_at: Date;
  estimated_arrival_at: Date;
  seats_offered: number;
  acceptance_mode: Generated<'AUTO' | 'MANUAL'>;
  cancellation_policy_code: string;
  allows_cash: Generated<boolean>;
  luggage_policy: Generated<'NONE' | 'SMALL' | 'MEDIUM' | 'LARGE'>;
  description: string | null;
  instructions: string | null;
  estimated_distance_m: number | null;
  estimated_duration_s: number | null;
  route_geometry: string | null; // geography : via les fonctions PostGIS
  route_source: 'OSRM' | 'HAVERSINE_FALLBACK' | null;
  source_trip_id: string | null;
  is_demo: Generated<boolean>;
  published_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  auto_closed: Generated<boolean>;
  version: Generated<number>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface TripStopsTable {
  id: string;
  trip_id: string;
  seq: number;
  place_id: string | null;
  label: string;
  meeting_point: string | null;
  location: string; // geography
  location_precision: Generated<'EXACT' | 'APPROX'>;
  planned_at: Date;
  price_from_origin_xof: number;
  is_pickup: Generated<boolean>;
  is_dropoff: Generated<boolean>;
}

export type BookingStatus =
  | 'PENDING_ACCEPTANCE' | 'PENDING_PAYMENT' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED'
  | 'CANCELLED_BY_PASSENGER' | 'CANCELLED_BY_DRIVER' | 'CANCELLED_BY_ADMIN' | 'NO_SHOW' | 'COMPLETED';
export type BookingPaymentStatus =
  | 'NOT_REQUIRED' | 'UNPAID' | 'PROCESSING' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUND_PENDING' | 'REFUNDED' | 'CASH_DUE';
export type PaymentMethod = 'WAVE' | 'ORANGE_MONEY' | 'MTN_MOMO' | 'MOOV_MONEY' | 'CASH';

export interface BookingsTable {
  id: string;
  reference: string;
  trip_id: string;
  passenger_id: string;
  pickup_stop_id: string;
  dropoff_stop_id: string;
  pickup_seq: number; // recopié depuis l'arrêt par trigger
  dropoff_seq: number;
  seats: number;
  status: BookingStatus;
  payment_status: Generated<BookingPaymentStatus>;
  payment_method: PaymentMethod | null;
  unit_price_xof: number;
  subtotal_xof: number;
  service_fee_xof: number;
  discount_xof: Generated<number>;
  total_xof: number;
  commission_xof: number;
  driver_net_xof: number;
  fee_rule_id: string;
  promotion_id: string | null;
  cancellation_policy_code: string;
  hold_expires_at: Date | null;
  acceptance_deadline: Date | null;
  accepted_at: Date | null;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  completed_at: Date | null;
  refund_due_xof: number | null;
  driver_compensation_xof: number | null;
  free_cancellation: Generated<boolean>;
  expired_at: Date | null;
  rejected_at: Date | null;
  no_show_at: Date | null;
  service_fee_refund_xof: number | null;
  refund_reason: RefundReason | null;
  hold_extended: Generated<boolean>;
  is_demo: Generated<boolean>;
  version: Generated<number>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface BookingStatusHistoryTable {
  id: Generated<number>;
  booking_id: string;
  from_status: BookingStatus | null;
  to_status: BookingStatus;
  actor_id: string | null;
  reason: string | null;
  created_at: CreatedAt;
}

export interface FeeRulesTable {
  id: string;
  effective_from: Date;
  effective_to: Date | null;
  trip_kind: TripKind | null;
  commission_bps: number;
  commission_fixed_xof: Generated<number>;
  commission_min_xof: Generated<number>;
  commission_max_xof: number | null;
  service_fee_bps: Generated<number>;
  service_fee_fixed_xof: Generated<number>;
  service_fee_min_xof: Generated<number>;
  service_fee_max_xof: number | null;
  is_demo: Generated<boolean>;
}

export interface IdempotencyKeysTable {
  key: string;
  user_id: string;
  endpoint: string;
  request_hash: Buffer;
  response_code: number | null;
  response_body: ColumnType<unknown, string | null, string | null>;
  locked_until: Date | null;
  created_at: CreatedAt;
}

export interface OutboxEventsTable {
  id: Generated<number>;
  aggregate: string;
  aggregate_id: string;
  event_type: string;
  payload: ColumnType<unknown, string, never>;
  created_at: CreatedAt;
  published_at: Date | null;
}

export interface ReviewsTable {
  id: string;
  subject_id: string;
  author_id: string;
  direction: 'PASSENGER_TO_DRIVER' | 'DRIVER_TO_PASSENGER';
  rating: number;
  comment: string | null;
  published_at: Date | null;
  hidden_at: Date | null;
}

// ------------------------------------------------------------------ paiements (étape 8)

export type PaymentStatus = 'CREATED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
export type RefundStatus = 'REQUESTED' | 'APPROVED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'REJECTED' | 'MANUAL_REQUIRED';
export type RefundReason =
  | 'DRIVER_CANCELLED' | 'PASSENGER_CANCELLED' | 'DISPUTE' | 'ADMIN' | 'TRIP_CHANGED' | 'LATE_PAYMENT' | 'TRIP_NOT_STARTED' | 'DRIVER_LATE';
export type PaymentEventResult = 'APPLIED' | 'DUPLICATE' | 'IGNORED_STALE' | 'REJECTED' | 'MISMATCH';

export interface PaymentsTable {
  id: string;
  booking_id: string;
  provider: string;
  method: PaymentMethod;
  amount_xof: number;
  currency: Generated<string>;
  status: Generated<PaymentStatus>;
  provider_reference: string | null;
  payer_phone_masked: string | null;
  idempotency_key: string;
  failure_code: string | null;
  failure_message: string | null;
  expires_at: Date;
  succeeded_at: Date | null;
  provider_fee_xof: number | null;
  last_polled_at: Date | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface PaymentEventsTable {
  id: string;
  payment_id: string | null;
  provider: string;
  provider_event_id: string;
  source: 'WEBHOOK' | 'POLL' | 'MANUAL';
  event_type: string;
  reported_status: string | null;
  amount_xof: number | null;
  signature_valid: boolean;
  raw_payload: ColumnType<unknown, string, never>;
  occurred_at: Date | null;
  received_at: CreatedAt;
  processed_at: Date | null;
  processing_result: PaymentEventResult | null;
}

export interface RefundsTable {
  id: string;
  payment_id: string;
  booking_id: string;
  amount_xof: number;
  reason_code: RefundReason;
  status: Generated<RefundStatus>;
  requested_by: string | null;
  approved_by: string | null;
  provider_reference: string | null;
  idempotency_key: string;
  failure_message: string | null;
  succeeded_at: Date | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface CommissionsTable {
  id: string;
  booking_id: string;
  driver_id: string;
  gross_xof: number;
  commission_xof: number;
  service_fee_xof: number;
  driver_net_xof: number;
  adjusted_xof: Generated<number>;
  status: Generated<'PENDING' | 'PAYABLE' | 'IN_PAYOUT' | 'PAID' | 'VOID'>;
  payable_at: Date | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface LedgerEntriesTable {
  id: Generated<number>;
  journal_id: string;
  account: string;
  amount_xof: number;
  booking_id: string | null;
  payment_id: string | null;
  refund_id: string | null;
  payout_id: string | null;
  description: string | null;
  created_at: CreatedAt;
}

export interface ReconciliationRunsTable {
  id: string;
  provider: string;
  period_start: Date;
  period_end: Date;
  status: 'RUNNING' | 'OK' | 'DISCREPANCIES' | 'FAILED';
  internal_total_xof: number | null;
  provider_total_xof: number | null;
  created_at: CreatedAt;
}

export interface ReconciliationItemsTable {
  id: string;
  run_id: string;
  payment_id: string | null;
  provider_reference: string | null;
  issue: 'MISSING_INTERNAL' | 'MISSING_PROVIDER' | 'AMOUNT_MISMATCH' | 'STATUS_MISMATCH';
  details: ColumnType<unknown, string | null, never>;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

export interface SandboxTransactionsTable {
  provider_reference: string;
  kind: 'PAYMENT' | 'REFUND';
  merchant_reference: string;
  amount_xof: number;
  method: PaymentMethod | null;
  payer_phone_masked: string | null;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface DisputesTable {
  id: string;
  booking_id: string;
  status: 'OPEN' | 'AWAITING_RESPONSE' | 'IN_REVIEW' | 'RESOLVED' | 'REJECTED' | 'CLOSED';
}

export interface Database {
  places: PlacesTable;
  users: UsersTable;
  auth_identities: AuthIdentitiesTable;
  sessions: SessionsTable;
  otp_requests_log: OtpRequestsLogTable;
  user_consents: UserConsentsTable;
  emergency_contacts: EmergencyContactsTable;
  staff_accounts: StaffAccountsTable;
  staff_roles: StaffRolesTable;
  staff_role_assignments: StaffRoleAssignmentsTable;
  audit_logs: AuditLogsTable;
  settings: SettingsTable;
  driver_profiles: DriverProfilesTable;
  vehicles: VehiclesTable;
  driver_documents: DriverDocumentsTable;
  vehicle_documents: VehicleDocumentsTable;
  device_tokens: DeviceTokensTable;
  cancellation_policies: CancellationPoliciesTable;
  trips: TripsTable;
  trip_stops: TripStopsTable;
  bookings: BookingsTable;
  booking_status_history: BookingStatusHistoryTable;
  fee_rules: FeeRulesTable;
  idempotency_keys: IdempotencyKeysTable;
  outbox_events: OutboxEventsTable;
  reviews: ReviewsTable;
  payments: PaymentsTable;
  payment_events: PaymentEventsTable;
  refunds: RefundsTable;
  commissions: CommissionsTable;
  ledger_entries: LedgerEntriesTable;
  reconciliation_runs: ReconciliationRunsTable;
  reconciliation_items: ReconciliationItemsTable;
  sandbox_transactions: SandboxTransactionsTable;
  disputes: DisputesTable;
}
