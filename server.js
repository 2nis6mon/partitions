// Serveur local : sert la web-app à l'iPad et convertit les PDF en MusicXML via Audiveris.
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");

const PORT = process.env.PORT || 3000;
const SCORES_DIR = path.join(__dirname, "scores");
const WORK_DIR = path.join(__dirname, ".work");
fs.mkdirSync(SCORES_DIR, { recursive: true });
fs.mkdirSync(WORK_DIR, { recursive: true });

function findAudiveris() {
  const candidates = [
    process.env.AUDIVERIS_CMD,
    "/Applications/Audiveris.app/Contents/MacOS/Audiveris",
    path.join(os.homedir(), "Applications/Audiveris.app/Contents/MacOS/Audiveris"),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  try {
    return execSync("command -v audiveris", { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

const safeName = (name) =>
  name.replace(/\.[^.]+$/, "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "partition";

function uniqueBase(base) {
  let name = base, i = 2;
  while (fs.readdirSync(SCORES_DIR).some((f) => f.startsWith(name + "."))) name = `${base}_${i++}`;
  return name;
}

function runAudiveris(cmd, pdfPath, outDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, ["-batch", "-export", "-output", outDir, "--", pdfPath]);
    let log = "";
    proc.stdout.on("data", (d) => (log += d));
    proc.stderr.on("data", (d) => (log += d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      // Audiveris produit <nom>.mxl, ou <nom>.mvt1.mxl… s'il détecte plusieurs mouvements.
      const found = [];
      const walk = (dir) => {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, f.name);
          if (f.isDirectory()) walk(p);
          else if (f.name.endsWith(".mxl")) found.push(p);
        }
      };
      walk(outDir);
      if (found.length) resolve(found.sort());
      else reject(new Error(`Audiveris n'a produit aucune partition (code ${code}).\n${log.slice(-2000)}`));
    });
  });
}

const app = express();
const upload = multer({ dest: WORK_DIR, limits: { fileSize: 100 * 1024 * 1024 } });

app.use(express.static(path.join(__dirname, "public")));
app.use("/scores", express.static(SCORES_DIR));
app.use("/lib", express.static(path.join(__dirname, "node_modules/opensheetmusicdisplay/build")));

app.get("/api/status", (req, res) => res.json({ audiveris: !!findAudiveris() }));

app.get("/api/scores", (req, res) => {
  const files = fs.readdirSync(SCORES_DIR)
    .filter((f) => /\.(mxl|musicxml|xml)$/i.test(f))
    .map((f) => ({ file: f, mtime: fs.statSync(path.join(SCORES_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map((s) => s.file);
  res.json(files);
});

app.delete("/api/scores/:file", (req, res) => {
  const p = path.join(SCORES_DIR, path.basename(req.params.file));
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ ok: true });
});

app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucun fichier reçu." });
  const original = req.file.originalname;
  const ext = path.extname(original).toLowerCase();
  const base = uniqueBase(safeName(original));
  try {
    if ([".mxl", ".musicxml", ".xml"].includes(ext)) {
      fs.renameSync(req.file.path, path.join(SCORES_DIR, base + ext));
      return res.json({ files: [base + ext] });
    }
    if (ext !== ".pdf") throw new Error("Format non supporté (PDF, MXL ou MusicXML attendu).");

    const cmd = findAudiveris();
    if (!cmd) throw new Error("Audiveris n'est pas installé sur le Mac : impossible de convertir un PDF. Voir le README.");

    const jobDir = fs.mkdtempSync(path.join(WORK_DIR, "job-"));
    const pdfPath = path.join(jobDir, base + ".pdf");
    fs.renameSync(req.file.path, pdfPath);
    console.log(`Conversion de « ${original} » avec Audiveris…`);
    const outputs = await runAudiveris(cmd, pdfPath, path.join(jobDir, "out"));
    const files = outputs.map((p, i) => {
      const name = outputs.length > 1 ? `${base}_partie${i + 1}.mxl` : `${base}.mxl`;
      fs.copyFileSync(p, path.join(SCORES_DIR, name));
      return name;
    });
    fs.rmSync(jobDir, { recursive: true, force: true });
    console.log(`  → ${files.join(", ")}`);
    res.json({ files });
  } catch (e) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🎹 Partitions prêt.`);
  console.log(`   Sur ce Mac : http://localhost:${PORT}`);
  for (const addrs of Object.values(os.networkInterfaces()))
    for (const a of addrs || [])
      if (a.family === "IPv4" && !a.internal) console.log(`   Sur l'iPad : http://${a.address}:${PORT}`);
  console.log(`   Audiveris : ${findAudiveris() || "non trouvé (import PDF indisponible, MusicXML OK)"}\n`);
});
server.requestTimeout = 0; // les conversions OMR peuvent prendre plusieurs minutes
