import type { JsonValue } from "@elgato/utils";

/**
 * How to select which After Effects instance to target.
 * - "newest": pick the running AE with the highest version
 * - "foreground": pick whichever AE instance is currently in the foreground
 * - "pinned": use a specific installed AE version chosen by the user
 */
export type AETargetMode = "newest" | "foreground" | "pinned";

/**
 * Whether the action runs a .jsx file or an inline script string.
 */
export type ScriptMode = "file" | "inline";

/**
 * Per-button settings stored by Stream Deck.
 */
export type ActionSettings = {
  scriptMode: ScriptMode;
  scriptPath: string | null;
  inlineScript: string | null;
  aeTargetMode: AETargetMode;
  pinnedAEPath: string | null;
  [key: string]: JsonValue;
};

/** Message types sent from PI → plugin */
export interface GetInstalledAEVersionsRequest {
  event: "getInstalledAEVersions";
}

export interface GetDetectedAERequest {
  event: "getDetectedAE";
  aeTargetMode?: AETargetMode;
  pinnedAEPath?: string | null;
}

export interface AEVersionInfo {
  name: string;
  path: string;
}

/** Message types sent from plugin → PI */
export interface InstalledAEVersionsResponse {
  event: "installedAEVersions";
  versions: AEVersionInfo[];
}

export interface DetectedAEResponse {
  event: "detectedAE";
  name: string | null;
}
