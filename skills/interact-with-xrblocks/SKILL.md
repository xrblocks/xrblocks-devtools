---
name: interact-with-xrblocks
description: Inspect and manually exercise complete XR Blocks applications through the xrblocks-devtools JavaScript REPL. Use when an integrated app needs visual or runtime evidence from scene context, developer metadata, viewer or hand movement, selection, voice input, screenshots, or recordings.
---

# Interact with XR Blocks

Follow one **observe → act → verify** loop through a live Session.

Read [references/commands-and-scenarios.md](references/commands-and-scenarios.md)
before opening the REPL. It defines launch flags, direct functions, units,
targets, evidence helpers, and scenario patterns.

## 1. Define the evidence

State one observable postcondition. Select the smallest matching evidence:
camera image, semantic context, declared state, object transform, hand state,
browser diagnostics, or a recording.

Complete this step when the expected change and the before/after evidence that
can prove it are explicit.

## 2. Open one Session

Start Interact mode against a Vite project, browser-ready static app directory,
or existing URL. Directory mode starts the appropriate server. Keep its terminal
session so later expressions reach the same `xrblocks>` prompt.

Complete this step when the REPL is ready and its startup URL identifies the
intended application.

## 3. Establish the baseline

Save a screenshot and capture the selected runtime or semantic evidence before
input. Discover an exact unique context name or Devtools tag for every target.

Complete this step when every target is identified from live evidence and the
baseline artifact exists.

## 4. Perform the smallest embodied sequence

Call direct REPL functions such as `navigateTo`, `pointTo`, `reachTo`, `click`,
or `injectAudio`. Let the REPL wait for each returned promise. Release held
selection before changing scenarios after an error.

Complete this step when the intended input sequence has finished without an
unresolved held selection.

## 5. Verify and close

Capture the same evidence after input and inspect every saved image or video
used in the conclusion. Treat action completion as input delivery, not an
application assertion.

Exit with `.exit` or Ctrl-D. Verify that the CLI, browser, and any server
started by DevTools have stopped. Leave an existing `--url` server running.

Finish only when the postcondition has direct before/after evidence, every
reported artifact was inspected, and the Session process is closed.
