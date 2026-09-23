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

> `components/voice/speech.ts`, `app/api/transcribe/`, `app/api/speak/`

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

> `packages/prompts/src/behavior-policy.ts`

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
Say *"Lass uns üben!"* and it opens with the **agenda** — the list of what
this sitting will cover, said out loud before the first question and shown
beside the transcript as a checklist that ticks off as the session goes. Then
it quizzes one item at a time, judges the answer itself, and records the
outcome — through the same deterministic vocabulary engine a chat turn uses,
so the model judges and the arithmetic schedules. It can also open the grammar
catalogue, search the corpus (with the sources cited in the reply), fetch
today's headlines from nachrichtenleicht.de as simple-German reading, and
borrow tools from a configured remote MCP server, whose output is always
fenced as untrusted.

**Nothing is asked twice.** Recording an outcome closes the item, and a closed
item is never offered again: the agenda tool hands the model the single next
subject rather than a list of questions, so a repeat is not something the
prompt asks it to avoid but something it is never given the chance to do. The
session's progress rides with the request the way the transcript does — the
client sends back the subjects already closed, as keys the server uses to
narrow the next agenda and never to build a prompt, so a tampered list can
only shorten someone's own practice.

**Every session ends on real German.** The last agenda item is not a drill:
the trainer fetches today's headlines from nachrichtenleicht.de, **retells one
at the learner's own level**, and asks — in German — what they think it is
about. They answer in their own words; the trainer says which parts they got
right, fills in what they missed, and gives the gist in one sentence. A learner
with nothing due still gets this, so a session is never empty.

Levelling it is arithmetic, not a model's judgement (`lib/trainer/news.ts`):
headlines are ordered shortest first, so the item the trainer reaches for is
the kind one, and each CEFR band carries a word budget for the retelling — six
words a sentence at A1, nine at A2, fourteen at B1. "Simple German" is still
one level, and it is not necessarily the learner's; an A1 reader three weeks in
meeting a B1 sentence is an A1 reader who stops reading. The instruction that
says so is trusted text wrapped *around* the fence; the headlines stay inside
it, reading material and never instructions.

**And it ends.** Work through the agenda and the tool answers
`sessionComplete` with a **recap** — every word covered and what it means,
read back out of the catalogue rather than out of the model's memory of the
conversation. That recap is the trainer's last reply: it says what to
remember and stops, the composer is replaced by *Start a new session*, and
the next sitting plans a fresh agenda from whatever is still due.

What was just practised is gone from `/review` as well. A correct answer
schedules the word a day or more out, which the due list already respects, and
the weak list — the one judgement that is allowed to run ahead of the schedule
— now leaves alone anything worked on in the last few hours
(`JUST_PRACTISED_HOURS`). A recurring mistake the learner fixes in the trainer
is marked resolved, so it stops being listed too, and comes back only if the
mistake itself does.

Every answer arrives with its receipts: the list of tools the agent used and
the sources it read, because an agent that shows its work is the difference
between an answer and an assertion. Replies can be **read aloud** here exactly
as they can in the chat — a speaker on each one, a toggle that reads each new
reply as it lands, the speech model first and this device's own voice as a
real fallback, at the learner's pace and in their chosen voice. A drill is no
less worth hearing than a conversation, and hearing *der Bahnhof* said is most
of what learning to say it is. The chain lives in one hook
(`components/voice/read-aloud.ts`) rather than in two copies of itself, because
the copy that drifted would be the one that quietly stopped falling back.

Two settings steer it and both are the learner's. *Replies should arrive as*
decides whether a session starts already reading aloud — a learner who asked
to be read to should not have to ask again on every page, and the toggle
remains as an override for the sitting. *Where the read-aloud voice comes
from* decides the chain: the device's own voice alone, or the speech model
first with the device as its fallback. A chosen device voice is never quietly
swapped for the model when it fails; that would be the setting lying about
what it does.

Replies are **formatted** rather than printed raw
(`lib/markdown/parse.ts`, `components/ui/rich-text.tsx`). Models emphasise the
word under discussion and number what they are about to cover whatever the
prompt asks of them, and unrendered that arrives as `**das Buch**` with a
six-item agenda flattened into one unskimmable paragraph. The subset is small
— emphasis, code, bullets, numbers — it is parsed into React elements rather
than into a string of HTML, so markup is not expressible rather than merely
escaped, and anything it does not recognise stays visible as the characters
the model typed. The same parser strips the notation before a voice reads the
line: asterisks are for the eye and have no business being pronounced. The loop is bounded three ways — a hard
step cap, a per-request euro ceiling enforced from inside the model's ledger
callback, and a fail-closed budget check before the first call — and each
model invocation writes its own ledger row under the `trainer.session` task,
so the cost dashboard sees the Trainer like everything else. The rate limit
is half of chat's, because one request here is up to seven model calls.

