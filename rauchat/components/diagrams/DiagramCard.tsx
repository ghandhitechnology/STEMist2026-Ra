"use client";

/**
 * components/diagrams/DiagramCard.tsx — the inline transcript affordance.
 * Clicking it opens that diagram (at that revision) in the panel.
 */

import { memo } from "react";
import type { Diagram } from "@/lib/types";
import { kindLabel } from "@/lib/diagrams";
import { IconDiagram } from "@/components/chat/icons";
import styles from "./diagrams.module.css";

export type DiagramCardProps = {
  diagram: Diagram;
  /** Highlights the card whose diagram is currently open. */
  active?: boolean;
  onOpen: (diagram: Diagram) => void;
};

export const DiagramCard = memo(function DiagramCard({
  diagram,
  active = false,
  onOpen,
}: DiagramCardProps) {
  const lines = diagram.content.split("\n").length;
  return (
    <button
      type="button"
      className={`${styles.card} ${active ? styles.cardActive : ""}`}
      onClick={() => onOpen(diagram)}
      aria-label={`Open diagram ${diagram.title}`}
    >
      <span className={styles.cardIcon}>
        <IconDiagram size={16} />
      </span>
      <span className={styles.cardText}>
        <span className={styles.cardTitle}>{diagram.title}</span>
        <span className={styles.cardMeta}>
          {kindLabel(diagram.kind, diagram.language)} · v{diagram.version} ·{" "}
          {lines} line{lines === 1 ? "" : "s"}
        </span>
      </span>
      <span className={styles.cardOpen}>Open</span>
    </button>
  );
});

export default DiagramCard;
