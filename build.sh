#!/usr/bin/env bash
# exit on error
set -o errexit

# Intentar instalar LibreOffice en servidores Linux (Render) para conversión Excel a PDF
if command -v apt-get &> /dev/null; then
    apt-get update && apt-get install -y --no-install-recommends libreoffice-calc libreoffice-writer || true
fi

pip install --upgrade pip
pip install -r requirements.txt
