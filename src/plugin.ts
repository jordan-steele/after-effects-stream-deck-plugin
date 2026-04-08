import streamDeck from "@elgato/streamdeck";
import { MenuCommandAction } from "./menu-command-action.js";
import { RunScriptAction } from "./run-script-action.js";

// Register actions
streamDeck.actions.registerAction(new MenuCommandAction());
streamDeck.actions.registerAction(new RunScriptAction());

// Connect to Stream Deck
streamDeck.connect();
