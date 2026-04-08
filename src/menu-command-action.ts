import {
  action,
  KeyDownEvent,
  SendToPluginEvent,
  SingletonAction,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import type {
  DetectedAEResponse,
  GetDetectedAERequest,
  InstalledAEVersionsResponse,
  MenuCommandActionSettings,
} from "./settings.js";
import {
  detectCurrentAE,
  getInstalledAEVersions,
  resolveAEPath,
} from "./ae-detection.js";
import { runInlineScript } from "./script-runner.js";
import streamDeck from "@elgato/streamdeck";

const logger = streamDeck.logger.createScope("MenuCommand");

const ICON_RUNNING = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144"><rect fill="#E8A317" width="144" height="144" rx="20"/><text x="72" y="90" text-anchor="middle" fill="white" font-size="60" font-family="Arial">▶</text></svg>`;
const ICON_SUCCESS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144"><rect fill="#2E7D32" width="144" height="144" rx="20"/><text x="72" y="95" text-anchor="middle" fill="white" font-size="70" font-family="Arial">✓</text></svg>`;
const ICON_ERROR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144"><rect fill="#C62828" width="144" height="144" rx="20"/><text x="72" y="95" text-anchor="middle" fill="white" font-size="70" font-family="Arial">✕</text></svg>`;

function toBase64Svg(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function buildMenuCommandScript(settings: MenuCommandActionSettings): string | null {
  const commandMode = settings.commandMode ?? "string";

  if (commandMode === "id") {
    const value = settings.commandId?.trim();
    if (!value || !/^\d+$/.test(value)) {
      return null;
    }

    const commandId = Number.parseInt(value, 10);
    if (!Number.isInteger(commandId) || commandId <= 0) {
      return null;
    }

    return `app.executeCommand(${commandId});`;
  }

  const commandString = settings.commandString?.trim();
  if (!commandString) {
    return null;
  }

  return `var commandName = ${JSON.stringify(commandString)};
var commandId = app.findMenuCommandId(commandName);
if (!commandId) {
  throw new Error("No After Effects menu command found for: " + commandName);
}
app.executeCommand(commandId);`;
}

@action({ UUID: "com.jordansteele.aftereffects.menu-command" })
export class MenuCommandAction extends SingletonAction<MenuCommandActionSettings> {
  override async onSendToPlugin(
    ev: SendToPluginEvent<JsonValue, MenuCommandActionSettings>
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

  override async onKeyDown(
    ev: KeyDownEvent<MenuCommandActionSettings>
  ): Promise<void> {
    const settings = ev.payload.settings;
    const action = ev.action;
    const script = buildMenuCommandScript(settings);

    if (!script) {
      logger.warn("No valid menu command configured");
      await action.showAlert();
      return;
    }

    if (action.isKey()) {
      await action.setImage(toBase64Svg(ICON_RUNNING));
    }

    try {
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

      await runInlineScript(resolved.path, script, resolved.pid);

      if (action.isKey()) {
        await action.setImage(toBase64Svg(ICON_SUCCESS));
        this.resetKeyAfterDelay(action);
      }
      logger.info("Menu command executed successfully");
    } catch (err) {
      logger.error("Menu command execution failed", err);
      if (action.isKey()) {
        await action.setImage(toBase64Svg(ICON_ERROR));
        this.resetKeyAfterDelay(action);
      }
    }
  }

  private resetKeyAfterDelay(
    action: KeyDownEvent<MenuCommandActionSettings>["action"],
    ms = 2000
  ): void {
    setTimeout(async () => {
      try {
        if (action.isKey()) {
          await action.setImage(undefined);
          await action.setTitle(undefined);
        }
      } catch {
        // Action may have been removed
      }
    }, ms);
  }
}
