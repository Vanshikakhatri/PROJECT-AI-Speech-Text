"""
Talks to the local, offline Ollama server.

Improvements over the original version:
- Uses Ollama's /api/chat endpoint (still Ollama, same offline model) so we
  can pass real conversation history instead of a single flat prompt.
- Long timeout so a slow local model doesn't get killed mid-generation.
- Small retry for transient connection errors (Ollama still warming up etc).
- A stronger system prompt: conversational, empathetic, matches the user's
  language (Hindi / English / Hinglish), never invents dates/times, and
  admits when it doesn't know something.
- Context window management so long conversations stay stable instead of
  silently degrading ("conversation blackout").
"""

import re
import time
from datetime import datetime

import requests

OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_CHAT_URL = f"{OLLAMA_BASE_URL}/api/chat"
MODEL_NAME = "llama3.2:3b"

# Local models can be slow, especially on CPU. Give it room to finish
# instead of the request dying mid-generation.
REQUEST_TIMEOUT_SECONDS = 600  # 10 minutes
MAX_RETRIES = 2
RETRY_BACKOFF_SECONDS = 2

# Keep only the most recent N turns (user+assistant pairs) when building the
# prompt so very long chats don't blow up context / slow the model to a
# crawl / cause it to lose track of the conversation.
MAX_HISTORY_MESSAGES = 20


SYSTEM_PROMPT = """You are a helpful AI assistant.
Reply in the same language used by the user.
Rules:
- If the question is in English, answer only in English.
- If the question is in Hindi, answer only in Hindi.
- If the question is in Hinglish, answer in Hinglish.
- If the user explicitly requests a language, always follow that request.
- Never switch languages unless the user asks.
- Maintain the same tone and writing style as the user's input whenever appropriate.
- Do not mix English and Hindi unless the user's query mixes them.

You are also warm, natural, and conversational, running fully offline.

Personality rules:
- Be conversational and empathetic, like a helpful friend, not a robotic QA engine.
- Respond naturally to greetings, thanks, small talk, feelings, motivation requests, jokes, and stories, not just factual questions.
- If the user expresses stress, sadness, fear, or loneliness, respond with genuine warmth and support before offering suggestions.
- Keep answers natural and appropriately concise. Expand only when the user asks for more detail, and shorten when asked.

Honesty rules:
- If you don't know something or are not sure, say so plainly instead of inventing facts.
- Never make up dates, times, or events. If the current date/time is provided to you in this conversation, treat it as ground truth from the operating system and use it exactly.

Context rules:
- Pay attention to the ongoing conversation and resolve references like "continue", "explain again", "shorter", "expand", "give an example", or "translate that" using the previous turns.
"""


# ---------------------------------------
# Date / time handling (never trust the LLM for this)
# ---------------------------------------

_DATE_TIME_PATTERNS = [
    r"\btoday'?s date\b",
    r"\bcurrent date\b",
    r"\bwhat.?s the date\b",
    r"\bcurrent time\b",
    r"\bwhat.?s the time\b",
    r"\btime (right )?now\b",
    r"\bwhat day is it\b",
    r"\bwhich day is it\b",
    r"\bwhat month is it\b",
    r"\bwhich month\b",
    r"\bwhat year is it\b",
    r"\bwhich year\b",
    r"\baaj (ki|ka) (tareek|tarikh|date)\b",
    r"\baaj kaun sa (din|mahina|saal)\b",
    r"\baaj din kaun sa hai\b",
    r"\baaj ke time\b",
    r"\babhi kya time\b",
    r"\bkitne baje\b",
    r"\bkaunsa (mahina|saal)\b",
]
_DATE_TIME_RE = re.compile("|".join(_DATE_TIME_PATTERNS), re.IGNORECASE)

_HINDI_CHAR_RE = re.compile(r"[\u0900-\u097F]")
_HINGLISH_HINTS = re.compile(
    r"\b(kya|kaise|kaisa|kyu|kyun|hai|nahi|nahin|tum|aap|mujhe|mera|meri|"
    r"karo|kar|batao|acha|theek|haan|abhi|kaunsa|kaun)\b",
    re.IGNORECASE,
)


