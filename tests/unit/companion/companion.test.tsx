import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Companion } from "@/components/companion/companion";
import { companionStateFor, MAX_GROWTH_STAGE } from "@/domain/companion";
import { TUTOR } from "@/domain/tutor";

const at = (miniLevel: number, activity: "idle" | "listening" | "speaking" | "struggling") =>
  companionStateFor({ miniLevel, activity });

describe("accessibility", () => {
  it("describes itself by mood, since the shape carries meaning", () => {
    render(<Companion state={at(1, "idle")} />);

    expect(screen.getByRole("img")).toHaveAccessibleName(/smiling/i);
  });

  it.each([
    ["listening", /listening/i],
    ["struggling", /sad/i],
  ] as const)("names the %s mood", (activity, pattern) => {
    render(<Companion state={at(1, activity)} />);

    expect(screen.getByRole("img")).toHaveAccessibleName(pattern);
  });

  it("says whose face it is, not just what mood it is in", () => {
    // The blob is the tutor. A screen-reader user meeting "your learning
    // companion" and then a reply signed Jonas has met two characters.
    render(<Companion state={at(1, "idle")} />);

    expect(screen.getByRole("img")).toHaveAccessibleName(
      new RegExp(TUTOR.name, "i"),
    );
  });

  it("accepts a caller-supplied description when context needs a better one", () => {
    render(<Companion state={at(1, "speaking")} label="Your partner is replying" />);

    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Your partner is replying",
    );
  });

  it("can step out of the accessibility tree when the text nearby already says it", () => {
    const { container } = render(<Companion state={at(1, "idle")} decorative />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector("[aria-hidden='true']")).toBeInTheDocument();
  });
});

describe("mood", () => {
  it.each([
    ["idle", "smiling"],
    ["speaking", "smiling"],
    ["listening", "listening"],
    ["struggling", "sad"],
  ] as const)("renders %s as the %s face", (activity, emotion) => {
    render(<Companion state={at(1, activity)} />);

    expect(screen.getByRole("img")).toHaveAttribute("data-emotion", emotion);
  });
});

describe("what the drawing is told", () => {
  it.each(["idle", "listening", "speaking", "struggling"] as const)(
    "carries data-activity=%s for the stylesheet's ambient loops",
    (activity) => {
      // The idle performance — the glances and the smirk that make the tutor
      // feel present — hangs entirely off this attribute.
      render(<Companion state={at(1, activity)} />);

      expect(screen.getByRole("img")).toHaveAttribute("data-activity", activity);
    },
  );
});

describe("growth", () => {
  it("starts at the first stage", () => {
    render(<Companion state={at(1, "idle")} />);

    expect(screen.getByRole("img")).toHaveAttribute("data-stage", "1");
  });

  it("is fully grown at the end of the path", () => {
    render(<Companion state={at(70, "idle")} />);

    expect(screen.getByRole("img")).toHaveAttribute(
      "data-stage",
      String(MAX_GROWTH_STAGE),
    );
  });

  it("gets visibly bigger as the learner progresses", () => {
    const { container: early } = render(<Companion state={at(1, "idle")} />);
    const { container: late } = render(<Companion state={at(70, "idle")} />);

    const size = (root: HTMLElement) =>
      Number(
        (root.querySelector("[data-stage]") as HTMLElement).style
          .getPropertyValue("--companion-scale"),
      );

    expect(size(late)).toBeGreaterThan(size(early));
  });

  it("exposes progress so a caller can label it without recomputing", () => {
    render(<Companion state={at(70, "idle")} />);

    expect(screen.getByRole("img")).toHaveAttribute("data-progress", "1");
  });
});

describe("motion", () => {
  it("animates only while the companion is the one talking", () => {
    render(<Companion state={at(1, "speaking")} />);

    expect(screen.getByRole("img")).toHaveAttribute("data-animated", "true");
  });

  it.each(["idle", "listening", "struggling"] as const)(
    "holds still while %s",
    (activity) => {
      render(<Companion state={at(1, activity)} />);

      expect(screen.getByRole("img")).toHaveAttribute("data-animated", "false");
    },
  );
});

describe("face", () => {
  it("has two eyes and a mouth, which is what makes it a face", () => {
    const { container } = render(<Companion state={at(1, "idle")} />);

    expect(container.querySelectorAll("[data-part='eye']")).toHaveLength(2);
    expect(container.querySelector("[data-part='mouth']")).toBeInTheDocument();
  });
});
