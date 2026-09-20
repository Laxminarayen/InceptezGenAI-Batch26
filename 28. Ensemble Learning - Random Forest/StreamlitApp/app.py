import streamlit as st
import joblib
import numpy as np 
import pandas as pd
import json 

rf_model = joblib.load('rf_model.joblib')
scaler = joblib.load('scaler.joblib')
metadata = json.load(open('metadata_rfs.json', 'r'))

st.set_page_config(page_title="Predictive Maintenenace - Random Forest")
# x = st.slider("Select a value")
# st.write(x, "squared is", x * x)
feature_cols = metadata['feature_cols']
stats = metadata['feature_stats']

st.title("Predictive Maintenance - Random Forest")
st.write("This is a simple web application to predict the probability of failure of a machine using a Random Forest model.")

air_temp = st.number_input("Air Temperature [K]", value=round(stats['Air temperature [K]']['mean'], 1))
process_temp = st.number_input("Process Temperature [K]", value=round(stats['Process temperature [K]']['mean'], 1))
rpm = st.number_input("Rotational Speed [rpm]", value=round(stats['Rotational speed [rpm]']['mean'], 1))
torque = st.number_input("Torque [Nm]", value=round(stats['Torque [Nm]']['mean'], 1))
tool_wear = st.number_input("Tool Wear [min]", value=round(stats['Tool wear [min]']['mean'], 1))
type_choice = st.selectbox("Product Quality Type", options=metadata['type_categories'], index=1)

if st.button("Predict"):
    raw_row = {
        "Air temperature [K]": air_temp,
        "Process temperature [K]": process_temp,
        "Rotational speed [rpm]": rpm,
        "Torque [Nm]": torque,
        "Tool wear [min]": tool_wear,
        "Type_L": 1 if type_choice == "L" else 0,
        "Type_M": 1 if type_choice == "M" else 0,
    }
    X_raw = pd.DataFrame([raw_row], columns=feature_cols)
    X_scaled = scaler.transform(X_raw)
    prediction = rf_model.predict(X_scaled)[0]
    prob_failure = rf_model.predict_proba(X_scaled)[0].max()
    
    st.subheader(f"Prediction Result: {prediction}")
    st.subheader(f"Probability of Failure: {prob_failure:.2f}")