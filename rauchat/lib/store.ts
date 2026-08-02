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

/** The name a conversation carries until Luna renames it (lib/useAutoTitle.ts). */
export const DEFAULT_CONVERSATION_TITLE = "New chat";

/**
 * "Untouched" = nothing was ever said in it AND it still carries the default
 * name. These are scratch rows, not history: at most one exists at a time
 * (see `createConversation`), the user navigating away sweeps it, and it is
 * never written to localStorage.
 */
export function isUntouchedConversation(conversation: Conversation): boolean {
  return (
    conversation.messages.length === 0 &&
    conversation.title === DEFAULT_CONVERSATION_TITLE
  );
}

/**
 * Fallbacks for the sidebar row pop animations. A row that is never on screen
 * (collapsed sidebar, filtered out by search) fires no `animationend`, so
 * every pop is also on a timer — a swept conversation must disappear whether
 * or not anyone watched it go. Keep these above the matching durations in
 * components/sidebar/ConversationItem.module.css.
 */
const ROW_ENTER_FALLBACK_MS = 420;
const ROW_LEAVE_FALLBACK_MS = 280;

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
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Conversation[]) : [];
    }
    return adoptLegacyConversations(userId);
  } catch {
    return [];
  }
}

/**
 * Before accounts existed, every conversation lived under one unkeyed
 * localStorage entry. The first account to sign in on a browser that still
 * has one claims it — and consumes it, so a second account signing in later
 * does not inherit someone else's transcripts.
 */
function adoptLegacyConversations(userId: string): Conversation[] {
  try {
    const legacy = window.localStorage.getItem(STORAGE_KEY_PREFIX);
    if (!legacy) return [];
    const parsed = JSON.parse(legacy);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY_PREFIX);
      return [];
    }
    const conversations = parsed as Conversation[];
    window.localStorage.setItem(storageKeyFor(userId), JSON.stringify(conversations));
    window.localStorage.removeItem(STORAGE_KEY_PREFIX);
    return conversations;
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

/**
 * Merges the local cache with the server's copy, whole-conversation
 * last-write-wins by `updatedAt`. Ties go to the SERVER copy: renames leave
 * `updatedAt` alone by design (sidebar order), so an otherwise-unchanged
 * local conversation must not clobber a rename that already synced.
 * Local-only conversations are kept — they are the pre-server history that
 * migrates up on the next flush.
 */
