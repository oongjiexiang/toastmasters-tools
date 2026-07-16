// @vitest-environment jsdom
//
// Phase 19 validation item 6 (see specs/roadmap.md "## Phase 19"):
// `forcedTheme="light"` must be gone from `Providers`/`ThemeProvider`, and
// the new `ThemeToggle` header control must actually cycle
// light -> dark -> system -> light. Rendered inside the REAL `Providers`
// (not a bare `next-themes` `ThemeProvider`) so this exercises the actual
// shipped provider config — a lingering `forcedTheme="light"` would make
// `setTheme` a no-op and this test would fail (see the dedicated negative
// control below).
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Providers } from "@toastmasters/ui/components/providers";
import { ThemeToggle } from "@toastmasters/ui/components/ThemeToggle";

function renderToggle() {
  return render(
    <Providers>
      <ThemeToggle />
    </Providers>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("ThemeToggle — light/dark/system cycle (Phase 19 item 6)", () => {
  it("cycles light -> dark -> system -> light on successive clicks", async () => {
    renderToggle();

    // next-themes resolves `theme` from localStorage/system in a mount
    // effect, so the very first render can briefly read as unmounted/
    // "System" — wait for the toggle to settle before asserting the cycle.
    const button = screen.getByRole("button");
    await waitFor(() =>
      expect(button).toHaveAttribute("aria-label", expect.stringContaining("Theme:")),
    );

    // Regardless of where the cycle starts (default is "system"), three
    // clicks must complete a full loop and land back on the same label.
    const initialLabel = button.getAttribute("aria-label");
    fireEvent.click(button);
    const afterOne = button.getAttribute("aria-label");
    fireEvent.click(button);
    const afterTwo = button.getAttribute("aria-label");
    fireEvent.click(button);
    const afterThree = button.getAttribute("aria-label");

    // Each click must move to a genuinely different state (not a stuck
    // no-op), and a full three-click loop must return to the starting label.
    expect(afterOne).not.toBe(initialLabel);
    expect(afterTwo).not.toBe(afterOne);
    expect(afterThree).toBe(initialLabel);
  });

  it("starting from 'system' (the shipped default), one click moves to 'Light'", async () => {
    renderToggle();

    const button = screen.getByRole("button");
    await waitFor(() => expect(button).toHaveAttribute("title", "Theme: System"));

    fireEvent.click(button);

    expect(button).toHaveAttribute("title", "Theme: Light");
    expect(button).toHaveAttribute("aria-label", "Theme: Light (click to change)");
  });

  it(
    "negative control for item 6: clicking must actually leave 'Light' — " +
      "if providers.tsx still set forcedTheme=\"light\", next-themes would " +
      "ignore setTheme() and the label would stay stuck on 'Light' forever",
    async () => {
      renderToggle();

      const button = screen.getByRole("button");
      await waitFor(() =>
        expect(button).toHaveAttribute("aria-label", expect.stringContaining("Theme:")),
      );

      // Drive it to "Light" first (from whatever the resolved default is),
      // then click once more — under forcedTheme="light" this next click
      // would still read "Light" every time, since setTheme is inert.
      while (button.getAttribute("title") !== "Theme: Light") {
        fireEvent.click(button);
      }
      fireEvent.click(button);

      expect(button).not.toHaveAttribute("title", "Theme: Light");
      expect(button).toHaveAttribute("title", "Theme: Dark");
    },
  );

  it("clicking 'Dark' applies the .dark class to <html>, proving the provider is not force-pinned to light", async () => {
    renderToggle();

    const button = screen.getByRole("button");
    await waitFor(() =>
      expect(button).toHaveAttribute("aria-label", expect.stringContaining("Theme:")),
    );

    while (button.getAttribute("title") !== "Theme: Dark") {
      fireEvent.click(button);
    }

    await waitFor(() =>
      expect(document.documentElement.classList.contains("dark")).toBe(true),
    );
  });
});
