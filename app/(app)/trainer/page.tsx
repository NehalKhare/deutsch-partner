import { TrainerSession } from "@/components/trainer/session";
import { eyebrow, pageTitle, prose } from "@/components/ui/styles";
import { cn } from "@/lib/utils";

export const metadata = { title: "Trainer — Deutsch Partner" };

/**
 * The Trainer: an agent with tools, run per message.
 *
 * Where the chat is a conversation, this is a workout: the agent looks up
 * what is due, quizzes, judges, records outcomes through the deterministic
 * review engine, and can search the corpus, open the grammar catalogue,
 * fetch simple-German news, and borrow tools from a configured remote MCP
 * server. Auth and onboarding are enforced by the (app) layout; nothing here
 * needs data at render time because every fact arrives through a tool.
 */
export default function TrainerPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 pt-6 md:px-10">
      <header className="flex flex-col gap-2 border-b border-haze/60 pb-4">
        <p className={eyebrow}>Practice, with receipts</p>
        <h1 className={pageTitle}>Trainer</h1>
        <p className={cn(prose, "max-w-xl text-sm")}>
          Reviews your due words, grades your answers, and shows exactly which
          tools it used to do it.
        </p>
      </header>
      <TrainerSession />
    </main>
  );
}
