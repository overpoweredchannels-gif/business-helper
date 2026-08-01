import type { RuntimeEventCategory, RuntimeEventName, VoiceRuntimeEvent, VoiceRuntimeEventHandler } from "./events";

export interface EventSubscription {
  unsubscribe(): void;
}

export class TypedEventEmitter {
  private handlers = new Map<string, Set<VoiceRuntimeEventHandler>>();
  private categoryHandlers = new Map<string, Set<VoiceRuntimeEventHandler>>();
  private allHandlers = new Set<VoiceRuntimeEventHandler>();

  on(event: RuntimeEventName, handler: VoiceRuntimeEventHandler): EventSubscription;
  on(category: RuntimeEventCategory, handler: VoiceRuntimeEventHandler): EventSubscription;
  on(event: string, handler: VoiceRuntimeEventHandler): EventSubscription {
    const set = this.handlers.get(event) || new Set();
    set.add(handler);
    this.handlers.set(event, set);
    return { unsubscribe: () => this.off(event, handler) };
  }

  onCategory(category: RuntimeEventCategory, handler: VoiceRuntimeEventHandler): EventSubscription {
    const set = this.categoryHandlers.get(category) || new Set();
    set.add(handler);
    this.categoryHandlers.set(category, set);
    return { unsubscribe: () => this.offCategory(category, handler) };
  }

  onAny(handler: VoiceRuntimeEventHandler): EventSubscription {
    this.allHandlers.add(handler);
    return { unsubscribe: () => this.allHandlers.delete(handler) };
  }

  off(event: string, handler: VoiceRuntimeEventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  offCategory(category: string, handler: VoiceRuntimeEventHandler): void {
    this.categoryHandlers.get(category)?.delete(handler);
  }

  once(event: RuntimeEventName): Promise<VoiceRuntimeEvent> {
    return new Promise((resolve) => {
      const sub = this.on(event, (evt) => {
        sub.unsubscribe();
        resolve(evt);
      });
    });
  }

  emit<T extends RuntimeEventName>(
    category: RuntimeEventCategory,
    event: T,
    data: VoiceRuntimeEvent<T>["data"],
    sessionId?: string,
  ): void {
    const runtimeEvent = {
      name: event,
      category,
      timestamp: new Date(),
      data,
      ...(sessionId ? { sessionId } : {}),
    } as VoiceRuntimeEvent;

    for (const handler of this.handlers.get(event) || []) {
      try {
        handler(runtimeEvent);
      } catch {
        // swallow listener errors
      }
    }
    for (const handler of this.categoryHandlers.get(category) || []) {
      try {
        handler(runtimeEvent);
      } catch {
        // swallow listener errors
      }
    }
    for (const handler of this.allHandlers) {
      try {
        handler(runtimeEvent);
      } catch {
        // swallow listener errors
      }
    }
  }

  listenerCount(event?: string): number {
    if (!event) {
      return this.allHandlers.size;
    }
    return (this.handlers.get(event) || new Set()).size;
  }
}
