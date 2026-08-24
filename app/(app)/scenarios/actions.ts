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
 * Opens a roleplay thread for one dialogue scenario and sends the learner in.
 *
 * The thread is titled after the scenario, so the chat header says what is
 * being practised, and the scenario slug rides along as a query parameter so
 * the thread page can seed the scene. Neither the level nor the owner is
 * submitted; the database function reads both from the verified session. A
 * slug that is malformed, missing, or names a comprehension lands back on the
 * scenarios page — there is nothing to roleplay there.
 */
export async function practiceDialogueAction(formData: FormData): Promise<never> {
  await requireAuthenticatedUserId();

  const slug = slugField.safeParse(formData.get("slug"));
  if (!slug.success) redirect("/scenarios");

  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;

  const scenario = await createScenarioRepository(supabase).getBySlug(slug.data);
  if (!scenario.ok || scenario.data.type !== "dialogue") redirect("/scenarios");

  const created = await createConversationRepository(supabase).createThread({
    title: scenario.data.title,
    topic: scenario.data.titleEnglish.slice(0, 64),
    mode: "roleplay",
  });

  redirect(
    created.ok
      ? `/chat/${created.data.id}?scenario=${scenario.data.slug}`
      : "/scenarios",
  );
}
