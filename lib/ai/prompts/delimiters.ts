/**
 * Wrapping untrusted content.
 *
 * Retrieved chunks, stored memories, thread summaries and the learner's own
 * message are data. They arrive from outside the system's control and any of
 * them can carry text shaped like an instruction. Each is fenced in a named
 * delimiter, and the stable prefix tells the model that everything inside a
 * fence is reference material.
 *
 * This is a mitigation, not a boundary (guardrails S31). Nothing here decides
 * authorisation; the database does. What it does is stop a retrieved chunk
 * from closing its own fence and continuing as though it were policy.
 */

export const UNTRUSTED_TAGS = [
  "thread_summary",
  "retrieved_knowledge",
  "learner_memory",
  "recent_messages",
  "user_message",
  // The Trainer's two windows on the outside world: whatever a remote MCP
  // server returns, and the fetched simple-German news. Both are third-party
  // text and neither gets to sound like policy.
  "mcp_results",
  "german_news",
  // The answer analyzer's verdict, injected into the Trainer's turn. Machine
  // output about learner text: validated JSON, but it quotes the learner's own
  // German verbatim, so it rides inside a fence like everything else that does.
  "answer_analysis",
  // The product-ops agents' windows on the outside world: what a web search
  // returned, what an earlier stage stored, what a repository file says, and
  // what a compiler or test run printed. A comment in a source file can say
  // "ignore all previous instructions" as easily as a web page can, and a
  // failing test quotes that file back.
  "web_results",
  "market_research",
  "repo_source",
  "command_output",
  "tool_result",
] as const;

export type UntrustedTag = (typeof UNTRUSTED_TAGS)[number];

/**
 * Neutralises any delimiter-shaped text in the content.
 *
 * Every angle bracket is replaced, not just the matching closing tag. A chunk
 * containing </user_message> inside a <retrieved_knowledge> fence would be
 * just as effective at confusing the boundary, and inventing a new tag is
 * free for an attacker.
 */
export function escapeUntrusted(content: string): string {
  return content.replaceAll("<", "‹").replaceAll(">", "›");
}

export function wrapUntrusted(tag: UntrustedTag, content: string): string {
  return `<${tag}>\n${escapeUntrusted(content)}\n</${tag}>`;
}
