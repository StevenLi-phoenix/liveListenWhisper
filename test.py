import whisper

model = whisper.load_model("turbo")
result = model.transcribe("input.wav", verbose=True)
print(result["text"])
with open("output.txt", "w") as f:
    f.write(result["text"])