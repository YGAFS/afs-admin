from datetime import date
from decimal import Decimal

from app.extractors.orkin import OrkinExtractor

# Trimmed/synthesized text mirroring a real Orkin bill. Orkin is on autopay: the
# charge line shows the real amount, but "TOTAL AMOUNT DUE" always prints $0.00
# because it's already been collected by the time the statement is generated.
AUTO_PAID_TEXT = """
BRANCH INFORMATION
1-SAN BERNARDINO
COMMERCIAL, CA
SERVICE ADDRESS FONTANA
07/17/2026
PC Standard - Semi-Monthly - PC
Standard
$227.86
$0.00
$227.86
$227.86
$0.00
Subtotal
$0.00

UNAPPLIED CREDITS
$0.00
TOTAL AMOUNT DUE
$0.00
Orkin
P O BOX 740300
CINCINNATI, OH 45274-0300

08/06/2026
CUSTOMER INFORMATION
Account Number
39816689
"""


def test_zero_total_due_is_treated_as_already_paid():
    # The real charge (current_charges) must still be registered — it's the $0.00
    # "TOTAL AMOUNT DUE" that's misleading, not the line-item amount.
    result = OrkinExtractor().extract(AUTO_PAID_TEXT)
    assert result.current_charges == Decimal("227.86")
    assert result.already_paid is True
    # total_due deliberately left unset here so the repository layer computes it
    # from previous_balance + current_charges instead of the misleading $0.00 —
    # passing $0.00 through would fail the balance-sum validation on every bill.
    assert result.total_due is None
    assert result.account_number == "39816689"
    assert result.issue_date == date(2026, 7, 17)


def test_nonzero_total_due_is_not_marked_already_paid():
    # If autopay ever fails to cover the charge, the real (non-zero) total prints
    # instead — that case must NOT be silently marked paid.
    text = AUTO_PAID_TEXT.replace(
        "TOTAL AMOUNT DUE\n$0.00", "TOTAL AMOUNT DUE\n$227.86"
    )
    result = OrkinExtractor().extract(text)
    assert result.already_paid is False
    assert result.total_due == Decimal("227.86")
