import asyncio
import logging
import traceback
import uuid
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

import whisper

import database
from llama import ask_llama
from tts import synthesize_speech

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai-speech-backend")

app = FastAPI()


# ---------------------------------------
# Allow React Frontend
# ---------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------
# Never let one bad request crash the whole backend.
# ---------------------------------------

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled error on %s: %s\n%s", request.url.path, exc, traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": f"Something went wrong while processing this request: {exc}"},
    )


# ---------------------------------------
# Load Whisper Model + init local DB
# ---------------------------------------

model = whisper.load_model("base")
database.init_db()

TMP_DIR = Path(__file__).parent / "tmp"
TMP_DIR.mkdir(exist_ok=True)


# ---------------------------------------
# Request Models
# ---------------------------------------

class TextInput(BaseModel):
    text: str


class ChatInput(BaseModel):
    text: str
    chat_id: str | None = None  # optional: if provided, saved into that chat's history


class CreateChatInput(BaseModel):
    title: str | None = None


class RenameChatInput(BaseModel):
    title: str


# ---------------------------------------
# Home
# ---------------------------------------

@app.get("/")
def home():
    return {
        "message": "AI Speech Backend Running"
    }


# ---------------------------------------
# Chat Endpoint
# Type -> Llama -> Text
# Optionally persisted into Chat History if chat_id is supplied.
# ---------------------------------------

@app.post("/chat")
async def chat(data: ChatInput):
    if not data.text or not data.text.strip():
        raise HTTPException(status_code=400, detail="Message text cannot be empty.")

    history = []
    if data.chat_id:
        chat_row = database.get_chat(data.chat_id)
        if not chat_row:
            raise HTTPException(status_code=404, detail="Chat not found.")
        history = database.get_messages(data.chat_id)

    # ask_llama() makes a blocking HTTP call to Ollama that can take a while.
    # Running it directly here would freeze the whole server (single event
    # loop) for every other user until it finished, so it's offloaded to a
    # worker thread instead.
    answer = await asyncio.to_thread(ask_llama, data.text, history)

    if data.chat_id:
        database.add_message(data.chat_id, "user", data.text)
        database.add_message(data.chat_id, "assistant", answer)

    return {
        "answer": answer
    }


# ---------------------------------------
# Speak Endpoint
# Text -> Speech (fully offline via pyttsx3)
# ---------------------------------------

@app.post("/speak")
async def speak(data: TextInput):
    if not data.text or not data.text.strip():
        raise HTTPException(status_code=400, detail="No text provided to speak.")

    out_path = TMP_DIR / f"voice-{uuid.uuid4().hex}.wav"
    try:
        # Piper synthesis is CPU-bound and blocking - offload it so it
        # doesn't stall the event loop for other concurrent users.
        await asyncio.to_thread(synthesize_speech, data.text, out_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Speech generation failed: {e}")

    return FileResponse(
        str(out_path),
        media_type="audio/wav",
        filename="voice.wav",
    )


# ---------------------------------------
# Voice Chat
# Voice -> Whisper -> Llama
# ---------------------------------------

@app.post("/voice-chat")
async def voice_chat(file: UploadFile = File(...), chat_id: str | None = None):
    in_path = TMP_DIR / f"audio-{uuid.uuid4().hex}.wav"
    try:
        with open(in_path, "wb") as audio:
            audio.write(await file.read())

        # Whisper transcription and the Ollama call are both blocking and
        # can be slow - offload both to worker threads so the event loop
        # stays free to serve other users at the same time.
        result = await asyncio.to_thread(model.transcribe, str(in_path))
        transcript = result["text"]

        if not transcript or not transcript.strip():
            raise HTTPException(status_code=422, detail="Couldn't hear anything clear in that recording.")

        history = []
        if chat_id:
            chat_row = database.get_chat(chat_id)
            if not chat_row:
                raise HTTPException(status_code=404, detail="Chat not found.")
            history = database.get_messages(chat_id)

        answer = await asyncio.to_thread(ask_llama, transcript, history)

        if chat_id:
            database.add_message(chat_id, "user", transcript)
            database.add_message(chat_id, "assistant", answer)

        return {
            "text": transcript,
            "answer": answer
        }
    finally:
        in_path.unlink(missing_ok=True)


# ---------------------------------------
# Optional
# Only Speech -> Text
# ---------------------------------------

@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    in_path = TMP_DIR / f"audio-{uuid.uuid4().hex}.wav"
    try:
        with open(in_path, "wb") as audio:
            audio.write(await file.read())

        # Offload to a worker thread so this doesn't block other users'
        # requests while transcription runs.
        result = await asyncio.to_thread(model.transcribe, str(in_path))

        return {
            "text": result["text"]
        }
    finally:
        in_path.unlink(missing_ok=True)


# ---------------------------------------
# Chat History
# ---------------------------------------

@app.get("/chats")
def get_chats():
    return {"chats": database.list_chats()}


@app.post("/chats")
def create_chat(data: CreateChatInput):
    chat = database.create_chat(title=(data.title or "New Chat").strip() or "New Chat")
    return chat


@app.get("/chats/{chat_id}")
def get_chat_detail(chat_id: str):
    chat_row = database.get_chat(chat_id)
    if not chat_row:
        raise HTTPException(status_code=404, detail="Chat not found.")
    messages = database.get_messages(chat_id)
    return {**chat_row, "messages": messages}


@app.put("/chats/{chat_id}")
def rename_chat(chat_id: str, data: RenameChatInput):
    if not data.title or not data.title.strip():
        raise HTTPException(status_code=400, detail="Title cannot be empty.")
    ok = database.rename_chat(chat_id, data.title.strip())
    if not ok:
        raise HTTPException(status_code=404, detail="Chat not found.")
    return database.get_chat(chat_id)


@app.delete("/chats/{chat_id}")
def delete_chat(chat_id: str):
    ok = database.delete_chat(chat_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Chat not found.")
    return {"deleted": True, "id": chat_id}
