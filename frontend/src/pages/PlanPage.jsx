import BudgetPage from "./BudgetPage";
import GoalsPage from "./GoalsPage";
import SegmentedTabs from "../components/SegmentedTabs";

const planTabs = [
  { value: "budget", label: "月度预算" },
  { value: "goals", label: "储蓄目标" },
];

export default function PlanPage({ view }) {
  const { canManagePlans, openAction, planSection, setPlanSection } = view;

  return (
    <>
      <div className="section-toolbar">
        <SegmentedTabs
          ariaLabel="计划视图"
          idPrefix="plan"
          onChange={setPlanSection}
          options={planTabs}
          value={planSection}
        />
        {canManagePlans && (
          <button type="button" className="filter-button primary" onClick={() => openAction(planSection === "budget" ? "budget" : "goal")}>
            {planSection === "budget" ? "设置预算" : "创建目标"}
          </button>
        )}
      </div>
      <div
        id={`plan-panel-${planSection}`}
        role="tabpanel"
        aria-labelledby={`plan-tab-${planSection}`}
      >
        {planSection === "budget" ? <BudgetPage view={view} /> : <GoalsPage view={view} />}
      </div>
    </>
  );
}
