You are the principal product architect, AI architect, learning-science designer, and senior TypeScript engineer responsible for designing a production-quality application called "Deutsch Partner".

==================================================
1. BUSINESS OBJECTIVE
==================================================

Build an AI-powered German-learning web application for English-speaking learners.

The core product is an AI German conversation partner that helps a learner progress from absolute beginner through an application-defined B1 learning path.

The product should NOT feel like:

"ChatGPT with a German-learning system prompt."

It should feel like:

"Duolingo-style progression + personalized AI tutor + conversation partner + long-term memory + adaptive curriculum."

The learner is the stateful object.

The conversation is only one interaction with that learner.

The application should continuously understand:

- what the learner knows
- what they do not know
- what they repeatedly get wrong
- what vocabulary they have encountered
- what vocabulary they have mastered
- which grammatical patterns they can use
- what topics they enjoy
- what level they can actually operate at
- how much support they currently need

==================================================
2. PEDAGOGICAL MODEL
==================================================

The product uses three cognitive/behavioral phases.

A1:
Associative mimicry

A2:
Pattern recognition

B1:
Abstract reasoning and independent communication

The application uses these approximate progression targets:

A1:
15 mini-levels
approximately 500 cumulative core words

A2:
20 additional mini-levels
35 cumulative mini-levels
approximately 1,200 cumulative words

B1:
35 additional mini-levels
70 cumulative mini-levels
approximately 2,400 cumulative words

IMPORTANT:

These word counts are product targets and must NOT be presented as official CEFR requirements.

The application should use these as a pedagogical progression model.

==================================================
3. MINI-LEVEL MODEL
==================================================

Do not make all 70 levels simply "more vocabulary."

Progression should represent changes in the type of thinking.

A1

Mini-levels 1-5:
Naming, recognition, association

Mini-levels 6-10:
Imitation and repetition

Mini-levels 11-15:
Simple combinations and basic interaction

A2

Mini-levels 16-20:
Daily routines and practical language

Mini-levels 21-25:
Pattern variation

Mini-levels 26-30:
Narration and describing experiences

Mini-levels 31-35:
Practical conversational independence

B1

Mini-levels 36-45:
Explanation and description

Mini-levels 46-55:
Opinions, reasons, comparisons

Mini-levels 56-65:
Storytelling, hypothetical situations, abstract discussion

Mini-levels 66-70:
Independent conversation and reasoning

Each mini-level must contain:

- theme
- CEFR level
- target vocabulary
- target grammar patterns
- conversation functions
- comprehension goals
- production goals
- mastery criteria
- review requirements
- recommended activities

==================================================
4. AI PERSONALITY BY LEVEL
==================================================

A1:

The AI behaves like a supportive parent helping a child discover language.

Priorities:

- imitation
- repetition
- simple associations
- very short sentences
- concrete language
- high comprehension
- low cognitive load
- gentle reformulation
- very little grammar jargon
- frequent but non-repetitive encouragement
- English assistance when needed

A2:

The AI behaves like a kind teacher.

Priorities:

- pattern recognition
- controlled variation
- practical conversation
- brief grammar explanations
- deliberate correction
- vocabulary recycling
- roleplay
- increasing independence

B1:

The AI behaves like a German-speaking friend.

Priorities:

- natural conversation
- opinions
- reasoning
- storytelling
- problem solving
- follow-up questions
- less scaffolding
- selective correction
- natural alternatives
- occasional idiomatic language

This MUST be implemented as a configurable behavioral policy rather than three independent agents.

==================================================
5. LEARNER STATE IS THE CORE DOMAIN OBJECT
==================================================

Do not model the system as:

User -> Chatbot

Model it as:

Learner
|
+-- CEFR level
+-- mini-level
+-- estimated level
+-- effective level
+-- vocabulary mastery
+-- grammar mastery
+-- fluency
+-- comprehension
+-- confidence
+-- recurring errors
+-- interests
+-- goals
+-- memories
+-- review schedule
+-- conversation history
+-- current recommendations

Each conversation updates learner state.

Each recommendation is generated from learner state.

Each retrieval request is filtered by learner state.

Each response is generated using learner state.

