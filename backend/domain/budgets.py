"""Budget allocation rules."""

from decimal import Decimal

from domain.money import money


def distribute_budget_category_allocations(categories, members, default_member_id):
    """Build a cent-exact category/member matrix while preserving both totals."""
    category_cents = [
        (category_id, int(money(amount) * 100))
        for category_id, amount in categories
    ]
    total_cents = sum(amount for _, amount in category_cents)
    member_cents = [
        (member_id, max(int(money(amount) * 100), 0))
        for member_id, amount in members
    ]
    if not member_cents:
        member_cents = [(default_member_id, total_cents)]

    source_total = sum(amount for _, amount in member_cents)
    if source_total != total_cents:
        if source_total <= 0:
            member_cents = [(default_member_id, total_cents)]
        else:
            normalized = []
            assigned = 0
            ranked = []
            for index, (member_id, amount) in enumerate(member_cents):
                quotient, remainder = divmod(total_cents * amount, source_total)
                normalized.append([member_id, quotient])
                assigned += quotient
                ranked.append((remainder, index))
            remaining_cents = total_cents - assigned
            for _, index in sorted(
                ranked,
                key=lambda item: (-item[0], item[1]),
            )[:remaining_cents]:
                normalized[index][1] += 1
            member_cents = [
                (member_id, amount)
                for member_id, amount in normalized
            ]

    remaining = {member_id: amount for member_id, amount in member_cents}
    member_order = [member_id for member_id, _ in member_cents]
    result = []
    for category_index, (category_id, category_total) in enumerate(category_cents):
        if category_index == len(category_cents) - 1:
            allocations = dict(remaining)
        else:
            capacity_total = sum(remaining.values())
            allocations = {}
            assigned = 0
            ranked = []
            for index, member_id in enumerate(member_order):
                capacity = remaining[member_id]
                if capacity_total:
                    quotient, remainder = divmod(
                        category_total * capacity,
                        capacity_total,
                    )
                else:
                    quotient, remainder = 0, 0
                value = min(quotient, capacity)
                allocations[member_id] = value
                assigned += value
                if value < capacity:
                    ranked.append((remainder, index, member_id))
            needed = category_total - assigned
            for _, _, member_id in sorted(
                ranked,
                key=lambda item: (-item[0], item[1]),
            )[:needed]:
                allocations[member_id] += 1
        for member_id in member_order:
            amount = allocations.get(member_id, 0)
            remaining[member_id] -= amount
            result.append((
                category_id,
                member_id,
                money(Decimal(amount) / 100),
            ))
    return result
