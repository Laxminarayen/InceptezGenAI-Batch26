
import streamlit as st
import pandas as pd
from collections import Counter
from wordcloud import WordCloud
import matplotlib.pyplot as plt
import os


# CSV file path
CSV_PATH = "Class-intro/students.csv"

# Helper to load data from CSV
def load_students():
    if os.path.exists(CSV_PATH):
        return pd.read_csv(CSV_PATH).to_dict(orient='records')
    return []

# Helper to save data to CSV
def save_students(students):
    df = pd.DataFrame(students)
    df.to_csv(CSV_PATH, index=False)

# Initialize session state for data storage
if 'students' not in st.session_state:
    st.session_state['students'] = load_students()

st.title("Gen AI Class Introduction")

tab1, tab2 = st.tabs(["Data Entry", "Visualization"])

with tab1:
    st.header("Enter Student Details")
    with st.form("student_form", clear_on_submit=True):
        name = st.text_input("Name")
        years_exp = st.number_input("Years of Experience", min_value=0, max_value=50, step=1)
        current_role = st.text_input("Current Role")
        industry = st.text_input("Industry")
        prog_exp = st.selectbox(
            "Programming Experience",
            ["Non Programmer", "Beginner", "Intermediate", "Expert"]
        )
        prog_lang = st.text_input("Programming Languages Known (comma separated)")
        submitted = st.form_submit_button("Add Student")
        if submitted:
            st.session_state['students'].append({
                "Name": name,
                "Years of Experience": years_exp,
                "Current Role": current_role,
                "Industry": industry,
                "Programming Experience": prog_exp,
                "Programming Languages Known": prog_lang
            })
            save_students(st.session_state['students'])
            st.success(f"Added {name}")

with tab2:
    st.header("Class Visualizations")
    # Always reload from CSV for live update
    students = load_students()
    if not students:
        st.info("No data yet. Please add student details in the Data Entry tab.")
    else:
        df = pd.DataFrame(students)
        # Bar chart: Years of Experience
        st.subheader("Years of Experience (Bar Chart)")
        st.bar_chart(df['Years of Experience'])

        # Pie chart: Programming Experience
        st.subheader("Programming Experience (Pie Chart)")
        prog_counts = df['Programming Experience'].value_counts()
        fig1, ax1 = plt.subplots()
        ax1.pie(prog_counts, labels=prog_counts.index, autopct='%1.1f%%', startangle=90)
        ax1.axis('equal')
        st.pyplot(fig1)

        # Word cloud: Industry
        st.subheader("Industry (Word Cloud)")
        industries = ' '.join(df['Industry'].dropna().astype(str))
        if industries.strip():
            wordcloud = WordCloud(width=800, height=400, background_color='white').generate(industries)
            fig2, ax2 = plt.subplots(figsize=(8, 4))
            ax2.imshow(wordcloud, interpolation='bilinear')
            ax2.axis('off')
            st.pyplot(fig2)
        else:
            st.info("No industry data to display as word cloud.")
