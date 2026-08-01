"use client";

/**
 * app/page.tsx — composes the three-column shell (DESIGN.md §3.1):
 * Sidebar (264px) | ChatView (1fr) | TelemetryPanel (320px), plus the
 * Skills / Workspace / Settings modals.
 *
 * This file owns all cross-component wiring: sending a message appends the
 * user turn, streams the assistant reply through useChatStream, and commits
 * the finished turn (content + tool events + trait snapshot) back into
 * lib/store.ts once the stream settles.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatView, defaultResolveDownloadUrl } from "@/components/chat";
import type { ComposerSubmission } from "@/components/chat";
import { TelemetryPanel } from "@/components/telemetry";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { SettingsModal } from "@/components/modals/SettingsModal";
import { SkillsModal } from "@/components/modals/SkillsModal";
import { WorkspaceModal } from "@/components/modals/WorkspaceModal";
import { useConversations } from "@/lib/store";
import { useChatStream, type StreamingMessage } from "@/lib/useChatStream";
import { useTelemetry } from "@/lib/useTelemetry";
import { useAutoTitle, type TitleAnimationMode } from "@/lib/useAutoTitle";
import { DEFAULT_MODEL_ID, clampThinking, getModel } from "@/lib/models";
import type { Conversation, Message, Skill, ToolEvent, ToolName, TraitSnapshot } from "@/lib/types";

const TELEMETRY_COLLAPSED_KEY = "rauchat:telemetry-collapsed";
const MODEL_CHOICE_KEY = "rauchat:model-choice";
const DEFAULT_TOOLS: ToolName[] = [];

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The last model/thinking the user picked, restored for new conversations. */
function loadModelChoice(): { modelId: string; thinking: string } {
  try {
    const raw = window.localStorage.getItem(MODEL_CHOICE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { modelId?: string; thinking?: string };
      const model = getModel(parsed.modelId);
      return { modelId: model.id, thinking: clampThinking(model, parsed.thinking) };
    }
  } catch {
    // fall through to defaults
  }
  const model = getModel(DEFAULT_MODEL_ID);
  return { modelId: model.id, thinking: model.defaultThinking };
}

/** A pdf_create result's `path` (e.g. "exports/report-1.pdf") downloads via
 * the dedicated /api/pdf route; everything else falls back to the generic
 * resolver (real URLs pass through, workspace paths hit /api/files). */
function resolveDownloadUrl(target: string): string {
  const normalized = target.replace(/^\/+/, "");
  if (normalized.startsWith("exports/")) {
    return `/api/pdf/${normalized.slice("exports/".length)}`;
  }
  return defaultResolveDownloadUrl(target);
}

