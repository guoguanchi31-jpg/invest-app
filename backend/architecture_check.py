"""AST-based dependency and transaction-boundary checks."""

import ast
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parent
FINANCIAL_APPLICATION_MODULES = {
    "application.accounts",
    "application.budgets",
    "application.goals",
    "application.investing",
    "application.investments",
    "application.ledger",
}
FINANCIAL_USE_CASES = {
    "add_holding",
    "adjust_account_balance",
    "copy_monthly_budget",
    "correct_transaction_application",
    "create_account",
    "create_goal",
    "create_goal_record",
    "create_investment_trade",
    "create_or_update_budget",
    "create_transaction",
    "delete_account",
    "delete_goal",
    "delete_holding",
    "delete_monthly_budget",
    "delete_transaction",
    "import_statement_transactions",
    "reconcile_investment_cash",
    "restore_account",
    "reverse_investment_trade",
    "reverse_transfer",
    "transfer_between_accounts",
    "update_account",
    "update_goal",
    "update_goal_status",
    "update_holding",
    "update_investment_cash",
    "update_transaction",
}


def _modules():
    result = {}
    for path in BACKEND_ROOT.rglob("*.py"):
        if "tests" in path.parts or "venv" in path.parts or path.name == "__init__.py":
            continue
        name = ".".join(path.relative_to(BACKEND_ROOT).with_suffix("").parts)
        result[name] = path
    return result


def _imports(tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            yield from (alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            yield node.module


def _calls_named(tree, names):
    return [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr in names
    ]


def validate_architecture():
    modules = _modules()
    trees = {
        name: ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for name, path in modules.items()
    }
    errors = []
    edges = {name: set() for name in modules}

    for name, tree in trees.items():
        imports = set(_imports(tree))
        edges[name].update(item for item in imports if item in modules)
        if name.startswith("domain."):
            forbidden = sorted(
                item
                for item in imports
                if item == "fastapi"
                or item == "database"
                or item.split(".")[0] in {"sqlite3", "psycopg", "psycopg2", "sqlalchemy"}
                or item.startswith(("routers", "application", "queries", "infrastructure"))
            )
            if forbidden:
                errors.append(f"{name} has forbidden imports: {', '.join(forbidden)}")
            sql_calls = _calls_named(tree, {"execute", "executemany", "executescript", "cursor"})
            sql_calls += [
                node for node in ast.walk(tree)
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id in {"execute", "executemany", "executescript"}
            ]
            if sql_calls:
                errors.append(f"{name} contains database execution")
        if name.startswith(("application.", "queries.", "infrastructure.")):
            forbidden = sorted(item for item in imports if item.startswith("routers"))
            if forbidden:
                errors.append(f"{name} imports HTTP routers: {', '.join(forbidden)}")
        if name.startswith(("application.", "queries.")) and "database" in imports:
            errors.append(f"{name} bypasses infrastructure.database")
        if name.startswith("application."):
            uncoordinated = [
                node for node in ast.walk(tree)
                if isinstance(node, ast.Call)
                and (
                    isinstance(node.func, ast.Name) and node.func.id == "write_connection"
                    or isinstance(node.func, ast.Attribute) and node.func.attr == "write_connection"
                )
            ]
            if uncoordinated:
                errors.append(f"{name} opens a write transaction without family coordination")
        if name.startswith("queries."):
            forbidden = sorted(
                item for item in imports if item.startswith("application.")
            )
            if forbidden:
                errors.append(
                    f"{name} imports application orchestration: "
                    f"{', '.join(forbidden)}"
                )
        if name.startswith("routers."):
            if _calls_named(tree, {"execute", "executemany"}):
                errors.append(f"{name} contains database execution")
        if name in FINANCIAL_APPLICATION_MODULES:
            for node in tree.body:
                if (
                    isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                    and node.name in FINANCIAL_USE_CASES
                    and _calls_named(node, {"commit", "rollback", "close"})
                ):
                    errors.append(
                        f"{name}.{node.name} owns connection lifecycle "
                        "inside a financial use case"
                    )

    visiting = []
    visited = set()

    def visit(module):
        if module in visiting:
            cycle = visiting[visiting.index(module):] + [module]
            errors.append("import cycle: " + " -> ".join(cycle))
            return
        if module in visited:
            return
        visiting.append(module)
        for dependency in edges[module]:
            visit(dependency)
        visiting.pop()
        visited.add(module)

    for module in modules:
        visit(module)
    return sorted(set(errors))


def main():
    errors = validate_architecture()
    if errors:
        raise SystemExit("\n".join(errors))
    print("Architecture checks passed.")


if __name__ == "__main__":
    main()