def is_datetime_query(text: str) -> bool:
    return bool(_DATE_TIME_RE.search(text or ""))


def detect_language(text: str) -> str:
    """Rough language detector: 'hindi', 'hinglish', or 'english'."""
    if _HINDI_CHAR_RE.search(text or ""):
        return "hindi"
    if _HINGLISH_HINTS.search(text or ""):
        return "hinglish"
    return "english"


def answer_datetime_query(text: str) -> str:
    """Answer date/time questions directly from the OS clock - never the LLM."""
    now = datetime.now()
    lang = detect_language(text)

    date_str = now.strftime("%A, %d %B %Y")
    time_str = now.strftime("%I:%M %p")

    if lang == "hindi":
        return f"Aaj ki date {date_str} hai aur abhi ka time {time_str} hai."
    if lang == "hinglish":
        return f"Aaj {date_str} hai, aur time abhi {time_str} hai."
    return f"Today is {date_str}, and the current time is {time_str}."


# ---------------------------------------
# Ollama call with conversation history
# ---------------------------------------

_LANG_REPLY_LABEL = {
    "hindi": "Hindi (Devanagari script)",
    "hinglish": "Hinglish (Romanized Hindi mixed with English)",
    "english": "English",
}


def _build_messages(history: list, user_text: str) -> list:
    now = datetime.now().strftime("%A, %d %B %Y, %I:%M %p")

    # The base rules in SYSTEM_PROMPT are sometimes not enough on their own
    # for a small local model to reliably follow, so we also detect the
    # language of THIS specific message and give a hard, explicit
    # instruction for it. This is just an extra enforcement layer on top of
    # the existing rules - it does not change what those rules say.
    turn_lang = detect_language(user_text)
    lang_label = _LANG_REPLY_LABEL[turn_lang]
    language_lock = (
        f"\n\nThe user's current message is written in {turn_lang.capitalize()}. "
        f"You MUST reply only in {lang_label} for this message. "
        "Do not switch to any other language unless the user explicitly asks you to "
        "reply in a different language."
    )

    system = (
        SYSTEM_PROMPT
        + f"\n\nCurrent real-world date and time (from the operating system, always accurate): {now}\n"
        + language_lock
    )

    messages = [{"role": "system", "content": system}]

    trimmed = history[-MAX_HISTORY_MESSAGES:] if history else []
    for turn in trimmed:
        role = turn.get("role")
        content = turn.get("content")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": user_text})
    return messages


def ask_llama(user_text: str, history: list | None = None) -> str:
    """
    user_text: the latest user message.
    history: list of {"role": "user"|"assistant", "content": str}, oldest first.
    """
    if not user_text or not user_text.strip():
        return "I didn't catch anything - could you say that again?"

    # Date/time questions are answered locally from the OS clock, never the LLM.
    if is_datetime_query(user_text):
        return answer_datetime_query(user_text)

    messages = _build_messages(history or [], user_text)

    last_error = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            response = requests.post(
                OLLAMA_CHAT_URL,
                json={
                    "model": MODEL_NAME,
                    "messages": messages,
                    "stream": False,
                },
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            data = response.json()
            content = (data.get("message") or {}).get("content", "").strip()
            if content:
                return content
            last_error = "empty response from model"
        except requests.exceptions.ConnectionError as e:
            last_error = f"Could not reach the local Ollama server: {e}"
        except requests.exceptions.Timeout as e:
            last_error = f"The model took too long to respond: {e}"
        except requests.exceptions.RequestException as e:
            last_error = f"Ollama request failed: {e}"
        except (ValueError, KeyError) as e:
            last_error = f"Unexpected response from Ollama: {e}"

        if attempt < MAX_RETRIES:
            time.sleep(RETRY_BACKOFF_SECONDS)

    # Never crash the backend because Ollama had one bad moment.
    return (
        "Sorry, I couldn't reach the local AI model right now "
        f"({last_error}). Please make sure Ollama is running and try again."
    )
