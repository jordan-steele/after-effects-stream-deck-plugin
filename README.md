# After Effects for Stream Deck

A Stream Deck plugin that lets you run Adobe After Effects ExtendScript (.jsx) files or inline scripts with a single button press.

## Features

- **Script file mode** — Point a button at any `.jsx` file on disk
- **Inline script mode** — Write short scripts directly in the Stream Deck UI
- **AE version targeting** — Choose which After Effects installation to target:
  - **Newest** — Automatically picks the running AE with the highest version year
  - **Foreground** — Targets whichever AE window is currently in focus
  - **Pinned** — Lock to a specific installed AE version
- **Visual feedback** — Button shows running (amber), success (green), or error (red) states
- **Cross-platform** — Works on macOS and Windows

## Requirements

- [Stream Deck](https://www.elgato.com/stream-deck) software 6.7+
- [Node.js](https://nodejs.org/) 20+
- Adobe After Effects (any recent version with ExtendScript support)

## Installation

### From source

1. Clone this repository:
   ```bash
   git clone https://github.com/jordan-steele/after-effects-stream-deck-plugin.git
   cd after-effects-stream-deck-plugin
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the plugin:
   ```bash
   npm run build
   ```

4. Link the plugin for development:
   ```bash
   npx streamdeck link com.jordansteele.aftereffects.sdPlugin
   ```

5. Restart Stream Deck to pick up the new plugin.

### Development mode

Use watch mode to automatically rebuild and restart the plugin on changes:

```bash
npm run watch
```

The build assembles the generated Stream Deck package at
`com.jordansteele.aftereffects.sdPlugin/` from source files in
`plugin/`, `ui/`, `assets/`, and `src/`.

## Usage

### Adding a button

1. Open the Stream Deck application
2. Find **After Effects > Run Script** in the action list on the right
3. Drag it onto a button slot

### Configuring the button

Click the button in Stream Deck to open the Property Inspector with these settings:

#### Script Mode

- **Script File** — Enter the full path to a `.jsx` file (e.g., `/Users/you/scripts/render.jsx`)
- **Inline Script** — Type ExtendScript directly into the text area. A warning appears if the script exceeds ~10 lines (at that point, a standalone file is easier to maintain)

#### AE Target

- **Use foreground AE** — Targets whichever AE instance is currently the frontmost application (falls back to newest if no AE is in the foreground)
- **Always use newest** — Targets the running AE instance with the highest version number
- **Installed versions** — Lists all locally installed AE versions; selecting one pins the button to that specific version

A status line below the dropdown shows the currently detected running AE instance.

### Button states

When you press the button:

| State | Color | Meaning |
|-------|-------|---------|
| Running | Amber | Script is being sent to After Effects |
| Success | Green | Script executed without errors |
| Error | Red | Script failed or no AE instance was found |

The button resets to its default appearance after 2 seconds.

## Project Structure

```
├── plugin/
│   └── manifest.json          # Source manifest copied into the package root
├── ui/
│   └── inspector.html         # Source Property Inspector UI
├── assets/
│   └── imgs/                  # Source plugin and action icons
├── src/
│   ├── plugin.ts              # Entry point — registers actions and connects to SD
│   ├── run-script-action.ts   # Action handler with key state management
│   ├── script-runner.ts       # Executes scripts via file or inline mode
│   ├── ae-detection.ts        # Finds installed/running AE instances (mac + win)
│   └── settings.ts            # TypeScript types for action settings and messages
├── com.jordansteele.aftereffects.sdPlugin/
│   ├── manifest.json          # Generated plugin package root
│   ├── pi/                    # Copied UI assets
│   ├── imgs/                  # Copied icon assets
│   └── bin/                   # Built output
├── rollup.config.mjs          # Rollup bundler configuration
└── tsconfig.json
```