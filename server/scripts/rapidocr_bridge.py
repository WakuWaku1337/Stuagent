"""RapidOCR bridge for the document OCR pipeline.

Usage: python scripts/rapidocr_bridge.py <page-image>
Output: JSON {engine, text, confidence, lines:[{text,confidence}]} on stdout.
Requires: python -m pip install rapidocr onnxruntime
"""

import json
import sys


def load_engine():
    try:
        from rapidocr import RapidOCR

        return RapidOCR(), "rapidocr"
    except ImportError:
        from rapidocr_onnxruntime import RapidOCR

        return RapidOCR(), "rapidocr_onnxruntime"


def normalize(result):
    """RapidOCR 3.x returns an object with boxes/txts/scores; 1.x returns [box, text, score]."""
    lines = []
    if result is None:
        return lines, []
    if hasattr(result, "txts"):
        texts = list(result.txts or [])
        scores = list(result.scores or [])
        boxes = list(result.boxes or [])
        for index, text in enumerate(texts):
            score = float(scores[index]) if index < len(scores) else 0.0
            box = boxes[index] if index < len(boxes) else None
            lines.append((box, str(text), score))
    else:
        rows = result[0] if isinstance(result, tuple) else result
        for row in rows or []:
            if not row or len(row) < 3:
                continue
            lines.append((row[0], str(row[1]), float(row[2])))
    return lines


def reading_order(lines):
    def top(line):
        box = line[0]
        if not box:
            return 0.0
        ys = [float(point[1]) for point in box]
        return sum(ys) / len(ys)

    def left(line):
        box = line[0]
        if not box:
            return 0.0
        xs = [float(point[0]) for point in box]
        return min(xs)

    ordered = sorted(lines, key=lambda line: (round(top(line) / 18), left(line)))
    out = []
    for _, text, score in ordered:
        text = text.strip()
        if text:
            out.append({"text": text, "confidence": round(score, 4)})
    return out


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: rapidocr_bridge.py <image>")
    engine, name = load_engine()
    result = engine(sys.argv[1])
    lines = reading_order(normalize(result))
    text = "\n".join(line["text"] for line in lines)
    confidence = (
        round(sum(line["confidence"] for line in lines) / len(lines), 4) if lines else 0.0
    )
    print(json.dumps({"engine": name, "text": text, "confidence": confidence, "lines": lines}, ensure_ascii=False))


if __name__ == "__main__":
    main()
