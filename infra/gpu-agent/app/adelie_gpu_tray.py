#!/usr/bin/env python3
"""Top-bar icon of Adelie GPU (GTK 3 + Ayatana AppIndicator; a separate process because the main app is GTK 4).
Shows the state as the icon's colour; menu: pause / resume, start / stop, open the app.
Needs the system package `gir1.2-ayatanaappindicator3-0.1`; without it this exits quietly."""
import fcntl, json, subprocess, sys, time
from pathlib import Path

import gi

try:
    gi.require_version("Gtk", "3.0")
    gi.require_version("AyatanaAppIndicator3", "0.1")
    from gi.repository import AyatanaAppIndicator3 as AI, GLib, Gtk
except (ValueError, ImportError):
    sys.exit(0)

STATE = Path.home() / ".cache/adelie/gpu-agent.json"
SWITCH_OFF = Path.home() / ".adelie-gpu-off"
LOCK = Path.home() / ".cache/adelie/tray.lock"

LOCK.parent.mkdir(parents=True, exist_ok=True)
_lock = open(LOCK, "w")
try:
    fcntl.flock(_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)      # one icon only
except OSError:
    sys.exit(0)


def active():
    return subprocess.run(["systemctl", "--user", "is-active", "adelie-gpu"], capture_output=True, text=True).stdout.strip() == "active"


def status():
    try:
        st = json.loads(STATE.read_text())
    except Exception:
        st = {}
    if not active():
        return "offline", "Adelie GPU: вимкнено"
    if not st.get("lastBeat") or time.time() - st["lastBeat"] > 90:
        return "busy", "Adelie GPU: немає зв'язку"
    if st.get("job"):
        j = st["job"]
        return "ready", f"Генерую: {j.get('title') or ''} {j.get('done', 0)}/{j.get('total', 1)}"
    if SWITCH_OFF.exists() or st.get("state") != "ready":
        return "busy", "Adelie GPU: пауза" if SWITCH_OFF.exists() else "Adelie GPU: зайнятий"
    return "ready", "Adelie GPU: готовий"


ind = AI.Indicator.new("adelie-gpu", "adelie-gpu-offline", AI.IndicatorCategory.APPLICATION_STATUS)
ind.set_status(AI.IndicatorStatus.ACTIVE)
menu = Gtk.Menu()
title = Gtk.MenuItem(label="…", sensitive=False)
pause = Gtk.MenuItem(label="")
run = Gtk.MenuItem(label="")
open_app = Gtk.MenuItem(label="Відкрити Adelie GPU")
for item in (title, Gtk.SeparatorMenuItem(), pause, run, Gtk.SeparatorMenuItem(), open_app):
    menu.append(item)


def on_pause(_):
    SWITCH_OFF.unlink(missing_ok=True) if SWITCH_OFF.exists() else SWITCH_OFF.touch()
    update()


def on_run(_):
    subprocess.Popen(["systemctl", "--user", "stop" if active() else "start", "adelie-gpu"])
    GLib.timeout_add_seconds(2, lambda: update() and False)


pause.connect("activate", on_pause)
run.connect("activate", on_run)
open_app.connect("activate", lambda _: subprocess.Popen(["gtk-launch", "space.adelie.Gpu"]))
menu.show_all()
ind.set_menu(menu)


def update():
    state, text = status()
    ind.set_icon_full(f"adelie-gpu-{state}", text)
    title.set_label(text)
    pause.set_label("Продовжити (дозволити завдання)" if SWITCH_OFF.exists() else "Пауза")
    run.set_label("Зупинити" if active() else "Запустити")
    return True


update()
GLib.timeout_add_seconds(3, update)
Gtk.main()
