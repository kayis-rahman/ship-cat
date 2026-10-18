import sys
from pathlib import Path

import mlx_whisper

audio_path = Path(sys.argv[1])
model_path = Path(sys.argv[2])
if not audio_path.is_file() or not model_path.is_dir():
    raise SystemExit(2)
result = mlx_whisper.transcribe(str(audio_path), path_or_hf_repo=str(model_path))
transcript = result.get("text", "").strip()
if not transcript:
    raise SystemExit(3)
sys.stdout.write(transcript)
