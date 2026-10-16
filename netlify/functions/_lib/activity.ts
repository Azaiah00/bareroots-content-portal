import type { Activity, ActivityType, Role } from "../../../shared/types";
import { id } from "./ids";
import { isoNow } from "./http";
import { mutateCollection } from "./store";

const KEEP = 400;

export const logActivity = async (
  who: string,
  role: Role,
  type: ActivityType,
  message: string,
  ref?: Activity["ref"],
): Promise<void> => {
  const entry: Activity = { id: id(), at: isoNow(), who, role, type, message, ...(ref ? { ref } : {}) };
  await mutateCollection<Activity>("activity", (items) => {
    items.unshift(entry);
    if (items.length > KEEP) items.length = KEEP;
  });
};
