import {
  BarChart3,
  Landmark,
  LockKeyhole,
  LogIn,
  PiggyBank,
  Play,
  ReceiptText,
  Target,
  WalletCards,
} from "lucide-react";
import SegmentedTabs from "../components/SegmentedTabs";

const guestMetrics = {
  dashboard: ["净资产", "本月收入", "本月支出", "本月结余"],
  ledger: ["本期收入", "本期支出", "收支结余"],
  accounts: ["资产账户合计", "负债账户合计", "净资产"],
  investments: ["投资总市值", "累计收益", "可用现金"],
  budget: ["月度总预算", "本月已支出", "剩余可用"],
  goals: ["目标总额", "已积累", "每月计划储蓄"],
};

const assetTabs = [
  { value: "accounts", label: "账户与负债" },
  { value: "investments", label: "投资持仓" },
];

const planTabs = [
  { value: "budget", label: "月度预算" },
  { value: "goals", label: "储蓄目标" },
];

function MaskedValue() {
  return <strong className="guest-masked-value" aria-label="登录后查看">••••••</strong>;
}

function GuestMetrics({ items }) {
  return (
    <section className={`summary-grid guest-summary-grid${items.length === 3 ? " summary-grid--three" : ""}`}>
      {items.map((label) => (
        <article className="metric-card guest-metric-card" key={label}>
          <span>{label}</span>
          <MaskedValue />
        </article>
      ))}
    </section>
  );
}

function GuestAccessBanner({ onEnterGuest, onLogin }) {
  return (
    <section className="guest-access-banner" role="status">
      <div className="guest-access-copy">
        <span className="guest-access-icon"><LockKeyhole size={18} /></span>
        <div>
          <strong>账本数据已锁定</strong>
          <span>登录账号后显示个人与家庭数据</span>
        </div>
      </div>
      <div className="guest-access-actions">
        <button type="button" className="filter-button primary" onClick={onEnterGuest}>
          <Play size={16} /> 游客体验
        </button>
        <button type="button" className="filter-button" onClick={onLogin}>
          <LogIn size={16} /> 登录真实账本
        </button>
      </div>
    </section>
  );
}

function GuestChart({ variant = "bars" }) {
  const heights = variant === "line"
    ? [34, 43, 39, 58, 52, 68, 63, 79]
    : [42, 68, 51, 74, 61, 83, 56, 72];
  return (
    <div className={`guest-chart-placeholder ${variant}`} aria-hidden="true">
      {heights.map((height, index) => (
        <span key={`${height}-${index}`} style={{ "--guest-height": `${height}%` }} />
      ))}
    </div>
  );
}

function GuestRows({ count = 4, icon: Icon = ReceiptText, labels = [] }) {
  return (
    <div className="guest-preview-rows" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="guest-preview-row" key={index}>
          <span className="guest-row-icon"><Icon size={17} /></span>
          <div>
            <strong>{labels[index] || "登录后查看"}</strong>
            <span className="guest-placeholder-line short" />
          </div>
          <span className="guest-placeholder-line amount" />
        </div>
      ))}
    </div>
  );
}

function DashboardPreview() {
  return (
    <>
      <GuestMetrics items={guestMetrics.dashboard} />
      <section className="dashboard-grid guest-dashboard-grid">
        <article className="panel chart-panel">
          <div className="panel-title">
            <div>
              <h3>净资产趋势</h3>
              <p>近 12 月</p>
            </div>
            <BarChart3 size={19} />
          </div>
          <GuestChart variant="line" />
        </article>
        <article className="panel transaction-panel">
          <div className="panel-title">
            <div><h3>最近交易</h3></div>
          </div>
          <GuestRows count={3} />
        </article>
        <article className="panel budget-panel">
          <div className="panel-title">
            <div>
              <h3>本月预算</h3>
              <p>登录后显示预算执行进度</p>
            </div>
          </div>
          <div className="progress-track guest-progress-track"><span /></div>
          <div className="guest-budget-labels" aria-hidden="true">
            <span className="guest-placeholder-line" />
            <span className="guest-placeholder-line short" />
          </div>
        </article>
        <article className="panel goal-panel">
          <div className="panel-title">
            <div><h3>目标进度</h3></div>
          </div>
          <GuestRows count={2} icon={Target} />
        </article>
      </section>
    </>
  );
}

