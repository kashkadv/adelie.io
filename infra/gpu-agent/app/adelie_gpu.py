#!/usr/bin/env python3
"""Adelie GPU - a small Ubuntu app (GTK 4 + libadwaita) for the PC that generates images for Adelie (ADR-0041, ADR-0042).

Status: Adelie connection, ComfyUI, free video memory, the current job and recent ones, the agent's log.
Control: start / stop (systemd user services `comfyui` and `adelie-gpu`), pause ("allow Adelie to take jobs"),
start on login. Settings: Adelie address, the PC key, model, minimum free video memory, ComfyUI folder - written to
~/.config/adelie/gpu-agent.env (readable only by the user), which the agent service reads.

The agent writes its state to ~/.cache/adelie/gpu-agent.json; this app only reads it. No extra packages: Ubuntu 24.04
ships PyGObject, GTK 4 and libadwaita."""
import json, os, subprocess, sys, threading, time, urllib.request
from pathlib import Path

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, GLib, Gtk  # noqa: E402

APP_ID = "space.adelie.Gpu"
CONF = Path.home() / ".config/adelie/gpu-agent.env"
STATE = Path.home() / ".cache/adelie/gpu-agent.json"
SWITCH_OFF = Path.home() / ".adelie-gpu-off"
SERVICES = ["comfyui", "adelie-gpu"]
APIS = [("https://dev-api.adelie.space", "Adelie dev"), ("https://api.adelie.space", "Adelie")]
MODELS = [("flux3", "FLUX 3 Image Klein (основна)"), ("klein4b", "FLUX.2 klein 4B"), ("klein9b", "FLUX.2 klein 9B")]
DEFAULTS = {"ADELIE_API": APIS[0][0], "ADELIE_GPU_KEY": "", "AGENT_MODEL": "flux3", "MIN_VRAM_MB": "6000",
            "COMFY_DIR": str(Path.home() / "ComfyUI")}


def read_conf():
    conf = dict(DEFAULTS)
    if CONF.exists():
        for line in CONF.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1); conf[k.strip()] = v.strip()
    return conf


def write_conf(conf):
    CONF.parent.mkdir(parents=True, exist_ok=True)
    old = os.umask(0o077)
    try:
        CONF.write_text("".join(f"{k}={v}\n" for k, v in conf.items()))
    finally:
        os.umask(old)
    CONF.chmod(0o600)


def sh(*cmd):
    r = subprocess.run(list(cmd), capture_output=True, text=True)
    return r.returncode, (r.stdout or r.stderr).strip()


def service_active(name):
    return sh("systemctl", "--user", "is-active", name)[1] == "active"


def comfy_up(conf):
    try:
        urllib.request.urlopen("http://127.0.0.1:8188/system_stats", timeout=2).read()
        return True
    except Exception:
        return False


def vram_free():
    code, out = sh("nvidia-smi", "--query-gpu=memory.free,memory.total", "--format=csv,noheader,nounits")
    try:
        free, total = (int(x) for x in out.split(","))
        return free, total
    except Exception:
        return None, None


def agent_state():
    try:
        return json.loads(STATE.read_text())
    except Exception:
        return {}


def ago(ts):
    if not ts:
        return "—"
    s = int(time.time() - ts)
    return f"{s} с тому" if s < 60 else f"{s // 60} хв тому" if s < 3600 else time.strftime("%d.%m %H:%M", time.localtime(ts))


def dot(color):
    lbl = Gtk.Label(); lbl.set_markup(f'<span foreground="{color}" size="x-large">●</span>'); return lbl


