"""Exports a trained detector to ONNX, for the page (onnxruntime-web) and for the evaluation (web/tools/detect-eval.mjs).  ~/venvs/detect/bin/python tools/export_detector.py runs/detect/run1/weights/best.pt out.onnx [--half]

The input is 640 wide and its height is a multiple of 32 (every crop is 128 or 160 high at that width, see docs/detector.md), so the height is left free (`dynamic`) and the network runs on about a
quarter of the pixels of a square 640 picture. The output is [1, 4 + classes, boxes]: the middle and size of each box in input pixels, then a score for each class. The boxes are not de-duplicated in the
network: web/src/detection/postprocess.js does that, in the same code for the page and for the evaluation."""
import argparse
import pathlib
import shutil

from ultralytics import YOLO

parser = argparse.ArgumentParser()
parser.add_argument("weights")
parser.add_argument("out")
parser.add_argument("--half", action="store_true", help="16 bit weights: half the file, for the page")
parser.add_argument("--imgsz", type=int, nargs=2, default=[160, 640], help="height and width the network is traced at")
args = parser.parse_args()

path = YOLO(args.weights).export(format="onnx", imgsz=args.imgsz, dynamic=True, simplify=True, opset=17, half=args.half, nms=False, device="cpu")
if pathlib.Path(path).resolve() != pathlib.Path(args.out).resolve():
    shutil.copy(path, args.out)
print(pathlib.Path(args.out).stat().st_size / 1e6, "MB", args.out)
