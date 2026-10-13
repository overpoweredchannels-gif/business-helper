# TLS follow-up and deployment revision review — 2026-10-13

2026-10-14 update: the user has authorized the exact e97be5c allowlist addition, now implemented and tested in the runner. The earlier proposal/status below is retained as history and superseded by [current fixture and guard findings](QA_FIXTURE_FINDINGS_e97be5c.md). Full server provenance and fresh attestation remain missing; no preflight or migration application occurred.

## Verified TLS resolution

Without the database CA, OpenSSL failed at depth 2 with error 19, `self-signed certificate in certificate chain`, naming `Supabase Root 2021 CA`. This established the trust-chain failure; the earlier generic psql error did not identify it.

The official [Supabase dashboard source](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json) specifies the certificate download template. Its production CA is available at [the official download location](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt). Downloaded through verified HTTPS to `%LOCALAPPDATA%/TradeOS/pos-release-test/prod-ca-2021.crt`; no global trust store or remote configuration changed.

- CA file SHA-256: `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`.
- Certificate DER SHA-256 fingerprint: `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`.
- CA validity: 2021-04-28 through 2031-04-26.
- Credential-free PostgreSQL STARTTLS probe with `-verify_return_error`, the explicit CA and exact hostname verification: PASS. TLS 1.3; verified peer `*.pooler.supabase.com` for `aws-0-ap-southeast-2.pooler.supabase.com`.
- psql with `sslmode=verify-full`, that CA and project-qualified disposable username: PASS. Explicit READ ONLY transaction reported `on`, executor postgres and disposable marker true, then ROLLBACK. No release SQL was executed.

Runner change: use the local CA file after exact SHA-256 validation instead of `sslrootcert=system`. TLS chain and hostname validation remain enabled. A changed/missing CA fails closed and requires review. Download is not automatic during runner execution. Deployment attestation validation still occurs before connecting.

## Application baseline versus deployment commit

Application baseline is still `da88c3d56df58cf29e7d32debfcc1045d0ea01b4`; database package commit is `e97be5c240810cdb543553b9d06119104f5c3bf4`. Git comparison confirms e97be5c is its direct child. Its changes comprise release docs/evidence, database-release tooling/tests, byte-preservation attributes and the review-only SQL migration. Application source outside that exact migration file, dependency manifests/lockfiles and build/runtime configuration are unchanged. This source comparison does not prove what is deployed or which environment values were used.

Current guard still accepts only an independently attested da88c3d deployment. The runner test explicitly rejects e97be5c pending an approved requirement update. No attestation was created.

**Proposed requirement update for review, not activated:** if Muse independently identifies e97be5c as the actual deployment, add that exact full SHA to a reviewed deployment allowlist while retaining da88c3d as the separate application baseline. Require explicit attested client and server Supabase targets to both equal `rtfowunsyrdygyvubnvs`, the actual deployment ID and fresh verification provenance. Add positive tests for the exact reviewed deployment SHA and negative tests for arbitrary descendants, either target mismatch and absent evidence. Do not automatically accept every descendant. For any other reported SHA, inspect its full diff first; any application/config/dependency change needs separate review. SQL context continues to identify the reviewed application baseline, while the attestation records the actual deployment commit separately.

Migration, rollback, preflight SQL, PRE/POST snapshots and their manifest hashes remain unchanged by this follow-up. Fresh guarded preflight remains **BLOCKED: corrected deployment attestation not supplied**. Connectivity PASS is not preflight PASS. No metadata drift conclusion can be drawn without running the guarded comparison. Waiting for Muse's corrected evidence; no migration or rollback is authorized.

Validation: runner unit tests and artifact integrity verification passed; the downloaded official CA passes the positive hash check and arbitrary CA bytes fail. Node syntax checks and diff checks passed. Focused ESLint produced no result after several minutes and was stopped; no new lint PASS is claimed. These follow-up runner/test/documentation changes remain local for review.
