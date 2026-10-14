import { Children } from "react";

export function DialogAction({
  children,
  className = "",
  type = "button",
  variant = "secondary",
  ...props
}) {
  return (
    <button
      {...props}
      type={type}
      className={`dialog-action-button ${variant}${className ? ` ${className}` : ""}`}
    >
      {children}
    </button>
  );
}

export default function DialogActions({ children, className = "" }) {
  const actions = Children.toArray(children);
  const count = Math.min(Math.max(actions.length, 1), 3);
  return (
    <div className={`modal-actions dialog-action-bar action-count-${count}${className ? ` ${className}` : ""}`}>
      {actions}
    </div>
  );
}
