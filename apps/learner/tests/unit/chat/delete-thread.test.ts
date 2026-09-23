import { describe, expect, it } from "vitest";

import {
  DELETE_THREAD_MESSAGES,
  INITIAL_DELETE_THREAD_STATE,
  deleteThreadError,
  parseDeleteThreadForm,
} from "@/lib/chat/delete-thread";

/** A form's worth of fields, as a browser would submit them. */
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const THREAD_ID = "1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b";

describe("what a delete request may say", () => {
  it("accepts a thread id and nothing else", () => {
    expect(parseDeleteThreadForm(form({ threadId: THREAD_ID }))).toEqual({
      success: true,
      threadId: THREAD_ID,
    });
  });

  it("takes nothing from a body that tries to name a learner", () => {
    // The owner comes from the session and from Row Level Security. A field
    // that could name one would be an authorisation bypass shaped like a form,
    // so the parser reads the one key it wants rather than trusting the body:
    // an extra field is not rejected, it is never looked at.
    expect(
      parseDeleteThreadForm(
        form({ threadId: THREAD_ID, learnerId: "somebody-else" }),
      ),
    ).toEqual({ success: true, threadId: THREAD_ID });
  });

  it.each([
    ["nothing at all", {}],
    ["an empty id", { threadId: "" }],
    ["something that is not an id", { threadId: "../../etc/passwd" }],
    ["a number", { threadId: "42" }],
    ["a list of ids", { threadId: `${THREAD_ID},${THREAD_ID}` }],
  ])("refuses %s", (_label, fields) => {
    expect(parseDeleteThreadForm(form(fields)).success).toBe(false);
  });
});

describe("what a learner is told", () => {
  it("says the same thing whether the thread was theirs or never existed", () => {
    // Row Level Security already makes the two indistinguishable. Wording them
    // differently would hand back exactly what it withholds.
    expect(deleteThreadError("not_found").message).not.toMatch(
      /permission|forbidden|not yours|another|someone|somebody|else|access/i,
    );
  });

  it("never names a table, a policy or a database", () => {
    for (const message of Object.values(DELETE_THREAD_MESSAGES)) {
      expect(message).not.toMatch(
        /postgres|supabase|rls|policy|row level|zod|constraint|sql/i,
      );
    }
  });

  it("starts with nothing to announce", () => {
    expect(INITIAL_DELETE_THREAD_STATE).toEqual({ message: null, status: "idle" });
  });

  it("marks a failure as one, so the row can show it", () => {
    expect(deleteThreadError("unavailable")).toEqual({
      status: "error",
      message: DELETE_THREAD_MESSAGES.unavailable,
    });
  });
});
