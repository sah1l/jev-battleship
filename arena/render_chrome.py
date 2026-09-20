# Renders the two Chrome matches (arena/chrome/matches.json) as side-by-side replays in the arena style.
#   python arena/render_chrome.py
import json, os, subprocess, shutil, sys
from PIL import Image, ImageDraw
from render import (W, H, FPS, BG, PANEL, LINE, TEXT, DIM, GREEN, AMBER, CYAN, MAGENTA, F12, F14, F16, F18, F22, F28, F40,
                    chrome, draw_board, money, OUT)

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.path.join(HERE, "chrome", "matches.json"), encoding="utf8"))
FRAMES = os.path.join(OUT, "_frames_chrome")
PER_TURN, JEV_AT = 8, 4          # frames per turn; the rival's shot lands on frame 0, Jev's reply on frame 4
hits = lambda board: sum(ch in "x#" for ch in board)
sunk = lambda board: sum(ch == "#" for ch in board)


def bar(d, x, y, w, value, total, colour):
    d.rectangle([x, y, x + w, y + 8], fill=BG)
    d.rectangle([x, y, x + int(w * value / total), y + 8], fill=colour)


def panel(d, x, name, vendor, colour, board, last, rows, banner, waiting):
    d.rectangle([x, 96, x + 580, 640], fill=PANEL, outline=LINE)
    d.text((x + 24, 114), name, font=F28, fill=colour)
    d.text((x + 556, 128), vendor, font=F14, fill=DIM, anchor="rm")
    draw_board(d, x + 44, 182, board, last)
    sx = x + 420
    for k, (label, value, col) in enumerate(rows):
        d.text((sx, 190 + k * 66), label, font=F14, fill=DIM)
        d.text((sx, 210 + k * 66), value, font=F28 if len(value) < 9 else F22, fill=col)
    d.text((sx, 470), "hits", font=F14, fill=DIM)
    d.text((sx, 490), f"{hits(board)}/12", font=F22, fill=GREEN if hits(board) == 12 else TEXT)
    bar(d, sx, 524, 130, hits(board), 12, colour)
    if banner:
        text, good = banner
        d.rectangle([x + 24, 572, x + 556, 622], fill=(18, 48, 28) if good else (52, 40, 16), outline=GREEN if good else AMBER)
        d.text((x + 290, 597), text, font=F18, fill=GREEN if good else AMBER, anchor="mm")
    else:
        d.text((x + 24, 588), waiting, font=F16, fill=DIM)


def frame(match, turn_index, sub, done):
    turns = match["turns"]
    t, before = turns[turn_index], turns[turn_index - 1] if turn_index else None
    jev_moved = sub >= JEV_AT or done
    rival_board, rival_last = t["rivalBoard"], t["rivalShot"]
    jev_src = t if jev_moved else before
    jev_board = jev_src["jevBoard"] if jev_src else "." * 64
    jev_last = jev_src["jevShot"] if jev_src else None
    jev_shots = sum(1 for x in turns[:turn_index + 1] if x["jevShot"]) - (0 if jev_moved or not t["jevShot"] else 1)
    # The page reports Jev's tokens and cost per game; the running figure spreads that total by open cells per request.
    weights = [x["jevBoard"].count(".") + 1 for x in turns if x["jevShot"]]
    cost = match["jevCostUsd"] * sum(weights[:jev_shots]) / sum(weights)
    last_ms = next((x["jevMs"] for x in reversed(turns[:turn_index + 1 if jev_moved else turn_index]) if x["jevMs"]), None)

    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    chrome(d, "localhost:3000   |   Battleship in Chrome: each side hunts the other's fleet, first to sink all four ships wins")
    d.text((40, 56), f"JEV vs {match['name'].upper()}", font=F22, fill=TEXT)
    d.text((W - 40, 60), "actual game, every shot in order, pauses shortened", font=F14, fill=DIM, anchor="ra")
    jev_rows = [("shots", str(jev_shots), TEXT), ("round trip", f"{last_ms} ms" if last_ms else "-", TEXT),
                ("cost so far", f"${cost:.4f}", TEXT), ("median", f"{match['jevMedianMs']} ms", DIM)]
    pace = match["wallSeconds"] / match["rivalShots"]
    rival_rows = [("shots", str(t["n"]), TEXT), ("pace", f"~{pace:.0f} s/turn", TEXT), ("cost", "not metered", DIM), ("plays via", "browser", DIM)]
    need = 12 - hits(turns[-1]["jevBoard"])
    panel(d, 40, "Jev 1.13", "TypeSafe AI, ms = page round trip via game server", MAGENTA, jev_board, None if done else jev_last, jev_rows,
          (f"{need} HITS SHORT  {match['jevShots']} shots  {money(match['jevCostUsd'])}  {match['jevMeanMs']} ms mean", False) if done else None,
          f"> move {jev_shots + 1}: " + ("deciding..." if not jev_moved else "waiting for rival"))
    panel(d, 660, match["name"], match["vendor"], CYAN, rival_board, None if done else rival_last, rival_rows,
          (f"FLEET SUNK  {match['rivalShots']} shots  {match['wallSeconds'] / 60:.0f} min of play", True) if done else None,
          f"> move {t['n'] + 1}: thinking...")
    total = len(turns)
    d.rectangle([40, 664, W - 40, 674], fill=PANEL)
    d.rectangle([40, 664, 40 + int((W - 80) * (turn_index + (1 if done else sub / PER_TURN)) / total), 674], fill=AMBER)
    d.text((40, 690), f"turn {t['n']:2d} / {total}", font=F14, fill=DIM)
    if done:
        d.text((W - 40, 690), f"game to {match['name']}, Jev was {need} hits away", font=F16, fill=GREEN, anchor="ra")
    else:
        d.text((W - 40, 690), "left: Jev's shots at the rival's fleet   right: the rival's shots at Jev's fleet", font=F14, fill=DIM, anchor="ra")
    return img