export default function Home() {
  const store = useConversations();

  const [skills, setSkills] = useState<Skill[]>([]);
  const [filesCount, setFilesCount] = useState<number | undefined>(undefined);
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);

  const [skillsOpen, setSkillsOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [telemetryCollapsed, setTelemetryCollapsed] = useState(false);

  // Restore the panel's collapse state once, on mount.
  useEffect(() => {
    try {
      setTelemetryCollapsed(
        window.localStorage.getItem(TELEMETRY_COLLAPSED_KEY) === "1"
      );
    } catch {
      // localStorage unavailable — keep the default (expanded).
    }
  }, []);

  const toggleTelemetry = useCallback(() => {
    setTelemetryCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(TELEMETRY_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // best-effort persistence
      }
      return next;
    });
  }, []);

  // Refresh the Skills list whenever the modal closes (covers create/delete),
  // and once on mount to seed the composer's skill picker + sidebar count.
  useEffect(() => {
    if (skillsOpen) return;
    let cancelled = false;
    fetch("/api/skills")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { skills?: Skill[] }) => {
        if (!cancelled) setSkills(Array.isArray(data.skills) ? data.skills : []);
      })
      .catch(() => {
        /* Skills panel shows its own load error; this is just the count/picker. */
      });
    return () => {
      cancelled = true;
    };
  }, [skillsOpen]);

  // Same pattern for the workspace file count.
  useEffect(() => {
    if (workspaceOpen) return;
    let cancelled = false;
    fetch("/api/files")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { files?: unknown[] }) => {
        if (!cancelled) setFilesCount(Array.isArray(data.files) ? data.files.length : 0);
      })
      .catch(() => {
        /* leave the count as-is */
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceOpen]);

  // Drop the active skill if it was deleted out from under us.
  useEffect(() => {
    if (activeSkillId && !skills.some((s) => s.id === activeSkillId)) {
      setActiveSkillId(null);
    }
  }, [skills, activeSkillId]);

  const telemetry = useTelemetry();

  // Latest store snapshot for async callbacks (title arrival, stream done)
  // that must not close over a stale render.
  const storeRef = useRef(store);
  storeRef.current = store;

  // --- Model selection: per-conversation, seeded from the last choice. ---
  const [modelChoice, setModelChoice] = useState<{ modelId: string; thinking: string }>(
    () => ({
      modelId: DEFAULT_MODEL_ID,
      thinking: getModel(DEFAULT_MODEL_ID).defaultThinking,
    })
  );
  useEffect(() => {
    // localStorage only exists client-side; restore after mount.
    setModelChoice(loadModelChoice());
  }, []);

  const handleModelChange = useCallback((modelId: string, thinking: string) => {
    setModelChoice({ modelId, thinking });
    try {
      window.localStorage.setItem(
        MODEL_CHOICE_KEY,
        JSON.stringify({ modelId, thinking })
      );
    } catch {
      // best-effort persistence
    }
    const active = storeRef.current.activeConversation;
    if (active) storeRef.current.setConversationModel(active.id, modelId, thinking);
  }, []);

  const activeModelId =
    store.activeConversation?.modelId ?? modelChoice.modelId;
  const activeThinking = clampThinking(
    getModel(activeModelId),
    store.activeConversation?.thinking ?? modelChoice.thinking
  );

  // --- Automatic naming (GPT-5.6 Luna via /api/title). ---
  const [titleAnimations, setTitleAnimations] = useState<
    Record<string, TitleAnimationMode>
  >({});

  const handleAutoTitle = useCallback(
    (conversationId: string, title: string, mode: TitleAnimationMode) => {
      const conv = storeRef.current.conversations.find(
        (c) => c.id === conversationId
      );
      storeRef.current.setConversationTitleMeta(
        conversationId,
        title,
        conv?.messages.length ?? 0
      );
      setTitleAnimations((prev) => ({ ...prev, [conversationId]: mode }));
    },
    []
  );

  const handleTitleAnimationEnd = useCallback((conversationId: string) => {
    setTitleAnimations((prev) => {
      if (!(conversationId in prev)) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
  }, []);

  const autoTitle = useAutoTitle({ onTitle: handleAutoTitle });

  // Regenerate the name (erase + retype) when the user leaves a conversation
  // that has grown since it was last titled.
  const prevActiveIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prevId = prevActiveIdRef.current;
    if (prevId && prevId !== store.activeId) {
      const prev = storeRef.current.conversations.find((c) => c.id === prevId);
      if (prev) void autoTitle.retitleOnExit(prev);
    }
    prevActiveIdRef.current = store.activeId;
  }, [store.activeId, autoTitle]);

  // Which conversation the in-flight turn belongs to. A ref (not state)
  // because it's read from async callbacks, never rendered directly.
  const pendingConversationIdRef = useRef<string | null>(null);
  const wasStreamingRef = useRef(false);

  const appendAssistantTurn = useCallback(
    (conversationId: string, msg: StreamingMessage): Message => {
      const assistantMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: msg.content,
        createdAt: Date.now(),
        toolEvents: msg.toolEvents.length ? msg.toolEvents : undefined,
        traitSnapshot: msg.traitSnapshot ?? undefined,
      };
      store.appendMessage(conversationId, assistantMessage);
      return assistantMessage;
    },
    [store]
  );

  const chat = useChatStream({
    onDone: (final) => {
      const conversationId = pendingConversationIdRef.current;
      pendingConversationIdRef.current = null;
      if (!conversationId) return;
      const assistantMessage = appendAssistantTurn(conversationId, final);
      // First naming happens after the first completed exchange. The store
      // update above hasn't rendered yet, so hand the hook a synthetic
      // conversation snapshot that already includes the new turn.
      const conv = storeRef.current.conversations.find(
        (c) => c.id === conversationId
      );
      if (conv) {
        const snapshot: Conversation = {
          ...conv,
          messages: [...conv.messages, assistantMessage],
        };
        void autoTitle.maybeTitleAfterFirstExchange(snapshot);
      }
    },
    onError: () => {
      // Leave pendingConversationIdRef set to null and the streamed partial
      // (+ error banner) visible in <MessageList/> so the user can retry —
      // committing a failed/partial turn to the store would hide the error.
      pendingConversationIdRef.current = null;
    },
  });

  // If generation ends without onDone/onError firing, it was a manual stop
  // (useChatStream.stop() resolves `send()` with null and skips both
  // callbacks by design). Commit whatever streamed so it isn't lost.
  useEffect(() => {
    if (
      wasStreamingRef.current &&
      !chat.isStreaming &&
      pendingConversationIdRef.current
    ) {
      const conversationId = pendingConversationIdRef.current;
      pendingConversationIdRef.current = null;
      const streamed = chat.streamingMessage;
      if (streamed && (streamed.content.trim() || streamed.toolEvents.length)) {
        appendAssistantTurn(conversationId, streamed);
      }
    }
    wasStreamingRef.current = chat.isStreaming;
  }, [chat.isStreaming, chat.streamingMessage, appendAssistantTurn]);

  const handleSend = useCallback(
    (submission: ComposerSubmission) => {
      const text = submission.text.trim();
      if (!text) return;

      let conversation = store.activeConversation;
      if (!conversation) {
        // Stays "New chat" until Luna names it after the first exchange.
        conversation = store.createConversation();
        store.setConversationModel(
          conversation.id,
          modelChoice.modelId,
          modelChoice.thinking
        );
      }
      const conversationId = conversation.id;

      const userMessage: Message = {
        id: generateId(),
        role: "user",
        content: text,
        createdAt: Date.now(),
      };
      store.appendMessage(conversationId, userMessage);

      const model = getModel(conversation.modelId ?? modelChoice.modelId);
      pendingConversationIdRef.current = conversationId;
      void chat.send({
        messages: [...conversation.messages, userMessage],
        conversationId,
        tools: submission.tools,
        skillId: submission.skillId,
        forceTools: submission.forceTools,
        model: model.id,
        thinking: clampThinking(
          model,
          conversation.thinking ?? modelChoice.thinking
        ),
      });
    },
    [chat, store, modelChoice]
  );

  const sendParamsFor = useCallback(
    (conversation: Conversation) => {
      const model = getModel(conversation.modelId ?? modelChoice.modelId);
      return {
        model: model.id,
        thinking: clampThinking(
          model,
          conversation.thinking ?? modelChoice.thinking
        ),
      };
    },
    [modelChoice]
  );

  const handleRetry = useCallback(() => {
    const conversation = store.activeConversation;
    if (!conversation || conversation.messages.length === 0) return;
    pendingConversationIdRef.current = conversation.id;
    void chat.send({
      messages: conversation.messages,
      conversationId: conversation.id,
      ...sendParamsFor(conversation),
    });
  }, [chat, store, sendParamsFor]);

  const handleRegenerate = useCallback(
    (message: Message) => {
      const conversation = store.activeConversation;
      if (!conversation) return;
      const idx = conversation.messages.findIndex((m) => m.id === message.id);
      if (idx === -1) return;
      const history = conversation.messages.slice(0, idx);
      store.replaceMessages(conversation.id, history);
      pendingConversationIdRef.current = conversation.id;
      void chat.send({
        messages: history,
        conversationId: conversation.id,
        ...sendParamsFor(conversation),
      });
    },
    [chat, store, sendParamsFor]
  );

  const branchFrom = useCallback(
    (endExclusive: number) => {
      const conversation = store.activeConversation;
      if (!conversation) return;
      const slice = conversation.messages.slice(0, endExclusive);
      const branch = store.createConversation(`${conversation.title} (branch)`);
      for (const m of slice) store.appendMessage(branch.id, m);
    },
    [store]
  );

  const handleBranchConversation = useCallback(() => {
    const conversation = store.activeConversation;
    if (!conversation) return;
    branchFrom(conversation.messages.length);
  }, [branchFrom, store]);

  const handleBranchMessage = useCallback(
    (message: Message) => {
      const conversation = store.activeConversation;
      if (!conversation) return;
      const idx = conversation.messages.findIndex((m) => m.id === message.id);
      branchFrom(idx === -1 ? conversation.messages.length : idx + 1);
    },
    [branchFrom, store]
  );

  const handleInstallSkill = useCallback((event: ToolEvent) => {
    const result = event.result as Partial<Skill> | undefined;
    if (!result?.id) return;
    const skill = result as Skill;
    setSkills((prev) => (prev.some((s) => s.id === skill.id) ? prev : [skill, ...prev]));
    setActiveSkillId(skill.id);
  }, []);

  const handleConversationsCleared = useCallback(() => {
    for (const c of store.conversations) store.deleteConversation(c.id);
  }, [store]);

  const streamingConversationIds = useMemo(
    () =>
      chat.isStreaming && pendingConversationIdRef.current
        ? [pendingConversationIdRef.current]
        : [],
    // pendingConversationIdRef is a ref; chat.isStreaming is what actually
    // changes when it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat.isStreaming]
  );

  const telemetryDetail = telemetry.error
    ? telemetry.error
    : telemetry.model
      ? [telemetry.model, telemetry.layerInfo].filter(Boolean).join(" · ")
      : undefined;

  // Trait snapshots for the active conversation, derived straight from its
  // messages so there's one source of truth (no parallel history to drift).
  const traitSnapshots = useMemo<TraitSnapshot[]>(() => {
    const messages = store.activeConversation?.messages ?? [];
    return messages
      .map((m) => m.traitSnapshot)
      .filter((s): s is TraitSnapshot => Boolean(s));
  }, [store.activeConversation]);

  return (
    <div
      style={{
        display: "grid",
        // Sidebar manages its own collapse/peek state internally and sizes
        // itself via CSS (264px <-> 56px rail); `auto` lets this track
        // follow that intrinsic width instead of leaving dead space.
        gridTemplateColumns: telemetryCollapsed
          ? "auto minmax(0, 1fr) var(--rau-telemetry-w-rail)"
          : "auto minmax(0, 1fr) var(--rau-telemetry-w)",
        height: "100vh",
      }}
    >
      <Sidebar
        store={store}
        onOpenSkills={() => setSkillsOpen(true)}
        onOpenWorkspace={() => setWorkspaceOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        streamingConversationIds={streamingConversationIds}
        titleAnimations={titleAnimations}
        onTitleAnimationEnd={handleTitleAnimationEnd}
        skillsCount={skills.length}
        filesCount={filesCount}
      />

      <ChatView
        conversation={store.activeConversation}
        streamingState={chat.state}
        onSendMessage={handleSend}
        onStop={chat.stop}
        onRetry={handleRetry}
        modelId={activeModelId}
        thinking={activeThinking}
        onModelChange={handleModelChange}
        titleAnimate={
          store.activeId ? titleAnimations[store.activeId] ?? "none" : "none"
        }
        onTitleAnimationEnd={
          store.activeId
            ? () => handleTitleAnimationEnd(store.activeId!)
            : undefined
        }
        assistantName="Rauchat"
        telemetryOpen={!telemetryCollapsed}
        onToggleTelemetry={toggleTelemetry}
        onBranchConversation={handleBranchConversation}
        defaultTools={DEFAULT_TOOLS}
        skills={skills}
        activeSkillId={activeSkillId}
        onSelectSkill={setActiveSkillId}
        onRegenerate={handleRegenerate}
        onBranch={handleBranchMessage}
        onInstallSkill={handleInstallSkill}
        resolveDownloadUrl={resolveDownloadUrl}
      />

      <TelemetryPanel
        status={telemetry.status}
        snapshots={traitSnapshots}
        collapsed={telemetryCollapsed}
        onToggle={toggleTelemetry}
        model={telemetry.model}
        layerInfo={telemetry.layerInfo}
        vectorSet={telemetry.vectorSet}
        latencyMs={telemetry.latencyMs}
        error={telemetry.error}
        onRetry={telemetry.retry}
      />

      <SkillsModal
        open={skillsOpen}
        onClose={() => setSkillsOpen(false)}
        activeSkillIds={activeSkillId ? [activeSkillId] : []}
        onToggleActive={(id, active) => setActiveSkillId(active ? id : null)}
      />
      <WorkspaceModal open={workspaceOpen} onClose={() => setWorkspaceOpen(false)} />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        telemetryStatus={telemetry.status}
        telemetryDetail={telemetryDetail}
        onConversationsCleared={handleConversationsCleared}
      />
    </div>
  );
}
