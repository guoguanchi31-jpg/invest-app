import { useRef } from "react";

export default function SegmentedTabs({
  ariaLabel,
  className = "section-tabs",
  idPrefix,
  onChange,
  options,
  value,
}) {
  const tabsRef = useRef([]);
  const selectAt = (index) => {
    const nextIndex = (index + options.length) % options.length;
    onChange(options[nextIndex].value);
    tabsRef.current[nextIndex]?.focus();
  };

  return (
    <div className={className} role="tablist" aria-label={ariaLabel}>
      {options.map((option, index) => {
        const selected = value === option.value;
        return (
          <button
            ref={(node) => {
              tabsRef.current[index] = node;
            }}
            type="button"
            id={`${idPrefix}-tab-${option.value}`}
            role="tab"
            aria-controls={`${idPrefix}-panel-${option.value}`}
            aria-selected={selected}
            className={selected ? "active" : ""}
            key={option.value}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                selectAt(index + 1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                selectAt(index - 1);
              } else if (event.key === "Home") {
                event.preventDefault();
                selectAt(0);
              } else if (event.key === "End") {
                event.preventDefault();
                selectAt(options.length - 1);
              }
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
