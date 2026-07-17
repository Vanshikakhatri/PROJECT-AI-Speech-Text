import { useEffect, useRef, useState } from "react";
import "./App.css";

const BACKEND_URL = "http://localhost:8000";

// Local models can take a while to generate, especially on CPU. Give
// requests a generous window instead of failing with "Failed to fetch"
// while the model is still working.
const REQUEST_TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes

// =============================
// Shared fetch helpers
// =============================

// Combines an optional caller-provided AbortSignal (used to let the Clear
// button cancel an in-flight request) with a timeout-based abort, so
// either one can cancel the request.
function createRequestController(externalSignal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException("Timed out", "TimeoutError"));
  }, REQUEST_TIMEOUT_MS);

  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason);
    else externalSignal.addEventListener("abort", onExternalAbort);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
    },
  };
}

function describeFetchError(err) {
  if (err?.name === "TimeoutError") {
    return "The model is taking longer than expected and the request timed out. It may still be working - please try again.";
  }
  if (err?.name === "AbortError") {
    return "Cancelled.";
  }
  if (err instanceof TypeError) {
    // What the browser throws for genuine network failures (backend down, CORS, offline).
    return "Couldn't reach the backend. Is it running?";
  }
  return err?.message || "Something went wrong.";
}

async function parseErrorMessage(response) {
  try {
    const data = await response.json();
    if (data && data.detail) return data.detail;
  } catch {
    // response body wasn't JSON, ignore
  }
  return `Request failed (${response.status})`;
}

async function fetchJSON(url, options = {}) {
  const { signal: externalSignal, ...rest } = options;
  const { signal, cleanup } = createRequestController(externalSignal);
  try {
    const response = await fetch(url, { ...rest, signal });
    if (!response.ok) {
      throw new Error(await parseErrorMessage(response));
    }
    return await response.json();
  } catch (err) {
    throw new Error(describeFetchError(err), { cause: err });
  } finally {
    cleanup();
  }
}

async function fetchBlob(url, options = {}) {
  const { signal: externalSignal, ...rest } = options;
  const { signal, cleanup } = createRequestController(externalSignal);
  try {
    const response = await fetch(url, { ...rest, signal });
    if (!response.ok) {
      throw new Error(await parseErrorMessage(response));
    }
    return await response.blob();
  } catch (err) {
    throw new Error(describeFetchError(err), { cause: err });
  } finally {
    cleanup();
  }
}

function extensionForMime(mime) {
  if (!mime) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("webm")) return "webm";
  return "mp3";
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// =============================
// Chat sidebar helpers (Card 3 only)
// =============================

// Auto-titles a chat from the first user message, e.g. "Explain Docker" stays
// as-is, while longer questions are trimmed to ~30 chars on a word boundary.
function deriveChatTitle(text, maxLen = 30) {
  const clean = (text || "").trim().replace(/\s+/g, " ");
  if (!clean) return "New Chat";
  if (clean.length <= maxLen) return clean;
  const truncated = clean.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  const base = lastSpace > 10 ? truncated.slice(0, lastSpace) : truncated;
  return `${base}…`;
}

// Pinned chats are a Card-3-only, UI-level concept (the backend/chat schema
// is untouched), so they're kept in localStorage under this key.
const PINNED_CHATS_STORAGE_KEY = "aiAssistant.pinnedChatIds";
const MAX_PINNED_CHATS = 3;

