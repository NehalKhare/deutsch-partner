import type { ScenarioSummary } from "@dp/domain/scenario";

/**
 * The human form of a scenario's citation.
 *
 * Every scenario row records which dataset document it was parsed from and
 * where in that document it sat, and every API response carries both. This
 * turns the machine form ("Conversational_German_15_Dialogue_Stories.md",
 * index 0) into the sentence a card prints, so a learner — or anyone
 * checking retrieval quality — can trace a result back to its source.
 */

/** The dataset documents by file name, titled as their own H1s title them. */
const SOURCE_TITLES: Readonly<Record<string, string>> = {
  "Conversational_German_15_Dialogue_Stories.md":
    "Conversational German: 15 Dialogue Stories",
  "German_Listening_and_Comprehension_Practice.md":
    "German Listening & Comprehension Practice",
};

/** A document the map does not know still gets a readable name, not a path. */
export function sourceTitle(source: string): string {
  return SOURCE_TITLES[source] ?? source.replace(/\.md$/u, "").replace(/_/gu, " ");
}

export function scenarioCitation(
  scenario: Pick<ScenarioSummary, "source" | "itemIndex">,
): string {
  // Stored indices are zero-based; nobody cites "item 0".
  return `${sourceTitle(scenario.source)}, item ${scenario.itemIndex + 1}`;
}
