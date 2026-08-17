#!/usr/bin/env bash
# exit on error
set -o errexit

echo "===> Verificando e instalando dependencias de Python..."
pip install --upgrade pip
pip install -r requirements.txt

echo "===> Verificando disponibilidad de LibreOffice / soffice..."
if command -v soffice &> /dev/null || command -v libreoffice &> /dev/null; then
    echo "LibreOffice ya está disponible en el sistema."
else
    echo "Intentando instalar LibreOffice..."
    if command -v apt-get &> /dev/null; then
        apt-get update && apt-get install -y --no-install-recommends libreoffice-calc libreoffice-writer fonts-dejavu fonts-liberation || true
    fi
fi
