"use client";

/**
 * components/modals/SettingsModal.tsx
 * Sections: Model (inner model id, temperature), Memory (durable user memory),
 * Telemetry (Gemma endpoint status readout, poll interval), and Data
 * (clear local conversations).
 * Persists to localStorage under 'rauchat:settings'.
 */

import { useEffect, useState } from "react";
import type { TelemetryStatus } from "@/lib/types";
// Clearing data drops every signed-in account's conversations on this browser.
import { clearAllStoredConversations } from "@/lib/store";
import { Modal } from "./Modal";
import styles from "./SettingsModal.module.css";

const SETTINGS_STORAGE_KEY = "rauchat:settings";

export type RauchatSettings = {
  modelId: string;
  temperature: number;
  gemmaEndpoint: string;
  pollIntervalMs: number;
};

const DEFAULT_SETTINGS: RauchatSettings = {
  modelId: "claude-sonnet-4-6",
  temperature: 0.7,
  gemmaEndpoint: "http://localhost:8008/v1/telemetry",
  pollIntervalMs: 1500,
};

function loadSettings(): RauchatSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: RauchatSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // best-effort persistence
  }
}

const STATUS_LABEL: Record<TelemetryStatus, string> = {
  disconnected: "Awaiting substrate",
  connecting: "Connecting",
  live: "Live",
  error: "Disconnected",
};

const STATUS_DOT_CLASS: Record<TelemetryStatus, string> = {
  disconnected: styles.statusDotDormant,
  connecting: styles.statusDotConnecting,
  live: styles.statusDotLive,
  error: styles.statusDotError,
};

export type SettingsModalProps = {
  open: boolean;
  onClose: () => void;
  /** Current telemetry connection state; defaults to the dormant read. */
  telemetryStatus?: TelemetryStatus;
  telemetryDetail?: string;
  /** Fired after local conversations are cleared, so the parent store can
   * refresh its in-memory state. */
  onConversationsCleared?: () => void;
};