==================================================
6. SELECTED VS ESTIMATED VS EFFECTIVE LEVEL
==================================================

Maintain:

selected_level
estimated_level
effective_level

Example:

selected_level = B1
estimated_level = A2
effective_level = A2+

Do not silently override the user's selection.

Use the selected level as a preference and the estimated level as evidence.

The effective level should determine conversational complexity.

==================================================
7. DIFFICULTY MODEL
==================================================

Maintain a difficulty band instead of treating CEFR as binary.

Target approximately:

80% comprehensible material
20% growth/challenge material

Do not maximize difficulty.

The goal is comprehensible progression.

==================================================
8. VOCABULARY MODEL
==================================================

Use structured PostgreSQL tables for vocabulary.

Do NOT put all vocabulary knowledge solely into RAG.

Vocabulary must have structured fields:

- lemma
- word
- part of speech
- gender
- plural
- English translation
- German definition
- example
- collocations
- common mistakes
- CEFR
- mini-level
- topic
- frequency band
- core-word flag

Track learner-specific state:

- exposure count
- correct count
- incorrect count
- mastery score
- confidence
- last seen
- next review
- status

Statuses:

new
introduced
learning
familiar
mastered
weak

Repeated exposure does not automatically mean mastery.

==================================================
9. GRAMMAR MODEL
==================================================

Use structured grammar entities for important grammar patterns.

Examples:

- main clause word order
- articles
- gender
- nominative
- accusative
- dative
- modal verbs
- separable verbs
- Perfekt
- subordinate clauses
- weil
- dass
- wenn
- relative clauses
- prepositions
- reflexive verbs
- adjective endings

Each grammar pattern must have:

- explanation
- examples
- CEFR
- mini-level
- difficulty
- common mistakes
- related patterns

==================================================
10. RAG MODEL
==================================================

RAG is NOT the entire learning system.

Use:

STRUCTURED DATABASE FOR:

- vocabulary
- grammar
- learner state
- errors
- assessments
- mini-level definitions
- review scheduling
- recommendations

VECTOR DATABASE FOR:

- explanations
- example dialogues
- sentence patterns
- authentic dialogue snippets
- cultural notes
- mistake explanations
- contextual examples
- pedagogical documents
- long-form learning content

==================================================
11. RAG DATASETS
==================================================

Create these datasets:

1. CEFR curriculum
2. core vocabulary
3. sentence patterns
4. grammar explanations
5. everyday situations
6. conversation functions
7. cultural context
8. curated dialogues
9. learner mistake patterns

Use metadata such as:

- CEFR
- mini-level
- topic
- skill
- grammar target
- content type
- language
- difficulty
- source
- license
- attribution

==================================================
12. CHUNKING STRATEGY
==================================================

Do not use one chunk size for everything.

Use semantic chunks.

Grammar:
approximately 300-700 tokens

Dialogues:
approximately 150-500 tokens

Sentence patterns:
one pattern or a tightly related group

Vocabulary:
one conceptual unit per chunk where vector retrieval is useful

Cultural notes:
approximately 250-600 tokens

Preserve metadata on every chunk.

==================================================
13. VECTOR DATABASE
==================================================

Use:

- Supabase
- PostgreSQL
- pgvector
- cosine similarity
- HNSW indexing

Use vector embeddings behind an abstraction.

Default embedding:

text-embedding-3-small

Start with the documented 1536-dimensional configuration, but make the embedding provider and dimension configurable.

CORRECTION:

Embeddings do NOT go through OpenRouter, which serves chat/completion only.
The embedding provider is called directly behind EmbeddingProvider.

Cache embeddings by content hash. Never re-embed unchanged text. Embedding
re-computation during ingestion is one of the easiest costs to eliminate
entirely.

See model-routing-and-cost-control.md S2.

==================================================
14. RETRIEVAL ARCHITECTURE
==================================================

Do not retrieve based solely on the raw user sentence.

Create learner-aware retrieval context:

- current CEFR
- mini-level
- topic
- skill
- weak grammar
- recurring mistakes
- target vocabulary
- current lesson target

Retrieval pipeline:

