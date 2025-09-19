from whisper_live.client import TranscriptionClient
client = TranscriptionClient(
  "100.88.83.27",
  9090,
  lang="en",
  translate=False,
  model="turbo",                                      # also support hf_model => `Systran/faster-whisper-small`
  use_vad=True,
  save_output_recording=False,                         # Only used for microphone input, False by Default
  output_recording_filename="./output_recording.wav", # Only used for microphone input
  mute_audio_playback=True,                          # Only used for file input, False by Default
#   enable_translation=True,
#   target_language="zh",
)
client()