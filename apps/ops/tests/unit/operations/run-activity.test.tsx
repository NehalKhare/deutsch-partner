import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { RunActivityPanel } from "@/components/operations/run-activity";
import type { BoardRun } from "@dp/domain/product-ops";
import type { RunReport } from "@dp/product-ops/view";

/**
 * The live region, and the polling behind it.
 *
 * The interesting behaviour is negative and cannot be seen by looking at the
 * page: this component asks the server for the board again on a timer, and the
 * timer has to stop. A refresh loop that outlives the work it was watching is
 * a page that quietly queries a database forever on an open tab.
 *
 * What stops it is the *data*, not a counter here — a run that goes quiet is
 * reported as stalled by the server's own clock, and a stalled run is not
 * polled. So the assertions are about which reports produce ticks.
 */

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

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

function report(over: Partial<RunReport> = {}): RunReport {
  return {
    run: RUN,
    activity: "working",
    message: "Reading the market.",
    quietForMs: 2_000,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Advances past `count` polling intervals. */
function tick(count: number, intervalMs = 1_000): void {
  act(() => {
    vi.advanceTimersByTime(intervalMs * count + 1);
  });
}

describe("what it shows", () => {
  it("renders nothing at all when there is nothing to report", () => {
    // Not an empty box saying "no activity". The board below it is already
    // the answer to what exists; this panel is only for what is in flight.
    const { container } = render(<RunActivityPanel reports={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("announces progress in a live region rather than only drawing it", () => {
    render(<RunActivityPanel reports={[report()]} />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Reading the market.");
  });

  it("says a scan is running, in words, beside the stage phrase", () => {
    render(<RunActivityPanel reports={[report()]} />);

    expect(screen.getByRole("status")).toHaveTextContent(/scanning/i);
  });

  it("says plainly that it stopped, and does not call that scanning", () => {
    render(
      <RunActivityPanel
        reports={[
          report({
            activity: "failed",
            message: "The run stopped at research — run_budget.",
          }),
        ]}
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/stopped/i);
    expect(status).not.toHaveTextContent(/scanning/i);
  });

  it("reports each run separately when two are in flight", () => {
    render(
      <RunActivityPanel
        reports={[
          report({ run: { ...RUN, id: "a" }, message: "First." }),
          report({ run: { ...RUN, id: "b" }, message: "Second." }),
        ]}
      />,
    );

    expect(screen.getByText("First.")).toBeInTheDocument();
    expect(screen.getByText("Second.")).toBeInTheDocument();
  });
});

describe("the polling", () => {
  it("asks the server again while a run is working", () => {
    render(<RunActivityPanel reports={[report()]} intervalMs={1_000} />);

    expect(refresh).not.toHaveBeenCalled();

    tick(3);

    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["waiting"],
    ["worker"],
    ["stalled"],
    ["done"],
    ["failed"],
    ["rejected"],
  ] as const)("never polls for a run reported as %s", (activity) => {
    render(
      <RunActivityPanel reports={[report({ activity })]} intervalMs={1_000} />,
    );

    tick(10);

    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops when the work does, without the component going away", () => {
    // The real sequence: the panel is mounted and polling, a refresh brings
    // back a board where the run has reached the human gate, and the ticking
    // has to end on that render rather than on unmount.
    const { rerender } = render(
      <RunActivityPanel reports={[report()]} intervalMs={1_000} />,
    );

    tick(2);
    expect(refresh).toHaveBeenCalledTimes(2);

    rerender(
      <RunActivityPanel
        reports={[report({ activity: "waiting" })]}
        intervalMs={1_000}
      />,
    );
    tick(5);

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("clears the timer when the operator navigates away", () => {
    const { unmount } = render(
      <RunActivityPanel reports={[report()]} intervalMs={1_000} />,
    );

    tick(1);
    unmount();
    tick(5);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps exactly one timer across a re-render that changes nothing", () => {
    // Two intervals would double the query rate for the rest of the run, and
    // a refresh on every render of a component that refreshes is a loop.
    const { rerender } = render(
      <RunActivityPanel reports={[report()]} intervalMs={1_000} />,
    );

    rerender(<RunActivityPanel reports={[report()]} intervalMs={1_000} />);
    tick(2);

    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
