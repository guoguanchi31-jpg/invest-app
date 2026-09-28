"""Read-only smoke check through the deployed web origin; never print financial rows."""
import argparse
import csv
import json
from io import StringIO
from urllib.request import Request, urlopen

from routers.auth import create_access_token


def verify(origin):
    headers = {"Authorization": f"Bearer {create_access_token()}"}
    for path, expected_type in [("/ledger", "application/json"), ("/ledger/export", "text/csv")]:
        with urlopen(Request(origin.rstrip("/") + path, headers=headers), timeout=30) as response:
            content_type = response.headers.get_content_type()
            if response.status != 200 or content_type != expected_type:
                raise RuntimeError(f"{path}: expected 200 {expected_type}, got {response.status} {content_type}")
            text = response.read().decode("utf-8-sig")
        if path == "/ledger":
            if not isinstance(json.loads(text), list):
                raise RuntimeError("/ledger: expected a JSON list")
        else:
            fields = next(csv.reader(StringIO(text)), [])
            if not {"方向", "金额", "汇率", "账户ID"}.issubset(fields):
                raise RuntimeError("/ledger/export: missing required CSV columns")
        print(f"{path}: 200 {expected_type}, verified")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="Deployed web origin, e.g. https://finance.example.com")
    verify(parser.parse_args().url)
