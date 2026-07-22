import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Provider-agnostic object storage (§33, §40). One S3-compatible
 * implementation serves MinIO in development and any managed S3 store in
 * production — nothing outside this package imports AWS types.
 */

export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Short-lived signed download URL (§33: publish via signed URLs only). */
  signedDownloadUrl(key: string, opts: { fileName: string; expiresInSeconds?: number }): Promise<string>;
}

export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** MinIO requires path-style addressing. */
  forcePathStyle?: boolean;
}

export function storageConfigFromEnv(env: Record<string, string | undefined> = process.env): StorageConfig {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  return {
    endpoint: required("STORAGE_ENDPOINT"),
    region: env.STORAGE_REGION ?? "us-east-1",
    accessKeyId: required("STORAGE_ACCESS_KEY"),
    secretAccessKey: required("STORAGE_SECRET_KEY"),
    bucket: required("STORAGE_BUCKET"),
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE !== "false",
  };
}

/**
 * Tenant-scoped storage key (§33): structural isolation, never derived from
 * user input beyond validated UUIDs.
 */
/** Canonical UUID layout: hex groups in fixed positions, not just length. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function attachmentKey(parts: {
  organizationId: string;
  portalId: string;
  attachmentId: string;
}): string {
  for (const [name, value] of Object.entries(parts)) {
    if (!UUID_PATTERN.test(value)) throw new Error(`${name} is not a UUID`);
  }
  return `organizations/${parts.organizationId}/portals/${parts.portalId}/attachments/${parts.attachmentId}`;
}

const DEFAULT_URL_TTL_SECONDS = 300;

export function createS3Storage(config: StorageConfig): ObjectStorage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: config.forcePathStyle ?? true,
  });
  let bucketReady = false;

  async function ensureBucket(): Promise<void> {
    if (bucketReady) return;
    try {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
      bucketReady = true;
      return;
    } catch {
      // Fall through to create (dev convenience for MinIO; production
      // buckets are provisioned out-of-band).
    }
    try {
      await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
      bucketReady = true;
    } catch (err) {
      // A concurrent creator may have won the race — re-check before giving
      // up, and never mark ready on an unverified failure.
      await client.send(new HeadBucketCommand({ Bucket: config.bucket })).catch(() => {
        throw err;
      });
      bucketReady = true;
    }
  }

  return {
    async put(key, body, contentType) {
      await ensureBucket();
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    async signedDownloadUrl(key, opts) {
      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${opts.fileName.replace(/[^\w.\- ]/g, "_")}"`,
      });
      return getSignedUrl(client, command, {
        expiresIn: opts.expiresInSeconds ?? DEFAULT_URL_TTL_SECONDS,
      });
    },
  };
}
