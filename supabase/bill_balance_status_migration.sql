-- Step 1: Add balance_status column
ALTER TABLE utility_bills
  ADD COLUMN IF NOT EXISTS balance_status text NOT NULL DEFAULT 'open'
    CHECK (balance_status IN ('open','partially_paid','paid','carried_forward','waived')),
  ADD COLUMN IF NOT EXISTS invoice_status text NOT NULL DEFAULT 'active'
    CHECK (invoice_status IN ('active','void')),
  ADD COLUMN IF NOT EXISTS total_due        numeric(10,2),
  ADD COLUMN IF NOT EXISTS amount_paid      numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_balance numeric(10,2),
  ADD COLUMN IF NOT EXISTS late_fee         numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax              numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustments      numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS needs_amount_review boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS carried_forward_to_bill_id uuid REFERENCES utility_bills(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS carried_forward_amount numeric(10,2);

-- Step 2: bill_carryovers table
CREATE TABLE IF NOT EXISTS bill_carryovers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_bill_id uuid NOT NULL REFERENCES utility_bills(id) ON DELETE CASCADE,
  target_bill_id uuid REFERENCES utility_bills(id) ON DELETE SET NULL,
  amount        numeric(10,2) NOT NULL,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Step 3: Backfill balance_status from is_paid
UPDATE utility_bills
SET balance_status = CASE WHEN is_paid THEN 'paid' ELSE 'open' END
WHERE balance_status = 'open';

-- Step 4: Backfill total_due from existing amount
UPDATE utility_bills
SET total_due = COALESCE(
  CASE WHEN current_charges IS NOT NULL
    THEN COALESCE(previous_balance,0) + current_charges
    ELSE amount
  END,
  amount
)
WHERE total_due IS NULL;

-- Step 5: Backfill amount_paid and remaining_balance
UPDATE utility_bills
SET
  amount_paid = CASE WHEN is_paid THEN COALESCE(total_due, amount, 0) ELSE 0 END,
  remaining_balance = CASE
    WHEN is_paid THEN 0
    ELSE COALESCE(total_due, amount, 0)
  END
WHERE amount_paid IS NULL OR remaining_balance IS NULL;

-- Step 6: Mark bills that have existing previous_balance data as needing review
UPDATE utility_bills
SET needs_amount_review = true
WHERE previous_balance IS NOT NULL AND previous_balance > 0;

-- Step 7: Backfill current_charges where missing
UPDATE utility_bills
SET current_charges = amount
WHERE current_charges IS NULL AND amount IS NOT NULL;
