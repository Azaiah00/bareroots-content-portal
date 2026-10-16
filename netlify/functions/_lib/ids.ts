import { randomUUID, randomBytes } from "node:crypto";

/** Short, URL-safe, sortable-ish id: 8 time chars + 6 random. */
export const id = (): string => {
  const t = Date.now().toString(36).padStart(9, "0");
  const r = randomBytes(5).toString("base64url").slice(0, 6);
  return `${t}${r}`;
};

export const uuid = (): string => randomUUID();
