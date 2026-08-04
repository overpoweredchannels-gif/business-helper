import { createSupabaseService } from "@/lib/supabase/server";
import { NotificationCategory } from "@/lib/tradeos/types";
import { getNotificationService } from "./notification-provider";

export interface CreateNotificationInput {
  organizationId: string;
  recipientProfileId: string;
  category: NotificationCategory;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown> | null;
}

/**
 * Server-side helper used by API routes and business services to create a
 * notification for a single recipient. Persists to the `notifications` table
 * (in-app) then dispatches through configured providers.
 *
 * Never throws; callers should not treat notification failures as fatal.
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  try {
    let supabase;
    try {
      supabase = createSupabaseService();
    } catch {
      return;
    }
    if (!supabase) return;

    const { error } = await supabase.from("notifications").insert({
      organization_id: input.organizationId,
      recipient_profile_id: input.recipientProfileId,
      category: input.category,
      title: input.title,
      body: input.body ?? null,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      channel: "in_app",
      is_read: false,
      payload: input.payload ?? null,
    });

    if (error) {
      console.error("createNotification: insert failed:", error.message);
      return;
    }

    await getNotificationService().deliver({
      organizationId: input.organizationId,
      recipientProfileId: input.recipientProfileId,
      category: input.category,
      title: input.title,
      body: input.body ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      payload: input.payload ?? null,
    });
  } catch (err) {
    console.error("createNotification: unexpected error:", err);
  }
}

export interface CreateOrgBroadcastInput {
  organizationId: string;
  recipientProfileIds: string[];
  category: NotificationCategory;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown> | null;
}

/** Creates the same notification for many recipients (e.g. all salesmen). */
export async function createOrgBroadcast(input: CreateOrgBroadcastInput): Promise<void> {
  for (const recipientProfileId of input.recipientProfileIds) {
    await createNotification({
      organizationId: input.organizationId,
      recipientProfileId,
      category: input.category,
      title: input.title,
      body: input.body,
      entityType: input.entityType,
      entityId: input.entityId,
      payload: input.payload,
    });
  }
}
