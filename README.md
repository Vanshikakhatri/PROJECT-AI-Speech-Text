# AI Speech & Text Assistant

A fully offline, full-stack AI voice/speech app with three core features:

- **Card 1 — Speech to Text**: record your voice, get an instant transcript (Whisper)
- **Card 2 — Text to Speech**: type text, get natural-sounding audio back (Piper)
- **Card 3 — AI Voice Assistant**: type or speak to chat with a local LLM (Ollama), with saved,
  resumable chat history and replies that match your language (English / Hindi / Hinglish)

Everything runs **locally, offline, at request time** — Whisper (STT), Ollama (LLM), and Piper
(TTS) all run on your own machine. The only one-time internet requirement is downloading the
models themselves.

## Tech stack

| Layer | Technology | Role |
|---|---|---|
| Frontend | React 19 + Vite | UI, 3-card layout, chat sidebar |
| Backend framework | FastAPI + Uvicorn | REST API, async request handling |
| Speech-to-Text | OpenAI Whisper (`base` model) | Converts uploaded audio → transcript |
| LLM / Chat brain | Ollama running `llama3.2:3b` | Generates conversational replies, fully offline |
| Text-to-Speech | Piper (`piper-tts`, ONNX-based) | Converts text → `.wav` audio, offline |
| Persistence | SQLite (`chat_history.db`) | Stores chats + messages for Card 3's history panel |
| Containerization | Docker (optional) | Packages the backend with ffmpeg + all Python deps |

## Quick start

Full, OS-specific instructions (Windows and Linux desktop) are in **[SETUP.md](./SETUP.md)**.

The short version:

1. Install and start Ollama, then `ollama pull llama3.2:3b`
2. Backend: create a venv, install `backend/requirements.txt`, drop a Piper voice model into
   `backend/voices/`, run `uvicorn main:app --reload --port 8000`
3. Frontend: `npm install` then `npm run dev` inside `frontend/`
4. Open the printed local URL and use the 3 cards

## Project structure

```
AI-Speech-Text/
├── backend/
│   ├── main.py           # FastAPI app, all routes
│   ├── llama.py          # Ollama chat logic, language handling, date/time
│   ├── tts.py             # Piper text-to-speech
│   ├── database.py        # SQLite chat history persistence
│   ├── requirements.txt
│   ├── Dockerfile
│   └── voices/             # Piper voice model files go here (not bundled)
├── frontend/
│   ├── src/App.jsx         # All 3 cards + chat history UI
│   └── package.json
├── CHANGES.md               # History of fixes/changes made to this project
├── SETUP.md                  # Full setup guide (Windows + Linux)
└── README.md                  # This file
```

## Requirements at a glance

See [SETUP.md](./SETUP.md) for exact install commands per OS. In short, you need:

- Python 3.11+
- Node.js + npm
- ffmpeg
- Ollama (with the `llama3.2:3b` model pulled)
- A Piper voice model (`.onnx` + `.onnx.json`) in `backend/voices/`

## Notes

- `CHANGES.md` documents everything that's been fixed/added to this project over time (timeouts,
  multilingual replies, chat memory, offline TTS, concurrency handling, etc.) — worth a read if
  you're picking this project back up after a while.
