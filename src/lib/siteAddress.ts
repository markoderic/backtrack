/** The site address students type: the site url without the protocol or a trailing slash. */
export function siteAddress(url: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): string {
  if (!url) throw new Error("NEXT_PUBLIC_SITE_URL is not set.");
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}
