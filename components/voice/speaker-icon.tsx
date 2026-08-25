/**
 * The speaker, with one more wave when it is speaking.
 *
 * Shared by the chat and the trainer so the same control means the same thing
 * in both: a filled second arc is "this is being read now", not decoration.
 */
export function SpeakerIcon({ speaking }: { speaking: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
      {speaking ? (
        <>
          <path d="M15.5 9a4 4 0 0 1 0 6" />
          <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
        </>
      ) : (
        <path d="M15.5 9a4 4 0 0 1 0 6" />
      )}
    </svg>
  );
}
