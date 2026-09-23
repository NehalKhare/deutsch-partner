import { ScenarioExplorer } from "@/components/scenarios/scenario-explorer";
import { page, pageTitle, prose } from "@dp/ui/styles";
import { practiceScenarioAction } from "@/app/(app)/scenarios/actions";
import { requireAuthenticatedUserId } from "@/lib/auth/current-user";
import { createScenarioRepository } from "@dp/db/scenario-repository";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import type { DatabaseClient } from "@dp/db/types";
import { cn } from "@dp/ui/utils";

export const metadata = { title: "Scenarios — Deutsch Partner" };

/**
 * The scenarios room.
 *
 * One read: the whole corpus as cards, rendered into the explorer where
 * searching and filtering happen. Fifty scenarios are a page, not a data set,
 * so browsing costs one query and no model call; only a search embeds.
 */
export default async function ScenariosPage() {
  await requireAuthenticatedUserId();
  const supabase = (await createServerSupabaseClient()) as unknown as DatabaseClient;

  const scenarios = await createScenarioRepository(supabase).list();

  return (
    <main className={cn(page, "max-w-6xl")}>
      <header className="flex flex-col gap-2">
        <h1 className={pageTitle}>Scenarios</h1>
        <p className={cn(prose, "max-w-2xl")}>
          Say what you want to practise — a situation to talk through, or a
          text to test your reading. Both open a conversation with your
          tutor: a dialogue as a roleplay with dealt roles, a comprehension
          as a passage it asks you about.
        </p>
      </header>

      {scenarios.ok ? (
        <ScenarioExplorer
          initial={scenarios.data}
          practiceAction={practiceScenarioAction}
        />
      ) : (
        <p className={prose}>
          The scenario library could not be loaded. Please refresh and try
          again.
        </p>
      )}
    </main>
  );
}
