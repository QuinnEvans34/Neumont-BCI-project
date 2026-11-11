// Render the checked-in Mermaid sources to offline SVG/HTML and a PDF atlas.
// Requires a local Mermaid browser bundle, Chromium, Python and pypdf.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const maps = path.join(root, "docs/workspace/maps");
const temp = path.join(root, "tmp/pdfs");
const { values } = parseArgs({ options: {
  mermaid: { type: "string" }, browser: { type: "string" },
  python: { type: "string", default: "python" }, pdfjs: { type: "string" },
  "no-sandbox": { type: "boolean", default: false },
} });
const mermaidPath = path.resolve(values.mermaid ?? path.join(root, "node_modules/mermaid/dist/mermaid.min.js"));
if (!existsSync(mermaidPath)) throw Error("Provide --mermaid <path/to/mermaid.min.js>.");
const browserPath = values.browser ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
].find(existsSync);
if (!browserPath) throw Error("Provide --browser <Chromium executable>.");
await mkdir(path.join(temp, "pages"), { recursive: true });
await mkdir(path.join(temp, "qa"), { recursive: true });
await mkdir(path.join(maps, "rendered"), { recursive: true });

const sourcePaths = ["README.md", "system/runtime.md", "data/signal-pipeline.md",
  "data/recording-and-review.md", "code/frontend.md", "code/backend.md",
  "flows/player-journey.md", "flows/experiments.md",
  "build/development-and-release.md", "build/tooling-and-assets.md"];
