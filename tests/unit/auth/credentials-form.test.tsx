import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CredentialsForm } from "@/components/auth/credentials-form";
import type { AuthFormState } from "@/lib/auth/form-state";

const idle: AuthFormState = { message: null, status: "idle" };

const noop = async () => idle;

describe("sign-in form", () => {
  it("renders email and password fields with accessible labels", () => {
    render(
      <CredentialsForm mode="sign-in" action={noop} initialState={idle} />,
    );

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("does not ask for a password confirmation", () => {
    render(
      <CredentialsForm mode="sign-in" action={noop} initialState={idle} />,
    );

    expect(screen.queryByLabelText("Confirm password")).not.toBeInTheDocument();
  });

  it("uses the current-password autocomplete hint", () => {
    render(
      <CredentialsForm mode="sign-in" action={noop} initialState={idle} />,
    );

    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });

  it("carries the requested destination through as a hidden field", () => {
    const { container } = render(
      <CredentialsForm
        mode="sign-in"
        action={noop}
        initialState={idle}
        next="/dashboard/progress"
      />,
    );

    expect(container.querySelector('input[name="next"]')).toHaveValue(
      "/dashboard/progress",
    );
  });

  it("omits the hidden field when there is no destination", () => {
    const { container } = render(
      <CredentialsForm mode="sign-in" action={noop} initialState={idle} />,
    );

    expect(container.querySelector('input[name="next"]')).toBeNull();
  });
});

describe("sign-up form", () => {
  it("asks for a password confirmation", () => {
    render(
      <CredentialsForm mode="sign-up" action={noop} initialState={idle} />,
    );

    expect(screen.getByLabelText("Confirm password")).toBeInTheDocument();
  });

  it("states the minimum password length rather than only enforcing it", () => {
    render(
      <CredentialsForm mode="sign-up" action={noop} initialState={idle} />,
    );

    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it("links the hint to the field for assistive technology", () => {
    render(
      <CredentialsForm mode="sign-up" action={noop} initialState={idle} />,
    );

    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(
      /at least 8 characters/i,
    );
  });
});

describe("feedback", () => {
  it("announces an error in a live region", () => {
    render(
      <CredentialsForm
        mode="sign-in"
        action={noop}
        initialState={{ status: "error", message: "That did not work." }}
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("That did not work.");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("announces the check-your-email outcome", () => {
    render(
      <CredentialsForm
        mode="sign-up"
        action={noop}
        initialState={{ status: "check_email", message: "Check your inbox." }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Check your inbox.");
  });

  it("submits what the learner typed", async () => {
    const action = vi.fn(
      async (_state: AuthFormState, _formData: FormData) => idle,
    );
    const user = userEvent.setup();

    render(
      <CredentialsForm mode="sign-in" action={action} initialState={idle} />,
    );

    await user.type(screen.getByLabelText("Email"), "lernerin@example.com");
    await user.type(screen.getByLabelText("Password"), "korrekt-pferd-42");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(action).toHaveBeenCalledOnce();
    const formData = action.mock.calls[0]?.[1];
    expect(formData?.get("email")).toBe("lernerin@example.com");
  });

  it("offers a way across to the other form", () => {
    render(
      <CredentialsForm mode="sign-in" action={noop} initialState={idle} />,
    );

    expect(
      screen.getByRole("link", { name: /create an account/i }),
    ).toHaveAttribute("href", "/auth/sign-up");
  });
});
