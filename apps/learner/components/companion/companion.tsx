import type { CompanionState } from "@dp/domain/companion";
import { TUTOR } from "@dp/domain/tutor";

import styles from "./companion.module.css";

/**
 * The learning companion.
 *
 * Presentational only: it renders the state the domain derived from the
 * learner's progress and computes nothing itself, so the character on the
 * landing page and the one in a conversation are the same component fed
 * different state.
 */

const MOOD: Readonly<Record<CompanionState["emotion"], string>> = {
  smiling: "smiling",
  listening: "listening",
  sad: "looking sad",
};

function moodDescription(name: string, emotion: CompanionState["emotion"]): string {
  return `${name}, your German partner, ${MOOD[emotion]}`;
}

/** How much larger the fully grown companion is than a brand-new one. */
const GROWTH_RANGE = 0.55;

export interface CompanionProps {
  readonly state: CompanionState;
  /** Overrides the default description where context suggests a better one. */
  readonly label?: string;
  /** Whose face this is: the learner's chosen tutor, Jonas unless told otherwise. */
  readonly tutorName?: string;
  /** Hides it from assistive technology when nearby text already says this. */
  readonly decorative?: boolean;
  readonly className?: string;
}

export function Companion({
  state,
  label,
  tutorName = TUTOR.name,
  decorative = false,
  className,
}: CompanionProps) {
  const scale = 1 + state.progress * GROWTH_RANGE;

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(" ")}
      style={{ "--companion-scale": scale } as React.CSSProperties}
      data-emotion={state.emotion}
      data-activity={state.activity}
      data-stage={state.stage}
      data-progress={state.progress}
      data-animated={state.animated}
      {...(decorative
        ? { "aria-hidden": true }
        : {
            role: "img",
            "aria-label": label ?? moodDescription(tutorName, state.emotion),
          })}
    >
      <div className={styles.body}>
        <div className={styles.face}>
          <div className={styles.eyes}>
            <span className={styles.eye} data-part="eye" />
            <span className={styles.eye} data-part="eye" />
          </div>
          <span className={styles.mouth} data-part="mouth" />
        </div>
      </div>
    </div>
  );
}
