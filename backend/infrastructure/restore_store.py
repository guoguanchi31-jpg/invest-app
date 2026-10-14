"""Insert a restored book using database-assigned IDs and explicit link maps."""
import json
from uuid import uuid4

from infrastructure.database import FINANCIAL_TABLES
from domain.audit_payloads import ENTITY_TABLES, historical_id, mapped_id, remap_audit_payload


FOREIGN_KEYS = {
    "transactions": {"account_id": "accounts", "category_id": "categories"},
    "holdings": {"account_id": "accounts"},
    "investment_trades": {"account_id": "accounts", "holding_id": "holdings"},
    "budgets": {"category_id": "categories"},
    "budget_category_allocations": {
        "budget_plan_id": "budget_plans", "category_id": "categories",
    },
    "budget_member_allocations": {"budget_plan_id": "budget_plans"},
    "goal_allocations": {"goal_id": "goals"},
    "goal_records": {"goal_id": "goals"},
    "audit_event_accounts": {"audit_event_id": "audit_events", "account_id": "accounts"},
}


def insert_restored_rows(conn, payload):
    data = payload["data"]
    family_id = payload["family_id"]
    maps = {table: {} for table in FINANCIAL_TABLES}
    maps["family_members"] = {
        item["source_member_id"]: item["target_member_id"]
        for item in payload["member_mapping"]
    }
    references = {
        row["reference_id"]: f"transfer-{uuid4().hex}"
        for row in data["transactions"]
        if row.get("source") == "transfer" and row.get("reference_id")
    }
    for table in FINANCIAL_TABLES:
        for source in data[table]:
            row = {key: value for key, value in source.items() if key != "id"}
            for field, parent in FOREIGN_KEYS.get(table, {}).items():
                if row.get(field) is not None:
                    row[field] = maps[parent][row[field]]
            if table == "accounts":
                row["import_reference_namespace"] = (
                    row.get("import_reference_namespace") or str(source["id"])
                )
            if table == "categories":
                # Self references can point forward; fill them after all inserts.
                row["parent_id"] = None
            if table == "transactions":
                row["reference_id"] = references.get(row.get("reference_id"), row.get("reference_id"))
            if table == "audit_events":
                entity = row.get("entity_type")
                target = ENTITY_TABLES.get(entity)
                if target and row.get("entity_id") is not None:
                    row["entity_id"] = str(mapped_id(maps, target, row["entity_id"]))
                elif entity == "transfer":
                    row["entity_id"] = references.get(row["entity_id"], historical_id(row["entity_id"]))
                elif entity == "family":
                    row["entity_id"] = str(family_id)
                elif row.get("entity_id") is not None:
                    row["entity_id"] = historical_id(row["entity_id"])
                for field in ("before_value", "after_value"):
                    if row.get(field):
                        try:
                            value = json.loads(row[field])
                        except (ValueError, TypeError):
                            continue
                        row[field] = json.dumps(
                            remap_audit_payload(
                                value, entity, row.get("payload_version", 0),
                                maps, references, family_id,
                            ),
                            ensure_ascii=False, separators=(",", ":"),
                        )
            fields = list(row)
            quoted = ", ".join(f'"{field}"' for field in fields)
            params = ", ".join("?" for _ in fields)
            inserted = conn.execute(
                f"INSERT INTO {table} ({quoted}) VALUES ({params}) RETURNING id",
                tuple(row[field] for field in fields),
            ).fetchone()["id"]
            maps[table][source["id"]] = inserted
        if table == "categories":
            for source in data[table]:
                if source.get("parent_id") is not None:
                    conn.execute(
                        "UPDATE categories SET parent_id = ? WHERE id = ? AND family_id = ?",
                        (maps[table][source["parent_id"]], maps[table][source["id"]], family_id),
                    )
    return {"ids": maps, "transfer_references": references}
