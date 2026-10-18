import type { ReviewCanvasUi } from "@dev.fast/review-protocol";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { EmailDialog } from "./email-dialog";
import { FeedbackDialog } from "./feedback-dialog";

let container: HTMLDivElement;

let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

type FeedbackHost = NonNullable<ReviewCanvasUi["feedback"]>;

function host(): FeedbackHost {
  return {
    environment: "test",
    hasSharedEmail: () => false,
    submit: vi.fn<FeedbackHost["submit"]>(async () => ({ ok: true as const })),
    submitContact: vi.fn<FeedbackHost["submitContact"]>(async () => ({
      ok: true as const,
    })),
    openReleaseNotes: vi.fn<() => void>(),
  };
}

function Harness({ bridge }: { bridge: ReturnType<typeof host> }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)}>Open email</button>
      {open && <EmailDialog host={bridge} onClose={() => setOpen(false)} />}
    </>
  );
}

it("focuses email, contains Tab navigation, and restores focus on Escape without submitting", async () => {
  const bridge = host();
  await act(async () => root.render(<Harness bridge={bridge} />));
  await act(async () => {
    await page.getByRole("button", { name: "Open email" }).click();
  });
  await expect.element(page.getByLabelText("Your email")).toHaveFocus();

  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await userEvent.keyboard("{Tab}");
    });
    expect(
      container.querySelector("dialog")?.contains(document.activeElement),
    ).toBe(true);
  }

  await act(async () => {
    await userEvent.keyboard("{Escape}");
  });
  await expect
    .element(page.getByRole("button", { name: "Open email" }))
    .toHaveFocus();
  expect(bridge.submitContact).not.toHaveBeenCalled();
});

it("validates inline, preserves the address on failure, and retries with Enter", async () => {
  const bridge = host();
  bridge.submitContact = vi
    .fn<FeedbackHost["submitContact"]>()
    .mockResolvedValueOnce({ ok: false, error: "network" })
    .mockResolvedValueOnce({ ok: true });
  await act(async () => root.render(<Harness bridge={bridge} />));
  await act(async () => {
    await page.getByRole("button", { name: "Open email" }).click();
  });
  await act(async () => {
    await page.getByLabelText("Your email").fill("invalid");
  });
  await act(async () => {
    await userEvent.keyboard("{Enter}");
  });
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Enter a valid email address.");
  expect(bridge.submitContact).not.toHaveBeenCalled();
  await act(async () => {
    await page.getByLabelText("Your email").fill("person@example.com");
  });
  await act(async () => {
    await userEvent.keyboard("{Enter}");
  });
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Your email wasn’t saved");
  await expect
    .element(page.getByLabelText("Your email"))
    .toHaveValue("person@example.com");
  await act(async () => {
    await page.getByLabelText("Your email").click();
  });
  await act(async () => {
    await userEvent.keyboard("{Enter}");
  });
  await expect
    .element(page.getByRole("button", { name: "Open email" }))
    .toHaveFocus();
  expect(bridge.submitContact).toHaveBeenCalledTimes(2);
  expect(bridge.submitContact).toHaveBeenLastCalledWith(
    expect.objectContaining({
      kind: "contact",
      email: "person@example.com",
      environment: "test",
    }),
  );
});

it("does not dismiss or duplicate a submission while saving", async () => {
  const bridge = host();
  let finish!: (value: { ok: true }) => void;
  bridge.submitContact = vi.fn<FeedbackHost["submitContact"]>(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => root.render(<Harness bridge={bridge} />));
  await act(async () => {
    await page.getByRole("button", { name: "Open email" }).click();
  });
  await act(async () => {
    await page.getByLabelText("Your email").fill("person@example.com");
  });
  await act(async () => {
    await userEvent.keyboard("{Enter}");
  });
  await expect
    .element(page.getByRole("button", { name: "Sharing…" }))
    .toBeDisabled();
  await act(async () => {
    await userEvent.keyboard("{Enter}{Escape}");
  });
  expect(bridge.submitContact).toHaveBeenCalledTimes(1);
  expect(container.querySelector("dialog")?.open).toBe(true);
  await act(async () => finish({ ok: true }));
  await expect
    .element(page.getByRole("button", { name: "Open email" }))
    .toHaveFocus();
});

for (const shared of [true, false]) {
  it(`survey ${shared ? "skips" : "shows"} contact after saving when an email ${shared ? "is" : "is not"} known`, async () => {
    const bridge = host();
    bridge.hasSharedEmail = () => shared;
    await act(async () =>
      root.render(<FeedbackDialog host={bridge} onClose={() => {}} />),
    );
    await act(async () => {
      await page.getByRole("checkbox", { name: "Work", exact: true }).click();
    });
    await act(async () => {
      await page
        .getByRole("textbox", {
          name: "What is the main benefit you receive from Whiteboard?",
        })
        .fill("Understanding code");
    });
    await act(async () => {
      await page
        .getByRole("radio", { name: "Collaboration:", exact: false })
        .click();
    });
    await act(async () => {
      await page.getByRole("slider").click();
    });
    await act(async () => {
      await page
        .getByRole("checkbox", { name: "Developer", exact: true })
        .click();
    });
    await act(async () => {
      await page.getByRole("button", { name: "Submit", exact: true }).click();
    });

    const nextStep = shared
      ? page.getByRole("button", { name: "Done", exact: true })
      : page.getByRole("textbox", { name: "Email", exact: true });

    await expect.element(nextStep).toBeVisible();
    expect(bridge.submitContact).not.toHaveBeenCalled();
  });
}