function loadPinnedChatIds() {
  try {
    const raw = localStorage.getItem(PINNED_CHATS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// =============================
// Small inline icon set (no external deps)
// =============================
const Icon = {
  Mic: (props) => (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3M9 21h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Stop: (props) => (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
    </svg>
  ),
  Speaker: (props) => (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  Copy: (props) => (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  Trash: (props) => (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Download: (props) => (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Replay: (props) => (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M4 4v5h5M20 20v-5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 15a7 7 0 1 0 1-9.5L4 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Send: (props) => (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M4 12 20 4l-6 16-3-7-7-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  ),
  Bot: (props) => (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="5" y="9" width="14" height="10" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 9V5m0 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM9 14v1M15 14v1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  Check: (props) => (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Clock: (props) => (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v4l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Edit: (props) => (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M4 20h4L19 9l-4-4L4 16v4Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Pin: (props) => (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M9 4h6l-.8 5.6 3.8 3.8v1.6h-6.5V21l-1 2-1-2v-6h-6.5v-1.6l3.8-3.8L9 4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  ),
  Plus: (props) => (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
};

function createRipple(event) {
  const button = event.currentTarget;
  const rect = button.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const ripple = document.createElement("span");
  ripple.className = "ripple";
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
  button.appendChild(ripple);
  setTimeout(() => ripple.remove(), 650);
}

function Waveform({ active }) {
  const bars = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  return (
    <div className={`waveform ${active ? "waveform-active" : ""}`} aria-hidden="true">
      {bars.map((i) => (
        <span key={i} className="waveform-bar" style={{ animationDelay: `${i * 0.08}s` }} />
      ))}
    </div>
  );
}

function App() {
  // -----------------------------
  // Speech ↔ Text Converter
  // -----------------------------
  const [speechText, setSpeechText] = useState("");
  const [sttRecording, setSttRecording] = useState(false);
  const [sttStatus, setSttStatus] = useState("");
  const [sttError, setSttError] = useState("");
  const [sttSpeaking, setSttSpeaking] = useState(false);
  const [sttSuccess, setSttSuccess] = useState(false);
  const [sttCopied, setSttCopied] = useState(false);

  const sttRecorderRef = useRef(null);
  const sttStreamRef = useRef(null);
  const sttChunksRef = useRef([]);

  // -----------------------------
  // Text to Speech (standalone card)
  // -----------------------------
  const [ttsText, setTtsText] = useState("");
  const [ttsSpeaking, setTtsSpeaking] = useState(false);
  const [ttsError, setTtsError] = useState("");
  const [ttsAudioUrl, setTtsAudioUrl] = useState(null);
  const [ttsAudioExt, setTtsAudioExt] = useState("wav");
  const ttsAudioRef = useRef(null);
  const ttsObjectUrlRef = useRef(null);

  // -----------------------------
  // AI Voice Assistant
  // -----------------------------
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [answerTime, setAnswerTime] = useState(null);
  const [aiRecording, setAiRecording] = useState(false);
  const [aiStatus, setAiStatus] = useState("");
  const [aiError, setAiError] = useState("");
  const [sending, setSending] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [aiCopied, setAiCopied] = useState(false);

  const aiRecorderRef = useRef(null);
  const aiStreamRef = useRef(null);
  const aiChunksRef = useRef([]);
  // Holds the AbortController for whatever /chat or /voice-chat request is
  // currently in flight, so the Clear button can always cancel it.
  const aiRequestControllerRef = useRef(null);

  // -----------------------------
  // Chat History (Card 3)
  // -----------------------------
  const [chats, setChats] = useState([]);
  const [chatsError, setChatsError] = useState("");
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState([]); // [{id, role, content}]
  const [historyLoading, setHistoryLoading] = useState(false);
  const [renamingChatId, setRenamingChatId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  // Pinned chats + the mobile sidebar open/close toggle are local-only,
  // persisted to localStorage (see PINNED_CHATS_STORAGE_KEY above).
  const [pinnedIds, setPinnedIds] = useState(loadPinnedChatIds);
  const [pinError, setPinError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (ttsObjectUrlRef.current) URL.revokeObjectURL(ttsObjectUrlRef.current);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PINNED_CHATS_STORAGE_KEY, JSON.stringify(pinnedIds));
    } catch {
      // localStorage may be unavailable (private browsing, quota) - safe to ignore
    }
  }, [pinnedIds]);

  const refreshChatList = async () => {
    try {
      const data = await fetchJSON(`${BACKEND_URL}/chats`);
      setChats(data.chats || []);
      setChatsError("");
    } catch (err) {
      setChatsError(err.message || "Couldn't load chat history.");
    }
  };

  // Load the chat list once on startup so History is populated immediately.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    refreshChatList();
  }, []);

  const openChat = async (chatId) => {
    setHistoryLoading(true);
    setAiError("");
    try {
      const data = await fetchJSON(`${BACKEND_URL}/chats/${chatId}`);
      setActiveChatId(chatId);
      setMessages(
        (data.messages || []).map((m) => ({ id: m.id, role: m.role, content: m.content }))
      );
      setAnswer("");
      setAnswerTime(null);
      setQuestion("");
    } catch (err) {
      setAiError(err.message || "Couldn't open that chat.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const startNewChat = () => {
    setActiveChatId(null);
    setMessages([]);
    setQuestion("");
    setAnswer("");
    setAnswerTime(null);
    setAiError("");
  };

  const deleteChatById = async (chatId, e) => {
    e?.stopPropagation();
    try {
      await fetchJSON(`${BACKEND_URL}/chats/${chatId}`, { method: "DELETE" });
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      setPinnedIds((prev) => prev.filter((id) => id !== chatId));
      if (chatId === activeChatId) startNewChat();
    } catch (err) {
      setChatsError(err.message || "Couldn't delete that chat.");
    }
  };

  // Pin/unpin a conversation. Capped at MAX_PINNED_CHATS; trying to pin a
  // 4th chat surfaces a message asking the user to unpin one first instead
  // of silently failing or bumping an existing pin.
  const togglePinChat = (chatId, e) => {
    e?.stopPropagation();
    setPinError("");
    setPinnedIds((prev) => {
      if (prev.includes(chatId)) {
        return prev.filter((id) => id !== chatId);
      }
      if (prev.length >= MAX_PINNED_CHATS) {
        setPinError(`You can only pin up to ${MAX_PINNED_CHATS} chats. Unpin one first.`);
        return prev;
      }
      return [...prev, chatId];
    });
  };

  const beginRenameChat = (chat, e) => {
    e?.stopPropagation();
    setRenamingChatId(chat.id);
    setRenameValue(chat.title);
  };

  const submitRenameChat = async (chatId) => {
    const title = renameValue.trim();
    setRenamingChatId(null);
    if (!title) return;
    try {
      await fetchJSON(`${BACKEND_URL}/chats/${chatId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title } : c)));
    } catch (err) {
      setChatsError(err.message || "Couldn't rename that chat.");
    }
  };

  // =============================
  // Play speech (used by STT card's "Convert to Speech")
  // =============================
  const playSpeech = async (text, setSpeaking, setError) => {
    if (!text || !text.trim()) {
      setError("There's no text to convert to speech yet.");
      return;
    }

    setError("");
    setSpeaking(true);

    try {
      const blob = await fetchBlob(`${BACKEND_URL}/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (err) {
      setError(err.message || "Unable to play speech.");
    } finally {
      setSpeaking(false);
    }
  };

  // =============================
  // Generic microphone recording helper
  // =============================
  const beginRecording = async ({
    streamRef,
    recorderRef,
    chunksRef,
    setRecording,
    setStatus,
    setError,
    recordingLabel,
    onStop,
  }) => {
    setError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await onStop(blob);
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setStatus(recordingLabel);
    } catch {
      setError("Microphone access was denied or is unavailable.");
      setRecording(false);
      setStatus("");
    }
  };

  const endRecording = (recorderRef, setRecording) => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    setRecording(false);
  };

  // =============================
  // Speech → Text (Card 1)
  // =============================
  const startSpeechRecording = () => {
    setSttSuccess(false);
    beginRecording({
      streamRef: sttStreamRef,
      recorderRef: sttRecorderRef,
      chunksRef: sttChunksRef,
      setRecording: setSttRecording,
      setStatus: setSttStatus,
      setError: setSttError,
      recordingLabel: "Recording...",
      onStop: async (blob) => {
        setSttStatus("Transcribing...");

        try {
          const formData = new FormData();
          formData.append("file", blob, "audio.webm");

          const data = await fetchJSON(`${BACKEND_URL}/transcribe`, {
            method: "POST",
            body: formData,
          });

          setSpeechText(data.text || "");
          setSttSuccess(true);
          setTimeout(() => setSttSuccess(false), 3200);
        } catch (err) {
          setSttError(err.message || "Transcription failed. Please try again.");
        } finally {
          setSttStatus("");
        }
      },
    });
  };

  const stopSpeechRecording = () => {
    endRecording(sttRecorderRef, setSttRecording);
  };

  const clearSpeechText = () => {
    setSpeechText("");
    setSttError("");
    setSttSuccess(false);
  };

  const copySpeechText = async () => {
    if (!speechText.trim()) return;
    try {
      await navigator.clipboard.writeText(speechText);
      setSttCopied(true);
      setTimeout(() => setSttCopied(false), 1800);
    } catch {
      setSttError("Couldn't copy to clipboard.");
    }
  };

  // =============================
  // Text → Speech (Card 2, standalone)
  // =============================
  const speakTtsText = async () => {
    if (!ttsText.trim()) {
      setTtsError("Type something to convert to speech first.");
      return;
    }

    setTtsError("");
    setTtsSpeaking(true);

    try {
      const blob = await fetchBlob(`${BACKEND_URL}/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: ttsText }),
      });

      if (ttsObjectUrlRef.current) URL.revokeObjectURL(ttsObjectUrlRef.current);
      const url = URL.createObjectURL(blob);
      ttsObjectUrlRef.current = url;
      setTtsAudioExt(extensionForMime(blob.type));
      setTtsAudioUrl(url);

      requestAnimationFrame(() => {
        ttsAudioRef.current?.play().catch(() => {});
      });
    } catch (err) {
      setTtsError(err.message || "Unable to generate speech.");
    } finally {
      setTtsSpeaking(false);
    }
  };

  const replayTts = () => {
    if (!ttsAudioRef.current) return;
    ttsAudioRef.current.currentTime = 0;
    ttsAudioRef.current.play().catch(() => {});
  };

  const clearTts = () => {
    setTtsText("");
    setTtsError("");
    if (ttsObjectUrlRef.current) {
      URL.revokeObjectURL(ttsObjectUrlRef.current);
      ttsObjectUrlRef.current = null;
    }
    setTtsAudioUrl(null);
  };

  // =============================
  // Chat (Typed) — Card 3
  // =============================
  // Ensures there's a chat to attach messages to, creating one on first
  // send (auto-titled from the question) so history "just works" without
  // requiring the user to press "New Chat" first.
  const ensureActiveChat = async (titleSeed) => {
    if (activeChatId) return activeChatId;
    const created = await fetchJSON(`${BACKEND_URL}/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: deriveChatTitle(titleSeed) }),
    });
    setActiveChatId(created.id);
    setChats((prev) => [created, ...prev]);
    return created.id;
  };

  const sendQuestion = async () => {
    if (!question.trim() || sending) return;

    const askedText = question;
    setSending(true);
    setAiError("");
    setAiStatus("Thinking...");

    const controller = new AbortController();
    aiRequestControllerRef.current = controller;

    try {
      const chatId = await ensureActiveChat(askedText);
      setMessages((prev) => [...prev, { role: "user", content: askedText }]);

      const data = await fetchJSON(`${BACKEND_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: askedText, chat_id: chatId }),
        signal: controller.signal,
      });

      setAnswer(data.answer || "");
      setAnswerTime(new Date());
      setMessages((prev) => [...prev, { role: "assistant", content: data.answer || "" }]);
      setQuestion("");
      refreshChatList();
    } catch (err) {
      setAiError(err.message || "Chat failed. Please try again.");
    } finally {
      setSending(false);
      setAiStatus("");
      aiRequestControllerRef.current = null;
    }
  };

  // =============================
  // Voice Chat — Card 3
  // =============================
  const startVoiceAssistant = () => {
    beginRecording({
      streamRef: aiStreamRef,
      recorderRef: aiRecorderRef,
      chunksRef: aiChunksRef,
      setRecording: setAiRecording,
      setStatus: setAiStatus,
      setError: setAiError,
      recordingLabel: "Recording...",
      onStop: async (blob) => {
        setAiStatus("Transcribing & thinking...");
        setSending(true);

        const controller = new AbortController();
        aiRequestControllerRef.current = controller;

        try {
          const chatId = await ensureActiveChat("Voice question");

          const formData = new FormData();
          formData.append("file", blob, "audio.webm");

          const data = await fetchJSON(
            `${BACKEND_URL}/voice-chat?chat_id=${encodeURIComponent(chatId)}`,
            {
              method: "POST",
              body: formData,
              signal: controller.signal,
            }
          );

          setQuestion("");
          setAnswer(data.answer || "");
          setAnswerTime(new Date());
          setMessages((prev) => [
            ...prev,
            { role: "user", content: data.text || "" },
            { role: "assistant", content: data.answer || "" },
          ]);
          refreshChatList();
        } catch (err) {
          setAiError(err.message || "Voice assistant failed. Please try again.");
        } finally {
          setAiStatus("");
          setSending(false);
          aiRequestControllerRef.current = null;
        }
      },
    });
  };

  const stopVoiceAssistant = () => {
    endRecording(aiRecorderRef, setAiRecording);
  };

  // Clear must always work — even mid-request, after a timeout, or after a
  // backend/Ollama error — without needing a page refresh. It cancels
  // whatever request is in flight and resets the visible state; it does
  // NOT delete the saved chat (use the trash icon in History for that).
  const clearAiCard = () => {
    if (aiRequestControllerRef.current) {
      aiRequestControllerRef.current.abort();
      aiRequestControllerRef.current = null;
    }
    if (aiRecording) {
      try {
        endRecording(aiRecorderRef, setAiRecording);
      } catch {
        // recorder may already be stopped/broken - state reset below covers it
      }
    }
    setQuestion("");
    setAnswer("");
    setAiError("");
    setAnswerTime(null);
    setAiStatus("");
    setSending(false);
  };

  const copyAnswer = async () => {
    if (!answer.trim()) return;
    try {
      await navigator.clipboard.writeText(answer);
      setAiCopied(true);
      setTimeout(() => setAiCopied(false), 1800);
    } catch {
      setAiError("Couldn't copy to clipboard.");
    }
  };

  // =============================
  // Derived UI state
  // =============================
  const sttTranscribing = sttStatus === "Transcribing...";
  const aiTranscribing = aiStatus === "Transcribing & thinking...";
  const aiBusy = sending || aiTranscribing;

  const pinnedChats = chats.filter((c) => pinnedIds.includes(c.id));
  const unpinnedChats = chats.filter((c) => !pinnedIds.includes(c.id));

  // Shared row renderer so the Pinned and All-chats sections in the Card 3
  // sidebar stay in sync (rename/delete/pin all work the same in both).
  const renderChatItem = (c) => (
    <li
      key={c.id}
      className={`history-item ${c.id === activeChatId ? "history-item-active" : ""}`}
      onClick={() => openChat(c.id)}
    >
      {renamingChatId === c.id ? (
        <input
          className="history-rename-input"
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => submitRenameChat(c.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitRenameChat(c.id);
            if (e.key === "Escape") setRenamingChatId(null);
          }}
        />
      ) : (
        <span className="history-item-title">{c.title}</span>
      )}
      <span className="history-item-actions">
        <button
          type="button"
          className={`icon-btn icon-btn-xs ${pinnedIds.includes(c.id) ? "icon-btn-active" : ""}`}
          onClick={(e) => togglePinChat(c.id, e)}
          aria-label={pinnedIds.includes(c.id) ? "Unpin chat" : "Pin chat"}
          title={pinnedIds.includes(c.id) ? "Unpin" : "Pin"}
        >
          <Icon.Pin className="icon-btn-svg" />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn-xs"
          onClick={(e) => beginRenameChat(c, e)}
          aria-label="Rename chat"
          title="Rename"
        >
          <Icon.Edit className="icon-btn-svg" />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn-xs"
          onClick={(e) => deleteChatById(c.id, e)}
          aria-label="Delete chat"
          title="Delete"
        >
          <Icon.Trash className="icon-btn-svg" />
        </button>
      </span>
    </li>
  );

  // =============================
  // UI
  // =============================
  return (
    <div className="app">
      <div className="app-backdrop" aria-hidden="true">
        <span className="blob blob-a" />
        <span className="blob blob-b" />
        <span className="blob blob-c" />
      </div>

      <header className="app-header">
        <div className="app-eyebrow">Voice &amp; Language</div>
        <h1 className="app-title">AI Speech Assistant</h1>
        <p className="app-subtitle">Speak it, read it, ask it — one console for your voice AI stack.</p>
      </header>

      <main className="cards-grid">
        {/* ================================= */}
        {/* CARD 1 — Speech to Text */}
        {/* ================================= */}
        <section className="card card-glass">
          <div className="card-head">
            <div className="card-head-icon icon-cyan">
              <Icon.Mic className="card-head-svg" />
            </div>
            <div>
              <h2 className="card-title">Speech to Text</h2>
              <p className="card-desc">Record your voice and get an instant transcript.</p>
            </div>
          </div>

          <div className="mic-stage">
            <Waveform active={sttRecording} />
            <p className={`mic-status ${sttRecording ? "mic-status-live" : ""}`}>
              {sttRecording ? (
                <>
                  <span className="live-dot" /> Recording…
                </>
              ) : sttTranscribing ? (
                "Transcribing…"
              ) : (
                "Tap record and start speaking"
              )}
            </p>
          </div>

          <div className="button-row">
            <button
              type="button"
              className={`btn btn-primary btn-lg ${sttRecording ? "btn-danger" : ""}`}
              onMouseDown={createRipple}
              onClick={sttRecording ? stopSpeechRecording : startSpeechRecording}
              disabled={sttTranscribing || sttSpeaking}
            >
              {sttRecording ? (
                <>
                  <Icon.Stop className="btn-icon" /> Stop
                </>
              ) : (
                <>
                  <Icon.Mic className="btn-icon" /> Record
                </>
              )}
            </button>
          </div>

          {sttError && <p className="inline-alert inline-alert-error">{sttError}</p>}

          {sttSuccess && (
            <p className="inline-alert inline-alert-success">
              <Icon.Check className="inline-alert-icon" /> Transcribed successfully
            </p>
          )}

          <div className="field-block">
            <textarea
              className="textarea"
              rows="7"
              value={speechText}
              onChange={(e) => setSpeechText(e.target.value)}
              placeholder="Your transcript will appear here — feel free to edit it before converting back to speech."
              disabled={sttRecording}
            />
            <div className="field-footer">
              <span className="char-count">{speechText.length} characters</span>
              <div className="field-footer-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onMouseDown={createRipple}
                  onClick={copySpeechText}
                  disabled={!speechText.trim()}
                >
                  <Icon.Copy className="btn-icon-sm" /> {sttCopied ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onMouseDown={createRipple}
                  onClick={clearSpeechText}
                  disabled={sttRecording || sttTranscribing || sttSpeaking || !speechText.trim()}
                >
                  <Icon.Trash className="btn-icon-sm" /> Clear
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-gradient btn-full"
            onMouseDown={createRipple}
            onClick={() => playSpeech(speechText, setSttSpeaking, setSttError)}
            disabled={sttSpeaking || sttRecording || sttTranscribing || !speechText.trim()}
          >
            {sttSpeaking ? (
              <>
                <span className="spinner" /> Generating speech…
              </>
            ) : (
              <>
                <Icon.Speaker className="btn-icon" /> Convert to Speech
              </>
            )}
          </button>
        </section>

        {/* ================================= */}
        {/* CARD 2 — Text to Speech */}
        {/* ================================= */}
        <section className="card card-glass">
          <div className="card-head">
            <div className="card-head-icon icon-purple">
              <Icon.Speaker className="card-head-svg" />
            </div>
            <div>
              <h2 className="card-title">Text to Speech</h2>
              <p className="card-desc">Turn any text into natural-sounding audio.</p>
            </div>
          </div>

          <div className="field-block">
            <textarea
              className="textarea textarea-lg"
              rows="8"
              value={ttsText}
              onChange={(e) => setTtsText(e.target.value)}
              placeholder="Type or paste text here — e.g. “Welcome to your AI speech assistant, ready whenever you are.”"
            />
            <div className="field-footer">
              <span className="char-count">{ttsText.length} characters</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onMouseDown={createRipple}
                onClick={clearTts}
                disabled={ttsSpeaking || (!ttsText.trim() && !ttsAudioUrl)}
              >
                <Icon.Trash className="btn-icon-sm" /> Clear
              </button>
            </div>
          </div>

          {ttsError && <p className="inline-alert inline-alert-error">{ttsError}</p>}

          <button
            type="button"
            className="btn btn-gradient btn-full"
            onMouseDown={createRipple}
            onClick={speakTtsText}
            disabled={ttsSpeaking || !ttsText.trim()}
          >
            {ttsSpeaking ? (
              <>
                <span className="spinner" /> Generating speech…
              </>
            ) : (
              <>
                <Icon.Speaker className="btn-icon" /> Speak
              </>
            )}
          </button>

          {ttsAudioUrl ? (
            <div className="audio-player fade-in">
              <audio ref={ttsAudioRef} src={ttsAudioUrl} controls className="audio-el" />
              <div className="audio-actions">
                <button type="button" className="btn btn-ghost btn-sm" onMouseDown={createRipple} onClick={replayTts}>
                  <Icon.Replay className="btn-icon-sm" /> Replay
                </button>
                <a
                  className="btn btn-ghost btn-sm"
                  href={ttsAudioUrl}
                  download={`speech-output.${ttsAudioExt}`}
                  onMouseDown={createRipple}
                >
                  <Icon.Download className="btn-icon-sm" /> Download
                </a>
              </div>
            </div>
          ) : (
            <div className="audio-placeholder">
              <Icon.Speaker className="audio-placeholder-icon" />
              <p>Your generated audio will appear here</p>
            </div>
          )}
        </section>

        {/* ================================= */}
        {/* CARD 3 — AI Voice Assistant */}
        {/* ================================= */}
        <section className="card card-glass card-assistant">
          <div className="card-head card-head-center">
            <div className="card-head-icon icon-blue">
              <Icon.Bot className="card-head-svg" />
            </div>
            <div>
              <h2 className="card-title">AI Voice Assistant</h2>
              <p className="card-desc">Ask by typing or speaking — get a spoken answer back.</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm history-toggle"
              onMouseDown={createRipple}
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="Toggle chat history"
              title="Chat history"
            >
              <Icon.Clock className="btn-icon-sm" /> Chats
            </button>
          </div>

          <div className="assistant-layout">
            {/* ChatGPT-style sidebar — Card 3 only */}
            <aside className={`assistant-sidebar ${sidebarOpen ? "assistant-sidebar-open" : ""}`}>
              <button
                type="button"
                className="btn btn-gradient btn-sm btn-full"
                onMouseDown={createRipple}
                onClick={() => {
                  startNewChat();
                  setSidebarOpen(false);
                }}
              >
                <Icon.Plus className="btn-icon-sm" /> New Chat
              </button>

              {chatsError && <p className="inline-alert inline-alert-error">{chatsError}</p>}
              {pinError && <p className="inline-alert inline-alert-error">{pinError}</p>}
              {historyLoading && <p className="history-loading">Loading chat…</p>}

              {pinnedChats.length > 0 && (
                <div className="sidebar-section">
                  <p className="sidebar-section-title">Pinned</p>
                  <ul className="history-list">{pinnedChats.map(renderChatItem)}</ul>
                </div>
              )}

              <div className="sidebar-section">
                <p className="sidebar-section-title">Chats</p>
                <ul className="history-list">
                  {chats.length === 0 && <li className="history-empty">No saved chats yet.</li>}
                  {chats.length > 0 && unpinnedChats.length === 0 && (
                    <li className="history-empty">No other chats.</li>
                  )}
                  {unpinnedChats.map(renderChatItem)}
                </ul>
              </div>
            </aside>

            <div className="assistant-main">
          <div className="assistant-inner">
          <div className="assistant-input">
            <textarea
              className="textarea"
              rows="3"
              value={question}
              placeholder="Ask anything…"
              onChange={(e) => setQuestion(e.target.value)}
              disabled={aiRecording}
            />
            <div className="button-row">
              <button
                type="button"
                className="btn btn-gradient"
                onMouseDown={createRipple}
                onClick={sendQuestion}
                disabled={aiBusy || aiRecording || !question.trim()}
              >
                {sending ? (
                  <>
                    <span className="spinner" /> Thinking…
                  </>
                ) : (
                  <>
                    <Icon.Send className="btn-icon" /> Send
                  </>
                )}
              </button>

              <button
                type="button"
                className={`btn btn-primary ${aiRecording ? "btn-danger" : ""}`}
                onMouseDown={createRipple}
                onClick={aiRecording ? stopVoiceAssistant : startVoiceAssistant}
                disabled={sending || aiSpeaking}
              >
                {aiRecording ? (
                  <>
                    <Icon.Stop className="btn-icon" /> Stop
                  </>
                ) : (
                  <>
                    <Icon.Mic className="btn-icon" /> Record Question
                  </>
                )}
              </button>

              <button
                type="button"
                className="btn btn-ghost"
                onMouseDown={createRipple}
                onClick={clearAiCard}
              >
                <Icon.Trash className="btn-icon-sm" /> Clear
              </button>
            </div>

            {aiRecording && <Waveform active={aiRecording} />}
            {aiError && <p className="inline-alert inline-alert-error">{aiError}</p>}
          </div>

          {messages.length > 1 && (
            <div className="conversation-thread">
              {messages.slice(0, -1).map((m, idx) => (
                <div key={m.id || idx} className={`thread-msg thread-msg-${m.role}`}>
                  <span className="thread-msg-role">{m.role === "user" ? "You" : "Assistant"}</span>
                  <p className="thread-msg-text">{m.content}</p>
                </div>
              ))}
            </div>
          )}

          <div className="answer-card">
            {aiBusy ? (
              <div className="typing-indicator">
                <span />
                <span />
                <span />
                <span className="typing-label">{aiStatus || "Thinking…"}</span>
              </div>
            ) : answer ? (
              <div className="answer-body fade-in">
                <p className="answer-text">{answer}</p>
                <div className="answer-meta">
                  {answerTime && <span className="answer-time">{formatTime(answerTime)}</span>}
                  <div className="answer-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      onMouseDown={createRipple}
                      onClick={() => playSpeech(answer, setAiSpeaking, setAiError)}
                      disabled={aiSpeaking || aiBusy || aiRecording}
                      aria-label="Read answer aloud"
                      title="Read answer aloud"
                    >
                      {aiSpeaking ? <span className="spinner spinner-sm" /> : <Icon.Speaker className="icon-btn-svg" />}
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onMouseDown={createRipple}
                      onClick={copyAnswer}
                      aria-label="Copy answer"
                      title="Copy answer"
                    >
                      {aiCopied ? <Icon.Check className="icon-btn-svg" /> : <Icon.Copy className="icon-btn-svg" />}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="answer-placeholder">Your assistant's answer will appear here.</p>
            )}
          </div>
          </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
