# GPU-агент Adelie

Агент працює на ПК власника поруч із ComfyUI ([ADR-0041](../../docs/decisions/0041-gpu-worker-on-demand.md),
[ADR-0042](../../docs/decisions/0042-product-scenes.md)). Він сам звертається до API Adelie: кожні 30 с надсилає стан ПК,
забирає завдання з черги, генерує локально й вантажить результат. Adelie до ПК не підключається.

## Запуск

1. ComfyUI запущений на `127.0.0.1:8188`, у ньому є FLUX 3 Image Klein (int8) і енкодер Qwen3-VL-4B
   (див. [docs/plans/product-studio.md](../../docs/plans/product-studio.md)).
2. Ключ: Adelie → Майстерня → Сцени → кнопка з процесором («Підключити ПК»). Ключ показується один раз.
3. Запуск:

   ```bash
   ADELIE_API=https://<адреса API> ADELIE_GPU_KEY=gpw_... python3 infra/gpu-agent/agent.py
   ```

   Лише стандартна бібліотека Python; рецепти (`prototypes/`) запускаються через Python ComfyUI (`~/ComfyUI/venv`).

## Перемикач

`touch ~/.adelie-gpu-off` — ПК «зайнятий», нових завдань не бере (гра, рендер). `rm ~/.adelie-gpu-off` — знову готовий.
ПК також вважається зайнятим, коли вільно менше `MIN_VRAM_MB` (6000) відеопам'яті.

## Як постійна служба (systemd, користувацька)

`~/.config/systemd/user/adelie-gpu.service`:

```ini
[Unit]
Description=Adelie GPU agent
After=network-online.target

[Service]
Environment=ADELIE_API=https://<адреса API>
Environment=ADELIE_GPU_KEY=gpw_...
ExecStart=/usr/bin/python3 %h/My own projects/Adelie/adelie.io/infra/gpu-agent/agent.py
Restart=always
RestartSec=20

[Install]
WantedBy=default.target
```

`systemctl --user enable --now adelie-gpu` · журнал: `journalctl --user -u adelie-gpu -f`.

## Завдання

- `scene_candidates` — кімнати для бібліотеки сцен: макет у сантиметрах (`prototypes/scene_proxy.py`, гола підлога під
  виріб, крісло під 80–90°, столик) → FLUX 3 Klein (`prototypes/wf_flux3.py`, 16 кроків, перші 2 пропущені). Один
  кандидат на сід. Рецепт (промпт, сід, модель, параметри макета) іде разом із зображенням.
