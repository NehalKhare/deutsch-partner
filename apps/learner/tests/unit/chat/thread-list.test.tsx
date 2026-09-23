import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ThreadList, type RecentThread } from "@/components/chat/thread-list";
import {
  DELETE_THREAD_MESSAGES,
  INITIAL_DELETE_THREAD_STATE,
  deleteThreadError,
  type DeleteThreadAction,
} from "@/lib/chat/delete-thread";

/**
 * Recent conversations, and the one destructive control in the product.
 *
 * Everything here is about the gap between meaning to delete and deleting: a
 * bare button beside a link is one slip away from losing a conversation that
 * cannot come back, and an undo would mean not really deleting it.
 */

const THREADS: readonly RecentThread[] = [
  { id: "1e2f0a4c-6b7d-4e8f-9a0b-1c2d3e4f5a6b", title: "Hallo und Tschüss" },
  { id: "2f3a1b5d-7c8e-4f9a-8b0c-2d3e4f5a6b7c", title: "Im Café bestellen" },
];

const noop: DeleteThreadAction = async () => INITIAL_DELETE_THREAD_STATE;

function renderList(action: DeleteThreadAction = noop) {
  return render(<ThreadList threads={THREADS} action={action} />);
}

/** The list-level announcement, which is the last status region on the page. */
function announcement(): HTMLElement {
  const regions = screen.getAllByRole("status");
  const last = regions[regions.length - 1];
  if (!last) throw new Error("there is no announcement region");
  return last;
}

/** The row a conversation lives in, found through its own link. */
function row(title: string): HTMLElement {
  const container = screen.getByRole("link", { name: title }).closest("li");
  if (!container) throw new Error(`"${title}" is not in a row`);
  return container;
}

describe("the list", () => {
  it("links to every conversation", () => {
    renderList();

    expect(screen.getByRole("link", { name: "Hallo und Tschüss" })).toHaveAttribute(
      "href",
      `/chat/${THREADS[0]?.id}`,
    );
    expect(screen.getAllByRole("link")).toHaveLength(THREADS.length);
  });

  it("names the conversation in its delete control", async () => {
    // Two buttons both called "Delete" are two buttons a screen-reader user
    // cannot tell apart, on the one control in the product that destroys data.
    renderList();

    expect(
      screen.getByRole("button", { name: /delete .*Hallo und Tschüss/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /delete .*Im Café bestellen/i }),
    ).toBeInTheDocument();
  });
});

describe("asking first", () => {
  it("does not delete on the first click", async () => {
    const action = vi.fn(noop);
    const user = userEvent.setup();
    renderList(action);

    await user.click(
      screen.getByRole("button", { name: /delete .*Hallo und Tschüss/i }),
    );

    expect(action).not.toHaveBeenCalled();
  });

  it("says the thing that cannot be undone, before it cannot be undone", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(
      screen.getByRole("button", { name: /delete .*Hallo und Tschüss/i }),
    );

    expect(
      within(row("Hallo und Tschüss")).getByText(/cannot be undone/i),
    ).toBeInTheDocument();
  });

  it("asks about one conversation at a time", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(
      screen.getByRole("button", { name: /delete .*Hallo und Tschüss/i }),
    );

    expect(
      within(row("Im Café bestellen")).queryByText(/cannot be undone/i),
    ).not.toBeInTheDocument();
  });

  it("puts the keyboard on the confirmation, not back at the start", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(
      screen.getByRole("button", { name: /delete .*Hallo und Tschüss/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /delete .*Hallo und Tschüss.*for good/i }),
      ).toHaveFocus();
    });
  });

  it("backs out and leaves the conversation alone", async () => {
    const action = vi.fn(noop);
    const user = userEvent.setup();
    renderList(action);

    await user.click(
      screen.getByRole("button", { name: /delete .*Hallo und Tschüss/i }),
    );
    await user.click(
      within(row("Hallo und Tschüss")).getByRole("button", { name: /keep it/i }),
    );

    expect(action).not.toHaveBeenCalled();
    expect(
      within(row("Hallo und Tschüss")).queryByText(/cannot be undone/i),
    ).not.toBeInTheDocument();
  });
});

