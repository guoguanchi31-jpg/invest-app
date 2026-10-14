import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useRef, useState } from "react";
import {
  Archive,
  CheckCircle2,
  CircleMinus,
  CirclePlus,
  History,
  MoreHorizontal,
  Pencil,
  RotateCcw,
} from "lucide-react";
import MetricValue from "../components/MetricValue";
import SegmentedTabs from "../components/SegmentedTabs";

export default function GoalsPage({ view }) {
  const {
    formatMoney,
    goalsData,
    goalCardsView,
    dataScope,
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
  const [openMenuGoalId, setOpenMenuGoalId] = useState(null);
  const [loadingRecordsGoalId, setLoadingRecordsGoalId] = useState(null);
  const [updatingGoalId, setUpdatingGoalId] = useState(null);
  const statusOperationRef = useRef(0);
  const groups = [
    { key: "active", label: "进行中", accepts: (goal) => !["completed", "archived"].includes(goal.status) },
    { key: "completed", label: "已完成", accepts: (goal) => goal.status === "completed" },
    { key: "archived", label: "已归档", accepts: (goal) => goal.status === "archived" },
  ];
  const visibleGoals = goalCardsView.filter(groups.find((group) => group.key === statusGroup).accepts);

  useEffect(() => {
    if (openMenuGoalId === null) return undefined;
    const closeOnPointerDown = (event) => {
      if (!event.target.closest?.(".goal-menu-shell")) setOpenMenuGoalId(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpenMenuGoalId(null);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenuGoalId]);

  const showGoalRecords = async (goal) => {
    if (loadingRecordsGoalId !== null) return;
    setLoadingRecordsGoalId(goal.id);
    try {
      await openGoalRecords(goal);
    } finally {
      setLoadingRecordsGoalId(null);
    }
  };

  const updateGoalStatus = async (goal, status) => {
    if (updatingGoalId !== null) return;
    const operation = ++statusOperationRef.current;
    const releaseWriteLock = () => {
      if (statusOperationRef.current === operation) {
        setUpdatingGoalId(null);
      }
    };
    setOpenMenuGoalId(null);
    setUpdatingGoalId(goal.id);
    try {
      await handleGoalStatus(goal, status, releaseWriteLock);
    } finally {
      releaseWriteLock();
    }
  };

  const editGoal = (goal) => {
    setOpenMenuGoalId(null);
    openEditAction("goal", goal);
  };

  return (
    <>
                <section className="summary-grid summary-grid--three goals-summary">
                  <article className="metric-card">
                    <span>{dataScope === "family" ? "家庭目标总额" : "我的目标份额"} · {goalCardsView.filter((goal) => goal.status !== "archived").length} 项</span>
                    <MetricValue>{formatMoney(goalsData.target_total ?? 0)}</MetricValue>
                  </article>
                  <article className="metric-card">
                    <span>已积累 · {goalsData.progress ?? 0}%</span>
                    <MetricValue className="positive">{formatMoney(goalsData.current_total ?? 0)}</MetricValue>
                  </article>
                  <article className="metric-card">
                    <span>每月计划储蓄</span>
                    <MetricValue>{formatMoney(goalsData.monthly_saving ?? 0)}</MetricValue>
                  </article>
                </section>

                <section className="goals-page">
                  <SegmentedTabs
                    ariaLabel="目标状态"
                    className="section-tabs goal-status-tabs"
                    idPrefix="goal-status"
                    onChange={(nextGroup) => {
                      setStatusGroup(nextGroup);
                      setOpenMenuGoalId(null);
                    }}
                    options={groups.map((group) => ({
                      value: group.key,
                      label: <>
                        <span>{group.label}</span>
                        <b>{goalCardsView.filter(group.accepts).length}</b>
                      </>,
                    }))}
                    value={statusGroup}
                  />
                  <div
                    className="goal-card-grid"
                    id={`goal-status-panel-${statusGroup}`}
                    role="tabpanel"
                    aria-labelledby={`goal-status-tab-${statusGroup}`}
                  >
                    {visibleGoals.map((goal) => {
                      const percent = goal.target ? Math.round(goal.current / goal.target * 100) : 0;
                      const canEdit = goal.can_edit !== false;
                      const canTransact = Boolean(goal.can_contribute) && !["completed", "archived"].includes(goal.status);
                      const isBusy = updatingGoalId === goal.id;
                      return (
                        <article className="panel financial-goal-card" key={goal.id}>
                          <div className="goal-ring" style={{ "--goal-color": goal.color, "--goal-percent": `${Math.min(percent, 100)}%` }}>
                            <span>{percent}%</span>
                          </div>
                          <div className="goal-card-main">
                            <h3>{goal.icon} {goal.name}</h3>
                            <p>
                              目标 {formatMoney(goal.target)} · {goal.target >= goal.current ? "剩余" : "超额"} {formatMoney(Math.abs(goal.target - goal.current))}
                            </p>
                            <span className="goal-date-pill">{goal.due}</span>
                          </div>
                          <div className="goal-card-footer">
                            <div className="goal-card-stats">
                              <span>已存 {formatMoney(goal.saved)}</span>
                              <span>每月 {formatMoney(goal.monthly)}{goal.note ? ` · ${goal.note}` : ""}</span>
                            </div>
                            <button
                              type="button"
                              className="goal-history-button"
                              disabled={loadingRecordsGoalId !== null}
                              onClick={() => showGoalRecords(goal)}
                            >
                              <History size={15} />
                              {loadingRecordsGoalId === goal.id ? "加载中…" : "查看记录"}
                            </button>
                          </div>
                          {dataScope === "family" && goal.allocations?.length > 0 && (
                            <div className="goal-member-shares">
                              {goal.allocations.map((allocation) => (
                                <div key={allocation.member_id}>
                                  <span>{allocation.member_name}</span>
                                  <strong>{formatMoney(allocation.target_amount)}</strong>
                                  <small>已存 {formatMoney(allocation.current_amount)} · 每月 {formatMoney(allocation.monthly_saving)}</small>
                                </div>
                              ))}
                            </div>
                          )}
                          {(canTransact || canEdit) && <div className="goal-action-bar">
                            <div className="goal-money-actions">
                              {canTransact ? (
                                <>
                                  <button type="button" className="goal-action-button primary" onClick={() => openGoalRecord(goal, "deposit")}>
                                    <CirclePlus size={16} /> 存入
                                  </button>
                                  <button type="button" className="goal-action-button" disabled={goal.current <= 0} onClick={() => openGoalRecord(goal, "withdraw")}>
                                    <CircleMinus size={16} /> 取出
                                  </button>
                                </>
                              ) : canEdit ? (
                                <button type="button" className="goal-action-button primary" disabled={isBusy} onClick={() => updateGoalStatus(goal, "active")}>
                                  <RotateCcw size={15} /> {isBusy ? "恢复中…" : "恢复"}
                                </button>
                              ) : null}
                            </div>
                            {canEdit && <div className="goal-menu-shell">
                              <button
                                type="button"
                                className="row-icon-button"
                                aria-label={`${goal.name}更多操作`}
                                aria-haspopup="menu"
                                aria-expanded={openMenuGoalId === goal.id}
                                aria-controls={`goal-menu-${goal.id}`}
                                onClick={() => setOpenMenuGoalId((current) => current === goal.id ? null : goal.id)}
                              >
                                <MoreHorizontal size={18} />
                              </button>
                              {openMenuGoalId === goal.id && (
                                <div id={`goal-menu-${goal.id}`} className="goal-action-menu" role="menu" aria-label={`${goal.name}操作`}>
                                  <button type="button" role="menuitem" onClick={() => editGoal(goal)}>
                                    <Pencil size={15} /> 编辑目标
                                  </button>
                                  {canTransact && (
                                    <button type="button" role="menuitem" disabled={isBusy} onClick={() => updateGoalStatus(goal, "completed")}>
                                      <CheckCircle2 size={15} /> 标记完成
                                    </button>
                                  )}
                                  {goal.status !== "archived" && (
                                    <button type="button" role="menuitem" className="danger" disabled={isBusy} onClick={() => updateGoalStatus(goal, "archived")}>
                                      <Archive size={15} /> 归档目标
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>}
                          </div>}
                        </article>
                      );
                    })}
                  </div>
                  {!visibleGoals.length && <div className="empty-state">暂无{groups.find((group) => group.key === statusGroup).label}目标。</div>}

                  <article className="panel goal-plan-panel">
                    <div className="panel-title chart-panel-title">
                      <div>
                        <h3>目标积累进度</h3>
                        <p>{goalPlanLabel} · 截止 {formatMonthLabel(selectedMonth)} · 单位万元</p>
                      </div>
                      <div className="chart-title-actions">
                        <ChartRangeSwitch options={chartRangeOptions.goal} value={goalPlanRange} onChange={setGoalPlanRange} />
                        <div className="chart-legend">
                          <span><i />实际积累</span>
                          <span><i />计划轨迹</span>
                        </div>
                      </div>
                    </div>
                    {goalPlanView.length ? (
                      <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={goalPlanView}>
                          <CartesianGrid stroke="#dce3e0" vertical={false} />
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
                            cursor={{ stroke: "#9eaaa4", strokeDasharray: "4 4" }}
                          />
                          <Line dataKey="actual" stroke="#176b4d" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 5, strokeWidth: 2, stroke: "#ffffff" }} type="monotone" />
                          <Line dataKey="plan" stroke="#b77a22" strokeDasharray="5 4" strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#ffffff" }} type="monotone" />
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
