import base64
from io import BytesIO
from pathlib import Path

import torch
from flask import Flask, render_template, request, jsonify
from PIL import Image, UnidentifiedImageError
from torchvision import transforms

from model import CatDogCNN


MODEL_PATH = Path(__file__).parent / "cat_dog_model.pth"
LABELS = ["Cat", "Dog"]

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024  # Limit upload size to 16MB

if not MODEL_PATH.exists():
    raise FileNotFoundError(f"Model file not found at {MODEL_PATH}. Please ensure you train and save the model from colab ntoebook.")

model = CatDogCNN()
model.load_state_dict(torch.load(MODEL_PATH, map_location=torch.device('cpu')))
model.eval()

preprocess = transforms.Compose([
    transforms.Resize((128, 128)),
    transforms.ToTensor(),
])

@app.route('/', methods=['GET','POST'])
def home():
    prediction = None
    score = None
    preview = None
    error = None
    if request.method == 'POST':
        uploaded = request.files.get('image')
        if not uploaded:
            return jsonify({"error": "No file uploaded"}), 400
        elif Path(uploaded.filename).suffix.lower() not in ['.jpg', '.jpeg', '.png']:
            return jsonify({"error": "Invalid file type. Please upload a JPG or PNG image."}), 400
        else: 
            try: 
                with Image.open(uploaded.stream) as original:
                    if original.width * original.height > 5 * 1024 * 1024:
                        return jsonify({"error": "Image size exceeds 5MB limit."}), 400
                    image = original.convert('RGB')
                    x = preprocess(image).unsqueeze(0)  # Add batch dimension
                    with torch.inference_mode():
                        probabilities = torch.softmax(model(x), dim=1)[0]
                        class_index = int(probabilities.argmax().item())
                        prediction = LABELS[class_index]
                        score = round(float(probabilities[class_index].item()) * 100, 1)
                        buffer = BytesIO()
                        image.save(buffer, format="JPEG")
                        preview = base64.b64encode(buffer.getvalue()).decode('ascii')
            except (UnidentifiedImageError, OSError, ValueError):
                error = "Invalid image file. Please upload a valid JPG or PNG image."
            
        return render_template('index.html', prediction=prediction, score=score, preview=preview, error=error)

if __name__ == '__main__':
    app.run(host = "127.0.0.1", port = 5000, debug = True)