class Window(Adw.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app, title="Adelie GPU", default_width=560, default_height=720)
        self.conf = read_conf()
        stack = Adw.ViewStack()
        stack.add_titled_with_icon(self.status_page(), "status", "Стан", "utilities-system-monitor-symbolic")
        stack.add_titled_with_icon(self.settings_page(), "settings", "Налаштування", "preferences-system-symbolic")
        header = Adw.HeaderBar(); switcher = Adw.ViewSwitcher(stack=stack, policy=Adw.ViewSwitcherPolicy.WIDE)
        header.set_title_widget(switcher)
        view = Adw.ToolbarView(); view.add_top_bar(header); view.set_content(stack)
        self.toasts = Adw.ToastOverlay(child=view)
        self.set_content(self.toasts)
        self.refresh(); GLib.timeout_add_seconds(2, self.refresh)

    # --- Status --------------------------------------------------------------------------------------------------
    def status_page(self):
        page = Adw.PreferencesPage()
        top = Adw.PreferencesGroup()
        self.summary = Adw.ActionRow(title="…", subtitle="")
        self.summary_dot = dot("#9ca3af"); self.summary.add_prefix(self.summary_dot)
        buttons = Gtk.Box(spacing=8, valign=Gtk.Align.CENTER)
        self.start_btn = Gtk.Button(label="Запустити", css_classes=["suggested-action", "pill"])
        self.stop_btn = Gtk.Button(label="Зупинити", css_classes=["pill"])
        self.start_btn.connect("clicked", lambda *_: self.services("start"))
        self.stop_btn.connect("clicked", lambda *_: self.services("stop"))
        buttons.append(self.start_btn); buttons.append(self.stop_btn)
        self.summary.add_suffix(buttons)
        top.add(self.summary)
        self.allow = Adw.SwitchRow(title="Дозволити Adelie брати завдання",
                                   subtitle="Вимкніть, коли граєте чи працюєте з графікою: завдання чекатимуть")
        self.allow.set_active(not SWITCH_OFF.exists())
        self.allow.connect("notify::active", self.on_allow)
        top.add(self.allow)
        page.add(top)

        checks = Adw.PreferencesGroup(title="Перевірки")
        self.row_adelie = Adw.ActionRow(title="Зв'язок з Adelie")
        self.row_comfy = Adw.ActionRow(title="ComfyUI")
        self.row_vram = Adw.ActionRow(title="Відеопам'ять")
        self.row_model = Adw.ActionRow(title="Модель")
        for r in (self.row_adelie, self.row_comfy, self.row_vram, self.row_model):
            checks.add(r)
        page.add(checks)

        jobs = Adw.PreferencesGroup(title="Завдання")
        self.row_job = Adw.ActionRow(title="Зараз нічого не генерується")
        self.progress = Gtk.ProgressBar(valign=Gtk.Align.CENTER, hexpand=True, visible=False)
        self.progress.set_size_request(140, -1)
        self.row_job.add_suffix(self.progress)
        jobs.add(self.row_job)
        self.history = Adw.ExpanderRow(title="Останні завдання")
        self.history_rows = []
        jobs.add(self.history)
        page.add(jobs)

        log = Adw.PreferencesGroup(title="Журнал")
        refresh = Gtk.Button(icon_name="view-refresh-symbolic", valign=Gtk.Align.CENTER, css_classes=["flat"],
                             tooltip_text="Оновити журнал")
        refresh.connect("clicked", lambda *_: self.load_log())
        log.set_header_suffix(refresh)
        self.log_view = Gtk.TextView(editable=False, monospace=True, wrap_mode=Gtk.WrapMode.WORD_CHAR,
                                     css_classes=["card"], top_margin=8, bottom_margin=8, left_margin=10, right_margin=10)
        scroller = Gtk.ScrolledWindow(child=self.log_view, min_content_height=180, max_content_height=260)
        log.add(scroller)
        page.add(log)
        self.load_log()
        return page

    def load_log(self):
        _, out = sh("journalctl", "--user", "-u", "adelie-gpu", "-n", "80", "--no-pager", "-o", "cat")
        self.log_view.get_buffer().set_text(out or "Журнал порожній (агент ще не запускався як служба).")

    def on_allow(self, row, _):
        if row.get_active():
            SWITCH_OFF.unlink(missing_ok=True)
        else:
            SWITCH_OFF.touch()

    def services(self, action):
        if action == "start" and not self.conf.get("ADELIE_GPU_KEY"):
            self.toasts.add_toast(Adw.Toast(title="Спершу вставте ключ ПК у налаштуваннях")); return
        units = SERVICES if action == "start" else list(reversed(SERVICES))
        # ComfyUI already started by hand: the agent uses it, its service is not needed
        if action == "start" and comfy_up(self.conf) and not service_active("comfyui"):
            units = ["adelie-gpu"]

        def work():
            for u in units:
                sh("systemctl", "--user", action, u)
            GLib.idle_add(self.refresh)
        threading.Thread(target=work, daemon=True).start()
        self.toasts.add_toast(Adw.Toast(title="Запускаю…" if action == "start" else "Зупиняю…"))

    def refresh(self):
        st = agent_state(); running = service_active("adelie-gpu")
        comfy = comfy_up(self.conf); free, total = vram_free()
        fresh = running and st.get("lastBeat") and time.time() - st["lastBeat"] < 90
        paused = SWITCH_OFF.exists()
        if not running:
            title, sub, color = "Вимкнено", "Агент не запущений: Adelie не бачить цей ПК", "#9ca3af"
        elif not fresh:
            title, sub, color = "Немає зв'язку з Adelie", st.get("connError") or "Чекаю на першу відповідь…", "#f59e0b"
        elif paused or st.get("state") != "ready":
            title = "Пауза" if paused else "Зайнятий"
            sub = "Завдання чекають у черзі" if paused else "Замало вільної відеопам'яті — завдання чекають"
            color = "#f59e0b"
        else:
            title, sub, color = "Готовий", "Adelie може надсилати завдання", "#10b981"
        self.summary.set_title(title); self.summary.set_subtitle(sub)
        self.summary_dot.set_markup(f'<span foreground="{color}" size="x-large">●</span>')
        self.start_btn.set_sensitive(not running); self.stop_btn.set_sensitive(running)

        self.row_adelie.set_subtitle(
            f"{self.conf.get('ADELIE_API')} · остання відповідь {ago(st.get('lastBeat'))}" if fresh
            else (st.get("connError") or "немає") if running else "агент вимкнений")
        self.row_comfy.set_subtitle("працює на 127.0.0.1:8188" if comfy else "не відповідає")
        self.row_vram.set_subtitle(f"вільно {free / 1024:.1f} з {total / 1024:.1f} ГБ" if free is not None else "nvidia-smi недоступний")
        self.row_model.set_subtitle(dict(MODELS).get(self.conf.get("AGENT_MODEL", "flux3"), "—"))

        job = st.get("job") if running else None
        if job:
            self.row_job.set_title(job.get("title") or job.get("kind", "завдання"))
            self.row_job.set_subtitle(f"{job.get('done', 0)} з {job.get('total', 1)} · почато {ago(job.get('started'))}")
            self.progress.set_visible(True); self.progress.set_fraction(job.get("done", 0) / max(1, job.get("total", 1)))
        else:
            self.row_job.set_title("Зараз нічого не генерується"); self.row_job.set_subtitle("")
            self.progress.set_visible(False)
        hist = st.get("history") or []
        if [h.get("id") for h in hist] != [getattr(r, "_id", None) for r in self.history_rows]:
            for r in self.history_rows:
                self.history.remove(r)
            self.history_rows = []
            for h in hist:
                r = Adw.ActionRow(title=h.get("title") or h.get("kind", ""),
                                  subtitle=("✓ готово" if h.get("result") == "done" else f"✕ {h.get('error') or 'помилка'}")
                                  + f" · {ago(h.get('finished'))}")
                r._id = h.get("id"); self.history.add_row(r); self.history_rows.append(r)
            self.history.set_subtitle(f"{len(hist)}" if hist else "ще не було")
        return True

    # --- Settings ------------------------------------------------------------------------------------------------
    def settings_page(self):
        page = Adw.PreferencesPage()
        g = Adw.PreferencesGroup(title="Підключення",
                                 description="Ключ береться в Adelie: Майстерня → Сцени → кнопка з процесором")
        self.api = Adw.ComboRow(title="Adelie", model=Gtk.StringList.new([f"{n} — {u}" for u, n in APIS]))
        urls = [u for u, _ in APIS]
        self.api.set_selected(urls.index(self.conf["ADELIE_API"]) if self.conf["ADELIE_API"] in urls else 0)
        self.key = Adw.PasswordEntryRow(title="Ключ ПК (gpw_…)"); self.key.set_text(self.conf.get("ADELIE_GPU_KEY", ""))
        g.add(self.api); g.add(self.key); page.add(g)

        m = Adw.PreferencesGroup(title="Генерація")
        self.model = Adw.ComboRow(title="Модель", model=Gtk.StringList.new([n for _, n in MODELS]))
        keys = [k for k, _ in MODELS]
        self.model.set_selected(keys.index(self.conf["AGENT_MODEL"]) if self.conf["AGENT_MODEL"] in keys else 0)
        self.vram = Adw.SpinRow.new_with_range(2000, 16000, 500)
        self.vram.set_title("Мінімум вільної відеопам'яті, МБ")
        self.vram.set_subtitle("Менше — ПК вважається зайнятим і не бере завдань")
        self.vram.set_value(float(self.conf.get("MIN_VRAM_MB", 6000)))
        self.comfy_dir = Adw.EntryRow(title="Тека ComfyUI"); self.comfy_dir.set_text(self.conf.get("COMFY_DIR", ""))
        m.add(self.model); m.add(self.vram); m.add(self.comfy_dir); page.add(m)

        s = Adw.PreferencesGroup(title="Запуск")
        self.autostart = Adw.SwitchRow(title="Запускати при вході в систему",
                                       subtitle="ComfyUI й агент стартують самі після перезавантаження ПК")
        self.autostart.set_active(sh("systemctl", "--user", "is-enabled", "adelie-gpu")[1] == "enabled")
        self.autostart.connect("notify::active", self.on_autostart)
        s.add(self.autostart); page.add(s)

        save = Gtk.Button(label="Зберегти", css_classes=["suggested-action", "pill"], halign=Gtk.Align.CENTER,
                          margin_top=12)
        save.connect("clicked", self.on_save)
        last = Adw.PreferencesGroup(); last.add(save); page.add(last)
        return page

    def on_autostart(self, row, _):
        verb = "enable" if row.get_active() else "disable"
        for u in SERVICES:
            sh("systemctl", "--user", verb, u)

    def on_save(self, *_):
        key = self.key.get_text().strip()
        if key and not (key.startswith("gpw_") and len(key) == 36):
            self.toasts.add_toast(Adw.Toast(title="Ключ має вигляд gpw_ і ще 32 символи")); return
        self.conf.update({
            "ADELIE_API": APIS[self.api.get_selected()][0], "ADELIE_GPU_KEY": key,
            "AGENT_MODEL": MODELS[self.model.get_selected()][0], "MIN_VRAM_MB": str(int(self.vram.get_value())),
            "COMFY_DIR": self.comfy_dir.get_text().strip() or DEFAULTS["COMFY_DIR"]})
        write_conf(self.conf)
        if service_active("adelie-gpu"):          # the running agent picks the new settings up
            sh("systemctl", "--user", "restart", "adelie-gpu")
            self.toasts.add_toast(Adw.Toast(title="Збережено, агента перезапущено"))
        else:
            self.toasts.add_toast(Adw.Toast(title="Збережено"))
        self.refresh()


class App(Adw.Application):
    def __init__(self):
        super().__init__(application_id=APP_ID)

    def do_activate(self):
        win = self.props.active_window or Window(self)
        win.present()
        tray = Path(__file__).with_name("adelie_gpu_tray.py")
        if tray.exists() and not getattr(self, "_tray", None):   # top-bar icon, if the system has AppIndicator
            self._tray = subprocess.Popen([sys.executable, str(tray)], stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    sys.exit(App().run(sys.argv))
