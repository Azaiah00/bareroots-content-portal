import type { RawAsset, RawBatch } from "@shared/types";

export interface RawGroup {
  batch: RawBatch;
  assets: RawAsset[];
}

/**
 * Group raw files by drop-off. A file whose drop-off record is missing is
 * never hidden: it gets a synthetic group so it still shows up everywhere.
 */
export const groupRaw = (batches: RawBatch[], raw: RawAsset[]): RawGroup[] => {
  const byBatch = new Map<string, RawAsset[]>();
  for (const r of raw) {
    if (!byBatch.has(r.batchId)) byBatch.set(r.batchId, []);
    byBatch.get(r.batchId)!.push(r);
  }
  const known = new Set(batches.map((b) => b.id));
  const groups: RawGroup[] = batches.map((batch) => ({ batch, assets: byBatch.get(batch.id) || [] }));
  for (const [id, assets] of byBatch) {
    if (known.has(id)) continue;
    const first = [...assets].sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt))[0];
    groups.push({ batch: { id, note: "", createdBy: first.uploadedBy, createdAt: first.uploadedAt, count: assets.length }, assets });
  }
  return groups.sort((a, b) => b.batch.createdAt.localeCompare(a.batch.createdAt));
};
