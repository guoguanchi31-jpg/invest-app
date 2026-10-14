// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  BudgetPlanDialog,
  GoalPlanDialog,
} from "../components/PlanSetupDialog";

const members = [
  { id: 1, display_name: "大宝" },
  { id: 2, display_name: "小宝" },
];
const formatMoney = (value) => `¥${Number(value || 0).toLocaleString("zh-CN")}`;

afterEach(cleanup);

it("keeps App family and member budget totals on one current-field keypad", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <BudgetPlanDialog
      appMode
      budget={{
        id: 1,
        month: "2026-10",
        family_total_budget: 100,
        items: [{
          category_id: 1,
          family_budget: 100,
          member_allocations: [
            { member_id: 1, amount: 60 },
            { member_id: 2, amount: 40 },
          ],
        }],
      }}
      categories={[{ id: 1, name: "餐饮", icon: "餐", type: "expense" }]}
      members={members}
      formatMoney={formatMoney}
      formatMonthLabel={() => "2026年10月"}
      onClose={vi.fn()}
      onSave={onSave}
    />,
  );

  const memberInput = screen.getByLabelText("大宝月度总预算");
  const dialogBody = memberInput.closest(".dialog-panel-body");
  dialogBody.scrollTo = vi.fn();
  expect(memberInput.readOnly).toBe(true);
  fireEvent.click(memberInput);
  await waitFor(() => expect(dialogBody.scrollTo).toHaveBeenCalledWith({
      behavior: "smooth",
      top: 0,
    }));
  fireEvent.click(screen.getByRole("button", { name: "清空当前数值" }));
  fireEvent.click(screen.getByRole("button", { name: "数字 9" }));
  fireEvent.click(screen.getByRole("button", { name: "数字 0" }));

  fireEvent.click(screen.getByLabelText("月度总预算"));
  fireEvent.click(screen.getByRole("button", { name: "清空当前数值" }));
  fireEvent.click(screen.getByRole("button", { name: "数字 9" }));
  fireEvent.click(screen.getByRole("button", { name: "数字 0" }));
  fireEvent.click(screen.getByRole("button", { name: "平均分配" }));
  expect(screen.getByLabelText("大宝月度总预算").value).toBe("45");
  expect(screen.getByText("成员预算已核对", { selector: ".app-field-number-status" }))
    .toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "保存预算" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({
    month: "2026-10",
    total_amount: 90,
    categories: [],
    member_allocations: [
      { member_id: 1, amount: 45 },
      { member_id: 2, amount: 45 },
    ],
  }));
});

it("uses the same App field keypad for goal totals and member allocations", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <GoalPlanDialog
      appMode
      members={members}
      formatMoney={formatMoney}
      onClose={vi.fn()}
      onSave={onSave}
    />,
  );

  fireEvent.change(screen.getByLabelText("目标名称"), {
    target: { value: "家庭旅行" },
  });
  const targetInput = screen.getByLabelText("家庭目标总额");
  expect(targetInput.readOnly).toBe(true);
  fireEvent.click(targetInput);
  for (const key of ["1", "0", "0"]) {
    fireEvent.click(screen.getByRole("button", { name: `数字 ${key}` }));
  }
  fireEvent.click(screen.getByLabelText("家庭每月计划"));
  for (const key of ["2", "0"]) {
    fireEvent.click(screen.getByRole("button", { name: `数字 ${key}` }));
  }
  fireEvent.click(screen.getByRole("button", { name: "平均分配目标额" }));
  fireEvent.click(screen.getByRole("button", { name: "平均分配每月计划" }));

  expect(screen.getByLabelText("大宝目标额").value).toBe("50");
  expect(screen.getByLabelText("小宝每月计划").value).toBe("10");
  expect(screen.getByText("分配已核对，可以创建目标", {
    selector: ".app-field-number-status",
  })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "创建目标" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "家庭旅行",
      target_amount: 100,
      monthly_saving: 20,
      allocations: [
        expect.objectContaining({ member_id: 1, target_amount: 50, monthly_saving: 10 }),
        expect.objectContaining({ member_id: 2, target_amount: 50, monthly_saving: 10 }),
      ],
    }),
  ));
});
