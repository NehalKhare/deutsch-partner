import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { RunLiveFeed } from "@/components/operations/run-live-feed";

/**
 * The live feed.
 *
 * jsdom has no EventSource, so the test installs one it can drive: it records
 * the URL it was opened with and lets a test deliver frames by name. What is
 * asserted is what the operator reads — each row in words, the failed one in
 * red, the "waiting on the model" line while the stream is live — and what
 * the feed does about the run moving: a refresh on a stage change, a close
 * on done, and nothing at all when the card says the run is not working.
 */

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  private readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }

  close() {
    this.closed = true;
  }

  /** Delivers one named frame, as the browser would. */
  emit(type: string, data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const RUN_ID = "3f0f1d3a-0b1e-4c2a-8a1a-9a1b2c3d4e5f";
const AT = "2026-09-10T12:00:00.000Z";

function timeline(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    stage: "research",
    status: "progress",
    entered: false,
    costEur: 0,
    errorCode: null,
    notes: [
      { label: "tool", value: "search_market" },
      { label: "ok", value: "true" },
    ],
    at: AT,
    ...over,
  };
}

function runFrame(stage: string) {
  return { stage, status: "running", errorCode: null, updatedAt: AT };
}

function source(): FakeEventSource {
  const [instance] = FakeEventSource.instances;
  if (!instance) throw new Error("no EventSource was opened");
  return instance;
}

beforeEach(() => {
  FakeEventSource.instances = [];
  refresh.mockClear();
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("opening", () => {
  it("follows the run's own endpoint, and only while the card says it is working", () => {
    render(<RunLiveFeed runId={RUN_ID} working />);

    expect(source().url).toBe(`/api/operations/product/${RUN_ID}/events`);
  });

  it("opens nothing for a run that is not working", () => {
    render(<RunLiveFeed runId={RUN_ID} working={false} />);

    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("renders nothing until the first frame arrives", () => {
    const { container } = render(<RunLiveFeed runId={RUN_ID} working />);

    expect(container).toBeEmptyDOMElement();
  });

  it("copes with a runtime that has no EventSource at all", () => {
    vi.stubGlobal("EventSource", undefined);

    const { container } = render(<RunLiveFeed runId={RUN_ID} working />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("what it shows", () => {
  it("puts each row into words, oldest first", () => {
    render(<RunLiveFeed runId={RUN_ID} working />);

    act(() => {
      source().emit("timeline", timeline(1, { status: "started", notes: [] }));
      source().emit("timeline", timeline(2));
      source().emit("timeline", timeline(3, { notes: [{ label: "model", value: "call" }] }));
    });

    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items[0]).toMatch(/started researching the market/i);
    expect(items[1]).toMatch(/searched the web/i);
    expect(items[2]).toMatch(/the model replied/i);
  });

  it("says it is waiting on the model while the stream is live", () => {
    render(<RunLiveFeed runId={RUN_ID} working />);

    act(() => {
      source().emit("run", runFrame("research"));
    });

    expect(screen.getByRole("status")).toHaveTextContent(/waiting on the model/i);
  });

  it("shows only the tail of a long run", () => {
    render(<RunLiveFeed runId={RUN_ID} working />);

    act(() => {
      for (let id = 1; id <= 12; id += 1) source().emit("timeline", timeline(id));
    });

    expect(screen.getAllByRole("listitem")).toHaveLength(8);
  });

  it("never prints a tool's arguments or result, because the frame carries none", () => {
    render(<RunLiveFeed runId={RUN_ID} working />);

    act(() => {
      source().emit("timeline", timeline(1));
    });

    expect(screen.queryByText(/search_market/)).not.toBeInTheDocument();
  });

  it("ignores a frame the schema will not accept", () => {
    render(<RunLiveFeed runId={RUN_ID} working />);

    act(() => {
      source().emit("timeline", { id: "not-a-number", stage: "research" });
      source().emit("timeline", timeline(1, { stage: "somewhere_else" }));
    });

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows a row it has already seen once", () => {
    render(<RunLiveFeed runId={RUN_ID} working />);

    act(() => {
      source().emit("timeline", timeline(1));
      source().emit("timeline", timeline(1));
    });

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("what it does about the run moving", () => {
  it("refreshes the page when the run changes stage, not on the opening frame", () => {
    render(<RunLiveFeed runId={RUN_ID} working />);

    act(() => {
      source().emit("run", runFrame("research"));
    });
    expect(refresh).not.toHaveBeenCalled();

    act(() => {
      source().emit("run", runFrame("synthesis"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("closes and refreshes when the server says the run has settled", () => {
    render(<RunLiveFeed runId={RUN_ID} working />);

    act(() => {
      source().emit("done", { reason: "settled" });
    });

    expect(source().closed).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("closes the connection when the operator navigates away", () => {
    const { unmount } = render(<RunLiveFeed runId={RUN_ID} working />);

    unmount();

    expect(source().closed).toBe(true);
  });
});
