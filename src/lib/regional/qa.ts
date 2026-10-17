/** Temporary rollout gate: never enables regional writes in production. */
export function regionalQaEnabled(url = process.env.NEXT_PUBLIC_SUPABASE_URL): boolean {
  return url === 'https://rtfowunsyrdygyvubnvs.supabase.co';
}
