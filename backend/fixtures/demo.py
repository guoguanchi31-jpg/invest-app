"""Opt-in demo records; never invoked by versioned migrations."""

from datetime import date, timedelta

from domain.calendar import business_now, business_today


def seed_demo_data(conn):
    now = business_now().isoformat(timespec="seconds")
    today = business_today()
    current_month = today.strftime("%Y-%m")

    if conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0:
        conn.executemany(
            """
            INSERT INTO accounts
            (name, type, owner, institution, balance, last4, credit_limit,
             statement_day, repayment_day, is_liability, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("储蓄卡", "debit_card", "大宝", "招商银行", 128400, "6621", 0, None, None, 0, now, now),
                ("电子钱包", "wallet", "小宝", "微信 · 支付宝", 8650, None, 0, None, None, 0, now, now),
                ("投资账户", "investment", "大宝", "天天基金 · 富途", 474300, None, 0, None, None, 0, now, now),
                ("定期存款", "deposit", "小宝", "工商银行", 291350, "0912", 0, None, None, 0, now, now),
                ("招行信用卡", "credit_card", "大宝", "招商银行", 28600, "3382", 50000, 8, 18, 1, now, now),
                ("中信白金卡", "credit_card", "小宝", "中信银行", 11650, "7745", 80000, 15, 25, 1, now, now),
            ],
        )

    if conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 0:
        conn.executemany(
            """
            INSERT INTO categories (name, type, icon, color, sort_order)
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                ("居住", "expense", "🏠", "#214f3b", 1),
                ("餐饮", "expense", "🍜", "#2f6049", 2),
                ("服饰", "expense", "👕", "#c8914b", 3),
                ("交通", "expense", "🚕", "#df7f56", 4),
                ("娱乐", "expense", "🎬", "#b7ae9d", 5),
                ("医疗健康", "expense", "🏥", "#78a88a", 6),
                ("工资", "income", "💰", "#214f3b", 7),
                ("投资收益", "income", "📈", "#c8914b", 8),
            ],
        )

    account_ids = {
        row["name"]: row["id"]
        for row in conn.execute("SELECT id, name FROM accounts")
    }
    category_ids = {
        row["name"]: row["id"]
        for row in conn.execute("SELECT id, name FROM categories")
    }

    if conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 0:
        base = today.replace(day=min(today.day, 7))
        transactions = [
            ("储蓄卡", "工资", 32000, "income", base.replace(day=5), "工资入账", "7月工资"),
            ("投资账户", "投资收益", 620, "income", base.replace(day=4), "基金定投分红", "分红"),
            ("储蓄卡", "居住", 6200, "expense", base.replace(day=1), "房租", "月租"),
            ("储蓄卡", "餐饮", 88, "expense", today, "午餐 · 云海肴", "午餐"),
            ("电子钱包", "交通", 46, "expense", today - timedelta(days=1), "滴滴出行", "打车"),
            ("招行信用卡", "服饰", 432, "expense", today - timedelta(days=2), "服装门店", "服饰"),
            ("储蓄卡", "餐饮", 4032, "expense", base.replace(day=6), "日常餐饮", "月度汇总"),
            ("招行信用卡", "服饰", 2778, "expense", base.replace(day=7), "服饰电商", "月度汇总"),
            ("电子钱包", "交通", 2774, "expense", base.replace(day=7), "通勤交通", "月度汇总"),
            ("中信白金卡", "娱乐", 1540, "expense", base.replace(day=6), "影音娱乐", "月度汇总"),
            ("储蓄卡", "医疗健康", 630, "expense", base.replace(day=3), "药房", "健康"),
            ("投资账户", "投资收益", 9980, "income", base.replace(day=6), "投资收益", "月度收益"),
        ]
        conn.executemany(
            """
            INSERT INTO transactions
            (account_id, category_id, amount, currency, exchange_rate_to_base,
             base_amount, fx_status, direction, occurred_at, merchant, note,
             created_at, updated_at)
            VALUES (?, ?, ?, 'CNY', 1, ?, 'captured', ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    account_ids[account_name],
                    category_ids[category_name],
                    amount,
                    amount,
                    direction,
                    occurred_at.isoformat(),
                    merchant,
                    note,
                    now,
                    now,
                )
                for (
                    account_name,
                    category_name,
                    amount,
                    direction,
                    occurred_at,
                    merchant,
                    note,
                ) in transactions
            ],
        )

    if conn.execute("SELECT COUNT(*) FROM holdings").fetchone()[0] == 0:
        investment_account_id = account_ids.get("投资账户")
        conn.executemany(
            """
            INSERT INTO holdings
            (name, code, buy_price, quantity, current_price, account_id,
             asset_type, market, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("易方达蓝筹精选", "005827", 2.150, 39582, 2.486, investment_account_id, "fund", "CN", now),
                ("贵州茅台", "600519", 1620, 50, 1712, investment_account_id, "stock", "SH", now),
                ("天弘中证低ETF联接", "011613", 1.082, 68157, 1.118, investment_account_id, "bond", "CN", now),
                ("纳斯达克100 QDII", "160213", 3.240, 20013, 3.098, investment_account_id, "fund", "CN", now),
                ("博时黄金ETF", "159937", 5.680, 7737, 6.204, investment_account_id, "gold", "CN", now),
            ],
        )

    if conn.execute(
        "SELECT COUNT(*) FROM budgets WHERE month = ?",
        (current_month,),
    ).fetchone()[0] == 0:
        conn.executemany(
            """
            INSERT INTO budgets
            (month, category_id, amount, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                (current_month, category_ids["居住"], 7000, now, now),
                (current_month, category_ids["餐饮"], 4000, now, now),
                (current_month, category_ids["服饰"], 5000, now, now),
                (current_month, category_ids["交通"], 4000, now, now),
                (current_month, category_ids["娱乐"], 3000, now, now),
                (current_month, category_ids["医疗健康"], 2000, now, now),
            ],
        )

    if conn.execute("SELECT COUNT(*) FROM goals").fetchone()[0] == 0:
        conn.executemany(
            """
            INSERT INTO goals
            (name, icon, target_amount, current_amount, monthly_saving, due_date,
             color, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("环球旅行基金", "🏝️", 150000, 102000, 4000, "2027-06-30", "#c8914b", "active", now, now),
                ("购房首付", "🏠", 1200000, 504000, 6000, "2030-12-31", "#214f3b", "active", now, now),
                ("家庭应急金", "🛟", 200000, 156000, 2000, "2026-12-31", "#78a88a", "active", now, now),
                ("学习成长基金", "📚", 300000, 50000, 0, "2029-12-31", "#b46b4d", "paused", now, now),
            ],
        )

    if conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0] == 0:
        snapshots = []
        for months_ago, net_worth in enumerate(
            [480000, 510000, 540000, 530000, 630000, 670000, 720000, 780000, 862450][::-1]
        ):
            snapshot_date = today - timedelta(days=months_ago * 30)
            asset_total = net_worth + 40250
            snapshots.append(
                (
                    snapshot_date.isoformat(),
                    asset_total,
                    40250,
                    net_worth,
                    min(474300, net_worth * 0.55),
                    min(388102, net_worth * 0.45),
                    now,
                )
            )
        conn.executemany(
            """
            INSERT INTO snapshots
            (snapshot_date, asset_total, liability_total, net_worth,
             investment_value, cash_value, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            snapshots,
        )
