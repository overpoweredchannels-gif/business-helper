import assert from 'node:assert/strict';
import { validateDeploymentEvidence, validateMode, verifyManifest, verifyDatabaseCa, projectRef, commit, reviewedDeploymentCommit, reviewedDeploymentId, reviewedDeploymentUrl } from './run-profile-db-release.mjs';

const now = Date.parse('2026-10-13T10:00:00Z');
const valid = {
  projectRef, configuredSupabaseUrl: `https://${projectRef}.supabase.co`,
  projectName: 'tradeos-qa', gitCommit: commit, deploymentId: 'dpl_synthetic_local_test',
  environmentVerified: true, verifiedBy: 'local-test-only', verifiedAt: new Date(now).toISOString(),
  source: 'independent-read-only-QA-deployment-and-environment-inspection',
  applicationBaselineCommit: commit,
  clientSupabaseUrl: `https://${projectRef}.supabase.co`, serverSupabaseUrl: `https://${projectRef}.supabase.co`,
  serverCredentialProjectRef: projectRef,
  clientConfigurationEvidence: 'synthetic test only: deployment client configuration observation',
  serverCredentialEvidence: 'synthetic test only: deployment credential provenance',
};
validateDeploymentEvidence(valid, now);
const reviewed = { ...valid, gitCommit: reviewedDeploymentCommit, deploymentId: reviewedDeploymentId, deploymentUrl: reviewedDeploymentUrl };
validateDeploymentEvidence(reviewed, now);
for (const override of [
  { gitCommit: '1111111111111111111111111111111111111111' },
  { deploymentId: 'dpl_wrong' }, { deploymentUrl: 'https://wrong.vercel.app' },
  { applicationBaselineCommit: reviewedDeploymentCommit }, { clientSupabaseUrl: undefined },
  { clientSupabaseUrl: 'https://wrong.supabase.co' }, { serverSupabaseUrl: 'https://wrong.supabase.co' },
  { serverCredentialProjectRef: 'wrong' }, { serverCredentialEvidence: '' }, { clientConfigurationEvidence: '' },
]) assert.throws(() => validateDeploymentEvidence({ ...reviewed, ...override }, now));
assert.throws(() => validateDeploymentEvidence({ projectName: 'tradeos-qa', gitCommit: reviewedDeploymentCommit, deploymentId: reviewedDeploymentId, deploymentUrl: reviewedDeploymentUrl }, now));
for (const override of [
  { projectRef: 'different-project' }, { projectName: 'production' },
  { configuredSupabaseUrl: 'https://different-project.supabase.co' }, { gitCommit: 'wrong' },
  { verifiedAt: 'invalid' }, { verifiedAt: new Date(now - 3600001).toISOString() },
  { verifiedAt: new Date(now + 1).toISOString() }, { environmentVerified: false },
  { source: 'guess' }, { deploymentId: '' }, { verifiedBy: '' },
  { gitCommit: 'e97be5c240810cdb543553b9d06119104f5c3bf4' },
]) assert.throws(() => validateDeploymentEvidence({ ...valid, ...override }, now));
validateMode('preflight');
for (const mode of ['apply', 'rollback']) {
  assert.throws(() => validateMode(mode));
  assert.throws(() => validateMode(mode, `${mode.toUpperCase()}_other`));
  validateMode(mode, `${mode.toUpperCase()}_${projectRef}`);
}
assert.throws(() => validateMode('deploy'));
verifyManifest(process.cwd());
assert.throws(() => verifyDatabaseCa(Buffer.from('untrusted CA')), /CA hash mismatch/);
console.log('PASS runner evidence validation, freshness, exact target/commit, separate write approval guards, and artifact hashes. No psql or network invoked.');
