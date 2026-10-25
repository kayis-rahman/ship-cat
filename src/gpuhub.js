const DEFAULT_API_BASE = "https://api.gpuhub.com";

function normalizeBase(base) {
  return (base || DEFAULT_API_BASE).replace(/\/+$/, "");
}

async function request({ base, token, method, path, body }) {
  if (!token) throw new Error("GPUhub token is required");
  const response = await fetch(`${normalizeBase(base)}${path}`, {
    method,
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok)
    throw new Error(
      `GPUhub request failed: ${response.status} ${response.statusText}`,
    );
  if (
    parsed &&
    typeof parsed === "object" &&
    parsed.code &&
    parsed.code !== "Success"
  ) {
    throw new Error(
      `GPUhub error: ${parsed.code}${parsed.msg ? ` ${parsed.msg}` : ""}`,
    );
  }
  return parsed;
}

export function createGpuhubClient({ token, base = DEFAULT_API_BASE } = {}) {
  const call = (method, path, body) =>
    request({ base, token, method, path, body });
  return {
    token,
    base: normalizeBase(base),
    request: call,
    listPrivateImages: (body = {}) =>
      call("POST", "/api/v1/dev/image/private/list", body),
    createDeployment: (body) => call("POST", "/api/v1/dev/deployment", body),
    listDeployments: (body = {}) =>
      call("POST", "/api/v1/dev/deployment/list", body),
    scaleReplicas: (body) =>
      call("PUT", "/api/v1/dev/deployment/replica_num", body),
    stopDeployment: (deployment_uuid) =>
      call("PUT", "/api/v1/dev/deployment/operate", {
        deployment_uuid,
        operation: "stop",
      }),
    deleteDeployment: (deployment_uuid) =>
      call("PUT", "/api/v1/dev/deployment/operate", {
        deployment_uuid,
        operation: "delete",
      }),
  };
}

export const GPUHUB_API_BASE = DEFAULT_API_BASE;
export { normalizeBase };
