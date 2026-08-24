import { Companion } from "@/components/companion/companion";
import { buttonPrimary, pageTitle, prose } from "@/components/ui/styles";
import { startThreadAction } from "@/app/(app)/chat/actions";
import { companionStateFor } from "@/domain/companion";
import { cn } from "@/lib/utils";

export const metadata = { title: "Chat — Deutsch Partner" };

/**
 * The entry point to a conversation.
 *
 * A form rather than a link, because starting a thread writes a row and a GET
 * that writes is a GET that a link prefetch can trigger.
 *
 * The companion is waiting rather than idle: this screen exists for the two
 * seconds before someone decides to speak, which is the moment the character
 * is for.
 */
export default function ChatEntryPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col items-center gap-8 px-6 py-16 text-center md:py-24">
      <Companion
        state={companionStateFor({ miniLevel: 1, activity: "listening" })}
        label="Your learning companion, waiting for you to start"
        className="[--companion-size:7rem]"
      />
      <h1 className={pageTitle}>Talk in German</h1>
      <p className={cn(prose, "max-w-md text-lg")}>
        Your tutor will start at the level you are on and stay there. Say
        whatever you can; getting it wrong is how this works.
      </p>
      <form action={startThreadAction}>
        <button type="submit" className={buttonPrimary}>
          Start a conversation
        </button>
      </form>
    </main>
  );
}
