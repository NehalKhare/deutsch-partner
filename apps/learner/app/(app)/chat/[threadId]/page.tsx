import { notFound } from "next/navigation";

import { Conversation } from "@/components/chat/conversation";
import { getMiniLevel } from "@dp/learning/mini-levels";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { scenarioSeed } from "@/lib/scenarios/roleplay";
import { createConversationRepository } from "@dp/db/conversation-repository";
import { createLearnerRepository } from "@dp/db/learner-repository";
import { createPerformanceRepository } from "@dp/db/performance-repository";
import { createScenarioRepository } from "@dp/db/scenario-repository";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import type { DatabaseClient } from "@dp/db/types";

export const metadata = { title: "Conversation" };

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
 * The page is rendered at the thread's own mini-level — the place — not at
 * the learner's current position: reopening a mini-level 1 conversation shows
 * level 1 and its tally, and the first message of the visit stands the
 * learner back there. The graph owns that move; this page only says it.
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
  const [thread, profile] = await Promise.all([
    conversations.getThread(threadId),
    learners.getProfile(learnerId),
  ]);

  if (!thread.ok) notFound();

  // The thread's own place, not the learner's current position. Coming back
  // to a mini-level 1 conversation means practising mini-level 1, however far
  // the learner has walked since — the first message of a fresh visit stands
  // them back here, and this page has to say so from the first paint.
  const miniLevel = thread.data.miniLevel;

  // That level's stored tally, so the mastery strip resumes where this level
  // actually is rather than at zero. Read as the learner, RLS-scoped like the
  // rest; if it fails the strip starts empty — a smaller loss than no page.
  const tally = await createPerformanceRepository(supabase).getForLevel(
    learnerId,
    miniLevel,
  );

  // A scenario opens the scene: a dialogue's roles and opening line, or a
  // comprehension's passage, arrive as the tutor's first message — no hidden
  // instruction, and the learner sees exactly what the tutor was given. The
  // repository validates the slug, so a malformed or unknown one simply seeds
  // nothing and the thread still works as a plain conversation.
  const scenario =
    typeof scenarioSlug === "string" && scenarioSlug.length > 0
      ? await createScenarioRepository(supabase).getBySlug(scenarioSlug)
      : null;
  const seed = scenario?.ok ? scenarioSeed(scenario.data) : null;

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-6 pt-6 md:px-10">
      {/* The header lives inside the conversation: the companion and the
          position label are live state, and a server-rendered banner above
          them would go stale the moment the learner levels up. */}
      <Conversation
        threadId={threadId}
        title={thread.data.title}
        initialMessages={seed ? [seed] : []}
        miniLevel={miniLevel}
        theme={getMiniLevel(miniLevel).theme}
        initialTally={
          tally.ok && tally.data
            ? { turns: tally.data.turns, strongTurns: tally.data.strongTurns }
            : undefined
        }
        // The thread's own level, so a reply is read out at the pace the
        // learner is being taught at rather than at a default.
        cefr={thread.data.cefr}
        voiceGender={profile.ok ? profile.data.voicePreference : "male"}
        // And how they said replies should arrive: a learner who chose
        // spoken replies gets them without pressing anything.
        outputPreference={profile.ok ? profile.data.outputPreference : "text"}
        // The learner's own pass mark. The server applies the same value to
        // the move's bookkeeping; this copy draws the strip and the offer.
        masteryThreshold={profile.ok ? profile.data.masteryThreshold : 80}
      />
    </main>
  );
}
