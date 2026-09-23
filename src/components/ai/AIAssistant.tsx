"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Bot,
  User,
  Send,
  RotateCcw,
  Copy,
  Check,
  Trash2,
  Sparkles,
  ChevronDown,
  AlertCircle,
  Brain,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { useAIChat, type ChatMessage, type ChatContext } from "@/hooks/useAIChat";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { SuggestedQuestions } from "./SuggestedQuestions";
import { extractBusinessCards, BusinessCard } from "./BusinessCard";
import type { ChatResponse } from "@/lib/conversation";

interface AIAssistantProps {
  onChat: (message: string, context?: ChatContext) => Promise<ChatResponse>;
  brainAvailable: boolean;
}

function ChatBubble({ message, onRetry }: { message: ChatMessage; onRetry: () => void }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const isUser = message.role === "user";
  const hasError = !!message.error;
  const hasContent = message.text.length > 0;

  const handleCopy = () => {
    navigator.clipboard.writeText(message.text);
    setCopiedId(message.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const { cards, cleanText } = !isUser ? extractBusinessCards(message.text) : { cards: [] as any[], cleanText: message.text };

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"} animate-in fade-in slide-in-from-bottom-2 duration-200`}>
      <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"} shadow-sm`}>
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>

      <div className={`group max-w-[85%] space-y-1 ${isUser ? "items-end" : "items-start"}`}>
        {!isUser && message.provider && (
          <span className="text-[10px] text-muted-foreground/60 px-1">{message.provider}{message.model ? ` · ${message.model}` : ""}</span>
        )}

        <div className={`rounded-2xl px-4 py-2.5 ${
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-md"
            : hasError
              ? "bg-red-500/10 border border-red-500/20 text-foreground rounded-tl-md"
              : "bg-card border border-border/60 text-foreground rounded-tl-md shadow-sm"
        }`}>
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap">{message.text}</p>
          ) : hasError ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-red-600">
                <AlertCircle className="size-4 shrink-0" />
                <span className="text-sm font-medium">Error</span>
              </div>
              <p className="text-sm text-muted-foreground">{message.error}</p>
            </div>
          ) : hasContent ? (
            <div className="space-y-1">
              {cards.map((card, i) => (
                <BusinessCard key={i} {...card} />
              ))}
              <MarkdownRenderer content={cleanText} />
            </div>
          ) : null}
        </div>

        {!isUser && hasContent && (
          <div className="hover-reveal flex items-center gap-0.5 px-1">
            <button onClick={handleCopy} className="flex min-h-6 items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={copiedId === message.id ? "Copied" : "Copy response"}>
              {copiedId === message.id ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
              <span>{copiedId === message.id ? "Copied" : "Copy"}</span>
            </button>
            <button onClick={onRetry} className="flex min-h-6 items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title="Retry">
              <RotateCcw className="size-3" />
              <span>Retry</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function WaitingBubble() {
  return (
    <div className="flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground shadow-sm">
        <Bot className="size-4" />
      </div>
      <div className="rounded-2xl rounded-tl-md bg-card border border-border/60 px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground animate-pulse">Thinking...</span>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onSelectQuestion }: { onSelectQuestion: (q: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 px-4 py-16 text-center">
      <div className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-primary/10">
        <Brain className="size-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">AI Business Assistant</h2>
      <p className="text-sm text-muted-foreground max-w-md mb-8">
        Ask anything about your business — revenue, inventory, customers, recommendations, or forecasts. Your personal AI understands context and remembers your conversation.
      </p>
      <SuggestedQuestions onSelect={onSelectQuestion} visible={true} />
    </div>
  );
}

export function AIAssistant({ onChat, brainAvailable }: AIAssistantProps) {
  const { messages, isWaiting, sendMessage, retry, clearHistory } = useAIChat(onChat);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showQuestions, setShowQuestions] = useState(true);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isWaiting]);

  useEffect(() => {
    if (messages.length > 0) setShowQuestions(false);
  }, [messages.length]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isWaiting) return;
    setInput("");
    setShowQuestions(false);
    sendMessage(trimmed);
  }, [input, isWaiting, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSelectQuestion = (question: string) => {
    setInput("");
    setShowQuestions(false);
    sendMessage(question);
  };

  const handleRetry = (messageId: string) => {
    retry(messageId);
  };

  const inputHeight = Math.min(Math.max(input.split("\n").length, 1), 5);

  if (!brainAvailable) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center px-6 py-12 max-w-md">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-muted">
            <AlertCircle className="size-7 text-muted-foreground" />
          </div>
          <h3 className="text-base font-semibold text-foreground mb-2">Business Brain Not Ready</h3>
          <p className="text-sm text-muted-foreground">
            Load your business data first from the Dashboard. The AI Assistant needs your business context to provide insights.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-6 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">AI Assistant</h2>
          {isWaiting && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40"></span>
                <span className="relative inline-flex size-2 rounded-full bg-primary"></span>
              </span>
              Active
            </span>
          )}
        </div>
        {messages.length > 0 && (
          <button onClick={clearHistory} className="flex min-h-6 items-center gap-1 rounded-md px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Trash2 className="size-3" />
            Clear chat
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !isWaiting ? (
          <EmptyState onSelectQuestion={handleSelectQuestion} />
        ) : (
          <>
            {messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} onRetry={() => handleRetry(msg.id)} />
            ))}
            {isWaiting && <WaitingBubble />}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-border/50 px-4 py-3">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your business..."
              rows={1}
              style={{ height: `${Math.min(inputHeight, 5) * 1.5 + 0.75}rem` }}
              className="w-full resize-none rounded-xl border border-border/60 bg-muted/20 px-4 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
              disabled={isWaiting}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isWaiting}
            className="flex size-[42px] shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {isWaiting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground/50 text-center">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
