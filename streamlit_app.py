import numpy as np
import pandas as pd
import streamlit as st
from datetime import time
from fit import calculate_concentrations_and_plot_with_plotly

# Application Title
st.title("Elvanse Medication Calculator")

# Introduction Text
st.markdown("""
So you really have something important at 4pm?
When should you take your medication? 
Should it be one 70mg or two 30mg?

Try it out!
## When did you take your medication and how much?
""")

# Define the DataFrames
df1 = pd.DataFrame(
    [
        {"time": time(7, 30), "dosis [mg]": 30},
        {"time": time(13, 0), "dosis [mg]": 30},
    ]
)

df2 = pd.DataFrame(
    [
        {"time": time(7, 30), "dosis [mg]": 70},
    ]
)

# Define the Column Configuration for the Data Editors
column_config = {
    "time": st.column_config.TimeColumn(
        "Time",
        help="Time when you took your medication",
        required=True,
        min_value=time(0, 0),
        max_value=time(23, 59),
        format="HH:mm"
    ),
    "dosis [mg]": st.column_config.NumberColumn(
        "Dosage [mg]",
        help="Dosage of your medication in milligrams",
        required=True,
        min_value=0,
        max_value=200,
        step=5,
        format="%d"
    )
}

# Layout for Data Editors
col1, col2 = st.columns(2, gap="small")

with col1:
    st.markdown("### Option 1")
    edited_df1 = st.data_editor(df1, column_config=column_config, num_rows="dynamic", hide_index=True)

with col2:
    st.markdown("### Option 2")
    edited_df2 = st.data_editor(df2, column_config=column_config, num_rows="dynamic", hide_index=True)

# Layout for Medication Selection and Threshold Slider
col3, col4 = st.columns([0.7, 0.3])

with col3:
    medication = st.radio(
        "Elvanse, Medikinet, or ...?",
        ["Elvanse"],
        captions=["Lisdexamphetamindimesilat"]
    )
    st.markdown("More Medications coming soon")

with col4:
    threshold = st.slider("Personal Threshold", min_value=0, max_value=200, value=20, step=10)

# Function to Extract Options from DataFrame
def get_options(df):
    times = df['time'].apply(lambda x: x.hour + (x.minute / 60)).tolist()
    doses = df["dosis [mg]"].tolist()
    return [[t, d] for t, d in zip(times, doses)]

# Get Options from Edited DataFrames
options1 = get_options(edited_df1)
options2 = get_options(edited_df2)

# Calculate Concentrations and Plot
fig1 = calculate_concentrations_and_plot_with_plotly([options1, options2], threshold)

# Display Plot
st.plotly_chart(fig1, theme="streamlit")
