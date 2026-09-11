/* Regression oracle for the toast layer's pointer-event bounds.
 *
 * Why this exists: the packaged acceptance journey clicks "Create Bot" on
 * the Bots page and a Sonner toast was intercepting that click. A toast the
 * user had already dismissed was still hit-testing over the button, and the
 * toast column claimed pointer events outside the painted toast boxes. jsdom
 * performs no layout and no hit-testing, so neither condition can be proven
 * there; this page mounts the REAL Toaster, the REAL BotCreationForm and the
 * REAL main.css in a real browser (scripts/probe-toast-pointer-bounds.mjs
 * drives it) and answers document.elementFromPoint() questions.
 *
 * The chrome mirrors App.tsx: #root stacks .app-shell (flex: 1), the 24px
 * status bar row, then the Toaster's <section> as the last sibling — so the
 * form footer lands in the same place the acceptance journey sees it.
 */
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { Toaster } from "../sonner";
import { Button } from "../button";
import { Input } from "../input";
import { BotCreationForm } from "../../../features/bots/BotCreationForm";
import {
  emptyBotCreateForm,
  type BotCreateFormValues,
} from "../../../features/bots/bots-page-model";
import "../../../assets/main.css";

type NodeDescription = {
  tag: string;
  className: string;
  inToaster: boolean;
  isToast: boolean;
  toastId: string | null;
  isToastCloseButton: boolean;
  isToastActionButton: boolean;
  isSubmit: boolean;
  pointerEvents: string;
};

function describe(element: Element | null): NodeDescription | null {
  if (!element) return null;
  const toaster = element.closest("[data-sonner-toaster]");
  const toast = element.closest("[data-sonner-toast]");
  return {
    tag: element.tagName.toLowerCase(),
    className: typeof element.className === "string" ? element.className : "",
    inToaster: Boolean(toaster),
    isToast: Boolean(toast),
    // Sonner's own `data-sonner-toast` is a valueless marker, so hit-tests are
    // attributed to a specific toast through this oracle-only node tag.
    toastId: toast?.getAttribute("data-oracle-toast") ?? null,
    isToastCloseButton: element.matches("[data-close-button]"),
    isToastActionButton: element.matches("[data-button]"),
    isSubmit: element.matches("button[type='submit']"),
    pointerEvents: getComputedStyle(element).pointerEvents,
  };
}

function rect(element: Element | null) {
  if (!element) return null;
  const box = element.getBoundingClientRect();
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    top: box.top,
    right: box.right,
    bottom: box.bottom,
    left: box.left,
  };
}

function toasterState() {
  const toaster = document.querySelector("[data-sonner-toaster]");
  const section = document.querySelector("section[aria-label^='Notifications']");
  return {
    // Sonner renders the <ol> only while at least one toast is active; an
    // absent toaster is reported as null rather than as a zero-size box.
    toaster: rect(toaster),
    toasterPointerEvents: toaster ? getComputedStyle(toaster).pointerEvents : null,
    section: rect(section),
    sectionPointerEvents: section ? getComputedStyle(section).pointerEvents : null,
    toasts: Array.from(document.querySelectorAll("[data-sonner-toast]")).map(
      (element, index) => {
        if (!element.hasAttribute("data-oracle-toast")) {
          element.setAttribute("data-oracle-toast", `toast-${index}`);
        }
        return {
          id: element.getAttribute("data-oracle-toast") ?? "",
          rect: rect(element),
          dataRemoved: element.getAttribute("data-removed"),
          dataVisible: element.getAttribute("data-visible"),
          dataMounted: element.getAttribute("data-mounted"),
          dataFront: element.getAttribute("data-front"),
          dataExpanded: element.getAttribute("data-expanded"),
          opacity: getComputedStyle(element).opacity,
          pointerEvents: getComputedStyle(element).pointerEvents,
        };
      },
    ),
  };
}

declare global {
  interface Window {
    __toastOracle: {
      raise: (id?: string) => void;
      raiseWithAction: (id: string) => void;
      raiseWithBodyButton: (id: string) => void;
      raiseHeld: (count: number) => void;
      dismiss: (id: string) => void;
      submitCount: () => number;
      cancelCount: () => number;
      actionCount: () => number;
      hitTest: (x: number, y: number) => NodeDescription | null;
      elementCenter: (selector: string) => { x: number; y: number } | null;
      submitRect: () => ReturnType<typeof rect>;
      submitDisabled: () => boolean;
      state: () => ReturnType<typeof toasterState> & { documentHidden: boolean };
    };
  }
}

