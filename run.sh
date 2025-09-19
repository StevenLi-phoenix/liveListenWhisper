#!/bin/bash

# Activate conda base environment
source ~/miniconda3/bin/activate base

# Run the Python script
cd /Users/lishuyu/Codes/liveListenWhisper && python run.py "$@"