User input
|
+-- semantic retrieval
+-- keyword/full-text retrieval
+-- metadata filtering
+-- learner-state filtering
|
v
candidate documents
|
v
optional reranking
|
v
top relevant chunks

Start simple:

vector + metadata filters

Then add:

hybrid retrieval

Then:

reranking

Then:

query rewriting where evidence shows it helps.

Do not over-engineer retrieval on day one.

==================================================
15. RETRIEVAL ROUTING
==================================================

Different questions should retrieve differently.

Example:

"What does trotzdem mean?"

=> vocabulary retrieval

"Why is it mit dem Zug?"

=> grammar retrieval

"Let's talk about my weekend."

=> conversation/dialogue retrieval

"How do Germans normally greet a new colleague?"

=> culture retrieval

Current/fresh facts:

=> web search

Ordinary German language questions:

=> internal knowledge base

==================================================
16. AGENT ARCHITECTURE
==================================================

Use a modular monolith.

Do NOT build microservices initially.

Architecture:

Next.js
+
LangChain / LangGraph
+
Supabase

Use explicit orchestration.

Preferred state machine:

START
|
v
authenticate
|
v
load learner state
|
v
load recent conversation
|
v
load thread summary
|
v
load relevant memories
|
v
build retrieval context
|
v
retrieve knowledge
|
v
evaluate learner input
|
v
select behavioral policy
|
v
generate response
|
v
stream response
|
v
persist message
|
v
persist learning signals
|
v
update learner state
|
v
END

Do not create a multi-agent swarm unless later evaluation demonstrates a measurable reason to do so.

MODEL SELECTION:

The nodes in this graph do NOT all use the same model. Response generation uses
a strong model; evaluation uses a mid model; classification, extraction, and
summarization use cheap or nano models; recommendation ranking uses no model at
all.

Every node that calls a model does so through ModelGateway with a declared task,
tier, and hard token ceiling. See model-routing-and-cost-control.md S4.

==================================================
17. CONVERSATION RESPONSE VS EVALUATION
==================================================

Separate:

conversation generation

from:

learning evaluation

The learner should receive a fast natural response.

Evaluation can happen as a second model operation or structured processing step.

This separation is also the single largest cost lever in the application. The
conversation turn needs a strong model; evaluation is schema-constrained and
runs well on a mid-tier model. Merging them forces every evaluation token
through the expensive path. Keep them separate and run evaluation
asynchronously, after the response has streamed.

Evaluation should produce:

- estimated CEFR
- vocabulary used
- vocabulary weaknesses
- grammar patterns
- errors
- corrections
- skill estimates
- mastery signals
- review candidates
- recommendation signals

==================================================
18. CONVERSATION MEMORY
==================================================

Do not send the entire conversation to the model forever.

Use:

- recent messages
- thread summary
- relevant learner memories
- relevant RAG
- structured learner state

Long-term memories may include:

- interests
- goals
- recurring errors
- preferences
- achievements
- useful conversation facts

Do NOT save every user sentence as memory.

==================================================
19. THREADS
==================================================

Persist conversation threads.

Each thread should have:

- title
- topic
- CEFR
- mini-level
- mode
- created_at
- updated_at
- summary

Each message should have:

- role
- content
- input mode
- language
- transcription if voice
- correction metadata
- timestamp

==================================================
20. CONVERSATION MODES
==================================================

Support:

- free chat
- roleplay
- travel
- daily life
- work
- hobbies
- storytelling
- opinions
- problem solving
- grammar practice
- vocabulary practice
- review
- assessment

The recommendation engine should choose activities based on:

learning need
+
interest
+
level
+
recent exposure
+
review due

==================================================
20.5 LEARNING COMPANION
==================================================

A single character that represents the learner's progress and reacts to the
conversation. It is the emotional counterpart to the numbers on the dashboard.

Domain model (implemented in domain/companion.ts):

three emotions:

  smiling     at rest, and while the companion is speaking
  listening   while the learner is speaking
  sad         while the learner is struggling

growth:

  five discrete stages across the 70 mini-levels, in equal bands of fourteen,
  plus a continuous 0-1 progress value for smooth scaling

  the companion is fully grown across the final stretch of B1, not for a single
  mini-level at the very end

