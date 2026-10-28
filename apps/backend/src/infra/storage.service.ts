import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ApiError } from '../common/api-error';
import { ENV, type Env } from '../config/env';

/** Durée de validité des URL signées (dépôt et consultation) : 5 minutes (EF-23). */
export const SIGNED_URL_TTL_S = 300;

export interface SignedUpload {
  method: 'PUT';
  url: string;
  /** En-têtes à envoyer tels quels : ils font partie de la signature. */
  headers: Record<string, string>;
  expiresAt: Date;
}

const unavailable = () =>
  new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'STORAGE_UNAVAILABLE', 'Le stockage des documents est indisponible.');

/**
 * Stockage privé des documents (API S3). Le bucket n'est jamais public : tout accès passe par une URL signée
 * de courte durée, générée après vérification des droits. Le chiffrement au repos est assuré par le service
 * de stockage (à activer côté hébergeur, voir docs/adr/0004).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger('Stockage');
  private readonly client?: S3Client;
  /** Signe avec l'adresse publique : la signature couvre l'hôte, qui doit être celui vu par le client. */
  private readonly signer?: S3Client;
  readonly bucket: string;

  constructor(@Inject(ENV) env: Env) {
    this.bucket = env.S3_BUCKET_DOCUMENTS;
    if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) return;
    const base = {
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    };
    this.client = new S3Client({ ...base, endpoint: env.S3_ENDPOINT });
    this.signer = new S3Client({ ...base, endpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT });
  }

  get available(): boolean {
    return !!this.client;
  }

  /** URL de dépôt : type et taille exacts signés, le stockage refuse tout autre fichier. */
  async presignPut(key: string, mimeType: string, sizeBytes: number): Promise<SignedUpload> {
    if (!this.signer) throw unavailable();
    const url = await getSignedUrl(
      this.signer,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: mimeType, ContentLength: sizeBytes }),
      { expiresIn: SIGNED_URL_TTL_S },
    );
    return {
      method: 'PUT',
      url,
      headers: { 'Content-Type': mimeType },
      expiresAt: new Date(Date.now() + SIGNED_URL_TTL_S * 1000),
    };
  }

  async presignGet(key: string, ttlS = SIGNED_URL_TTL_S): Promise<{ url: string; expiresAt: Date }> {
    if (!this.signer) throw unavailable();
    const url = await getSignedUrl(this.signer, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlS,
    });
    return { url, expiresAt: new Date(Date.now() + ttlS * 1000) };
  }

  /** Contenu d'un objet (null s'il n'existe pas ou dépasse maxBytes). */
  async read(key: string, maxBytes: number): Promise<Buffer | null> {
    if (!this.client) throw unavailable();
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if ((res.ContentLength ?? 0) > maxBytes) return null;
      return Buffer.from(await res.Body!.transformToByteArray());
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') return null;
      this.logger.error(`Lecture impossible : ${(err as Error).message}`);
      throw unavailable();
    }
  }

  async remove(key: string): Promise<void> {
    if (!this.client) return;
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch((err: Error) => {
      this.logger.warn(`Suppression impossible de ${key} : ${err.message}`);
    });
  }

  /** Crée le bucket privé et autorise le dépôt direct depuis les origines web listées (script storage:init). */
  async ensureBucket(corsOrigins: string[]): Promise<void> {
    if (!this.client) throw new Error('S3_ENDPOINT, S3_ACCESS_KEY et S3_SECRET_KEY sont requis');
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
    await this.client.send(
      new PutBucketCorsCommand({
        Bucket: this.bucket,
        CORSConfiguration: {
          CORSRules: [
            { AllowedMethods: ['PUT', 'GET'], AllowedOrigins: corsOrigins, AllowedHeaders: ['content-type'], MaxAgeSeconds: 600 },
          ],
        },
      }),
    );
  }
}

export type DetectedMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

/** Type réel d'un fichier d'après ses premiers octets (le type déclaré par le client ne suffit pas). */
export function detectMime(buf: Buffer): DetectedMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}
