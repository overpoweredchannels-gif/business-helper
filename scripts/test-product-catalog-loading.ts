import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductCatalogState } from "../src/components/products/ProductCatalogState";
import {
  DashboardReadTracker,
  runDashboardSourceRead,
  type DashboardSourceStates,
} from "../src/lib/dashboard/data-read-state";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeTracker() {
  const published: DashboardSourceStates[] = [];
  const tracker = new DashboardReadTracker((states) => {
    published.push(states);
  });
  return { tracker, published };
}

async function main() {
  // 1. Delayed responses arriving out of order: a slow read for org A must not
  //    overwrite the catalog after the account switched to org B.
  {
    const { tracker } = makeTracker();
    let committed: string[] = [];
    tracker.activate("acct-1", "org-A");
    const slowRead = tracker.read("products", "acct-1", "org-A", async () => {
      await tick(50);
      return ["stale-product-A"];
    }, (rows) => {
      committed = rows;
    });
    // Account switches to org B before A's response arrives.
    tracker.invalidate();
    tracker.activate("acct-1", "org-B");
    const fastRead = tracker.read("products", "acct-1", "org-B", async () => ["product-B"], (rows) => {
      committed = rows;
    });
    const fastResult = await fastRead;
    assert.equal(fastResult.status, "success");
    assert.deepEqual(committed, ["product-B"]);
    const slowResult = await slowRead;
    assert.equal(slowResult.status, "ignored");
    assert.deepEqual(committed, ["product-B"], "late org-A response must not overwrite org-B catalog");
    console.log("✓ out-of-order delayed responses: stale account response ignored");
  }

  // 2. Switching accounts while loading: the in-flight read is dropped.
  {
    const { tracker, published } = makeTracker();
    let commits = 0;
    tracker.activate("acct-1", "org-A");
    const read = tracker.read("products", "acct-1", "org-A", async () => {
      await tick(30);
      return ["late-product"];
    }, () => {
      commits += 1;
    });
    tracker.invalidate();
    tracker.activate("acct-2", "org-C");
    const result = await read;
    assert.equal(result.status, "ignored");
    assert.equal(commits, 0);
    assert.equal(published[published.length - 1].products.status, "not-loaded");
    console.log("✓ account switch while loading: in-flight read dropped, states reset");
  }

  // 3. Logout during loading: neither success nor failure may touch state.
  {
    const { tracker } = makeTracker();
    let commits = 0;
    tracker.activate("acct-1", "org-A");
    const succeeding = tracker.read("products", "acct-1", "org-A", async () => {
      await tick(20);
      return ["p"];
    }, () => {
      commits += 1;
    });
    const failing = tracker.read("products", "acct-1", "org-A", async () => {
      await tick(20);
      throw new Error("network down");
    }, () => {
      commits += 1;
    });
    tracker.invalidate(); // logout
    const [r1, r2] = await Promise.all([succeeding, failing]);
    assert.equal(r1.status, "ignored");
    assert.equal(r2.status, "ignored");
    assert.equal(commits, 0);
    console.log("✓ logout during loading: late success and failure both ignored");
  }

  // 4. Failure then retry: failure keeps prior rows, retry targets the current org.
  {
    const { tracker, published } = makeTracker();
    let committed: string[] = ["cached"];
    let errors = 0;
    tracker.activate("acct-1", "org-A");
    const failed = await runDashboardSourceRead(
      tracker,
      "products",
      "acct-1",
      "org-A",
      async (): Promise<string[]> => {
        throw new Error("timeout");
      },
      (rows) => {
        committed = rows;
      },
      () => {
        errors += 1;
      },
    );
    assert.equal(failed.status, "failed");
    assert.equal(errors, 1);
    assert.deepEqual(committed, ["cached"], "failed read must not clear previously committed rows");
    assert.equal(published[published.length - 1].products.status, "failed");
    // Retry with the same (still current) organization succeeds.
    const retried = await runDashboardSourceRead(
      tracker,
      "products",
      "acct-1",
      "org-A",
      async () => ["fresh"],
      (rows) => {
        committed = rows;
      },
      () => {
        errors += 1;
      },
    );
    assert.equal(retried.status, "success");
    assert.deepEqual(committed, ["fresh"]);
    // Retry issued for a superseded organization is ignored, not loaded.
    let loaderRan = false;
    tracker.invalidate();
    tracker.activate("acct-1", "org-B");
    const staleRetry = await runDashboardSourceRead(
      tracker,
      "products",
      "acct-1",
      "org-A",
      async () => {
        loaderRan = true;
        return ["wrong-org"];
      },
      (rows) => {
        committed = rows;
      },
      () => {
        errors += 1;
      },
    );
    assert.equal(staleRetry.status, "ignored");
    assert.equal(loaderRan, false, "loader must not run for a superseded organization");
    assert.deepEqual(committed, ["fresh"]);
    console.log("✓ failure/retry: failed keeps rows, retry loads current org only");
  }

  // 5. A genuinely empty catalog commits as successful-empty (distinct from failed).
  {
    const { tracker, published } = makeTracker();
    let committed: string[] | null = null;
    tracker.activate("acct-1", "org-A");
    const result = await tracker.read("products", "acct-1", "org-A", async () => [], (rows) => {
      committed = rows;
    });
    assert.equal(result.status, "success");
    assert.deepEqual(committed, []);
    assert.equal(published[published.length - 1].products.status, "successful-empty");
    console.log("✓ empty catalog: committed as successful-empty, distinct from failed");
  }

  // 6. begin() with a mismatched scope never invokes the loader.
  {
    const { tracker } = makeTracker();
    tracker.activate("acct-1", "org-A");
    let loaderRan = false;
    const result = await tracker.read("products", "acct-1", "org-B", async () => {
      loaderRan = true;
      return ["x"];
    }, () => undefined);
    assert.equal(result.status, "ignored");
    assert.equal(loaderRan, false);
    console.log("✓ scope mismatch: read ignored without invoking loader");
  }

  // --- ProductCatalogState presentation ---

  const renderStatus = (status: "loading" | "not-loaded" | "failed" | "successful-empty" | "successful-populated", searchQuery = "") =>
    renderToStaticMarkup(
      React.createElement(ProductCatalogState, { status, searchQuery, onRetry: () => undefined }),
    );

  {
    const loading = renderStatus("loading");
    assert.match(loading, /Loading products\.\.\./);
    assert.match(loading, /role="status"/);
    const notLoaded = renderStatus("not-loaded");
    assert.match(notLoaded, /Loading products\.\.\./);
    console.log("✓ catalog state: loading/not-loaded share the loading UI");
  }

  {
    const failed = renderStatus("failed");
    assert.match(failed, /Couldn(?:'|&#x27;)t load the product catalog/);
    assert.match(failed, /role="alert"/);
    assert.match(failed, />Retry</);
    assert.doesNotMatch(failed, /Loading products/);
    assert.doesNotMatch(failed, /No products added yet/);
    console.log("✓ catalog state: failed shows error + retry, distinct from loading/empty");
  }

  {
    const empty = renderStatus("successful-empty");
    assert.match(empty, /No products added yet/);
    assert.doesNotMatch(empty, /Couldn(?:'|&#x27;)t load/);
    const noMatch = renderStatus("successful-populated", "  zzz  ");
    assert.match(noMatch, /No products match/);
    assert.match(noMatch, /zzz/);
    const populatedNoSearch = renderStatus("successful-populated");
    assert.match(populatedNoSearch, /No products added yet/);
    console.log("✓ catalog state: empty vs no-match are distinct messages");
  }

  console.log("\nAll product catalog loading checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
