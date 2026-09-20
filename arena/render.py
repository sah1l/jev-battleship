# Renders arena/results.json into blog assets: a terminal-style race replay (GIF + MP4)
# and a static scorecard PNG. Everything drawn comes from the saved results.
#   python arena/render.py
import json, os, subprocess, shutil, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.path.join(HERE, "results.json"), encoding="utf8"))
OUT = os.path.join(HERE, "assets")
FRAMES = os.path.join(OUT, "_frames")
os.makedirs(OUT, exist_ok=True)

W, H, FPS = 1280, 720, 12
BG, PANEL, LINE = (13, 17, 23), (22, 27, 34), (48, 54, 61)
TEXT, DIM, GREEN, RED, AMBER, CYAN, MAGENTA = (230, 237, 243), (125, 133, 144), (63, 185, 80), (248, 81, 73), (210, 153, 34), (88, 166, 255), (219, 97, 162)
WATER, MISS, HIT, SUNK = (33, 40, 50), (72, 82, 96), RED, (140, 42, 38)
font = lambda size, bold=False: ImageFont.truetype(r"C:\Windows\Fonts\consolab.ttf" if bold else r"C:\Windows\Fonts\consola.ttf", size)
F12, F14, F16, F18, F22, F28, F40 = font(13), font(15), font(17), font(19), font(23, True), font(29, True), font(44, True)
CAP = DATA["captains"]
money = lambda v: f"${v:.4f}" if v < 0.1 else f"${v:.2f}"


