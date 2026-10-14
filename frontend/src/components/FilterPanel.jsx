import { ChevronDown, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { useId, useState } from "react";

export function FilterSearch({ label, onChange, placeholder, value }) {
  return (
    <div className="filter-search">
      <Search size={17} aria-hidden="true" />
      <input
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button type="button" aria-label={`清空${label}`} title={`清空${label}`} onClick={() => onChange("")}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}

export function FilterField({ children, label }) {
  return (
    <div className="filter-field" role="group" aria-label={label}>
      <span>{label}</span>
      {children}
    </div>
  );
}

export default function FilterPanel({
  activeFilters = [],
  children,
  className = "",
  onReset,
  search,
  searchActive = false,
}) {
  const [expanded, setExpanded] = useState(false);
  const controlsId = useId();
  const activeCount = activeFilters.length + (searchActive ? 1 : 0);

  return (
    <div className={`compact-filter-panel${expanded ? " is-expanded" : ""}${className ? ` ${className}` : ""}`}>
      <div className="compact-filter-primary">
        {search}
        <button
          type="button"
          className="compact-filter-toggle"
          aria-controls={controlsId}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <SlidersHorizontal size={16} />
          <span>{expanded ? "收起" : "筛选"}</span>
          {activeCount > 0 && <b>{activeCount}</b>}
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </div>

      <div id={controlsId} className="compact-filter-controls">
        {children}
      </div>

      {activeCount > 0 && (
        <div className="compact-filter-active" aria-label="已启用筛选">
          {activeFilters.map((filter) => (
            <button
              type="button"
              className="filter-chip"
              key={filter.key}
              aria-label={`移除筛选：${filter.label}`}
              onClick={filter.onRemove}
            >
              <span>{filter.label}</span>
              <X size={13} />
            </button>
          ))}
          <button type="button" className="filter-reset" onClick={onReset}>
            <RotateCcw size={13} />
            重置
          </button>
        </div>
      )}
    </div>
  );
}
