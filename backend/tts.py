"""
Fully offline Text-to-Speech using Piper (neural TTS via onnxruntime).

Replaces the previous pyttsx3-based implementation (and, before that,
gTTS). Piper does not call out to any cloud/Google service - it loads a
local .onnx voice model and synthesizes audio entirely on-device, which is
required for this project to keep working inside networks with proxy
restrictions and with no internet access at runtime.

Voice model setup (one-time, needs internet the first time only)
------------------------------------------------------------------
Piper needs TWO files for a voice, both from the official voices repo:
https://huggingface.co/rhasspy/piper-voices/tree/main

  1. <voice-name>.onnx          - the model weights
  2. <voice-name>.onnx.json     - the model config (must sit right next to it)

Example (English, medium quality, good default):
  en_US-lessac-medium.onnx
  en_US-lessac-medium.onnx.json

Download both and place them in:
  backend/voices/

You can point at a different voice or folder without touching this file
via environment variables:
  PIPER_VOICE_MODEL   filename (relative to PIPER_VOICES_DIR) or an
                       absolute path to the .onnx model.
                       Default: "en_US-lessac-medium.onnx"
  PIPER_VOICES_DIR     folder to look for the voice in.
                        Default: backend/voices

Once the two files are in place, everything runs fully offline - no
internet is required for /speak to work.

Implementation notes
---------------------
- Uses Piper's Python API (`PiperVoice`) instead of shelling out to a
  `piper` binary, so this works the same way on Windows and Linux with
  no extra PATH/executable setup - `pip install piper-tts` is enough.
- The voice model is loaded once (lazily, on first request) and cached in
  memory, since loading the ONNX model on every request would be slow.
- Piper writes WAV directly (16-bit PCM), so no extra format conversion
  step is needed - the output is already exactly what the existing
  /speak endpoint and frontend audio player expect.
- Loading/synthesis is guarded by a lock: PiperVoice's underlying ONNX
  session is not guaranteed safe for concurrent inference calls from
  multiple threads, and FastAPI can service requests on different
  threads.
"""

import os
import threading
import wave
from pathlib import Path

_lock = threading.Lock()
_voice = None
_voice_error = None  # cached error so a broken setup fails fast, not on every request

OUTPUT_PATH = Path(__file__).parent / "voice.wav"
VOICES_DIR = Path(os.environ.get("PIPER_VOICES_DIR", str(Path(__file__).parent / "voices")))
DEFAULT_MODEL_NAME = os.environ.get("PIPER_VOICE_MODEL", "en_US-lessac-medium.onnx")


class TTSNotConfiguredError(RuntimeError):
    """Raised when Piper isn't installed or the voice model is missing/broken.

    Carries an actionable message (what to install / where to put the
    voice files) instead of a raw stack trace, since this is a setup
    problem an operator needs to fix, not a per-request failure.
    """


def _resolve_model_path() -> Path:
    model_name = DEFAULT_MODEL_NAME
    candidate = Path(model_name)
    if candidate.is_absolute():
        return candidate
    return VOICES_DIR / model_name


def _load_voice():
    """Lazily load and cache the Piper voice model (thread-safe)."""
    global _voice, _voice_error

    if _voice is not None:
        return _voice
    if _voice_error is not None:
        raise _voice_error

    with _lock:
        # Re-check inside the lock in case another thread just finished loading.
        if _voice is not None:
            return _voice
        if _voice_error is not None:
            raise _voice_error

        try:
            from piper import PiperVoice
        except ImportError as e:
            _voice_error = TTSNotConfiguredError(
                "Piper TTS is not installed. Run `pip install piper-tts` "
                "inside the backend's Python environment and restart the server."
            )
            raise _voice_error from e

        model_path = _resolve_model_path()
        config_path = Path(f"{model_path}.json")

        if not model_path.exists() or not config_path.exists():
            _voice_error = TTSNotConfiguredError(
                "Piper voice model not found. Expected both of:\n"
                f"  {model_path}\n"
                f"  {config_path}\n"
                "Download the voice (.onnx and .onnx.json files) from "
                "https://huggingface.co/rhasspy/piper-voices and place them in "
                f"'{VOICES_DIR}', or point PIPER_VOICE_MODEL / PIPER_VOICES_DIR "
                "at their location."
            )
            raise _voice_error

        try:
            _voice = PiperVoice.load(str(model_path), config_path=str(config_path))
        except Exception as e:
            _voice_error = TTSNotConfiguredError(f"Failed to load the Piper voice model: {e}")
            raise _voice_error from e

    return _voice


def synthesize_speech(text: str, output_path: Path = OUTPUT_PATH) -> Path:
    """Synthesize `text` to a WAV file at `output_path`.

    Signature is unchanged from the previous pyttsx3 implementation, so the
    /speak endpoint in main.py (and therefore the frontend) needs no changes.
    """
    if not text or not text.strip():
        raise ValueError("No text provided to synthesize.")

    voice = _load_voice()

    with _lock:
        try:
            with wave.open(str(output_path), "wb") as wav_file:
                voice.synthesize_wav(text, wav_file)
        except Exception as e:
            raise RuntimeError(f"Piper failed to generate audio: {e}") from e

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError("Piper did not produce any audio output.")

    return output_path
