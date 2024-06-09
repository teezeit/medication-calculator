import numpy as np
import pandas as pd
import streamlit as st
from datetime import time, datetime
from fit import calculate_concentrations_and_plot_with_plotly
import streamlit.components.v1 as components
from streamlit_javascript import st_javascript


window_width = st_javascript("""window.innerWidth;""")
st.session_state.is_mobile = True if window_width < 600 else False
st.session_state.current_hour = datetime.now().hour

# Application Title
st.title("Medication Buddy")

# Introduction Text
st.markdown(
    """
So you really have something important at 4pm?
When should you take your medication? 
Should it be one 70mg or two 30mg?

Try it out!
## When did you take your medication and how much?
"""
)

tab1, tab2 = st.tabs(["My Medication", "Compare"])

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
        format="HH:mm",
    ),
    "dosis [mg]": st.column_config.NumberColumn(
        "Dosage [mg]",
        help="Dosage of your medication in milligrams",
        required=True,
        min_value=0,
        max_value=200,
        step=5,
        format="%d",
    ),
}
with tab1:
    edited_df1 = st.data_editor(
        df1,
        column_config=column_config,
        num_rows="dynamic",
        hide_index=True,
        key="default",
    )

with tab2:
    # Layout for Data Editors
    col1, col2 = st.columns(2, gap="small")

    with col1:
        st.markdown("### Option 1")
        edited_df1 = st.data_editor(
            df1, column_config=column_config, num_rows="dynamic", hide_index=True
        )

    with col2:
        st.markdown("### Option 2")
        edited_df2 = st.data_editor(
            df2, column_config=column_config, num_rows="dynamic", hide_index=True
        )
        compare_mode = st.checkbox("Mode: Compare", value=False, key="compare_mode")

# Layout for Medication Selection and Threshold Slider
col3, col4 = st.columns([0.7, 0.3])

with col3:
    medication = st.radio(
        "Elvanse/Vyvanse, Medikinet, or ...?",
        ["Elvanse/Vyvanse"],
        captions=["Lisdexamphetamindimesilat"],
    )
    st.markdown("More Medications coming soon")

with col4:
    threshold = st.slider(
        "Personal Threshold", min_value=0, max_value=200, value=20, step=10
    )


# Function to Extract Options from DataFrame
def get_options(df):
    times = df["time"].apply(lambda x: x.hour + (x.minute / 60)).tolist()
    doses = df["dosis [mg]"].tolist()
    return [[t, d] for t, d in zip(times, doses)]


# Get Options from Edited DataFrames
options1 = get_options(edited_df1)
options2 = get_options(edited_df2)
plot_options = [options1]
if compare_mode:
    plot_options.append(options2)

# Calculate Concentrations and Plot
fig1 = calculate_concentrations_and_plot_with_plotly(plot_options, threshold)

if st.session_state.is_mobile:
    # factor = 300./float(window_width)
    # print(factor)
    legend = dict(orientation="h", yanchor="bottom", y=-1.9, xanchor="center", x=0.5)
    h = st.session_state.current_hour
    delta = 2.2
    xrange = [h - delta, h + delta]
    xaxis = dict(
        range=xrange,
        rangeslider=dict(
            visible=True,
        ),
        type="linear",
    )
else:
    legend = dict(orientation="h", yanchor="bottom", y=-0.9, xanchor="center", x=0.5)
    xaxis = dict(
        # range=range,
        # rangeslider=dict(
        #     visible=True,
        # ),
        type="linear"
    )
fig1.update_layout(
    dragmode="pan",
    legend=legend,
    xaxis=xaxis,
)

# st.markdown("**Total and Individual Medication Concentrations Over Time**")
st.plotly_chart(fig1, use_container_width=False, theme="streamlit")

# Add CSS to make it nicer on mobile
st.markdown(
    """
<style>
    .stApp {
        max-width: 100% !important;
        padding: 0;
    }
    .block-container {
        padding: 1rem !important;
    }
    @media only screen and (max-width: 400px) {
        .stApp {
            padding: 0;
        }
        .block-container {
            padding: 0.5rem;
        }
    }
</style>
""",
    unsafe_allow_html=True,
)
