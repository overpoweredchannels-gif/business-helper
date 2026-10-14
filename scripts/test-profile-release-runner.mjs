import assert from 'node:assert/strict';
import { validateDeploymentEvidence, validateMode, verifyManifest, verifyDatabaseCa, projectRef, commit, reviewedDeploymentCommit, reviewedDeploymentId, reviewedDeploymentUrl } from './run-profile-db-release.mjs';

const now = Date.parse('2026-10-13T10:00:00Z');
const valid = {
  projectRef, configuredSupabaseUrl: `https://${projectRef}.supabase.co`,
  projectName: 'tradeos-qa', gitCommit: reviewedDeploymentCommit, deploymentId: reviewedDeploymentId,
  deploymentUrl: reviewedDeploymentUrl,
  environmentVerified: true, verifiedBy: 'local-test-only', verifiedAt: new Date(now).toISOString(),
  source: 'independent-read-only-QA-deployment-and-environment-inspection',
  applicationBaselineCommit: commit,
  clientSupabaseUrl: `https://${projectRef}.supabase.co`, serverSupabaseUrl: `https://${projectRef}.supabase.co`,
  serverCredentialProjectRef: projectRef,
  clientConfigurationEvidence: 'synthetic test only: deployment client configuration observation',
  serverCredentialEvidence: 'synthetic test only: deployment credential provenance',
};
assert.equal(reviewedDeploymentCommit, 'd1bd245d6986061c073681f834e97743bb238b88');
assert.equal(reviewedDeploymentId, 'dpl_3omNBFWdAhkQR9PqBQyXyVD9YC47');
assert.equal(reviewedDeploymentUrl, 'https://tradeos-nu3scr876-overpoweredchannels-7830s-projects.vercel.app');
validateDeploymentEvidence(valid, now);
const reviewed = valid;
for (const override of [
  { gitCommit: '1111111111111111111111111111111111111111' },
  { gitCommit: commit },
  { deploymentId: 'dpl_wrong' }, { deploymentUrl: 'https://wrong.vercel.app' },
  { gitCommit: 'c8af1bb256a6d66929a90b1d3aa8c83230f7ab27' },
  { applicationBaselineCommit: reviewedDeploymentCommit }, { clientSupabaseUrl: undefined },
  { clientSupabaseUrl: 'https://wrong.supabase.co' }, { serverSupabaseUrl: 'https://wrong.supabase.co' },
  { serverCredentialProjectRef: 'wrong' }, { serverCredentialEvidence: '' }, { clientConfigurationEvidence: '' },
]) assert.throws(() => validateDeploymentEvidence({ ...reviewed, ...override }, now), /mismatch\/incomplete/);
assert.throws(() => validateDeploymentEvidence({ projectName: 'tradeos-qa', gitCommit: reviewedDeploymentCommit, deploymentId: reviewedDeploymentId, deploymentUrl: reviewedDeploymentUrl }, now));
for (const override of [
  { projectRef: 'different-project' }, { projectName: 'production' },
  { configuredSupabaseUrl: 'https://different-project.supabase.co' }, { gitCommit: 'wrong' },
  { verifiedAt: 'invalid' }, { verifiedAt: new Date(now - 3600001).toISOString() },
  { verifiedAt: new Date(now + 1).toISOString() }, { environmentVerified: false },
  { source: 'guess' }, { deploymentId: '' }, { verifiedBy: '' },
  { gitCommit: 'e97be5c240810cdb543553b9d06119104f5c3bf4' },
]) assert.throws(() => validateDeploymentEvidence({ ...valid, ...override }, now), /mismatch\/incomplete|within one hour/);
validateMode('preflight');
for (const mode of ['apply', 'rollback']) {
  assert.throws(() => validateMode(mode));
  assert.throws(() => validateMode(mode, `${mode.toUpperCase()}_other`));
  validateMode(mode, `${mode.toUpperCase()}_${projectRef}`);
}
assert.throws(() => validateMode('deploy'));
verifyManifest(process.cwd());
assert.throws(() => verifyDatabaseCa(Buffer.from('untrusted CA')), /CA hash mismatch/);
console.log('PASS frozen d1bd245 candidate and exact deployment binding, evidence validation, freshness, separate write approval guards, and artifact hashes. No psql or network invoked.');
