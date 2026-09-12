import { randomBytes } from 'node:crypto';

// ASSUMPTION: the task states that sign-in and access-token verification already
// exist and provide `issueAccessToken(userId): string`. That pre-existing module
// is not part of this deliverable, so this file is a minimal stand-in with the
// same contract; a deployment must use the existing signed implementation, whose
// key comes from an environment variable, never from this file.
export function issueAccessToken(userId: string): string {
  return `at_${userId}_${randomBytes(32).toString('base64url')}`;
}
