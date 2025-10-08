#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Activate the project's virtual environment instead of relying on conda
source "${SCRIPT_DIR}/.venv/bin/activate"

python "${SCRIPT_DIR}/run.py" "$@"
