import torch
from flask import Flask, request, jsonify, render_template_string

from model import load_model

app = Flask(__name__)
model = load_model()

PAGE = """
<!doctype html>
<title>Salary Predictor</title>
<body style="font-family: sans-serif; max-width: 420px; margin: 40px auto;">
  <h1>Salary Predictor</h1>
  <p>A tiny neural network that guesses salary from years of experience.</p>

  <form method="post" action="/predict">
    Years of experience:
    <input type="number" name="experience" step="0.5" min="0" value="5">
    <button type="submit">Predict</button>
  </form>

  {% if salary %}
    <h2>Predicted salary: Rs {{ "{:,.0f}".format(salary) }}</h2>
  {% endif %}
</body>
"""

def predict_salary(experience):
    x = torch.tensor([[float(experience)]], dtype=torch.float32)
    with torch.no_grad():
        salary = model(x).item()
    return salary * 1000

@app.route("/")
def index():
    return render_template_string(PAGE,salary=None)


@app.route("/predict", methods=["POST"])
def predict_form():
    experience = float(request.form["experience"])
    salary = predict_salary(experience)
    return render_template_string(PAGE, salary=salary)

@app.route("/api/predict", methods=["POST"])
def predict_api():
    data = request.get_json()
    experience = data["experience"]
    salary = predict_salary(experience)
    return jsonify({"experience":experience, "salary": salary})

@app.route("/health")
def health():
    return jsonify({"status": "ok"})

if __name__ == "__main__":
    app.run(host="0.0.0.0",port = 8080)
