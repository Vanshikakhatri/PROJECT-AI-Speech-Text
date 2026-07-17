# CHANGES.md — What was modified and why

Stack, folder structure, UI layout, and all existing endpoints are unchanged.
Everything below is additive or a targeted fix.

## 1. Timeouts (Card 3 "Failed to fetch")
- Frontend: `fetchJSON`/`fetchBlob` now use an 8-minute `AbortController`
  timeout instead of relying on the browser's default (which is what was
  silently failing before). `App.jsx`.
- Backend: `llama.py` now calls Ollama with a 10-minute `requests` timeout
  and 2 retries on transient connection errors.
- `Dockerfile`: uvicorn's `--timeout-keep-alive` raised to 620s so the
  connection doesn't get dropped mid-generation on a slow local model.

## 2. Clear button bug
Root cause: the button was `disabled` whenever a request was in flight
(`aiBusy`/`sending`), and if that request hung (no timeout existed before),
`sending` never went back to `false` — permanently disabling Clear.
Fix: Clear is never disabled now. It aborts any in-flight request via a
tracked `AbortController` and force-resets all Card 3 state, including
recording state.

## 3–4. Multilingual + natural conversation
`llama.py` now sends a system prompt (via Ollama's `/api/chat`, still
Ollama) instructing the model to mirror the user's language (English /
Hindi / Hinglish), be conversational and empathetic, and handle small talk,
feelings, jokes, stories, etc. — not just Q&A.

## 5. Date/time
Date/time questions (English + Hindi/Hinglish phrasing) are detected with a
regex and answered directly from Python's `datetime.now()` — never passed
to the LLM. The current OS date/time is also injected into every system
prompt as ground truth, in case the model needs it for context.

## 6–8. Memory, chat history, stability
- Conversation history is now sent to Ollama via `/api/chat` (last 20
  messages) so follow-ups like "continue" / "shorter" / "give example" work.
- New `database.py`: a small SQLite layer (`backend/chat_history.db`) with
  chats + messages tables — create, list, rename, delete, fetch.
- New endpoints: `GET/POST /chats`, `GET/PUT/DELETE /chats/{id}`.
  `/chat` and `/voice-chat` now accept an optional `chat_id` to persist
  turns and pull prior turns as memory.
- Frontend: a "History" panel was added to Card 3 (toggle button, doesn't
  change the 3-card layout) — new chat, rename, delete, reopen, and a
  scrolling thread of the conversation so far.
- History trimming (last 20 messages) keeps long chats from degrading.

## 9. Offline
**Found and fixed a real offline gap**: the project used `gTTS`, which
calls Google's servers. Replaced with `pyttsx3` (drives the system's
`espeak-ng`, fully offline) — same `/speak` API, frontend needed no changes
beyond the output being `.wav` instead of `.mp3`. `Dockerfile` now installs
`espeak-ng`/`espeak`/`libespeak1`.

**Also fixed**: `App.css` loaded Poppins/Inter/JetBrains Mono from Google
Fonts via `@import url("https://fonts.googleapis.com/...")` on every page
load. Replaced with `@fontsource/*` npm packages (`main.jsx`), which bundle
the actual font files into the Vite build — genuinely zero network
requests now, not just "falls back gracefully." Also swapped the display
font from Space Grotesk to **Poppins** (rounder, friendlier letterforms,
still clean/professional) at your request; Inter (body) and JetBrains Mono
(monospace) are unchanged, just self-hosted. New frontend deps:
`@fontsource/poppins`, `@fontsource/inter`, `@fontsource/jetbrains-mono`.

## 10. Robustness
- A global FastAPI exception handler means one bad request returns a
  friendly 500 instead of crashing the process.
- `/voice-chat` and `/transcribe` write uploads to uniquely-named temp
  files and clean them up in a `finally` block (previously a fixed
  `audio.wav` name, which could race between concurrent requests).
- `/speak` similarly writes uniquely-named temp `.wav` files.

## Requirements changed
`backend/requirements.txt`: `gTTS` → `pyttsx3` (offline TTS engine, see #9).

## New files
- `backend/database.py` — SQLite chat history persistence
- `backend/tts.py` — offline TTS via pyttsx3
- `CHANGES.md` — this file

## One thing to double check before you deploy
`database.py` stores `chat_history.db` next to the backend code — mount
`/app` (or at least that file) as a volume in your Docker run if you want
history to survive `docker compose down` / container recreation, not just
`restart`.
