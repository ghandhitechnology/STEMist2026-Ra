"use client";

/**
 * lib/store.ts — lightweight client-side conversation store.
 * localStorage persistence, exposed via the `useConversations` hook.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Conversation, Message } from "./types";

const STORAGE_KEY = "rauchat.conversations.v1";

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Conversation[];
  } catch {
    return [];
  }
}

function saveConversations(conversations: Conversation[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch {
    // Storage full or unavailable — persistence is best-effort.
  }
}

export type UseConversations = {
  /** All conversations, most recently updated first. */
  conversations: Conversation[];
  /** Currently selected conversation, or null. */
  activeConversation: Conversation | null;
  activeId: string | null;
  /** True once localStorage has been read on the client. */
  hydrated: boolean;
  createConversation: (title?: string) => Conversation;
  selectConversation: (id: string | null) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  /** Sets the model + thinking level used for this conversation's turns. */
  setConversationModel: (id: string, modelId: string, thinking: string) => void;
  /** Sets the conversation title and records the message count it was generated from. */
  setConversationTitleMeta: (
    id: string,
    title: string,
    titledAtCount: number
  ) => void;
  appendMessage: (conversationId: string, message: Message) => void;
  updateMessage: (
    conversationId: string,
    messageId: string,
    patch: Partial<Message>
  ) => void;
  /** Replaces a conversation's whole message list (regenerate / truncate). */
  replaceMessages: (conversationId: string, messages: Message[]) => void;
};

export function useConversations(): UseConversations {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);

  // Hydrate from localStorage on mount (client only).
  useEffect(() => {
    setConversations(loadConversations());
    hydratedRef.current = true;
    setHydrated(true);
  }, []);

  // Persist on every change after hydration.
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveConversations(conversations);
  }, [conversations]);

  const createConversation = useCallback((title = "New chat"): Conversation => {
    const now = Date.now();
    const conversation: Conversation = {
      id: generateId(),
      title,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    setConversations((prev) => [conversation, ...prev]);
    setActiveId(conversation.id);
    return conversation;
  }, []);

  const selectConversation = useCallback((id: string | null) => {
    setActiveId(id);
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setActiveId((current) => (current === id ? null : current));
  }, []);

  const renameConversation = useCallback((id: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, title, updatedAt: Date.now() } : c
      )
    );
  }, []);

  const setConversationModel = useCallback(
    (id: string, modelId: string, thinking: string) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, modelId, thinking, updatedAt: Date.now() } : c
        )
      );
    },
    []
  );

  const setConversationTitleMeta = useCallback(
    (id: string, title: string, titledAtCount: number) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === id
            ? { ...c, title, titledAtCount, updatedAt: Date.now() }
            : c
        )
      );
    },
    []
  );

  const appendMessage = useCallback(
    (conversationId: string, message: Message) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                messages: [...c.messages, message],
                updatedAt: Date.now(),
              }
            : c
        )
      );
    },
    []
  );

  const updateMessage = useCallback(
    (conversationId: string, messageId: string, patch: Partial<Message>) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === messageId ? { ...m, ...patch } : m
                ),
                updatedAt: Date.now(),
              }
            : c
        )
      );
    },
    []
  );

  const replaceMessages = useCallback(
    (conversationId: string, messages: Message[]) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, messages, updatedAt: Date.now() }
            : c
        )
      );
    },
    []
  );

  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  const activeConversation =
    conversations.find((c) => c.id === activeId) ?? null;

  return {
    conversations: sorted,
    activeConversation,
    activeId,
    hydrated,
    createConversation,
    selectConversation,
    deleteConversation,
    renameConversation,
    setConversationModel,
    setConversationTitleMeta,
    appendMessage,
    updateMessage,
    replaceMessages,
  };
}
