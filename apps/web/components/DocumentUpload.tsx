'use client';

import { useId, useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { type DocumentInfo, VERIFICATION_LABEL } from '@/lib/driver';
import { checkFile, DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from '@/lib/upload';

const UPLOAD_ERRORS: Record<string, string> = {
  UPLOAD_INVALID: 'Le fichier reçu ne correspond pas (format, taille ou contenu). Réessayez avec une autre photo.',
  UPLOAD_MISSING: 'Le fichier n’est pas arrivé. Vérifiez votre connexion puis réessayez.',
  DOSSIER_LOCKED: 'Votre dossier est en cours de vérification : les pièces ne peuvent plus être modifiées.',
};

interface Props {
  label: string;
  current?: DocumentInfo;
  /** Date d'expiration demandée (assurance, visite technique). */
  needsExpiry?: boolean;
  disabled?: boolean;
  onUpload: (file: File, expiresOn?: string) => Promise<unknown>;
}

/** Dépôt d'une pièce : choix du fichier (ou photo depuis le téléphone), contrôle local, envoi, confirmation. */
export function DocumentUpload({ label, current, needsExpiry = false, disabled = false, onUpload }: Props) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [expiresOn, setExpiresOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!file) return;
    const problem = checkFile(file, DOCUMENT_TYPES, MAX_DOCUMENT_BYTES);
    if (problem) return setError(problem);
    if (needsExpiry && !expiresOn) return setError('Indiquez la date d’expiration figurant sur le document.');
    setBusy(true);
    setError(null);
    try {
      await onUpload(file, needsExpiry ? expiresOn : undefined);
      setFile(null);
      setExpiresOn('');
    } catch (err) {
      setError(err instanceof ApiRequestError ? (UPLOAD_ERRORS[err.code] ?? err.message) : 'Envoi impossible. Réessayez.');
    } finally {
      setBusy(false);
    }
  }

  const tone =
    current?.status === 'APPROVED' ? 'text-success' : current?.status === 'REJECTED' ? 'text-danger' : 'text-ink-muted';

  return (
    <div className="grid gap-2 rounded-[var(--radius-control)] border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <span className={`text-sm ${tone}`}>
          {current ? VERIFICATION_LABEL[current.status] : 'Non déposé'}
          {current?.expiresOn && ` · expire le ${current.expiresOn.split('-').reverse().join('/')}`}
        </span>
      </div>
      {current?.status === 'REJECTED' && current.rejectionReason && <p className="text-sm text-danger">Motif : {current.rejectionReason}</p>}
      {!disabled && (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div>
            <label htmlFor={`${id}-file`} className="mb-1 block text-sm">
              {current ? 'Remplacer le fichier' : 'Choisir un fichier'} (JPEG, PNG, WebP ou PDF, 8 Mo max.)
            </label>
            <input
              id={`${id}-file`}
              type="file"
              accept={DOCUMENT_TYPES.join(',')}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(null);
              }}
              className="block w-full text-sm file:mr-3 file:min-h-10 file:rounded-[var(--radius-control)] file:border file:border-line file:bg-surface file:px-3"
            />
          </div>
          {needsExpiry && (
            <div>
              <label htmlFor={`${id}-exp`} className="mb-1 block text-sm">
                Expire le
              </label>
              <input id={`${id}-exp`} type="date" className="field" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
            </div>
          )}
          <button type="button" className="btn-secondary" disabled={!file || busy} onClick={() => void send()}>
            {busy ? 'Envoi…' : 'Envoyer'}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
