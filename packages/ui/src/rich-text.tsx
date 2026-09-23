import { Fragment } from "react";

import { parseRichText, type Span } from "./markdown/parse";

/**
 * A tutor's reply, formatted.
 *
 * React elements from a parsed tree, never a string of HTML: the text is model
 * output, so the safety property worth having is that markup is not
 * expressible at all rather than escaped correctly.
 *
 * Spacing is deliberately tight. This renders inside a chat bubble, where the
 * usual document rhythm of a full blank line between paragraphs makes a
 * three-sentence answer look like an essay.
 */
function Spans({ spans }: { readonly spans: readonly Span[] }) {
  return (
    <>
      {spans.map((span, index) => {
        const key = `${span.kind}-${index}`;
        if (span.kind === "strong") {
          // The accent, not merely a heavier weight: bold is what the tutor
          // and the trainer use for the thing the learner must act on — the
          // corrected form, the sentence to fix, the question — and on this
          // dark ground weight alone barely registers at reading size.
          return (
            <strong key={key} className="font-semibold text-apricot">
              {span.text}
            </strong>
          );
        }
        if (span.kind === "emphasis") {
          return (
            <em key={key} className="italic">
              {span.text}
            </em>
          );
        }
        if (span.kind === "code") {
          // The counterpart of the apricot bold above: the tutor and trainer
          // are told to quote the learner's wrong form in backticks, so this
          // is the mistake's colour — ember, same as everywhere else the
          // product points at something that went wrong.
          return (
            <code
              key={key}
              className="rounded bg-ember/10 px-1 py-0.5 font-mono text-[0.9em] text-ember"
            >
              {span.text}
            </code>
          );
        }
        // Plain runs stay bare text. A span per run would be markup for
        // nothing, and it would move the text off the element carrying
        // lang="de" — which is what tells a screen reader to switch voice.
        return <Fragment key={key}>{span.text}</Fragment>;
      })}
    </>
  );
}

export function RichText({ content }: { readonly content: string }) {
  const blocks = parseRichText(content);

  // The overwhelmingly common reply is one paragraph, and it deserves no
  // wrapper: the bubble it renders into is already the element with the
  // language and the line height on it.
  const only = blocks.length === 1 ? blocks[0] : null;
  if (only?.kind === "paragraph") return <Spans spans={only.spans} />;

  return (
    <span className="flex flex-col gap-2">
      {blocks.map((block, index) =>
        block.kind === "paragraph" ? (
          <span key={`p-${index}`}>
            <Spans spans={block.spans} />
          </span>
        ) : block.ordered ? (
          // list-inside, so a wrapped item lines up under its own text rather
          // than hanging outside a bubble that has no room to hang into.
          <ol key={`ol-${index}`} className="list-inside list-decimal">
            {block.items.map((item, at) => (
              <li key={`li-${at}`}>
                <Spans spans={item} />
              </li>
            ))}
          </ol>
        ) : (
          <ul key={`ul-${index}`} className="list-inside list-disc">
            {block.items.map((item, at) => (
              <li key={`li-${at}`}>
                <Spans spans={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </span>
  );
}
