# Product flow

## Who the tutor is

**Jonas.** A named person rather than "the assistant", because someone
practising conversation is practising it with somebody — and because without a
name the model invented one every session: Anna in one thread, *dein
Deutsch-Partner* in the next, which is not a tutor a learner comes back to.

He is a man, and that is declared once in [`domain/tutor.ts`](../domain/tutor.ts)
rather than three times. Three layers have to agree about it: the prompt that
tells him who he is, the speech provider that picks a voice, and the interface
that puts his name on screen. The Web Speech API exposes no gender at all, so
the browser fallback resolves the same fact against a list of German voices it
knows to be men — a preference, not a requirement, because being read to in the
wrong voice beats not being read to.

Changing his name is a one-line edit and a prompt version bump, which the
version-lock test will insist on.

## Who this is for

An English speaker who wants to hold a conversation in German. Not a
vocabulary app, not a grammar reference — a tutor you talk to, that talks back
at a level you can follow, and that remembers what you keep getting wrong.

The path runs from absolute beginner to B1, split into **seventy mini-levels**
so that "progress" is something you can see this week rather than this year.

## Use cases

### 1. Signing up and being placed

A new learner creates an account and answers a short onboarding form: what
they want German for, which level they think they are, what they are interested
in, whether they prefer typing or speaking, and how they want to be corrected.

Nothing about that is a guess the product makes for them, and nothing about it
is final. The **selected level** is what they asked for; the **estimated level**
is what their writing later shows; the **effective level** is what the tutor
actually pitches to. The three are kept separate so the product never silently
overrules what a learner told it.

> `app/onboarding/`, `domain/learner.ts`, `lib/onboarding/`

### 2. Having a conversation

The main thing. A learner opens a thread and writes in German. The reply
arrives a few words at a time, in German, at their level: three sentences at A1,
eight at B1; two new words at A1, four at B1; gentle reformulation at A1,
selective correction at B1.

