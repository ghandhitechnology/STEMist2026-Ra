"use client";

/**
 * lib/store.ts — lightweight client-side conversation store.
 * localStorage persistence, exposed via the `useConversations` hook.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Conversation, Message } from "./types";

/**
 * Conversations are per browser AND per account: two people signing in on the
 * same machine must never see each other's transcripts, so the signed-in
 * WorkOS user id is part of the key.
 */
export const STORAGE_KEY_PREFIX = "rauchat.conversations.v1";

function storageKeyFor(userId: string): string {
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadConversations(userId: string): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKeyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Conversation[];
  } catch {
    return [];
  }
}

function saveConversations(
  userId: string,
  conversations: Conversation[]
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKeyFor(userId),
      JSON.stringify(conversations)
    );
  } catch {
    // Storage full or unavailable — persistence is best-effort.
  }
}

/** Drops every account's stored conversations (Settings -> clear data). */
export function clearAllStoredConversations(): void {
  if (typeof window === "undefined") return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEY_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    // Best-effort.
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

/**
 * @param userId signed-in WorkOS user id. While null (the account is still
 * loading) nothing is read or written, so one account's conversations can
 * never be flushed into another's key.
 */
export function useConversations(userId: string | null): UseConversations {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // The account whose conversations are currently in state.
  const loadedFor = useRef<string | null>(null);

  // Hydrate on mount and whenever the signed-in account changes.
  useEffect(() => {
    if (!userId) return;
    if (loadedFor.current === userId) return;
    loadedFor.current = userId;
    setConversations(loadConversations(userId));
    setActiveId(null);
    setHydrated(true);
  }, [userId]);

  // Persist on every change, but only into the account we hydrated from.
  useEffect(() => {
    if (!userId || loadedFor.current !== userId) return;
    saveConversations(userId, conversations);
  }, [userId, conversations]);

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

  // Title changes deliberately leave updatedAt alone — the sidebar sorts by
  // updatedAt, and renaming a chat must not move it in the list.
  const renameConversation = useCallback((id: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c))
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
          c.id === id ? { ...c, title, titledAtCount } : c
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
