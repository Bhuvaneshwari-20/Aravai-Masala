"""
Weighing machine photo reader for batching (Python, fully local: no cloud, no internet needed after pip install).

The Node backend (src/utils/ocr.js and src/utils/qrReader.js) sends the camera photo here:
    POST /weight   {"image": "<base64 or data URI>"}  ->  the number shown on the digital display
    POST /qr       {"image": "<base64 or data URI>"}  ->  the QR code printed on the machine (decoded from the pixels, not the text under it)
    GET  /health

Run (from the ocr_service folder):
    pip install -r requirements.txt
    python -m uvicorn app:app --host 127.0.0.1 --port 8002

Optional environment variables
    WEIGHT_REQUIRE_DECIMAL=true|false   refuse a reading without a decimal point (default true)
    WEIGHT_DECIMALS=1                   if the OCR loses the dot, the last N digits are the decimals (1122 -> 112.2)
    WEIGHT_MIN_AGREE=2                  how many different reads of the photo must give the SAME number (default 2)
"""
import base64
import os
import re
from collections import defaultdict
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from rapidocr_onnxruntime import RapidOCR

app = FastAPI(title="Batching weighing-machine photo reader")
ocr = RapidOCR()  # models are loaded once, at start-up

REQUIRE_DECIMAL = os.getenv("WEIGHT_REQUIRE_DECIMAL", "true").lower() != "false"
DECIMALS = int(os.getenv("WEIGHT_DECIMALS", "0") or 0)
MIN_AGREE = max(1, int(os.getenv("WEIGHT_MIN_AGREE", "2") or 2))
PADS = [(0.45, 0.6), (0.8, 1.0), (1.2, 1.4)]  # extra margin around the lit display, as a share of its width / height


class Req(BaseModel):
    image: str  # data URI or base64


def decode(data: str) -> np.ndarray:
    raw = data.split(",", 1)[1] if data.startswith("data:") else data
    try:
        img = cv2.imdecode(np.frombuffer(base64.b64decode(raw), np.uint8), cv2.IMREAD_COLOR)
    except Exception:
        img = None
    if img is None:
        raise HTTPException(400, "Not a valid image")
    return img


def shrink(img: np.ndarray, longest: int = 2400) -> np.ndarray:
    h, w = img.shape[:2]
    k = longest / max(h, w)
    return cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_AREA) if k < 1 else img


# ----------------------------------------------------------------------------------------------------------------- weight
# A lit LED segment is a strongly coloured pixel. Each colour is searched ON ITS OWN: the display is one colour, and the keys, blue strips,
# red paint or stickers of the panel must never be merged with it into one big blob.
def led_masks(img: np.ndarray) -> dict[str, np.ndarray]:
    b, g, r = [img[:, :, i].astype(np.int32) for i in range(3)]
    mx = np.maximum(np.maximum(r, g), b)
    ok = mx >= 110
    return {
        # almost pure red (green / blue below ~35 % of red); pinkish paint, rust and stickers fall out
        "red": ok & (r > 140) & (r > g * 2.8) & (r > b * 2.8),
        "green": ok & (g > 130) & (g > r * 1.5) & (g > b * 1.3),
        "amber": ok & (r > 170) & (g > 110) & (b < 90) & (r > b * 2),
        "cyan": ok & (g > 140) & (b > 110) & (r < g * 0.75) & (b > r * 1.2) & (b < g * 1.4),
    }


def merge_row(boxes: list[list[int]]) -> list[list[int]]:
    """Boxes [x, y, w, h, lit] on the same text row are one display. A '1' lights only its two right-hand bars, which leaves a wide empty gap
    before the next digit, so one display often arrives as several pieces. Pieces that overlap >= 60 % vertically and are no further apart
    than 1.3 x the digit height are joined."""
    bl = [list(b) for b in boxes]
    again = True
    while again:
        again = False
        for i in range(len(bl)):
            for j in range(i + 1, len(bl)):
                a, b = bl[i], bl[j]
                oy = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
                if oy < 0.6 * min(a[3], b[3]):
                    continue
                gap = max(a[0], b[0]) - min(a[0] + a[2], b[0] + b[2])
                if gap > 1.3 * max(a[3], b[3]):
                    continue
                x0, y0 = min(a[0], b[0]), min(a[1], b[1])
                x1, y1 = max(a[0] + a[2], b[0] + b[2]), max(a[1] + a[3], b[1] + b[3])
                bl[i] = [x0, y0, x1 - x0, y1 - y0, a[4] + b[4]]
                del bl[j]
                again = True
                break
            if again:
                break
    return bl


