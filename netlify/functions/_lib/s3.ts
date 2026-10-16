/**
 * Backblaze B2 via its S3-compatible API.
 *
 * Browser uploads and downloads never pass through Netlify: the function hands
 * out a presigned URL and the browser talks to B2 directly, so a 2 GB clip
 * costs Netlify nothing and never hits a function payload limit.
 *
 * Two B2 gotchas are handled here:
 *  - AWS SDK ≥ 3.729 adds CRC32 checksum headers by default, which B2 rejects.
 *    `requestChecksumCalculation: "WHEN_REQUIRED"` switches that off.
 *  - Path-style addressing avoids DNS trouble with bucket names.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";
import { HttpError } from "./http";

let client: S3Client | null = null;

export const s3 = (): S3Client => {
  if (client) return client;
  if (!env.b2Configured()) {
    throw new HttpError(503, "File storage is not configured yet (B2_* environment variables).", "storage_unconfigured");
  }
  client = new S3Client({
    region: env.b2Region(),
    endpoint: env.b2Endpoint(),
    forcePathStyle: true,
    credentials: { accessKeyId: env.b2KeyId(), secretAccessKey: env.b2AppKey() },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  } as any);
  return client;
};

export const bucket = (): string => env.b2Bucket();

const UPLOAD_TTL = 60 * 60; // 1 hour: long enough for a big clip on salon Wi-Fi
const DOWNLOAD_TTL = 60 * 60 * 6; // 6 hours for inline previews
const ATTACHMENT_TTL = 60 * 30;

export const presignPut = async (key: string, mime: string, size: number) => {
  const cmd = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: mime || "application/octet-stream",
    ContentLength: size,
  });
  const url = await getSignedUrl(s3(), cmd, { expiresIn: UPLOAD_TTL });
  return {
    url,
    headers: { "content-type": mime || "application/octet-stream" },
    expiresAt: new Date(Date.now() + UPLOAD_TTL * 1000).toISOString(),
  };
};

export const presignGet = async (key: string, opts: { download?: string; mime?: string; ttl?: number } = {}): Promise<string> => {
  const cmd = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
    ...(opts.download
      ? { ResponseContentDisposition: `attachment; filename="${opts.download.replace(/["\\]/g, "")}"; filename*=UTF-8''${encodeURIComponent(opts.download)}` }
      : {}),
    ...(opts.mime ? { ResponseContentType: opts.mime } : {}),
  });
  return getSignedUrl(s3(), cmd, { expiresIn: opts.ttl ?? (opts.download ? ATTACHMENT_TTL : DOWNLOAD_TTL) });
};

export const headObject = async (key: string): Promise<{ size: number; mime: string } | null> => {
  try {
    const r = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { size: Number(r.ContentLength ?? 0), mime: r.ContentType ?? "" };
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") return null;
    throw err;
  }
};

export const deleteObjects = async (keys: string[]): Promise<void> => {
  const list = keys.filter(Boolean);
  if (!list.length) return;
  // B2 supports multi-object delete; keep batches at 1000 like S3.
  for (let i = 0; i < list.length; i += 1000) {
    const chunk = list.slice(i, i + 1000);
    if (chunk.length === 1) {
      await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: chunk[0] }));
    } else {
      await s3().send(
        new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }),
      );
    }
  }
};

export const getObjectText = async (key: string): Promise<string | null> => {
  try {
    const r = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    return r.Body ? await r.Body.transformToString() : null;
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NoSuchKey") return null;
    throw err;
  }
};

export const putObjectText = async (key: string, body: string, mime: string): Promise<void> => {
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: mime }));
};

/** Sum object sizes under a prefix (used for the storage meter). */
export const prefixBytes = async (prefix: string): Promise<number> => {
  let total = 0;
  let token: string | undefined;
  do {
    const r = await s3().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents ?? []) total += Number(o.Size ?? 0);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return total;
};