function Oracle(): React.JSX.Element {
  // The acceptance journey reaches the failing click with a preset character,
  // a name and a harness already chosen, so the submit is enabled. Counters
  // live in a ref so the control surface never reads a stale render.
  const [form, setForm] = useState<BotCreateFormValues>(() => ({
    ...emptyBotCreateForm(),
    displayName: "Acceptance Bot",
    harnessId: "pi",
    model: "qwen3.8-flash-next-nvidia-nvfp4",
    instructions: "Sealed acceptance probe bot.",
  }));
  const counters = useRef({ submits: 0, cancels: 0, actions: 0 });

  if (typeof window !== "undefined" && !window.__toastOracle) {
    window.__toastOracle = {
      raise: (id) => {
        // The exact copy the Automations "Run Now" journey raises, with the
        // default 4s lifetime, so the oracle exercises the same toast.
        if (id) toast.message("Automation run queued.", { id });
        else toast.message("Automation run queued.");
      },
      raiseWithAction: (id) => {
        toast.message("Automation run queued.", {
          id,
          duration: Number.POSITIVE_INFINITY,
          action: {
            label: "Undo",
            onClick: () => {
              counters.current.actions += 1;
            },
          },
        });
      },
      // The delete-worktree failure card's shape: a custom React body with
      // real controls inside it.
      raiseWithBodyButton: (id) => {
        toast.error("Worktree could not be deleted", {
          id,
          duration: Number.POSITIVE_INFINITY,
          description: (
            <div className="flex w-full flex-col gap-3">
              <p className="text-sm leading-5">
                It still has uncommitted changes.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    counters.current.actions += 1;
                  }}
                >
                  Force Delete
                </Button>
              </div>
            </div>
          ),
        });
      },
      // The packaged acceptance raises notifications earlier in the run, so a
      // live stack can still be over the Bots submit when the journey clicks
      // it. `hold` reproduces that exact DOM state on demand.
      raiseHeld: (count) => {
        for (let index = 0; index < count; index += 1) {
          toast.message("Automation run queued.", {
            id: `held-${index}`,
            duration: Number.POSITIVE_INFINITY,
          });
        }
      },
      dismiss: (id) => toast.dismiss(id),
      submitCount: () => counters.current.submits,
      cancelCount: () => counters.current.cancels,
      actionCount: () => counters.current.actions,
      hitTest: (x, y) => describe(document.elementFromPoint(x, y)),
      elementCenter: (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      },
      submitRect: () => rect(document.querySelector("button[type='submit']")),
      submitDisabled: () =>
        (document.querySelector("button[type='submit']") as HTMLButtonElement)
          ?.disabled ?? true,
      state: () => ({ ...toasterState(), documentHidden: document.hidden }),
    };
  }

  return (
    <>
      <div className="app-shell">
        <div className="app-content">
          {/* The sidebar's default 280px gutter (sidebar-width.ts
              SIDEBAR_DEFAULT_WIDTH): the Bots host is a `.terminal-column`
              to the right of it, which is what pushes the form footer into
              the bottom-right toast column at the app's default window size. */}
          <div aria-hidden style={{ width: 280, minWidth: 280 }} />
          <section className="terminal-column">
            <main
            data-testid="bots-panel"
            className="flex h-full min-h-0 flex-col bg-background text-foreground"
          >
            <header className="shrink-0 border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <h1 className="shrink-0 text-base font-bold">Bots</h1>
                <span className="min-w-0 flex-1" />
                <Input
                  className="h-8 w-56"
                  placeholder="Filter bots…"
                  aria-label="Filter bots"
                />
              </div>
            </header>
            <p className="shrink-0 px-5 pt-3 text-xs text-muted-foreground">
              Your team of agents, with memory and a purpose. Configured with
              dedicated daemon scopes, scheduled triggers, and invariant
              monitors.
            </p>
            <div className="flex-1 overflow-y-auto scrollbar-sleek">
              <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-5 sm:p-7">
                <BotCreationForm
                  form={form}
                  busy={false}
                  onChange={(updates) =>
                    setForm((current) => ({ ...current, ...updates }))
                  }
                  onCancel={() => {
                    counters.current.cancels += 1;
                  }}
                  onSubmit={() => {
                    counters.current.submits += 1;
                  }}
                />
              </div>
            </div>
            </main>
          </section>
        </div>
      </div>
      {/* The status bar row App.tsx renders between .app-shell and Toaster. */}
      <div className="status-bar" style={{ height: 24, minHeight: 24 }} />
      <Toaster closeButton toastOptions={{ className: "font-sans text-sm" }} />
      <div data-oracle-ready="true" style={{ display: "none" }} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Oracle />);
