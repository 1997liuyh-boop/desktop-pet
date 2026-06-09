# Findings

## Edge Climb Follow-up
- The short climb came from `dist/scripts/app.js` using `_edgeMoveUntil` plus `_edgeMoveDy` for only `edgeDurationMs` after `edgeHit`.
- Autonomous walk no longer intentionally uses the old `margin: 20`, but `get_screen_info` returned scaled logical dimensions while window position/size commands used physical pixels, which can make edge detection happen early on scaled displays.
- Old VPet `vup.lps` defines side climb, top climb, and crawl/fall movements as position-bound move graphs. The current fix keeps fall out of autonomous edge climb and drives a four-edge loop from the front end.

## Initial State
- Worktree already has modified and untracked files before this task.
- User supplied MiMo V2.5 TTS request contract: `POST https://api.xiaomimimo.com/v1/chat/completions`, header `api-key`, model `mimo-v2.5-tts`, `audio.format=wav`, voice `冰糖` or `茉莉`, emotional tags supported in text/instructions.
