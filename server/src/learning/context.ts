import { AsyncLocalStorage } from 'node:async_hooks';

export const LEGACY_LEARNER = 'default';

export interface LearnerContext {
  learnerId: string;
  userId: string;
  role: 'admin' | 'user';
}

const storage = new AsyncLocalStorage<LearnerContext>();

export function runWithLearner<T>(context: LearnerContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentLearner(): LearnerContext {
  return (
    storage.getStore() ?? {
      learnerId: LEGACY_LEARNER,
      userId: LEGACY_LEARNER,
      role: 'admin',
    }
  );
}

export function currentLearnerId(): string {
  return currentLearner().learnerId;
}

export function currentUserId(): string {
  return currentLearner().userId;
}

export function currentRole(): 'admin' | 'user' {
  return currentLearner().role;
}
