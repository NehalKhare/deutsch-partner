/**
 * What you actually do here, room by room.
 *
 * Each line names a real feature and stops: the product is the pitch, and a
 * claim that outruns it would be found out within the first session. Stated
 * once because three readers need the same list — the landing page, the
 * structured data a search engine reads, and the plain-text summary an answer
 * engine reads — and three copies would be three chances to promise something
 * different.
 */
export interface Room {
  readonly name: string;
  readonly what: string;
}

export const ROOMS: readonly Room[] = [
  {
    name: "Talk",
    what: "Conversations that talk back. Mistakes are corrected in the flow of the chat, gently, and remembered.",
  },
  {
    name: "Train",
    what: "A personal trainer runs your review: the words that are due, the mistakes you keep making, and a real news item retold at your level.",
  },
  {
    name: "Play a scene",
    what: "Roleplays with dealt roles — order the food, catch the train — and reading passages your tutor asks you about.",
  },
  {
    name: "Speak and listen",
    what: "Replies read aloud at your pace. Answer with your voice, and it understands you.",
  },
  {
    name: "See the whole path",
    what: "Seventy mini-levels, every word with its article and its English, open from day one. No locked chapters.",
  },
  {
    name: "Review that finds you",
    what: "Words come back exactly when you are about to forget them, inside conversation rather than on flashcards.",
  },
];
