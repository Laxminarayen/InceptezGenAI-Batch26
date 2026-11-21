"""CPU-only CIFAR-10 image classifier for a small Ubuntu EC2 instance.

Accepts common image formats and arbitrary input dimensions (within upload/
image-pixel limits), automatically resizes them to the ONNX model's *actual*
input resolution, and applies the same ImageNet normalization as train.ipynb.
"""

import json
import logging
from pathlib import Path

import numpy as np
import onnxruntime as ort
from flask import Flask, jsonify, render_template_string, request
from PIL import Image, ImageOps, UnidentifiedImageError

BASE_DIR = Path(__file__).resolve().parent
MAX_UPLOAD_MB = 8
MAX_IMAGE_PIXELS = 12_000_000  # Prevent large decompression/memory spikes on 1 GiB EC2.
DEFAULT_MEAN = [0.485, 0.456, 0.406]  # train.ipynb ImageNet normalization
DEFAULT_STD = [0.229, 0.224, 0.225]
DEFAULT_SIZE = [128, 128]  # Only used if ONNX spatial dimensions are dynamic.
logger = logging.getLogger(__name__)


def find_artifacts():
    """Support both artifacts/model.onnx and model.onnx in the project root."""
    for folder in (BASE_DIR / "artifacts", BASE_DIR):
        model = folder / "model.onnx"
        labels = folder / "classes.json"
        if model.is_file() and labels.is_file():
            return model, labels
    raise FileNotFoundError(
        "Could not find model.onnx and classes.json together in "
        f"{BASE_DIR / 'artifacts'} or {BASE_DIR}. "
        "Copy both files from the same training run into one of those folders."
    )


MODEL_PATH, CLASSES_PATH = find_artifacts()
with CLASSES_PATH.open("r", encoding="utf-8") as f:
    raw_metadata = json.load(f)

# New train.ipynb exports an object with labels + preprocessing; older exports
# may be a plain JSON list of the 10 labels.
if isinstance(raw_metadata, list):
    CLASS_NAMES = raw_metadata
    metadata = {}
    logger.warning("Legacy classes.json list; using notebook's default mean/std.")
elif isinstance(raw_metadata, dict):
    metadata = raw_metadata
    CLASS_NAMES = metadata.get("classes", metadata.get("class_names"))
else:
    raise ValueError("classes.json must be a list or an object with a 'classes' list")

if (not isinstance(CLASS_NAMES, list) or len(CLASS_NAMES) != 10
        or not all(isinstance(name, str) and name for name in CLASS_NAMES)):
    raise ValueError("classes.json must contain exactly 10 valid CIFAR-10 class labels")

MEAN = np.asarray(metadata.get("mean", DEFAULT_MEAN), dtype=np.float32)
STD = np.asarray(metadata.get("std", DEFAULT_STD), dtype=np.float32)
if (MEAN.shape != (3,) or STD.shape != (3,)
        or not np.all(np.isfinite(MEAN)) or not np.all(np.isfinite(STD))
        or not np.all(STD > 0)):
    raise ValueError("Invalid mean/std values in classes.json")

# Constrain ONNX Runtime thread counts to protect t2.micro/t3.micro memory/CPU.
opts = ort.SessionOptions()
opts.intra_op_num_threads = 1
opts.inter_op_num_threads = 1
opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
SESSION = ort.InferenceSession(
    str(MODEL_PATH), sess_options=opts, providers=["CPUExecutionProvider"]
)
input_info = SESSION.get_inputs()[0]
INPUT_NAME = input_info.name
INPUT_SHAPE = input_info.shape
if len(INPUT_SHAPE) != 4:
    raise ValueError(f"Expected a 4D image input, got {INPUT_SHAPE}")
if input_info.type != "tensor(float)":
    raise ValueError(f"Expected float32 model input, got {input_info.type}")


def positive_size(value, fallback):
    return int(value) if isinstance(value, int) and value > 0 else int(fallback)


fallback_size = metadata.get("input_size", DEFAULT_SIZE)  # [height, width]
if (not isinstance(fallback_size, (list, tuple)) or len(fallback_size) != 2
        or not all(isinstance(x, int) and x > 0 for x in fallback_size)):
    fallback_size = DEFAULT_SIZE

# Determine channel layout and fixed size from the actual ONNX model, not from
# a hardcoded 224 or an old classes.json.
if INPUT_SHAPE[1] == 3:
    LAYOUT = "NCHW"
    HEIGHT = positive_size(INPUT_SHAPE[2], fallback_size[0])
    WIDTH = positive_size(INPUT_SHAPE[3], fallback_size[1])
elif INPUT_SHAPE[3] == 3:
    LAYOUT = "NHWC"
    HEIGHT = positive_size(INPUT_SHAPE[1], fallback_size[0])
    WIDTH = positive_size(INPUT_SHAPE[2], fallback_size[1])
else:
    raise ValueError(f"Cannot identify 3-channel ONNX image input: {INPUT_SHAPE}")

logger.warning("Model input shape: %s; resizing uploads to %sx%s (%s)",
               INPUT_SHAPE, WIDTH, HEIGHT, LAYOUT)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CIFAR-10 Image Classifier</title>
