// Guarded procedure. No remote write is authorized merely by adding this runner.
// Defaults to read-only preflight; apply/rollback require separate human approval.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const projectRef = 'rtfowunsyrdygyvubnvs';
export const commit = 'da88c3d56df58cf29e7d32debfcc1045d0ea01b4';
// Application source approved independently of deployment attestation, 2026-10-15.
export const reviewedDeploymentCommit = 'd1bd245d6986061c073681f834e97743bb238b88';
// Bound to reviewed Muse report EVIDENCE_FOR_CODEX_d1bd245.md (2026-10-15).
export const reviewedDeploymentId = 'dpl_3omNBFWdAhkQR9PqBQyXyVD9YC47';
export const reviewedDeploymentUrl = 'https://tradeos-nu3scr876-overpoweredchannels-7830s-projects.vercel.app';
export const databaseCaSha256 = '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7';
export function verifyDatabaseCa(bytes) {
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== databaseCaSha256) {
    throw new Error('Official Supabase database CA hash mismatch; stop for review');
  }
}
export function validateDeploymentEvidence(e, now = Date.now()) {
  if (e.projectRef !== projectRef || e.configuredSupabaseUrl !== `https://${projectRef}.supabase.co`
    || e.projectName !== 'tradeos-qa' || e.gitCommit !== reviewedDeploymentCommit
    || e.applicationBaselineCommit !== commit || e.environmentVerified !== true
    || e.clientSupabaseUrl !== `https://${projectRef}.supabase.co`
    || e.serverSupabaseUrl !== `https://${projectRef}.supabase.co`
    || e.serverCredentialProjectRef !== projectRef
    || typeof e.clientConfigurationEvidence !== 'string' || !e.clientConfigurationEvidence.trim()
    || typeof e.serverCredentialEvidence !== 'string' || !e.serverCredentialEvidence.trim()
    || (reviewedDeploymentId !== null && (e.deploymentId !== reviewedDeploymentId || e.deploymentUrl !== reviewedDeploymentUrl))
    || typeof e.deploymentId !== 'string' || !e.deploymentId.startsWith('dpl_')
    || typeof e.verifiedBy !== 'string' || !e.verifiedBy.trim()
    || e.source !== 'independent-read-only-QA-deployment-and-environment-inspection') {
    throw new Error('Disposable QA deployment evidence mismatch/incomplete');
  }
  const age = now - Date.parse(e.verifiedAt);
  if (!Number.isFinite(age) || age < 0 || age > 60 * 60 * 1000) throw new Error('QA evidence must be verified within one hour');
  if (!reviewedDeploymentId || !reviewedDeploymentUrl) {
    throw new Error('Approved d1bd245 application candidate awaits verified exact QA deployment binding; preflight blocked');
  }
  // This is a trusted operator attestation, not a claim to re-read Vercel settings.
  // Never fill these fields from guesses or from the desired configuration.
}
export function verifyManifest(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/evidence/PROFILE_RELEASE_MANIFEST_da88c3d.json'), 'utf8'));
  for (const [file, expected] of Object.entries(manifest)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
    if (actual !== expected) throw new Error(`Reviewed artifact mismatch: ${file}`);
  }
}
export function validateMode(mode, approval) {
  if (!['preflight', 'apply', 'rollback'].includes(mode)) throw new Error('Invalid mode');
  if (mode !== 'preflight' && approval !== `${mode.toUpperCase()}_${projectRef}`) throw new Error('Separate explicit approval token required');
}
function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => { const i = arg.indexOf('='); return [arg.slice(0, i), arg.slice(i + 1)]; }));
  const mode = args['--mode'] ?? 'preflight';
  validateMode(mode, args['--approval']);
  if (!args['--evidence']) throw new Error('Independently verified QA deployment evidence file required');
  const e = JSON.parse(fs.readFileSync(args['--evidence'], 'utf8'));
  validateDeploymentEvidence(e);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  verifyManifest(root);
  const file = mode === 'apply' ? 'src/lib/migrations/20261011_staff_profile_role_access.sql'
    : mode === 'rollback' ? 'docs/evidence/PROFILE_AUTHORIZATION_ROLLBACK_da88c3d.sql'
      : 'docs/evidence/PROFILE_RELEASE_PREFLIGHT_da88c3d.sql';
  const passfile = path.join(process.env.LOCALAPPDATA, 'TradeOS/pos-release-test/target.pgpass');
  if (!fs.existsSync(passfile)) throw new Error('Private disposable-project pgpass unavailable');
  // Fixed endpoint and project-qualified username; no arbitrary DSN/host/project argument.
  const caFile = path.join(process.env.LOCALAPPDATA, 'TradeOS/pos-release-test/prod-ca-2021.crt');
  verifyDatabaseCa(fs.readFileSync(caFile));
  const quotedCaFile = caFile.replaceAll('\\', '/').replaceAll("'", "\\'");
  const connection = `host=aws-0-ap-southeast-2.pooler.supabase.com port=5432 dbname=postgres user=postgres.${projectRef} sslmode=verify-full sslrootcert='${quotedCaFile}' connect_timeout=10`;
  const context = `select set_config('tradeos.release_project_ref','${projectRef}',false), set_config('tradeos.release_deployment','tradeos-qa',false), set_config('tradeos.release_commit','${commit}',false);\n`;
  const sql = context + fs.readFileSync(path.join(root, file), 'utf8');
  // Remove inherited libpq options; target credentials come only from the pinned passfile.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('PG')));
  env.PGPASSFILE = passfile;
  const result = spawnSync('C:/Program Files/PostgreSQL/18/bin/psql.exe', ['-X', '-w', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d', connection], { input: sql, encoding: 'utf8', env, maxBuffer: 4 * 1024 * 1024, timeout: 120000, windowsHide: true });
  if (result.error) throw new Error(`psql process failed: ${result.error.code ?? 'unknown'}`);
  if (result.status !== 0) {
    // Only bounded SQL diagnostics; never print connection env, passfile or API tokens.
    const diagnostic = (result.stderr ?? '').replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[REDACTED]').slice(0, 1800);
    throw new Error(`psql exited ${result.status}: ${diagnostic}`);
  }
  console.log(`${mode} completed for verified disposable QA target; metadata guards passed. Deployment evidence: ${e.deploymentId}.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
