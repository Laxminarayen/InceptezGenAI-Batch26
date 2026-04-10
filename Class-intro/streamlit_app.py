import streamlit as st
import pandas as pd
import datetime
import os

# File to store data
DATA_FILE = "survey_data.csv"

# Password for visualization tab
VIS_PASSWORD = "admin123"

st.set_page_config(page_title="Professional Survey", layout="centered")

# --- Sidebar for navigation ---
st.sidebar.title("Navigation")
page = st.sidebar.radio("Go to", ("Input Data", "Live Visualization"))

# --- Helper: Load data ---
def load_data():
    if os.path.exists(DATA_FILE):
        return pd.read_csv(DATA_FILE)
    else:
        return pd.DataFrame(columns=[
            "Date", "Name", "Years of Experience", "Current Role", "Company", "Industry", "Education", "Coding Expertise", "Coding Language"
        ])

# --- Helper: Save data ---
def save_data(row):
    df = load_data()
    df = pd.concat([df, pd.DataFrame([row])], ignore_index=True)
    df.to_csv(DATA_FILE, index=False)

# --- Input Data Page ---
if page == "Input Data":
    st.title("Professional Survey Form")
    with st.form("survey_form"):
        date = st.date_input("Date", value=datetime.date.today())
        name = st.text_input("Name")
        years_exp = st.number_input("Years of Experience", min_value=0, max_value=60, step=1)
        current_role = st.text_input("Current Role")
        company = st.text_input("Company")
        industry = st.text_input("Industry they work in")
        education = st.text_input("Education")
        coding_exp = st.selectbox("Coding expertise", ["No Knowledge", "Beginner", "Intermediate", "Expert"])
        coding_lang = ""
        if coding_exp != "No Knowledge":
            coding_lang = st.text_input("If coding experience, which language?")
        submitted = st.form_submit_button("Submit")
        if submitted:
            row = {
                "Date": date,
                "Name": name,
                "Years of Experience": years_exp,
                "Current Role": current_role,
                "Company": company,
                "Industry": industry,
                "Education": education,
                "Coding Expertise": coding_exp,
                "Coding Language": coding_lang
            }
            save_data(row)
            st.success("Thank you! Your response has been recorded.")

# --- Visualization Page (Password Protected) ---
if page == "Live Visualization":
    st.title("Live Data Visualization")
    # Password protection
    if "vis_auth" not in st.session_state:
        st.session_state["vis_auth"] = False
    if not st.session_state["vis_auth"]:
        pw = st.text_input("Enter password to view visualization", type="password")
        unlock = st.button("Unlock")
        if unlock:
            if pw == VIS_PASSWORD:
                st.session_state["vis_auth"] = True
                # Instead of experimental_rerun, just show a success message and rely on session state
                st.success("Access granted. Please click the 'Live Visualization' tab again if you do not see the data.")
            else:
                st.error("Incorrect password.")
        # Stop further execution if not authenticated
        st.stop()
    # Authenticated: show data
    df = load_data()
    if df.empty:
        st.info("No data submitted yet.")
    else:
        st.subheader("Survey Data Table")
        st.dataframe(df)
        # Example visualizations
        st.subheader("Years of Experience Distribution")
        st.bar_chart(df["Years of Experience"].value_counts().sort_index())
        st.subheader("Coding Expertise Breakdown")
        st.bar_chart(df["Coding Expertise"].value_counts())
        st.subheader("Industries Represented")
        st.bar_chart(df["Industry"].value_counts())
