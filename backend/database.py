"""Compatibility alias for the database infrastructure module."""

import sys

from infrastructure import database as _implementation

sys.modules[__name__] = _implementation
