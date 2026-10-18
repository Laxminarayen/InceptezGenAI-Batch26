import joblib
import os
import numpy as np
from flask import Flask, render_template, request

app = Flask(__name__)

Model_PATH = "model_bundle.joblib"
bundle = joblib.load(Model_PATH)

model = bundle['model']
features = bundle['features']
cluster_labels = bundle['cluster_labels']
cluster_summary = bundle['cluster_summary']
training_ranges = bundle['training_ranges']

@app.route('/',methods=["GET","POST"])
def index():
    prediction = None
    error = None
    form_values = {
        "age": "",
        "income": "",
        "spending": "", 
    }
    print("Inside here")
    if request.method == 'POST':
        try: 
            age = float(request.form['age'])
            income = float(request.form['income'])
            spending = float(request.form['spending'])
            
            form_values = {
                "age": age,
                "income": income,
                "spending": spending,
            }
            age_min, age_max = training_ranges['Age']
            income_min, income_max = training_ranges['Annual_Income']
            spending_min, spending_max = training_ranges['Spending_Score']
            if not (age_min <= age <= age_max):
                raise ValueError(f"Age must be between {age_min} and {age_max}.")
            if not (income_min <= income <= income_max):
                raise ValueError(f"Income must be between {income_min} and {income_max}.")
            if not (spending_min <= spending <= spending_max):
                raise ValueError(f"Spending Score must be between {spending_min} and {spending_max}.")

            customer = np.array([[age, income, spending]])
            cluster_id = model.predict(customer)[0]
            segment = cluster_labels[cluster_id]
            
            center = model.cluster_centers_[cluster_id]
            prediction = {
                "segment": segment,
                "cluster_id": cluster_id,
                "age": age,
                "income": income,
                "spending": spending,
                "center_age": round(float(center[0]), 1),
                "center_income": round(float(center[1]), 1),
                "center_spending": round(float(center[2]), 1),
            }
        except (ValueError, KeyError) as exc:
            error = str(exc)         
    return render_template("index.html", prediction=prediction, error=error, form_values=form_values,cluster_summary=cluster_summary, training_ranges=training_ranges)  

@app.route("/health", methods=["GET"])
def health():
    return {"status": "ok"}

if __name__ == "__main__":
    app.run(host = "0.0.0.0", port = int(os.getenv("PORT",8080)), debug = True)