import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = (__ENV.BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const token = __ENV.AUTH_TOKEN || "";

export const options = {
  vus: Number(__ENV.VUS || 5),
  duration: __ENV.DURATION || "30s",
  thresholds: {
    http_req_duration: ["p(95)<300"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const health = http.get(baseUrl + "/api/health", { tags: { route: "health" } });
  check(health, {
    "health responds successfully": (res) => res.status === 200,
    "health body identifies service": (res) => res.json("service") === "collab-docs-api",
  });

  if (token) {
    const documents = http.get(baseUrl + "/api/documents", {
      headers: { Authorization: "Bearer " + token },
      tags: { route: "documents" },
    });
    check(documents, {
      "documents endpoint is not server-error": (res) => res.status < 500,
    });
  }
  sleep(1);
}
