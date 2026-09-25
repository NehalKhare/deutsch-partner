import { TrainerSession } from "@/components/trainer/session";
import { eyebrow, pageTitle, prose } from "@dp/ui/styles";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { createLearnerRepository } from "@dp/db/learner-repository";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import { cn } from "@dp/ui/utils";
import type { DatabaseClient } from "@dp/db/types";

export const metadata = { title: "Trainer" };

/**
 * The Trainer: an agent with tools, run per message.
 *
 * Where the chat is a conversation, this is a workout: the agent looks up
 * what is due, quizzes, judges, records outcomes through the deterministic
 * review engine, and can search the corpus, open the grammar catalogue,
 * fetch simple-German news, and borrow tools from a configured remote MCP
 * server. Auth and onboarding are enforced by the (app) layout.
 *
 * Wider than the other pages because the session has two columns on a large
 * screen: the plan on the left, the conversation beside it. Below that width
 * the plan is dropped rather than stacked — it was above the transcript
 * before, which is the arrangement this replaced.
 *
 * Two facts are read here rather than through a tool, because they are not
 * facts about the practice: how fast a reply should be read out, and in whose
 * voice. Both are the learner's settings, both are needed on the first paint
 * for the read-aloud control to be honest about what it will do, and neither
 * is something the trainer should have to ask a tool for. Everything the
 * session is *about* still arrives through tools.
 */
export default async function TrainerPage() {
  const learnerId = await requireAuthenticatedUserId();
  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;
  const learners = createLearnerRepository(supabase);

  const [profile, state] = await Promise.all([
    learners.getProfile(learnerId),
    learners.getState(learnerId),
  ]);

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-6 px-6 pt-6 md:px-10">
      <header className="flex flex-col gap-2 border-b border-edge/60 pb-4">
        <p className={eyebrow}>Practice, with receipts</p>
        <h1 className={pageTitle}>Trainer</h1>
        <p className={cn(prose, "max-w-xl text-sm")}>
          Reviews your due words, grades your answers, and shows exactly which
          tools it used to do it.
        </p>
      </header>
      <TrainerSession
        // The learner's own level and voice. Unreadable settings fall back to
        // the gentlest pace and the default voice rather than to no voice.
        cefr={state.ok ? state.data.effectiveLevel.cefr : "A1"}
        voiceGender={profile.ok ? profile.data.voicePreference : "male"}
        outputPreference={profile.ok ? profile.data.outputPreference : "text"}
      />
    </main>
  );
}
