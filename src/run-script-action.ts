import {
  action,
  KeyDownEvent,
  SingletonAction,
  SendToPluginEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import type {
  ActionSettings,
  InstalledAEVersionsResponse,
  DetectedAEResponse,
  GetDetectedAERequest,
} from "./settings.js";
import {
  resolveAEPath,
  getInstalledAEVersions,
  detectCurrentAE,
} from "./ae-detection.js";
import { runScriptFile, runInlineScript } from "./script-runner.js";
import streamDeck from "@elgato/streamdeck";

const logger = streamDeck.logger.createScope("RunScript");

// SVG icons for key states (colored circles with icons)
const ICON_RUNNING = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144"><rect fill="#E8A317" width="144" height="144" rx="20"/><text x="72" y="90" text-anchor="middle" fill="white" font-size="60" font-family="Arial">▶</text></svg>`;
const ICON_SUCCESS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144"><rect fill="#2E7D32" width="144" height="144" rx="20"/><text x="72" y="95" text-anchor="middle" fill="white" font-size="70" font-family="Arial">✓</text></svg>`;
const ICON_ERROR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144"><rect fill="#C62828" width="144" height="144" rx="20"/><text x="72" y="95" text-anchor="middle" fill="white" font-size="70" font-family="Arial">✕</text></svg>`;

function toBase64Svg(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

@action({ UUID: "com.jordansteele.aftereffects.run-script" })
export class RunScriptAction extends SingletonAction<ActionSettings> {
  /**
   * Handle messages from the Property Inspector.
   */
  override async onSendToPlugin(
    ev: SendToPluginEvent<JsonValue, ActionSettings>
  ): Promise<void> {
    const payload = ev.payload as Record<string, unknown>;

    if (payload.event === "getInstalledAEVersions") {
      const versions = await getInstalledAEVersions();
      const response: InstalledAEVersionsResponse = {
        event: "installedAEVersions",
        versions,
      };
      await streamDeck.ui.sendToPropertyInspector(response as unknown as JsonValue);
    }

    if (payload.event === "getDetectedAE") {
      const request = payload as unknown as GetDetectedAERequest;
      const name = await detectCurrentAE(
        request.aeTargetMode ?? "foreground",
        request.pinnedAEPath ?? null
      );
      const response: DetectedAEResponse = {
        event: "detectedAE",
        name,
      };
      await streamDeck.ui.sendToPropertyInspector(response as unknown as JsonValue);
    }
  }

  /**
   * When a key is pressed, resolve the AE target and execute the script.
   */
  override async onKeyDown(
    ev: KeyDownEvent<ActionSettings>
  ): Promise<void> {
    const settings = ev.payload.settings;
    const action = ev.action;
    const scriptMode = settings.scriptMode ?? "file";

    // Validate settings
    if (scriptMode === "file" && !settings.scriptPath) {
      logger.warn("No script path configured");
      await action.showAlert();
      return;
    }

    if (scriptMode === "inline" && !settings.inlineScript) {
      logger.warn("No inline script configured");
      await action.showAlert();
      return;
    }

    // Show running state
    if (action.isKey()) {
      await action.setImage(toBase64Svg(ICON_RUNNING));
    }

    try {
      // Resolve the AE binary
      const resolved = await resolveAEPath(
        settings.aeTargetMode ?? "foreground",
        settings.pinnedAEPath ?? null
      );

      if (!resolved) {
        logger.error("No running After Effects instance found");
        if (action.isKey()) {
          await action.setImage(toBase64Svg(ICON_ERROR));
          await action.setTitle("No AE");
          this.resetKeyAfterDelay(action);
        }
        return;
      }

      logger.info(`Targeting ${resolved.name} at ${resolved.path}`);

      // Execute the script
      if (scriptMode === "file") {
        // Decode in case the PI saved a URI-encoded path
        const scriptPath = decodeURIComponent(settings.scriptPath!);
        await runScriptFile(resolved.path, scriptPath, resolved.pid);
      } else {
        await runInlineScript(resolved.path, settings.inlineScript!, resolved.pid);
      }

      // Show success
      if (action.isKey()) {
        await action.setImage(toBase64Svg(ICON_SUCCESS));
        this.resetKeyAfterDelay(action);
      }
      logger.info("Script executed successfully");
    } catch (err) {
      logger.error("Script execution failed", err);
      if (action.isKey()) {
        await action.setImage(toBase64Svg(ICON_ERROR));
        this.resetKeyAfterDelay(action);
      }
    }
  }

  /**
   * Reset the key image back to default after a short delay.
   */
  private resetKeyAfterDelay(
    action: KeyDownEvent<ActionSettings>["action"],
    ms = 2000
  ): void {
    setTimeout(async () => {
      try {
        if (action.isKey()) {
          // Setting image to undefined resets to the manifest default
          await action.setImage(undefined);
          await action.setTitle(undefined);
        }
      } catch {
        // Action may have been removed
      }
    }, ms);
  }
}
