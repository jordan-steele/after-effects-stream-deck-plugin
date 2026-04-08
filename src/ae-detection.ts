import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import { readdir } from "node:fs/promises";
import path from "node:path";
import streamDeck from "@elgato/streamdeck";
import type { AEVersionInfo } from "./settings.js";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const logger = streamDeck.logger.createScope("AEDetection");

const isMac = process.platform === "darwin";

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the year (e.g. 2024) from an AE path or name like
 * "Adobe After Effects 2024" or "Adobe After Effects CC 2019".
 */
function parseAEYear(nameOrPath: string): number | null {
  const match = nameOrPath.match(/After Effects.*?(\d{4})/i);
  return match ? parseInt(match[1], 10) : null;
}

function isAEBeta(nameOrPath: string): boolean {
  return /After Effects(?:\s+\(Beta\)|.*\bBeta\b)/i.test(nameOrPath);
}

function isAEInstallName(name: string): boolean {
  return /^Adobe After Effects(?:.*\d{4}|\s+\(Beta\))$/i.test(name);
}

function aeSortKey(nameOrPath: string): number | null {
  if (isAEBeta(nameOrPath)) {
    return 9999;
  }

  return parseAEYear(nameOrPath);
}

/**
 * Builds a display name from a path.
 * e.g. "/Applications/Adobe After Effects 2024/..." → "After Effects 2024"
 */
function displayName(exePath: string): string {
  if (isAEBeta(exePath)) {
    return "After Effects (Beta)";
  }

  const match = exePath.match(/(After Effects.*?\d{4})/i);
  return match ? match[1] : path.basename(exePath);
}

/**
 * Normalizes a full macOS executable path to its .app bundle path.
 * e.g. "/Applications/Adobe After Effects 2025/Adobe After Effects 2025.app/Contents/MacOS/After Effects"
 *   → "/Applications/Adobe After Effects 2025/Adobe After Effects 2025.app"
 */
function normalizeToAppBundle(execPath: string): string {
  const appIdx = execPath.indexOf(".app");
  if (appIdx !== -1) {
    return execPath.substring(0, appIdx + 4);
  }
  return execPath;
}

function normalizeComparablePath(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

// ---------------------------------------------------------------------------
// Installed AE versions
// ---------------------------------------------------------------------------

async function getInstalledMac(): Promise<AEVersionInfo[]> {
  const results: AEVersionInfo[] = [];
  try {
    const entries = await readdir("/Applications", { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && isAEInstallName(entry.name)) {
        const appBaseName = isAEBeta(entry.name)
          ? "Adobe After Effects (Beta)"
          : `Adobe After Effects ${parseAEYear(entry.name) ?? ""}`;
        const appPath = `/Applications/${entry.name}/${appBaseName}.app`;
        // The afterfx CLI is the app itself on macOS — we invoke via `open`
        // but we store the .app path for pinned mode.
        results.push({
          name: entry.name.replace(/^Adobe /, ""),
          path: appPath,
        });
      }
    }
  } catch {
    // /Applications not readable – unlikely but handle gracefully
  }
  return results.sort(
    (a, b) => (aeSortKey(b.name) ?? 0) - (aeSortKey(a.name) ?? 0)
  );
}

async function getInstalledWindows(): Promise<AEVersionInfo[]> {
  const results: AEVersionInfo[] = [];
  const roots = [
    "C:\\Program Files\\Adobe",
    "C:\\Program Files (x86)\\Adobe",
  ];
  for (const root of roots) {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && isAEInstallName(entry.name)) {
          const exePath = path.join(
            root,
            entry.name,
            "Support Files",
            "AfterFX.exe"
          );
          results.push({
            name: entry.name.replace(/^Adobe /, ""),
            path: exePath,
          });
        }
      }
    } catch {
      // directory doesn't exist
    }
  }
  return results.sort(
    (a, b) => (aeSortKey(b.name) ?? 0) - (aeSortKey(a.name) ?? 0)
  );
}

export async function getInstalledAEVersions(): Promise<AEVersionInfo[]> {
  return isMac ? getInstalledMac() : getInstalledWindows();
}

// ---------------------------------------------------------------------------
// Running AE detection
// ---------------------------------------------------------------------------

interface RunningAEInstance {
  pid: number;
  path: string;
  sortKey: number;
}

async function getRunningAEMac(): Promise<RunningAEInstance[]> {
  try {
    const { stdout } = await execAsync(
      `ps aux | grep -i "[A]fter Effects" | grep -v grep`
    );
    const instances: RunningAEInstance[] = [];
    for (const line of stdout.trim().split("\n")) {
      if (!line) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[1], 10);
      // Reconstruct the path from the remaining columns (index 10+)
      const cmdPath = parts.slice(10).join(" ");
      const sortKey = aeSortKey(cmdPath);
      if (sortKey !== null) {
        // Normalize to .app bundle path (ps gives the full executable path)
        const appPath = normalizeToAppBundle(cmdPath);
        instances.push({ pid, path: appPath, sortKey });
      }
    }
    return instances;
  } catch {
    return [];
  }
}

