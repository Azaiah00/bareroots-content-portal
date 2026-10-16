import type { Config } from "@netlify/functions";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { env } from "./_lib/env";
import { handle, json } from "./_lib/http";
import { bucket, s3 } from "./_lib/s3";

/**
 * GET /api/health — a setup aid. Reports which environment variables are
 * missing and whether the bucket answers. Safe to expose: it never reveals
 * values, only names.
 */
export default handle(async () => {
  const missing = env.missing();
  let storage: { ok: boolean; detail: string } = { ok: false, detail: "not configured" };
  if (env.b2Configured()) {
    try {
      await s3().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: "_health/" }));
      storage = { ok: true, detail: `bucket "${bucket()}" reachable` };
    } catch (err: any) {
      storage = { ok: false, detail: err?.name ? `${err.name}: ${err.message}` : String(err) };
    }
  }
  return json({
    ok: missing.length === 0 && storage.ok,
    missingEnv: missing,
    metaStore: env.metaStore(),
    storage,
    pinsSet: Boolean(env.clientPin() && env.studioPin()),
    pinsDistinct: env.clientPin() !== env.studioPin(),
    time: new Date().toISOString(),
  });
});

export const config: Config = { path: "/api/health" };
