"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { createConversationRepository } from "@/repositories/conversation-repository";
import { createScenarioRepository } from "@/repositories/scenario-repository";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import type { DatabaseClient } from "@/repositories/types";

const slugField = z.string().min(1).max(200).regex(/^[a-z0-9-]+$/u);

/**
 * Opens a practice thread for one scenario and sends the learner in.
 *
 * Both kinds: a dialogue opens as a roleplay, a comprehension opens as a
 * reading conversation — the passage first, then questions, with every
 * learner message flowing through the same evaluation pipeline as any other
 * chat turn, which is what makes reading practice count towards the mistake
 * history and the vocabulary record.
 *
 * The thread is titled after the scenario, so the chat header says what is
 * being practised, and the scenario slug rides along as a query parameter so
 * the thread page can seed the scene. Neither the level nor the owner is
 * submitted; the database function reads both from the verified session. A
 * malformed or missing slug lands back on the scenarios page.
 */
export async function practiceScenarioAction(formData: FormData): Promise<never> {
  await requireAuthenticatedUserId();

  const slug = slugField.safeParse(formData.get("slug"));
  if (!slug.success) redirect("/scenarios");

  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;

  const scenario = await createScenarioRepository(supabase).getBySlug(slug.data);
  if (!scenario.ok) redirect("/scenarios");

  const created = await createConversationRepository(supabase).createThread({
    title: scenario.data.title,
    topic: scenario.data.titleEnglish.slice(0, 64),
    mode: scenario.data.type === "dialogue" ? "roleplay" : "reading",
  });

  redirect(
    created.ok
      ? `/chat/${created.data.id}?scenario=${scenario.data.slug}`
      : "/scenarios",
  );
}
