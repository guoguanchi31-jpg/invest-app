import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import ModalBackdrop from "./ModalBackdrop";
import ModalPanel from "./ModalPanel";

function fallbackIcon(direction) {
  return direction === "income" ? "💰" : "🧾";
}

export default function CategoryPicker({
  categories = [],
  direction = "expense",
  onChange,
  value = "",
}) {
  const [isOpen, setIsOpen] = useState(false);
  const options = useMemo(() => {
    const matching = categories.filter((category) => category.type === direction);
    if (!value || matching.some((category) => category.name === value)) return matching;
    return [{ id: `legacy-${value}`, name: value, icon: "•" }, ...matching];
  }, [categories, direction, value]);
  const selected = options.find((category) => category.name === value);

  const choose = (nextValue) => {
    onChange({ target: { name: "category_name", value: nextValue } });
    setIsOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className={`category-picker-trigger${value ? "" : " empty"}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={value ? `分类：${value}` : "选择分类"}
        onClick={() => setIsOpen(true)}
      >
        <span aria-hidden="true">
          {selected?.icon && selected.icon !== "•" ? selected.icon : fallbackIcon(direction)}
        </span>
        <b>{value || "选择分类"}</b>
        <ChevronDown size={17} aria-hidden="true" />
      </button>
      {isOpen && createPortal(
        <ModalBackdrop className="category-picker-layer" onClose={() => setIsOpen(false)}>
          <ModalPanel
            bodyClassName="category-picker-body"
            className="category-picker-dialog"
            eyebrow={direction === "income" ? "收入分类" : "支出分类"}
            onClose={() => setIsOpen(false)}
            title="选择分类"
          >
            <div className="category-picker-options" role="listbox" aria-label="可用分类">
              <button
                type="button"
                className={!value ? "selected" : ""}
                role="option"
                aria-selected={!value}
                onClick={() => choose("")}
              >
                <i aria-hidden="true">—</i>
                <span>不选择分类</span>
                {!value ? <Check size={17} aria-hidden="true" /> : null}
              </button>
              {options.map((category) => {
                const isSelected = category.name === value;
                return (
                  <button
                    type="button"
                    className={isSelected ? "selected" : ""}
                    key={category.id ?? category.name}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => choose(category.name)}
                    style={{ "--category-color": category.color || "#176b4d" }}
                  >
                    <i aria-hidden="true">
                      {category.icon && category.icon !== "•"
                        ? category.icon
                        : fallbackIcon(direction)}
                    </i>
                    <span>{category.name}</span>
                    {isSelected ? <Check size={17} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
            {!options.length ? (
              <p className="category-picker-empty">当前没有可用的{direction === "income" ? "收入" : "支出"}分类</p>
            ) : null}
          </ModalPanel>
        </ModalBackdrop>,
        document.body,
      )}
    </>
  );
}
