"""Render the lossless ledger export from a scoped read model."""
import csv
from io import StringIO

from fastapi.responses import Response

from queries.ledger import ledger_export_rows


def export_ledger():
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "日期", "类型", "所属人", "账户", "转入账户", "分类", "金额",
        "币种", "本位币金额", "商户/来源", "备注", "方向", "账户ID", "汇率",
        "流水号", "来源", "状态", "影响余额", "关联编号",
    ])
    source_labels = {
        "manual": "收支", "transfer": "转账",
        "opening": "期初余额", "adjustment": "余额调整",
    }
    for item in ledger_export_rows():
        direction = "收入" if item["direction"] == "income" else "支出"
        writer.writerow([
            item.get("occurred_at"),
            direction if (item.get("source") or "manual") == "manual"
            else source_labels.get(item.get("source"), item.get("source")),
            item.get("account_owner") or item.get("from_account_owner"),
            item.get("account_name") or item.get("from_account_name"),
            item.get("to_account_name"),
            item.get("category_name"),
            item.get("amount"),
            item.get("currency"),
            item.get("base_amount"),
            item.get("merchant"),
            item.get("note"),
            direction, item["account_id"], item["exchange_rate_to_base"],
            f"invest-transaction-{item['id']}", item.get("source") or "manual",
            "已撤销" if item.get("voided_at") else "有效",
            item["balance_applied"], item.get("reference_id"),
        ])
    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="invest-ledger.csv"'},
    )
