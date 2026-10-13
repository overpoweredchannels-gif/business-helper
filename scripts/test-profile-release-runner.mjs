import assert from 'node:assert/strict';
import { validateDeploymentEvidence, validateMode, verifyManifest, projectRef, commit } from './run-profile-db-release.mjs';

const now = Date.parse('2026-10-13T10:00:00Z');
const valid = {
  projectRef, configuredSupabaseUrl: `https://${projectRef}.supabase.co`,
  projectName: 'tradeos-qa', gitCommit: commit, deploymentId: 'dpl_synthetic_local_test',
  environmentVerified: true, verifiedBy: 'local-test-only', verifiedAt: new Date(now).toISOString(),
  source: 'independent-read-only-QA-deployment-and-environment-inspection',
};
validateDeploymentEvidence(valid, now);
for (const override of [
  { projectRef: 'different-project' }, { projectName: 'production' },
  { configuredSupabaseUrl: 'https://different-project.supabase.co' }, { gitCommit: 'wrong' },
  { verifiedAt: 'invalid' }, { verifiedAt: new Date(now - 3600001).toISOString() },
  { verifiedAt: new Date(now + 1).toISOString() }, { environmentVerified: false },
  { source: 'guess' }, { deploymentId: '' }, { verifiedBy: '' },
]) assert.throws(() => validateDeploymentEvidence({ ...valid, ...override }, now));
validateMode('preflight');
for (const mode of ['apply', 'rollback']) {
  assert.throws(() => validateMode(mode));
  assert.throws(() => validateMode(mode, `${mode.toUpperCase()}_other`));
  validateMode(mode, `${mode.toUpperCase()}_${projectRef}`);
}
assert.throws(() => validateMode('deploy'));
verifyManifest(process.cwd());
console.log('PASS runner evidence validation, freshness, exact target/commit, separate write approval guards, and artifact hashes. No psql or network invoked.');
