import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";

import { RunsPanel } from "@/components/operations/runs-panel";
import type { BoardRun } from "@/domain/product-ops";
import { QUIET_BEFORE_STALLED_MS } from "@/lib/dashboard/product-ops";

/**
 * The runs list.
 *
 * One card per run, and what is checked is what an operator reads off it: a
 * single word for the state, a sentence for what is happening or why it
 * stopped, and exactly the actions that make sense for that run — a nudge
 * only where the server has something to do, removal only for a run that
 * stopped and left nothing behind.
 *
 * The polling is the other half: it ticks while a run is working and stops,
 * by the server's clock, when nothing is.
 */

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const AS_OF = new Date("2026-09-10T12:00:10.000Z");

const RUN: BoardRun = {
  id: "3f0f1d3a-0b1e-4c2a-8a1a-9a1b2c3d4e5f",
  runType: "manual_market_scan",
  status: "running",
  stage: "research",
  errorCode: null,
  startedAt: new Date("2026-09-10T12:00:00.000Z"),
  completedAt: null,
  updatedAt: new Date("2026-09-10T12:00:00.000Z"),
};

const advance = vi.fn(async () => {});
const remove = vi.fn(async () => {});

function panel(runs: readonly BoardRun[], withProposals: readonly string[] = []) {
  return render(
    <RunsPanel
      runs={runs}
      asOf={AS_OF}
      runsWithProposals={new Set(withProposals)}
      advance={advance}
      remove={remove}
      intervalMs={1_000}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("what a card says", () => {
  it("says what nothing looks like", () => {
    panel([]);

    expect(screen.getByText(/no runs yet/i)).toBeInTheDocument();
  });

  it("leads a working scan with one word and a sentence", () => {
    panel([RUN]);

    const item = screen.getByRole("listitem");
    expect(within(item).getByText("Working")).toBeInTheDocument();
    expect(within(item).getByText("Market scan")).toBeInTheDocument();
    expect(within(item).getByText(/researching the market/i)).toBeInTheDocument();
  });

  it("explains a failure in a sentence and keeps the code beside it, small", () => {
    panel([{ ...RUN, status: "failed", stage: "failed", errorCode: "invalid_output" }]);

    const item = screen.getByRole("listitem");
    expect(within(item).getByText("Stopped")).toBeInTheDocument();
    expect(within(item).getByText(/did not match the required structure/i)).toBeInTheDocument();
    expect(within(item).getByText("invalid_output").tagName).toBe("CODE");
  });

  it("never prints a raw stage enum", () => {
    panel([{ ...RUN, stage: "plan_review", status: "awaiting_review" }]);

    expect(screen.queryByText("plan_review")).not.toBeInTheDocument();
    expect(screen.getByText("Your move")).toBeInTheDocument();
  });

  it("says how long ago the run last moved", () => {
    panel([RUN]);

    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("lists the newest run first", () => {
    panel([
      { ...RUN, id: "old", updatedAt: new Date("2026-09-10T11:00:00.000Z"), stage: "failed", status: "failed" },
      { ...RUN, id: "new" },
    ]);

    const [first] = screen.getAllByRole("listitem");
    expect(within(first).getByText("Working")).toBeInTheDocument();
  });
});

describe("what a card offers", () => {
  it("offers a nudge only where the server has something to do", () => {
    panel([
      RUN,
      { ...RUN, id: "b", stage: "implementation" },
      { ...RUN, id: "c", stage: "human_review", status: "awaiting_review" },
    ]);

    expect(screen.getAllByRole("button", { name: /nudge/i })).toHaveLength(1);
  });

  it("tells a stalled run apart and offers to nudge it on", () => {
    panel([{ ...RUN, updatedAt: new Date(AS_OF.getTime() - QUIET_BEFORE_STALLED_MS - 1) }]);

    expect(screen.getByText("Stalled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /nudge it on/i })).toBeInTheDocument();
  });

  it("offers removal for a failed run with nothing hanging off it", () => {
    panel([{ ...RUN, status: "failed", stage: "failed", errorCode: "no_findings" }]);

    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("offers no removal when a proposal hangs off the run", () => {
    panel([{ ...RUN, status: "failed", stage: "failed" }], [RUN.id]);

    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });

  it("offers no removal for a run that is still moving or finished well", () => {
    panel([RUN, { ...RUN, id: "done", stage: "completed", status: "completed" }]);

    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });

  it("carries the run's id on both forms", () => {
    const { container } = panel([
      { ...RUN, status: "failed", stage: "failed" },
    ]);

    const inputs = container.querySelectorAll('input[name="runId"]');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toHaveAttribute("value", RUN.id);
  });
});

describe("the polling", () => {
  it("asks the server again while a run is working", () => {
    panel([RUN]);

    act(() => {
      vi.advanceTimersByTime(3_001);
    });

    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("does not poll when nothing is moving", () => {
    panel([
      { ...RUN, status: "failed", stage: "failed" },
      { ...RUN, id: "b", stage: "human_review", status: "awaiting_review" },
    ]);

    act(() => {
      vi.advanceTimersByTime(10_001);
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText(/updates itself/i)).not.toBeInTheDocument();
  });

  it("stops polling a run the server's clock calls stalled", () => {
    panel([{ ...RUN, updatedAt: new Date(AS_OF.getTime() - QUIET_BEFORE_STALLED_MS - 1) }]);

    act(() => {
      vi.advanceTimersByTime(10_001);
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it("clears the timer when the operator navigates away", () => {
    const { unmount } = panel([RUN]);
    unmount();

    act(() => {
      vi.advanceTimersByTime(5_001);
    });

    expect(refresh).not.toHaveBeenCalled();
  });
});
