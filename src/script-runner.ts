import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import streamDeck from "@elgato/streamdeck";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const logger = streamDeck.logger.createScope("ScriptRunner");

const isMac = process.platform === "darwin";

/**
 * Check if an AE window is maximized, run AfterFX, then re-maximize if needed.
 * AfterFX.exe -r un-maximizes the AE window — this restores it afterward.
 */
async function runAfterFXPreservingWindow(
  aePath: string,
  args: string[],
  pid: number
): Promise<void> {
  let wasMaximized = false;
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowHandle" `
    );
    const hwnd = stdout.trim();
    if (hwnd && hwnd !== "0") {
      const checkScript = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinState {
  [DllImport("user32.dll")]
  public static extern bool IsZoomed(IntPtr hWnd);
}
'@
Write-Output ([WinState]::IsZoomed([IntPtr]${hwnd}))
`;
      const encoded = Buffer.from(checkScript, "utf16le").toString("base64");
      const { stdout: zoomedOut } = await execAsync(
        `powershell -NoProfile -EncodedCommand ${encoded}`
      );
      wasMaximized = zoomedOut.trim() === "True";
      logger.info(`AE window hwnd=${hwnd} maximized=${wasMaximized}`);
    }
  } catch (err) {
    logger.warn("Could not check window state", err);
  }

  await runAfterFX(aePath, args);

  if (wasMaximized) {
    try {
      // SW_MAXIMIZE = 3
      const restoreScript = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinRestore {
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
'@
$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) {
  [WinRestore]::ShowWindow($p.MainWindowHandle, 3)
}
`;
      const encoded = Buffer.from(restoreScript, "utf16le").toString("base64");
      await execAsync(`powershell -NoProfile -EncodedCommand ${encoded}`);
      logger.info("Restored AE window to maximized state");
    } catch (err) {
      logger.warn("Could not restore maximized state", err);
    }
  }
}

/**
 * Run AfterFX.exe and tolerate exit code 1, which is normal when sending
 * a script to an already-running instance on Windows.
 */
async function runAfterFX(aePath: string, args: string[]): Promise<void> {
  try {
    const { stdout, stderr } = await execFileAsync(aePath, args, {
      windowsHide: true,
    });
    logger.info(`AfterFX success — stdout='${stdout.trim()}' stderr='${stderr.trim()}'`);
  } catch (err: any) {
    if (err.code === 1 && !err.stderr?.trim()) {
      logger.info(`AfterFX exited with code 1 (normal for running instance), treating as success`);
      return;
    }
    logger.error(`AfterFX failed — code=${err.code} signal=${err.signal} killed=${err.killed} stdout='${err.stdout?.trim()}' stderr='${err.stderr?.trim()}'`);
    throw err;
  }
}

/**
 * Run a .jsx script file in After Effects.
 */
export async function runScriptFile(
  aePath: string,
  scriptPath: string,
  pid?: number
): Promise<void> {
  if (isMac) {
    const appName = extractAppName(aePath);
    await runOsascript(appName, "file", scriptPath);
  } else {
    await access(scriptPath);
    const tempPath = path.join(
      tmpdir(),
      `ae-sd-file-${randomUUID().slice(0, 8)}.jsx`
    );
    const escapedScriptPath = scriptPath
      .replace(/\\/g, "/")
      .replace(/"/g, '\\"');
    const wrapperScript = `$.evalFile(new File("${escapedScriptPath}"));`;

    try {
      await writeFile(tempPath, wrapperScript, "utf-8");
      logger.info(`Running script file via temp wrapper: ${aePath} -r ${tempPath} -> ${scriptPath}`);
      if (pid) {
        await runAfterFXPreservingWindow(aePath, ["-r", tempPath], pid);
      } else {
        await runAfterFX(aePath, ["-r", tempPath]);
      }
    } finally {
      try {
        await unlink(tempPath);
      } catch {
        // best-effort cleanup
      }
    }
  }
}

/**
 * Run an inline script string in After Effects.
 * Uses AppleScript DoScript on macOS for reliable execution in a running instance.
 * On Windows, writes to a temp file to avoid command-line quoting issues.
 */
export async function runInlineScript(
  aePath: string,
  script: string,
  pid?: number
): Promise<void> {
  if (isMac) {
    const appName = extractAppName(aePath);
    await runOsascript(appName, "inline", script);
  } else {
    const tempPath = path.join(
      tmpdir(),
      `ae-sd-${randomUUID().slice(0, 8)}.jsx`
    );
    try {
      await writeFile(tempPath, script, "utf-8");
      logger.info(`Running inline script via temp file: ${aePath} -r ${tempPath}`);
      if (pid) {
        await runAfterFXPreservingWindow(aePath, ["-r", tempPath], pid);
      } else {
        await runAfterFX(aePath, ["-r", tempPath]);
      }
    } finally {
      try {
        await unlink(tempPath);
      } catch {
        // best-effort cleanup
      }
    }
  }
}

/**
 * Extract the application name from a .app bundle path.
 * e.g. "/Applications/Adobe After Effects 2024/Adobe After Effects 2024.app"
 *   → "Adobe After Effects 2024"
 */
function extractAppName(appPath: string): string {
  const appMatch = appPath.match(/([^/]+)\.app(?:\/|$)/i);
  if (appMatch?.[1]) {
    return appMatch[1];
  }

  const yearMatch = appPath.match(/Adobe After Effects \d{4}/i);
  if (yearMatch?.[0]) {
    return yearMatch[0];
  }

  const base = path.basename(appPath, ".app");
  return base === "After Effects" ? "Adobe After Effects" : base || "Adobe After Effects";
}

/**
 * AE 2024 has a bug where AppleScript's DoScript/DoScriptFile don't work
 * unless invoked via the JavaScript for Automation (JXA) engine.
 */
function isAE2024(appName: string): boolean {
  return /After Effects 2024/i.test(appName);
}

/**
 * Run an osascript command, using JXA for AE 2024 and AppleScript for others.
 */
async function runOsascript(
  appName: string,
  mode: "inline" | "file",
  scriptOrPath: string
): Promise<void> {
  if (isAE2024(appName)) {
    const appNameLiteral = JSON.stringify(appName);
    if (mode === "file") {
      // JXA: use Path() to pass a POSIX path to doscriptfile
      const filePathLiteral = JSON.stringify(scriptOrPath);
      const jxa = `var ae = Application(${appNameLiteral}); ae.activate(); ae.doscriptfile(Path(${filePathLiteral}));`;
      await execFileAsync("osascript", ["-l", "JavaScript", "-e", jxa]);
    } else {
      const scriptLiteral = JSON.stringify(scriptOrPath);
      const jxa = `var ae = Application(${appNameLiteral}); ae.activate(); ae.doscript(${scriptLiteral});`;
      await execFileAsync("osascript", ["-l", "JavaScript", "-e", jxa]);
    }
  } else {
    const escaped = scriptOrPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    if (mode === "file") {
      // AppleScript: convert POSIX path to file reference for DoScriptFile
      const appleScript = `tell application "${appName}" to DoScriptFile (POSIX file "${escaped}" as string)`;
      await execFileAsync("osascript", ["-e", appleScript]);
    } else {
      const appleScript = `tell application "${appName}" to DoScript "${escaped}"`;
      await execFileAsync("osascript", ["-e", appleScript]);
    }
  }
}
