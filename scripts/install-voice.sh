#!/usr/bin/env bash
# Installe ce qu'il faut pour les vocaux : ffmpeg + whisper.cpp + modèle « small » (multilingue, ~470 Mo).
# Lancé depuis l'app (Réglages vocaux → Installer) ou à la main : bash scripts/install-voice.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 NONINTERACTIVE=1

if ! command -v brew >/dev/null 2>&1; then
  echo "ERROR: Homebrew no está instalado en este Mac."
  echo "Instálalo una vez en la Terminal (te pedirá la contraseña de tu Mac):"
  echo '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  echo "y luego vuelve a hacer clic en Instalar."
  exit 2
fi

step() { echo "PASO: $*"; } # préfixes PASO:/ERROR:/OK: lus par l'écran d'installation (VoiceSetup)
step "ffmpeg"
if command -v ffmpeg >/dev/null 2>&1 || [ -x "$HOME/.local/bin/ffmpeg" ]; then echo "ffmpeg ya está instalado"; else brew install ffmpeg || { echo "ERROR: falló brew install ffmpeg"; exit 3; }; fi
step "whisper-cpp"
if brew list whisper-cpp >/dev/null 2>&1; then echo "whisper-cpp ya está instalado"; else brew install whisper-cpp || { echo "ERROR: falló brew install whisper-cpp"; exit 4; }; fi

step "modelo de reconocimiento (≈470 MB)"
mkdir -p "$ROOT/models"
MODEL="$ROOT/models/ggml-small.bin"
if [ -s "$MODEL" ] && [ "$(stat -f%z "$MODEL" 2>/dev/null || stat -c%s "$MODEL")" -gt 400000000 ]; then
  echo "el modelo ya está"
else
  curl -fL --retry 3 -o "$MODEL.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" 2>&1 | tr '\r' '\n' | awk 'NR%40==0'
  if [ -s "$MODEL.part" ]; then mv "$MODEL.part" "$MODEL"; else echo "ERROR: no se pudo descargar el modelo"; exit 5; fi
fi

step "verificación"
BIN="$(command -v whisper-cli || command -v whisper-cpp || true)"
if [ -z "$BIN" ]; then echo "ERROR: whisper está instalado pero no se encuentra"; exit 6; fi
echo "OK: mensajes de voz listos ($BIN)"
