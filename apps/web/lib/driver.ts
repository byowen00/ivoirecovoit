import { send, type SignedUpload } from './account';
import { fileMeta, putSigned } from './upload';

export type VerificationStatus = 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
export type DriverDocType = 'NATIONAL_ID' | 'PASSPORT' | 'CONSULAR_CARD' | 'DRIVING_LICENSE';
export type VehicleDocType = 'VEHICLE_REGISTRATION' | 'INSURANCE' | 'TECHNICAL_INSPECTION' | 'VEHICLE_PHOTO';

export interface DocumentInfo {
  id: string;
  docType: DriverDocType | VehicleDocType;
  side: 'FRONT' | 'BACK' | null;
  status: VerificationStatus;
  mimeType: string;
  sizeBytes: number;
  expiresOn: string | null;
  rejectionReason: string | null;
  uploadedAt: string | null;
  reviewedAt: string | null;
}

export interface DriverView {
  status: VerificationStatus;
  level: number;
  submittedAt: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  license: { numberMasked: string; expiresOn: string } | null;
  documents: DocumentInfo[];
  requirements: { key: string; done: boolean }[];
  canEdit: boolean;
  canSubmit: boolean;
  canPublish: boolean;
  publishBlockers: string[];
}

export interface VehicleView {
  id: string;
  make: string;
  model: string;
  color: string;
  year: number | null;
  plateNumber: string;
  seatsCapacity: number;
  status: VerificationStatus;
  rejectionReason: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  isActive: boolean;
  documents: DocumentInfo[];
  requirements: { key: string; done: boolean }[];
  canSubmit: boolean;
}

export interface VehicleInput {
  make: string;
  model: string;
  color: string;
  year?: number | null;
  plateNumber: string;
  seatsCapacity: number;
}

type UploadUrl = { documentId: string; upload: SignedUpload };

export const driver = {
  me: () => send<DriverView>('/bff/api/drivers/me', 'GET'),
  saveLicense: (licenseNumber: string, licenseExpiresOn: string) =>
    send<DriverView>('/bff/api/drivers/me', 'POST', { licenseNumber, licenseExpiresOn }),
  submit: () => send<DriverView>('/bff/api/drivers/me/submit', 'POST'),
  vehicles: () => send<{ data: VehicleView[] }>('/bff/api/vehicles', 'GET'),
  addVehicle: (v: VehicleInput, key: string) => send<VehicleView>('/bff/api/vehicles', 'POST', v, { 'Idempotency-Key': key }),
  submitVehicle: (id: string) => send<VehicleView>(`/bff/api/vehicles/${id}/submit`, 'POST'),
  removeVehicle: (id: string) => send<void>(`/bff/api/vehicles/${id}`, 'DELETE'),
};

/** Dépose une pièce du conducteur : URL signée, envoi direct, puis contrôle par l'API. */
export async function uploadDriverDocument(file: File, docType: DriverDocType, side: 'FRONT' | 'BACK', expiresOn?: string): Promise<DocumentInfo> {
  const { meta, body } = await fileMeta(file);
  const res = await send<UploadUrl>('/bff/api/drivers/me/documents/upload-url', 'POST', { docType, side, ...(expiresOn ? { expiresOn } : {}), ...meta });
  await putSigned(res.upload, body);
  return send<DocumentInfo>(`/bff/api/drivers/me/documents/${res.documentId}/complete`, 'POST');
}

export async function uploadVehicleDocument(vehicleId: string, file: File, docType: VehicleDocType, expiresOn?: string): Promise<DocumentInfo> {
  const { meta, body } = await fileMeta(file);
  const res = await send<UploadUrl>(`/bff/api/vehicles/${vehicleId}/documents/upload-url`, 'POST', {
    docType,
    ...(expiresOn ? { expiresOn } : {}),
    ...meta,
  });
  await putSigned(res.upload, body);
  return send<DocumentInfo>(`/bff/api/vehicles/${vehicleId}/documents/${res.documentId}/complete`, 'POST');
}

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  NOT_SUBMITTED: 'À compléter',
  PENDING: 'En cours de vérification',
  APPROVED: 'Validé',
  REJECTED: 'Refusé',
  EXPIRED: 'Expiré',
};

export const REQUIREMENT_LABEL: Record<string, string> = {
  LICENSE_INFO: 'Numéro et date d’expiration du permis',
  DRIVING_LICENSE_FRONT: 'Permis de conduire (recto)',
  DRIVING_LICENSE_BACK: 'Permis de conduire (verso)',
  IDENTITY_DOCUMENT: 'Pièce d’identité (CNI recto-verso, passeport ou carte consulaire)',
  VEHICLE_REGISTRATION: 'Carte grise',
  INSURANCE: 'Attestation d’assurance en cours de validité',
  TECHNICAL_INSPECTION: 'Visite technique en cours de validité',
};

export const BLOCKER_LABEL: Record<string, string> = {
  DRIVER_NOT_APPROVED: 'Votre profil conducteur doit être validé.',
  LICENSE_EXPIRED: 'Votre permis est expiré.',
  NO_APPROVED_VEHICLE: 'Vous devez avoir au moins un véhicule validé.',
};
