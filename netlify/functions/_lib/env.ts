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

export const env = {
  clientPin: () => read("CLIENT_PIN"),
  studioPin: () => read("STUDIO_PIN"),
  clientNames: () => list("CLIENT_NAMES", ["Iisha", "Sabrina"]),
  studioNames: () => list("STUDIO_NAMES", ["Fred", "Azaiah"]),
  sessionSecret: () => read("SESSION_SECRET"),

  b2KeyId: () => read("B2_KEY_ID"),
  b2AppKey: () => read("B2_APP_KEY"),
  b2Bucket: () => read("B2_BUCKET"),
  b2Endpoint: () => read("B2_ENDPOINT"),
  b2Region: () => {
    const explicit = read("B2_REGION");
    if (explicit) return explicit;
    // Derive from the endpoint: https://s3.us-east-005.backblazeb2.com → us-east-005
    const m = read("B2_ENDPOINT").match(/s3\.([a-z0-9-]+)\.backblazeb2\.com/i);
    return m ? m[1] : "us-east-005";
  },

  metaStore: (): "b2" | "blobs" | "file" => {
    const v = read("META_STORE", "blobs").toLowerCase();
    return v === "b2" ? "b2" : v === "file" ? "file" : "blobs";
  },

  maxUploadBytes: () => Math.min(Number(read("MAX_UPLOAD_MB", "4000")), 5000) * 1024 * 1024,
  storageBudgetBytes: () => Number(read("STORAGE_BUDGET_GB", "10")) * 1024 * 1024 * 1024,

  businessName: () => read("BUSINESS_NAME", "Bare Roots"),
  studioName: () => read("STUDIO_NAME", "Couture House Co."),

  /** True when every variable needed to talk to B2 is present. */
  b2Configured: () => Boolean(read("B2_KEY_ID") && read("B2_APP_KEY") && read("B2_BUCKET") && read("B2_ENDPOINT")),

  /** Missing variables, for the health check. */
  missing: (): string[] => {
    const required = ["CLIENT_PIN", "STUDIO_PIN", "SESSION_SECRET", "B2_KEY_ID", "B2_APP_KEY", "B2_BUCKET", "B2_ENDPOINT"];
    return required.filter((k) => !read(k));
  },
};
