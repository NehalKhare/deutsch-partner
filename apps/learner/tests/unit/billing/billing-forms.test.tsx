import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BillingActionForm, ConsentCheckbox } from "@/components/billing/billing-action-form";
import { WaitForPlan } from "@/components/billing/wait-for-plan";
import { ORDER_BUTTON_LABEL, earlyStartConsent } from "@/lib/billing/copy";
import { billingFormError, type BillingFormState } from "@/lib/billing/form-state";

/**
 * The forms that start a payment, and the page that waits for one.
 *
 * The order form is where the law is most specific (§312j BGB): the button
 * says the order costs money, in those words, and the early-start request is
 * a box the learner ticks themselves. The waiting page is where the product
 * is most tempted to lie: it may not say a plan is active until the webhook
 * has made it so.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

type Action = (state: BillingFormState, formData: FormData) => Promise<BillingFormState>;

describe("the order form", () => {
  const renderOrder = (action: Action = async (state) => state) =>
    render(
      <BillingActionForm action={action} submitLabel={ORDER_BUTTON_LABEL}>
        <input type="hidden" name="offer" value="dp_plus_month" />
        <ConsentCheckbox label={earlyStartConsent("Deutsch Partner Plus")} />
      </BillingActionForm>,
    );

  it("has a button that says the order costs money, in exactly those words", () => {
    renderOrder();

    expect(screen.getByRole("button")).toHaveTextContent(/^Order with obligation to pay$/);
  });

  it("asks for the early start with a box that is not ticked, and must be", () => {
    renderOrder();

    const box = screen.getByRole("checkbox", { name: /start immediately/i });
    expect(box).not.toBeChecked();
    expect(box).toBeRequired();
    expect(box).toHaveAccessibleName(/withdraw within 14 days, I pay for the days I have already used/);
  });

  it("sends the tick and the offer to the action", async () => {
    const action = vi.fn<Action>(async (state) => state);
    renderOrder(action);

    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button"));

    const sent = action.mock.calls[0]![1];
    expect(sent.get("consent")).toBe("on");
    expect(sent.get("offer")).toBe("dp_plus_month");
  });

  it("says why an order was refused, where a screen reader hears it", async () => {
    renderOrder(async () => billingFormError("price_changed"));

    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button"));

    expect(await screen.findByRole("status")).toHaveTextContent(/price changed/i);
  });
});

describe("waiting for the plan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the server again every two seconds, and grants nothing itself", () => {
    render(<WaitForPlan />);

    act(() => void vi.advanceTimersByTime(6_000));

    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("stops after thirty seconds and says it can take longer", () => {
    render(<WaitForPlan />);

    act(() => void vi.advanceTimersByTime(40_000));

    expect(refresh).toHaveBeenCalledTimes(15);
    expect(screen.getByText(/taking longer than usual/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /plan & billing/i })).toHaveAttribute("href", "/billing");
  });

  it("says it is checking while it checks", () => {
    render(<WaitForPlan />);

    expect(screen.getByRole("status")).toHaveTextContent(/checking/i);
  });
});
