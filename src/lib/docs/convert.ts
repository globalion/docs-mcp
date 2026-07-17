// Document → per-page PNG pipeline.
//
// Word/Excel/PowerPoint → PDF via `libreoffice --headless --convert-to pdf`
// (LibreOffice is installed in the Dockerfile). Then PDF → per-page PNG via
// `pdftoppm -png` (poppler-utils, also in the Dockerfile).
//
// Everything shells out. No node deps for parsing = smaller bundle,
// no maintenance headaches when npm packages abandon LibreOffice compat.

import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const DPI = 150; // 150 DPI = ~1240x1750 for A4 → good for vision, not huge.

function runCmd(cmd: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exit ${code}: ${stderr.slice(0, 400)}`));
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Convert a non-PDF office document to PDF using LibreOffice headless mode.
 * Output PDF ends up next to `sourcePath` (LibreOffice's default behaviour
 * with --outdir). Returns the absolute path to the produced PDF.
 */
export async function officeToPdf(sourcePath: string): Promise<string> {
  const dir = path.dirname(sourcePath);
  const base = path.basename(sourcePath, path.extname(sourcePath));
  const outPath = path.join(dir, `${base}.pdf`);

  // -env:UserInstallation isolates LibreOffice's per-user config directory
  // to a per-doc tempdir. Without this, concurrent conversions race on the
  // shared ~/.config/libreoffice profile lock and one of them silently hangs.
  const profileArg = `-env:UserInstallation=file://${dir}/.lo-profile`;

  await runCmd(
    "libreoffice",
    [profileArg, "--headless", "--convert-to", "pdf", "--outdir", dir, sourcePath],
    dir,
    180_000,
  );
  const st = await stat(outPath).catch(() => null);
  if (!st) throw new Error(`libreoffice produced no PDF at ${outPath}`);
  return outPath;
}

/**
 * Split a PDF into per-page PNGs. Files named `page-1.png`, `page-2.png`, ...
 * Returns their absolute paths in page order.
 */
export async function pdfToPagePngs(pdfPath: string): Promise<string[]> {
  const dir = path.dirname(pdfPath);
  const prefix = path.join(dir, "page");

  // pdftoppm -png -r <DPI> input.pdf page  →  page-1.png, page-2.png, ...
  await runCmd(
    "pdftoppm",
    ["-png", "-r", String(DPI), pdfPath, prefix],
    dir,
    120_000,
  );
  const files = await readdir(dir);
  const pages = files
    .filter((f) => /^page-\d+\.png$/.test(f))
    .map((f) => ({
      name: f,
      num: parseInt(f.match(/^page-(\d+)\.png$/)![1], 10),
    }))
    .sort((a, b) => a.num - b.num)
    .map((f) => path.join(dir, f.name));
  if (pages.length === 0) throw new Error(`pdftoppm produced no pages for ${pdfPath}`);
  return pages;
}

/**
 * Convert any supported document to per-page PNGs. Handles the office-to-PDF
 * step when needed. Returns { pdfPath, pagePaths }.
 */
export async function documentToPagePngs(
  sourcePath: string,
  mimeType: string,
): Promise<{ pdfPath: string; pagePaths: string[] }> {
  const isPdf =
    mimeType === "application/pdf" || sourcePath.toLowerCase().endsWith(".pdf");
  const pdfPath = isPdf ? sourcePath : await officeToPdf(sourcePath);
  const pagePaths = await pdfToPagePngs(pdfPath);
  return { pdfPath, pagePaths };
}

/** Supported input types. Anything else is rejected at /api/upload. */
export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",       // .xlsx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/msword",     // .doc  (LibreOffice handles it)
  "application/vnd.ms-excel", // .xls
  "application/vnd.ms-powerpoint", // .ppt
]);

export function extForMime(mime: string): string {
  switch (mime) {
    case "application/pdf": return ".pdf";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return ".docx";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": return ".xlsx";
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation": return ".pptx";
    case "application/msword": return ".doc";
    case "application/vnd.ms-excel": return ".xls";
    case "application/vnd.ms-powerpoint": return ".ppt";
    default: return ".bin";
  }
}