function LedgerPreview() {
  return (
    <>
      <GuestMetrics items={guestMetrics.ledger} />
      <article className="panel guest-ledger-panel">
        <div className="panel-title">
          <div>
            <h3>流水明细</h3>
            <p>收入、支出、转账与调整记录</p>
          </div>
          <ReceiptText size={19} />
        </div>
        <div className="guest-ledger-head" aria-hidden="true">
          <span>日期</span>
          <span>分类与账户</span>
          <span>金额</span>
        </div>
        <GuestRows count={5} labels={["收支记录", "账户划转", "日常消费", "收入记录", "余额调整"]} />
      </article>
    </>
  );
}

function AccountsPreview({ assetSection, setAssetSection }) {
  const isAccounts = assetSection === "accounts";
  return (
    <>
      <div className="section-toolbar guest-section-toolbar">
        <SegmentedTabs
          ariaLabel="资产预览"
          idPrefix="guest-assets"
          onChange={setAssetSection}
          options={assetTabs}
          value={assetSection}
        />
      </div>
      <GuestMetrics items={guestMetrics[assetSection]} />
      <section className="guest-two-column-grid">
        <article className="panel">
          <div className="panel-title">
            <div>
              <h3>{isAccounts ? "账户概览" : "持仓概览"}</h3>
              <p>{isAccounts ? "按成员与账户类型归集" : "按账户与资产类型归集"}</p>
            </div>
            {isAccounts ? <WalletCards size={19} /> : <Landmark size={19} />}
          </div>
          <GuestRows
            count={4}
            icon={isAccounts ? WalletCards : Landmark}
            labels={isAccounts ? ["储蓄账户", "电子钱包", "信用账户", "投资账户"] : ["股票持仓", "基金持仓", "现金余额", "交易记录"]}
          />
        </article>
        <article className="panel">
          <div className="panel-title">
            <div>
              <h3>{isAccounts ? "账户余额分布" : "资产配置"}</h3>
              <p>登录后显示实际占比</p>
            </div>
          </div>
          <GuestChart />
        </article>
      </section>
    </>
  );
}

function PlanPreview({ planSection, setPlanSection }) {
  const isBudget = planSection === "budget";
  return (
    <>
      <div className="section-toolbar guest-section-toolbar">
        <SegmentedTabs
          ariaLabel="计划预览"
          idPrefix="guest-plan"
          onChange={setPlanSection}
          options={planTabs}
          value={planSection}
        />
      </div>
      <GuestMetrics items={guestMetrics[planSection]} />
      <section className="guest-two-column-grid">
        <article className="panel">
          <div className="panel-title">
            <div>
              <h3>{isBudget ? "预算执行" : "目标进度"}</h3>
              <p>{isBudget ? "成员月度预算与使用进度" : "储蓄计划与积累记录"}</p>
            </div>
            {isBudget ? <PiggyBank size={19} /> : <Target size={19} />}
          </div>
          <GuestRows
            count={4}
            icon={isBudget ? PiggyBank : Target}
            labels={isBudget ? ["餐饮预算", "交通预算", "居住预算", "其他预算"] : ["应急储备", "旅行计划", "长期目标", "家庭目标"]}
          />
        </article>
        <article className="panel">
          <div className="panel-title">
            <div>
              <h3>{isBudget ? "预算使用节奏" : "积累趋势"}</h3>
              <p>登录后显示实际计划</p>
            </div>
          </div>
          <GuestChart variant="line" />
        </article>
      </section>
    </>
  );
}

export default function GuestPreview({
  activePage,
  assetSection,
  onEnterGuest,
  onLogin,
  planSection,
  setAssetSection,
  setPlanSection,
}) {
  return (
    <div className="guest-preview">
      <GuestAccessBanner onEnterGuest={onEnterGuest} onLogin={onLogin} />
      {activePage === "dashboard" ? <DashboardPreview /> : null}
      {activePage === "ledger" ? <LedgerPreview /> : null}
      {activePage === "assets" ? (
        <AccountsPreview assetSection={assetSection} setAssetSection={setAssetSection} />
      ) : null}
      {activePage === "plan" ? (
        <PlanPreview planSection={planSection} setPlanSection={setPlanSection} />
      ) : null}
    </div>
  );
}