def led_blobs(img: np.ndarray) -> list[tuple[int, int, int, int, int, str]]:
    """(x, y, w, h, lit pixels, colour) of every wide, dense lit blob, biggest first."""
    H, W = img.shape[:2]
    out = []
    for name, m in led_masks(img).items():
        m8 = m.astype(np.uint8) * 255
        k = max(5, int(W * 0.006))
        joined = cv2.dilate(m8, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))  # join the bars of one digit
        n, _, stats, _ = cv2.connectedComponentsWithStats(joined)
        pieces = []
        for i in range(1, n):
            x, y, w, h, _ = stats[i]
            sub = m8[y : y + h, x : x + w]
            ys, xs = np.nonzero(sub)
            if len(xs) < 30 or h < 0.02 * H:
                continue
            pieces.append([int(x + xs.min()), int(y + ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1), int(len(xs))])
        for x, y, w, h, lit in merge_row(pieces):
            if lit < 150 or w < 0.06 * W or h < 0.025 * H or not (1.0 <= w / h <= 9) or w > 0.9 * W:
                continue
            out.append((int(x), int(y), int(w), int(h), int(lit), name))
    return sorted(out, key=lambda b: -b[4])


_FIX = str.maketrans({"O": "0", "o": "0", "Q": "0", "D": "0", "I": "1", "l": "1", "|": "1", ",": ".", " ": ""})


def parse_number(text: str) -> Optional[str]:
    """'112.2' -> '112.2'. Only a text that is entirely a number (digits, one dot) counts: labels such as 'Max 1000kg' never do."""
    t = (text or "").translate(_FIX)
    if not re.fullmatch(r"\d{1,7}(\.\d{1,3})?|\.\d{1,3}", t):
        if DECIMALS and re.fullmatch(r"\d{%d,8}" % (DECIMALS + 1), t):  # the dot was lost
            return t[:-DECIMALS] + "." + t[-DECIMALS:]
        return None
    if "." not in t and DECIMALS and len(t) > DECIMALS:
        t = t[:-DECIMALS] + "." + t[-DECIMALS:]
    if "." not in t and REQUIRE_DECIMAL:
        return None
    return t


def run_ocr(img: np.ndarray):
    res, _ = ocr(img)
    out = []
    for box, text, conf in res or []:
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        out.append({"text": str(text), "conf": float(conf), "x0": min(xs), "x1": max(xs), "y0": min(ys), "y1": max(ys)})
    return out


def upscale(crop: np.ndarray, target_h: int = 220) -> np.ndarray:
    h, w = crop.shape[:2]
    k = target_h / max(1, h)
    if w * k > 3200:
        k = 3200 / w
    return cv2.resize(crop, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC) if k > 1.05 else crop


def variants(crop: np.ndarray):
    """The same display crop prepared a few ways. Each one is an independent read; the number must come out the same from several of them."""
    big = upscale(crop)
    yield "colour", big
    yield "colour-wide", cv2.copyMakeBorder(big, 40, 40, 80, 80, cv2.BORDER_REPLICATE)
    gray = cv2.cvtColor(big, cv2.COLOR_BGR2GRAY)
    yield "gray", cv2.cvtColor(cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX), cv2.COLOR_GRAY2BGR)


