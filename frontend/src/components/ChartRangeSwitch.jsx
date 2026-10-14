export default function ChartRangeSwitch({ options, value, onChange }) {
  return (
    <div className="chart-range-switch" role="group" aria-label="图表时间范围">
      {options.map((option) => (
        <button
          type="button"
          className={value === option.value ? "active" : ""}
          aria-pressed={value === option.value}
          key={option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
