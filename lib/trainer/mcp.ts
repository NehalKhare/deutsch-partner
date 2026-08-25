import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

import { wrapUntrusted } from "@/lib/ai/prompts/delimiters";
import { truncateToTokens } from "@/lib/ai/prompts/tokens";
import { nullLogger, type Logger } from "@/lib/observability/logger";
import type { AppEnv } from "@/lib/env/schema";

/**
 * Tools borrowed from a remote MCP server, fenced.
 *
 * The server is configuration (MCP_SERVER_URL — DeepWiki by recommendation,
 * anything streamable-HTTP by choice), and its absence is a thinner trainer,
 * never an error. Its presence is a third party inside the conversation, so
 * two rules hold without exception:
 *
 *   - whatever a remote tool returns is untrusted data. It is truncated and
 *     fenced with wrapUntrusted before the model reads it, the same as a
 *     retrieved chunk — a remote server's text never gets to sound like
 *     policy (guardrails S10/S31).
 *   - every remote call is audit-logged by name, never by content (S24).
 *
 * The API key, when a server wants one, travels as a bearer header rather
 * than in the URL, where it would reach request logs.
 */

export interface McpToolset {
  readonly tools: StructuredToolInterface[];
  readonly close: () => Promise<void>;
}

export const NO_MCP: McpToolset = {
  tools: [],
  close: async () => undefined,
};

/** How much remote text one tool call may hand the model. */
const MAX_MCP_TOKENS = 1200;

type AuditFn = (toolName: string) => void;

/** MCP content blocks arrive in several shapes; all of them become one string. */
function asText(result: unknown): string {
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    return result
      .map((block) =>
        typeof block === "string"
          ? block
          : typeof (block as { text?: unknown }).text === "string"
            ? (block as { text: string }).text
            : JSON.stringify(block),
      )
      .join("\n");
  }
  return JSON.stringify(result ?? null);
}

/**
 * The fence around one remote tool. Exported for tests: the wrapper is where
 * the security property lives, and it must hold for any inner tool.
 */
export function fenceMcpTool(
  inner: StructuredToolInterface,
  audit: AuditFn,
): StructuredToolInterface {
  return tool(
    async (args: unknown) => {
      audit(inner.name);
      try {
        const result = await inner.invoke(args as never);
        return wrapUntrusted(
          "mcp_results",
          truncateToTokens(asText(result), MAX_MCP_TOKENS),
        );
      } catch {
        return JSON.stringify({ error: "unavailable" });
      }
    },
    {
      name: inner.name,
      description: inner.description,
      schema: inner.schema,
    },
  ) as StructuredToolInterface;
}

export async function loadMcpTools(
  env: AppEnv,
  identity: { readonly requestId: string; readonly userIdHash: string },
  logger: Logger = nullLogger,
): Promise<McpToolset> {
  if (env.MCP_SERVER_URL === undefined) return NO_MCP;

  const client = new MultiServerMCPClient({
    mcpServers: {
      remote: {
        transport: "http",
        url: env.MCP_SERVER_URL,
        headers: env.MCP_SERVER_API_KEY
          ? { Authorization: `Bearer ${env.MCP_SERVER_API_KEY}` }
          : undefined,
      },
    },
  });

  try {
    const tools = await client.getTools();
    logger.info("trainer.mcp_connected", {
      requestId: identity.requestId,
      toolCount: tools.length,
    });

    const audit: AuditFn = (toolName) =>
      logger.info("trainer.tool_used", {
        audit: true,
        tool: `mcp:${toolName}`,
        requestId: identity.requestId,
        userIdHash: identity.userIdHash,
      });

    return {
      tools: tools.map((inner) => fenceMcpTool(inner, audit)),
      close: async () => {
        try {
          await client.close();
        } catch {
          // A connection that will not close cleanly is the server's problem.
        }
      },
    };
  } catch {
    // A remote server that is down makes a thinner trainer, not a failed one.
    logger.warn("trainer.mcp_unavailable", { requestId: identity.requestId });
    await client.close().catch(() => undefined);
    return NO_MCP;
  }
}
