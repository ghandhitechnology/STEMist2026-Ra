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
import { DiagramPanel } from "@/components/diagrams";
import { collectDiagrams } from "@/lib/diagrams";
import { Sidebar } from "@/components/sidebar/Sidebar";
import shell from "./shell.module.css";
import {
  AccountModal,
  type Account,
  type AccountProfile,
  type AccountUser,
} from "@/components/modals/AccountModal";
import { SettingsModal } from "@/components/modals/SettingsModal";
import { SkillsModal } from "@/components/modals/SkillsModal";
import { WorkspaceModal } from "@/components/modals/WorkspaceModal";
import { useConversations } from "@/lib/store";
import {
  EMPTY_STREAMING_STATE,
  useChatStream,
  type StreamingMessage,
} from "@/lib/useChatStream";
import { useTelemetry } from "@/lib/useTelemetry";
import { useAutoTitle, type TitleAnimationMode } from "@/lib/useAutoTitle";
import { DEFAULT_MODEL_ID, clampThinking, getModel } from "@/lib/models";
import type {
  Diagram,
  Conversation,
  Message,
  Skill,
  SkillDraft,
  ToolEvent,
  ToolName,
  TraitSnapshot,
} from "@/lib/types";

const TELEMETRY_COLLAPSED_KEY = "rauchat:telemetry-collapsed";
const MODEL_CHOICE_KEY = "rauchat:model-choice";
const AUTO_TOOLS_KEY = "rauchat:auto-tools";
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
  // --- Account: the signed-in user + their profile. Unauthenticated goes to
  // sign-in; authenticated-but-unprofiled goes through the first-run setup.
  const [account, setAccount] = useState<Account | null>(null);

  // Conversations are keyed by account, so the store stays empty until we
  // know who is signed in.
  const store = useConversations(account?.user.id ?? null);

  const [skills, setSkills] = useState<Skill[]>([]);
  const [filesCount, setFilesCount] = useState<number | undefined>(undefined);
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);

  const [skillsOpen, setSkillsOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  /**
   * Loads the signed-in account. Retries on transient failure: conversations
   * are keyed by user id, so an app left without an account never persists
   * anything the user types — silence is not an acceptable failure here.
   */
  const refreshAccount = useCallback(async (attempt = 0): Promise<void> => {
    try {
      const res = await fetch("/api/profile");
      if (res.status === 401) {
        window.location.href = "/sign-in";
        return;
      }
      if (!res.ok) throw new Error(`profile ${res.status}`);
      const data = (await res.json()) as {
        profile: AccountProfile | null;
        user: AccountUser;
      };
      if (!data.profile) {
        window.location.replace("/setup");
        return;
      }
      setAccount({ profile: data.profile, user: data.user });
    } catch {
      // Offline or a transient 5xx: back off and try again rather than
      // sitting in a permanently accountless state.
      if (attempt >= 5) return;
      const delay = Math.min(1000 * 2 ** attempt, 15000);
      window.setTimeout(() => void refreshAccount(attempt + 1), delay);
    }
  }, []);

  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);

  const [telemetryCollapsed, setTelemetryCollapsed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // "/auto" mode: every tool is loaded each turn and the agent decides when
  // to use them. Persisted so it survives reloads.
  const [autoTools, setAutoTools] = useState(false);
  useEffect(() => {
    try {
      setAutoTools(window.localStorage.getItem(AUTO_TOOLS_KEY) === "1");
    } catch {
      // localStorage unavailable — keep the default (off).
    }
  }, []);
  const toggleAutoTools = useCallback(() => {
    setAutoTools((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(AUTO_TOOLS_KEY, next ? "1" : "0");
      } catch {
        // best-effort persistence
      }
      return next;
    });
  }, []);

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

  // Render-side twin of pendingConversationIdRef: the conversation that owns
  // whatever useChatStream currently holds (partial, finished text, or error).
  // ChatView only sees the streaming state when this matches the active chat,
  // so turns never bleed into new or other conversations. On error it stays
  // set (the partial + banner belong to that chat until the next send).
  const [streamOwnerId, setStreamOwnerId] = useState<string | null>(null);

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
      setStreamOwnerId(null);
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
      setStreamOwnerId(null);
      const streamed = chat.streamingMessage;
      if (streamed && (streamed.content.trim() || streamed.toolEvents.length)) {
        appendAssistantTurn(conversationId, streamed);
      }
    }
    wasStreamingRef.current = chat.isStreaming;
  }, [chat.isStreaming, chat.streamingMessage, appendAssistantTurn]);

  /**
   * Commits the in-flight turn's partial reply to the conversation that owns
   * it, when a turn is about to start somewhere else. Without this the
   * abort inside useChatStream.send() discards it and the other conversation
   * is left with a user message and no answer.
   */
  const salvageInterruptedTurn = useCallback(
    (nextConversationId: string) => {
      const owner = pendingConversationIdRef.current;
      if (!owner || owner === nextConversationId) return;
      const streamed = chat.streamingMessage;
      if (streamed && (streamed.content.trim() || streamed.toolEvents.length)) {
        appendAssistantTurn(owner, streamed);
      }
      pendingConversationIdRef.current = null;
    },
    [chat.streamingMessage, appendAssistantTurn]
  );

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

      // Only one turn streams at a time. Starting one here aborts a turn
      // running in another conversation, so bank whatever it produced into
      // that conversation first — losing it silently is not acceptable.
      salvageInterruptedTurn(conversationId);

      const model = getModel(conversation.modelId ?? modelChoice.modelId);
      pendingConversationIdRef.current = conversationId;
      setStreamOwnerId(conversationId);
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
    [chat, store, modelChoice, salvageInterruptedTurn]
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
    salvageInterruptedTurn(conversation.id);
    pendingConversationIdRef.current = conversation.id;
    setStreamOwnerId(conversation.id);
    void chat.send({
      messages: conversation.messages,
      conversationId: conversation.id,
      ...sendParamsFor(conversation),
    });
  }, [chat, store, sendParamsFor, salvageInterruptedTurn]);

  const handleRegenerate = useCallback(
    (message: Message) => {
      const conversation = store.activeConversation;
      if (!conversation) return;
      const idx = conversation.messages.findIndex((m) => m.id === message.id);
      if (idx === -1) return;
      const history = conversation.messages.slice(0, idx);
      store.replaceMessages(conversation.id, history);
      salvageInterruptedTurn(conversation.id);
      pendingConversationIdRef.current = conversation.id;
      setStreamOwnerId(conversation.id);
      void chat.send({
        messages: history,
        conversationId: conversation.id,
        ...sendParamsFor(conversation),
      });
    },
    [chat, store, sendParamsFor, salvageInterruptedTurn]
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

  const handleInstallSkill = useCallback(async (event: ToolEvent) => {
    const draft = event.result as Partial<SkillDraft> | undefined;
    if (
      !draft?.draftId ||
      !draft.name ||
      !draft.description ||
      !draft.instructions
    ) {
      throw new Error("The generated skill draft is incomplete.");
    }
    const response = await fetch("/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        name: draft.name,
        description: draft.description,
        instructions: draft.instructions,
        source: "generated",
        draftId: draft.draftId,
        capabilities: draft.capabilities ?? { tools: [], skills: [] },
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: unknown }
        | null;
      throw new Error(
        typeof body?.error === "string" ? body.error : "Skill installation failed."
      );
    }
    const skill = (await response.json()) as Skill;
    setSkills((prev) => (prev.some((s) => s.id === skill.id) ? prev : [skill, ...prev]));
    setActiveSkillId(skill.id);
  }, []);

  const handleConversationsCleared = useCallback(() => {
    for (const c of store.conversations) store.deleteConversation(c.id);
  }, [store]);

  const streamingConversationIds = useMemo(
    () => (chat.isStreaming && streamOwnerId ? [streamOwnerId] : []),
    [chat.isStreaming, streamOwnerId]
  );

  // Streaming state is only visible in the conversation it belongs to.
  const activeStreamingState =
    streamOwnerId !== null && streamOwnerId === store.activeId
      ? chat.state
      : EMPTY_STREAMING_STATE;

  const telemetryDetail = telemetry.error
    ? telemetry.error
    : telemetry.model
      ? [telemetry.model, telemetry.layerInfo].filter(Boolean).join(" · ")
      : undefined;

  // --- Diagrams: derived from the active conversation's tool events, so
  // the transcript stays the single source of truth (lib/diagrams.ts).
  const diagrams = useMemo(
    () => collectDiagrams(store.activeConversation?.messages ?? []),
    [store.activeConversation]
  );

  const [openDiagramId, setOpenDiagramId] = useState<string | null>(null);

  // Opening a diagram folds telemetry to its rail so the three live
  // columns fit; the user can expand it again from the rail if they want.
  const handleOpenDiagram = useCallback((diagram: Diagram) => {
    setOpenDiagramId(diagram.id);
    setTelemetryCollapsed(true);
  }, []);

  // Auto-open the newest diagram of a finished turn, the way the panel
  // appears on claude.ai — but never yank the panel away from a diagram
  // the user opened themselves in this conversation.
  const latestDiagramId = diagrams[0]?.id ?? null;
  const lastAutoOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!latestDiagramId) return;
    if (lastAutoOpened.current === latestDiagramId) return;
    lastAutoOpened.current = latestDiagramId;
    setOpenDiagramId(latestDiagramId);
    setTelemetryCollapsed(true);
  }, [latestDiagramId]);

  // Switching conversations closes whatever was open; the new conversation's
  // own diagrams (if any) auto-open through the effect above.
  useEffect(() => {
    setOpenDiagramId(null);
    lastAutoOpened.current = null;
  }, [store.activeId]);

  const openDiagram = useMemo(
    () => diagrams.find((a) => a.id === openDiagramId) ?? null,
    [diagrams, openDiagramId]
  );

  const closeDiagram = useCallback(() => setOpenDiagramId(null), []);

  // Trait snapshots for the active conversation, derived straight from its
  // messages so there's one source of truth (no parallel history to drift).
  const traitSnapshots = useMemo<TraitSnapshot[]>(() => {
    const messages = store.activeConversation?.messages ?? [];
    return messages
      .map((m) => m.traitSnapshot)
      .filter((s): s is TraitSnapshot => Boolean(s));
  }, [store.activeConversation]);

  const shellClass = [
    shell.shell,
    sidebarCollapsed ? shell.sidebarCollapsed : "",
    telemetryCollapsed ? shell.telemetryCollapsed : "",
    openDiagram ? shell.withDiagram : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass}>
      <Sidebar
        store={store}
        onOpenSkills={() => setSkillsOpen(true)}
        onOpenWorkspace={() => setWorkspaceOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAccount={() => setAccountOpen(true)}
        account={account}
        streamingConversationIds={streamingConversationIds}
        titleAnimations={titleAnimations}
        onTitleAnimationEnd={handleTitleAnimationEnd}
        skillsCount={skills.length}
        filesCount={filesCount}
        onCollapsedChange={setSidebarCollapsed}
      />

      <ChatView
        conversation={store.activeConversation}
        streamingState={activeStreamingState}
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
        autoTools={autoTools}
        onToggleAutoTools={toggleAutoTools}
        skills={skills}
        activeSkillId={activeSkillId}
        onSelectSkill={setActiveSkillId}
        onRegenerate={handleRegenerate}
        onBranch={handleBranchMessage}
        onInstallSkill={handleInstallSkill}
        onOpenDiagram={handleOpenDiagram}
        openDiagramId={openDiagramId}
        resolveDownloadUrl={resolveDownloadUrl}
      />

      {openDiagram ? (
        <DiagramPanel diagram={openDiagram} onClose={closeDiagram} />
      ) : null}

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
      <AccountModal
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        account={account}
        onUpdated={() => void refreshAccount()}
      />
    </div>
  );
}
