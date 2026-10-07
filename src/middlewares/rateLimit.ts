import { RequestHandler } from "express";
export function rateLimit(max = 20, windowMs = 60_000): RequestHandler {
  const entries = new Map<string, { count: number; end: number }>();
  return (req, res, next) => {
    const now = Date.now(),
      key = req.ip ?? "unknown";
    // Limpeza limitada ao ciclo de requisições; sem timer que mantenha o processo vivo.
    for (const [id, entry] of entries) if (entry.end <= now) entries.delete(id);
    const entry = entries.get(key) ?? { count: 0, end: now + windowMs };
    entry.count++;
    entries.set(key, entry);
    if (entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.end - now) / 1000));
      res.status(429).json({
        success: false,
        content: "Muitas tentativas. Aguarde um minuto.",
      });
      return;
    }
    next();
  };
}
