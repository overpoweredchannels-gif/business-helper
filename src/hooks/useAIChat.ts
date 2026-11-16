"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatResponse } from "@/lib/conversation";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  provider?: string;
  model?: string;
  error?: string;
}

export interface ChatContext {
  sessionId: string;
  conversationId?: string;
  // Recent turns (oldest first, current message excluded) so the server
  // route can answer follow-ups. Built from the messages already on screen.
  history?: Array<{ role: "user" | "assistant"; text: string }>;
}

export interface UseAIChatReturn {
  messages: ChatMessage[];
  isWaiting: boolean;
  sendMessage: (text: string) => Promise<void>;
  retry: (messageId: string) => Promise<void>;
  clearHistory: () => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

const STORAGE_KEY = "tradeos_ai_chat_v1";
const MAX_MESSAGES = 100;

function loadMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function saveMessages(messages: ChatMessage[]): void {
  try {
    const trimmed = messages.slice(-MAX_MESSAGES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

function generateSessionId(): string {
  return `sess_web_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function loadSessionId(): string {
  try {
    const stored = localStorage.getItem("tradeos_ai_session_id");
    if (stored) return stored;
  } catch {}
  const id = generateSessionId();
  try {
    localStorage.setItem("tradeos_ai_session_id", id);
  } catch {}
  return id;
}

let messageCounter = 0;
function nextId(): string {
  messageCounter++;
  return `msg_${Date.now()}_${messageCounter}`;
}

export function useAIChat(
  onChat: (message: string, context?: ChatContext) => Promise<ChatResponse>,
): UseAIChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages());
  const [isWaiting, setIsWaiting] = useState(false);
  const pendingRef = useRef(false);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const sessionIdRef = useRef<string>(loadSessionId());
  // Mirrors `messages` after each commit, so buildContext() inside a send
  // handler sees the turns already on screen — not the message that was
  // just appended (that one travels as the request message itself).
  const messagesRef = useRef<ChatMessage[]>(messages);

  // Persist messages whenever they change
  useEffect(() => {
    saveMessages(messages);
    messagesRef.current = messages;
  }, [messages]);

  const buildContext = useCallback((messagesOverride?: ChatMessage[]): ChatContext => {
    // By default the history comes from messagesRef, which mirrors the
    // on-screen messages after each commit. Callers that have just sliced
    // the list (retry) must pass the sliced list explicitly: the ref is
    // only synced by the effect above, so reading it synchronously after
    // setMessages would still see the pre-slice turns — including the
    // failed assistant reply the retry is meant to drop.
    const source = messagesOverride ?? messagesRef.current;
    const history = source
      .filter((m) => m.text.trim().length > 0)
      .slice(-10)
      .map((m) => ({ role: m.role, text: m.text }));
    return {
      sessionId: sessionIdRef.current,
      conversationId: conversationIdRef.current,
      history,
    };
  }, []);

  const updateFromResponse = useCallback((response: ChatResponse) => {
    if (response.conversationId) {
      conversationIdRef.current = response.conversationId;
    }
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (pendingRef.current) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    pendingRef.current = true;
    setIsWaiting(true);

    const userMsg: ChatMessage = {
      id: nextId(),
      role: "user",
      text: trimmed,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const ctx = buildContext();
      const result = await onChat(trimmed, ctx);
      updateFromResponse(result);
      const assistantMsg: ChatMessage = {
        id: nextId(),
        role: "assistant",
        text: result.ok ? result.message : "",
        timestamp: Date.now(),
        provider: result.provider,
        model: result.model,
        error: result.ok ? undefined : result.error,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const assistantMsg: ChatMessage = {
        id: nextId(),
        role: "assistant",
        text: "",
        timestamp: Date.now(),
        error: err instanceof Error ? err.message : "An unexpected error occurred",
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } finally {
      pendingRef.current = false;
      setIsWaiting(false);
    }
  }, [onChat, buildContext, updateFromResponse]);

  const retry = useCallback(async (messageId: string) => {
    const msgIndex = messages.findIndex((m) => m.id === messageId);
    if (msgIndex < 0 || msgIndex === 0) return;

    const userMsg = messages[msgIndex - 1];
    if (userMsg.role !== "user") return;

    // History for the retry: everything BEFORE the user message being
    // retried. The failed assistant reply (and the user message itself,
    // which travels as the request message) must not be sent as history —
    // build it from this sliced list, not from messagesRef, which still
    // holds the pre-slice turns until the effect below syncs it.
    const retryHistory = messages.slice(0, msgIndex - 1);

    setMessages((prev) => prev.slice(0, msgIndex));

    const trimmed = userMsg.text.trim();
    if (!trimmed) return;

    pendingRef.current = true;
    setIsWaiting(true);

    try {
      const ctx = buildContext(retryHistory);
      const result = await onChat(trimmed, ctx);
      updateFromResponse(result);
      const assistantMsg: ChatMessage = {
        id: nextId(),
        role: "assistant",
        text: result.ok ? result.message : "",
        timestamp: Date.now(),
        provider: result.provider,
        model: result.model,
        error: result.ok ? undefined : result.error,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const assistantMsg: ChatMessage = {
        id: nextId(),
        role: "assistant",
        text: "",
        timestamp: Date.now(),
        error: err instanceof Error ? err.message : "An unexpected error occurred",
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } finally {
      pendingRef.current = false;
      setIsWaiting(false);
    }
  }, [messages, onChat, buildContext, updateFromResponse]);

  const clearHistory = useCallback(() => {
    setMessages([]);
    saveMessages([]);
    conversationIdRef.current = undefined;
  }, []);

  return { messages, isWaiting, sendMessage, retry, clearHistory, setMessages };
}
