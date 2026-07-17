# Setup Guide (Windows & Linux Desktop)

This gets the backend (FastAPI + Whisper + Ollama + Piper) and frontend (React + Vite) running
locally on your machine. Pick your OS below — each is a straight top-to-bottom copy/paste.

Everything runs offline at request time. The only internet you need is for the one-time downloads
in Steps 1–3.

---

## Requirements checklist

| Requirement | Why |
|---|---|
| Python 3.11+ | Runs the FastAPI backend |
| Node.js 18+ / npm | Runs the React/Vite frontend |
| ffmpeg | Whisper needs it to decode uploaded audio |
| Ollama | Runs the local LLM (`llama3.2:3b`) that powers Card 3 |
| Piper voice model (2 files) | Powers offline Card 2/3 text-to-speech |
| ~8–10 GB free disk, 8 GB+ RAM recommended | Whisper + PyTorch + Ollama model + Piper model |

---

## Windows

### Step 1 — Install prerequisites

```powershell
# Python (skip if already installed) — get from python.org and check "Add to PATH", or:
winget install Python.Python.3.11

# Node.js
winget install OpenJS.NodeJS.LTS

# ffmpeg
winget install Gyan.FFmpeg

# Ollama
winget install Ollama.Ollama
```

Restart your terminal after these so PATH updates take effect.

### Step 2 — Pull the LLM model

```powershell
ollama pull llama3.2:3b
```

Ollama runs as a background service after install, so it's ready at `http://localhost:11434`.

### Step 3 — Get a Piper voice model

Download both files (they must sit together) into `backend\voices\`:
- https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx
- https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json

```powershell
cd backend\voices
curl.exe -L -o en_US-lessac-medium.onnx "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx"
curl.exe -L -o en_US-lessac-medium.onnx.json "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json"
cd ..\..
```

(For Hindi replies to also sound right in speech, you can additionally grab a `hi_IN-*` voice the
same way and point `PIPER_VOICE_MODEL` at it later — optional.)

### Step 4 — Backend

```powershell
cd backend
python -m venv venv
venv\Scripts\activate

pip install --index-url https://download.pytorch.org/whl/cpu torch
pip install -r requirements.txt

uvicorn main:app --reload --port 8000
```

Leave this terminal running. First run will also auto-download the Whisper `base` model — that's
normal and only happens once.

### Step 5 — Frontend (new terminal window)

```powershell
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

### Windows troubleshooting

- **"ffmpeg not found"** → close and reopen your terminal after installing (PATH refresh), or
  restart your PC.
- **Ollama not reachable** → check it's running: open a terminal and run `ollama list`; if that
  fails, start it via the Start Menu ("Ollama") or `ollama serve`.
- **Piper error about missing model** → double-check both `.onnx` and `.onnx.json` are directly
  inside `backend\voices\`, not in a subfolder.

---

## Linux Desktop

Examples below use `apt` (Debian/Ubuntu). Swap for `dnf`/`pacman`/etc. if you're on another
distro — package names are the same or very close.

### Step 1 — Install prerequisites

```bash
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3-pip ffmpeg nodejs npm curl

# Ollama (official install script)
curl -fsSL https://ollama.com/install.sh | sh
```

### Step 2 — Pull the LLM model

```bash
ollama pull llama3.2:3b
```

`ollama serve` typically runs as a systemd service after install. Check with:

```bash
systemctl status ollama
```

If it's not running: `ollama serve &`

### Step 3 — Get a Piper voice model

```bash
cd backend/voices
curl -L -o en_US-lessac-medium.onnx "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx"
curl -L -o en_US-lessac-medium.onnx.json "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json"
cd ../..
```

### Step 4 — Backend

```bash
cd backend
python3.11 -m venv venv
source venv/bin/activate

pip install --index-url https://download.pytorch.org/whl/cpu torch
pip install -r requirements.txt

uvicorn main:app --reload --port 8000
```

Leave this terminal running. First run auto-downloads the Whisper `base` model once.

### Step 5 — Frontend (new terminal)

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

### Linux troubleshooting

- **`ollama: command not found`** → open a new shell (install script updates PATH) or run
  `source ~/.bashrc`.
- **Ollama not reachable** → `curl http://localhost:11434` should return something other than
  connection refused; if not, `sudo systemctl start ollama` or `ollama serve`.
- **Permission denied on venv activate** → make sure you're using `source venv/bin/activate`, not
  running the script directly.
- **Piper error about missing model** → confirm both files are directly inside `backend/voices/`.

---

## Running both at once (either OS)

You need **three things running at the same time**, each in its own terminal:

1. Ollama (usually already running in the background as a service)
2. Backend: `uvicorn main:app --reload --port 8000` (from `backend/`, venv activated)
3. Frontend: `npm run dev` (from `frontend/`)

Then open the frontend URL in your browser and use the 3 cards.

## Optional: Docker for the backend instead of Steps 4 (manual venv)

Works the same on both Windows (with Docker Desktop) and Linux:

```bash
cd backend
docker build -t ai-speech-backend .
docker run -p 8000:8000 ai-speech-backend
```

Ollama must still run on your **host** machine (not inside this container) — the backend reaches
it at `host.docker.internal:11434`. You'd still do Steps 1–3 (Ollama + Piper model) as normal;
only the backend's Python environment gets replaced by the container. The frontend (Step 5) still
runs the same way outside Docker.
