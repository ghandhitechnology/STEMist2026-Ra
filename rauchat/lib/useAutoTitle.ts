"use client";

/**
 * lib/useAutoTitle.ts — conversation naming orchestration.
 *
 * Titles are written by GPT-5.6 Luna behind `POST /api/title`
 * ({ messages, previousTitle? } -> { title }). This hook decides *when* to ask
 * and hands the answer back with the animation the moment deserves:
 *
 *   1. `maybeTitleAfterFirstExchange(conversation)` — call once the first
 *      assistant reply has finished. Fires only for a conversation that is
 *      still called "New chat" and holds exactly one completed exchange. The
 *      title arrives with mode `"type"` (it is being named for the first time).
 *
 *   2. `retitleOnExit(conversation)` — call when the user leaves a conversation
 *      (switches to another one, or starts a new one). Fires only if the
 *      conversation has grown past `Conversation.titledAtCount`, i.e. the
 *      existing name no longer covers what the conversation became. The title
 *      arrives with mode `"retype"` so the UI erases the stale name before
 *      typing the new one.
 *
 * Both are fire-and-forget. A conversation already waiting on the API is
 * skipped, and every failure is swallowed: an automatic rename that did not
 * happen is invisible by design and must never produce a toast, a banner, or a
 * console-visible break in the user's flow (DESIGN.md §1.7 — absence must look
 * intentional).
 *
 * The caller owns persistence. On receiving `onTitle` it should write the new
 * title and set `titledAtCount` to the conversation's current message count,
 * which is what gates the next `retitleOnExit`.
 */

import { useCallback, useMemo, useRef } from "react";
import type { Conversation, Message } from "@/lib/types";

/** How the receiving UI should animate into the new title. */
export type TitleAnimationMode = "type" | "retype";

/** Called on the client thread once a title comes back. */
export type OnTitleHandler = (
  conversationId: string,
  title: string,
  mode: TitleAnimationMode
) => void;

export type UseAutoTitleOptions = {
  onTitle: OnTitleHandler;
  /** Override the naming endpoint (tests). Default `/api/title`. */
  endpoint?: string;
  /** Skip the network entirely (tests / storybook). Default `true`. */
  enabled?: boolean;
};

export type UseAutoTitleResult = {
  /** First naming, after the first completed user+assistant exchange. */
  maybeTitleAfterFirstExchange: (conversation: Conversation) => Promise<void>;
  /** Regeneration, when the user navigates away from a grown conversation. */
  retitleOnExit: (conversation: Conversation) => Promise<void>;
  /** True while a request for this conversation is outstanding. */
  isTitling: (conversationId: string) => boolean;
};

/** Titles that mean "this conversation has never been named". */
export const DEFAULT_TITLES: readonly string[] = ["New chat", "Untitled"];

/** A title is "default" when it is blank or one of the placeholders. */
export function isDefaultTitle(title: string | undefined | null): boolean {
  const t = (title ?? "").trim();
  return t.length === 0 || DEFAULT_TITLES.some((d) => d.toLowerCase() === t.toLowerCase());
}

const DEFAULT_ENDPOINT = "/api/title";

/** The API only wants the transcript — no ids, tool events, or telemetry. */
function toTranscript(messages: Message[]): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter((m) => typeof m.content === "string" && m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * A conversation is ready for its first name once it holds exactly one user
 * message answered by one non-empty assistant message.
 */
function hasCompletedFirstExchange(conversation: Conversation): boolean {
  const msgs = conversation.messages ?? [];
  if (msgs.length !== 2) return false;
  return (
    msgs[0].role === "user" &&
    msgs[1].role === "assistant" &&
    msgs[1].content.trim().length > 0
  );
}

export function useAutoTitle({
  onTitle,
  endpoint = DEFAULT_ENDPOINT,
  enabled = true,
}: UseAutoTitleOptions): UseAutoTitleResult {
  // Read through refs so both callbacks stay identity-stable across renders —
  // they are wired into effects and event handlers that must not re-subscribe.
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  const endpointRef = useRef(endpoint);
  endpointRef.current = endpoint;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const inFlight = useRef<Set<string>>(new Set());

  const request = useCallback(
    async (
      conversationId: string,
      messages: Message[],
      previousTitle: string | undefined,
      mode: TitleAnimationMode
    ): Promise<void> => {
      if (!enabledRef.current) return;
      if (inFlight.current.has(conversationId)) return;

      const transcript = toTranscript(messages);
      if (transcript.length === 0) return;

      inFlight.current.add(conversationId);
      try {
        const res = await fetch(endpointRef.current, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            previousTitle
              ? { messages: transcript, previousTitle }
              : { messages: transcript }
          ),
        });
        if (!res.ok) return;
        const data: unknown = await res.json();
        const title =
          typeof (data as { title?: unknown })?.title === "string"
            ? ((data as { title: string }).title).trim()
            : "";
        if (!title) return;
        // A model that echoed the name back is not a change worth animating.
        if (previousTitle && title === previousTitle) return;
        onTitleRef.current(conversationId, title, mode);
      } catch {
        // Silent by contract — a failed auto-title is a non-event.
      } finally {
        inFlight.current.delete(conversationId);
      }
    },
    []
  );

  const maybeTitleAfterFirstExchange = useCallback(
    async (conversation: Conversation): Promise<void> => {
      if (!conversation?.id) return;
      if (!isDefaultTitle(conversation.title)) return;
      if (!hasCompletedFirstExchange(conversation)) return;
      await request(conversation.id, conversation.messages, undefined, "type");
    },
    [request]
  );

  const retitleOnExit = useCallback(
    async (conversation: Conversation): Promise<void> => {
      if (!conversation?.id) return;
      const messages = conversation.messages ?? [];
      // Needs a full exchange to describe, and needs to have grown since the
      // current name was written.
      if (messages.length < 2) return;
      const titledAt = conversation.titledAtCount ?? 0;
      if (messages.length <= titledAt) return;
      // An untitled conversation has no previous name to improve on; the API
      // then treats this as a first naming, but the UI still retypes because
      // the placeholder is on screen.
      const previousTitle = isDefaultTitle(conversation.title)
        ? undefined
        : conversation.title;
      await request(conversation.id, messages, previousTitle, "retype");
    },
    [request]
  );

  const isTitling = useCallback(
    (conversationId: string) => inFlight.current.has(conversationId),
    []
  );

  return useMemo(
    () => ({ maybeTitleAfterFirstExchange, retitleOnExit, isTitling }),
    [maybeTitleAfterFirstExchange, retitleOnExit, isTitling]
  );
}

export default useAutoTitle;
