const relativeBase = "https://local.invalid";
const oauthReturnPathKey = "aankh.oauthReturnPath";

export function safeSignInReturnPath(value: string | null): string | null {
  if (!value?.startsWith("/") || value.startsWith("//") || /[\\\s\p{Cc}]/u.test(value)) return null;
  try {
    const target = new URL(value, relativeBase);
    if (target.origin !== relativeBase || /^\/(?:\/|%2f|%5c)/i.test(target.pathname)) return null;
    return target.pathname + target.search + target.hash;
  } catch {
    return null;
  }
}

export function rememberOAuthReturnPath(path: string | null): void {
  try {
    if (path) window.sessionStorage.setItem(oauthReturnPathKey, path);
    else window.sessionStorage.removeItem(oauthReturnPathKey);
  } catch {
    // Sign-in can still use its default destination when storage is unavailable.
  }
}

export function consumeOAuthReturnPath(): string | null {
  try {
    const path = window.sessionStorage.getItem(oauthReturnPathKey);
    window.sessionStorage.removeItem(oauthReturnPathKey);
    return safeSignInReturnPath(path);
  } catch {
    return null;
  }
}
