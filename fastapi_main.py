from fastapi import FastAPI
from fastapi.responses import FileResponse
import os

app = FastAPI()

@app.get("/")
def read_root():
    if os.path.exists("index.html"):
        return FileResponse("index.html", media_type="text/html")
    else:
        return {"error": "index.html not found"}

@app.get("/whisperlive-client-standalone.js")
def read_whisperlive_client_standalone():
    if os.path.exists("whisperlive-client-standalone.js"):
        return FileResponse("whisperlive-client-standalone.js", media_type="text/javascript")
    else:
        return {"error": "whisperlive-client-standalone.js not found"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001, ssl_keyfile="key.pem", ssl_certfile="cert.pem")