import { submitAccountAction } from "../features/accounts/actions";
import { accountDraft, changeAccountDraft, editAccountDraft } from "../features/accounts/drafts";
import AccountActionFields from "../features/accounts/AccountActionFields";
import { submitLedgerAction } from "../features/ledger/actions";
import { changeLedgerDraft, editLedgerDraft, ledgerDraft } from "../features/ledger/drafts";
import LedgerActionFields from "../features/ledger/LedgerActionFields";
import { submitInvestmentAction } from "../features/investments/actions";
import { changeInvestmentDraft, editInvestmentDraft, investmentDraft } from "../features/investments/drafts";
import InvestmentActionFields from "../features/investments/InvestmentActionFields";
import { submitGoalRecord } from "../features/goals/actions";
import { goalDraft } from "../features/goals/drafts";
import GoalRecordFields from "../features/goals/GoalRecordFields";

const ledger = {
  draft: ledgerDraft, edit: editLedgerDraft, change: changeLedgerDraft,
  submit: submitLedgerAction, Fields: LedgerActionFields,
};
const account = {
  draft: accountDraft, edit: editAccountDraft, change: changeAccountDraft,
  submit: submitAccountAction, Fields: AccountActionFields,
};
const investment = {
  draft: investmentDraft, edit: editInvestmentDraft, change: changeInvestmentDraft,
  submit: submitInvestmentAction, Fields: InvestmentActionFields,
  accountFilter: (item) => !item.is_liability && item.type === "investment",
};

// Cross-feature selection belongs to application composition, not shared UI.
export const actionDefinitions = {
  transaction: { ...ledger, title: "记一笔", editTitle: "编辑流水", canRepeat: true },
  transfer: { ...ledger, title: "资金划转", minimumAccounts: 2 },
  account: { ...account, title: "新增账户", editTitle: "编辑账户" },
  adjustment: { ...account, title: "余额核对 / 调整" },
  holding: { ...investment, title: "录入已有持仓", editTitle: "编辑已有持仓" },
  new_trade: { ...investment, title: "买入新标的" },
  trade: { ...investment, title: (form) => form.trade_type === "buy" ? "买入持仓" : "卖出持仓" },
  goal_record: {
    draft: goalDraft, submit: submitGoalRecord, Fields: GoalRecordFields,
    title: (form) => form.goal_record_type === "withdraw" ? "从目标取出" : "存入目标",
  },
  budget: {},
  goal: {},
};