export function mergeConversations(
  local: Conversation[],
  remote: Conversation[]
): Conversation[] {
  const remoteById = new Map(remote.map((c) => [c.id, c]));
  const merged: Conversation[] = [];
  const seen = new Set<string>();
  for (const conversation of local) {
    const server = remoteById.get(conversation.id);
    merged.push(
      server && server.updatedAt >= conversation.updatedAt
        ? server
        : conversation
    );
    seen.add(conversation.id);
  }
  for (const conversation of remote) {
    if (!seen.has(conversation.id)) merged.push(conversation);
  }
  return merged;
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
  /** Ids whose sidebar row should play its pop-in (created this session). */
  enteringIds: string[];
  /**
   * Ids playing their pop-out. They are still in `conversations` — the row
   * animates first and is dropped from state by `finishRowAnimation`.
   */
  leavingIds: string[];
  /**
   * Called by a row when a pop animation ends (or is skipped). Idempotent:
   * the two-part animation fires it twice, and the fallback timer may beat
   * both.
   */
  finishRowAnimation: (id: string) => void;
  /**
   * Creates a conversation and selects it. With the default title this
   * reuses an existing untouched conversation instead of stacking another
   * blank row; a custom title (a branch) always makes a new one.
   */
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

  // Mirrors of the two pieces of state that callbacks have to read *now* —
  // dedupe and the untouched sweep both decide inside an event handler, one
  // render before the state they depend on would reach them.
  const conversationsRef = useRef<Conversation[]>([]);
  const activeIdRef = useRef<string | null>(null);

  /** Every write goes through here so `conversationsRef` can never drift. */
  const updateConversations = useCallback(
    (updater: (prev: Conversation[]) => Conversation[]) => {
      setConversations((prev) => {
        const next = updater(prev);
        conversationsRef.current = next;
        return next;
      });
    },
    []
  );

  const commitActiveId = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
  }, []);

  // --- Sidebar row pop lifecycle -------------------------------------------
  // The sets are the source of truth (a row's two animations both end in the
  // same tick, before any re-render); the arrays are what renders.
  const [enteringIds, setEnteringIds] = useState<string[]>([]);
  const [leavingIds, setLeavingIds] = useState<string[]>([]);
  const enteringRef = useRef<Set<string>>(new Set());
  const leavingRef = useRef<Set<string>>(new Set());
  const rowTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clearRowTimer = useCallback((id: string) => {
    const timer = rowTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      rowTimers.current.delete(id);
    }
  }, []);

  const finishRowAnimationRef = useRef<(id: string) => void>(() => {});

  const finishRowAnimation = useCallback(
    (id: string) => {
      clearRowTimer(id);
      if (enteringRef.current.delete(id)) {
        setEnteringIds((prev) => prev.filter((x) => x !== id));
      }
      if (!leavingRef.current.delete(id)) return;
      setLeavingIds((prev) => prev.filter((x) => x !== id));
      // A message that landed while the row was animating out cancels the
      // sweep — the conversation stopped being scratch space.
      const target = conversationsRef.current.find((c) => c.id === id);
      if (target && isUntouchedConversation(target)) {
        updateConversations((prev) => prev.filter((c) => c.id !== id));
        if (activeIdRef.current === id) commitActiveId(null);
      }
    },
    [clearRowTimer, commitActiveId, updateConversations]
  );
  finishRowAnimationRef.current = finishRowAnimation;

  const scheduleRowTimer = useCallback(
    (id: string, ms: number) => {
      clearRowTimer(id);
      rowTimers.current.set(
        id,
        setTimeout(() => finishRowAnimationRef.current(id), ms)
      );
    },
    [clearRowTimer]
  );

  /** Marks a just-created row so it pops in — nothing else ever animates. */
  const startRowEnter = useCallback(
    (id: string) => {
      enteringRef.current.add(id);
      setEnteringIds((prev) => [...prev, id]);
      scheduleRowTimer(id, ROW_ENTER_FALLBACK_MS);
    },
    [scheduleRowTimer]
  );

  /** Marks a doomed row so it pops out; deletion happens when it lands. */
  const startRowLeave = useCallback(
    (id: string) => {
      if (leavingRef.current.has(id)) return;
      leavingRef.current.add(id);
      setLeavingIds((prev) => [...prev, id]);
      scheduleRowTimer(id, ROW_LEAVE_FALLBACK_MS);
    },
    [scheduleRowTimer]
  );

  // Pending pops die with the component; nothing may fire after unmount.
  useEffect(() => {
    const timers = rowTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  // --- Server persistence ---------------------------------------------------
  // localStorage stays the warm cache; /api/conversations is the cross-device
  // source of truth. Dirtiness is tracked by object identity: every mutation
  // of a conversation produces a new object via `updateConversations`, so a
  // conversation is dirty exactly when its current reference differs from the
  // one last confirmed on (or received from) the server.
  const lastSyncedRef = useRef(new Map<string, Conversation>());
  const inFlightRef = useRef(new Set<string>());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncDirty = useCallback((keepalive = false) => {
    if (!loadedFor.current) return;
    for (const conversation of conversationsRef.current) {
      // Untouched rows are session scratch space, same as for localStorage.
      if (isUntouchedConversation(conversation)) continue;
      if (lastSyncedRef.current.get(conversation.id) === conversation) continue;
      // One request per conversation at a time — a response landing for an
      // older snapshot after a newer one would mark stale state as synced.
      if (inFlightRef.current.has(conversation.id)) continue;
      const snapshot = conversation;
      inFlightRef.current.add(snapshot.id);
      fetch(`/api/conversations/${encodeURIComponent(snapshot.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
        keepalive,
      })
        .then((res) => {
          if (res.ok) lastSyncedRef.current.set(snapshot.id, snapshot);
        })
        .catch(() => {
          // Offline or server down — still dirty, retried on the next flush.
        })
        .finally(() => {
          inFlightRef.current.delete(snapshot.id);
        });
    }
  }, []);

  const syncDirtyRef = useRef(syncDirty);
  syncDirtyRef.current = syncDirty;

  /**
   * Throttle, not debounce: the timer is NOT reset by further changes, so a
   * streaming reply (which touches its conversation on every token) still
   * flushes at most ~1.2s after the first unsynced change.
   */
  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      syncDirtyRef.current();
    }, 1200);
  }, []);

  useEffect(() => {
    if (!userId || loadedFor.current !== userId) return;
    scheduleFlush();
  }, [userId, conversations, scheduleFlush]);

  // A tab closing mid-stream must not lose the turn: flush synchronously with
  // keepalive so the requests outlive the page.
  useEffect(() => {
    const onPageHide = () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      syncDirtyRef.current(true);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, []);

  // Pull the server's history once per account and merge it in. Server
  // copies are recorded as synced by reference: wherever the merge kept the
  // LOCAL object instead (newer here, or never uploaded), that conversation
  // is left dirty and the scheduled flush migrates it up.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/conversations", {
          headers: { accept: "application/json" },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { conversations?: unknown };
        const remote = Array.isArray(data.conversations)
          ? (data.conversations as Conversation[])
          : [];
        if (cancelled || loadedFor.current !== userId) return;
        for (const conversation of remote) {
          lastSyncedRef.current.set(conversation.id, conversation);
        }
        updateConversations((prev) => mergeConversations(prev, remote));
        scheduleFlush();
      } catch {
        // Offline — the localStorage cache stands.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, updateConversations, scheduleFlush]);

  // Hydrate on mount and whenever the signed-in account changes.
  useEffect(() => {
    if (!userId) return;
    const previous = loadedFor.current;
    if (previous === userId) return;
    loadedFor.current = userId;
    const stored = loadConversations(userId);

    if (previous === null) {
      // First hydration. The account arrives one fetch after mount, so the
      // user may already have started a conversation — keep it rather than
      // replacing state out from under them.
      updateConversations((pending) => {
        if (!pending.length) return stored;
        const stored_ids = new Set(stored.map((c) => c.id));
        return [...pending.filter((c) => !stored_ids.has(c.id)), ...stored];
      });
    } else {
      // A genuinely different account: replace wholesale, select nothing.
      // Any pop in flight belonged to the previous account's rows.
      for (const timer of rowTimers.current.values()) clearTimeout(timer);
      rowTimers.current.clear();
      enteringRef.current.clear();
      leavingRef.current.clear();
      setEnteringIds([]);
      setLeavingIds([]);
      // Sync bookkeeping belonged to the previous account too.
      lastSyncedRef.current.clear();
      inFlightRef.current.clear();
      updateConversations(() => stored);
      commitActiveId(null);
    }
    setHydrated(true);
  }, [userId, updateConversations, commitActiveId]);

  // Persist on every change, but only into the account we hydrated from.
  // Untouched conversations are deliberately left out: a blank "New chat"
  // is session scratch space and must not come back after a reload. The one
  // on screen still lives in React state, so the session is unaffected.
  useEffect(() => {
    if (!userId || loadedFor.current !== userId) return;
    saveConversations(
      userId,
      conversations.filter((c) => !isUntouchedConversation(c))
    );
  }, [userId, conversations]);

  const createConversation = useCallback(
    (title = DEFAULT_CONVERSATION_TITLE): Conversation => {
      // Repeated "New chat" clicks must not pile up identical blank rows:
      // the untouched one already on screen *is* the new chat. Only the
      // default-title path dedupes — a branch names itself and always gets a
      // conversation of its own.
      if (title === DEFAULT_CONVERSATION_TITLE) {
        const existing = conversationsRef.current.find(
          (c) => isUntouchedConversation(c) && !leavingRef.current.has(c.id)
        );
        if (existing) {
          // Already active → genuinely nothing happens.
          if (activeIdRef.current !== existing.id) commitActiveId(existing.id);
          return existing;
        }
      }
      // Creating a differently-named conversation (a branch) is also
      // navigating away, so it sweeps an untouched chat just like a
      // selection does. The default path never gets here with one open —
      // the dedupe above already returned it.
      const previousId = activeIdRef.current;
      if (previousId) {
        const previous = conversationsRef.current.find(
          (c) => c.id === previousId
        );
        if (previous && isUntouchedConversation(previous)) {
          startRowLeave(previous.id);
        }
      }

      const now = Date.now();
      const conversation: Conversation = {
        id: generateId(),
        title,
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      updateConversations((prev) => [conversation, ...prev]);
      commitActiveId(conversation.id);
      startRowEnter(conversation.id);
      return conversation;
    },
    [commitActiveId, startRowEnter, startRowLeave, updateConversations]
  );

  const selectConversation = useCallback(
    (id: string | null) => {
      // Navigating off an untouched conversation sweeps it — it was never
      // used, and a lingering blank row is exactly what piled the sidebar
      // up. The row pops out first; `finishRowAnimation` deletes it.
      const previousId = activeIdRef.current;
      if (previousId && previousId !== id) {
        const previous = conversationsRef.current.find(
          (c) => c.id === previousId
        );
        if (previous && isUntouchedConversation(previous)) {
          startRowLeave(previous.id);
        }
      }
      commitActiveId(id);
    },
    [commitActiveId, startRowLeave]
  );

  const deleteConversation = useCallback(
    (id: string) => {
      clearRowTimer(id);
      enteringRef.current.delete(id);
      leavingRef.current.delete(id);
      setEnteringIds((prev) => prev.filter((x) => x !== id));
      setLeavingIds((prev) => prev.filter((x) => x !== id));
      updateConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeIdRef.current === id) commitActiveId(null);
      // Best-effort server delete. The `{}` JSON body exists only to satisfy
      // the shared cross-site guard, which keys on Content-Type.
      lastSyncedRef.current.delete(id);
      if (loadedFor.current) {
        fetch(`/api/conversations/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }).catch(() => {});
      }
    },
    [clearRowTimer, commitActiveId, updateConversations]
  );

  // Title changes deliberately leave updatedAt alone — the sidebar sorts by
  // updatedAt, and renaming a chat must not move it in the list.
  const renameConversation = useCallback((id: string, title: string) => {
    updateConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c))
    );
  }, [updateConversations]);

  const setConversationModel = useCallback(
    (id: string, modelId: string, thinking: string) => {
      updateConversations((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, modelId, thinking, updatedAt: Date.now() } : c
        )
      );
    },
    [updateConversations]
  );

  const setConversationTitleMeta = useCallback(
    (id: string, title: string, titledAtCount: number) => {
      updateConversations((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, title, titledAtCount } : c
        )
      );
    },
    [updateConversations]
  );

  const appendMessage = useCallback(
    (conversationId: string, message: Message) => {
      updateConversations((prev) =>
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
    [updateConversations]
  );

  const updateMessage = useCallback(
    (conversationId: string, messageId: string, patch: Partial<Message>) => {
      updateConversations((prev) =>
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
    [updateConversations]
  );

  const replaceMessages = useCallback(
    (conversationId: string, messages: Message[]) => {
      updateConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, messages, updatedAt: Date.now() }
            : c
        )
      );
    },
    [updateConversations]
  );

  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  const activeConversation =
    conversations.find((c) => c.id === activeId) ?? null;

  return {
    conversations: sorted,
    activeConversation,
    activeId,
    hydrated,
    enteringIds,
    leavingIds,
    finishRowAnimation,
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
