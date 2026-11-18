"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import {
  AlertCircle,
  History,
  Loader2,
  Mic,
  MicOff,
  RefreshCw,
  Send,
  Square,
  Volume2,
} from "lucide-react";
import { useRegional } from "@/components/regional/RegionalProvider";
import type {
  AiVoiceOperatorMessage,
  AiVoiceOperatorSession,
} from "@/lib/tradeos/types";

export interface AiVoiceOperatorProps {
  isListening: boolean;
  isSpeaking: boolean;
  isLoading: boolean;
  transcriptPreview: string;
  input: string;
  onInputChange: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  operatorMessage: string | null;
  operatorError: string | null;
  handsFreeMessage: string | null;
  handsFreeError: string | null;
  autoSpeak: boolean;
  onAutoSpeakChange: (value: boolean) => void;
  autoSendEnabled: boolean;
  onAutoSendEnabledChange: (value: boolean) => void;
  autoSendTimerActive: boolean;
  pendingAutoSendText: string;
  language: string;
  onLanguageChange: (value: string) => void;
  sessions: AiVoiceOperatorSession[];
  selectedSessionId: string;
  onSelectSession: (id: string) => void;
  messages: AiVoiceOperatorMessage[];
  actionMessage: string | null;
  actionError: string | null;
  awaitingConfirmation: boolean;
  onStartListening: () => void;
  onStopListening: () => void;
  onSend: () => void;
  onStopReply: () => void;
  onCancelAutoSend: () => void;
  onEditBeforeSend: () => void;
  onRefreshHistory: () => void;
}