<style>
body{font-family:system-ui,Arial,sans-serif;background:#f5f7fb;margin:0;padding:24px;color:#1b2330}
main{max-width:540px;margin:6vh auto;padding:28px;background:#fff;border-radius:14px;box-shadow:0 3px 20px #0001}
h1{margin-top:0}input{display:block;margin:18px 0;width:100%;max-width:100%}
button{background:#175cd3;color:white;border:0;padding:11px 22px;border-radius:8px;cursor:pointer}
small,.muted{color:#626f82}.result{margin-top:24px;border-top:1px solid #ddd;padding-top:14px}
li{margin:8px 0}.error{color:#b42318}
</style></head><body><main>
<h1>CIFAR-10 Image Classifier</h1>
<p class="muted">Upload a photo of any dimensions. The app automatically resizes it to {{ width }} × {{ height }} and predicts one of the ten CIFAR-10 categories.</p>
<form method="POST" enctype="multipart/form-data">
<input type="file" name="image" accept="image/*" required>
<button type="submit">Classify image</button></form>
<small>PNG, JPEG, WEBP, BMP, GIF or TIFF if supported by Pillow. Up to {{ max_mb }} MB and 12 megapixels.</small>
{% if error %}<p class="error">{{ error }}</p>{% endif %}
{% if predictions %}<div class="result">
<h2>Prediction: {{ predictions[0].label }}</h2>
<p>Model score: {{ predictions[0].confidence }}%</p>
<ol>{% for item in predictions %}<li>{{ item.label }} — {{ item.confidence }}%</li>{% endfor %}</ol>
<p class="muted"><small>CIFAR-10 can only predict {{ classes|join(', ') }}. A photo outside these classes is still assigned one of them; the score is not a guarantee of correctness.</small></p>
</div>{% endif %}
</main></body></html>"""


def render_page(predictions=None, error=None):
    return render_template_string(
        PAGE, predictions=predictions, error=error, classes=CLASS_NAMES,
        width=WIDTH, height=HEIGHT, max_mb=MAX_UPLOAD_MB
    )


def prepare_image(file_storage):
    """Decode, EXIF-rotate, handle transparency, resize and normalize a photo."""
    if file_storage is None or not file_storage.filename:
        raise ValueError("Choose an image to upload (field name: image).")
    try:
        with Image.open(file_storage.stream) as raw:
            if raw.width * raw.height > MAX_IMAGE_PIXELS:
                raise ValueError("Image exceeds the 12-megapixel safety limit.")
            # For animated GIF / multipage TIFF use the first frame.
            raw.seek(0)
            image = ImageOps.exif_transpose(raw)
            if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
                # Composite transparency on white rather than implicitly black.
                rgba = image.convert("RGBA")
                background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
                image = Image.alpha_composite(background, rgba).convert("RGB")
            else:
                image = image.convert("RGB")
            # Match torchvision.transforms.Resize((HEIGHT, WIDTH)) in train.ipynb.
            image = image.resize((WIDTH, HEIGHT), resample=Image.Resampling.BILINEAR)
            pixels = np.asarray(image, dtype=np.float32) / 255.0
    except ValueError:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Unsupported or damaged image. Try JPG, PNG or WEBP.") from exc

    pixels = (pixels - MEAN) / STD
    if LAYOUT == "NCHW":
        pixels = np.transpose(pixels, (2, 0, 1))
    batch = np.ascontiguousarray(pixels[None, ...], dtype=np.float32)
    return batch


def predict(file_storage):
    batch = prepare_image(file_storage)
    # Prevent the 224-vs-128 error before calling ONNX Runtime.
    for got, expected in zip(batch.shape, INPUT_SHAPE):
        if isinstance(expected, int) and got != expected:
            raise RuntimeError(f"Preprocessing produced {batch.shape}, but ONNX expects {INPUT_SHAPE}")
    raw = SESSION.run(None, {INPUT_NAME: batch})[0]
    logits = np.asarray(raw, dtype=np.float64).reshape(-1)
    if logits.size != len(CLASS_NAMES) or not np.all(np.isfinite(logits)):
        raise RuntimeError("Unexpected model output. Check model.onnx and classes.json.")
    exps = np.exp(logits - logits.max())
    scores = exps / exps.sum()
    top = np.argsort(scores)[::-1][:3]
    return [{"label": CLASS_NAMES[int(i)], "confidence": round(float(scores[i] * 100), 2)}
            for i in top]


@app.get("/")
def index():
    return render_page()


@app.post("/")
def predict_html():
    try:
        return render_page(predictions=predict(request.files.get("image")))
    except ValueError as exc:
        return render_page(error=str(exc)), 400
    except Exception:
        app.logger.exception("Image prediction failed")
        return render_page(error="Inference failed. Check EC2 server logs."), 500


@app.post("/api/predict")
def predict_api():
    try:
        results = predict(request.files.get("image"))
        return jsonify({"prediction": results[0]["label"], "predictions": results})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        app.logger.exception("API prediction failed")
        return jsonify({"error": "Inference failed. Check EC2 server logs."}), 500


@app.get("/health")
def health():
    return jsonify({
        "status": "ok", "model_input": INPUT_SHAPE,
        "preprocessing": {"width": WIDTH, "height": HEIGHT, "layout": LAYOUT},
        "classes": CLASS_NAMES,
    })


@app.errorhandler(413)
def too_large(_exc):
    message = f"Upload too large (maximum {MAX_UPLOAD_MB} MB)."
    if request.path.startswith("/api/"):
        return jsonify({"error": message}), 413
    return render_page(error=message), 413


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=False) #It will make the server utizite its own public IP address and port 8000, and debug mode is turned off for production use.
