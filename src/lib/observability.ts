import { randomUUID } from "node:crypto";
import { RequestHandler } from "express";
export function log(
  event: string,
  fields: Record<string, unknown> = {},
  level = "info",
) {
  (level === "error" ? console.error : console.log)(
    JSON.stringify({ time: new Date().toISOString(), level, event, ...fields }),
  );
}
export const requestLog: RequestHandler = (req, res, next) => {
  const requestId = randomUUID(),
    start = Date.now(),
    requestPath = req.path;
  res.setHeader("X-Request-Id", requestId);
  res.on("finish", () =>
    log(
      "http_request",
      {
        requestId,
        method: req.method,
        path: requestPath,
        status: res.statusCode,
        durationMs: Date.now() - start,
      },
      res.statusCode >= 500 ? "error" : "info",
    ),
  );
  next();
};