**It learns from you.** Under every reply sits a vote — *Was this helpful?* —
and behind *No* a short closed list of reasons: too long, too brief, too hard,
too easy, unclear, the correction was wrong, skip the news, plus an optional
line in the learner's own words. The reasons are the point. A bare thumbs-down
teaches the product nothing it can act on; *too long* moves a dial. The
learner can also just say it — *"kürzere Sitzungen, bitte"* — and the trainer
calls its `adjust_coaching` tool, which holds from the next reply on and across
every later session.

What it learns is kept as **dials**, not prose: how much a correction explains
(brief, standard, detailed), how far an exercise stretches (gentler, standard,
harder), how long a sitting runs (short plans five items instead of eight),
what the agenda leans towards (balanced, vocabulary, grammar) and whether it
ends on the news. Each is a closed set a database CHECK holds, and the rules
that move them are arithmetic in `lib/trainer/coaching.ts`: one reason moves
one dial one step, contradictory reasons on one vote cancel, the ends of a
scale hold. The learner judges and the code decides — the same split the
review engine makes — and no model gets a vote on what a vote means.

The dials change what the trainer *does*, not how hard it is asked to try.
The agenda is sized and mixed by them before the model sees it; the news item
is left off when asked; and a rendered block of standing instructions — one
trusted sentence per dial that has moved — rides behind the fixed prompt's
cache mark in the system message, so a learner who has never voted gets
exactly the prompt they always had. The one failure no dial fixes is a wrong
correction: those are counted, and past two the trainer is told to check the
rule with `get_grammar_pattern` or `search_knowledge` before it marks an
answer wrong. Helpful votes wind that counter back down, so a trainer that
recovered stops being told off. The learner's own notes — the newest three —
ride fenced as `<coaching_notes>`, a request about pace honoured and a request
to ignore the rules read as text.

The session shows what changed: the confirmation under the vote names the
dials that moved, and a *Tuned for you* line under the plan lists the trainer's
current settings in the same words the settings page uses. That page is the
door out (guardrails S15): it says what the trainer has learned and from how
many votes, and one button forgets all of it — the dials and every vote behind
them. What is stored is the vote, its reasons, the reply's tool receipt and
the note; never a line of the reply itself, because transcripts are ephemeral
by design and a feedback table that quoted them would be the transcript table
by another name.

**Its manner is the learner's to choose.** Settings offers two trainers —
*friendly*, warm and encouraging, the trainer as shipped; and *strict*,
exacting, naming every error and praising nothing routine — and the choice is
a column on the profile (`trainer_personality`), not a coaching dial: the
dials are what feedback taught the trainer and *Forget my feedback* wipes
them, whereas this is a choice made in so many words and survives that reset.
It changes manner only. The fixed prompt says so — a block headed *Your
manner* sets tone, praise and how a correction is put, and changes neither
what the session covers nor how an answer is judged — and each personality is
one templated paragraph in `packages/prompts/src/trainer.ts`, rendered per learner
behind the fixed prompt's cache mark ahead of the coaching block. The strict
trainer is still a coach: it is told never to mock or belittle, and a wrong
first answer still gets its hint and another chance.

The same votes reach the operator. The product-ops scans and runs page draws
the last thirty days of them — by reason, by trainer prompt version, by the tools a
reply used, with the newest notes — and every market scan records that
aggregate as its first finding, before it searches the web, so a proposal
weighs what this product's learners flagged against what forums say about
learners in general (`docs/product-ops-agents.md`, section 3).

> `lib/trainer/coaching.ts`, `domain/trainer-coaching.ts`,
> `lib/api/trainer-feedback.ts`, `components/trainer/feedback.tsx`,
> `apps/learner/components/settings/trainer-coaching.tsx`, `packages/product-ops/src/feedback.ts`

> `apps/learner/lib/trainer/`, `apps/learner/lib/api/trainer.ts`, `packages/gateway/src/langchain-model.ts`,
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

> `packages/prompts/src/`

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

> `apps/learner/lib/ai/evaluation/`, `lib/graph/nodes.ts`

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
