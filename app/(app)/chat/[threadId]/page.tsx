import { notFound } from "next/navigation";

import { Conversation } from "@/components/chat/conversation";
import { MIN_MINI_LEVEL } from "@/domain/cefr";
import { getMiniLevel } from "@/learning/mini-levels";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { roleplaySeed } from "@/lib/scenarios/roleplay";
import { createConversationRepository } from "@/repositories/conversation-repository";
import { createLearnerRepository } from "@/repositories/learner-repository";
import { createScenarioRepository } from "@/repositories/scenario-repository";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import type { DatabaseClient } from "@/repositories/types";

export const metadata = { title: "Conversation — Deutsch Partner" };

/**
 * One thread, always fresh.
 *
 * Nothing is fetched to fill it, because there is nothing to fetch: what is
 * said here lives in the browser's memory and is never written down. Coming
 * back to a thread means coming back to the place — the topic and the level
 * it was opened at — and starting again, which for practice is the point.
 *
 * The thread is fetched without a learner filter: the query runs as the
 * signed-in learner and Row Level Security decides whether the row exists for
 * them. Somebody else's thread id is therefore a 404, which is also what it
 * should look like — distinguishing "not yours" from "no such thread" would
 * confirm the thread exists to whoever guessed the id.
 *
 * The learner's mini-level is read alongside it only so the companion is the
 * size it has been earned to be. If that read fails the conversation still
 * happens, with a companion at the first size — the wrong blob is a far
 * smaller loss than no reply.
 */
export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<{ scenario?: string | string[] }>;
}) {
  const learnerId = await requireAuthenticatedUserId();
  const [{ threadId }, { scenario: scenarioSlug }] = await Promise.all([
    params,
    searchParams,
  ]);

  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;
  const conversations = createConversationRepository(supabase);

  const learners = createLearnerRepository(supabase);
  const [thread, state, profile] = await Promise.all([
    conversations.getThread(threadId),
    learners.getState(learnerId),
    learners.getProfile(learnerId),
  ]);

  if (!thread.ok) notFound();

  // A dialogue scenario opens the scene: its opening line arrives as the
  // partner's first message, so the roleplay needs no hidden instruction and
  // the learner sees exactly what the tutor was given. The repository
  // validates the slug, so a malformed or unknown one simply seeds nothing —
  // the thread still works as a plain conversation.
  const scenario =
    typeof scenarioSlug === "string" && scenarioSlug.length > 0
      ? await createScenarioRepository(supabase).getBySlug(scenarioSlug)
      : null;
  const seed = scenario?.ok ? roleplaySeed(scenario.data) : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 pt-6 md:px-10">
      {/* The header lives inside the conversation: the companion and the
          position label are live state, and a server-rendered banner above
          them would go stale the moment the learner levels up. */}
      <Conversation
        threadId={threadId}
        title={thread.data.title}
        initialMessages={seed ? [seed] : []}
        miniLevel={state.ok ? state.data.miniLevel : MIN_MINI_LEVEL}
        theme={getMiniLevel(state.ok ? state.data.miniLevel : MIN_MINI_LEVEL).theme}
        // The thread's own level, so a reply is read out at the pace the
        // learner is being taught at rather than at a default.
        cefr={thread.data.cefr}
        voiceGender={profile.ok ? profile.data.voicePreference : "male"}
      />
    </main>
  );
}
