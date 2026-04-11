# Streamlit App Deployment Instructions

## Local Testing

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Run the app locally:
   ```bash
   streamlit run app.py
   ```

## Global Deployment (Streamlit Community Cloud)

1. **Push your code to a public GitHub repository.**
2. **Go to [Streamlit Community Cloud](https://streamlit.io/cloud)** and sign in with your GitHub account.
3. **Click 'New app'** and select your repository and branch.
4. **Set the main file path to:**
   ```
   Class-intro/app.py
   ```
5. **Deploy!**

### Notes
- Ensure `requirements.txt` is present in the `Class-intro` directory.
- The app will save data to `student_data.csv` in the same directory. For persistent data, consider using a database for production.
- For private deployments, set repository visibility and Streamlit sharing settings accordingly.
