import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

const focusLayers = [];
const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(panel) {
  return Array.from(panel.querySelectorAll(focusableSelector))
    .filter((element) => element.getAttribute("aria-hidden") !== "true");
}

export default function ModalPanel({
  bodyClassName = "",
  children,
  className = "",
  closeDisabled = false,
  eyebrow = "",
  footer = null,
  initialFocusSelector = "",
  onClose,
  title,
  titleId,
  variant = "modal",
}) {
  const generatedTitleId = useId();
  const headingId = titleId || generatedTitleId;
  const footerRef = useRef(null);
  const panelRef = useRef(null);
  const layerRef = useRef(Symbol("focus-layer"));
  const restoreTargetRef = useRef(
    typeof document === "undefined" ? null : document.activeElement,
  );
  const hasFooter = Boolean(footer);
  const isDatePicker = variant === "date-picker";
  const panelClassName = isDatePicker ? "date-picker-card" : "modal-card";
  const headerClassName = isDatePicker ? "date-picker-title" : "modal-title";

  useEffect(() => {
    const panel = panelRef.current;
    const layer = layerRef.current;
    const restoreTarget = restoreTargetRef.current;
    focusLayers.push(layer);

    const activeElement = document.activeElement;
    const focusable = focusableElements(panel);
    const bodyFocusable = focusableElements(
      panel.querySelector(".dialog-panel-body"),
    );
    const preferredFocus = initialFocusSelector
      ? panel.querySelector(initialFocusSelector)
      : null;
    const initialFocus = panel.contains(activeElement) && activeElement !== panel
      ? activeElement
      : preferredFocus
        || focusable.find((element) => element.autofocus)
        || bodyFocusable[0]
        || focusable[0]
        || panel;
    initialFocus.focus();

    const trapFocus = (event) => {
      if (event.key !== "Tab" || focusLayers.at(-1) !== layer) return;
      const focusable = focusableElements(panel);
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.removeEventListener("keydown", trapFocus);
      const index = focusLayers.lastIndexOf(layer);
      const wasTopLayer = index === focusLayers.length - 1;
      if (index >= 0) focusLayers.splice(index, 1);
      if (
        wasTopLayer
        && restoreTarget instanceof HTMLElement
        && restoreTarget.isConnected
        && !restoreTarget.hasAttribute("disabled")
      ) {
        restoreTarget.focus();
      }
    };
  }, [initialFocusSelector]);

  useEffect(() => {
    const panel = panelRef.current;
    const footerElement = footerRef.current;
    if (!panel || !footerElement) return undefined;

    const updateFooterHeight = () => {
      panel.style.setProperty(
        "--dialog-footer-height",
        `${footerElement.getBoundingClientRect().height}px`,
      );
    };
    updateFooterHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateFooterHeight);
      return () => {
        window.removeEventListener("resize", updateFooterHeight);
        panel.style.removeProperty("--dialog-footer-height");
      };
    }

    const observer = new ResizeObserver(updateFooterHeight);
    observer.observe(footerElement);
    return () => {
      observer.disconnect();
      panel.style.removeProperty("--dialog-footer-height");
    };
  }, [hasFooter]);

  return (
    <section
      ref={panelRef}
      className={`${panelClassName} dialog-panel${className ? ` ${className}` : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      tabIndex={-1}
    >
      <header className={`${headerClassName} dialog-panel-header`}>
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2 id={headingId}>{title}</h2>
        </div>
        <button
          type="button"
          className="modal-close"
          disabled={closeDisabled}
          onClick={onClose}
          aria-label="关闭"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className={`dialog-panel-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>
        {children}
      </div>
      {footer ? (
        <footer ref={footerRef} className="dialog-panel-footer">{footer}</footer>
      ) : null}
    </section>
  );
}
