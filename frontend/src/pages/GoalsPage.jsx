import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";

export default function GoalsPage({ view }) {
  const {
    formatMoney,
    goalsData,
    goalCardsView,
    handleGoalStatus,
    openEditAction,
    openGoalRecord,
    openGoalRecords,
    goalPlanLabel,
    formatMonthLabel,
    selectedMonth,
    ChartRangeSwitch,
    chartRangeOptions,
    goalPlanRange,
    setGoalPlanRange,
    goalPlanView,
    ChartTooltip,
    goalAdvice,
  } = view;
  const [statusGroup, setStatusGroup] = useState("active");
  const groups = [
    { key: "active", label: "进行中", accepts: (goal) => !["completed", "archived"].includes(goal.status) },
    { key: "completed", label: "已完成", accepts: (goal) => goal.status === "completed" },
    { key: "archived", label: "已归档", accepts: (goal) => goal.status === "archived" },
  ];
  const visibleGoals = goalCardsView.filter(groups.find((group) => group.key === statusGroup).accepts);

  return (
    <>
                <section className="summary-grid goals-summary">
                  <article className="metric-card">
                    <span>目标总额</span>
                    <strong>{formatMoney(goalsData.target_total)}</strong>
                    <p>{goalCardsView.filter((goal) => goal.status !== "archived").length} 个未归档目标</p>
                  </article>
                  <article className="metric-card">
                    <span>已积累</span>
                    <strong className="positive">{formatMoney(goalsData.current_total)}</strong>
                    <p>总进度 <b className="positive">{goalsData.progress}%</b></p>
                  </article>
                  <article className="metric-card">
                    <span>每月计划储蓄</span>
                    <strong>{formatMoney(goalsData.monthly_saving)}</strong>
                    <p>{goalCardsView.length ? "作为计划参考，不重复计入总资产" : "暂无目标"}</p>
                  </article>
                </section>

                <section className="goals-page">
                  <div className="section-tabs goal-status-tabs" role="tablist" aria-label="目标状态">
                    {groups.map((group) => <button key={group.key} type="button" role="tab" aria-selected={statusGroup === group.key}
                      className={statusGroup === group.key ? "active" : ""} onClick={() => setStatusGroup(group.key)}>
                      {group.label} · {goalCardsView.filter(group.accepts).length}
                    </button>)}
                  </div>
                  <div className="goal-card-grid">
                    {visibleGoals.map((goal) => {
                      const percent = goal.target ? Math.round(goal.current / goal.target * 100) : 0;
                      return (
                        <article className="panel financial-goal-card" key={goal.id}>
                          <div className="goal-ring" style={{ "--goal-color": goal.color, "--goal-percent": `${Math.min(percent, 100)}%` }}>
                            <span>{percent}%</span>
                          </div>
                          <div className="goal-card-main">
                            <h3>{goal.icon} {goal.name}</h3>
                            <p>目标 {formatMoney(goal.target)} · {goal.target >= goal.current ? "剩余" : "超额"} {formatMoney(Math.abs(goal.target - goal.current))}</p>
                            <span className="goal-date-pill">{goal.due}</span>
                          </div>
                          <div className="goal-card-footer">
                            <span>已存 {formatMoney(goal.saved)}</span>
                            <span>每月 {formatMoney(goal.monthly)}{goal.note ? ` · ${goal.note}` : ""}</span>
                          </div>
                          <div className="goal-actions">
                            {statusGroup === "active" && <>
                              <button type="button" className="edit-button subtle" onClick={() => openGoalRecord(goal, "deposit")}>存入</button>
                              <button type="button" className="edit-button subtle" disabled={goal.current <= 0} onClick={() => openGoalRecord(goal, "withdraw")}>取出</button>
                            </>}
                            <button type="button" className="edit-button subtle" onClick={() => openGoalRecords(goal)}>记录</button>
                            <button type="button" className="edit-button subtle" onClick={() => openEditAction("goal", goal)}>编辑</button>
                            {statusGroup === "active" && (
                              <button type="button" className="edit-button subtle" onClick={() => handleGoalStatus(goal, "completed")}>完成</button>
                            )}
                            {statusGroup !== "archived" && <button type="button" className="edit-button subtle" onClick={() => handleGoalStatus(goal, "archived")}>归档</button>}
                            {statusGroup !== "active" && <button type="button" className="edit-button subtle" onClick={() => handleGoalStatus(goal, "active")}>恢复进行中</button>}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  {!visibleGoals.length && <div className="empty-state">暂无{groups.find((group) => group.key === statusGroup).label}目标。</div>}

                  <article className="panel goal-plan-panel">
                    <div className="panel-title">
                      <div>
                        <h3>目标积累进度</h3>
                        <p>{goalPlanLabel} · 截止 {formatMonthLabel(selectedMonth)} · 单位万元</p>
                      </div>
                      <div className="chart-legend">
                        <ChartRangeSwitch options={chartRangeOptions.goal} value={goalPlanRange} onChange={setGoalPlanRange} />
                        <span><i />实际积累</span>
                        <span><i />计划轨迹</span>
                      </div>
                    </div>
                    {goalPlanView.length ? (
                      <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={goalPlanView}>
                          <CartesianGrid stroke="#e9e1d4" vertical={false} />
                          <XAxis dataKey="period" axisLine={false} tickLine={false} />
                          <YAxis axisLine={false} tickLine={false} tickFormatter={(value) => `${value}w`} />
                          <Tooltip
                            content={
                              <ChartTooltip
                                title="目标积累进度"
                                names={{ actual: "实际积累", plan: "计划轨迹" }}
                                valueFormatter={(value) => `${value} 万`}
                              />
                            }
                            cursor={{ stroke: "#cbbda8", strokeDasharray: "4 4" }}
                          />
                          <Line dataKey="actual" stroke="#214f3b" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fffdf8" }} type="monotone" />
                          <Line dataKey="plan" stroke="#c8914b" strokeDasharray="5 4" strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fffdf8" }} type="monotone" />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="empty-state">暂无目标积累记录，创建目标后展示曲线。</div>
                    )}
                    <div className="goal-advice">{goalAdvice}</div>
                  </article>
                </section>
              </>
  );
}