animation:

  animates only while the companion itself is speaking

Rules:

Companion state is DERIVED from learner state. It is domain data, not view
state. The component renders what companionStateFor() returns and computes
nothing itself.

The companion never contradicts the dashboard. If the learner has not
progressed, it does not grow. It is a progress signal, so it has to be honest
to be worth anything.

Presentation is CSS-only: shape, eyes and mouth drawn with border-radius and
pseudo-elements, animated with keyframes. No animation library, no sprite
assets, no per-frame JavaScript.

Accessibility is part of the feature, not a follow-up:

  - respect prefers-reduced-motion; the companion holds a static pose
  - emotion is conveyed by an accessible label as well as by shape
  - the companion is decorative to screen readers when its state is already
    stated in text nearby

Build order: the domain model lands in Phase 1. The component lands with the
chat interface in Phase 15, and the growth display joins the dashboard in
Phase 17. Do not build the component before there is a conversation for it to
react to.

==================================================
21. REACT COMPILER
==================================================

Use React Compiler.

Treat React Compiler as part of the architecture.

Do NOT unnecessarily add:

- useMemo
- useCallback
- React.memo

for performance reasons alone.

Prefer idiomatic React and allow the compiler to optimize.

Use explicit memoization only when there is evidence from profiling or a specific semantic requirement.

Keep components compatible with the Rules of React.

Use the React compiler ESLint tooling.

Verify compiler behavior during development.

==================================================
22. VOICE
==================================================

Voice is an interface layer, not a separate learning system.

Pipeline:

microphone
|
v
speech-to-text
|
v
German transcript
|
v
learning evaluation
|
v
agent
|
+--> written German response
|
+--> text-to-speech

Always show:

- learner transcript
- AI written response

Make STT and TTS provider interfaces replaceable.

STT and TTS do NOT go through OpenRouter. They use dedicated providers called
directly behind SpeechToTextProvider and TextToSpeechProvider.

Audio is billed by duration, not tokens. Enforce a maximum audio length on
upload and a maximum synthesis length on output, and record duration-based cost
on the same usage ledger as token-based calls.

==================================================
23. ASSESSMENT
==================================================

Create:

- onboarding diagnostic
- mini-level checks
- periodic micro-assessments
- A1 milestone assessment
- A2 milestone assessment
- B1 readiness assessment

Never claim official Goethe certification.

Use wording such as:

"B1-oriented"
"B1 readiness estimate"
"application learning level"

==================================================
24. LEVEL ADVANCEMENT
==================================================

Do not advance based solely on conversation count.

Require evidence from multiple dimensions:

- vocabulary mastery
- grammar pattern usage
- conversation performance
- review performance
- comprehension
- sustained performance over multiple interactions

==================================================
25. RECOMMENDATION ENGINE
==================================================

Recommendations should be generated from:

learning need
+
relevance
+
interest
+
review due
+
appropriate difficulty

Avoid repeating the same recommendation too often.

Diversify activity types.

Ranking is a deterministic scoring function over learner state, not a model
call. It is cheaper, faster, reproducible, testable, and explainable to the
learner. See model-routing-and-cost-control.md S5.

==================================================
26. MVP PRIORITY
==================================================

Build the first vertical slice before advanced features.

The critical loop is:

User
|
v
Next.js chat
|
v
/api/chat
|
v
learner state
|
v
RAG
|
v
LangChain/LangGraph
|
v
stream response
|
v
save message
|
v
save learning signals
|
v
update learner state

Only after that should you build:

- voice
- advanced memory
- reranking
- advanced recommendation
- sophisticated assessment

==================================================
27. FINAL PRODUCT PRINCIPLE
==================================================

Optimize for:

learning outcome
+
natural conversation
+
response quality
+
latency
+
observability
+
security
+
maintainability
+
cost per learner

Cost is a product constraint, not an operational footnote. A tutor that costs
more per learner than it can earn is not a viable product, however good its
pedagogy.

Do not optimize for architectural complexity.

A simpler system that reliably adapts to the learner is better than a sophisticated agent system that does not.