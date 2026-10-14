import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
} from "react";

export const AppNumberFieldContext = createContext(null);

export function useAppNumberFieldContext() {
  return useContext(AppNumberFieldContext);
}

export function fieldDescriptor({
  allowNegative = false,
  decimalScale,
  fieldKey,
  inputMode = "decimal",
  label,
  maxLength,
  prefix = "",
  suffix = "",
}) {
  return {
    allowNegative,
    decimalScale: decimalScale ?? (inputMode === "numeric" ? 0 : 2),
    key: fieldKey,
    label,
    maxLength,
    prefix,
    suffix,
  };
}

export function appNumberInputProps({
  activeField,
  allowNegative,
  className = "",
  decimalScale,
  disabled,
  fieldKey,
  inputMode,
  label,
  maxLength,
  onActivate,
  prefix,
  suffix,
}) {
  const descriptor = fieldDescriptor({
    allowNegative,
    decimalScale,
    fieldKey,
    inputMode,
    label,
    maxLength,
    prefix,
    suffix,
  });
  const activate = (event) => {
    if (disabled) return;
    onActivate(descriptor);
    const input = event.currentTarget;
    const schedule = globalThis.requestAnimationFrame
      || ((callback) => callback());
    schedule(() => {
      const scroller = input.closest(".dialog-panel-body");
      if (scroller && typeof scroller.scrollTo === "function") {
        const inputBounds = input.getBoundingClientRect();
        const scrollerBounds = scroller.getBoundingClientRect();
        const centeredTop = scroller.scrollTop
          + inputBounds.top
          - scrollerBounds.top
          - (scroller.clientHeight - inputBounds.height) / 2;
        scroller.scrollTo({
          behavior: "smooth",
          top: Math.max(0, centeredTop),
        });
        return;
      }
      input.scrollIntoView?.({ behavior: "smooth", block: "center" });
    });
  };
  return {
    "aria-current": activeField?.key === fieldKey ? "true" : undefined,
    "data-app-number-field": "true",
    inputMode: "none",
    readOnly: true,
    className: [
      className,
      "app-number-field-input",
      activeField?.key === fieldKey ? "is-active" : "",
    ].filter(Boolean).join(" "),
    onClick: activate,
    onFocus: activate,
  };
}

export function enhanceFormNumberInput(children, label, context) {
  if (
    !context
    || !isValidElement(children)
    || children.type !== "input"
    || !children.props.name
    || !["decimal", "numeric"].includes(children.props.inputMode)
  ) {
    return children;
  }
  const childProps = children.props;
  return cloneElement(children, appNumberInputProps({
    activeField: context.activeField,
    allowNegative: childProps["data-allow-negative"] === true,
    className: childProps.className,
    decimalScale: childProps["data-decimal-scale"],
    disabled: childProps.disabled,
    fieldKey: childProps.name,
    inputMode: childProps.inputMode,
    label,
    maxLength: childProps.maxLength,
    onActivate: context.onActivate,
    prefix: childProps["data-number-prefix"] || "",
    suffix: childProps["data-number-suffix"] || "",
  }));
}
