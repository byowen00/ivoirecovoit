import { ApiRequestError } from './api';
import type { SignedUpload } from './account';

export const DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export interface FileMeta {
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

/** Empreinte SHA-256 en hexadécimal : le serveur la recalcule sur le fichier reçu. */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Contrôle côté navigateur (format, taille) avant tout envoi : évite de consommer des données pour rien. */
export function checkFile(file: File, allowed: readonly string[], maxBytes: number): string | null {
  if (!allowed.includes(file.type)) {
    return allowed.includes('application/pdf') ? 'Format accepté : JPEG, PNG, WebP ou PDF.' : 'Format accepté : JPEG, PNG ou WebP.';
  }
  if (file.size > maxBytes) return `Fichier trop lourd (${Math.round(maxBytes / 1024 / 1024)} Mo au maximum).`;
  if (file.size === 0) return 'Fichier vide.';
  return null;
}

export async function fileMeta(file: File): Promise<{ meta: FileMeta; body: ArrayBuffer }> {
  const body = await file.arrayBuffer();
  return { meta: { mimeType: file.type, sizeBytes: file.size, sha256: await sha256Hex(body) }, body };
}

/**
 * Dépôt direct dans le stockage privé via l'URL signée (5 min). Le fichier ne transite pas par le serveur web ;
 * l'API le vérifie ensuite (taille, type réel, empreinte) lors de la confirmation.
 */
export async function putSigned(upload: SignedUpload, body: ArrayBuffer): Promise<void> {
  let res: Response;
  try {
    res = await fetch(upload.url, { method: upload.method, headers: upload.headers, body });
  } catch {
    throw new ApiRequestError('UPLOAD_NETWORK', 'Envoi interrompu. Vérifiez votre connexion puis réessayez.', 0);
  }
  if (!res.ok) throw new ApiRequestError('UPLOAD_FAILED', 'Le fichier n’a pas pu être envoyé. Réessayez.', res.status);
}