describe("deleting", () => {
  it("sends the id of the conversation that was confirmed", async () => {
    const action = vi.fn(noop);
    const user = userEvent.setup();
    renderList(action);

    await user.click(
      screen.getByRole("button", { name: /delete .*Im Café bestellen/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /delete .*Im Café bestellen.*for good/i }),
    );

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action.mock.calls[0]?.[1].get("threadId")).toBe(THREADS[1]?.id);
  });

  it("announces a failure against the conversation it belongs to", async () => {
    const failing: DeleteThreadAction = async () => deleteThreadError("unavailable");
    const user = userEvent.setup();
    renderList(failing);

    await user.click(
      screen.getByRole("button", { name: /delete .*Hallo und Tschüss/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /delete .*Hallo und Tschüss.*for good/i }),
    );

    await waitFor(() => {
      expect(within(row("Hallo und Tschüss")).getByRole("status")).toHaveTextContent(
        DELETE_THREAD_MESSAGES.unavailable,
      );
    });
  });

  it("does not leave the confirmation open after a failure", async () => {
    // The row is still there and the learner may want to try again, but the
    // armed state is not somewhere to leave anybody standing.
    const failing: DeleteThreadAction = async () => deleteThreadError("not_found");
    const user = userEvent.setup();
    renderList(failing);

    await user.click(
      screen.getByRole("button", { name: /delete .*Hallo und Tschüss/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /delete .*Hallo und Tschüss.*for good/i }),
    );

    await waitFor(() => {
      expect(
        within(row("Hallo und Tschüss")).queryByText(/cannot be undone/i),
      ).not.toBeInTheDocument();
    });
  });
});

describe("after the server has removed it", () => {
  it("says which conversation went", () => {
    // The row that held the only per-row live region is the thing that just
    // disappeared, so the list has to be the one that speaks.
    const { rerender } = renderList();

    rerender(<ThreadList threads={[THREADS[1] as RecentThread]} action={noop} />);

    expect(announcement()).toHaveTextContent("Deleted “Hallo und Tschüss”.");
  });

  it("puts the keyboard somewhere, rather than dropping it on the document", async () => {
    const { rerender } = renderList();

    rerender(<ThreadList threads={[THREADS[1] as RecentThread]} action={noop} />);

    await waitFor(() => expect(announcement()).toHaveFocus());
  });

  it("still says which one went when it was the last one", () => {
    // The empty state lives inside this component precisely so that deleting
    // the last conversation does not unmount the thing saying so.
    const last = [THREADS[1] as RecentThread];
    const { rerender } = render(<ThreadList threads={last} action={noop} />);

    rerender(<ThreadList threads={[]} action={noop} />);

    expect(announcement()).toHaveTextContent("Deleted “Im Café bestellen”.");
  });

  it("counts them when a stale page loses more than one", () => {
    // Two tabs open, one of them deleting. Saying nothing here would be the
    // same silence the announcement exists to fix.
    const { rerender } = renderList();

    rerender(<ThreadList threads={[]} action={noop} />);

    expect(announcement()).toHaveTextContent("Deleted 2 conversations.");
  });

  it("offers a way to start one when there are none left", () => {
    const { rerender } = renderList();

    rerender(<ThreadList threads={[]} action={noop} />);

    expect(screen.getByRole("link", { name: /start one/i })).toHaveAttribute(
      "href",
      "/chat",
    );
  });

  it("says nothing while nothing has been deleted", () => {
    renderList();

    expect(announcement()).toHaveTextContent("");
  });

  it("stays quiet when the page re-renders and the list is unchanged", () => {
    // The dashboard hands down a fresh array on every render, so "the props
    // changed" is not the same question as "something was deleted". Getting
    // that wrong would announce a phantom deletion and steal the keyboard
    // every time anything else on the page moved.
    const { rerender } = renderList();

    rerender(<ThreadList threads={[...THREADS]} action={noop} />);

    expect(announcement()).toHaveTextContent("");
    expect(announcement()).not.toHaveFocus();
  });

  it("does not congratulate anybody on a deletion that did not happen", async () => {
    // The announcement reads the list the server sent back, not the action's
    // return value, so a refused delete cannot produce one.
    const failing: DeleteThreadAction = async () => deleteThreadError("unavailable");
    const user = userEvent.setup();
    renderList(failing);

    await user.click(
      screen.getByRole("button", { name: /delete .*Hallo und Tschüss/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /delete .*Hallo und Tschüss.*for good/i }),
    );

    await waitFor(() => {
      expect(within(row("Hallo und Tschüss")).getByRole("status")).toHaveTextContent(
        DELETE_THREAD_MESSAGES.unavailable,
      );
    });
    expect(announcement()).not.toHaveTextContent(/deleted/i);
  });

  it("keeps the failure region on the page while it is empty", () => {
    // A live region added at the same moment as its content is one a screen
    // reader can miss, so it is there from the first render. That it is also
    // not `display: none` when empty is asserted against real CSS in
    // tests/e2e/learner-journey.spec.ts — jsdom applies no stylesheet.
    renderList();

    expect(
      within(row("Hallo und Tschüss")).getByRole("status"),
    ).toBeInTheDocument();
  });
});
