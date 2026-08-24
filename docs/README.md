# Deutsch Partner — documentation

Four documents, written to be read in this order.

| Document | What it answers |
| --- | --- |
| [Product flow](product-flow.md) | What a learner does, and what happens when they do it |
| [Architecture](architecture.md) | How the code is laid out and why the boundaries are where they are |
| [How the pieces work](topics.md) | Plain-language explanations of RAG, prompting, vector search, Next.js, and the rest |
| [Operations](operations.md) | Running it: environment, ingestion, cost, and what to check when something breaks |

The specification documents this was built against live in
[`.claude/docs/`](../.claude/docs/). They are the source of the rules; these
four describe what was actually built.

## The short version

Deutsch Partner is a German conversation tutor for English speakers, from
absolute beginner to B1. A learner talks to it in German; it replies at their
level, corrects them in the way their level can use, and quietly keeps track of
what they know.

Three things shape almost every decision in the codebase:

**A tutor that costs more per learner than it earns is not a product.** Every
model call is routed to the cheapest tier that can do the job, capped in tokens
before it is sent, and written to a ledger in euro. A typical learner turn costs
about €0.0064.

**The model is not the curriculum.** Seventy mini-levels, 420 words and 86
grammar patterns are hand-authored data. What a learner is taught next is
arithmetic over their own record, not a model's opinion.

**Model output is never trusted.** Every structured reply is validated, and the
safe answer when it cannot be is to write nothing.
