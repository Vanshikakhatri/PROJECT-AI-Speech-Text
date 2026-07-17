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








**AI Speech Text Project (Offline Setup Guide)
Prerequisites (Install Once)
1. Python
python3 --version
Should be 3.11 or above.

2. Node.js
node -v
npm -v

3. FFmpeg
Check
ffmpeg -version
If missing
brew install ffmpeg

4. Ollama
Check
ollama --version
If not installed
Download Ollama and install it. 

STEP 1 — Download the model
Run
ollama pull llama3.2:3b
Verify
ollama list
Expected
llama3.2:3b

STEP 2 — Download Piper voice
Go to
backend/
Open
voices/
If empty
Download
en_US-lessac-medium.onnx

en_US-lessac-medium.onnx.json
Copy both into
backend/
    voices/
Final folder
backend
    voices
        README.md
        en_US-lessac-medium.onnx
        en_US-lessac-medium.onnx.json

STEP 3 — Open VS Code
Open
Project AI-Speech-Text

STEP 4 — Open Terminal
Terminal →
New Terminal

STEP 5 — Backend
Go inside backend
cd backend

Create virtual environment
python3 -m venv venv

Activate
source venv/bin/activate
Prompt becomes
(venv)

Upgrade pip
python -m pip install --upgrade pip

Install dependencies
python -m pip install -r requirements.txt
Wait until installation finishes.

STEP 6 — IMPORTANT FIX (No Docker)
Since you are NOT using Docker, you must edit the Ollama URL.
Open
backend/llama.py
Find this line (or similar):
OLLAMA_BASE_URL = "http://host.docker.internal:11434"
or
OLLAMA_BASE_URL = "http://host.docker.internal:11434/api/chat"
Replace it with
OLLAMA_BASE_URL = "http://localhost:11434"
Leave the next line as:
OLLAMA_CHAT_URL = f"{OLLAMA_BASE_URL}/api/chat"
Do not write:
OLLAMA_BASE_URL = "OLLAMA_URL = ..."
That is invalid Python.
host.docker.internal is intended for Docker containers to reach the host. Since your backend is running directly on macOS, use localhost instead. 

STEP 7 — Run Backend
Inside backend
uvicorn main:app --reload --port 8000
Expected
INFO: Uvicorn running on http://127.0.0.1:8000
Leave this terminal open.

STEP 8 — Frontend
Open a new terminal
cd frontend
Install packages
npm install
Run
npm run dev
Expected
Local:

http://localhost:5173
Leave this terminal open.

STEP 9 — Ollama
Usually on macOS it already runs automatically.
Check
ollama list
or
ollama ps
If not running
ollama serve
If you see
bind: address already in use
that means Ollama is already running, so don't start another instance. 

STEP 10 — Open Browser
Visit
http://localhost:5173

STEP 11 — Test Features
Card 1
Speech → Text

Card 2
Text → Speech

Card 3
Ask
What is AI?
AI should respond.

If AI Chat Doesn't Work
Error
Could not reach local Ollama server

host.docker.internal
Solution
Open
backend/llama.py
Replace
http://host.docker.internal:11434
with
http://localhost:11434
Save.
Restart backend.

Restart Backend
Stop
Ctrl + C
Run again
uvicorn main:app --reload --port 8000

Verify Ollama
Run
curl http://localhost:11434/api/tags
If you get JSON containing your installed models, your backend should be able to connect to Ollama. 

Final Running Terminals
Terminal 1
cd backend

source venv/bin/activate

uvicorn main:app --reload --port 8000

Terminal 2
cd frontend

npm run dev

Ollama
Runs automatically (or start with ollama serve if needed).

**
