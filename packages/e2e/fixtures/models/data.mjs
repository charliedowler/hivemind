export const synthetic = {
  observation: 'The synthetic build cache ignores the lockfile until its key includes the lockfile hash.',
  title: 'Include the lockfile hash in the synthetic build cache key',
  measured: 'The build was blocked. Regenerating the client fixed the build. We measured 12 minutes lost.',
  estimated: 'The build runtime was about 12 minutes. The delay was unmeasured.',
  credentials: 'E2E_SENSITIVE_CREDENTIAL: the invented service password is fixture-password-example-only.',
  personal: 'E2E_SENSITIVE_PERSONAL: alex@example.com has a private medical appointment.',
  customer: 'E2E_SENSITIVE_CUSTOMER: Example Customer at customer.example.com sent a private account record.',
  chat: 'E2E_NON_WORK: my fictional weekend picnic used a blue blanket.',
  useful: 'The synthetic cache rebuild passed after applying the lockfile fix.',
  contradicted: 'The synthetic cache rebuild still fails with the same stale artifact after applying the fix.',
  stale: 'The synthetic cache option was removed in fixture version 2; the command rejects the old option.',
  inconclusive: 'I retrieved the synthetic cache cell but have not run the check.',
};