function MessageBubble({ message }: { message: AiVoiceOperatorMessage }) {
  const isOwner = message.role === "owner";
  const meta = [message.message_type, message.detected_intent, message.routed_to]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={`flex gap-3 ${isOwner ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
          isOwner
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        } shadow-sm`}
      >
        {isOwner ? <Mic className="size-4" /> : <Volume2 className="size-4" />}
      </div>
      <div className={`max-w-[85%] space-y-1 ${isOwner ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 ${
            isOwner
              ? "bg-primary text-primary-foreground rounded-tr-md"
              : message.message_type === "error"
                ? "bg-destructive/5 border border-destructive/20 text-foreground rounded-tl-md"
                : "bg-card border border-border/60 text-foreground rounded-tl-md shadow-sm"
          }`}
        >
          <p className="text-sm whitespace-pre-wrap">{message.message_text}</p>
        </div>
        <p className="px-1 text-[11px] text-muted-foreground/60 tabular-nums">
          {meta}
          {meta ? " · " : ""}
          {new Date(message.created_at).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

export function AiVoiceOperator(props: AiVoiceOperatorProps) {
  const { t } = useRegional();
  const { inputRef } = props;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [props.messages, props.isLoading]);

  const statusText = props.isListening
    ? t("page.aiListening")
    : props.isSpeaking
      ? t("ai.voiceOperator.speaking")
      : null;
  const errorText = props.operatorError ?? props.handsFreeError;
  const statusLine = props.handsFreeMessage ?? props.operatorMessage;

  const handleSend = () => {
    if (!props.input.trim() || props.isLoading) return;
    props.onSend();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-6 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Mic className="size-4 shrink-0 text-primary" />
          <h2 className="truncate text-sm font-semibold text-foreground">
            {t("ai.voiceOperator.title")}
          </h2>
          {statusText && (
            <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              {statusText}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={props.onRefreshHistory}
          aria-label={t("ai.voiceOperator.historyTitle")}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-md px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RefreshCw className="size-3" />
          <span className="ml-1 hidden sm:inline">{t("ai.voiceOperator.historyTitle")}</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/50 px-6 py-2">
        <label className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
          {t("ai.voiceOperator.language")}
          <select
            value={props.language}
            onChange={(e) => props.onLanguageChange(e.target.value)}
            className="min-h-11 rounded border border-input bg-card px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="auto">{t("ai.voiceOperator.languageAuto")}</option>
            <option value="en">{t("ai.voiceOperator.languageEnglish")}</option>
            <option value="urdu">{t("ai.voiceOperator.languageUrdu")}</option>
            <option value="roman_urdu">{t("ai.voiceOperator.languageRomanUrdu")}</option>
          </select>
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={props.autoSpeak}
            onChange={(e) => props.onAutoSpeakChange(e.target.checked)}
            className="size-5 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {t("ai.voiceOperator.autoSpeak")}
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={props.autoSendEnabled}
            onChange={(e) => props.onAutoSendEnabledChange(e.target.checked)}
            className="size-5 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {t("ai.voiceOperator.autoSend")}
        </label>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {errorText && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{errorText}</span>
          </div>
        )}

        {statusLine && (
          <p className="rounded bg-muted px-3 py-2 text-sm text-muted-foreground">{statusLine}</p>
        )}

        {(props.actionMessage || props.actionError || props.awaitingConfirmation) && (
          <div className="space-y-1 rounded border border-warning/20 bg-warning/5 px-3 py-2 text-sm text-foreground">
            {props.actionMessage && <p>{props.actionMessage}</p>}
            {props.actionError && <p className="text-destructive">{props.actionError}</p>}
          </div>
        )}

        {props.autoSendTimerActive && (
          <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">
            <span className="min-w-0 flex-1 truncate">{props.pendingAutoSendText}</span>
            <button
              type="button"
              onClick={props.onCancelAutoSend}
              className="min-h-11 rounded-md px-2.5 py-1 text-xs font-medium text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("ai.voiceOperator.cancelAutoSend")}
            </button>
            <button
              type="button"
              onClick={props.onEditBeforeSend}
              className="min-h-11 rounded-md px-2.5 py-1 text-xs font-medium text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("ai.voiceOperator.editBeforeSend")}
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
            <History className="size-4" />
            {t("ai.voiceOperator.sessionsTitle")}
            <select
              value={props.selectedSessionId}
              onChange={(e) => props.onSelectSession(e.target.value)}
              className="min-h-11 max-w-56 truncate rounded border border-input bg-card px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">{t("ai.voiceOperator.newSession")}</option>
              {props.sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.session_title ?? "Voice Operator Session"} ·{" "}
                  {session.created_at
                    ? new Date(session.created_at).toLocaleDateString()
                    : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        {props.messages.length === 0 && !props.isLoading ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-primary/10">
              <Mic className="size-8 text-primary" />
            </div>
            <p className="max-w-md text-sm text-muted-foreground">
              {t("ai.voiceOperator.emptyHint")}
            </p>
          </div>
        ) : (
          <>
            {props.messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {props.isLoading && (
              <div className="flex gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground shadow-sm">
                  <Volume2 className="size-4" />
                </div>
                <div className="rounded-2xl rounded-tl-md bg-card border border-border/60 px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    <span className="animate-pulse text-sm text-muted-foreground">
                      {t("ai.assistant.thinking")}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-border/50 px-4 py-3">
        {props.transcriptPreview && (
          <p className="mb-2 rounded bg-muted px-3 py-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {t("ai.voiceOperator.transcriptLabel")}:{" "}
            </span>
            {props.transcriptPreview}
          </p>
        )}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={props.isListening ? props.onStopListening : props.onStartListening}
            aria-label={
              props.isListening
                ? t("ai.voiceOperator.stopListening")
                : t("ai.voiceOperator.startListening")
            }
            aria-pressed={props.isListening}
            className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              props.isListening
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-primary text-primary-foreground hover:bg-primary-hover"
            }`}
          >
            {props.isListening ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </button>
          <textarea
            ref={(node) => {
              if (inputRef) inputRef.current = node;
            }}
            value={props.input}
            onChange={(e) => props.onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("ai.voiceOperator.inputPlaceholder")}
            rows={2}
            className="min-h-11 w-full flex-1 resize-none rounded-xl border border-input bg-muted/20 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            disabled={props.isLoading}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!props.input.trim() || props.isLoading}
            aria-label={t("ai.voiceOperator.send")}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {props.isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {props.isSpeaking && (
            <button
              type="button"
              onClick={props.onStopReply}
              className="flex min-h-11 items-center gap-1 rounded-md px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Square className="size-3" />
              {t("ai.voiceOperator.stopReply")}
            </button>
          )}
          <p className="text-[11px] text-muted-foreground/50 text-center">
            {t("ai.assistant.enterHint")}
          </p>
        </div>
      </div>
    </div>
  );
}
