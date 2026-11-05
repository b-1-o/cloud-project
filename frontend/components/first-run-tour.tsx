"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

type Panel = "recent" | "hub";

type Step = {
  panel: Panel;
  revealSidebar: boolean;
  target: string;
  eyebrow: string;
  title: string;
  description: string;
};

type Rect = { x: number; y: number; width: number; height: number };
type Position = { x: number; y: number; width: number };

const STORAGE_KEY = "vixiny-first-run-tour-v1";

const STEPS: Step[] = [
  {
    panel: "recent",
    revealSidebar: false,
    target: '[data-tour="workspace"]',
    eyebrow: "WELCOME TO VIXINY",
    title: "Your workspace, all in one place",
    description:
      "Vixiny brings writing, file imports, document organization, and collaboration together. This short tour will show you where everything lives.",
  },
  {
    panel: "recent",
    revealSidebar: true,
    target: '[data-tour="create"]',
    eyebrow: "01 / CREATE",
    title: "Start with a blank document",
    description:
      "Choose New document whenever you want a clean page. Your work is saved as you write, so you can focus on the content instead of remembering to save.",
  },
  {
    panel: "recent",
    revealSidebar: true,
    target: '[data-tour="import"]',
    eyebrow: "02 / BRING YOUR FILES",
    title: "Continue working with files you already have",
    description:
      "Import supported documents and PDFs from your device. Vixiny keeps original files available in the workspace and makes supported formats editable.",
  },
  {
    panel: "recent",
    revealSidebar: true,
    target: '[data-tour="templates"]',
    eyebrow: "03 / GET A HEAD START",
    title: "Use a template when you need structure",
    description:
      "Meeting notes, project briefs, and technical specs give you a useful starting point. Pick one and make it your own.",
  },
  {
    panel: "recent",
    revealSidebar: true,
    target: '[data-tour="search"]',
    eyebrow: "04 / FIND ANYTHING",
    title: "Search and organize your documents",
    description:
      "Search by document title, or switch between All, Mine, Shared, and Trash. Star documents you want to keep close.",
  },
  {
    panel: "hub",
    revealSidebar: true,
    target: '[data-tour="hub"]',
    eyebrow: "05 / WORKSPACE HUB",
    title: "Your shared-work home",
    description:
      "Open Workspace hub for documents shared with you, discussions, the calendar, project briefs, recent edits, and a quick view of workspace activity.",
  },
  {
    panel: "hub",
    revealSidebar: false,
    target: '[data-tour="hub-overview"]',
    eyebrow: "06 / KEEP THE BIG PICTURE",
    title: "See what is happening across the workspace",
    description:
      "The hub brings your collaboration shortcuts and library overview together. Calendar and shared features become available when you sign in.",
  },
  {
    panel: "recent",
    revealSidebar: false,
    target: '[data-tour="share"]',
    eyebrow: "07 / COLLABORATE",
    title: "Share a document with your team",
    description:
      "Open a cloud document you own, then use Share to create a public link or manage collaborators. Sharing requires an account and a saved cloud document.",
  },
  {
    panel: "recent",
    revealSidebar: false,
    target: '[data-tour="signin"]',
    eyebrow: "08 / YOUR ACCOUNT",
    title: "Browse locally, sign in to sync",
    description:
      "You can start with documents saved on this device. Sign in when you are ready to use cloud sync, shared documents, and team collaboration.",
  },
  {
    panel: "recent",
    revealSidebar: false,
    target: '[data-tour="theme"]',
    eyebrow: "09 / MAKE IT YOURS",
    title: "Choose your look — and replay this tour",
    description:
      "Switch between light and dark themes from the top bar. You can reopen this guide any time with the question-mark button.",
  },
];

