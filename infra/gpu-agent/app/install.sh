#!/bin/bash
# Installs the "Adelie GPU" app for the current user (no sudo): app launcher, icons, systemd user services for ComfyUI
# and the agent, an empty settings file. Nothing is started - start from the app. Run again after moving the repo.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; AGENT="$(cd "$HERE/.." && pwd)/agent.py"
APPS=~/.local/share/applications; ICONS=~/.local/share/icons/hicolor/scalable/apps; UNITS=~/.config/systemd/user
mkdir -p "$APPS" "$ICONS" "$UNITS" ~/.config/adelie

cp "$HERE"/icons/*.svg "$ICONS/"
cat > "$APPS/space.adelie.Gpu.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Adelie GPU
Comment=Генерація зображень для Adelie на цьому ПК
Exec=/usr/bin/python3 "$HERE/adelie_gpu.py"
Icon=adelie-gpu
Terminal=false
Categories=Graphics;Utility;
StartupWMClass=space.adelie.Gpu
EOF

cat > "$UNITS/comfyui.service" <<'EOF'
[Unit]
Description=ComfyUI (local image models for Adelie)
After=network-online.target

[Service]
EnvironmentFile=-%h/.config/adelie/gpu-agent.env
WorkingDirectory=%h/ComfyUI
ExecStart=%h/ComfyUI/venv/bin/python main.py --listen 127.0.0.1 --port 8188
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF

cat > "$UNITS/adelie-gpu.service" <<EOF
[Unit]
Description=Adelie GPU agent (takes jobs from Adelie, runs them in ComfyUI)
# Wants, not Requires: a ComfyUI started by hand serves the agent as well
Wants=comfyui.service
After=comfyui.service network-online.target

[Service]
EnvironmentFile=%h/.config/adelie/gpu-agent.env
ExecStart=/usr/bin/python3 -u "$AGENT"
Restart=always
RestartSec=20

[Install]
WantedBy=default.target
EOF

test -f ~/.config/adelie/gpu-agent.env || { umask 077; : > ~/.config/adelie/gpu-agent.env; }
chmod 600 ~/.config/adelie/gpu-agent.env
systemctl --user daemon-reload
gtk-update-icon-cache -q ~/.local/share/icons/hicolor 2>/dev/null || true
update-desktop-database -q "$APPS" 2>/dev/null || true

echo "Installed: Adelie GPU is in the app list (pin it to the dock). Settings: ~/.config/adelie/gpu-agent.env"
python3 -c "import gi; gi.require_version('AyatanaAppIndicator3','0.1')" 2>/dev/null \
  || echo "Top-bar icon: sudo apt install gir1.2-ayatanaappindicator3-0.1"
