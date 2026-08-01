"use client";

/**
 * components/sidebar/Sidebar.tsx — the 264px app sidebar (DESIGN.md §3.3).
 * Driven by lib/store.ts's `useConversations()` return value, passed in
 * as `store` so the parent owns the single source of truth.
 */

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import type { UseConversations } from "@/lib/store";
import {
  IconFolder,
  IconGear,
  IconPanel,
  IconPlus,
  IconSearch,
  IconSkill,
} from "../modals/icons";
import { ConversationItem } from "./ConversationItem";
import styles from "./Sidebar.module.css";

const SKELETON_WIDTHS = [82, 64, 91, 57, 74, 68];

function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function groupLabel(updatedAt: number): string {
  const today = startOfDay(Date.now());
  const day = startOfDay(updatedAt);
  const diffDays = Math.round((today - day) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "Previous 7 days";
  return "Older";
}

const PEEK_OPEN_DELAY_MS = 400;
const PEEK_CLOSE_DELAY_MS = 200;

export type SidebarProps = {
  store: UseConversations;
  onOpenSkills: () => void;
  onOpenWorkspace: () => void;
  onOpenSettings: () => void;
  /** IDs of conversations currently generating in the background. */
  streamingConversationIds?: string[];
  /** Per-conversation auto-naming animation, keyed by conversation id. */
  titleAnimations?: Record<string, "type" | "retype">;
  onTitleAnimationEnd?: (id: string) => void;
  skillsCount?: number;
  filesCount?: number;
};

export function Sidebar({
  store,
  onOpenSkills,
  onOpenWorkspace,
  onOpenSettings,
  streamingConversationIds,
  titleAnimations,
  onTitleAnimationEnd,
  skillsCount,
  filesCount,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const [query, setQuery] = useState("");
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const streamingSet = useMemo(
    () => new Set(streamingConversationIds ?? []),
    [streamingConversationIds]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return store.conversations;
    return store.conversations.filter((c) =>
      c.title.toLowerCase().includes(q)
    );
  }, [store.conversations, query]);

  function handleRailEnter() {
    if (!collapsed) return;
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (peeking) return;
    openTimer.current = setTimeout(() => setPeeking(true), PEEK_OPEN_DELAY_MS);
  }

  function handleRailLeave() {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    closeTimer.current = setTimeout(() => setPeeking(false), PEEK_CLOSE_DELAY_MS);
  }

  function handleSearchChange(event: ChangeEvent<HTMLInputElement>) {
    setQuery(event.target.value);
  }

  const showExpanded = !collapsed || peeking;

  let lastGroup: string | null = null;

  return (
    <aside
      className={collapsed ? styles.sidebarCollapsed : styles.sidebar}
      onMouseEnter={handleRailEnter}
      onMouseLeave={handleRailLeave}
      style={
        collapsed && peeking
          ? {
              position: "fixed",
              top: 0,
              bottom: 0,
              left: 0,
              width: "var(--rau-sidebar-w)",
              boxShadow: "var(--rau-elev-popover)",
              zIndex: 40,
            }
          : undefined
      }
    >
      <div className={styles.header}>
        {showExpanded && (
          <div className={styles.wordmark}>
            <span className={styles.notch} />
            <span className={styles.wordmarkRau}>Rau</span>
            <span className={styles.wordmarkChat}>chat</span>
          </div>
        )}
        <button
          type="button"
          className={styles.iconButton}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setCollapsed((c) => !c)}
        >
          <IconPanel size={16} />
        </button>
      </div>

      <div className={styles.newChatWrap}>
        <button
          type="button"
          className={styles.newChatButton}
          onClick={() => store.createConversation()}
        >
          <IconPlus size={16} />
          <span className={styles.newChatLabel}>New chat</span>
        </button>
      </div>

      {showExpanded && (
        <div className={styles.searchWrap}>
          <div className={styles.searchRow}>
            <IconSearch size={14} className={styles.searchIcon} />
            <input
              className={styles.searchInput}
              value={query}
              onChange={handleSearchChange}
              placeholder="Search"
              aria-label="Search conversations"
            />
            {!query && <span className={styles.searchHint}>⌘K</span>}
          </div>
        </div>
      )}

      {showExpanded && (
        <div className={styles.list}>
          {!store.hydrated &&
            SKELETON_WIDTHS.map((w, i) => (
              <div className={styles.skeletonRow} key={i}>
                <div
                  className={styles.skeletonBar}
                  style={{ width: `${w}%` }}
                />
              </div>
            ))}

          {store.hydrated && filtered.length === 0 && query && (
            <div className={styles.emptyList}>
              No conversations match &ldquo;{query}&rdquo;.
            </div>
          )}

          {store.hydrated && filtered.length === 0 && !query && (
            <div className={styles.emptyList}>No conversations yet.</div>
          )}

          {store.hydrated &&
            filtered.map((conversation) => {
              const g = groupLabel(conversation.updatedAt);
              const showHeader = g !== lastGroup;
              lastGroup = g;
              return (
                <div key={conversation.id}>
                  {showHeader && (
                    <div className={styles.groupHeader}>{g}</div>
                  )}
                  <ConversationItem
                    conversation={conversation}
                    isActive={conversation.id === store.activeId}
                    isStreaming={streamingSet.has(conversation.id)}
                    titleAnimate={titleAnimations?.[conversation.id] ?? "none"}
                    onTitleAnimationEnd={onTitleAnimationEnd}
                    onSelect={store.selectConversation}
                    onRename={store.renameConversation}
                    onDelete={store.deleteConversation}
                  />
                </div>
              );
            })}
        </div>
      )}

      <div className={styles.workspaceSection}>
        <button type="button" className={styles.navRow} onClick={onOpenSkills}>
          <IconSkill size={16} className={styles.navIcon} />
          <span className={styles.navLabel}>Skills</span>
          {typeof skillsCount === "number" && (
            <span className={`${styles.navCount} rau-num`}>{skillsCount}</span>
          )}
        </button>
        <button
          type="button"
          className={styles.navRow}
          onClick={onOpenWorkspace}
        >
          <IconFolder size={16} className={styles.navIcon} />
          <span className={styles.navLabel}>Workspace</span>
          {typeof filesCount === "number" && (
            <span className={`${styles.navCount} rau-num`}>{filesCount}</span>
          )}
        </button>
        <button
          type="button"
          className={styles.navRow}
          onClick={onOpenSettings}
        >
          <IconGear size={16} className={styles.navIcon} />
          <span className={styles.navLabel}>Settings</span>
        </button>
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.accountRow}
          onClick={onOpenSettings}
          aria-label="Open settings"
        >
          <span className={styles.avatar}>R</span>
          <span className={styles.accountText}>
            <span className={styles.accountName}>Local workspace</span>
            <span className={styles.accountPlan}>Rauchat</span>
          </span>
          <span className={styles.accountGear}>
            <IconGear size={14} />
          </span>
        </button>
      </div>
    </aside>
  );
}
