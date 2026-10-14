import { useLayoutEffect, useRef } from "react";
import { fitMetricValue } from "./metricValueFit";

export default function MetricValue({ children, className = "" }) {
  const valueRef = useRef(null);

  useLayoutEffect(() => {
    const element = valueRef.current;
    if (!element) return undefined;

    let frameId = 0;
    let active = true;
    const fit = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        if (active) fitMetricValue(element);
      });
    };

    fitMetricValue(element);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(fit);
    observer?.observe(element.parentElement || element);
    document.fonts?.ready.then(fit).catch(() => {});

    return () => {
      active = false;
      window.cancelAnimationFrame(frameId);
      observer?.disconnect();
    };
  }, [children]);

  const classes = ["metric-value", className].filter(Boolean).join(" ");
  return (
    <strong className={classes} ref={valueRef}>
      {children}
    </strong>
  );
}
