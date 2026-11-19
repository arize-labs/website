/**
 * The site is served under a base path (on GitHub Pages, /website), so
 * root-relative links must carry it. Write paths as if the site were at the
 * root and pass them through `withBase`.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** `/blog` → `/website/blog`. Leaves absolute URLs and fragments alone. */
export const withBase = (path: string) => (path.startsWith("/") && !path.startsWith("//") ? `${BASE}${path}` : path);

/** `/website/blog` → `/blog`: a pathname as if the site were at the root. */
export const stripBase = (pathname: string) =>
  pathname === BASE ? "/" : pathname.startsWith(`${BASE}/`) ? pathname.slice(BASE.length) : pathname;
