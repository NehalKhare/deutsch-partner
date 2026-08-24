---
name: commit-summary
description: Write a Conventional Commits message (type(scope): subject, plus body and footers) that describes the current git changes. Use this whenever the user asks for a commit message, commit summary, or "what should I call this commit", asks you to summarize or describe their diff / staged changes / working tree, or asks you to commit and a message has to be written first — even if they never say the words "conventional commit".
---

# Commit Summary

Turn the current git changes into a commit message that a reviewer reading `git log`
six months from now would find useful.

The failure mode to avoid is a message that restates the diff ("update
handleSubmit, add zod schema"). The diff is already in the commit; what is not
recoverable later is *what the change accomplishes and why*. Read enough of the
change to say that.

## 1. Gather the change

Run the bundled collector, which prints status, stat, and full diffs for staged,
unstaged, and untracked content in one pass:

```sh
bash .claude/skills/commit-summary/scripts/collect-diff.sh
```

Equivalent by hand: `git status --short`, `git diff --staged`, `git diff`, and
`git diff --no-index /dev/null <file>` for each untracked file.

**Which changes does the message cover?** If anything is staged, describe *only*
the staged changes — that is what the next commit will contain, and a message
covering unstaged work would be wrong. Say in one line that you scoped it to the
staged set and that unstaged changes remain. If nothing is staged, cover the
whole working tree including untracked files.

If the diff is large, read the full text of the files that carry the intent
(feature modules, schemas, prompts) and rely on `--stat` for the mechanical rest
(lockfiles, snapshots, generated output). Guessing the intent from filenames
alone is where wrong messages come from.

## 2. Pick the type

The type describes the *intent* of the change as a user or maintainer would see
it, not the mechanics of the edit.

| type | use when |
| --- | --- |
| `feat` | new capability visible to a user or caller |
| `fix` | corrects broken behavior |
| `perf` | same behavior, measurably faster or cheaper |
| `refactor` | restructures code, behavior unchanged |
| `docs` | documentation or comments only |
| `test` | tests only, no production code touched |
| `style` | formatting only, no logic (not CSS work — CSS that changes the UI is `feat`/`fix`) |
| `build` | dependencies, bundler, package manifests |
| `ci` | CI configuration and workflows |
| `chore` | housekeeping that fits nothing above |
| `revert` | reverts a prior commit |

When a change spans several categories — a bug fix that ships with its
regression test, a feature that also renames a helper — choose the type of the
most significant user-visible part. `feat` > `fix` > `perf` > `refactor` >
everything else. A fix plus its test is `fix`, not `test`.

If the changes are genuinely unrelated (a dependency bump *and* a new feature),
say so and offer a split: propose the message for the primary change, then list
the other groups with the `git add` paths for each. Splitting is the user's call,
so give them the material rather than silently lumping it together.

## 3. Pick the scope

Derive the scope from the paths that changed, so it matches something a reader
can actually navigate to. Use the most specific directory that contains all the
meaningful changes:

- `features/salary-negotiation/**` → `salary-negotiation`
- `lib/openrouter.ts` → `openrouter`
- `app/settings/**` → `settings`
- changes spread across unrelated top-level directories → omit the scope

Omit the scope rather than inventing a vague one; `feat: ...` reads better than
`feat(misc): ...`. Keep it lowercase and one or two words.

## 4. Write the message

```
type(scope): subject line

Body paragraph explaining why the change was needed and anything
non-obvious about the approach. Wrap at 72 columns.

Footer(s)
```

Subject line:

- imperative mood, as if completing "this commit will …" — `add`, `fix`,
  `remove`, not `added` or `adds`
- lowercase after the colon, no trailing period
- the whole line stays under 72 characters, ideally under 50

Body — include it whenever the *why* is not self-evident from the subject, which
is most non-trivial changes. Cover the motivation, any decision a reader might
question, and behavior changes that are not obvious from the code. Skip it for
genuinely trivial commits (a typo fix, a version bump); a one-line commit is
better than a padded one. Use `-` bullets when the change has several
independent parts.

Footers:

- breaking changes get a `!` before the colon **and** a footer:
  `feat(api)!: ...` with `BREAKING CHANGE: callers must now pass a model id`
- reference issues only when the diff or branch name actually names one
  (`Refs: #412`). Never invent an issue number.

Never state test results, benchmarks, or review outcomes you did not observe.
"Fixes the race condition" is a claim about behavior — only write it if the diff
supports it.

## 5. Deliver it

Print the message in a fenced code block so it can be copied, and nothing else
beyond a sentence or two of note (scoping, split suggestions, uncertainty about
intent). Do not run `git commit` unless the user asked you to commit; when they
did, use the message you just showed.

## Examples

**Input:** a new `features/salary-negotiation/` module — action, prompt, schema,
component, and tests — plus a link added to the app nav.

```
feat(salary-negotiation): add salary negotiation coach module

Adds a new interview module that turns a role, offer, and market
range into scripted negotiation openers and counters. The prompt
follows the existing two-example calibration structure and the
model response is validated with Zod before rendering.

Reachable from the main nav alongside the other modules.
```

**Input:** one-line change in `lib/openrouter.ts` raising `max_tokens` from 1024
to 4096, plus an updated expected cost in `lib/pricing.ts` and its test.

```
fix(openrouter): raise completion budget so answers stop truncating

The 1024-token ceiling cut off structured responses partway through
the final field, which failed schema validation and surfaced as a
generic error. Raises the budget to 4096 and updates the price
estimator to use the same number so quotes stay accurate.
```

**Input:** `pnpm-lock.yaml` and `package.json` bump three dev dependencies,
nothing else.

```
build(deps): bump vitest, eslint, and typescript to latest minors
```
