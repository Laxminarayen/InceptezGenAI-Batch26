import joblib
import numpy as np
import json
from pathlib import Path
import pandas as pd
from flask import Flask, jsonify, request, render_template

model = joblib.load('/Users/laxminarayen/Documents/InceptezGenAI-Batch26/28. Ensemble Learning - Random Forest/StreamlitApp/rf_model.joblib')
scaler = joblib.load('/Users/laxminarayen/Documents/InceptezGenAI-Batch26/28. Ensemble Learning - Random Forest/StreamlitApp/scaler.joblib')
metadata = json.load(open('/Users/laxminarayen/Documents/InceptezGenAI-Batch26/28. Ensemble Learning - Random Forest/StreamlitApp/metadata_rfs.json', 'r'))
feature_cols = metadata['feature_cols']
RAW_NUMERIC_COLS = metadata['raw_numeric_cols']
app = Flask(__name__)
                    
def build_feature_row(payload):
    machine_type = payload.get('machine_type', 'H')
    type_l = 1 if machine_type == 'L' else 0
    type_m = 1 if machine_type == 'M' else 0
    raw_values = [float(payload[col]) for col in RAW_NUMERIC_COLS]
    row = np.array([raw_values + [type_l, type_m]])
    X_raw = pd.DataFrame(row, columns=feature_cols)
    X_scaled = scaler.transform(X_raw)
    return X_scaled

@app.route('/')
def home():
    return render_template('index.html',raw_numeric_cols=RAW_NUMERIC_COLS)

@app.route('/predict', methods=['POST']) #Using post method to send data to the server. This is more secure than using GET method, as the data is sent in the body of the request, rather than in the URL. This means that the data is not visible in the browser's address bar, and is less likely to be logged by servers or proxies.
def predict():
    payload = request.get_json()
    missing = [col for col in RAW_NUMERIC_COLS + ['machine_type'] if col not in payload]
    if missing:
        return jsonify({'error': f'Missing columns: {missing}'}), 400
    row_scaled = build_feature_row(payload)
    print("-"*100)
    print(row_scaled)
    print("-"*100)
    print(model.predict(row_scaled)[0])
    print("-"*100)
    prediction = model.predict(row_scaled)[0]
    prob_failure = model.predict_proba(row_scaled)[0].max()
    return jsonify({'prediction': prediction, 'failure_probability': round(prob_failure, 2)})

if __name__ == '__main__': #this will run first why you need a main function in flask app because it is the entry point of the application. When you run the script directly, the code inside this block will execute. If the script is imported as a module in another script, the code inside this block will not execute. This allows you to control the behavior of your script based on how it is being used.
    app.run(debug=True,port = 5001) #debug=True will automatically reload the server when you make changes to the code. This is useful during development, as it allows you to see the effects of your changes without having to manually restart the server.