import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrivacyLink } from "./PrivacyLink";

describe("PrivacyLink", () => {
  it("is a link to /privacy", () => {
    render(<PrivacyLink />);
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  });
});
