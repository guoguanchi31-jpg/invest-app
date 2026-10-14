"""Versioned audit shapes and pure restore mapping; no database dependencies."""

AUDIT_PAYLOAD_VERSION = 1
ENTITY_TABLES = {
    "account": "accounts", "category": "categories", "transaction": "transactions",
    "holding": "holdings", "investment_trade": "investment_trades",
    "budget": "budgets", "budget_plan": "budget_plans", "goal": "goals",
    "goal_record": "goal_records", "family_member": "family_members",
}
VALUE_KEYS = {
    "account_id": "accounts", "from_account_id": "accounts", "to_account_id": "accounts",
    "category_id": "categories", "holding_id": "holdings", "goal_id": "goals",
    "budget_plan_id": "budget_plans", "member_id": "family_members",
}
CHILD_ROWS = {
    "transactions": {"transaction": "transactions", "account": "accounts"},
    "goals": {"goal": "goals", "allocations": "goal_allocations"},
    "goal_records": {
        "goal": "goals", "allocation": "goal_allocations", "record": "goal_records",
    },
    "budget_plans": {
        "categories": "budgets", "member_allocations": "budget_member_allocations",
        "allocations": "budget_member_allocations",
        "category_allocations": "budget_category_allocations",
    },
    "investment_trades": {
        "account_before": "accounts", "account_after": "accounts",
        "holding_before": "holdings", "holding_after": "holdings",
    },
}


def historical_id(value):
    if value is None or str(value).startswith("legacy:"):
        return value
    return f"legacy:{value}"


def mapped_id(maps, table, value):
    if value is None or str(value).startswith("legacy:"):
        return value
    try:
        return maps.get(table, {}).get(int(value), historical_id(value))
    except (ValueError, TypeError):
        return historical_id(value)


def historical_payload(value, version):
    if isinstance(value, dict) and value.get("_id_namespace") == "historical":
        return value
    return {"_id_namespace": "historical", "payload_version": version, "value": value}


def remap_audit_payload(value, entity, version, maps, references, family_id):
    """Versions 0/1 share known shapes. Unknown shapes keep an explicit namespace."""
    if value is None:
        return None
    if version not in (0, AUDIT_PAYLOAD_VERSION):
        return historical_payload(value, version)
    if isinstance(value, dict) and value.get("_id_namespace") == "historical":
        return value

    def row(item, table):
        if item is None:
            return None
        if isinstance(item, list):
            return [row(child, table) for child in item]
        if not isinstance(item, dict):
            return historical_payload(item, version)
        if item.get("_id_namespace") == "historical":
            return item
        children = CHILD_ROWS.get(table, {})
        # A known row or a registered aggregate is required to interpret its IDs.
        if "id" not in item and not children.keys() & item.keys() and table != "transaction_batch":
            return historical_payload(item, version)
        result = {}
        for key, child in item.items():
            if key in children:
                result[key] = row(child, children[key])
            elif key == "id":
                result[key] = mapped_id(maps, table, child)
            elif key == "parent_id" and table == "categories":
                result[key] = mapped_id(maps, "categories", child)
            elif key in VALUE_KEYS:
                result[key] = mapped_id(maps, VALUE_KEYS[key], child)
            elif key == "family_id":
                result[key] = family_id
            elif key in {"actor_user_id", "user_id"}:
                result[key] = None
            elif key == "reference_id":
                result[key] = references.get(child, child)
            elif key in {"account_ids", "transaction_ids"} and isinstance(child, list):
                target = "accounts" if key == "account_ids" else "transactions"
                result[key] = [mapped_id(maps, target, identifier) for identifier in child]
            elif isinstance(child, (list, dict)):
                result[key] = historical_payload(child, version)
            elif key.endswith("_id"):
                result[key] = historical_id(child)
            else:
                result[key] = child
        return result

    if entity == "transfer" and isinstance(value, list):
        result = []
        for item in value:
            if isinstance(item, dict) and {"direction", "account_id"} <= item.keys():
                result.append(row(item, "transactions"))
            elif isinstance(item, dict) and {"balance", "type"} <= item.keys():
                result.append(row(item, "accounts"))
            else:
                result.append(historical_payload(item, version))
        return result
    table = ENTITY_TABLES.get(entity)
    if entity == "transaction_batch":
        table = entity
    return row(value, table) if table else historical_payload(value, version)