Behind one message the system does five things, described in full under
[the turn](#the-turn) below.

The companion beside the message box is doing what is actually happening: it
leans in and closes its mouth while a learner is typing or while their message
is in flight, and it talks — body and mouth both moving — while the reply is
arriving. That is not decoration on a spinner. A character that smiles through
a five-second silence has told the learner nothing.

### Speaking, and being spoken to

The composer has a microphone. It records, sends the clip to be transcribed,
and puts the words **in the box** rather than into the conversation — a learner
has to see what was heard before it becomes something they said, because a
misheard word is the entire thing they are here to notice.

Each of the tutor's replies has a speaker button, and a switch reads new ones
automatically. It tries the speech model first and the browser's own voice
second: the model sounds like a person, and the browser needs no key, costs
nothing and ships German on every desktop. A platform with no voices installed
says so rather than pretending — silence that claims to be speech is the one
outcome worse than no button at all.

The companion is doing what is actually happening throughout: listening while
the microphone is open, speaking while a reply is being read out.

> `components/chat/speech.ts`, `app/api/transcribe/`, `app/api/speak/`

A conversation can also be deleted, from the recent list on the dashboard. It
asks first, because there is no undo and there should not be: an undo would
mean the conversation was not really deleted. The messages and the rolling
summary go with it. What does not go with it is the learner's progress —
vocabulary, recorded mistakes, level — because that is what they learned, not
what they said. The usage ledger keeps its rows too: it holds a pseudonymous
hash and a cost, it is append-only by database trigger, and financial history
has to outlive the thing it describes.

> `app/(app)/chat/`, `app/api/chat/route.ts`, `lib/graph/`

### 3. Being corrected without being marked

An A1 learner who writes *"Ich habe gegangen nach Hause"* is not shown a table
of auxiliary verbs. They get a reply that says *"Ah, du bist nach Hause
gegangen!"* and carries on. A B1 learner gets the mistake named, briefly, and
only if it actually blocked meaning.

That difference is one configuration table, not three tutors.

> `lib/ai/prompts/behavior-policy.ts`

### 4. Asking a direct question

*"Was heißt trotzdem?"* is a vocabulary question. *"Warum sagt man mit dem
Zug?"* is a grammar question. *"Wie begrüßt man einen neuen Kollegen?"* is a
culture question. Each pulls different material out of the knowledge base, and
each is routed by pattern-matching the question rather than by asking a model
which kind it is.

*"Wie ist das Wetter heute?"* is routed to none of them. The corpus is teaching
material and has no current facts in it; answering from it would mean stating
last year's weather as today's.

> `lib/graph/intent.ts`, `lib/retrieval/`

### 5. Seeing the whole syllabus, and choosing where to be

The curriculum was in the repository from the start and no learner could see
any of it: seventy mini-levels of themes and grammar, and 420 words each with
its article, its plural and its English. [`/curriculum`](../app/(app)/curriculum/)
opens it.

Every noun in a level is also grouped into three columns — **der**, **die**,
**das** — because gender is the thing German learners spend years getting
wrong and it cannot be learned from a word list where the articles are
scattered across seventy tables. Seeing the columns side by side is the
practice. Each article keeps the colour German course books have printed for
decades — der blue, die red, das green — wherever it appears, so the
association is learned by exposure rather than taught.

Browsing a level and being taught at it are different acts, so they are
different controls. The tabs are links and cost nothing. Moving is a button
that says where it will put you. The band toggle puts you back where you left
that level rather than at its front — and every mini-level row carries its own
two buttons: **Start here**, which stands you on exactly that level, and
**Practise this level**, which stands you there and opens a conversation at
it. A syllabus you can read but not enter is a brochure. Neither marks
anything as skipped: walking to a shelf is not walking out of a lesson.

> `lib/curriculum/browse.ts`, `lib/curriculum/practise.ts`,
> `learning/progression.ts`

### 5b. Asking to move on

A learner who types *"I want to move to next"* — or **weiter**, or *"I'm done
with this"* — is moved to the next mini-level, and the tutor's very next
sentence welcomes them to it.

Nothing about that decision is a model call. The routing document names
mini-level progression and level advancement gating as work that must never be
one, and a learner's message is untrusted input: a pattern decides that a
request was made, a pure function decides what happens, and the tutor is told
afterwards. Asking what a word means — *"Was heißt weitermachen?"* — is a
vocabulary question and moves nobody.

The level left behind is recorded as **skipped, not mastered** — unless the
tally says they had already cleared it, in which case the same request is
recorded as an earned move (see 5c). A learner is allowed to walk past
something that bores them, but the dashboard's progress figures must not then
mean two things at once.

The chat also carries a **Next mini-level** button, and it is deliberately not
a second code path: it sends *"Weiter bitte!"* through the ordinary send, so
the server owns the move and the tutor answers from the new level in the same
breath. Beside it, the page names the mini-level being taught — a learner
standing on the last A1 level deserves to know the next click lands in A2.

> `learning/progression.ts`, `lib/graph/nodes.ts`

### 5c. Earning the move

Every evaluated turn adds one line to a per-level tally: evaluated, and
error-free or not. When the tally at the current level reaches **five
evaluated turns with the learner's pass mark met** — 80% error-free by
default, lowerable to 50% or 33% with a slider in settings; the five-turn
minimum is not negotiable — the gate is open, and the chat says so, plainly:
a banner announces the level is cleared and offers the choice, **Move on** or
**Keep practising**. Mastery moves nobody by itself. A learner who has just
found their feet at a level is allowed to enjoy standing on them.

Choosing to move goes through the same door every move does — the button
sends *"Weiter bitte!"* through the ordinary send — and the tally decides the
bookkeeping: with the gate open the level is recorded as **mastered** and the
tutor's reply congratulates them; without it, as skipped, with a welcome
instead. Earning and asking are different things, and the record keeps them
different even though the click is the same.

The gate is pure arithmetic over stored integers. The model's per-turn
evaluation feeds the tally; it never decides the move. Formulaic messages the
evaluator skips — *"Danke!"* — add nothing, so five pleasantries cannot open
the gate. And a level that was once skipped and later mastered is un-skipped:
the record says where the learner is, not where they once gave up.

The chat also draws the tally as it stands: a mastery strip under the header
shows the strong-turn ratio against the four-in-five bar, the five evidence
dots, and a per-turn verdict. It can be hidden, and the choice is remembered
on the device.

> `learning/mastery.ts` (`hasMastered`, `masteryFill`),
> `learning/progression.ts` (`advanceOnMastery`),
> `lib/graph/nodes.ts` (`honourAdvanceRequest`, `recordPerformance`),
> `components/chat/mastery-progress.tsx`

### 6. Reviewing

Words a learner has met are scheduled for review on a spaced-repetition ladder.
The review screen shows what is overdue, what keeps being got wrong despite
repeated exposure, and the mistakes that keep coming back — and picks the kind
of practice from how well each word is known. A word seen twice is offered for
recognition; a word half-known is asked to be recalled; a word well-known is
asked to be used in a sentence.

> `learning/review.ts`, `learning/vocabulary-engine.ts`, `app/(app)/review/`

### 6b. Finding a scenario to practise

The Scenarios room holds a second corpus: fifty hand-authored practice items,
each one of exactly two types. A **dialogue** is a speaker-tagged German
script with English translations — fifteen of them, five per level across A1,
A2 and B2. A **comprehension** is a German passage paired with questions and
answers — thirty-five of them: reading texts, telephone menus and train
announcements.

A learner says what they want in their own words — "I want to practice
ordering food at a restaurant", "test my reading on daily routines" — and the
query is embedded (through the gateway, ledgered and cached like every other
model call) and matched against the corpus by vector similarity, filterable
to All, Dialogues or Comprehensions. Browsing without a search costs no model
call at all: the whole corpus is one page.

What a card offers is decided by its type, which is the point of the type. A
dialogue's one action is **Practice Dialogue (AI Chat)**: it opens a roleplay
thread named after the scenario, and the scene's opening line arrives as the
partner's first message — assembled from the scenario's own data and visible
in the transcript, so the roleplay needs no hidden instruction and the
learner sees exactly what the tutor was given. A comprehension's one action
is **Read & Answer Questions**: the passage with its questions, graded by a
normalized string check in the browser — generous by design, showing the
model answer to compare against rather than ever saying "wrong", because
free-form German has too many right phrasings for a string compare to judge.
Reading practice therefore costs nothing per attempt.

Every result cites its source. A card, its detail page and the API response
all carry which dataset document the item was parsed from and where in it —
"Conversational German: 15 Dialogue Stories, item 1" — so retrieved content
never appears from nowhere. The whole pipeline is drawn in
[How the pieces work §1](topics.md#the-pipeline-drawn).

> `app/(app)/scenarios/`, `lib/api/scenarios.ts`, `lib/scenarios/`,
> `repositories/scenario-repository.ts`, `scripts/scenarios/`

### 6c. Practising with the Trainer

The Trainer (`/trainer`) is a workout where the chat is a conversation: a
**LangChain agent** that runs the review session the review page only lists.
Say *"Lass uns üben!"* and it looks up what is due, quizzes one item at a
time, judges the answer itself, and records the outcome — through the same
deterministic vocabulary engine a chat turn uses, so the model judges and the
arithmetic schedules. It can also open the grammar catalogue, search the
corpus (with the sources cited in the reply), fetch today's headlines from
nachrichtenleicht.de as simple-German reading, and borrow tools from a
configured remote MCP server, whose output is always fenced as untrusted.

Every answer arrives with its receipts: the list of tools the agent used and
the sources it read, because an agent that shows its work is the difference
between an answer and an assertion. The loop is bounded three ways — a hard
step cap, a per-request euro ceiling enforced from inside the model's ledger
callback, and a fail-closed budget check before the first call — and each
model invocation writes its own ledger row under the `trainer.session` task,
so the cost dashboard sees the Trainer like everything else. The rate limit
is half of chat's, because one request here is up to seven model calls.

> `lib/trainer/`, `lib/api/trainer.ts`, `lib/ai/gateway/langchain-model.ts`,
> `app/(app)/trainer/`

### 7. Seeing progress

One screen: which mini-level, the score that gates it, what each band amounts
to so far, how the three skill estimates are moving, vocabulary, the mistakes
worth watching, recent conversations, and one thing to do next.

The first number is the mastery gate itself, stated as the rule it is: what
share of the evaluated turns at this level were error-free, against the 80%
mark that moves a learner up. Below it, a card per band — A1, A2, B1 — whose
score is **the average of that band's practised mini-level scores**, with the
coverage printed beside it ("across 3 of 15 mini-levels"), because one strong
level must not pose as a finished band. The averaging is pure arithmetic over
stored tallies; no model is anywhere near a score.

Mistakes are shown at any occurrence count, counted honestly beside each
pattern — the earlier three-occurrence threshold meant a young account with
thirty-eight recorded mistakes saw an empty list and concluded nothing worked.
Each one is headlined by its category in plain English ("The dative case",
"Word choice") from a closed set, and the evaluator is instructed — through
the output contract, which is generated from the domain schema — to write the
explanation itself in English, because it is dashboard copy for an English
speaker. Rows recorded before that instruction keep their original wording
under an English headline.

The "one thing to do next" is a scoring function over the learner's own record —
overdue reviews weigh most, then unresolved mistakes, then level fit, then their
stated interests, minus a penalty for having just suggested the same thing. It
is deterministic on purpose: a recommendation a learner cannot predict is a
recommendation they stop trusting, and it is also the cheapest thing in the
product to compute.

> `lib/dashboard/summary.ts`, `learning/recommendation-ranking.ts`

### 8. Changing how you are taught

[`/settings`](../app/(app)/settings/) holds everything the tutor is told about
a learner, editable in one place: the learning goal, how corrections should
arrive, topics and interests, whether they prefer typing or speaking, and
which voice — male or female — reads replies aloud. The choice steers both
speech engines (the provider's voice and the browser's), and the tutor stays
Jonas either way; only the sound changes. The
values are the onboarding answers, and they stay closed sets with caps for the
same reason they were at onboarding — each one becomes prompt content and a
retrieval filter on every turn.

What settings deliberately does not hold: the level. The level is position,
not preference, and it moves on the curriculum page where moving means
something. The page says so and points there.

> `lib/settings/input.ts`, `app/(app)/settings/`

### 9. Watching what it costs (operators only)

A separate screen at `/operations/costs`, behind an explicit allowlist
(`OPERATOR_USER_IDS` in the environment), showing euro spend over the last 24
hours broken down by task and by the model actually routed to, plus alerts at
70%, 90% and 100% of the daily budget. It carries no conversation content and
no identifying field, because the ledger it reads never held any.

Operators also get a link to it from Settings; everyone else gets no hint the
room exists — the route answers 404, not 403, to anyone off the list.

> `app/(app)/operations/costs/`, `lib/dashboard/costs.ts`, `lib/auth/operator.ts`

---

## The turn

What happens between pressing Send and the reply appearing.

```
POST /api/chat
  │
  ├─ authenticate ......... from a verified session cookie, never the body
  ├─ rate limit ........... 20 messages a minute, keyed on a pseudonym
  ├─ validate ............. thread id, message, and the client's own recent
  │                          transcript (at most 8 lines, speaking roles only)
  │
  ▼
runTurn()                                        ── lib/graph/turn.ts
  │
  ├─ 1. load state ........ profile, level, mini-level, due words,
  │                          recurring mistakes                  (2 reads)
  ├─ 2. verify thread ..... the thread exists for this learner, or 404
  ├─ 3. return to the place a fresh visit to a thread stands the learner
  │                          back at the mini-level it was opened at
  ├─ 4. advance if asked .. "weiter" moves them one level — recorded as
  │                          mastered when the tally shows the gate open
  │                          (5+ evaluated turns, 4 in 5 error-free),
  │                          as skipped otherwise — pure arithmetic
  ├─ 5. retrieve .......... embed the question, search the corpus two ways,
  │                          fuse, rank for this learner, take the top 5
  ├─ 6. generate .......... assemble the prompt, dispatch, stream
  │                                                     ══ learner sees text
  ├─ 7. evaluate .......... score the learner's message on a cheaper model
  ├─ 8. persist evaluation  record errors, nudge the skill scores
  ├─ 9. record vocabulary . move each observed word's mastery and review date
  └─ 10. record performance one more line in the level's tally: evaluated,
                             error-free or not — and never a word of content
```

**Steps 1 to 6 are what the learner waits for.** Four database reads and one
retrieval, then the first words arrive.

**Steps 7 to 10 run after the stream ends.** The learner is not waiting, which is
what makes it affordable to evaluate their German properly on a second model
rather than asking the conversation model to do both jobs at once.

### The conversation itself is never stored

There is no step that saves a message, and no table one could be saved to:
the transcript lives in the learner's browser, is resent with each turn as
context, and dies with the tab. What the product keeps is what the practice
*meant* — recorded mistakes, skill estimates, and the per-level tally that
gates advancement. Going back to a thread means going back to the place, not
the words — and the place is enforced: a thread carries the mini-level it was
opened at, and the first message of a fresh visit (an empty history is the
mark of one) stands the learner back on it. A learner at mini-level 5 who
reopens their mini-level 1 conversation is taught level 1 in it.

### Every node degrades except two

If retrieval is down, the reply is thinner and still arrives. If the mastery
tally cannot be read, nobody moves and the tutor still replies. If evaluation
fails, nothing is written and the learner's stored progress simply stands.

The two exceptions: loading the learner (without a level there is no behaviour
policy, no token budget and no curriculum) and verifying the thread (a request
nothing authorized is not a turn).

### What the tutor is actually sent

The prompt is assembled from twelve possible blocks in a fixed order:

```
identity · safety · data boundary        ← identical every turn, so a provider
                                            can cache them
behaviour · correction · response policy ← from the learner's level
learner state                            ← their level, this level's words and
                                            grammar, what is due, what they
                                            keep getting wrong
thread summary · retrieved knowledge
· memories · recent messages             ← fenced as data, never instruction
user message                             ← what they just wrote
```

If the total is over the level's token ceiling, context is dropped in a fixed
order — oldest messages first, then the least relevant retrieved chunk, then
the least important memory, and the thread summary last. The policy, the
learner's state and the current message are never dropped. If it still does not
fit, the call is refused rather than sent for the provider to truncate
somewhere of its own choosing.

> `lib/ai/prompts/`

### What the evaluation does with the answer

A second, cheaper model reads the learner's message and returns a structured
object: an estimated level and how confident it is, the words and patterns it
saw used, the mistakes it found against a closed eighteen-category taxonomy, and
four skill scores.

That object is validated. If one error entry is malformed, that entry is dropped
and the rest is kept. If a score is 1.2, it is read as 1.0. If the **level** or
the **skill scores** cannot be read, the whole evaluation is discarded — both
are written into learner state and both move a learner through the curriculum,
so a guessed value is worse than no evaluation at all.

One repair retry, then silence.

Skill scores move 15% of the way towards what was observed, never all the way:
one message is weak evidence. The estimated level only moves when the evaluation
is confident about it. The **mini-level never moves here at all** — that is
earned against the level's own mastery criteria by the progression engine.

> `lib/ai/evaluation/`, `lib/graph/nodes.ts`

---

## Where the knowledge comes from

The tutor's factual grounding is a corpus of **234 documents and 599 chunks**.

Most of it is generated from content this repository already owns: the seventy
mini-levels, the 86 grammar patterns and the 420 dictionary entries, rendered
into prose. That makes it licence-clean and impossible to drift from the
structured tables it is generated from.

The rest is hand-written prose in [`content/`](../content/) for the things a
lookup table cannot express — how *siezen* and *duzen* actually work at a German
workplace, what counts as late, a dialogue at the doctor's, how to disagree
politely.

`pnpm ingest` cleans it, normalises it, chunks it by content type, embeds it and
stores it. Running it twice does nothing the second time.

> `lib/ingestion/`, `content/`

## What is deliberately not a model call

- which mini-level a learner is on
- whether they have earned the next one
- whether a message was asking to move on to the next one
- mastery scores and review scheduling
- which activity to recommend
- how the tutor should behave at each level
- which kind of question this is, in the common cases

All of these are pure functions over data the database already holds. They are
cheaper, faster, reproducible, and explainable to a learner without asking a
model to justify itself.
