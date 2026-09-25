import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { JsonLd } from "@/components/seo/json-ld";

describe("JsonLd", () => {
  it("renders a structured-data script a crawler can parse", () => {
    const { container } = render(<JsonLd data={{ "@type": "Thing", name: "x" }} />);

    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    expect(JSON.parse(script!.textContent ?? "")).toEqual({ "@type": "Thing", name: "x" });
  });

  it("cannot be closed early by its own data", () => {
    const { container } = render(<JsonLd data={{ name: "</script>" }} />);

    const script = container.querySelector("script")!;
    expect(script.innerHTML).not.toContain("</script>");
    expect(JSON.parse(script.textContent ?? "")).toEqual({ name: "</script>" });
  });
});
