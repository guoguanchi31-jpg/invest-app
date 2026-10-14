"""Apply database schema migrations before starting the application."""

from infrastructure.database import get_schema_version, init_db
from migrations.schema import CURRENT_SCHEMA_VERSION
from security import validate_runtime_security


def main():
    validate_runtime_security()
    if get_schema_version() != CURRENT_SCHEMA_VERSION:
        init_db()
    print(f"Database schema is ready at version {get_schema_version()}.")


if __name__ == "__main__":
    main()