export default function VixinyFirstRunTour({
  replayKey = 0,
  onNavigate,
  onClose,
}: {
  replayKey?: number;
  onNavigate: (panel: Panel, revealSidebar: boolean) => void;
  onClose: () => void;
}) {
  const maskId = useId().replace(/:/g, "");
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [spotlight, setSpotlight] = useState<Rect | null>(null);
  const [position, setPosition] = useState<Position>({ x: 16, y: 16, width: 360 });

  const step = STEPS[stepIndex] ?? STEPS[0]!;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        setOpen(window.localStorage.getItem(STORAGE_KEY) !== "complete");
      } catch {
        setOpen(true);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (replayKey <= 0) return;
    setStepIndex(0);
    setClosing(false);
    setOpen(true);
  }, [replayKey]);

  useEffect(() => {
    if (!open) return;
    onNavigate(step.panel, step.revealSidebar);

    let timeout = 0;
    const measure = (scrollToTarget = false) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      setViewport((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );

      const target = document.querySelector<HTMLElement>(step.target);
      if (!target) {
        setSpotlight(null);
        const cardWidth = Math.min(420, width - 32);
        setPosition({
          x: Math.max(16, (width - cardWidth) / 2),
          y: Math.max(16, (height - 300) / 2),
          width: cardWidth,
        });
        return;
      }

      if (scrollToTarget) {
        target.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "nearest",
          inline: "nearest",
        });
      }

      const bounds = target.getBoundingClientRect();
      const padding = 7;
      const rect = {
        x: Math.max(6, bounds.left - padding),
        y: Math.max(6, bounds.top - padding),
        width: Math.min(width - 12, bounds.width + padding * 2),
        height: Math.min(height - 12, bounds.height + padding * 2),
      };
      setSpotlight(rect);

      const cardWidth = Math.min(420, width - 32);
      const estimatedHeight = width <= 640 ? 310 : 270;
      const x = Math.min(
        Math.max(16, bounds.left + bounds.width / 2 - cardWidth / 2),
        Math.max(16, width - cardWidth - 16),
      );
      let y = bounds.bottom + 18;
      if (y + estimatedHeight > height - 16) y = bounds.top - estimatedHeight - 18;
      y = Math.min(Math.max(16, y), Math.max(16, height - estimatedHeight - 16));
      setPosition({ x, y, width: cardWidth });
    };

    timeout = window.setTimeout(() => measure(true), 100);
    const onViewportChange = () => measure();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, onNavigate, step]);

  const finish = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "complete");
    } catch {
      // The guide can still be dismissed when browser storage is unavailable.
    }
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      onClose();
    }, 180);
  }, [onClose]);

  const next = useCallback(() => {
    if (stepIndex >= STEPS.length - 1) {
      finish();
      return;
    }
    setStepIndex((current) => Math.min(current + 1, STEPS.length - 1));
  }, [finish, stepIndex]);

  const previous = useCallback(() => {
    setStepIndex((current) => Math.max(0, current - 1));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
      if (event.key === "ArrowRight") next();
      if (event.key === "ArrowLeft") previous();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finish, next, open, previous]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className={"vixiny-tour-layer" + (closing ? " is-closing" : "")}>
      {viewport.width > 0 && viewport.height > 0 ? (
        <svg
          className="vixiny-tour-dimmer"
          width={viewport.width}
          height={viewport.height}
          viewBox={`0 0 ${viewport.width} ${viewport.height}`}
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse">
              <rect width={viewport.width} height={viewport.height} fill="white" />
              {spotlight ? (
                <rect
                  x={spotlight.x}
                  y={spotlight.y}
                  width={spotlight.width}
                  height={spotlight.height}
                  rx="14"
                  fill="black"
                />
              ) : null}
            </mask>
          </defs>
          <rect
            width={viewport.width}
            height={viewport.height}
            fill="rgba(8, 7, 10, 0.76)"
            mask={`url(#${maskId})`}
          />
        </svg>
      ) : null}

      {spotlight ? (
        <div
          className="vixiny-tour-spotlight"
          style={{
            left: spotlight.x,
            top: spotlight.y,
            width: spotlight.width,
            height: spotlight.height,
          }}
          aria-hidden="true"
        />
      ) : null}

      <section
        className="vixiny-tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vixiny-tour-title"
        aria-describedby="vixiny-tour-description"
        style={{ left: position.x, top: position.y, width: position.width }}
      >
        <div className="vixiny-tour-card-top">
          <span className="vixiny-tour-eyebrow">{step.eyebrow}</span>
          <button type="button" className="vixiny-tour-skip" onClick={finish}>
            Skip tour
          </button>
        </div>

        <div className="vixiny-tour-progress" aria-label={`Step ${stepIndex + 1} of ${STEPS.length}`}>
          {STEPS.map((item, index) => (
            <span key={item.eyebrow} className={index <= stepIndex ? "is-complete" : ""} />
          ))}
        </div>

        <h2 id="vixiny-tour-title">{step.title}</h2>
        <p id="vixiny-tour-description">{step.description}</p>

        <div className="vixiny-tour-actions">
          <span className="vixiny-tour-step-count">
            {String(stepIndex + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
          </span>
          <div className="vixiny-tour-buttons">
            {stepIndex > 0 ? (
              <button type="button" className="vixiny-tour-back" onClick={previous}>
                Back
              </button>
            ) : null}
            <button type="button" className="vixiny-tour-next" onClick={next}>
              {stepIndex === STEPS.length - 1 ? "Got it" : "Next"}
              {stepIndex === STEPS.length - 1 ? null : <span aria-hidden="true">→</span>}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
