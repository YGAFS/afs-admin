-- Purchase parser follow-up. Safe to run after warehousing_purchases.sql.
-- Stores the human-reviewed shipping/location text extracted from an order.

alter table purchases
  add column if not exists shipping_location_text text;
