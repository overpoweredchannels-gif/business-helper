/**
 * Read a fetch Response body as JSON, defensively.
 *
 * An endpoint that answers with an empty body (e.g. an uncaught server
 * error surfacing as a bare 500) must not throw "Unexpected end of JSON
 * input" from res.json() and hide the real problem. This returns null when
 * there is nothing parseable, so callers can show their own error instead.
 *
 * Use it instead of res.json() wherever a response may be empty or a
 * non-JSON error page.
 */
export async function readJsonBody(res: Response): Promise<Record<string, any> | null> {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    return null;
  }
}
