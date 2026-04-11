import streamlit as st
import pandas as pd
import os
from wordcloud import WordCloud
import matplotlib.pyplot as plt

DATA_PATH = "Class-intro/student_data.csv"

def save_data(data):
    df = pd.DataFrame([data])
    if os.path.exists(DATA_PATH):
        df.to_csv(DATA_PATH, mode='a', header=False, index=False)
    else:
        df.to_csv(DATA_PATH, mode='w', header=True, index=False)

def load_data():
    if os.path.exists(DATA_PATH):
        return pd.read_csv(DATA_PATH)
    else:
        return pd.DataFrame(columns=["Name", "Years of Experience", "Current Role", "Industry", "Programming Experience", "Programming Languages"])

st.set_page_config(page_title="Gen AI Class Introduction", layout="wide")

st.title("Gen AI Class Introduction")

tab1, tab2 = st.tabs(["Enter Student Details", "Visualizations"])

with tab1:
    st.header("Enter Student Details")
    with st.form("student_form", clear_on_submit=True):
        name = st.text_input("Name")
        years_exp = st.number_input("Years of Experience", min_value=0, max_value=50, step=1)
        current_role = st.text_input("Current Role")
        industry = st.text_input("Industry")
        prog_exp = st.selectbox("Programming Experience", ["Non Programmer", "Beginner", "Intermediate", "Expert"])
        prog_lang = st.text_input("Programming Languages Known (comma separated)")
        submitted = st.form_submit_button("Submit")
        if submitted:
            save_data({
                "Name": name,
                "Years of Experience": years_exp,
                "Current Role": current_role,
                "Industry": industry,
                "Programming Experience": prog_exp,
                "Programming Languages": prog_lang
            })
            st.success("Student details saved!")

with tab2:
    st.header("Live Visualizations")
    df = load_data()
    if df.shape[0] == 0:
        st.info("No data available yet. Please enter student details.")
    else:
        col1, col2 = st.columns(2)
        with col1:
            st.subheader("Years of Experience Histogram")
            st.bar_chart(df["Years of Experience"].value_counts().sort_index())
        with col2:
            st.subheader("Programming Experience Pie Chart")
            st.pyplot(plt.figure())
            pie_data = df["Programming Experience"].value_counts()
            fig1, ax1 = plt.subplots()
            ax1.pie(pie_data, labels=pie_data.index, autopct='%1.1f%%', startangle=90)
            ax1.axis('equal')
            st.pyplot(fig1)
        st.subheader("Industry Word Cloud")
        text = ' '.join(df["Industry"].dropna().astype(str))
        if text.strip():
            wordcloud = WordCloud(width=800, height=400, background_color='white').generate(text)
            fig2, ax2 = plt.subplots(figsize=(10, 5))
            ax2.imshow(wordcloud, interpolation='bilinear')
            ax2.axis('off')
            st.pyplot(fig2)
        else:
            st.info("Not enough data for word cloud.")
