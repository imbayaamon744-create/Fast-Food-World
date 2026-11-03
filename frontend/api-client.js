export class ApiError extends Error {
  constructor(message, status = 0, code = "NETWORK_ERROR", fields = []) {
    super(message); this.status = status; this.code = code; this.fields = fields;
  }
}
let csrfToken;
let csrfRequest;
function localSetupMessage() {
  return ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
    ? "Ordering requires the Node server. In the project terminal run npm run dev, then open http://localhost:3000/. VS Code Live Server cannot load the menu or save orders."
    : "The restaurant service is unavailable. Please try again later.";
}
async function fetchJson(path, options = {}) {
  if (location.protocol === "file:") throw new ApiError("Open http://localhost:3000/ after starting npm run dev; ordering cannot run from an HTML file.", 0, "BACKEND_REQUIRED");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, { ...options, credentials: "same-origin", cache: "no-store", signal: controller.signal });
    if (response.status === 204 && response.ok) return {};
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html") || (response.status === 404 && !contentType.includes("application/json"))) {
      throw new ApiError(localSetupMessage(), response.status, "BACKEND_REQUIRED");
    }
    let data;
    try { data = await response.json(); }
    catch { throw new ApiError("The server returned an unreadable response. Please try again.", response.status, "INVALID_RESPONSE"); }
    if (!response.ok) {
      const retry = response.status === 429 ? " Try again after " + (response.headers.get("Retry-After") || "a few") + " seconds." : "";
      throw new ApiError((data.error?.message || "The request could not be completed.") + retry, response.status, data.error?.code, data.error?.fields);
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
      ? localSetupMessage() : "We could not reach the restaurant. Check your connection and try again.");
  } finally { clearTimeout(timeout); }
}
async function csrf() {
  if (csrfToken) return csrfToken;
  csrfRequest ??= fetchJson("api/csrf").then(data => {
    if (typeof data.csrfToken !== "string") throw new ApiError("Unable to start a secure session.");
    csrfToken = data.csrfToken; return csrfToken;
  }).finally(() => { csrfRequest = undefined; });
  return csrfRequest;
}
export const get = path => fetchJson(path);
export async function send(path, body, method = "POST", key, refreshed = false) {
  const headers = { "Content-Type": "application/json", "X-CSRF-Token": await csrf() };
  if (key) headers["Idempotency-Key"] = key;
  try {
    const data = await fetchJson(path, { method, headers, body: JSON.stringify(body) });
    if (typeof data.csrfToken === "string") csrfToken = data.csrfToken;
    if (path === "api/admin/logout") csrfToken = undefined;
    return data;
  }
  catch (error) {
    // The server rejects CSRF before business logic, so one refresh is safe.
    if (error.code === "CSRF_REJECTED" && !refreshed) {
      csrfToken = undefined;
      return send(path, body, method, key, true);
    }
    throw error;
  }
}

export const post = (path, body, key) => send(path, body, "POST", key);
export const patch = (path, body) => send(path, body, "PATCH");
