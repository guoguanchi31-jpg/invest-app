"""Deterministic compatibility for snapshot dates from legacy storage."""

from copy import deepcopy

from domain.dates import stored_business_date


def normalize_legacy_snapshot_rows(rows):
    """Normalize legacy dates and collapse only conversion-created collisions."""
    normalized_rows = []
    ids = set()
    duplicate_ids = set()
    grouped = {}
    changed_count = 0
    for source in rows:
        row = deepcopy(source)
        row_id = row.get("id")
        if row_id in ids:
            duplicate_ids.add(row_id)
        ids.add(row_id)
        original_date = row.get("snapshot_date")
        normalized_date = stored_business_date(original_date, nullable=False)
        changed_count += int(original_date != normalized_date)
        row["snapshot_date"] = normalized_date
        key = (row.get("family_id"), row.get("member_id"), normalized_date)
        grouped.setdefault(key, []).append((row, original_date))

    collisions = []
    for (family_id, member_id, normalized_date), candidates in grouped.items():
        original_dates = [original for _, original in candidates]
        conversion_collision = (
            len(candidates) > 1
            and len(set(original_dates)) == len(original_dates)
            and any(original != normalized_date for original in original_dates)
            and not any(row["id"] in duplicate_ids for row, _ in candidates)
        )
        if not conversion_collision:
            normalized_rows.extend(row for row, _ in candidates)
            continue
        winner, winner_original = max(
            candidates,
            key=lambda item: (item[0].get("created_at") or "", item[0]["id"]),
        )
        discarded = [
            {
                "id": row["id"],
                "original_date": original,
                "created_at": row.get("created_at"),
            }
            for row, original in candidates
            if row["id"] != winner["id"]
        ]
        normalized_rows.append(winner)
        collisions.append({
            "family_id": family_id,
            "member_id": member_id,
            "snapshot_date": normalized_date,
            "kept": {
                "id": winner["id"],
                "original_date": winner_original,
                "created_at": winner.get("created_at"),
            },
            "discarded": discarded,
            "reason": (
                "旧 YYYYMMDD 与标准 YYYY-MM-DD 在日期规范化后指向同一快照；"
                "按 created_at、ID 依次选择最新记录，不合并金额"
            ),
        })

    normalized_rows.sort(key=lambda row: row.get("id") or 0)
    return normalized_rows, {
        "normalized_count": changed_count,
        "discarded_count": sum(
            len(item["discarded"]) for item in collisions
        ),
        "collisions": collisions,
    }
