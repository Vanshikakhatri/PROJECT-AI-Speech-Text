FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
# ffmpeg is required by Whisper for audio decoding. Piper TTS is pure
# Python + onnxruntime and bundles its own espeak-ng data, so (unlike the
# old pyttsx3-based TTS) no system espeak/libespeak packages are needed.
RUN apt-get update && \
    apt-get install -y ffmpeg git && \
    rm -rf /var/lib/apt/lists/*

# Copy requirements first (better Docker caching)
COPY requirements.txt .

# Install CPU-only PyTorch
RUN pip install --no-cache-dir \
    --index-url https://download.pytorch.org/whl/cpu \
    torch

# Install remaining Python packages
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY . .

# Expose FastAPI port
EXPOSE 8000

# Start FastAPI
# --timeout-keep-alive is raised so slow local-model responses (several
# minutes) don't get the connection dropped mid-generation.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-keep-alive", "620"]