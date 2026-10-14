import { useState } from "react";
import {
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  calendarCells,
  calendarMonthForRange,
  createDateRange,
  DATE_RANGE_PRESETS,
  formatDateRange,
  formatDateValue,
  isValidDateRange,
  shiftMonth,
} from "../dateRanges";
import DialogActions, { DialogAction } from "./DialogActions";
import ModalBackdrop from "./ModalBackdrop";
import ModalPanel from "./ModalPanel";
import { todayInputValue } from "../shared/businessDate";

function monthTitle(value) {
  const [year, month] = value.split("-").map(Number);
  return `${year}年${month}月`;
}

export function DateRangeDialog({
  anchorMonth,
  onApply,
  onClose,
  value,
}) {
  const [draft, setDraft] = useState(value);
  const [calendarMonth, setCalendarMonth] = useState(
    calendarMonthForRange(value, anchorMonth),
  );
  const [selecting, setSelecting] = useState("start");
  const cells = calendarCells(calendarMonth);
  const today = todayInputValue();
  const valid = isValidDateRange(draft);

  const choosePreset = (preset) => {
    const next = createDateRange(preset, anchorMonth);
    setDraft(next);
    setCalendarMonth(
      preset === "selected_year"
        ? anchorMonth
        : calendarMonthForRange(next, anchorMonth),
    );
    setSelecting("start");
  };

  const chooseDate = (date) => {
    if (selecting === "start") {
      const keepEnd = draft.preset === "custom" && draft.dateTo >= date
        ? draft.dateTo
        : "";
      setDraft({ preset: "custom", dateFrom: date, dateTo: keepEnd });
      setSelecting(keepEnd ? "start" : "end");
      return;
    }
    const dateFrom = draft.dateFrom || date;
    setDraft({
      preset: "custom",
      dateFrom: date < dateFrom ? date : dateFrom,
      dateTo: date < dateFrom ? dateFrom : date,
    });
    setSelecting("start");
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <ModalPanel
        className="date-range-dialog"
        eyebrow="账本筛选"
        footer={(
          <DialogActions>
            <DialogAction onClick={() => choosePreset("selected_month")}>重置为所选月</DialogAction>
            <DialogAction
              variant="primary"
              disabled={!valid}
              onClick={() => {
                onApply(draft);
                onClose();
              }}
            >
              <Check size={16} />
              应用日期
            </DialogAction>
          </DialogActions>
        )}
        onClose={onClose}
        title="筛选流水日期"
      >
        <div className="date-range-current" aria-live="polite">
          <CalendarRange size={18} aria-hidden="true" />
          <div>
            <span>当前范围</span>
            <strong>{formatDateRange(draft, anchorMonth)}</strong>
          </div>
        </div>

        <div className="date-range-presets" aria-label="快捷日期范围">
          {DATE_RANGE_PRESETS.map((preset) => (
            <button
              type="button"
              className={draft.preset === preset.key ? "active" : ""}
              key={preset.key}
              aria-pressed={draft.preset === preset.key}
              onClick={() => choosePreset(preset.key)}
            >
              <span>
                <strong>{preset.label}</strong>
                <small>{preset.description}</small>
              </span>
              {draft.preset === preset.key ? <Check size={15} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>

        <section className="date-range-custom" aria-labelledby="custom-range-title">
          <div className="date-range-section-heading">
            <div>
              <h3 id="custom-range-title">自定义范围</h3>
              <p>依次选择开始和结束日期，可跨月设置。</p>
            </div>
            <span>{selecting === "start" ? "请选择开始日期" : "请选择结束日期"}</span>
          </div>

          <div className="date-range-boundaries">
            <button
              type="button"
              className={selecting === "start" ? "active" : ""}
              onClick={() => setSelecting("start")}
            >
              <span>开始日期</span>
              <strong>{formatDateValue(draft.dateFrom)}</strong>
            </button>
            <i aria-hidden="true">至</i>
            <button
              type="button"
              className={selecting === "end" ? "active" : ""}
              onClick={() => setSelecting("end")}
            >
              <span>结束日期</span>
              <strong>{formatDateValue(draft.dateTo)}</strong>
            </button>
          </div>

          <div className="date-range-calendar">
            <div className="date-range-calendar-toolbar">
              <button
                type="button"
                aria-label="上个月"
                onClick={() => setCalendarMonth((current) => shiftMonth(current, -1))}
              >
                <ChevronLeft size={18} />
              </button>
              <strong>{monthTitle(calendarMonth)}</strong>
              <button
                type="button"
                aria-label="下个月"
                onClick={() => setCalendarMonth((current) => shiftMonth(current, 1))}
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="date-range-weekdays" aria-hidden="true">
              {["日", "一", "二", "三", "四", "五", "六"].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="date-range-days">
              {cells.map((cell) => {
                const isStart = cell.date === draft.dateFrom;
                const isEnd = cell.date === draft.dateTo;
                const inRange = draft.dateFrom && draft.dateTo
                  && cell.date > draft.dateFrom && cell.date < draft.dateTo;
                return (
                  <button
                    type="button"
                    className={[
                      cell.inCurrentMonth ? "" : "outside",
                      cell.date === today ? "today" : "",
                      inRange ? "in-range" : "",
                      isStart || isEnd ? "range-edge" : "",
                    ].filter(Boolean).join(" ")}
                    key={cell.date}
                    aria-label={formatDateValue(cell.date)}
                    aria-pressed={isStart || isEnd}
                    onClick={() => chooseDate(cell.date)}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </ModalPanel>
    </ModalBackdrop>
  );
}

export default function DateRangeFilter({
  anchorMonth,
  onChange,
  value,
}) {
  const [open, setOpen] = useState(false);
  const label = formatDateRange(value, anchorMonth);

  return (
    <>
      <button
        type="button"
        className="date-range-filter-trigger"
        aria-label={`日期范围：${label}`}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <CalendarRange size={16} aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open ? (
        <DateRangeDialog
          anchorMonth={anchorMonth}
          onApply={onChange}
          onClose={() => setOpen(false)}
          value={value}
        />
      ) : null}
    </>
  );
}
