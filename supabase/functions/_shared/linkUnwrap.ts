// Email and chat apps wrap links in their own redirect so they can scan them: Outlook Safe Links,
// Google, Proofpoint URL Defense, Facebook/Messenger. Coaches copy links out of director emails,
// so import links are unwrapped first (D-042). The real address is decoded from the wrapper
// itself — wrappers are never fetched, so this can't be used to reach other sites.

/** Returns the link inside a known wrapper (repeatedly, for nested wrappers), else the input trimmed. */
export function unwrapLink(input: string): string {
  let link = input.trim().replace(/^<|>$/g, "");
  for (let i = 0; i < 4; i++) {
    const inner = unwrapOnce(link);
    if (!inner || inner === link) break;
    link = inner.trim();
  }
  return link;
}

function unwrapOnce(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const param = (name: string) => url.searchParams.get(name);
  // Outlook / Microsoft 365 Safe Links: na01.safelinks.protection.outlook.com/?url=…
  if (host.endsWith(".safelinks.protection.outlook.com") || host === "safelinks.protection.outlook.com") return param("url");
  // Google redirects: www.google.com/url?q=… (Gmail, Google Docs, search results)
  if (/^(www\.)?google\.[a-z.]+$/.test(host) && url.pathname === "/url") return param("q") ?? param("url");
  // Facebook / Messenger / Instagram link shims
  if (/^(l|lm)\.(facebook|instagram)\.com$/.test(host) || host === "l.messenger.com") return param("u");
  // Proofpoint URL Defense v2: urldefense.proofpoint.com/v2/url?u=https-3A__example.com_path&…
  if (host === "urldefense.proofpoint.com" && url.pathname.startsWith("/v2/url")) {
    const u = param("u");
    return u ? decodeURIComponent(u.replace(/_/g, "/").replace(/-([0-9A-F]{2})/g, "%$1")) : null;
  }
  // Proofpoint URL Defense v3: urldefense.com/v3/__https://example.com/path__;!!…
  if (host === "urldefense.com" && url.pathname.startsWith("/v3/__")) {
    const m = link.match(/\/v3\/__(.+?)__;/);
    return m ? m[1] : null;
  }
  return null;
}
