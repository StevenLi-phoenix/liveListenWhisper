import inspect
import warnings

from whisper_live.client import TranscriptionClient


def _build_client(
  host: str = "100.88.83.27",
  port: int = 9090,
  *,
  model_name: str = "turbo",
  lang: str = "en",
  translate: bool = False,
  use_vad: bool = True,
  save_output_recording: bool = False,
  output_recording_filename: str = "./output_recording.wav",
  mute_audio_playback: bool = True,
):
  """Create a TranscriptionClient while staying compatible with multiple library versions."""

  client_kwargs = {
    "lang": lang,
    "translate": translate,
    "use_vad": use_vad,
    "save_output_recording": save_output_recording,
    "output_recording_filename": output_recording_filename,
    "mute_audio_playback": mute_audio_playback,
  }

  init_params = inspect.signature(TranscriptionClient.__init__).parameters
  for candidate in ("model", "model_name", "model_size", "hf_model"):
    if candidate in init_params:
      client_kwargs[candidate] = model_name
      break
  else:
    warnings.warn(
      "This version of whisper-live ignores the configured model because the "
      "TranscriptionClient constructor does not expose a model-related parameter.",
      RuntimeWarning,
      stacklevel=2,
    )

  return TranscriptionClient(host, port, **client_kwargs)


client = _build_client()
client()