def read_weight(img: np.ndarray) -> dict:
    img = shrink(img)
    H, W = img.shape[:2]
    reads = []  # (number, confidence, where)
    heights = []

    def collect(boxes, where, region=None, norm=None):
        for b in boxes:
            n = parse_number(b["text"])
            if n is None:
                continue
            if region is not None and norm is not None:
                # region = the lit blob as a fraction of the crop (x, y, w, h); the box centre must be inside it (a little slack)
                cx, cy = (b["x0"] + b["x1"]) / 2 / norm[0], (b["y0"] + b["y1"]) / 2 / norm[1]
                sx, sy = region[2] * 0.15, region[3] * 0.25
                if not (region[0] - sx <= cx <= region[0] + region[2] + sx and region[1] - sy <= cy <= region[1] + region[3] + sy):
                    continue
            reads.append((n, b["conf"], where, b["text"]))
            heights.append(b["y1"] - b["y0"])

    blobs = led_blobs(img)
    tried = []
    for (x, y, w, h, lit, colour) in blobs[:3]:
        # The same display is read with different amounts of surrounding panel: the OCR is context sensitive, a very tight crop sometimes loses a
        # narrow leading "1" (112.2 -> 12.2), more context does not. The number must come out the same from several of these reads.
        for fx, fy in PADS:
            padx, pady = int(w * fx), int(h * fy)
            x0, y0 = max(0, x - padx), max(0, y - pady)
            x1, y1 = min(W, x + w + padx), min(H, y + h + pady)
            crop = img[y0:y1, x0:x1]
            tried.append(f"{colour} display {x1 - x0}x{y1 - y0}")
            for name, v in variants(crop):
                # only text that sits on the lit display counts: the panel labels around it are ignored
                collect(run_ocr(v), f"{colour}:{fx}:{name}", region=((x - x0) / max(1, x1 - x0), (y - y0) / max(1, y1 - y0), w / max(1, x1 - x0), h / max(1, y1 - y0)), norm=(v.shape[1], v.shape[0]))
        if reads:
            break  # the lit display gave numbers: other blobs are not needed
    if not reads:
        # no lit display found (LCD / unusual): read the whole photo and trust only a number written in big characters
        tried.append("whole photo")
        boxes = run_ocr(img)
        nums = [(b, parse_number(b["text"])) for b in boxes]
        nums = [(b, n) for b, n in nums if n is not None]
        if nums:
            tallest = max(b["y1"] - b["y0"] for b, _ in nums)
            for b, n in nums:
                if b["y1"] - b["y0"] >= 0.6 * tallest:
                    reads.append((n, b["conf"], "photo", b["text"]))

    if not reads:
        return {"value": None, "unit": None, "confidence": None, "text": None, "engine": "rapidocr", "reason": "No weight could be read from the display. Retake a clear photo with the whole display in view"}

    votes = defaultdict(lambda: {"n": 0, "conf": 0.0, "text": ""})
    for n, c, where, text in reads:
        votes[n]["n"] += 1
        votes[n]["conf"] += c
        votes[n]["text"] = votes[n]["text"] or text
    ranked = sorted(votes.items(), key=lambda kv: (-kv[1]["n"], -kv[1]["conf"]))
    # The commonest OCR slip on a 7-segment display is a LOST narrow digit (the leading "1" of 112.2 read as 12.2), almost never an invented one.
    # When a shorter reading is the longer one with one digit removed, and the longer one was read more than once, the longer one is the display.
    def lost_digit(short: str, long: str) -> bool:
        a, b = short.replace(".", ""), long.replace(".", "")
        return len(b) == len(a) + 1 and any(b[:i] + b[i + 1 :] == a for i in range(len(b))) and (short.count(".") == long.count("."))
    for long_v, long_s in list(votes.items()):
        if long_s["n"] >= 2 and any(lost_digit(sv, long_v) and long_s["n"] * 2 >= ss["n"] for sv, ss in votes.items() if sv != long_v):
            for sv in [sv for sv in votes if sv != long_v and lost_digit(sv, long_v)]:
                votes[long_v]["n"] += votes[sv]["n"]
                votes[long_v]["conf"] += votes[sv]["conf"]
                del votes[sv]
    ranked = sorted(votes.items(), key=lambda kv: (-kv[1]["n"], -kv[1]["conf"]))
    value, top = ranked[0]
    if len(ranked) > 1 and top["n"] < ranked[1][1]["n"] * 2:
        return {"value": None, "unit": None, "confidence": None, "text": top["text"], "engine": "rapidocr",
                "reason": f"The display could be read as {value} or {ranked[1][0]}. Retake a clearer photo"}
    if top["n"] < MIN_AGREE:
        return {"value": None, "unit": None, "confidence": None, "text": top["text"], "engine": "rapidocr",
                "reason": f"The reading {value} was not confirmed by a second read of the photo. Retake a clearer photo"}
    total = sum(v["n"] for v in votes.values())
    agree = top["n"] / total * 100
    conf = round(min(99.0, 0.5 * (top["conf"] / top["n"] * 100) + 0.5 * agree), 1)
    return {"value": float(value), "unit": None, "confidence": conf, "text": top["text"], "engine": "rapidocr", "reason": None,
            "reads": top["n"], "from": tried}


# ----------------------------------------------------------------------------------------------------------------------- QR
def qr_decode(img: np.ndarray) -> Optional[str]:
    det = cv2.QRCodeDetector()
    aruco = cv2.QRCodeDetectorAruco() if hasattr(cv2, "QRCodeDetectorAruco") else None

    def attempt(a: np.ndarray) -> Optional[str]:
        for d in (det, aruco):
            if d is None:
                continue
            try:
                text, pts, _ = d.detectAndDecode(a)
            except cv2.error:
                continue
            if text and text.strip():
                return text.strip()
        return None

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    H, W = gray.shape
    steps = []
    for s in (1.0, 1.6, 0.6, 2.2):
        steps.append(("full", s, gray if s == 1.0 else cv2.resize(gray, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC if s > 1 else cv2.INTER_AREA)))
    for name, s, g in steps:
        for variant in (g, cv2.createCLAHE(2.0, (8, 8)).apply(g), cv2.threshold(g, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]):
            r = attempt(variant)
            if r:
                return r
    # small QR sticker in a big photo: look at overlapping tiles, enlarged
    for frac in (0.5, 0.35):
        tw, th = int(W * frac), int(H * frac)
        for y in range(0, max(1, H - th + 1), max(1, th // 2)):
            for x in range(0, max(1, W - tw + 1), max(1, tw // 2)):
                tile = gray[y : y + th, x : x + tw]
                tile = cv2.resize(tile, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
                for variant in (tile, cv2.createCLAHE(2.0, (8, 8)).apply(tile)):
                    r = attempt(variant)
                    if r:
                        return r
    # sideways / upside-down sticker
    for rot in (cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_180, cv2.ROTATE_90_COUNTERCLOCKWISE):
        r = attempt(cv2.rotate(gray, rot))
        if r:
            return r
    return None


# ------------------------------------------------------------------------------------------------------------------- routes
@app.get("/health")
def health():
    return {"ok": True}


@app.post("/weight")
def weight(req: Req):
    return read_weight(decode(req.image))


@app.post("/qr")
def qr(req: Req):
    v = qr_decode(shrink(decode(req.image), 3000))
    return {"found": v is not None, "value": v}
