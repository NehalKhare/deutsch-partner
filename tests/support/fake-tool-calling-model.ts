import {
  BaseChatModel,
  type BaseChatModelCallOptions,
} from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

/**
 * A chat model whose replies are a script.
 *
 * LangChain's own FakeListChatModel speaks strings only, and an agent test
 * needs a model that emits tool_calls — so this one shifts through a list of
 * prepared AIMessages: some carrying tool_calls (the loop executes the tool
 * and comes back), the last carrying plain text (the loop ends). No network,
 * no tokens, no cost.
 */
export class FakeToolCallingModel extends BaseChatModel<BaseChatModelCallOptions> {
  invocations = 0;
  /** What the model was shown on each invocation, for assertions. */
  readonly seen: BaseMessage[][] = [];

  private readonly script: AIMessage[];

  constructor(script: readonly AIMessage[]) {
    super({});
    this.script = [...script];
  }

  _llmType(): string {
    return "fake-tool-calling";
  }

  /** The agent binds its tools; the script does not care. */
  override bindTools(): this {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.invocations += 1;
    this.seen.push(messages);

    // A script that runs out keeps calling the first tool it knows nothing
    // about — the shape of a runaway loop, which is exactly what the
    // recursion-limit test wants to provoke. An empty-script fake loops.
    const message =
      this.script.shift() ??
      new AIMessage({
        content: "",
        tool_calls: [
          { name: "get_progress", args: {}, id: `loop-${this.invocations}`, type: "tool_call" },
        ],
      });

    return {
      generations: [
        {
          message,
          text: typeof message.content === "string" ? message.content : "",
        },
      ],
    };
  }
}

/**
 * A model OpenRouter will not serve: every call fails the way the provider
 * refuses a model the account's data policy leaves without an endpoint —
 * a 404 carrying its status, which is what the agent's ladder keys on.
 */
export class UnavailableModel extends BaseChatModel<BaseChatModelCallOptions> {
  invocations = 0;

  constructor() {
    super({});
  }

  _llmType(): string {
    return "unavailable";
  }

  override bindTools(): this {
    return this;
  }

  async _generate(): Promise<ChatResult> {
    this.invocations += 1;
    throw Object.assign(new Error("404 No endpoints available"), {
      name: "NotFoundError",
      status: 404,
    });
  }
}

/** An assistant turn that calls one tool. */
export function toolCallMessage(
  name: string,
  args: Record<string, unknown>,
  id = `call-${name}`,
): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: [{ name, args, id, type: "tool_call" }],
  });
}
