import BudgetPage from "./BudgetPage";
import GoalsPage from "./GoalsPage";

export default function PlanPage({ view }) {
  const { openAction, planSection, setPlanSection } = view;

  return (
    <>
      <div className="section-toolbar">
        <div className="section-tabs" role="tablist" aria-label="计划视图">
          <button type="button" className={planSection === "budget" ? "active" : ""} onClick={() => setPlanSection("budget")}>
            月度预算
          </button>
          <button type="button" className={planSection === "goals" ? "active" : ""} onClick={() => setPlanSection("goals")}>
            储蓄目标
          </button>
        </div>
        <button type="button" className="filter-button primary" onClick={() => openAction(planSection === "budget" ? "budget" : "goal")}>
          {planSection === "budget" ? "设置预算" : "创建目标"}
        </button>
      </div>
      {planSection === "budget" ? <BudgetPage view={view} /> : <GoalsPage view={view} />}
    </>
  );
}
