/** Typed access to environment variables with sane defaults. */

const read = (key: string, fallback = ""): string => {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
};

const list = (key: string, fallback: string[]): string[] => {
  const v = read(key);
  if (!v) return fallback;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

export interface StorageConfig {
  provider: "supabase" | "b2";
  endpoint: string;
  region: string;
  bucket: string;
  keyId: string;
  secret: string;
}

const b2Region = () => {
  const explicit = read("B2_REGION");
  if (explicit) return explicit;
  // Derive from the endpoint: https://s3.us-east-005.backblazeb2.com → us-east-005
  const m = read("B2_ENDPOINT").match(/s3\.([a-z0-9-]+)\.backblazeb2\.com/i);
  return m ? m[1] : "us-east-005";
};

const b2Config = (): StorageConfig => ({
  provider: "b2",
  endpoint: read("B2_ENDPOINT"),
  region: b2Region(),
  bucket: read("B2_BUCKET"),
  keyId: read("B2_KEY_ID"),
  secret: read("B2_APP_KEY"),
});

/**
 * Supabase Storage through its S3-compatible endpoint
 * (https://<project-ref>.storage.supabase.co/storage/v1/s3). Setting
 * STORAGE_ENDPOINT switches the whole portal to it; the B2_* variables are then
 * only read as the source for the one-time migration.
 */
const supabaseConfig = (): StorageConfig => ({
  provider: "supabase",
  endpoint: read("STORAGE_ENDPOINT"),
  region: read("STORAGE_REGION", "us-east-2"),
  bucket: read("STORAGE_BUCKET", "bareroots-portal"),
  keyId: read("STORAGE_KEY_ID"),
  secret: read("STORAGE_SECRET"),
});

const complete = (c: StorageConfig) => Boolean(c.endpoint && c.bucket && c.keyId && c.secret);

export const env = {
  clientPin: () => read("CLIENT_PIN"),
  studioPin: () => read("STUDIO_PIN"),
  clientNames: () => list("CLIENT_NAMES", ["Iisha", "Sabrina", "Destiny"]),
  studioNames: () => list("STUDIO_NAMES", ["Fred", "Azaiah"]),
  sessionSecret: () => read("SESSION_SECRET"),

  /** The storage the portal reads and writes. */
  storage: (): StorageConfig => (read("STORAGE_ENDPOINT") ? supabaseConfig() : b2Config()),
  storageConfigured: () => complete(read("STORAGE_ENDPOINT") ? supabaseConfig() : b2Config()),

  /** The old Backblaze bucket, only while migrating off it (null once B2_* is removed or B2 is still primary). */
  legacyStorage: (): StorageConfig | null => {
    if (!read("STORAGE_ENDPOINT")) return null;
    const c = b2Config();
    return complete(c) ? c : null;
  },

  metaStore: (): "b2" | "blobs" | "file" => {
    const v = read("META_STORE", "blobs").toLowerCase();
    return v === "b2" ? "b2" : v === "file" ? "file" : "blobs";
  },

  maxUploadBytes: () => Math.min(Number(read("MAX_UPLOAD_MB", "4000")), 5000) * 1024 * 1024,
  storageBudgetBytes: () => Number(read("STORAGE_BUDGET_GB", "10")) * 1024 * 1024 * 1024,

  businessName: () => read("BUSINESS_NAME", "Bare Roots"),
  studioName: () => read("STUDIO_NAME", "Couture House Co."),

  /** Missing variables, for the health check. */
  missing: (): string[] => {
    const base = ["CLIENT_PIN", "STUDIO_PIN", "SESSION_SECRET"];
    const storage = read("STORAGE_ENDPOINT")
      ? ["STORAGE_ENDPOINT", "STORAGE_KEY_ID", "STORAGE_SECRET"]
      : ["B2_KEY_ID", "B2_APP_KEY", "B2_BUCKET", "B2_ENDPOINT"];
    return [...base, ...storage].filter((k) => !read(k));
  },
};
