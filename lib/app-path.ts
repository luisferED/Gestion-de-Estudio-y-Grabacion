export const APP_BASE_PATH = "";
export const APP_COOKIE_PATH = APP_BASE_PATH || "/";

export function appPath(path = "/") {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!APP_BASE_PATH) return normalized;
  if (normalized === APP_BASE_PATH || normalized.startsWith(`${APP_BASE_PATH}/`)) return normalized;
  return normalized === "/" ? APP_BASE_PATH : `${APP_BASE_PATH}${normalized}`;
}

export function appFetch(input: RequestInfo | URL, init?: RequestInit) {
  return globalThis.fetch(typeof input === "string" && input.startsWith("/") ? appPath(input) : input, init);
}
