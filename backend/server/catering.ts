import type { CateringStatus } from "./generated/prisma/client.js";

export function canTransitionCatering(from: CateringStatus, to: CateringStatus) {
  // Keep quote/notes edits available in every state. Legacy CLOSED is ambiguous and stays closed.
  return from === to || (["PENDING", "REQUESTED", "CONTACTED"].includes(from) && ["CONFIRMED", "DECLINED"].includes(to));
}
