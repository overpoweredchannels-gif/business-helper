import { useCallback, useRef, useState } from "react";
import {
  MemoryStore,
  MemoryWriter,
  ContextRetriever,
  ContextBundle,
} from "@/lib/brain";
import { PreferenceStore } from "@/lib/brain/learning/preference-store";
import type { MemoryWriterRawData } from "@/lib/brain/contracts/memory";

export function useBusinessMemory() {
  const storeRef = useRef<MemoryStore | null>(null);
  const writerRef = useRef<MemoryWriter | null>(null);
  const prefsRef = useRef<PreferenceStore | null>(null);
  const retrieverRef = useRef<ContextRetriever | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);

  const initializeMemory = useCallback((data: MemoryWriterRawData) => {
    if (!storeRef.current) {
      storeRef.current = new MemoryStore();
    }
    if (!prefsRef.current) {
      prefsRef.current = new PreferenceStore();
    }
    if (!writerRef.current) {
      writerRef.current = new MemoryWriter(storeRef.current, prefsRef.current);
    }

    writerRef.current.writeRaw(data);

    if (!retrieverRef.current) {
      retrieverRef.current = new ContextRetriever(storeRef.current);
    }

    setIsInitialized(true);
    setLastRefreshed(new Date().toISOString());
  }, []);

  const getContext = useCallback((): ContextBundle | null => {
    if (!retrieverRef.current) return null;
    return retrieverRef.current.getFullContext();
  }, []);

  const getMinimalContext = useCallback((): ContextBundle | null => {
    if (!retrieverRef.current) return null;
    return retrieverRef.current.getMinimalContext();
  }, []);

  const getBusinessContext = useCallback((): string => {
    if (!retrieverRef.current) return "Business Memory not initialized";
    return retrieverRef.current.getBusinessContext();
  }, []);

  return {
    store: storeRef.current,
    writer: writerRef.current,
    prefs: prefsRef.current,
    retriever: retrieverRef.current,
    isInitialized,
    lastRefreshed,
    initializeMemory,
    getContext,
    getMinimalContext,
    getBusinessContext,
  };
}
