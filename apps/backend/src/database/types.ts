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

export interface BookingsTable {
  id: string;
  reference: string;
  trip_id: string;
  passenger_id: string;
  pickup_stop_id: string;
  dropoff_stop_id: string;
  pickup_seq: number;
  dropoff_seq: number;
  seats: number;
  status: string;
  hold_expires_at: Date | null;
  created_at: CreatedAt;
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
  idempotency_keys: IdempotencyKeysTable;
  outbox_events: OutboxEventsTable;
  reviews: ReviewsTable;
}
