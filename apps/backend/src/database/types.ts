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

export interface DriverProfilesTable {
  user_id: string;
  verification_status: 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
}

export interface DeviceTokensTable {
  id: string;
  user_id: string;
}

export interface TripsTable {
  id: string;
  driver_id: string;
  status: 'DRAFT' | 'PUBLISHED' | 'FULL' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}

export interface BookingsTable {
  id: string;
  passenger_id: string;
  status: string;
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
  device_tokens: DeviceTokensTable;
  trips: TripsTable;
  bookings: BookingsTable;
}
