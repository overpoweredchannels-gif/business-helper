-- Phase 22 — Books currency conversion: clamp micro-payments (2026-11-12)
--
-- Problem (proven 2026-11-12 on the disposable QA DB): converting the books
-- currency to EUR at rate 0.003201 failed with 23514 —
-- "new row for relation customer_payments violates check constraint
-- customer_payments_amount_positive (amount > 0)". Payments of Rs1.00 round
-- to EUR 0.00, tripping the CHECK and rolling back the whole atomic
-- conversion. The same failure would hit any payment small enough to round
-- to zero in the target currency.
--
-- Fix (UMAIR approved Option 1, 2026-11-12): a positive amount never
-- converts to zero — it clamps to the smallest unit (0.01). Applied to
-- every `amount` column the function converts (customer/supplier payments
-- and their allocations, expenses, collections) in both the dynamic
-- (document-currency) and static branches. The three strict `amount > 0`
-- CHECKs are customer_payments, supplier_payments and
-- supplier_payment_allocations; customer_payment_allocations allows >= 0
-- but is clamped too so an allocation stays consistent with its payment.
-- Other money columns (prices, totals, credit limits) have no positive
-- CHECK and keep the plain round.
--
-- Reconciliation: the clamp adds at most 0.01 per tiny row. The only
-- control key it touches is receivablesOutstanding (customer allocations);
-- in the QA org that is +0.03 against a tolerance of 0.095 — fits.
-- The function is otherwise byte-identical to the live definition
-- (pg_get_functiondef, 2026-11-12).
--
-- Apply order: run this on production BEFORE the FX user-entered-rate
-- slice deploys (the slice's switch calls this function). Safe to re-run.

CREATE OR REPLACE FUNCTION public.convert_organization_books_currency(p_organization_id uuid, p_actor_profile_id uuid, p_new_currency text, p_rate numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from text;
  v_doc_currency boolean;
  v_before jsonb;
  v_after jsonb;
  v_key text;
  v_event_id uuid;
  v_unmapped text;
BEGIN
  -- Migration presence: the function references the column dynamically
  -- here so a missing column raises the named error, not a raw 42703.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'organizations'
       AND column_name = 'books_currency'
  ) THEN
    RAISE EXCEPTION 'books.migrationMissing';
  END IF;

  IF p_new_currency NOT IN ('PKR','EUR','USD','GBP','AED','SAR','JPY','KWD') THEN
    RAISE EXCEPTION 'books.currencyInvalid';
  END IF;

  IF p_rate IS NULL OR p_rate <= 0 OR p_rate > 999999.999999
     OR round(p_rate, 6) <> p_rate THEN
    RAISE EXCEPTION 'books.invalidRate';
  END IF;

  -- Lock the org row: serializes concurrent conversion attempts.
  SELECT books_currency INTO v_from
    FROM public.organizations
   WHERE id = p_organization_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'books.organizationNotFound';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = p_actor_profile_id
       AND organization_id = p_organization_id
       AND role = 'owner'
       AND is_active IS DISTINCT FROM false
  ) THEN
    RAISE EXCEPTION 'books.forbidden' USING ERRCODE = '42501';
  END IF;

  -- Same-currency switch (also the double-submit guard: after a
  -- successful run the books currency HAS flipped, so a retried submit
  -- lands here and changes nothing).
  IF v_from = p_new_currency THEN
    RAISE EXCEPTION 'books.sameCurrency';
  END IF;

  -- Fail-closed schema guard: every numeric column on every in-scope
  -- table must be known — converted (money), known non-money, or a
  -- known foreign-layer column. Anything else aborts, named.
  SELECT c.table_name || '.' || c.column_name INTO v_unmapped
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.data_type IN ('numeric','integer','bigint','smallint','real','double precision')
     AND (c.table_name, c.column_name) NOT IN (
       -- money columns (converted)
       ('products','default_selling_price'), ('products','default_purchase_price'),
       ('products','last_purchase_price'),
       ('customer_product_prices','last_selling_price'),
       ('customers','credit_limit'),
       ('customers','outstanding_balance'),
       ('suppliers','credit_limit'), ('suppliers','outstanding_balance'),
       ('sales_transactions','total_amount'), ('sales_transactions','discount_amount'),
       ('sales_transactions','tax_amount'), ('sales_transactions','cash_received'),
       ('sales_transactions','change_due'), ('sales_transactions','credit_limit_snapshot'),
       ('sales_items','selling_price'), ('sales_items','purchase_price_snapshot'),
       ('sales_items','discount'),
       ('sales_order_items','unit_price'), ('sales_order_items','discount'),
       ('sales_return_items','unit_price'), ('sales_return_items','discount'),
       ('purchase_transactions','total_amount'), ('purchase_transactions','discount_amount'),
       ('purchase_transactions','tax_amount'),
       ('purchase_items','purchase_price'), ('purchase_items','selling_price'),
       ('purchase_order_items','unit_price'),
       ('purchase_return_items','unit_price'),
       ('customer_payments','amount'),
       ('customer_payment_allocations','amount'),
       ('supplier_payments','amount'),
       ('supplier_payment_allocations','amount'),
       ('expenses','amount'),
       ('collections','amount'),
       ('sales_targets','target_value'),
       -- known non-money numerics (never converted)
       ('products','id'), ('products','units_per_pack'), ('products','current_stock'),
       ('products','minimum_stock_level'), ('products','reorder_level'),
       ('customers','credit_days'),
       ('customers','latitude'), ('customers','longitude'),
       ('suppliers','credit_days'),
       ('sales_transactions','tax_rate'), ('sales_transactions','credit_days_snapshot'),
       ('sales_items','quantity'), ('sales_items','bonus'),
       ('sales_items','inventory_bonus_main'),
       ('sales_order_items','quantity_ordered'), ('sales_order_items','quantity_delivered'),
       ('sales_order_items','bonus'),
       ('sales_return_items','quantity'),
       ('purchase_transactions','tax_rate'),
       ('purchase_items','quantity'),
       ('purchase_order_items','quantity_ordered'), ('purchase_order_items','quantity_received'),
       ('purchase_return_items','quantity'),
       -- known foreign-layer columns (EUR subsystem; never converted)
       ('sales_transactions','fx_rate'), ('sales_transactions','base_total'),
       ('customer_payments','fx_rate'), ('customer_payments','base_amount'),
       ('customer_payments','fx_difference_base')
     )
     AND c.table_name IN (
       'products','customer_product_prices','customers','suppliers',
       'sales_transactions','sales_items','sales_order_items','sales_return_items',
       'purchase_transactions','purchase_items','purchase_order_items',
       'purchase_return_items','customer_payments','customer_payment_allocations',
       'supplier_payments','supplier_payment_allocations','expenses','collections',
       'sales_targets'
     )
   LIMIT 1;
  IF v_unmapped IS NOT NULL THEN
    RAISE EXCEPTION 'books.unmappedColumn:%', v_unmapped;
  END IF;

  v_doc_currency := EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'sales_transactions'
       AND column_name = 'currency'
  );

  v_before := public.books_conversion_control_totals(p_organization_id, v_doc_currency);

  -- ---------------------------------------------------------------------
  -- Conversions. Every statement is org-scoped; NULLs stay NULL.
  -- ---------------------------------------------------------------------

  UPDATE public.products
     SET default_selling_price = round(default_selling_price * p_rate, 2),
         default_purchase_price = round(default_purchase_price * p_rate, 2),
         last_purchase_price = round(last_purchase_price * p_rate, 2)
   WHERE organization_id = p_organization_id;

  UPDATE public.customer_product_prices
     SET last_selling_price = round(last_selling_price * p_rate, 2)
   WHERE organization_id = p_organization_id;

  UPDATE public.customers
     SET credit_limit = round(credit_limit * p_rate, 2),
         outstanding_balance = round(outstanding_balance * p_rate, 2)
   WHERE organization_id = p_organization_id;

  UPDATE public.suppliers
     SET credit_limit = round(credit_limit * p_rate, 2),
         outstanding_balance = round(outstanding_balance * p_rate, 2)
   WHERE organization_id = p_organization_id;

  -- Sales headers + items + payments: document-currency rows excluded
  -- when the EUR columns exist (dynamic statements for that reason).
  IF v_doc_currency THEN
    EXECUTE 'UPDATE public.sales_transactions
                SET total_amount = round(total_amount * $2, 2),
                    discount_amount = round(discount_amount * $2, 2),
                    tax_amount = round(tax_amount * $2, 2),
                    cash_received = round(cash_received * $2, 2),
                    change_due = round(change_due * $2, 2),
                    credit_limit_snapshot = round(credit_limit_snapshot * $2, 2)
              WHERE organization_id = $1 AND currency IS NULL'
      USING p_organization_id, p_rate;
    EXECUTE 'UPDATE public.sales_items
                SET selling_price = round(selling_price * $2, 2),
                    purchase_price_snapshot = round(purchase_price_snapshot * $2, 2),
                    discount = round(discount * $2, 2)
              WHERE organization_id = $1 AND currency IS NULL'
      USING p_organization_id, p_rate;
    EXECUTE 'UPDATE public.customer_payments
                SET amount = greatest(round(amount * $2, 2), CASE WHEN amount > 0 THEN 0.01 ELSE 0 END)
              WHERE organization_id = $1 AND currency IS NULL'
      USING p_organization_id, p_rate;
    EXECUTE 'UPDATE public.customer_payment_allocations a
                SET amount = greatest(round(a.amount * $2, 2), CASE WHEN a.amount > 0 THEN 0.01 ELSE 0 END)
               FROM public.sales_transactions t
              WHERE a.sales_transaction_id = t.id
                AND a.organization_id = $1 AND t.currency IS NULL'
      USING p_organization_id, p_rate;
  ELSE
    UPDATE public.sales_transactions
       SET total_amount = round(total_amount * p_rate, 2),
           discount_amount = round(discount_amount * p_rate, 2),
           tax_amount = round(tax_amount * p_rate, 2),
           cash_received = round(cash_received * p_rate, 2),
           change_due = round(change_due * p_rate, 2),
           credit_limit_snapshot = round(credit_limit_snapshot * p_rate, 2)
     WHERE organization_id = p_organization_id;
    UPDATE public.sales_items
       SET selling_price = round(selling_price * p_rate, 2),
           purchase_price_snapshot = round(purchase_price_snapshot * p_rate, 2),
           discount = round(discount * p_rate, 2)
     WHERE organization_id = p_organization_id;
    UPDATE public.customer_payments
       SET amount = greatest(round(amount * p_rate, 2), CASE WHEN amount > 0 THEN 0.01 ELSE 0 END)
     WHERE organization_id = p_organization_id;
    UPDATE public.customer_payment_allocations
       SET amount = greatest(round(amount * p_rate, 2), CASE WHEN amount > 0 THEN 0.01 ELSE 0 END)
     WHERE organization_id = p_organization_id;
  END IF;

  UPDATE public.sales_order_items i
     SET unit_price = round(i.unit_price * p_rate, 2),
         discount = round(i.discount * p_rate, 2)
    FROM public.sales_orders o
   WHERE i.sales_order_id = o.id AND o.organization_id = p_organization_id;

  UPDATE public.sales_return_items
     SET unit_price = round(unit_price * p_rate, 2),
         discount = round(discount * p_rate, 2)
   WHERE organization_id = p_organization_id;

  UPDATE public.purchase_transactions
     SET total_amount = round(total_amount * p_rate, 2),
         discount_amount = round(discount_amount * p_rate, 2),
         tax_amount = round(tax_amount * p_rate, 2)
   WHERE organization_id = p_organization_id;

  UPDATE public.purchase_items
     SET purchase_price = round(purchase_price * p_rate, 2),
         selling_price = round(selling_price * p_rate, 2)
   WHERE organization_id = p_organization_id;

  UPDATE public.purchase_order_items i
     SET unit_price = round(i.unit_price * p_rate, 2)
    FROM public.purchase_orders o
   WHERE i.purchase_order_id = o.id AND o.organization_id = p_organization_id;

  UPDATE public.purchase_return_items
     SET unit_price = round(unit_price * p_rate, 2)
   WHERE organization_id = p_organization_id;

  UPDATE public.supplier_payments
     SET amount = greatest(round(amount * p_rate, 2), CASE WHEN amount > 0 THEN 0.01 ELSE 0 END)
   WHERE organization_id = p_organization_id;

  UPDATE public.supplier_payment_allocations
     SET amount = greatest(round(amount * p_rate, 2), CASE WHEN amount > 0 THEN 0.01 ELSE 0 END)
   WHERE organization_id = p_organization_id;

  UPDATE public.expenses
     SET amount = greatest(round(amount * p_rate, 2), CASE WHEN amount > 0 THEN 0.01 ELSE 0 END)
   WHERE organization_id = p_organization_id;

  UPDATE public.collections
     SET amount = greatest(round(amount * p_rate, 2), CASE WHEN amount > 0 THEN 0.01 ELSE 0 END)
   WHERE organization_id = p_organization_id;

  -- Sales targets are currency-denominated only for revenue/collections
  -- metrics; order/customer/product targets are counts and stay put.
  UPDATE public.sales_targets
     SET target_value = round(target_value * p_rate, 2)
   WHERE organization_id = p_organization_id
     AND metric IN ('revenue', 'collections');

  -- ---------------------------------------------------------------------
  -- Reconcile, then flip, then audit. Any failure above this comment or
  -- in the check below rolls the whole transaction back.
  -- ---------------------------------------------------------------------

  v_after := public.books_conversion_control_totals(p_organization_id, v_doc_currency);

  FOR v_key IN SELECT jsonb_object_keys(v_before) LOOP
    IF abs((v_after -> v_key ->> 'total')::numeric
           - (v_before -> v_key ->> 'total')::numeric * p_rate)
       > 0.005 * (v_before -> v_key ->> 'units')::numeric + 0.01 THEN
      RAISE EXCEPTION 'books.reconciliationFailed:%', v_key;
    END IF;
  END LOOP;

  UPDATE public.organizations
     SET books_currency = p_new_currency
   WHERE id = p_organization_id;

  INSERT INTO public.currency_conversion_events (
    organization_id, actor_profile_id, from_currency, to_currency, rate,
    control_totals_before, control_totals_after
  ) VALUES (
    p_organization_id, p_actor_profile_id, v_from, p_new_currency, p_rate,
    v_before, v_after
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.audit_logs (
    organization_id, actor_profile_id, action, entity_type, entity_id,
    entity_label, description, new_values
  ) VALUES (
    p_organization_id, p_actor_profile_id, 'books_currency_converted',
    'organization', p_organization_id, p_new_currency,
    'Books currency converted from ' || v_from || ' to ' || p_new_currency
      || ' at rate ' || p_rate::text,
    jsonb_build_object('event_id', v_event_id, 'from_currency', v_from,
                       'to_currency', p_new_currency, 'rate', p_rate)
  );

  RETURN jsonb_build_object(
    'id', v_event_id,
    'organizationId', p_organization_id,
    'actorProfileId', p_actor_profile_id,
    'fromCurrency', v_from,
    'toCurrency', p_new_currency,
    'rate', p_rate,
    'controlTotalsBefore', v_before,
    'controlTotalsAfter', v_after
  );
END;
$function$;

-- Verification: the function exists and carries the clamp on all 8 sites.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.convert_organization_books_currency(uuid, uuid, text, numeric)'::regprocedure) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'phase22: convert_organization_books_currency missing';
  END IF;
  IF v_def NOT LIKE '%greatest(round(amount * p_rate, 2), CASE WHEN amount > 0 THEN 0.01 ELSE 0 END)%' THEN
    RAISE EXCEPTION 'phase22: clamp missing on static amount columns';
  END IF;
  IF v_def NOT LIKE '%greatest(round(amount * $2, 2), CASE WHEN amount > 0 THEN 0.01 ELSE 0 END)%' THEN
    RAISE EXCEPTION 'phase22: clamp missing on dynamic customer_payments';
  END IF;
  IF v_def NOT LIKE '%greatest(round(a.amount * $2, 2), CASE WHEN a.amount > 0 THEN 0.01 ELSE 0 END)%' THEN
    RAISE EXCEPTION 'phase22: clamp missing on dynamic allocations';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
