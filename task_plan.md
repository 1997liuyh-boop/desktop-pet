# Desktop Pet Fix Plan

## Goal
Fix walking action selection, restore edge-climbing behavior, route autonomous chat through configured LLM, and improve TTS toward MiMo V2.5 cute emotional voices without hardcoding secrets.

## Phases
- [complete] Phase 1: Read current JS/Rust animation, walk, AI, voice paths and compare old VPet behavior.
- [complete] Phase 2: Identify root causes and decide minimal scoped edits.
- [complete] Phase 3: Implement focused fixes.
- [complete] Phase 4: Run feasible validation and record results.

## Current Fix Summary
- Edge climbing now starts from the real left/right window boundary and is driven by front-end window position state.
- Edge climbing progresses around the display: side up, top across, opposite side down, bottom back to origin.
- Walk edge detection uses the same physical-pixel coordinate system as Tauri window position/size.
- SideHide pauses during edge climbing so it does not fight the climb movement.

## Constraints
- Do not revert unrelated changes.
- Only write inside `D:\demo3\desktop-pet`.
- Use existing configuration and interfaces; no hardcoded keys.
