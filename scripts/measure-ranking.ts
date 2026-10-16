import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
async function main() {
  const destination = process.argv
    .find((a) => a.startsWith("--output="))
    ?.slice(9);
  if (!destination) throw Error("Informe --output=backups/arquivo.json");
  const root = path.resolve("backups"),
    output = path.resolve(destination);
  if (!output.startsWith(root + path.sep))
    throw Error("Grave medições somente em backups/");
  const base = process.env.PUBLIC_APP_URL || "https://ztcg.vercel.app";
  const results: any[] = [],
    images = new Set<string>();
  for (const mode of ["wins", "rate", "decks"]) {
    const url = `${base}/rankings?mode=${mode}&page=0&measurement=${Date.now()}`;
    for (let sample = 0; sample < 2; sample++) {
      const start = performance.now(),
        res = await fetch(url, { signal: AbortSignal.timeout(30000) }),
        ttfbMs = Math.round(performance.now() - start);
      const text = await res.text();
      if (!res.ok) throw Error(`HTTP ${res.status}`);
      const data = JSON.parse(text),
        rows = [...data.podium, ...(data.players || data.decks)];
      const stable = rows.map((row: any) => {
        const { avatarURL, ...rest } = row;
        if (avatarURL?.startsWith("/avatars/")) images.add(avatarURL);
        return rest;
      });
      results.push({
        mode,
        sample,
        status: res.status,
        ttfbMs,
        bytes: Buffer.byteLength(text),
        base64Avatars: rows.filter((r: any) => r.avatarURL?.startsWith("data:"))
          .length,
        total: data.total,
        digest: createHash("sha256")
          .update(JSON.stringify(canonical(stable)))
          .digest("hex"),
        cache: res.headers.get("x-vercel-cache"),
        serverTiming: res.headers.get("server-timing"),
      });
    }
  }
  const imageResults: any[] = [];
  if (process.argv.includes("--images"))
    for (const url of images) {
      for (let sample = 0; sample < 2; sample++) {
        const res = await fetch(new URL(url, base), {
            signal: AbortSignal.timeout(30000),
          }),
          bytes = Buffer.from(await res.arrayBuffer());
        if (
          !res.ok ||
          createHash("sha256").update(bytes).digest("hex") !==
            url.split("/").pop()!.split(".")[0]
        )
          throw Error("Avatar não corresponde ao hash");
        imageResults.push({
          sample,
          bytes: bytes.length,
          cache: res.headers.get("x-vercel-cache"),
          type: res.headers.get("content-type"),
        });
      }
    }
  const report = { at: new Date(), results, images: imageResults };
  await mkdir(root, { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
if (require.main === module)
  void main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