def render(match):
    shutil.rmtree(FRAMES, ignore_errors=True)
    os.makedirs(FRAMES)
    k = 0
    def emit(img, count=1):
        nonlocal k
        for _ in range(count):
            img.save(os.path.join(FRAMES, f"f{k:04d}.png")); k += 1
    for i in range(len(match["turns"])):
        for sub in range(PER_TURN):
            emit(frame(match, i, sub, False))
    final = frame(match, len(match["turns"]) - 1, PER_TURN, True)
    emit(final, FPS * 4)
    final.save(os.path.join(OUT, f"race-{match['key']}-final.png"))
    ff = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", os.path.join(FRAMES, "f%04d.png")]
    gif, mp4 = os.path.join(OUT, f"race-{match['key']}.gif"), os.path.join(OUT, f"race-{match['key']}.mp4")
    subprocess.run(ff + ["-vf", "split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle", "-loop", "0", gif], check=True)
    subprocess.run(ff + ["-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "18", mp4], check=True)
    shutil.rmtree(FRAMES)
    print(os.path.basename(gif), k, "frames", round(k / FPS, 1), "s", round(os.path.getsize(gif) / 1e6, 2), "MB")


def summary(path):
    # One card for the blog: the two API series from results.json plus the two Chrome games.
    arena = json.load(open(os.path.join(HERE, "results.json"), encoding="utf8"))
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    chrome(d, "Jev 1.13 vs bigger models   |   Battleship, 8 x 8, fleet 4-3-3-2, code only checks that a shot is legal")
    d.text((40, 56), "Jev lost to the frontier models, narrowly, at a fraction of the cost", font=F22, fill=TEXT)
    rows = []
    for s in arena["series"]:
        j, r, cap = s["summary"]["jev"], s["summary"]["rival"], arena["captains"][s["rival"]]
        rows.append((cap["name"], "best of 5, same hidden fleets, API calls", f"{j['wins']} - {r['wins']}", j["wins"] > r["wins"],
                     [("mean shots", f"{j['meanShots']:.1f}", f"{r['meanShots']:.1f}"), ("median latency", f"{j['medianMs']} ms", f"{r['medianMs']} ms"),
                      ("cost, 5 games", money(j["costUsd"]), money(r["costUsd"]))]))
    for m in DATA["matches"]:
        rows.append((m["name"], "one head-to-head game in Chrome", f"{hits(m['turns'][-1]['jevBoard'])} - 12", False,
                     [("shots fired", str(m["jevShots"]), str(m["rivalShots"])), ("pace", f"{m['jevMeanMs']} ms", f"~{m['wallSeconds'] / m['rivalShots']:.0f} s/turn"),
                      ("cost, 1 game", money(m["jevCostUsd"]), "not metered")]))
    rows.sort(key=lambda r: r[0] != "MiniMax M3")  # frontier models first, the smaller rival last
    rows = rows[1:] + rows[:1]
    y = 100
    for name, how, score, won, cols in rows:
        d.rectangle([40, y, W - 40, y + 128], fill=PANEL, outline=LINE)
        d.text((64, y + 20), "Jev", font=F22, fill=MAGENTA)
        d.text((114, y + 20), "vs", font=F18, fill=DIM)
        d.text((150, y + 20), name, font=F22, fill=CYAN)
        d.text((64, y + 58), how, font=F14, fill=DIM)
        d.text((64, y + 86), "Jev won the series" if won else "Jev lost", font=F16, fill=GREEN if won else AMBER)
        d.text((500, y + 24), score, font=F40, fill=TEXT, anchor="ma")
        d.text((500, y + 86), "games" if "best of" in how else "hits landed (12 sinks a fleet)", font=F12, fill=DIM, anchor="ma")
        for k, (label, a, b) in enumerate(cols):
            cx = 660 + k * 200
            d.text((cx, y + 16), label, font=F14, fill=DIM)
            d.text((cx, y + 42), a, font=F22, fill=MAGENTA)
            d.text((cx, y + 76), b, font=F22 if len(b) < 12 else F18, fill=CYAN)
        y += 142
    d.text((40, H - 34), "Magenta = Jev, blue = rival. API series: temperature 0, no extended thinking, list prices. Chrome games: Jev figures as reported by the game page",
           font=F12, fill=DIM)
    d.text((40, H - 18), "(round trip through the game server); the rivals played as browser agents, so their pace includes browser control and their tokens were not metered.",
           font=F12, fill=DIM)
    img.save(path)


if __name__ == "__main__":
    summary(os.path.join(OUT, "summary.png"))
    if "--card-only" not in sys.argv:
        for match in DATA["matches"]:
            render(match)
