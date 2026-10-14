// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GoalPlanDialog } from "./components/PlanSetupDialog";

const members = [
  { id: 1, display_name: "大宝" },
  { id: 2, display_name: "小宝" },
];

const formatMoney = (value) => `¥${Number(value || 0).toLocaleString("zh-CN")}`;

afterEach(() => cleanup());

it("explains the family goal hierarchy before an allocation is entered", () => {
  render(
    <GoalPlanDialog
      members={members}
      formatMoney={formatMoney}
      onClose={vi.fn()}
      onSave={vi.fn()}
    />,
  );

  expect(screen.getByRole("heading", { name: "目标设置" })).toBeTruthy();
  expect(screen.getByText("先确定家庭总目标，再把目标份额和每月计划分配给成员。")).toBeTruthy();
  expect(screen.getAllByText("只记录进度，不扣减账户余额")).toHaveLength(2);
  expect(screen.getByText("请先填写家庭目标总额")).toBeTruthy();
  expect(screen.queryByText("已分配完整")).toBeNull();
  expect(screen.getByRole("button", { name: "平均分配目标额" }).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "平均分配每月计划" }).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "创建家庭目标" }).disabled).toBe(true);
});

it("evenly allocates both totals and submits explicit member amounts", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <GoalPlanDialog
      members={members}
      formatMoney={formatMoney}
      onClose={vi.fn()}
      onSave={onSave}
    />,
  );

  fireEvent.change(screen.getByLabelText("目标名称"), {
    target: { value: "家庭旅行" },
  });
  fireEvent.change(screen.getByLabelText("家庭目标总额"), {
    target: { value: "1200" },
  });
  fireEvent.change(screen.getByLabelText("家庭每月计划"), {
    target: { value: "300" },
  });
  fireEvent.click(screen.getByRole("button", { name: "平均分配目标额" }));
  fireEvent.click(screen.getByRole("button", { name: "平均分配每月计划" }));
  fireEvent.change(screen.getByLabelText("大宝初始已存"), {
    target: { value: "100" },
  });

  expect(screen.getByLabelText("大宝目标额").value).toBe("600");
  expect(screen.getByLabelText("小宝目标额").value).toBe("600");
  expect(screen.getByLabelText("大宝每月计划").value).toBe("150");
  expect(screen.getByLabelText("小宝每月计划").value).toBe("150");
  expect(screen.getByText("分配已核对，可以创建目标")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "创建家庭目标" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({
    name: "家庭旅行",
    target_amount: 1200,
    monthly_saving: 300,
    due_date: null,
    allocations: [
      {
        member_id: 1,
        target_amount: 600,
        current_amount: 100,
        monthly_saving: 150,
      },
      {
        member_id: 2,
        target_amount: 600,
        current_amount: 0,
        monthly_saving: 150,
      },
    ],
    status: "active",
  }));
});

it("blocks impossible due dates and submits a valid ISO date", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <GoalPlanDialog
      members={members}
      formatMoney={formatMoney}
      onClose={vi.fn()}
      onSave={onSave}
    />,
  );

  fireEvent.change(screen.getByLabelText("目标名称"), {
    target: { value: "装修" },
  });
  fireEvent.change(screen.getByLabelText("家庭目标总额"), {
    target: { value: "1000" },
  });
  fireEvent.click(screen.getByRole("button", { name: "平均分配目标额" }));
  fireEvent.change(screen.getByLabelText("目标日期"), {
    target: { value: "2026-02-30" },
  });

  expect(screen.getByLabelText("目标日期").getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText("计划完成日期必须是有效的 YYYY-MM-DD")).toBeTruthy();
  expect(screen.getByRole("button", { name: "创建家庭目标" }).disabled).toBe(true);

  fireEvent.change(screen.getByLabelText("目标日期"), {
    target: { value: "2026-12-31" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建家庭目标" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ due_date: "2026-12-31" }),
  ));
});
