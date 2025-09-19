from whisper_live.client import TranscriptionClient
import argparse
import os
import pyautogui



def parse_args():
  parser = argparse.ArgumentParser()
  parser.add_argument("--lang", type=str, default="en")
  parser.add_argument("--model", type=str, default="turbo")
  parser.add_argument("--use_vad", type=bool, default=True, action="store_true")
  parser.add_argument("--host", type=str, default="100.88.83.27")
  parser.add_argument("--port", type=int, default=9090)

  args = parser.parse_args()

  assert args.lang, "lang is required"
  assert args.model, "model is required"
  assert args.use_vad, "use_vad is required"
  assert args.host, "host is required"
  assert args.port, "port is required"
  
  return args

args = parse_args()

client = TranscriptionClient(
  args.host,
  args.port,
  lang=args.lang,
  translate=False,
  model=args.model,                                      # also support hf_model => `Systran/faster-whisper-small`
  use_vad=args.use_vad,
  save_output_recording=False,                         # Only used for microphone input, False by Default
  output_recording_filename="./output_recording.wav", # Only used for microphone input
  mute_audio_playback=True,                          # Only used for file input, False by Default
)
client()
