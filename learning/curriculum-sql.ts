import type { MiniLevelDefinition } from "@/domain/mini-level";
import { jsonObject, quoteLiteral, textArray } from "@/learning/sql-literals";

/**
 * Renders the curriculum as the seed migration.
 *
 * The TypeScript curriculum is the single source of truth. The database needs
 * the same rows for referential integrity — a learner state points at a
 * mini-level, and without the row onboarding cannot write its first record —
 * so the migration is generated rather than maintained alongside it. A test
 * regenerates this and compares, so editing one without the other fails.
 */

export const CURRICULUM_MIGRATION_FILE = "20260821121100_seed_mini_levels.sql";

const COLUMNS = [
  "mini_level",
  "cefr",
  "theme",
  "focus",
  "target_vocabulary",
  "target_grammar",
  "conversation_functions",
  "comprehension_goals",
  "production_goals",
  "mastery_criteria",
  "review_requirements",
  "recommended_activities",
] as const;

/** Every column but the primary key is refreshed, so a re-run repairs drift. */
const UPDATED = COLUMNS.filter((column) => column !== "mini_level");

function renderRow(level: MiniLevelDefinition): string {
  return [
    `  (${level.miniLevel}, ${quoteLiteral(level.cefr)}, ${quoteLiteral(level.theme)},`,
    `   ${quoteLiteral(level.focus)},`,
    `   ${textArray(level.targetVocabulary)},`,
    `   ${textArray(level.targetGrammar)},`,
    `   ${textArray(level.conversationFunctions)},`,
    `   ${textArray(level.comprehensionGoals)},`,
    `   ${textArray(level.productionGoals)},`,
    `   ${jsonObject(level.masteryCriteria)},`,
    `   ${jsonObject(level.reviewRequirements)},`,
    `   ${textArray(level.recommendedActivities)})`,
  ].join("\n");
}

export function renderCurriculumSeed(
  curriculum: readonly MiniLevelDefinition[],
): string {
  const header = [
    "-- Generated from learning/curriculum.ts. Do not edit by hand.",
    "-- Regenerate with: pnpm curriculum:generate",
    "--",
    "-- The seventy mini-levels are shared reference content, not learner data.",
    "-- They live in the database because learner rows point at them: without",
    "-- mini-level 1 present, the first write of onboarding has nothing to",
    "-- reference and fails.",
    "",
    `insert into public.mini_levels (${COLUMNS.join(", ")})`,
    "values",
  ].join("\n");

  const rows = curriculum.map(renderRow).join(",\n");

  const conflict = [
    "on conflict (mini_level) do update set",
    UPDATED.map((column) => `  ${column} = excluded.${column}`).join(",\n"),
  ].join("\n");

  return `${header}\n${rows}\n${conflict};\n`;
}
