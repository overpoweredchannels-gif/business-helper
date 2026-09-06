type Session = { user: { id: string } };
type SessionResult = { data: { session: Session | null }; error: unknown };
type Auth = {
  getSession: () => Promise<SessionResult>;
  refreshSession: () => Promise<SessionResult>;
};

export const SESSION_EXPIRED_MESSAGE =
  "Your session could not be renewed. Your entered details are still here. Sign in again before retrying Save.";

/** Retry only a request rejected for an expired JWT, never an ambiguous write failure. */
export async function withSessionRetry<T extends { error: { code?: string; message: string } | null }>(
  auth: Auth,
  operation: () => PromiseLike<T>,
): Promise<T> {
  const initial = await auth.getSession();
  const userId = initial.data.session?.user.id;
  if (initial.error || !userId) throw new Error(SESSION_EXPIRED_MESSAGE);
  const result = await operation();
  if (result.error?.code !== "PGRST303" || !/jwt expired/i.test(result.error.message)) return result;

  let refreshed: SessionResult;
  try {
    refreshed = await auth.refreshSession();
  } catch {
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }
  if (refreshed.error || refreshed.data.session?.user.id !== userId) {
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }
  const retry = await operation();
  if (retry.error?.code === "PGRST303" && /jwt expired/i.test(retry.error.message)) {
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }
  return retry;
}