def chrome(d, title):
    d.rectangle([0, 0, W, H], fill=BG)
    d.rectangle([0, 0, W, 38], fill=PANEL)
    for k, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([18 + k * 22, 12, 32 + k * 22, 26], fill=c)
    d.text((W // 2, 19), title, font=F14, fill=DIM, anchor="mm")


def board_at(turns, count):
    # Board after `count` answered turns; invalid answers leave it unchanged.
    if count <= 0:
        return "." * 64, None
    t = turns[count - 1]
    last = t["choice"] if t["result"] != "invalid" else None
    nxt = turns[count]["board"] if count < len(turns) else None
    if nxt is None:
        b = list(t["board"])
        if last:
            i = "ABCDEFGH".index(last[0]) * 8 + int(last[1:]) - 1
            b[i] = "o" if t["result"] == "miss" else "x"
        b = "".join(b).replace("x", "#") if t["result"] == "sunk" else "".join(b)
        return b, last
    return nxt, last


def draw_board(d, x, y, board, last, cell=44):
    for c in range(8):
        d.text((x + c * cell + cell // 2, y - 14), str(c + 1), font=F12, fill=DIM, anchor="mm")
    for r in range(8):
        d.text((x - 16, y + r * cell + cell // 2), "ABCDEFGH"[r], font=F12, fill=DIM, anchor="mm")
        for c in range(8):
            ch = board[r * 8 + c]
            x0, y0 = x + c * cell, y + r * cell
            fill = {".": WATER, "o": WATER, "x": HIT, "#": SUNK}[ch]
            d.rectangle([x0 + 2, y0 + 2, x0 + cell - 2, y0 + cell - 2], fill=fill)
            if ch == "o":
                d.ellipse([x0 + 17, y0 + 17, x0 + cell - 17, y0 + cell - 17], fill=MISS)
            if ch == "#":
                d.line([x0 + 10, y0 + 10, x0 + cell - 10, y0 + cell - 10], fill=(230, 150, 145), width=2)
                d.line([x0 + cell - 10, y0 + 10, x0 + 10, y0 + cell - 10], fill=(230, 150, 145), width=2)
            if last and "ABCDEFGH"[r] + str(c + 1) == last:
                d.rectangle([x0 + 1, y0 + 1, x0 + cell - 1, y0 + cell - 1], outline=TEXT, width=2)


def panel(d, x, key, side, clock, colour):
    turns, price = side["turns"], CAP[key]["price"]
    ends, acc = [], 0
    for t in turns:
        acc += t["ms"] / 1000
        ends.append(acc)
    count = sum(1 for e in ends if e <= clock)
    done = count == len(turns)
    board, last = board_at(turns, count)
    cost = sum((t["inTok"] * price["in"] + t["outTok"] * price["out"]) / 1e6 for t in turns[:count])
    d.rectangle([x, 96, x + 580, 640], fill=PANEL, outline=LINE)
    d.text((x + 24, 114), CAP[key]["name"], font=F28, fill=colour)
    d.text((x + 556, 128), CAP[key]["vendor"], font=F14, fill=DIM, anchor="rm")
    draw_board(d, x + 44, 182, board, None if done else last)
    sx = x + 420
    rows = [("shots", str(count), TEXT), ("clock", f"{min(clock, ends[-1]):.1f}s", TEXT), ("cost", money(cost), TEXT),
            ("ms/move", str(sorted(t["ms"] for t in turns)[len(turns) // 2]), DIM)]
    for k, (name, value, col) in enumerate(rows):
        d.text((sx, 190 + k * 66), name, font=F14, fill=DIM)
        d.text((sx, 210 + k * 66), value, font=F28, fill=col)
    sunk = sum(1 for t in turns[:count] if t["result"] == "sunk")
    d.text((sx, 470), "fleet", font=F14, fill=DIM)
    d.text((sx, 490), f"{sunk}/4 sunk", font=F22, fill=GREEN if sunk == 4 else TEXT)
    if done:
        d.rectangle([x + 24, 572, x + 556, 622], fill=(18, 48, 28), outline=GREEN)
        d.text((x + 290, 597), f"FLEET CLEARED  {len(turns)} shots  {ends[-1]:.1f}s  {money(side['costUsd'])}", font=F18, fill=GREEN, anchor="mm")
    else:
        dots = "." * (1 + int(clock * 3) % 3)
        d.text((x + 24, 588), f"> awaiting move {count + 1}{dots}", font=F16, fill=DIM)
    return done


def race_frames(series, game, speed, start_index):
    rival = series["rival"]
    total = max(game["jev"]["totalSeconds"], game["rival"]["totalSeconds"])
    frames, clock, k = [], 0.0, start_index
    hold = 0
    while True:
        img = Image.new("RGB", (W, H))
        d = ImageDraw.Draw(img)
        chrome(d, "node arena/arena.mjs --games 5   |   Battleship: same hidden fleet, same prompt, fewest shots wins")
        d.text((40, 56), f"GAME {game['game']} of {DATA['games']}", font=F22, fill=TEXT)
        d.text((W - 40, 60), f"clock = measured API time, replayed at {speed}x", font=F14, fill=DIM, anchor="ra")
        a = panel(d, 40, "jev", game["jev"], clock, MAGENTA)
        b = panel(d, 660, rival, game["rival"], clock, CYAN)
        d.rectangle([40, 664, W - 40, 674], fill=PANEL)
        d.rectangle([40, 664, 40 + int((W - 80) * min(clock / total, 1)), 674], fill=AMBER)
        d.text((40, 690), f"{min(clock, total):5.1f}s / {total:.1f}s", font=F14, fill=DIM)
        if a and b:
            win = CAP[game["winner"] if game["winner"] == "jev" else rival]["name"]
            d.text((W - 40, 690), f"game to {win}", font=F16, fill=GREEN, anchor="ra")
        img.save(os.path.join(FRAMES, f"f{k:04d}.png"))
        k += 1
        if a and b:
            hold += 1
            if hold > FPS * 2:
                break
        clock += speed / FPS
    return k


def scorecard(path, width=W, height=H):
    img = Image.new("RGB", (width, height))
    d = ImageDraw.Draw(img)
    chrome(d, "arena/results.json   |   best of 5, same fleets, same prompt, code only checks the shot is legal")
    d.text((40, 58), "Battleship: Jev vs general-purpose LLMs", font=F28, fill=TEXT)
    y = 118
    for series in DATA["series"]:
        rival, s = series["rival"], series["summary"]
        jw, rw = s["jev"]["wins"], s["rival"]["wins"]
        d.rectangle([40, y, width - 40, y + 262], fill=PANEL, outline=LINE)
        d.text((64, y + 18), CAP["jev"]["name"], font=F22, fill=MAGENTA)
        d.text((width // 2, y + 16), f"{jw}  -  {rw}", font=F40, fill=TEXT, anchor="ma")
        d.text((width - 64, y + 18), CAP[rival]["name"], font=F22, fill=CYAN, anchor="ra")
        for g, game in enumerate(series["games"]):
            gx = width // 2 - 170 + g * 85
            won = game["winner"] == "jev"
            d.text((gx, y + 76), f"G{g + 1}", font=F12, fill=DIM, anchor="mm")
            d.text((gx - 18, y + 98), str(game["jev"]["shots"]), font=F18, fill=GREEN if won else DIM, anchor="mm")
            d.text((gx + 18, y + 98), str(game["rival"]["shots"]), font=F18, fill=DIM if won else GREEN, anchor="mm")
        d.text((width // 2, y + 122), "shots per game (green = winner)", font=F12, fill=DIM, anchor="mm")
        cols = [("mean shots", lambda v: f"{v['meanShots']:.1f}"), ("median latency", lambda v: f"{v['medianMs']} ms"),
                ("API time, 5 games", lambda v: f"{v['totalSeconds']:.0f} s"), ("cost, 5 games", lambda v: money(v["costUsd"])),
                ("invalid answers", lambda v: str(v["invalid"]))]
        for k, (name, fmt) in enumerate(cols):
            cx = 64 + k * 236
            d.text((cx, y + 150), name, font=F14, fill=DIM)
            d.text((cx, y + 174), fmt(s["jev"]), font=F22, fill=MAGENTA)
            d.text((cx, y + 206), fmt(s["rival"]), font=F22, fill=CYAN)
        ratio_cost = s["rival"]["costUsd"] / s["jev"]["costUsd"]
        ratio_ms = s["rival"]["medianMs"] / s["jev"]["medianMs"]
        d.text((width - 64, y + 238), f"{CAP[rival]['name']}: {ratio_cost:.0f}x the cost, {ratio_ms:.1f}x the latency per move", font=F14, fill=AMBER, anchor="ra")
        y += 282
    d.text((40, height - 30), "Text models: temperature 0, no extended thinking, JSON answer. List prices per 1M tokens: " +
           ", ".join(f"{c['name']} ${c['price']['in']}/{c['price']['out']}" for c in CAP.values()), font=F12, fill=DIM)
    img.save(path)
    return img


if __name__ == "__main__":
    shutil.rmtree(FRAMES, ignore_errors=True)
    os.makedirs(FRAMES)
    card = scorecard(os.path.join(OUT, "scorecard.png"))
    k = 0
    for series in DATA["series"]:
        # Replay the game whose shot margin is the series median, so the clip is typical rather than flattering.
        ranked = sorted(series["games"], key=lambda g: g["rival"]["shots"] - g["jev"]["shots"])
        game = ranked[len(ranked) // 2]
        speed = max(4, round(max(game["jev"]["totalSeconds"], game["rival"]["totalSeconds"]) / 11))
        print(series["rival"], "replaying game", game["game"], "at", speed, "x")
        k = race_frames(series, game, speed, k)
    for _ in range(FPS * 5):
        card.save(os.path.join(FRAMES, f"f{k:04d}.png"))
        k += 1
    ff = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", os.path.join(FRAMES, "f%04d.png")]
    subprocess.run(ff + ["-vf", "split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
                         "-loop", "0", os.path.join(OUT, "race.gif")], check=True)
    subprocess.run(ff + ["-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "18", os.path.join(OUT, "race.mp4")], check=True)
    shutil.rmtree(FRAMES)
    for name in ["scorecard.png", "race.gif", "race.mp4"]:
        print(name, round(os.path.getsize(os.path.join(OUT, name)) / 1e6, 2), "MB")