async function getRunningAEWindows(): Promise<RunningAEInstance[]> {
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "Get-Process -Name AfterFX -ErrorAction SilentlyContinue | Select-Object Id, Path | ConvertTo-Json"`
    );
    if (!stdout.trim()) return [];
    const data = JSON.parse(stdout.trim());
    const processes = Array.isArray(data) ? data : [data];
    const instances: RunningAEInstance[] = [];
    for (const proc of processes) {
      const sortKey = aeSortKey(proc.Path);
      if (sortKey !== null) {
        instances.push({ pid: proc.Id, path: proc.Path, sortKey });
      }
    }
    return instances;
  } catch {
    return [];
  }
}

async function getRunningAEInstances(): Promise<RunningAEInstance[]> {
  return isMac ? getRunningAEMac() : getRunningAEWindows();
}

// ---------------------------------------------------------------------------
// Foreground AE detection
// ---------------------------------------------------------------------------

async function getForegroundAEMac(): Promise<RunningAEInstance | null> {
  try {
    // Get the frontmost app's bundle path via AppleScript
    const { stdout } = await execAsync(
      `osascript -e 'tell application "System Events" to get the unix id of the first process whose frontmost is true'`
    );
    const frontPid = parseInt(stdout.trim(), 10);
    const running = await getRunningAEMac();
    // Check if the frontmost process IS an AE process
    const match = running.find((inst) => inst.pid === frontPid);
    if (match) return match;

    // Fallback: check if any AE is frontmost by name
    const { stdout: appName } = await execAsync(
      `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`
    );
    if (appName.trim().toLowerCase().includes("after effects")) {
      const normalizedAppName = appName.trim().toLowerCase();
      const byName = running.find(
        (inst) => displayName(inst.path).toLowerCase() === normalizedAppName
      );
      return byName ?? running[0] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

async function getForegroundAEWindows(): Promise<RunningAEInstance | null> {
  try {
    // GetForegroundWindow won't work here — by the time the Stream Deck
    // button fires, the foreground window is Stream Deck itself.
    // Instead, enumerate all visible windows in Z-order (topmost first)
    // and return the first one that belongs to an AfterFX process.
    const running = await getRunningAEWindows();
    logger.info(`Running AE instances: ${JSON.stringify(running.map(r => ({ pid: r.pid, path: r.path, sortKey: r.sortKey })))}`);
    if (running.length === 0) {
      logger.info("No running AE instances found");
      return null;
    }
    if (running.length === 1) {
      logger.info(`Only one AE instance running (pid=${running[0].pid}), returning it`);
      return running[0];
    }

    const aePids = running.map((r) => r.pid);
    logger.info(`Multiple AE instances, checking Z-order for pids: ${aePids.join(", ")}`);
    // Use -EncodedCommand to avoid here-string terminator issues when
    // PowerShell is invoked via Node's exec().
    const psScript = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class WinZOrder {
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public static List<uint> GetVisiblePidsByZOrder() {
    var pids = new List<uint>();
    EnumWindows((hWnd, lParam) => {
      if (IsWindowVisible(hWnd)) {
        uint pid; GetWindowThreadProcessId(hWnd, out pid);
        if (!pids.Contains(pid)) pids.Add(pid);
      }
      return true;
    }, IntPtr.Zero);
    return pids;
  }
}
'@
$targets = @(${aePids.join(",")})
foreach ($p in [WinZOrder]::GetVisiblePidsByZOrder()) {
  if ($targets -contains $p) { Write-Output $p; break }
}
`;
    const encoded = Buffer.from(psScript, "utf16le").toString("base64");
    const { stdout, stderr } = await execAsync(
      `powershell -NoProfile -EncodedCommand ${encoded}`
    );
    logger.info(`Z-order PowerShell stdout: '${stdout.trim()}', stderr: '${stderr.trim()}'`);
    const topPid = parseInt(stdout.trim(), 10);
    if (!isNaN(topPid)) {
      const match = running.find((inst) => inst.pid === topPid);
      if (match) {
        logger.info(`Foreground AE resolved to pid=${match.pid} path=${match.path}`);
        return match;
      }
      logger.warn(`Z-order returned pid=${topPid} but no matching AE instance found`);
    } else {
      logger.warn(`Z-order returned no valid pid from stdout: '${stdout.trim()}'`);
    }
    return null;
  } catch (err) {
    logger.error("getForegroundAEWindows failed", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public resolution API
// ---------------------------------------------------------------------------

/**
 * Given user settings, resolve which `afterfx` binary to use.
 * Returns the executable path or null if none found.
 */
export async function resolveAEPath(
  mode: "newest" | "foreground" | "pinned",
  pinnedPath: string | null
): Promise<{ path: string; name: string; pid?: number } | null> {
  if (mode === "pinned" && pinnedPath) {
    const running = await getRunningAEInstances();
    const normalizedPinnedPath = normalizeComparablePath(
      normalizeToAppBundle(pinnedPath)
    );
    const match = running.find(
      (inst) => normalizeComparablePath(normalizeToAppBundle(inst.path)) === normalizedPinnedPath
    );
    if (!match) return null;
    return { path: pinnedPath, name: displayName(pinnedPath), pid: match.pid };
  }

  if (mode === "foreground") {
    logger.info("Resolving foreground AE...");
    const fg = isMac
      ? await getForegroundAEMac()
      : await getForegroundAEWindows();
    if (fg) {
      logger.info(`Foreground resolved: ${displayName(fg.path)} pid=${fg.pid}`);
      return { path: fg.path, name: displayName(fg.path), pid: fg.pid };
    }
    logger.info("No foreground AE found, falling back to newest");
  }

  // "newest" mode, or foreground fallback
  const running = await getRunningAEInstances();
  if (running.length === 0) return null;
  const newest = running.sort((a, b) => b.sortKey - a.sortKey)[0];
  logger.info(`Newest AE: ${displayName(newest.path)} pid=${newest.pid}`);
  return { path: newest.path, name: displayName(newest.path), pid: newest.pid };
}

/**
 * Detect the currently-active AE for display in the PI status line.
 */
export async function detectCurrentAE(
  mode: "newest" | "foreground" | "pinned" = "foreground",
  pinnedPath: string | null = null
): Promise<string | null> {
  const resolved = await resolveAEPath(mode, pinnedPath);
  return resolved?.name ?? null;
}
