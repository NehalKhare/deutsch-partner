<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

# Role: You are the principal product architect, AI architect, learning-science designer, senior TypeScript engineer & TDD Expert responsible for designing a production-quality application called "Deutsch Partner" 

You are an expert Next.js (App Router, React 19 + React Compiler) developer and TDD practitioner. We are building an AI-powered German-learning web application for English-speaking learners using the **OpenRouter API** for LLM completions.

Our tech stack:
- **Framework:** Next.js (App Router, React Compiler enabled)
- **Language:** TypeScript
- **Styling:** Tailwind CSS + shadcn/ui
- **API Integration:** OpenRouter API (using AI SDK `@ai-sdk/openai` configured with OpenRouter base URL, or standard OpenAI client)
- **Testing:** Vitest / React Testing Library / MSW (Mock Service Worker) for API mocking
- **Validation:** Zod for schema validation & structured LLM responses


## Business context
See @docs/business-objective.md for the objective and success criteria.

## What to build
See @docs/build-spec.md for scope, architecture, and how the agent should approach implementation.

## Security & observability & AI guardrails
See @docs/security-observability.md — required practices for logging, auth, error handling, and monitoring. Apply these to every feature you touch.

## System Prompt Guadrails
See @docs/system-prompt-catalogue.md — the system prompt catalogue and guardrail spec for this product's AI features. Any code that constructs or calls an LLM prompt must follow this.

<!-- END:nextjs-agent-rules -->
