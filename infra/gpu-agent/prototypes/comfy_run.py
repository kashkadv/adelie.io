"""Runs an API-format ComfyUI workflow and reports time and output files.
env PROGRESS_FILE: follow the run over ComfyUI's websocket and keep {"value", "max"} of the sampling steps in that file
(the GPU agent reads it to show live progress in Adelie); without it, or if the websocket fails, plain polling."""
import asyncio, json, os, sys, time, urllib.request, uuid

BASE = "http://127.0.0.1:8188"


def post(path, data):
    req = urllib.request.Request(BASE + path, json.dumps(data).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))


def get(path):
    return json.load(urllib.request.urlopen(BASE + path))


def write_progress(path, value, maximum):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"value": value, "max": maximum, "at": time.time()}, f)
    os.replace(tmp, path)


async def run_followed(wf, client, path):
    """Connects first (no step is missed), then queues the prompt and follows its steps until it finishes."""
    import aiohttp
    async with aiohttp.ClientSession() as s:
        async with s.ws_connect(f"{BASE.replace('http', 'ws')}/ws?clientId={client}", heartbeat=20) as ws:
            pid = QUEUED["pid"] = post("/prompt", {"prompt": wf, "client_id": client})["prompt_id"]
            async for msg in ws:
                if msg.type != aiohttp.WSMsgType.TEXT:
                    continue
                m = json.loads(msg.data); d = m.get("data") or {}
                if d.get("prompt_id") not in (None, pid):
                    continue
                if m.get("type") == "progress":
                    write_progress(path, d.get("value", 0), d.get("max", 1))
                elif m.get("type") == "executing" and d.get("node") is None and d.get("prompt_id") == pid:
                    break
                elif m.get("type") in ("execution_error", "execution_interrupted", "execution_success"):
                    break
            return pid


QUEUED = {"pid": None}   # set as soon as the prompt is queued: a websocket failure later must not queue it twice
wf = json.load(open(sys.argv[1]))
t0 = time.time()
progress_file = os.environ.get("PROGRESS_FILE")
client = str(uuid.uuid4())
pid = None
if progress_file:
    try:
        pid = asyncio.run(asyncio.wait_for(run_followed(wf, client, progress_file), timeout=1800))
    except Exception as e:                       # fall back to polling below
        print("progress websocket:", e, file=sys.stderr)
        pid = QUEUED["pid"]
if pid is None:
    pid = post("/prompt", {"prompt": wf, "client_id": client})["prompt_id"]
while True:
    h = get(f"/history/{pid}")
    if pid in h:
        break
    time.sleep(1)
r = h[pid]
print("status:", r["status"]["status_str"], "seconds: %.1f" % (time.time() - t0))
for m in r["status"]["messages"]:
    if m[0] == "execution_error":
        print("ERROR:", m[1].get("exception_message", "")[:500])
for nid, o in r.get("outputs", {}).items():
    for im in o.get("images", []):
        print("output:", im["subfolder"], im["filename"])
