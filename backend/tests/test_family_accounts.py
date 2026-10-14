import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException

import database
from backup import fingerprint, normalize_backup_scope, prepare_family_restore, restore, snapshot, validate_backup
from routers import accounts, auth
from routers.accounts import create_account, get_account_detail, transfer_between_accounts
from routers.budgets import copy_monthly_budget, create_or_update_budget
from routers.family import create_family_member, get_family, remove_family_member, update_family_member
from routers.goals import create_goal, create_goal_record, update_goal
from routers.investments import (
    add_holding,
    create_investment_trade,
    list_investment_trades,
    update_holding,
)
from routers.transactions import create_transaction, delete_transaction, update_transaction
from routers.warehouse import recovery_backup
from schemas import (
    AccountCreate,
    BudgetCategoryAllocation,
    BudgetCopyCreate,
    BudgetCreate,
    FamilyMemberCreate,
    FamilyMemberUpdate,
    GoalCreate,
    GoalMemberAllocation,
    GoalRecordCreate,
    GoalUpdate,
    HoldingCreate,
    InvestmentTradeCreate,
    LoginData,
    MemberAmountAllocation,
    PasswordChange,
    TransactionCreate,
    TransferCreate,
)
from services import (
    get_accounts_overview,
    get_budget_monthly,
    get_dashboard_summary,
    get_goals_overview,
)
from tenancy import AuthContext, use_auth_context
from tests.clock import freeze_business_time


class FamilyAccountTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(freeze_business_time())
        self.temp_dir = tempfile.TemporaryDirectory()
        database.DATABASE_URL = None
        database.DB_DIR = self.temp_dir.name
        database.DB = os.path.join(self.temp_dir.name, "invest.db")
        database.init_db()
        self.admin_token = auth.create_access_token_for_username("admin")
        self.admin = auth.context_from_token(self.admin_token, "family")
        self.auth_context_manager = use_auth_context(self.admin)
        self.auth_context_manager.__enter__()

    def tearDown(self):
        self.auth_context_manager.__exit__(None, None, None)
        self.temp_dir.cleanup()

    def add_member(self, name="小宝", username="xiaobao", password="member-pass"):
        with use_auth_context(self.admin):
            member_id = create_family_member(FamilyMemberCreate(
                display_name=name,
                username=username,
                password=password,
            ))["id"]
        login = auth.login(LoginData(username=username, password=password))
        self.assertTrue(login["ok"])
        return member_id, auth.context_from_token(login["access_token"], "family")

    def mark_member_removed_for_legacy_fixture(self, member_id):
        conn = database.get_connection()
        conn.execute(
            "UPDATE family_members SET is_active = 0 WHERE id = ?",
            (member_id,),
        )
        conn.commit()
        conn.close()

    def test_each_member_logs_in_and_switches_between_family_and_personal_data(self):
        member_id, member_context = self.add_member()
        with use_auth_context(self.admin):
            create_account(AccountCreate(
                name="管理员账户",
                type="debit_card",
                member_id=self.admin.member_id,
                balance=1000,
            ))
            member_account = create_account(AccountCreate(
                name="小宝账户",
                type="debit_card",
                member_id=member_id,
                balance=500,
            ))["id"]

        with use_auth_context(member_context):
            family = get_accounts_overview()
            self.assertEqual(family["asset_total"], 1500)
            self.assertEqual(len(family["accounts"]), 2)

        with use_auth_context(member_context.with_scope("personal")):
            personal = get_accounts_overview()
            self.assertEqual(personal["asset_total"], 500)
            self.assertEqual([item["id"] for item in personal["accounts"]], [member_account])

    def test_trade_reversal_availability_respects_permission_and_account_status(self):
        _, member_context = self.add_member()
        with use_auth_context(self.admin):
            account_id = create_account(AccountCreate(
                name="管理员投资账户",
                type="investment",
                member_id=self.admin.member_id,
                balance=1000,
                opening_date="2026-09-01",
            ))["id"]
            trade = create_investment_trade(InvestmentTradeCreate(
                new_holding=HoldingCreate(
                    name="测试标的",
                    code="TEST",
                    account_id=account_id,
                    buy_price=10,
                    quantity=1,
                    current_price=10,
                ),
                trade_type="buy",
                quantity=1,
                price=10,
                occurred_at="2026-09-28",
            ))

        with use_auth_context(member_context):
            member_view = list_investment_trades(page=1)
        self.assertEqual(member_view["items"][0]["id"], trade["id"])
        self.assertFalse(member_view["items"][0]["can_reverse"])
        self.assertEqual(
            member_view["items"][0]["reverse_disabled_reason"],
            "仅可撤销自己账户的交易",
        )

        conn = database.get_connection()
        conn.execute(
            "UPDATE accounts SET is_active = 0 WHERE id = ?",
            (account_id,),
        )
        conn.commit()
        conn.close()
        with use_auth_context(self.admin):
            archived_view = list_investment_trades(page=1)
        self.assertFalse(archived_view["items"][0]["can_reverse"])
        self.assertEqual(
            archived_view["items"][0]["reverse_disabled_reason"],
            "关联账户已归档，不能撤销",
        )

    def test_financial_commands_refresh_only_affected_member_snapshots(self):
        member_id, _ = self.add_member()
        untouched_member_id, _ = self.add_member(
            "三宝",
            "sanbao",
            "member-pass",
        )
        with use_auth_context(self.admin):
            admin_account = create_account(AccountCreate(
                name="管理员账户",
                type="debit_card",
                member_id=self.admin.member_id,
                balance=1000,
            ))["id"]
            member_account = create_account(AccountCreate(
                name="成员账户",
                type="debit_card",
                member_id=member_id,
                balance=0,
            ))["id"]
            conn = database.get_connection()
            conn.execute("DELETE FROM snapshots")
            conn.commit()
            conn.close()

            create_transaction(TransactionCreate(
                account_id=admin_account,
                amount=100,
                direction="expense",
                occurred_at="2026-09-29",
            ))
            conn = database.get_connection()
            refreshed = {
                row["member_id"]
                for row in conn.execute(
                    "SELECT member_id FROM snapshots"
                ).fetchall()
            }
            conn.close()
            self.assertEqual(refreshed, {None, self.admin.member_id})

            conn = database.get_connection()
            conn.execute("DELETE FROM snapshots")
            conn.commit()
            conn.close()
            transfer_between_accounts(TransferCreate(
                from_account_id=admin_account,
                to_account_id=member_account,
                amount=100,
                occurred_at="2026-09-29",
            ))
            conn = database.get_connection()
            refreshed = {
                row["member_id"]
                for row in conn.execute(
                    "SELECT member_id FROM snapshots"
                ).fetchall()
            }
            conn.close()
            self.assertEqual(refreshed, {None, self.admin.member_id, member_id})
            self.assertNotIn(untouched_member_id, refreshed)

    def test_family_plans_are_totals_with_member_allocations(self):
        member_id, member_context = self.add_member()
        with use_auth_context(self.admin):
            admin_account = create_account(AccountCreate(
                name="管理员日常",
                type="debit_card",
                member_id=self.admin.member_id,
                balance=1000,
            ))["id"]
            member_account = create_account(AccountCreate(
                name="成员日常",
                type="debit_card",
                member_id=member_id,
                balance=1000,
            ))["id"]
            conn = database.get_connection()
            category_id = conn.execute(
                "SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense'"
            ).fetchone()["id"]
            transport_id = conn.execute(
                "SELECT id FROM categories WHERE name = '交通' AND type = 'expense'"
            ).fetchone()["id"]
            conn.close()
            create_or_update_budget(BudgetCreate(
                month="2026-09",
                total_amount=1500,
                categories=[
                    BudgetCategoryAllocation(
                        category_id=category_id,
                        amount=1000,
                        member_allocations=[
                            MemberAmountAllocation(
                                member_id=self.admin.member_id,
                                amount=1000,
                            ),
                            MemberAmountAllocation(member_id=member_id, amount=0),
                        ],
                    ),
                    BudgetCategoryAllocation(
                        category_id=transport_id,
                        amount=500,
                        member_allocations=[
                            MemberAmountAllocation(member_id=self.admin.member_id, amount=0),
                            MemberAmountAllocation(member_id=member_id, amount=500),
                        ],
                    ),
                ],
            ))["id"]
            admin_goal_id = create_goal(GoalCreate(
                name="家庭旅行",
                target_amount=30000,
                monthly_saving=1300,
                allocations=[
                    GoalMemberAllocation(
                        member_id=self.admin.member_id,
                        target_amount=10000,
                        current_amount=1000,
                        monthly_saving=500,
                    ),
                    GoalMemberAllocation(
                        member_id=member_id,
                        target_amount=20000,
                        current_amount=2000,
                        monthly_saving=800,
                    ),
                ],
            ))["id"]

        with use_auth_context(self.admin.with_scope("personal")):
            create_transaction(TransactionCreate(
                account_id=admin_account,
                amount=100,
                direction="expense",
                category_name="餐饮",
                occurred_at="2026-09-20",
            ))
            admin_budget = get_budget_monthly("2026-09")
            admin_goals = get_goals_overview("2026-09")

        with use_auth_context(member_context.with_scope("personal")):
            create_transaction(TransactionCreate(
                account_id=member_account,
                amount=200,
                direction="expense",
                category_name="交通",
                occurred_at="2026-09-20",
            ))
            member_budget = get_budget_monthly("2026-09")
            member_goals = get_goals_overview("2026-09")

        with use_auth_context(self.admin):
            family_budget = get_budget_monthly("2026-09")
            family_goals = get_goals_overview("2026-09")
            dashboard = get_dashboard_summary("2026-09")

        self.assertEqual(admin_budget["total_budget"], 1000)
        self.assertEqual(admin_budget["total_used"], 100)
        self.assertEqual(member_budget["total_budget"], 500)
        self.assertEqual(member_budget["total_used"], 200)
        self.assertEqual(
            [(item["name"], item["budget"]) for item in admin_budget["items"]],
            [("餐饮", 1000)],
        )
        self.assertEqual(
            [(item["name"], item["budget"]) for item in member_budget["items"]],
            [("交通", 500)],
        )
        self.assertEqual(family_budget["total_budget"], 1500)
        self.assertEqual(family_budget["total_used"], 300)
        self.assertEqual(dashboard["budget"]["total"], 1500)
        self.assertEqual(
            {(item["member_id"], item["used"]) for item in family_budget["allocations"]},
            {(self.admin.member_id, 100), (member_id, 200)},
        )
        family_categories = {
            item["name"]: {
                allocation["member_id"]: allocation["amount"]
                for allocation in item["member_allocations"]
            }
            for item in family_budget["items"]
        }
        self.assertEqual(family_categories["餐饮"], {
            self.admin.member_id: 1000,
            member_id: 0,
        })
        self.assertEqual(family_categories["交通"], {
            self.admin.member_id: 0,
            member_id: 500,
        })
        member_categories = {
            item["member_id"]: [category["name"] for category in item["categories"]]
            for item in family_budget["allocations"]
        }

        self.assertEqual(member_categories[self.admin.member_id], ["餐饮"])
        self.assertEqual(member_categories[member_id], ["交通"])
        self.assertEqual(admin_goals["target_total"], 10000)
        self.assertEqual(member_goals["target_total"], 20000)
        self.assertEqual(family_goals["target_total"], 30000)
        self.assertEqual(family_goals["current_total"], 3000)

        with use_auth_context(self.admin):
            copied = copy_monthly_budget(BudgetCopyCreate(
                source_month="2026-09",
                target_month="2026-10",
            ))
        self.assertEqual(copied["copied"], 2)
        with use_auth_context(self.admin.with_scope("personal")):
            copied_admin = get_budget_monthly("2026-10")
            self.assertEqual(copied_admin["total_budget"], 1000)
            self.assertEqual([item["name"] for item in copied_admin["items"]], ["餐饮"])
        with use_auth_context(member_context.with_scope("personal")):
            copied_member = get_budget_monthly("2026-10")
            self.assertEqual(copied_member["total_budget"], 500)
            self.assertEqual([item["name"] for item in copied_member["items"]], ["交通"])
        with use_auth_context(self.admin):
            with self.assertRaises(HTTPException) as incomplete_allocation:
                create_or_update_budget(BudgetCreate(
                    month="2026-11",
                    total_amount=1000,
                    categories=[
                        BudgetCategoryAllocation(
                            category_id=category_id,
                            amount=1000,
                            member_allocations=[
                                MemberAmountAllocation(
                                    member_id=self.admin.member_id,
                                    amount=1000,
                                ),
                            ],
                        ),
                    ],
                ))
            self.assertEqual(incomplete_allocation.exception.status_code, 409)
        with use_auth_context(member_context):
            with self.assertRaises(HTTPException) as copy_error:
                copy_monthly_budget(BudgetCopyCreate(
                    source_month="2026-09",
                    target_month="2026-11",
                ))
            self.assertEqual(copy_error.exception.status_code, 403)

        with use_auth_context(member_context):
            member_family_budget = get_budget_monthly("2026-09")
            member_family_goals = get_goals_overview("2026-09")
            self.assertFalse(member_family_budget["can_manage"])
            self.assertTrue(all(not item["can_edit"] for item in member_family_budget["items"]))
            self.assertFalse(member_family_goals["goals"][0]["can_edit"])
            with self.assertRaises(HTTPException) as budget_error:
                create_or_update_budget(BudgetCreate(
                    month="2026-09",
                    total_amount=1500,
                    categories=[
                        BudgetCategoryAllocation(
                            category_id=category_id,
                            amount=1500,
                            member_allocations=[
                                MemberAmountAllocation(
                                    member_id=self.admin.member_id,
                                    amount=1000,
                                ),
                                MemberAmountAllocation(member_id=member_id, amount=500),
                            ],
                        ),
                    ],
                ))
            self.assertEqual(budget_error.exception.status_code, 403)
            with self.assertRaises(HTTPException) as goal_error:
                create_goal_record(admin_goal_id, GoalRecordCreate(
                    amount=100,
                    recorded_at="2026-09-21",
                    member_id=self.admin.member_id,
                ))
            self.assertEqual(goal_error.exception.status_code, 403)

    def test_family_budget_can_use_member_totals_without_category_rows(self):
        member_id, member_context = self.add_member()
        with use_auth_context(self.admin):
            admin_account = create_account(AccountCreate(
                name="管理员预算账户",
                type="debit_card",
                member_id=self.admin.member_id,
                balance=1000,
            ))["id"]
            member_account = create_account(AccountCreate(
                name="成员预算账户",
                type="debit_card",
                member_id=member_id,
                balance=1000,
            ))["id"]
            result = create_or_update_budget(BudgetCreate(
                month="2026-09",
                total_amount=1500,
                member_allocations=[
                    MemberAmountAllocation(
                        member_id=self.admin.member_id,
                        amount=900,
                    ),
                    MemberAmountAllocation(member_id=member_id, amount=600),
                ],
            ))
            create_transaction(TransactionCreate(
                account_id=admin_account,
                amount=100,
                direction="expense",
                category_name="餐饮",
                occurred_at="2026-09-20",
            ))

        with use_auth_context(member_context.with_scope("personal")):
            create_transaction(TransactionCreate(
                account_id=member_account,
                amount=200,
                direction="expense",
                category_name="交通",
                occurred_at="2026-09-20",
            ))
            member_budget = get_budget_monthly("2026-09")

        with use_auth_context(self.admin):
            family_budget = get_budget_monthly("2026-09")
            admin_budget = get_budget_monthly(
                "2026-09",
                context=self.admin.with_scope("personal"),
            )
            conn = database.get_connection()
            try:
                category_count = conn.execute(
                    "SELECT COUNT(*) AS count FROM budgets WHERE month = '2026-09'"
                ).fetchone()["count"]
                allocation_count = conn.execute(
                    """
                    SELECT COUNT(*) AS count
                    FROM budget_member_allocations
                    WHERE budget_plan_id = ?
                    """,
                    (result["id"],),
                ).fetchone()["count"]
            finally:
                conn.close()

        self.assertEqual(category_count, 0)
        self.assertEqual(allocation_count, 2)
        self.assertEqual(family_budget["total_budget"], 1500)
        self.assertEqual(family_budget["total_used"], 300)
        self.assertEqual(family_budget["items"], [])
        self.assertEqual(admin_budget["total_budget"], 900)
        self.assertEqual(admin_budget["total_used"], 100)
        self.assertEqual(member_budget["total_budget"], 600)
        self.assertEqual(member_budget["total_used"], 200)
        with use_auth_context(self.admin):
            copied = copy_monthly_budget(BudgetCopyCreate(
                source_month="2026-09",
                target_month="2026-10",
            ))
            self.assertEqual(copied["copied"], 2)
            conn = database.get_connection()
            try:
                saved = snapshot(conn)
                validate_backup(conn, saved)
            finally:
                conn.close()
        with use_auth_context(member_context.with_scope("personal")):
            copied_member = get_budget_monthly("2026-10")
        self.assertEqual(copied_member["total_budget"], 600)
        self.assertEqual(copied_member["items"], [])

    def test_v4_budget_backup_expands_member_totals_into_cent_exact_categories(self):
        member_id, _ = self.add_member()
        conn = database.get_connection()
        category_ids = [
            row["id"]
            for row in conn.execute(
                """
                SELECT id FROM categories
                WHERE name IN ('餐饮', '交通') AND type = 'expense'
                ORDER BY name
                """
            ).fetchall()
        ]
        conn.close()
        with use_auth_context(self.admin):
            create_or_update_budget(BudgetCreate(
                month="2026-09",
                total_amount=3.03,
                categories=[
                    BudgetCategoryAllocation(category_id=category_ids[0], amount=1),
                    BudgetCategoryAllocation(category_id=category_ids[1], amount=2.03),
                ],
                member_allocations=[
                    MemberAmountAllocation(member_id=self.admin.member_id, amount=1.01),
                    MemberAmountAllocation(member_id=member_id, amount=2.02),
                ],
            ))
            conn = database.get_connection()
            legacy = snapshot(conn, self.admin.family_id)
            legacy["version"] = 4
            legacy["data"].pop("budget_category_allocations")
            normalized = normalize_backup_scope(conn, legacy, self.admin.family_id)
            validate_backup(conn, normalized)
            conn.close()

        allocations = normalized["data"]["budget_category_allocations"]
        by_category = {}
        by_member = {}
        for allocation in allocations:
            by_category[allocation["category_id"]] = (
                by_category.get(allocation["category_id"], 0)
                + float(allocation["amount"])
            )
            by_member[allocation["member_id"]] = (
                by_member.get(allocation["member_id"], 0)
                + float(allocation["amount"])
            )
        self.assertEqual(
            {category_id: round(amount, 2) for category_id, amount in by_category.items()},
            {category_ids[0]: 1, category_ids[1]: 2.03},
        )
        self.assertEqual(
            {member: round(amount, 2) for member, amount in by_member.items()},
            {self.admin.member_id: 1.01, member_id: 2.02},
        )

    def test_legacy_family_plans_are_assigned_to_owner_without_losing_budget(self):
        conn = database.get_connection()
        category_id = conn.execute(
            "SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense'"
        ).fetchone()["id"]
        conn.execute("DROP INDEX uq_budgets_family_month_category")
        conn.execute(
            """
            CREATE UNIQUE INDEX uq_budgets_scope_month_category
            ON budgets(family_id, COALESCE(member_id, 0), month, category_id)
            """
        )
        conn.execute(
            """
            INSERT INTO budgets
            (family_id, member_id, month, category_id, amount)
            VALUES (?, ?, '2026-09', ?, 200)
            """,
            (self.admin.family_id, self.admin.member_id, category_id),
        )
        conn.execute(
            """
            INSERT INTO budgets
            (family_id, member_id, month, category_id, amount)
            VALUES (?, NULL, '2026-09', ?, 300)
            """,
            (self.admin.family_id, category_id),
        )
        goal_id = conn.execute(
            """
            INSERT INTO goals
            (family_id, member_id, name, target_amount, current_amount, status)
            VALUES (?, NULL, '旧家庭目标', 1000, 100, 'active')
            RETURNING id
            """,
            (self.admin.family_id,),
        ).fetchone()["id"]
        conn.execute(
            """
            INSERT INTO goal_records
            (family_id, member_id, goal_id, amount, recorded_at)
            VALUES (?, ?, ?, 50, '2026-09-20')
            """,
            (self.admin.family_id, self.admin.member_id, goal_id),
        )
        conn.commit()
        conn.close()

        database.init_db()

        conn = database.get_connection()
        budgets = conn.execute(
            """
            SELECT member_id, amount
            FROM budgets
            WHERE family_id = ? AND month = '2026-09' AND category_id = ?
            """,
            (self.admin.family_id, category_id),
        ).fetchall()
        goal = conn.execute(
            "SELECT member_id FROM goals WHERE id = ?",
            (goal_id,),
        ).fetchone()
        record = conn.execute(
            "SELECT member_id FROM goal_records WHERE goal_id = ?",
            (goal_id,),
        ).fetchone()
        plan = conn.execute(
            """
            SELECT bp.total_amount, bma.member_id, bma.amount
            FROM budget_plans bp
            JOIN budget_member_allocations bma ON bma.budget_plan_id = bp.id
            WHERE bp.family_id = ? AND bp.month = '2026-09'
            """,
            (self.admin.family_id,),
        ).fetchone()
        category_allocation = conn.execute(
            """
            SELECT bca.member_id, bca.amount
            FROM budget_category_allocations bca
            JOIN budget_plans bp ON bp.id = bca.budget_plan_id
            WHERE bp.family_id = ? AND bp.month = '2026-09'
            """,
            (self.admin.family_id,),
        ).fetchone()
        goal_allocation = conn.execute(
            "SELECT member_id, target_amount FROM goal_allocations WHERE goal_id = ?",
            (goal_id,),
        ).fetchone()
        conn.close()
        self.assertEqual(
            [(row["member_id"], row["amount"]) for row in budgets],
            [(None, 500)],
        )
        self.assertEqual(
            (plan["total_amount"], plan["member_id"], plan["amount"]),
            (500, self.admin.member_id, 500),
        )
        self.assertEqual(
            (category_allocation["member_id"], category_allocation["amount"]),
            (self.admin.member_id, 500),
        )
        self.assertIsNone(goal["member_id"])
        self.assertEqual(
            (goal_allocation["member_id"], goal_allocation["target_amount"]),
            (self.admin.member_id, 1000),
        )
        self.assertEqual(record["member_id"], self.admin.member_id)

    def test_admin_can_redistribute_family_plans_without_moving_goal_history(self):
        member_id, member_context = self.add_member()
        with use_auth_context(self.admin):
            conn = database.get_connection()
            category_id = conn.execute(
                "SELECT id FROM categories WHERE name = '交通' AND type = 'expense'"
            ).fetchone()["id"]
            conn.close()
            create_or_update_budget(BudgetCreate(
                month="2026-09",
                total_amount=800,
                categories=[
                    BudgetCategoryAllocation(
                        category_id=category_id,
                        amount=800,
                        member_allocations=[
                            MemberAmountAllocation(member_id=self.admin.member_id, amount=800),
                            MemberAmountAllocation(member_id=member_id, amount=0),
                        ],
                    ),
                ],
            ))
            goal_id = create_goal(GoalCreate(
                name="可转移目标",
                target_amount=5000,
                allocations=[
                    GoalMemberAllocation(
                        member_id=self.admin.member_id,
                        target_amount=5000,
                        current_amount=1000,
                    ),
                ],
            ))["id"]
            create_goal_record(goal_id, GoalRecordCreate(
                amount=200,
                recorded_at="2026-09-20",
            ))
            create_or_update_budget(BudgetCreate(
                month="2026-09",
                total_amount=800,
                categories=[
                    BudgetCategoryAllocation(
                        category_id=category_id,
                        amount=800,
                        member_allocations=[
                            MemberAmountAllocation(member_id=self.admin.member_id, amount=0),
                            MemberAmountAllocation(member_id=member_id, amount=800),
                        ],
                    ),
                ],
            ))
            update_goal(goal_id, GoalUpdate(
                name="可转移目标",
                target_amount=8000,
                allocations=[
                    GoalMemberAllocation(
                        member_id=self.admin.member_id,
                        target_amount=3000,
                    ),
                    GoalMemberAllocation(
                        member_id=member_id,
                        target_amount=5000,
                    ),
                ],
            ))

        conn = database.get_connection()
        record_owner = conn.execute(
            "SELECT member_id FROM goal_records WHERE goal_id = ?",
            (goal_id,),
        ).fetchone()["member_id"]
        allocation_rows = conn.execute(
            """
            SELECT member_id, target_amount, current_amount
            FROM goal_allocations
            WHERE goal_id = ?
            ORDER BY member_id
            """,
            (goal_id,),
        ).fetchall()
        conn.close()
        self.assertEqual(record_owner, self.admin.member_id)
        self.assertEqual(
            [
                (row["member_id"], row["target_amount"], row["current_amount"])
                for row in allocation_rows
            ],
            [
                (self.admin.member_id, 3000, 1200),
                (member_id, 5000, 0),
            ],
        )

        with use_auth_context(member_context.with_scope("personal")):
            self.assertEqual(get_budget_monthly("2026-09")["total_budget"], 800)
            self.assertEqual(get_goals_overview("2026-09")["target_total"], 5000)

    def test_legacy_backup_normalizes_unowned_plans_to_the_restoring_owner(self):
        conn = database.get_connection()
        category_id = conn.execute(
            "SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense'"
        ).fetchone()["id"]
        conn.execute("DROP INDEX uq_budgets_family_month_category")
        conn.execute(
            """
            CREATE UNIQUE INDEX uq_budgets_scope_month_category
            ON budgets(family_id, COALESCE(member_id, 0), month, category_id)
            """
        )
        conn.execute(
            """
            INSERT INTO budgets
            (family_id, member_id, month, category_id, amount)
            VALUES (?, ?, '2026-09', ?, 200)
            """,
            (self.admin.family_id, self.admin.member_id, category_id),
        )
        conn.execute(
            """
            INSERT INTO budgets
            (family_id, member_id, month, category_id, amount)
            VALUES (?, NULL, '2026-09', ?, 300)
            """,
            (self.admin.family_id, category_id),
        )
        goal_id = conn.execute(
            """
            INSERT INTO goals
            (family_id, member_id, name, target_amount, current_amount, status)
            VALUES (?, NULL, '备份旧目标', 1000, 100, 'active')
            RETURNING id
            """,
            (self.admin.family_id,),
        ).fetchone()["id"]
        conn.execute(
            """
            INSERT INTO goal_records
            (family_id, member_id, goal_id, amount, recorded_at)
            VALUES (?, ?, ?, 50, '2026-09-20')
            """,
            (self.admin.family_id, self.admin.member_id, goal_id),
        )
        conn.commit()
        saved = snapshot(conn, self.admin.family_id)
        saved["version"] = 3
        saved["data"].pop("budget_plans")
        saved["data"].pop("budget_member_allocations")
        saved["data"].pop("budget_category_allocations")
        saved["data"].pop("goal_allocations")
        normalized = normalize_backup_scope(conn, saved, self.admin.family_id)
        conn.close()

        self.assertEqual(len(normalized["data"]["budgets"]), 1)
        self.assertEqual(normalized["data"]["budgets"][0]["amount"], 500)
        self.assertIsNone(normalized["data"]["budgets"][0]["member_id"])
        self.assertIsNone(normalized["data"]["goals"][0]["member_id"])
        self.assertEqual(normalized["data"]["budget_plans"][0]["total_amount"], 500)
        self.assertEqual(
            normalized["data"]["budget_member_allocations"][0]["member_id"],
            self.admin.member_id,
        )
        self.assertEqual(
            (
                normalized["data"]["budget_category_allocations"][0]["member_id"],
                normalized["data"]["budget_category_allocations"][0]["amount"],
            ),
            (self.admin.member_id, 500),
        )
        self.assertEqual(
            normalized["data"]["goal_allocations"][0]["member_id"],
            self.admin.member_id,
        )
        self.assertEqual(
            normalized["data"]["goal_records"][0]["member_id"],
            self.admin.member_id,
        )

    def test_member_cannot_modify_another_members_account(self):
        _, member_context = self.add_member()
        with use_auth_context(self.admin):
            admin_account = create_account(AccountCreate(
                name="管理员账户",
                type="debit_card",
                member_id=self.admin.member_id,
                balance=1000,
            ))["id"]

        with use_auth_context(member_context):
            with self.assertRaisesRegex(Exception, "只能修改自己的账户"):
                create_transaction(TransactionCreate(
                    account_id=admin_account,
                    amount=100,
                    direction="expense",
                    occurred_at="2026-09-28",
                ))
            self.assertEqual(get_dashboard_summary("2026-09")["monthly_expense"], 0)

    def test_member_cannot_move_another_members_holding_to_their_account(self):
        member_id, member_context = self.add_member()
        with use_auth_context(self.admin):
            admin_account = create_account(AccountCreate(
                name="管理员投资",
                type="investment",
                member_id=self.admin.member_id,
            ))["id"]
            member_account = create_account(AccountCreate(
                name="成员投资",
                type="investment",
                member_id=member_id,
            ))["id"]
            holding = HoldingCreate(
                name="管理员持仓",
                code="ADMIN",
                buy_price=10,
                quantity=10,
                current_price=11,
                account_id=admin_account,
            )
            holding_id = add_holding(holding)["id"]

        with use_auth_context(member_context):
            with self.assertRaisesRegex(Exception, "只能修改自己的账户"):
                update_holding(
                    holding_id,
                    holding.model_copy(update={"account_id": member_account}),
                )

        conn = database.get_connection()
        account_id = conn.execute(
            "SELECT account_id FROM holdings WHERE id = ?",
            (holding_id,),
        ).fetchone()["account_id"]
        conn.close()
        self.assertEqual(account_id, admin_account)

    def test_family_and_personal_snapshots_are_independent(self):
        member_id, member_context = self.add_member()
        with use_auth_context(self.admin):
            create_account(AccountCreate(
                name="管理员账户",
                type="debit_card",
                member_id=self.admin.member_id,
                balance=1000,
            ))
            create_account(AccountCreate(
                name="小宝账户",
                type="debit_card",
                member_id=member_id,
                balance=500,
                opening_date="2026-09-01",
            ))

        conn = database.get_connection()
        rows = conn.execute(
            """
            SELECT member_id, net_worth
            FROM snapshots
            WHERE family_id = ?
            ORDER BY member_id
            """,
            (self.admin.family_id,),
        ).fetchall()
        conn.close()
        self.assertEqual(
            {(row["member_id"], row["net_worth"]) for row in rows},
            {(None, 1500.0), (self.admin.member_id, 1000.0), (member_id, 500.0)},
        )

        with use_auth_context(member_context.with_scope("personal")):
            create_transaction(TransactionCreate(
                account_id=next(
                    item["id"] for item in get_accounts_overview()["accounts"]
                    if item["member_id"] == member_id
                ),
                amount=100,
                direction="expense",
                occurred_at="2026-09-28",
            ))
        conn = database.get_connection()
        personal = conn.execute(
            """
            SELECT net_worth FROM snapshots
            WHERE family_id = ? AND member_id = ?
            """,
            (self.admin.family_id, member_id),
        ).fetchone()
        family = conn.execute(
            """
            SELECT net_worth FROM snapshots
            WHERE family_id = ? AND member_id IS NULL
            """,
            (self.admin.family_id,),
        ).fetchone()
        conn.close()
        self.assertEqual(personal["net_worth"], 400)
        self.assertEqual(family["net_worth"], 1400)

    def test_password_change_invalidates_old_token(self):
        _, member_context = self.add_member()
        old_token = auth.create_access_token(
            member_context.user_id,
            member_context.family_id,
            1,
        )
        with use_auth_context(member_context):
            result = auth.change_password(
                PasswordChange(
                    current_password="member-pass",
                    new_password="new-member-pass",
                ),
                member_context,
            )
        self.assertIsNone(auth.context_from_token(old_token))
        self.assertIsNotNone(auth.context_from_token(result["access_token"]))
        self.assertFalse(auth.login(LoginData(username="xiaobao", password="member-pass"))["ok"])
        self.assertTrue(auth.login(LoginData(username="xiaobao", password="new-member-pass"))["ok"])

    def test_admin_cannot_take_over_owner_or_manage_peer_credentials(self):
        member_id, _ = self.add_member()
        with use_auth_context(self.admin):
            create_family_member(FamilyMemberCreate(
                display_name="家庭管理员",
                username="family-admin",
                password="admin-pass",
                role="admin",
            ))
        admin_context = auth.context_from_token(
            auth.create_access_token_for_username("family-admin"),
            "family",
        )

        with use_auth_context(admin_context):
            for target_id, payload in (
                (self.admin.member_id, FamilyMemberUpdate(password="owner-taken-over")),
                (member_id, FamilyMemberUpdate(password="member-taken-over")),
                (member_id, FamilyMemberUpdate(role="admin")),
            ):
                with self.assertRaises(HTTPException) as rejected:
                    update_family_member(target_id, payload)
                self.assertEqual(rejected.exception.status_code, 403)

            update_family_member(
                member_id,
                FamilyMemberUpdate(display_name="小宝新名"),
            )
            with self.assertRaises(HTTPException) as rejected:
                create_family_member(FamilyMemberCreate(
                    display_name="越权管理员",
                    username="unauthorized-admin",
                    password="admin-pass",
                    role="admin",
                ))
            self.assertEqual(rejected.exception.status_code, 403)

        self.assertTrue(auth.login(LoginData(username="admin", password="123456"))["ok"])
        self.assertFalse(auth.login(
            LoginData(username="admin", password="owner-taken-over"),
        )["ok"])
        self.assertTrue(auth.login(
            LoginData(username="xiaobao", password="member-pass"),
        )["ok"])

    def test_owner_cannot_bypass_current_password_when_updating_self(self):
        with use_auth_context(self.admin):
            with self.assertRaises(HTTPException) as rejected:
                update_family_member(
                    self.admin.member_id,
                    FamilyMemberUpdate(password="owner-taken-over"),
                )
        self.assertEqual(rejected.exception.status_code, 409)
        self.assertTrue(auth.login(LoginData(username="admin", password="123456"))["ok"])

    def test_only_owner_can_remove_an_admin(self):
        with use_auth_context(self.admin):
            actor_id = create_family_member(FamilyMemberCreate(
                display_name="管理员甲",
                username="admin-a",
                password="admin-pass-a",
                role="admin",
            ))["id"]
            target_id = create_family_member(FamilyMemberCreate(
                display_name="管理员乙",
                username="admin-b",
                password="admin-pass-b",
                role="admin",
            ))["id"]
        actor = auth.context_from_token(
            auth.create_access_token_for_username("admin-a"),
            "family",
        )
        target_token = auth.create_access_token_for_username("admin-b")

        with use_auth_context(actor):
            with self.assertRaises(HTTPException) as rejected:
                remove_family_member(target_id)
        self.assertEqual(rejected.exception.status_code, 403)
        self.assertIsNotNone(auth.context_from_token(target_token))

        with use_auth_context(self.admin):
            result = remove_family_member(target_id)
        self.assertEqual(result["message"], "家庭成员已移除")
        self.assertIsNone(auth.context_from_token(target_token))
        self.assertNotEqual(actor_id, target_id)

    def test_renamed_default_owner_is_not_recreated_on_restart(self):
        with use_auth_context(self.admin):
            update_family_member(
                self.admin.member_id,
                FamilyMemberUpdate(
                    display_name="新管理员",
                ),
            )

        database.init_db()

        self.assertTrue(auth.login(LoginData(username="admin", password="123456"))["ok"])
        conn = database.get_connection()
        users = conn.execute("SELECT username FROM users ORDER BY id").fetchall()
        owner = conn.execute(
            """
            SELECT fm.display_name, u.username
            FROM family_members fm
            JOIN users u ON u.id = fm.user_id
            WHERE fm.role = 'owner'
            """
        ).fetchone()
        conn.close()
        self.assertEqual([row["username"] for row in users], ["admin"])
        self.assertEqual((owner["display_name"], owner["username"]), ("新管理员", "admin"))
        self.assertEqual(
            auth.context_from_token(
                auth.create_access_token_for_username("admin")
            ).username,
            "admin",
        )

    def test_admin_can_disable_and_reenable_member_login_without_deleting_history(self):
        member_id, member_context = self.add_member()
        with use_auth_context(self.admin):
            create_account(AccountCreate(
                name="成员历史账户",
                type="debit_card",
                member_id=member_id,
                balance=500,
            ))
            update_family_member(
                member_id,
                FamilyMemberUpdate(login_enabled=False),
            )
            family = get_family()
        self.assertFalse(
            next(item for item in family["members"] if item["id"] == member_id)["login_enabled"]
        )
        self.assertIsNone(auth.context_from_token(
            auth.create_access_token(
                member_context.user_id,
                member_context.family_id,
                1,
            )
        ))
        self.assertFalse(auth.login(LoginData(username="xiaobao", password="member-pass"))["ok"])

        with use_auth_context(self.admin):
            update_family_member(
                member_id,
                FamilyMemberUpdate(login_enabled=True),
            )
            conn = database.get_connection()
            account_count = conn.execute(
                "SELECT COUNT(*) AS count FROM accounts WHERE member_id = ?",
                (member_id,),
            ).fetchone()["count"]
            conn.close()
        self.assertEqual(account_count, 1)
        self.assertTrue(auth.login(LoginData(username="xiaobao", password="member-pass"))["ok"])

    def test_member_with_goal_history_cannot_be_removed_but_login_can_be_disabled(self):
        member_id, _ = self.add_member()
        with use_auth_context(self.admin):
            goal_id = create_goal(GoalCreate(
                name="家庭教育金",
                target_amount=1000,
                monthly_saving=100,
                allocations=[
                    GoalMemberAllocation(
                        member_id=member_id,
                        target_amount=1000,
                        current_amount=200,
                        monthly_saving=100,
                    ),
                ],
            ))["id"]

            with self.assertRaises(HTTPException) as rejected:
                remove_family_member(member_id)
            self.assertEqual(rejected.exception.status_code, 409)
            self.assertIn("目标", rejected.exception.detail)
            self.assertIn("停用登录", rejected.exception.detail)

            update_goal(
                goal_id,
                GoalUpdate(
                    name="家庭教育金",
                    target_amount=1200,
                    monthly_saving=120,
                    allocations=[
                        GoalMemberAllocation(
                            member_id=member_id,
                            target_amount=1200,
                            monthly_saving=120,
                        ),
                    ],
                ),
            )
            update_family_member(
                member_id,
                FamilyMemberUpdate(login_enabled=False),
            )
            conn = database.get_connection()
            member = conn.execute(
                """
                SELECT fm.is_active, u.is_active AS login_active
                FROM family_members fm
                LEFT JOIN users u ON u.id = fm.user_id
                WHERE fm.id = ?
                """,
                (member_id,),
            ).fetchone()
            allocation = conn.execute(
                """
                SELECT target_amount, current_amount, monthly_saving
                FROM goal_allocations
                WHERE goal_id = ? AND member_id = ?
                """,
                (goal_id, member_id),
            ).fetchone()
            conn.close()

        self.assertEqual(dict(member), {"is_active": 1, "login_active": 0})
        self.assertEqual(
            dict(allocation),
            {
                "target_amount": 1200,
                "current_amount": 200,
                "monthly_saving": 120,
            },
        )

    def test_unused_member_can_still_be_removed(self):
        member_id, _ = self.add_member()
        with use_auth_context(self.admin):
            result = remove_family_member(member_id)
            conn = database.get_connection()
            member = conn.execute(
                "SELECT is_active FROM family_members WHERE id = ?",
                (member_id,),
            ).fetchone()
            conn.close()

        self.assertEqual(result["message"], "家庭成员已移除")
        self.assertEqual(member["is_active"], 0)

    def test_financial_audit_records_actual_actor_time_and_reason(self):
        member_id, member_context = self.add_member()
        with use_auth_context(self.admin):
            account_id = create_account(AccountCreate(
                name="成员账户",
                type="debit_card",
                member_id=member_id,
                balance=500,
            ))["id"]
        with use_auth_context(member_context):
            created = create_transaction(TransactionCreate(
                account_id=account_id,
                amount=80,
                direction="expense",
                occurred_at="2026-09-28",
                note="家庭采购核对",
            ))
            activity = get_family()["recent_activity"]
            account_activity = get_account_detail(account_id)["activity"]

        event = next(
            item for item in activity
            if item["entity_type"] == "transaction"
            and item["entity_id"] == str(created["id"])
        )
        self.assertEqual(event["actor_name"], "小宝")
        self.assertEqual(event["reason"], "家庭采购核对")
        self.assertTrue(event["created_at"].startswith("20"))
        self.assertEqual(account_activity[0]["actor_name"], "小宝")

    def test_deleted_transaction_audit_keeps_account_link_and_before_value(self):
        with use_auth_context(self.admin):
            account_id = create_account(AccountCreate(
                name="审计账户",
                type="debit_card",
                member_id=self.admin.member_id,
                balance=500,
            ))["id"]
            transaction_id = create_transaction(TransactionCreate(
                account_id=account_id,
                amount=80,
                direction="expense",
                occurred_at="2026-09-28",
                note="需保留的删除记录",
            ))["id"]
            update_transaction(transaction_id, TransactionCreate(
                account_id=account_id,
                amount=60,
                direction="expense",
                occurred_at="2026-09-28",
                note="修改后的记录",
            ))
            delete_transaction(transaction_id)
            detail = get_account_detail(account_id)

        updated = next(
            item for item in detail["activity"]
            if item["action"] == "修改流水" and item["entity_id"] == str(transaction_id)
        )
        deleted = next(
            item for item in detail["activity"]
            if item["action"] == "删除流水" and item["entity_id"] == str(transaction_id)
        )
        self.assertEqual(json.loads(updated["before_value"])["amount"], 80)
        self.assertEqual(json.loads(updated["after_value"])["amount"], 60)
        self.assertEqual(json.loads(deleted["before_value"])["amount"], 60)
        self.assertIsNone(deleted["after_value"])
        self.assertNotIn(transaction_id, {item["id"] for item in detail["transactions"]})

    def test_backup_restores_unassigned_holding_and_removed_members_personal_goal(self):
        member_id, member_context = self.add_member("历史成员", "history", "history-pass")
        with use_auth_context(member_context.with_scope("personal")):
            holding_id = add_holding(HoldingCreate(
                name="未关联持仓",
                code="UNLINKED",
                buy_price=10,
                quantity=2,
                current_price=12,
            ))["id"]
        with use_auth_context(self.admin):
            goal_id = create_goal(GoalCreate(
                name="历史目标",
                target_amount=1000,
                allocations=[
                    GoalMemberAllocation(
                        member_id=member_id,
                        target_amount=1000,
                        current_amount=100,
                    ),
                ],
            ))["id"]
            self.mark_member_removed_for_legacy_fixture(member_id)
            conn = database.get_connection()
            saved = snapshot(conn, self.admin.family_id)
            self.assertIn(member_id, {item["source_id"] for item in saved["members"]})
            normalized = normalize_backup_scope(conn, saved, self.admin.family_id)
            current = snapshot(conn, self.admin.family_id)
            conn.close()
            restored_holding = next(
                row for row in normalized["data"]["holdings"] if row["id"] == holding_id
            )
            restored_goal = next(
                row for row in normalized["data"]["goals"] if row["id"] == goal_id
            )
            restored_allocation = next(
                row for row in normalized["data"]["goal_allocations"]
                if row["goal_id"] == goal_id
            )
            self.assertEqual(restored_holding["member_id"], member_id)
            self.assertIsNone(restored_goal["member_id"])
            self.assertEqual(restored_allocation["member_id"], member_id)
            prepared = prepare_family_restore(saved, fingerprint(current))
            with database.write_connection() as conn:
                result = restore(conn, saved, fingerprint(current), prepared=prepared)
            holding_id = result["id_mapping"]["holdings"][holding_id]
            goal_id = result["id_mapping"]["goals"][goal_id]

        conn = database.get_connection()
        holding_member = conn.execute(
            "SELECT member_id FROM holdings WHERE id = ?",
            (holding_id,),
        ).fetchone()["member_id"]
        goal_member = conn.execute(
            "SELECT member_id FROM goal_allocations WHERE goal_id = ?",
            (goal_id,),
        ).fetchone()["member_id"]
        conn.close()
        self.assertEqual((holding_member, goal_member), (member_id, member_id))

    def test_recovery_backup_download_is_isolated_by_family_and_role(self):
        _, member_context = self.add_member()
        with use_auth_context(self.admin):
            conn = database.get_connection()
            saved = snapshot(conn, self.admin.family_id)
            conn.close()
            prepared = prepare_family_restore(saved, fingerprint(saved))
            with database.write_connection() as conn:
                result = restore(conn, saved, fingerprint(saved), prepared=prepared)
            filename = result["recovery_backup"]
            response = recovery_backup(filename)
            self.assertEqual(Path(response.path).parent.name, f"family-{self.admin.family_id}")

        with use_auth_context(member_context):
            with self.assertRaises(HTTPException) as forbidden:
                recovery_backup(filename)
        self.assertEqual(forbidden.exception.status_code, 403)

        other_admin = AuthContext(
            user_id=999,
            username="other",
            display_name="其他管理员",
            family_id=self.admin.family_id + 999,
            family_name="其他家庭",
            member_id=999,
            role="owner",
            authenticated=True,
        )
        with use_auth_context(other_admin):
            with self.assertRaises(HTTPException) as hidden:
                recovery_backup(filename)
        self.assertEqual(hidden.exception.status_code, 404)

        legacy_folder = Path(database.DB_DIR) / "backups"
        legacy_filename = "before-restore-" + "a" * 32 + ".json"
        (legacy_folder / legacy_filename).write_text(
            json.dumps(saved, ensure_ascii=False),
            encoding="utf-8",
        )
        with use_auth_context(self.admin):
            self.assertEqual(
                Path(recovery_backup(legacy_filename).path),
                legacy_folder / legacy_filename,
            )
        with use_auth_context(other_admin):
            with self.assertRaises(HTTPException) as hidden_legacy:
                recovery_backup(legacy_filename)
        self.assertEqual(hidden_legacy.exception.status_code, 404)

    def test_version_two_backup_without_audit_links_remains_compatible(self):
        with use_auth_context(self.admin):
            account_id = create_account(AccountCreate(
                name="旧备份账户",
                type="debit_card",
                member_id=self.admin.member_id,
                balance=500,
            ))["id"]
            create_transaction(TransactionCreate(
                account_id=account_id,
                amount=50,
                direction="expense",
                occurred_at="2026-09-28",
            ))
            conn = database.get_connection()
            legacy = snapshot(conn, self.admin.family_id)
            legacy["version"] = 2
            legacy["data"].pop("audit_event_accounts")
            legacy["data"].pop("budget_plans")
            legacy["data"].pop("budget_member_allocations")
            legacy["data"].pop("budget_category_allocations")
            legacy["data"].pop("goal_allocations")
            for event in legacy["data"]["audit_events"]:
                event.pop("before_value", None)
                event.pop("after_value", None)
            normalized = normalize_backup_scope(conn, legacy, self.admin.family_id)
            counts = validate_backup(conn, normalized)
            conn.close()

        self.assertEqual(counts["accounts"], 1)
        self.assertGreaterEqual(counts["audit_event_accounts"], 1)

    def test_version_two_backup_with_unlisted_historical_member_uses_placeholder(self):
        member_id, member_context = self.add_member("已移除成员", "removed", "removed-pass")
        with use_auth_context(self.admin):
            create_goal(GoalCreate(
                name="留存目标",
                target_amount=2000,
                allocations=[
                    GoalMemberAllocation(
                        member_id=member_id,
                        target_amount=2000,
                        current_amount=200,
                    ),
                ],
            ))
            self.mark_member_removed_for_legacy_fixture(member_id)
            conn = database.get_connection()
            legacy = snapshot(conn, self.admin.family_id)
            legacy["version"] = 2
            for goal in legacy["data"]["goals"]:
                if goal["name"] == "留存目标":
                    goal["member_id"] = member_id
            legacy["members"] = [
                member for member in legacy["members"]
                if member["source_id"] != member_id
            ]
            legacy["data"].pop("audit_event_accounts")
            legacy["data"].pop("budget_plans")
            legacy["data"].pop("budget_member_allocations")
            legacy["data"].pop("budget_category_allocations")
            legacy["data"].pop("goal_allocations")
            for event in legacy["data"]["audit_events"]:
                event.pop("before_value", None)
                event.pop("after_value", None)
            normalized = normalize_backup_scope(conn, legacy, self.admin.family_id)
            conn.close()

        mapping = next(
            item for item in normalized["member_mapping"]
            if item["source_member_id"] == member_id
        )
        goal = next(
            item for item in normalized["data"]["goal_allocations"]
            if item["goal_id"] == next(
                row["id"] for row in normalized["data"]["goals"]
                if row["name"] == "留存目标"
            )
        )
        self.assertEqual(mapping["action"], "create_pending")
        self.assertEqual(mapping["source_name"], f"历史成员 {member_id}")
        self.assertEqual(goal["member_id"], mapping["target_member_id"] or -1)

    def test_pending_legacy_member_is_bound_instead_of_duplicated(self):
        conn = database.get_connection()
        now = "2026-09-28T00:00:00"
        pending_id = conn.execute(
            """
            INSERT INTO family_members
            (family_id, display_name, role, created_at, updated_at)
            VALUES (?, '大宝', 'member', ?, ?)
            """,
            (self.admin.family_id, now, now),
        ).lastrowid
        conn.commit()
        conn.close()

        member_id, _ = self.add_member("大宝", "dabao", "member-pass")
        self.assertEqual(member_id, pending_id)
        with use_auth_context(self.admin):
            members = get_family()["members"]
        self.assertEqual(sum(item["display_name"] == "大宝" for item in members), 1)

    def test_http_scope_header_reaches_protected_routes(self):
        member_id, member_context = self.add_member()
        with use_auth_context(self.admin):
            create_account(AccountCreate(
                name="管理员账户",
                type="debit_card",
                member_id=self.admin.member_id,
                balance=1000,
            ))
            create_account(AccountCreate(
                name="成员账户",
                type="debit_card",
                member_id=member_id,
                balance=500,
            ))
        token = auth.create_access_token(
            member_context.user_id,
            member_context.family_id,
            1,
        )
        app = FastAPI()
        app.include_router(accounts.router, dependencies=[Depends(auth.require_auth)])

        async def request(scope_value):
            messages = []
            headers = [(b"authorization", f"Bearer {token}".encode())]
            if scope_value:
                headers.append((b"x-data-scope", scope_value.encode()))

            async def receive():
                return {"type": "http.request", "body": b"", "more_body": False}

            async def send(message):
                messages.append(message)

            await app({
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": "GET",
                "path": "/accounts/overview",
                "raw_path": b"/accounts/overview",
                "query_string": b"",
                "headers": headers,
                "scheme": "http",
                "server": ("test", 80),
                "client": ("test", 1),
            }, receive, send)
            status = next(
                message["status"] for message in messages
                if message["type"] == "http.response.start"
            )
            body = b"".join(
                message.get("body", b"") for message in messages
                if message["type"] == "http.response.body"
            )
            return status, json.loads(body)

        family_status, family = asyncio.run(request("family"))
        personal_status, personal = asyncio.run(request("personal"))
        default_status, default_scope = asyncio.run(request(None))
        self.assertEqual(family_status, 200)
        self.assertEqual(family["asset_total"], 1500)
        self.assertEqual(personal_status, 200)
        self.assertEqual(personal["asset_total"], 500)
        self.assertEqual(personal["accounts"][0]["member_id"], member_id)
        self.assertEqual(default_status, 200)
        self.assertEqual(default_scope["asset_total"], 500)
        self.assertEqual(default_scope["accounts"][0]["member_id"], member_id)

    def test_restart_never_replaces_member_owner_with_institution(self):
        conn = database.get_connection()
        account_id = conn.execute(
            """
            INSERT INTO accounts
            (name, type, owner, institution, balance, is_active)
            VALUES ('工资卡', 'debit_card', '大宝', '招商银行', 1000, 1)
            """
        ).lastrowid
        conn.commit()
        conn.close()

        database.init_db()

        conn = database.get_connection()
        account = conn.execute(
            """
            SELECT a.owner, fm.display_name
            FROM accounts a
            JOIN family_members fm ON fm.id = a.member_id
            WHERE a.id = ?
            """,
            (account_id,),
        ).fetchone()
        member_names = {
            row["display_name"]
            for row in conn.execute("SELECT display_name FROM family_members")
        }
        conn.close()
        self.assertEqual((account["owner"], account["display_name"]), ("大宝", "大宝"))
        self.assertNotIn("招商银行", member_names)

    def test_cross_environment_restore_maps_stable_member_instead_of_numeric_id(self):
        alice_id, alice_context = self.add_member("Alice", "alice", "alice-pass")
        with use_auth_context(self.admin):
            create_account(AccountCreate(
                name="Alice账户",
                type="debit_card",
                member_id=alice_id,
                balance=800,
            ))
        conn = database.get_connection()
        category_id = conn.execute(
            "SELECT id FROM categories WHERE name = '餐饮' AND type = 'expense'"
        ).fetchone()["id"]
        conn.close()
        with use_auth_context(self.admin):
            create_or_update_budget(BudgetCreate(
                month="2026-09",
                total_amount=1000,
                categories=[
                    BudgetCategoryAllocation(
                        category_id=category_id,
                        amount=1000,
                        member_allocations=[
                            MemberAmountAllocation(member_id=self.admin.member_id, amount=0),
                            MemberAmountAllocation(member_id=alice_id, amount=1000),
                        ],
                    ),
                ],
            ))
            create_goal(GoalCreate(
                name="Alice目标",
                target_amount=10000,
                allocations=[
                    GoalMemberAllocation(
                        member_id=alice_id,
                        target_amount=10000,
                        current_amount=1000,
                    ),
                ],
            ))
        conn = database.get_connection()
        source_backup = snapshot(conn, self.admin.family_id)
        alice_key = next(
            item["member_key"] for item in source_backup["members"]
            if item["source_id"] == alice_id
        )
        conn.close()

        original = (database.DB_DIR, database.DB)
        with tempfile.TemporaryDirectory() as target_dir:
            database.DB_DIR = target_dir
            database.DB = os.path.join(target_dir, "target.db")
            database.init_db()
            target_admin = auth.context_from_token(
                auth.create_access_token_for_username("admin"),
                "family",
            )
            with use_auth_context(target_admin):
                bob_id = create_family_member(FamilyMemberCreate(
                    display_name="Bob",
                    username="bob",
                    password="bob-pass",
                ))["id"]
                conn = database.get_connection()
                preview = normalize_backup_scope(
                    conn,
                    source_backup,
                    target_admin.family_id,
                )
                self.assertEqual(
                    next(
                        item["action"] for item in preview["member_mapping"]
                        if item["source_name"] == "Alice"
                    ),
                    "create_pending",
                )
                current = snapshot(conn, target_admin.family_id)
                conn.close()
                prepared = prepare_family_restore(source_backup, fingerprint(current))
                with database.write_connection() as conn:
                    restore(conn, source_backup, fingerprint(current), prepared=prepared)

            conn = database.get_connection()
            alice = conn.execute(
                "SELECT id, member_key FROM family_members WHERE display_name = 'Alice'"
            ).fetchone()
            account_owner = conn.execute(
                "SELECT member_id FROM accounts WHERE name = 'Alice账户'"
            ).fetchone()["member_id"]
            budget_owner = conn.execute(
                """
                SELECT bma.member_id
                FROM budget_member_allocations bma
                JOIN budget_plans bp ON bp.id = bma.budget_plan_id
                WHERE bp.month = '2026-09' AND bma.amount > 0
                """
            ).fetchone()["member_id"]
            goal_owner = conn.execute(
                """
                SELECT ga.member_id
                FROM goal_allocations ga
                JOIN goals g ON g.id = ga.goal_id
                WHERE g.name = 'Alice目标'
                """
            ).fetchone()["member_id"]
            conn.close()
            self.assertNotEqual(alice["id"], bob_id)
            self.assertEqual(alice["member_key"], alice_key)
            self.assertEqual(
                (account_owner, budget_owner, goal_owner),
                (alice["id"], alice["id"], alice["id"]),
            )
        database.DB_DIR, database.DB = original


if __name__ == "__main__":
    unittest.main()