const escape = value => String(value).replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
const plain = value => value.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
  .replace(/[`*]/g, "").replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim();
const slug = value => plain(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const diagrams = [];
const sources = [];
for (const source of sourcePaths) {
  const markdown = await readFile(path.join(maps, source), "utf8");
  const title = /^# (.+)$/m.exec(markdown)[1];
  sources.push({ source, title, sha256: createHash("sha256").update(markdown).digest("hex") });
  for (const match of markdown.matchAll(/```mermaid\r?\n([\s\S]*?)\r?\n```/g)) {
    const headings = [...markdown.slice(0, match.index).matchAll(/^## (.+)$/gm)];
    const heading = headings.at(-1)?.[1] ?? "System overview";
    const following = markdown.slice(match.index + match[0].length).replace(/^\s*<\/details>/, "").trimStart().split(/\r?\n\s*\r?\n/)[0];
    const caption = following.startsWith("|") || following.startsWith("#") ? "" : plain(following);
    const relativeSvg = source === "README.md" ? "rendered/overview.svg"
      : `rendered/${source.replace(/\.md$/, "")}-${slug(heading)}.svg`;
    diagrams.push({ source, title, heading, caption, code: match[1], relativeSvg });
  }
}

const mermaidBundle = await readFile(mermaidPath);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/mermaid.js") {
      res.setHeader("Content-Type", "text/javascript"); res.end(mermaidBundle); return;
    }
    if (url.pathname === "/render") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end('<!doctype html><html><head><meta charset="utf-8"><script src="/mermaid.js"></script></head><body></body></html>'); return;
    }
    const base = url.pathname.startsWith("/pdfjs/") && values.pdfjs ? path.resolve(values.pdfjs) : root;
    const relative = url.pathname.startsWith("/pdfjs/") && values.pdfjs ? url.pathname.slice(7) : url.pathname.slice(1);
    const file = path.resolve(base, decodeURIComponent(relative));
    if (!file.startsWith(base + path.sep)) { res.writeHead(403); res.end(); return; }
    const mime = { ".mjs": "text/javascript", ".js": "text/javascript", ".pdf": "application/pdf", ".html": "text/html", ".svg": "image/svg+xml" };
    res.setHeader("Content-Type", mime[path.extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = spawn(browserPath, ["--headless", ...(values["no-sandbox"] ? ["--no-sandbox"] : []), "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=0", `--user-data-dir=${path.join(temp, "browser-profile")}`, "about:blank"],
{ windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let ws;
try {
  const debugUrl = await new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(Error("Chromium debugging endpoint did not start.")), 20000);
    browser.on("error", error => { clearTimeout(timer); reject(error); });
    browser.stderr.on("data", data => {
      stderr += data;
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr);
      if (match) { clearTimeout(timer); resolve(new URL(match[1])); }
    });
    browser.on("exit", code => { clearTimeout(timer); reject(Error(`Chromium exited ${code}: ${stderr.slice(-1000)}`)); });
  });
  const targets = await fetch(`http://127.0.0.1:${debugUrl.port}/json/list`).then(r => r.json());
  console.log("Chromium is ready; connecting to the renderer.");
  const target = targets.find(t => t.type === "page");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Renderer WebSocket did not open.")), 10000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener("error", error => { clearTimeout(timer); reject(error); }, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id); pending.delete(message.id); clearTimeout(timer);
      message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result);
    }
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id;
    const timer = setTimeout(() => { pending.delete(next); reject(Error(`Timed out: ${method}`)); }, 30000);
    pending.set(next, { resolve, reject, timer }); ws.send(JSON.stringify({ id: next, method, params }));
  });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await cdp("Page.enable");
  await cdp("Page.navigate", { url: `${origin}/render` });
  console.log("Loading the offline Mermaid renderer.");
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate("typeof mermaid !== 'undefined'")) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await evaluate(`mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'base',fontFamily:'Arial, sans-serif',
    themeVariables:{fontSize:'20px',primaryColor:'#edf7f5',primaryTextColor:'#173744',primaryBorderColor:'#3b8b83',
      lineColor:'#526b79',secondaryColor:'#f0f4fa',tertiaryColor:'#fff4df',background:'#ffffff'},
    flowchart:{htmlLabels:false,useMaxWidth:false,nodeSpacing:28,rankSpacing:44,curve:'basis'},
    sequence:{useMaxWidth:false,wrap:true,width:180,actorFontSize:18,messageFontSize:18,noteFontSize:18},
    state:{useMaxWidth:false}})`);
  console.log("Rendering diagrams.");

  for (const [index, diagram] of diagrams.entries()) {
    // Add line breaks only to visual labels; the checked-in Mermaid stays unchanged.
    const code = diagram.code.startsWith("flowchart") ? diagram.code.replace(/"([^"\n]+)"/g, (_, label) => {
      const lines = [""];
      for (const word of label.split(" ")) {
        if (lines.at(-1).length + word.length > 37 && lines.at(-1)) lines.push("");
        lines[lines.length - 1] += (lines.at(-1) ? " " : "") + word;
      }
      return '"' + lines.join("<br/>") + '"';
    }) : diagram.code;
    const rendered = await evaluate(`(async () => {
      const rendered = await mermaid.render('map-${index}', ${JSON.stringify(code)});
      document.body.innerHTML = rendered.svg;
      const svg = document.querySelector('svg');
      const box = svg.viewBox.baseVal;
      svg.setAttribute('width', box.width); svg.setAttribute('height', box.height);
      svg.style.maxWidth = 'none'; svg.style.background = 'white';
      return {svg:new XMLSerializer().serializeToString(svg),width:box.width,height:box.height};
    })()`);
    Object.assign(diagram, rendered, { page: index + 2 });
    const out = path.join(maps, diagram.relativeSvg);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, rendered.svg);
    console.log(`Rendered ${index + 1}/${diagrams.length}: ${diagram.title} / ${diagram.heading}`);
  }

  const css = `*{box-sizing:border-box}body{margin:0;color:#173744;font-family:Arial,sans-serif;background:white}
    .sheet{position:relative;padding:48px 56px;overflow:hidden;background:white}
    .eyebrow{font-size:15px;letter-spacing:2px;text-transform:uppercase;color:#3b8b83;font-weight:700;margin-bottom:10px}
    h1{font-size:32px;line-height:1.13;margin:0 0 8px}h2{font-size:23px;margin:0 0 10px}
    .sub{font-size:17px;color:#526b79;margin:0 0 14px}.chart{display:flex;align-items:center;justify-content:center}
    .chart svg{width:100%;height:100%;overflow:visible}.caption{font-size:15px;line-height:1.45;color:#526b79;padding:12px 16px;background:#f2f7f7;margin-top:10px;border-left:3px solid #3b8b83}
    .footer{position:absolute;bottom:22px;left:56px;right:56px;font-size:12px;color:#526b79;display:flex;justify-content:space-between;gap:20px}
    .rule{height:3px;background:#3b8b83;margin:20px 0}.contents{display:grid;grid-template-columns:1fr 1fr;gap:18px 30px;margin-top:30px}
    .card{border:1px solid #d5e3e3;padding:18px 22px;min-height:105px}.card p{font-size:16px;color:#526b79;line-height:1.5;margin:8px 0 0}.num{float:right;color:#3b8b83;font-size:21px}`;
  const coverCards = sources.map(source => {
    const matches = diagrams.filter(d => d.source === source.source);
    return `<div class="card"><span class="num">${matches[0].page}</span><h2>${escape(source.title)}</h2><p>${matches.length} diagram${matches.length === 1 ? "" : "s"}: ${escape(matches.map(d => d.heading).join(" / "))}</p></div>`;
  }).join("");
  const cover = `<section class="sheet" style="width:1632px;height:1056px"><div class="eyebrow">Club BCI / implementation atlas</div><h1 style="font-size:49px">Visual maps</h1><p class="sub">System structure, data, functions, user journeys and build pipelines</p><div class="rule"></div><p style="font-size:18px;line-height:1.5;max-width:1250px">${diagrams.length} rendered diagrams, traced from the working tree on November 11, 2026. Each diagram has its own vector page. Use the PDF bookmarks or page numbers below to jump to a topic. Zoom in for detail.</p><div class="contents">${coverCards}</div><div class="footer"><span>Source: docs/workspace/maps / Mermaid originals remain editable</span><span>1 / ${diagrams.length + 1}</span></div></section>`;
  const printPage = async (html, width, height, index) => {
    await evaluate(`document.head.innerHTML = '<meta charset="utf-8"><style>' + ${JSON.stringify(css + `@page{size:${width}px ${height}px;margin:0}`)} + '</style>'; document.body.innerHTML = ${JSON.stringify(html)};`);
    await evaluate("document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))");
    await cdp("Emulation.setDeviceMetricsOverride", { width: Math.ceil(width), height: Math.ceil(height), deviceScaleFactor: 1, mobile: false });
    const pdf = await cdp("Page.printToPDF", { printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, scale: 1 });
    await writeFile(path.join(temp, "pages", `${String(index).padStart(2, "0")}.pdf`), Buffer.from(pdf.data, "base64"));
  };
  await printPage(cover, 1632, 1056, 0);
  const sheets = [];
  for (const [index, d] of diagrams.entries()) {
    const portrait = d.width / d.height < 0.85;
    const width = Math.ceil(Math.max(portrait ? 1056 : 1632, d.width * 0.74 + 112));
    const height = Math.ceil(Math.max(portrait ? 1632 : 1056, d.height * 0.74 + 345));
    const caption = d.caption.length > 550 ? d.caption.slice(0, 547).replace(/\s+\S*$/, "") + "..." : d.caption;
    const sheet = `<section class="sheet" id="diagram-${index + 1}" style="width:${width}px;height:${height}px"><div class="eyebrow">${escape(d.title)} / ${String(index + 1).padStart(2, "0")}</div><h1>${escape(d.heading)}</h1><div class="chart" style="height:${height - 345}px">${d.svg}</div><div class="caption">${escape(caption || "Follow the labeled arrows and source references in the companion Markdown guide.")}</div><div class="footer"><span>Source: docs/workspace/maps/${escape(d.source)}</span><span>${index + 2} / ${diagrams.length + 1}</span></div></section>`;
    await printPage(sheet, width, height, index + 1);
    sheets.push({ ...d, sheet, pageWidth: width, pageHeight: height });
  }
  const toc = sources.map(source => `<a href="#diagram-${diagrams.findIndex(d => d.source === source.source) + 1}">${escape(source.title)}</a>`).join("");
  const browserHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Club BCI visual maps</title><style>${css}
    body{background:#edf2f4}.layout{display:grid;grid-template-columns:260px minmax(0,1fr)}nav{position:sticky;top:0;height:100vh;padding:30px 22px;background:#173744;color:white;overflow:auto}nav h1{font-size:25px}nav a{display:block;color:#d7eeee;text-decoration:none;padding:10px 0;font-size:15px;line-height:1.4}main{padding:30px;min-width:0}article{background:white;padding:30px;margin-bottom:28px;border-radius:10px;box-shadow:0 2px 12px #17374412}article svg{display:block;width:100%;height:auto;max-height:none}article .links{font-size:14px;margin:15px 0;color:#526b79}a{color:#276f68}@media(max-width:850px){.layout{display:block}nav{position:relative;height:auto}main{padding:12px}article{padding:18px}}@media print{nav{display:none}.layout{display:block}main{padding:0}article{break-before:page;box-shadow:none}}
    </style></head><body><div class="layout"><nav><h1>Visual maps</h1><p>26 diagrams / offline viewer</p><a href="visual-maps.pdf">Open PDF atlas</a>${toc}</nav><main><article><div class="eyebrow">Club BCI / implementation atlas</div><h1>How the system works</h1><p>Rendered from the editable Mermaid sources. Open an individual SVG for a full-size view, or use the PDF atlas for bookmarks and sharing.</p></article>${diagrams.map((d,i) => `<article id="diagram-${i+1}"><div class="eyebrow">${escape(d.title)} / ${i+1}</div><h1>${escape(d.heading)}</h1><div class="links"><a href="${d.relativeSvg}">Open SVG</a> &nbsp; / &nbsp; <a href="${d.source}">Editable source</a> &nbsp; / &nbsp; PDF page ${d.page}</div>${d.svg}<div class="caption">${escape(d.caption)}</div></article>`).join("")}</main></div></body></html>`;
  await writeFile(path.join(maps, "visual-maps.html"), browserHtml);
  const manifest = { sources, diagrams: diagrams.map(({ code, svg, ...d }) => d) };
  await writeFile(path.join(temp, "atlas-manifest.json"), JSON.stringify(manifest, null, 2));
  const merge = spawnSync(values.python, [path.join(root, "tools/docs/merge-map-pdfs.py"), temp, maps], { cwd: root, encoding: "utf8" });
  if (merge.status !== 0) throw Error(merge.stderr || merge.stdout || "PDF merge failed.");
  console.log(merge.stdout.trim());

  if (values.pdfjs) {
    // Render the final PDF, not the HTML, for visual QA.
    await cdp("Page.navigate", { url: `${origin}/render` });
    await new Promise(resolve => setTimeout(resolve, 300));
    const pageCount = await evaluate(`(async () => {
      const pdfjs = await import(${JSON.stringify(origin + "/pdfjs/build/pdf.mjs")});
      pdfjs.GlobalWorkerOptions.workerSrc = ${JSON.stringify(origin + "/pdfjs/build/pdf.worker.mjs")};
      window.atlasPdf = await pdfjs.getDocument({url:${JSON.stringify(origin + "/docs/workspace/maps/visual-maps.pdf")}}).promise;
      return window.atlasPdf.numPages;
    })()`);
    for (let n = 1; n <= pageCount; n++) {
      const data = await evaluate(`(async () => {
        const page = await window.atlasPdf.getPage(${n});
        const native = page.getViewport({scale:1});
        const viewport = page.getViewport({scale:Math.min(1600/native.width,1800/native.height)});
        const canvas = document.createElement('canvas'); canvas.width=Math.ceil(viewport.width); canvas.height=Math.ceil(viewport.height);
        await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
        return canvas.toDataURL('image/png').split(',')[1];
      })()`);
      await writeFile(path.join(temp, "qa", `page-${String(n).padStart(2, "0")}.png`), Buffer.from(data, "base64"));
    }
    console.log(`Rendered all ${pageCount} final PDF pages to tmp/pdfs/qa for inspection.`);
  }
} finally {
  ws?.close(); browser.kill(); server.close();
}
