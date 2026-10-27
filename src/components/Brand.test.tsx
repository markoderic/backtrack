import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Icon, ICON_NAMES } from "./Icon";
import { LogoLockup, LogoMark } from "./Logo";
import { ButtonPrimary, ButtonPrimaryLink } from "./ButtonPrimary";

describe("Icon", () => {
  it("paints the exported file in the current color and is hidden from screen readers by default", () => {
    const { container } = render(<Icon name="info" />);
    const el = container.querySelector('[data-icon="info"]') as HTMLElement;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.style.maskImage || el.style.webkitMaskImage).toContain("/brand/info.svg");
    expect(el.style.width).toBe("20px");
    expect(el.className).toContain("bg-current");
  });

  it("every icon name has its file, drawn in the same style (24 px, 1.6 stroke, ink); the Layout icon too (batch N)", () => {
    expect(ICON_NAMES).toContain("layout");
    for (const name of ICON_NAMES) {
      const file = join(__dirname, "../../public/brand", `${name}.svg`);
      expect(existsSync(file), name).toBe(true);
      const svg = readFileSync(file, "utf8");
      expect(svg, name).toMatch(/viewBox="0 0 24 24"/);
      expect(svg, name).toContain("#1B1A18");
    }
    expect(readFileSync(join(__dirname, "../../public/brand/layout.svg"), "utf8")).toContain('stroke-width="1.6"');
  });

  it("has a name when given a label", () => {
    render(<Icon name="alert" size={18} label="Problem" />);
    expect(screen.getByRole("img", { name: "Problem" })).toHaveStyle({ width: "18px", height: "18px" });
  });
});

describe("Logo", () => {
  it("renders the mark file at the given size", () => {
    const { container } = render(<LogoMark size={22} />);
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("src", "/brand/logo-mark.svg");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("width", "22");
  });

  it("lockups read as backtrack, with the mark at 52 (L) or 26 (S)", () => {
    const { container, rerender } = render(<LogoLockup size="L" />);
    expect(container).toHaveTextContent("backtrack");
    expect(container.querySelector("img")).toHaveAttribute("width", "52");
    rerender(<LogoLockup size="S" />);
    expect(container.querySelector("img")).toHaveAttribute("width", "26");
  });
});

describe("ButtonPrimary", () => {
  it("is a plain button by default and passes clicks and disabled through", () => {
    const onClick = vi.fn();
    const { rerender } = render(<ButtonPrimary onClick={onClick}>Join</ButtonPrimary>);
    const b = screen.getByRole("button", { name: "Join" });
    expect(b).toHaveAttribute("type", "button");
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<ButtonPrimary disabled onClick={onClick}>Join</ButtonPrimary>);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("has a link form", () => {
    render(<ButtonPrimaryLink href="/join">Join a class</ButtonPrimaryLink>);
    expect(screen.getByRole("link", { name: "Join a class" })).toHaveAttribute("href", "/join");
  });
});
