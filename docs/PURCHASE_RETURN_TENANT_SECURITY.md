# Purchase-return tenant isolation

## Scope and schema evidence

This follow-up is based on integration commit `05330ef6a20475120e811083a80cdba86b5b98de` and the privately reviewed production schema export from 2026-10-02. The export stays outside the repository. Its deployed `products.id`, `purchase_return_items.product_id`, `purchase_return_items.purchase_return_id`, and organization identifiers are UUIDs. The isolated PostgreSQL 17.11 clone reports the same identifier types. The application migration therefore keeps UUIDs and fails closed if it encounters the stale integer-ID schema; it does not cast or convert deployed product IDs.

The relevant deployed quantity types are `purchase_return_items.quantity numeric(14,2)`, `products.current_stock numeric(18,6)`, and `inventory_transactions.quantity_delta numeric(18,6)`. The focused subunit regression uses a quantity of `1.50` with 12 units per pack, producing an exact stock effect of `0.125`.

Before the fix, the disposable target had one enabled row-level `AFTER INSERT OR UPDATE OR DELETE` stock trigger. Its `SECURITY DEFINER` function had no pinned `search_path`, had EXECUTE through `PUBLIC`/`anon`/`authenticated`, and updated products by product ID without also restricting the update to the validated organization. The item RLS policy checked the parent return organization but did not establish that the referenced product belonged to that same organization. A same-organization caller could therefore submit a line under its own return that referenced another organization's product; the privileged trigger could mutate that product's stock and write a ledger row.

## Migration

Apply `src/lib/migrations/20261005_purchase_return_tenant_isolation.sql` after the authoritative base schema and the existing purchase-return/subunit migrations. It requires UUID parent/item/product/organization identifiers, the existing enabled stock-writer trigger, its three DML events, and no existing rows whose parent, item, and product organizations disagree. The migration only fills a null item organization from its already-validated parent and then makes the item organization required.

The migration adds a `BEFORE INSERT OR UPDATE` tenant guard. It validates and locks the parent and product in parent-then-product order, fills omitted item organization IDs from the parent, and rejects cross-organization relationships or changes to the item's parent, product, or organization identity. `UPDATE` of a line's quantity/unit mode remains supported.

The existing `AFTER` stock writer remains the only stock writer. It locks the product row, checks its organization, scopes both stock updates to product ID and organization ID, rejects stock underflow, calculates old and new converted quantities separately, and writes the stock and ledger effects in the same transaction. A parent delete continues to cascade to its lines; the line's persisted organization ID allows the delete trigger to reverse stock after the parent row has been removed. Both trigger functions use an empty pinned `search_path` and schema-qualified table references. Direct EXECUTE grants to `PUBLIC`, `anon`, and `authenticated` are revoked because these functions are trigger entry points, not client RPCs.

The migration stops on inconsistent pre-existing rows rather than guessing ownership. Resolve any such rows using an owner-approved, record-specific cleanup before retrying it. It does not modify product identifier types or change the existing purchase-return parent/child cascade. The reviewed source ACL granted direct EXECUTE to `anon`, `authenticated`, and `service_role`; the migration revokes those grants and `PUBLIC` access because the trigger functions are not RPCs.

The ordinary `purchase_returns_update_org` RLS policy also prevents an owner from moving a return to another organization: its `USING` condition is reused as the update check. That alone does not protect integrity from a role that bypasses RLS. Migration `src/lib/migrations/20261006_purchase_return_parent_tenant_immutability.sql` adds a parent `BEFORE UPDATE OF organization_id` guard, so a privileged reassignment cannot strand existing lines under a different parent tenant. No application caller updates a return's organization; the supported workflows create returns, edit their lines, and delete returns. The new migration stops if it finds a pre-existing parent/item/product organization mismatch.

## Focused disposable-target regression

The runner is `node scripts/test-purchase-return-tenant-isolation.cjs`. It requires the protected `POS_RELEASE_*` environment loaded in the current PowerShell process, PostgreSQL `psql`, the existing private `PGPASSFILE`, and valid ordinary owner JWTs for the owner and second synthetic organization. It checks the API URL and project-scoped pooler user against disposable project `rtfowunsyrdygyvubnvs` before creating fixtures.

The runner validates ordinary tokens against the target Auth API and proves the database marker, PostgreSQL 17 major version, and a read-only preflight before creating fixtures. It creates one marked foreign product through the second owner's ordinary Supabase JWT, creates marked return parents through ordinary owner JWTs, and directly inserts/updates/deletes return items through PostgREST. It requires the expected SQLSTATE and error for cross-organization writes, parent reassignment, and underflow. It verifies rejected cross-organization product, item-organization, and parent writes; rejected item and parent reassignment; a same-organization fractional subunit return and update; item deletion; underflow rollback; parent-cascade reversal; and foreign stock and ledger immutability. Two deletion races hold the parent delete in one PostgreSQL session while ordinary-user line insert/update requests execute through PostgREST in separate sessions. It checks serialized rejection or disappearance and the final stock/ledger state. Cleanup is scoped to the generated return numbers/IDs and foreign SKU. The service-role key is not read or sent. PostgreSQL is used for race coordination, state assertions, and exact test-fixture cleanup, not as evidence of authenticated authorization.

`node scripts/test-purchase-return-app-workflow.cjs` exercises the real authenticated purchase-return API and UI on the isolated app. It creates a marker-named supplier through the ordinary owner JWT, submits a fractional subunit return through `/api/purchases/returns`, opens the return in the browser, deletes it through the UI, verifies stock and ledger reversal, then removes only its marked records. This runner requires the isolated app URL in `POS_RELEASE_APP_URL`, Chrome, the same test target settings, and the owner access/refresh session. It does not use a service-role key.

## Applied migration records

The two source migration checksums are recorded here for the disposable target `rtfowunsyrdygyvubnvs`:

| Migration | SHA-256 |
| --- | --- |
| `20261005_purchase_return_tenant_isolation.sql` | `1CF3222CB0CDE45A41E80E5DEE79AD90149C5C081E39612B504C6C412648EA02` |
| `20261006_purchase_return_parent_tenant_immutability.sql` | `993EC3F48712EBF57FDF113B3FF30AD241153BAEABC18A47562614DB02788F27` |

Both were applied directly with `psql` to the verified disposable target. The target's `supabase_migrations.schema_migrations` has no matching rows for these migration names/versions, and the standard table does not store a SHA-256 checksum. Thus the exact source checksums are recorded in this reviewed repository evidence, but the target's Supabase migration-history table does not independently record them. No migration was applied to production.

This is a focused authenticated database/API regression, not broad POS browser verification, an integration build, or production verification. Integration build and authenticated application integration coverage remain pending.
