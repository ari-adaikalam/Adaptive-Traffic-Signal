"""Trains the vehicle detector on the training set made by web/tools/collect-run.mjs (see docs/detector.md).

Run it with the Python that has ultralytics in it (it is not a dependency of the project):  ~/venvs/detect/bin/python tools/train_detector.py [--epochs 30] [--fraction 1.0] [--name run1]

What it does, and does not, do:
- It trains on datasets/detection/train and watches datasets/detection/val. It never reads the test sets (test and test-heldout), so nothing here can be tuned to them.
- It stops early when the validation score has not improved for `patience` epochs, and keeps the best epoch by the validation score, so a model that has begun to memorise the training pictures is not the one kept.
- The picture is not flipped left to right: traffic drives on one side, and a mirrored road is a different road.
- It writes the settings it used next to the results, so the run can be repeated and the numbers in the docs can name the command and the dataset.
"""
import argparse
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "datasets" / "detection"
NAMES = ["cars", "trucks", "buses", "bikes"]  # the controller's four count fields, in the order of web/src/detection/labels.js


def write_yaml(path, splits):
    """A dataset file naming the splits it may read. Training gets only train and val."""
    lines = [f"path: {DATA}"] + [f"{key}: {value}/images" for key, value in splits.items()] + ["names:"] + [f"  {i}: {n}" for i, n in enumerate(NAMES)]
    path.write_text("\n".join(lines) + "\n")
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--patience", type=int, default=6)
    parser.add_argument("--fraction", type=float, default=1.0, help="share of the training pictures to use (a small value is for a quick check)")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--model", default="yolo11n.pt", help="the starting weights: a small network, pretrained on COCO (general photos), which is then trained on this set")
    parser.add_argument("--name", default="run1")
    parser.add_argument("--device", default=None)
    args = parser.parse_args()

    import torch
    from ultralytics import YOLO, __version__

    device = args.device or ("mps" if torch.backends.mps.is_available() else "cpu")
    (ROOT / "runs").mkdir(exist_ok=True)
    out = ROOT / "runs" / "detect"
    yaml = write_yaml(ROOT / "runs" / f"{args.name}-data.yaml", {"train": "train", "val": "val"})
    model = YOLO(args.model)
    settings = dict(data=str(yaml), epochs=args.epochs, patience=args.patience, imgsz=args.imgsz, batch=args.batch, device=device, project=str(out), name=args.name, exist_ok=True,
                    seed=0, deterministic=True, fraction=args.fraction, fliplr=0.0, flipud=0.0, workers=4, plots=True, val=True, cos_lr=False, close_mosaic=5)
    (ROOT / "runs" / f"{args.name}-settings.json").write_text(json.dumps({**settings, "ultralytics": __version__, "torch": torch.__version__, "python": sys.version.split()[0],
                                                                         "dataset_images": {s: len(list((DATA / s / "images").glob("*.jpg"))) for s in ("train", "val")}}, indent=2))
    model.train(**settings)


if __name__ == "__main__":
    main()
