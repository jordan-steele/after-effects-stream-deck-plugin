import streamDeck from "@elgato/streamdeck";
import { RunScriptAction } from "./run-script-action.js";

// Register actions
streamDeck.actions.registerAction(new RunScriptAction());

// Connect to Stream Deck
streamDeck.connect();
