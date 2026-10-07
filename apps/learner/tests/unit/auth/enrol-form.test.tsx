import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CodeForm } from "@/components/auth/code-form";
import { EnrolForm } from "@/components/auth/enrol-form";
import {
  INITIAL_CODE_STATE,
  INITIAL_ENROLMENT_STATE,
  type CodeFormState,
  type EnrolmentFormState,
} from "@/lib/auth/mfa-state";

/**
 * Enrolling an authenticator is two submits on one page, and the second only
 * works if it is handed what the first minted. These tests pin the thread
 * between the steps and the destination both forms carry, not the rendering.
 */

const BEGUN: EnrolmentFormState = {
  status: "enrolling",
  message: null,
  factorId: "factor-1",
  qrCode: "data:image/svg+xml;utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E",
  secret: "JBSWY3DPEHPK3PXP",
};

function fakeAction(confirm: (previous: EnrolmentFormState) => EnrolmentFormState) {
  return vi.fn(async (previous: EnrolmentFormState, formData: FormData) =>
    formData.get("intent") === "begin" ? BEGUN : confirm(previous),
  );
}

async function beginAndEnter(action: ReturnType<typeof fakeAction>, code: string, next?: string) {
  const user = userEvent.setup();
  render(<EnrolForm action={action} initialState={INITIAL_ENROLMENT_STATE} next={next} />);

  await user.click(screen.getByRole("button", { name: "Set up authenticator" }));
  await screen.findByRole("img", { name: "Authenticator enrolment QR code" });

  await user.type(screen.getByLabelText("Code"), code);
  await user.click(screen.getByRole("button", { name: "Finish setup" }));
  return user;
}

describe("enrolling an authenticator", () => {
  it("hands the confirm step the factor the begin step minted", async () => {
    const action = fakeAction((previous) => ({ ...previous, status: "error", message: "refused" }));

    await beginAndEnter(action, "123456");
    await screen.findByText("refused");

    expect(action).toHaveBeenCalledTimes(2);
    const [previous, formData] = action.mock.calls[1]!;
    expect(previous.factorId).toBe("factor-1");
    expect(formData.get("intent")).toBe("confirm");
    expect(formData.get("code")).toBe("123456");
  });

  it("carries the destination on both submits", async () => {
    const action = fakeAction((previous) => ({ ...previous, status: "error", message: "refused" }));

    await beginAndEnter(action, "123456", "/billing/trial");
    await screen.findByText("refused");

    expect(action.mock.calls[0]![1].get("next")).toBe("/billing/trial");
    expect(action.mock.calls[1]![1].get("next")).toBe("/billing/trial");
  });

  it("keeps the QR code on screen with the message when a code is refused", async () => {
    const action = fakeAction((previous) => ({ ...previous, status: "error", message: "refused" }));

    await beginAndEnter(action, "000000");
    await screen.findByText("refused");

    expect(screen.getByRole("img", { name: "Authenticator enrolment QR code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish setup" })).toBeInTheDocument();
  });

  it("shows the key by hand for an app that cannot scan", async () => {
    const action = fakeAction((previous) => previous);
    const user = userEvent.setup();
    render(<EnrolForm action={action} initialState={INITIAL_ENROLMENT_STATE} />);

    await user.click(screen.getByRole("button", { name: "Set up authenticator" }));

    expect(await screen.findByText(BEGUN.secret!)).toBeInTheDocument();
  });
});

function refusingCodeAction() {
  return vi.fn(
    async (_previous: CodeFormState, _formData: FormData): Promise<CodeFormState> => ({
      status: "error",
      message: "refused",
    }),
  );
}

describe("answering an authenticator", () => {
  it("submits the code with the destination, and shows what the server said", async () => {
    const action = refusingCodeAction();
    const user = userEvent.setup();
    render(<CodeForm action={action} initialState={INITIAL_CODE_STATE} next="/chat" />);

    await user.type(screen.getByLabelText("Code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await screen.findByText("refused");

    const [, formData] = action.mock.calls[0]!;
    expect(formData.get("code")).toBe("123456");
    expect(formData.get("next")).toBe("/chat");
  });

  it("sends no destination when there is none, so the server falls back to the dashboard", async () => {
    const action = refusingCodeAction();
    const user = userEvent.setup();
    render(<CodeForm action={action} initialState={INITIAL_CODE_STATE} />);

    await user.type(screen.getByLabelText("Code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await screen.findByText("refused");

    expect(action.mock.calls[0]![1].get("next")).toBeNull();
  });
});
