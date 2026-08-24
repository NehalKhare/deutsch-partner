"use client";

import { useState } from "react";

import { buttonPrimary, buttonQuiet, field } from "@/components/ui/styles";
import type { ComprehensionQuestion } from "@/domain/scenario";
import { gradeAnswer } from "@/lib/scenarios/quiz";
import { cn } from "@/lib/utils";

/**
 * The question-and-answer half of a comprehension.
 *
 * Grading is a normalized string check (lib/scenarios/quiz.ts), not a model
 * call, and it is deliberately generous: a match is marked correct, anything
 * else shows the model answer for the learner to compare — free-form German
 * has too many right phrasings for a string compare to say "wrong".
 */

export function ComprehensionQuiz({
  questions,
}: {
  questions: readonly ComprehensionQuestion[];
}) {
  const [answers, setAnswers] = useState<string[]>(() =>
    questions.map(() => ""),
  );
  const [checked, setChecked] = useState(false);

  function setAnswer(index: number, value: string) {
    setAnswers((current) =>
      current.map((answer, at) => (at === index ? value : answer)),
    );
  }

  function reset() {
    setAnswers(questions.map(() => ""));
    setChecked(false);
  }

  const correct = checked
    ? questions.filter(
        (question, index) => gradeAnswer(answers[index], question.answer) === "correct",
      ).length
    : 0;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setChecked(true);
      }}
      className="flex flex-col gap-5"
    >
      <ol className="flex flex-col gap-5">
        {questions.map((question, index) => {
          const grade = checked ? gradeAnswer(answers[index], question.answer) : null;

          return (
            <li key={question.question} className="flex flex-col gap-2">
              <label
                htmlFor={`quiz-question-${index}`}
                className="font-body leading-relaxed text-chalk"
              >
                {index + 1}. {question.question}
              </label>
              <input
                id={`quiz-question-${index}`}
                type="text"
                value={answers[index]}
                onChange={(event) => setAnswer(index, event.target.value)}
                className={field}
                disabled={checked}
                autoComplete="off"
              />
              {grade === "correct" && (
                <p className="text-sm text-sprout">✓ Correct — {question.answer}</p>
              )}
              {grade === "review" && (
                <p className="text-sm text-chalk/70">
                  Compare with the answer:{" "}
                  <span className="text-apricot">{question.answer}</span>
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {checked ? (
        <div className="flex items-center gap-4">
          <p className="font-display text-sm text-chalk/70">
            {correct} of {questions.length} matched the answer.
          </p>
          <button type="button" onClick={reset} className={buttonQuiet}>
            Try again
          </button>
        </div>
      ) : (
        <button type="submit" className={cn(buttonPrimary, "self-start")}>
          Check answers
        </button>
      )}
    </form>
  );
}
