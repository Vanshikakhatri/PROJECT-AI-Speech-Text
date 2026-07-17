# Piper voice models go here

The backend's Text-to-Speech (`backend/tts.py`) uses [Piper](https://github.com/OHF-voice/piper1-gpl)
for fully offline speech synthesis. Piper needs a voice model, which is
**not bundled with this repo** (voice files are tens of MB and licensed
separately), so you need to download one once.

## 1. Download a voice

Go to the Piper voices repo and pick a voice:
https://huggingface.co/rhasspy/piper-voices/tree/main

A good default for English is `en_US-lessac-medium`. You need **both**
files for the voice, and they must sit next to each other:

- `en_US-lessac-medium.onnx`
- `en_US-lessac-medium.onnx.json`

Direct links (medium-quality English voice):
- https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx
- https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json

For Hindi, `hi_IN-pratham-medium` (or any other `hi_IN-*` voice in the same
repo) works the same way - download both its `.onnx` and `.onnx.json` files.

## 2. Place the files here

Put both files directly in this folder (`backend/voices/`):

```
backend/voices/en_US-lessac-medium.onnx
backend/voices/en_US-lessac-medium.onnx.json
```

## 3. (Optional) use a different voice or location

By default the backend looks for `en_US-lessac-medium.onnx` in this folder.
To use a different voice or folder, set these environment variables before
starting the backend:

```
PIPER_VOICE_MODEL=hi_IN-pratham-medium.onnx
PIPER_VOICES_DIR=/absolute/path/to/some/other/folder
```

## That's it

Once the two files are in place, the backend never needs internet access
to generate speech - `/speak` runs Piper locally via `onnxruntime`.

If the model is missing, `/speak` will return a clear error explaining
what's missing and where to put it, instead of a confusing crash.
