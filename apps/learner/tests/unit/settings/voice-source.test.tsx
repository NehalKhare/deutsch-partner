import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { VoiceSourceSetting } from "@/components/settings/voice-source";

/**
 * The read-aloud voice, chosen per device.
 *
 * What matters: the AI voice is the default, a choice is saved the moment it
 * is made (there is no save button to forget), and the page comes back up
 * with the choice still made.
 */

function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  });
  return store;
}

describe("choosing the read-aloud voice", () => {
  beforeEach(() => {
    stubStorage();
  });

  it("offers both voices with the AI voice as the default", () => {
    render(<VoiceSourceSetting />);

    expect(screen.getByRole("radio", { name: /^ai voice/i })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: /^this device's voice/i }),
    ).not.toBeChecked();
  });

  it("saves the choice the moment it is made", async () => {
    const user = userEvent.setup();
    render(<VoiceSourceSetting />);

    await user.click(screen.getByRole("radio", { name: /^this device's voice/i }));

    expect(
      screen.getByRole("radio", { name: /^this device's voice/i }),
    ).toBeChecked();
    expect(window.localStorage.getItem("deutsch-partner.voice-engine")).toBe(
      "browser",
    );
  });

  it("comes back up with the choice still made", () => {
    window.localStorage.setItem("deutsch-partner.voice-engine", "browser");

    render(<VoiceSourceSetting />);

    expect(
      screen.getByRole("radio", { name: /^this device's voice/i }),
    ).toBeChecked();
  });

  it("says the choice stays on this device", () => {
    render(<VoiceSourceSetting />);

    expect(screen.getByText(/only on this device/i)).toBeInTheDocument();
  });
});
