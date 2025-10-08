import argparse
import os
import pyautogui
import inspect
import warnings

from whisper_live.client import TranscriptionClient



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


def build_client_from_args(cli_args: argparse.Namespace) -> TranscriptionClient:
  """Instantiate TranscriptionClient while matching available constructor keywords."""

  client_kwargs = {
    "lang": cli_args.lang,
    "translate": False,
    "use_vad": cli_args.use_vad,
    "save_output_recording": False,
    "output_recording_filename": "./output_recording.wav",
    "mute_audio_playback": True,
  }

  init_params = inspect.signature(TranscriptionClient.__init__).parameters
  for candidate in ("model", "model_name", "model_size", "hf_model"):
    if candidate in init_params:
      client_kwargs[candidate] = cli_args.model
      break
  else:
    warnings.warn(
      "This version of whisper-live ignores --model because there is no supported "
      "constructor parameter.",
      RuntimeWarning,
      stacklevel=2,
    )

  return TranscriptionClient(cli_args.host, cli_args.port, **client_kwargs)


client = build_client_from_args(args)
client()