export function SettingsModal({
  open,
  onClose,
  telemetryStatus = "disconnected",
  telemetryDetail = "gemma-4-12b · weights not loaded",
  onConversationsCleared,
}: SettingsModalProps) {
  const [settings, setSettings] = useState<RauchatSettings>(DEFAULT_SETTINGS);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [memory, setMemory] = useState("");
  const [savedMemory, setSavedMemory] = useState("");
  const [memoryState, setMemoryState] = useState<
    "idle" | "loading" | "saving" | "saved" | "error"
  >("idle");
  const [memoryError, setMemoryError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setSettings(loadSettings());
    setConfirmingClear(false);
    setCleared(false);
    setMemory("");
    setSavedMemory("");
    setMemoryState("loading");
    setMemoryError(null);

    const controller = new AbortController();
    fetch("/api/memory", {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Stored memory could not be loaded.");
        return (await response.json()) as { memory?: unknown };
      })
      .then((data) => {
        const next = typeof data.memory === "string" ? data.memory : "";
        setMemory(next);
        setSavedMemory(next);
        setMemoryState("idle");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMemoryState("error");
        setMemoryError(
          error instanceof Error ? error.message : "Stored memory could not be loaded."
        );
      });

    return () => controller.abort();
  }, [open]);

  function patch(next: Partial<RauchatSettings>) {
    setSettings((prev) => {
      const merged = { ...prev, ...next };
      saveSettings(merged);
      return merged;
    });
  }

  function handleClearConversations() {
    if (typeof window !== "undefined") {
      clearAllStoredConversations();
    }
    setConfirmingClear(false);
    setCleared(true);
    onConversationsCleared?.();
  }

  async function handleSaveMemory() {
    setMemoryState("saving");
    setMemoryError(null);
    try {
      const response = await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({ memory }),
      });
      if (!response.ok) throw new Error("Stored memory could not be saved.");
      setSavedMemory(memory);
      setMemoryState("saved");
    } catch (error) {
      setMemoryState("error");
      setMemoryError(
        error instanceof Error ? error.message : "Stored memory could not be saved."
      );
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Settings">
      <section className={styles.section}>
        <h3 className={styles.sectionLabel}>Model</h3>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="rau-settings-model-id">
            Inner model id
          </label>
          <input
            id="rau-settings-model-id"
            className={styles.input}
            type="text"
            value={settings.modelId}
            spellCheck={false}
            onChange={(event) => patch({ modelId: event.target.value })}
            placeholder="claude-sonnet-4-6"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="rau-settings-temp">
            Temperature
          </label>
          <div className={styles.rangeRow}>
            <div className={styles.rangeControl}>
              <input
                id="rau-settings-temp"
                className={styles.range}
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={settings.temperature}
                onChange={(event) =>
                  patch({ temperature: Number(event.target.value) })
                }
              />
              <span className={styles.rangeMidpoint} title="1.0" aria-hidden />
            </div>
            <span className={`${styles.rangeValue} rau-num`}>
              {settings.temperature.toFixed(2)}
            </span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionLabel}>Memory</h3>
        <p className={styles.memoryHint}>
          Facts saved here are available to Rauchat in future conversations.
        </p>
        <textarea
          className={styles.memoryEditor}
          value={memory}
          onChange={(event) => {
            setMemory(event.target.value);
            if (memoryState === "saved" || memoryState === "error") {
              setMemoryState("idle");
              setMemoryError(null);
            }
          }}
          placeholder={
            memoryState === "loading" ? "Loading stored memory…" : "No stored memory yet."
          }
          aria-label="Stored memory"
          disabled={memoryState === "loading"}
          maxLength={20000}
          spellCheck
        />
        <div className={styles.memoryFooter}>
          <span
            className={`${styles.memoryStatus} ${
              memoryState === "error" ? styles.memoryStatusError : ""
            }`}
            role={memoryState === "error" ? "alert" : "status"}
          >
            {memoryError ??
              (memoryState === "loading"
                ? "Loading…"
                : memoryState === "saving"
                  ? "Saving…"
                  : memoryState === "saved"
                    ? "Saved"
                    : `${memory.length.toLocaleString()} / 20,000`)}
          </span>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSecondary}`}
            onClick={() => void handleSaveMemory()}
            disabled={
              memoryState === "loading" ||
              memoryState === "saving" ||
              memory === savedMemory
            }
          >
            Save memory
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionLabel}>Telemetry</h3>

        <div className={styles.statusBlock}>
          <span
            className={`${styles.statusDot} ${STATUS_DOT_CLASS[telemetryStatus]}`}
          />
          <div className={styles.statusText}>
            <span className={styles.statusLabel}>
              {STATUS_LABEL[telemetryStatus]}
            </span>
            <span className={`${styles.statusDetail} rau-num`}>
              {telemetryDetail}
            </span>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="rau-settings-endpoint">
            Gemma endpoint
          </label>
          <input
            id="rau-settings-endpoint"
            className={styles.input}
            type="text"
            value={settings.gemmaEndpoint}
            spellCheck={false}
            onChange={(event) => patch({ gemmaEndpoint: event.target.value })}
            placeholder="http://localhost:8008/v1/telemetry"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="rau-settings-poll">
            Poll interval (ms)
          </label>
          <input
            id="rau-settings-poll"
            className={styles.input}
            type="number"
            min={250}
            step={250}
            value={settings.pollIntervalMs}
            onChange={(event) =>
              patch({ pollIntervalMs: Number(event.target.value) || 0 })
            }
          />
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionLabel}>Data</h3>
        <div className={styles.dangerRow}>
          <div className={styles.dangerCopy}>
            <span className={styles.dangerTitle}>Clear local conversations</span>
            <span className={styles.dangerHint}>
              {cleared
                ? "Cleared. New conversations start fresh."
                : "Removes all conversations stored in this browser."}
            </span>
          </div>
          {!confirmingClear && (
            <button
              type="button"
              className={`${styles.button} ${styles.buttonDanger}`}
              onClick={() => setConfirmingClear(true)}
            >
              Clear
            </button>
          )}
        </div>
        {confirmingClear && (
          <div className={styles.confirmBar}>
            <span className={styles.confirmText}>
              This can't be undone. Clear all conversations?
            </span>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonSecondary}`}
                onClick={() => setConfirmingClear(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonDanger}`}
                onClick={handleClearConversations}
              >
                Clear all
              </button>
            </div>
          </div>
        )}
      </section>
    </Modal>
  );
}
