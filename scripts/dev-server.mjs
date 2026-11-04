// 手元確認用の静的ファイルサーバ（依存パッケージなし・開発専用）
// npm run dev → http://localhost:5173/
// 同じ Wi-Fi の iPad からは表示される LAN の URL で開ける（http なので service worker は動かない）
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = Number(process.env.PORT) || 5173;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = normalize(join(ROOT, path));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) throw Object.assign(new Error(), { code: "ENOENT" });
    if (!(await stat(file)).isFile()) throw Object.assign(new Error(), { code: "ENOENT" });
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store" // 編集をすぐ反映させる
    });
    res.end(body);
  } catch (e) {
    res.writeHead(e.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(e.code === "ENOENT" ? "Not Found" : "Server Error");
  }
  console.log(`${res.statusCode} ${req.method} ${req.url}`);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  ローカル: http://localhost:${PORT}/`);
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === "IPv4" && !ni.internal) console.log(`  LAN    : http://${ni.address}:${PORT}/`);
    }
  }
  console.log("\n  Ctrl+C で終了\n");
});
