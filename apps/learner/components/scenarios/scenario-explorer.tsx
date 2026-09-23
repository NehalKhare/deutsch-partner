"use client";

import { useState } from "react";

import { ScenarioCard } from "@/components/scenarios/scenario-card";
import { buttonQuiet, field, focusRing } from "@dp/ui/styles";
import type { ScenarioSummary, ScenarioType } from "@dp/domain/scenario";
import { cn } from "@dp/ui/utils";

/**
 * The scenario search surface: a natural-language search box, a type filter,
 * and the card grid.
 *
 * Browsing and searching are the same grid in two states. With no search the
 * grid shows the whole corpus, filtered by the tab on the client — fifty
 * cards need no round trip. A search posts the query (and the active tab as
 * the type filter) to the search endpoint and shows what comes back; a tab
 * change filters whichever list is showing. Nothing here decides anything
 * else: authentication, rate limits and the embedding call all live on the
 * server.
 */

type Filter = "all" | ScenarioType;

const TABS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "dialogue", label: "Dialogues" },
  { value: "comprehension", label: "Comprehensions" },
];

const SEARCH_FAILED = "Scenario search is unavailable right now. Please try again shortly.";

export function ScenarioExplorer({
  initial,
  practiceAction,
}: {
  initial: readonly ScenarioSummary[];
  practiceAction: (formData: FormData) => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [results, setResults] = useState<readonly ScenarioSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    setError(null);

    if (trimmed.length === 0) {
      setResults(null);
      return;
    }

    setSearching(true);
    try {
      const response = await fetch("/api/scenarios/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: trimmed,
          ...(filter === "all" ? {} : { type: filter }),
        }),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          payload !== null &&
          typeof payload === "object" &&
          "message" in payload &&
          typeof payload.message === "string"
            ? payload.message
            : SEARCH_FAILED;
        setError(message);
        return;
      }

      const found =
        payload !== null && typeof payload === "object" && "results" in payload
          ? (payload.results as ScenarioSummary[])
          : [];
      setResults(found);
    } catch {
      setError(SEARCH_FAILED);
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    setQuery("");
    setResults(null);
    setError(null);
  }

  const shown = (results ?? initial).filter(
    (scenario) => filter === "all" || scenario.type === filter,
  );

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={search} className="flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={cn(field, "sm:flex-1")}
          placeholder="I want to practice ordering food at a restaurant…"
          aria-label="Search scenarios"
          maxLength={200}
        />
        <button
          type="submit"
          disabled={searching}
          className={cn(buttonQuiet, "shrink-0")}
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      <div className="flex items-center gap-2" role="group" aria-label="Filter by type">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setFilter(tab.value)}
            aria-pressed={filter === tab.value}
            className={cn(
              "rounded-full px-3 py-1.5 font-display text-sm whitespace-nowrap transition-colors",
              filter === tab.value
                ? "bg-brand/15 text-brand"
                : "text-copy/60 hover:text-copy",
              focusRing,
            )}
          >
            {tab.label}
          </button>
        ))}

        {results !== null && (
          <button
            type="button"
            onClick={clearSearch}
            className={cn(
              "ml-auto font-display text-sm text-copy/60 underline underline-offset-4 hover:text-copy",
              focusRing,
              "rounded-sm",
            )}
          >
            Show all scenarios
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-ember">
          {error}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="leading-relaxed text-copy/70">
          {results !== null
            ? "Nothing matched that search. Try different words, or show all scenarios."
            : "No scenarios here yet."}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((scenario) => (
            <li key={scenario.slug} className="flex">
              <ScenarioCard
                scenario={scenario}
                practiceAction={practiceAction}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
