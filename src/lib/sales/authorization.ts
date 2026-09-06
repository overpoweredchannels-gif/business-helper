import { resolveActor } from "../identity/api-context";
import { hasSalesTool, type SalesTool } from "./access";

export async function requireSalesTool(request: Request, tool: SalesTool) {
  const context = await resolveActor(request);
  const actor = context.actor;
  const allowed = Boolean(actor && hasSalesTool({ ...actor.salesAccess, role: actor.role }, tool));
  return { allowed, actor, reason: allowed ? undefined : context.error ?? "The owner has not granted this sales option." };
}
