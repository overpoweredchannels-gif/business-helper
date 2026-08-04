// TradeOS FSM — Notification provider abstraction.
//
// Every notification is persisted to the `notifications` table (In-App channel)
// then dispatched through the configured providers. Providers are pluggable so
// Push (OneSignal/FCM), WhatsApp, Email, and SMS can be added later WITHOUT
// changing business logic. Business code calls `notify(...)` / `notifyOrg(...)`
// from NotificationService; it never touches providers directly.

import { NotificationCategory } from "@/lib/tradeos/types";

export type NotificationChannel = "in_app" | "push" | "whatsapp" | "email" | "sms";

export interface NotificationPayload {
  organizationId: string;
  recipientProfileId: string;
  category: NotificationCategory;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface NotificationProvider {
  readonly channel: NotificationChannel;
  /** Returns true when the provider is configured and can send. */
  isConfigured(): boolean;
  /** Persist or dispatch a notification. Never throws. */
  deliver(payload: NotificationPayload): Promise<void>;
}

export class InAppNotificationProvider implements NotificationProvider {
  readonly channel: NotificationChannel = "in_app";

  isConfigured(): boolean {
    return true;
  }

  async deliver(payload: NotificationPayload): Promise<void> {
    // Persistence is handled by NotificationService (DB insert). The In-App
    // provider's deliver is a no-op because storage is the delivery mechanism.
    void payload;
  }
}

export class PushNotificationProvider implements NotificationProvider {
  readonly channel: NotificationChannel = "push";

  isConfigured(): boolean {
    return false;
  }

  async deliver(payload: NotificationPayload): Promise<void> {
    // Future: OneSignal / Firebase Cloud Messaging integration.
    void payload;
  }
}

export class WhatsAppNotificationProvider implements NotificationProvider {
  readonly channel: NotificationChannel = "whatsapp";

  isConfigured(): boolean {
    return false;
  }

  async deliver(payload: NotificationPayload): Promise<void> {
    // Future: Meta WhatsApp Business API integration.
    void payload;
  }
}

export class EmailNotificationProvider implements NotificationProvider {
  readonly channel: NotificationChannel = "email";

  isConfigured(): boolean {
    return false;
  }

  async deliver(payload: NotificationPayload): Promise<void> {
    // Future: Resend / SendGrid / SES integration.
    void payload;
  }
}

export class SmsNotificationProvider implements NotificationProvider {
  readonly channel: NotificationChannel = "sms";

  isConfigured(): boolean {
    return false;
  }

  async deliver(payload: NotificationPayload): Promise<void> {
    // Future: Twilio integration.
    void payload;
  }
}

const DEFAULT_PROVIDERS: NotificationProvider[] = [
  new InAppNotificationProvider(),
  new PushNotificationProvider(),
  new WhatsAppNotificationProvider(),
  new EmailNotificationProvider(),
  new SmsNotificationProvider(),
];

export class NotificationService {
  private readonly providers: NotificationProvider[];

  constructor(providers: NotificationProvider[] = DEFAULT_PROVIDERS) {
    this.providers = providers;
  }

  /**
   * Delivers a notification to a single recipient through every configured
   * provider. The in-app channel persists the row via a storage callback that
   * each caller provides (keeps this service provider/database independent).
   */
  async deliver(
    payload: NotificationPayload,
    persistInApp?: (payload: NotificationPayload) => Promise<unknown>,
  ): Promise<void> {
    if (persistInApp) {
      try {
        await persistInApp(payload);
      } catch (err) {
        console.error("NotificationService: in-app persist failed:", err);
      }
    }
    for (const provider of this.providers) {
      if (provider.channel === "in_app") continue;
      if (!provider.isConfigured()) continue;
      try {
        await provider.deliver(payload);
      } catch (err) {
        console.error(`NotificationService: ${provider.channel} delivery failed:`, err);
      }
    }
  }
}

let sharedService: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!sharedService) {
    sharedService = new NotificationService();
  }
  return sharedService;
}
