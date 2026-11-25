"""Runs an API-format ComfyUI workflow and reports time and output files."""
import json, sys, time, urllib.request

BASE = "http://127.0.0.1:8188"

def post(path, data):
    req = urllib.request.Request(BASE + path, json.dumps(data).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))

def get(path):
    return json.load(urllib.request.urlopen(BASE + path))

wf = json.load(open(sys.argv[1]))
t0 = time.time()
pid = post("/prompt", {"prompt": wf})["prompt_id"]
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
