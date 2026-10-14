"""Read transaction boundary; nested queries receive the connection explicitly."""

from functools import wraps
from inspect import signature

from infrastructure.database import consistent_read_connection


def consistent_query(query):
    """Own a snapshot unless the caller supplies its read/write transaction.

    No implicit ambient connection: composed queries must pass ``conn=conn``.
    This also releases connections on validation or serialization failures.
    """
    parameters = signature(query)

    @wraps(query)
    def read(*args, **kwargs):
        bound = parameters.bind(*args, **kwargs)
        if bound.arguments.get("conn") is not None:
            return query(*args, **kwargs)
        with consistent_read_connection() as conn:
            bound.arguments["conn"] = conn
            return query(*bound.args, **bound.kwargs)

    return read
