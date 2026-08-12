import os
import io
import zipfile
import shutil
import importlib
import pandas as pd
from flask import Flask, request, jsonify, send_file, send_from_directory

import excel_processor
importlib.reload(excel_processor)

from excel_processor import (
    process_single_worker,
    calculate_target_month_from_physical_date,
    detect_worker_type,
    generate_random_scores,
    load_job_profiles,
    get_profile_activities,
    DEFAULT_ACTIVITIES,
    DEFAULT_OFFICIALS
)

app = Flask(__name__, static_folder="static", static_url_path="")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = BASE_DIR
TEMP_DIR = os.path.join(BASE_DIR, "temp_downloads")

os.makedirs(TEMP_DIR, exist_ok=True)

# Cargar perfiles de puestos al iniciar
load_job_profiles(BASE_DIR)

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/api/profiles", methods=["GET"])
def get_profiles():
    """ Retorna la lista de perfiles de puesto y sus actividades asociadas del Gantt. """
    profiles = load_job_profiles(BASE_DIR)
    result = []
    for key, pinfo in profiles.items():
        result.append({
            "key": key,
            "puesto": pinfo["puesto"],
            "activities": pinfo["activities"]
        })
    return jsonify(result)

@app.route("/api/profile-activities", methods=["POST"])
def get_activities_for_puesto():
    data = request.json or {}
    puesto = data.get("puesto", "")
    activities = get_profile_activities(puesto, base_dir=BASE_DIR)
    return jsonify({"puesto": puesto, "activities": activities})

@app.route("/api/preview-info", methods=["POST"])
def preview_info():
    data = request.json or {}
    rpe = data.get("rpe", "")
    puesto_probar = data.get("puesto_probar", "AYUDANTE LINIERO (SERVICIO AL CLIENTE)")
    fecha_fisica = data.get("fecha_fisica", "2026-08-14")
    
    worker_type = detect_worker_type(rpe)
    period_info = calculate_target_month_from_physical_date(fecha_fisica)
    activities = get_profile_activities(puesto_probar, base_dir=BASE_DIR)
    
    apt, act, sum_apt, sum_act, total = generate_random_scores(80, 100)
    
    return jsonify({
        "rpe": rpe,
        "worker_type": worker_type,
        "period_info": period_info,
        "activities": activities,
        "sample_scores": {
            "aptitudes": apt,
            "actitudes": act,
            "sum_aptitudes": sum_apt,
            "sum_actitudes": sum_act,
            "total": total
        },
        "default_officials": DEFAULT_OFFICIALS
    })

@app.route("/api/generate-single", methods=["POST"])
def generate_single():
    data = request.json or {}
    if not data.get("nombre") or not data.get("rpe"):
        return jsonify({"error": "Nombre y RPE son obligatorios"}), 400
        
    session_id = f"single_{int(os.times().elapsed * 1000)}"
    work_dir = os.path.join(TEMP_DIR, session_id)
    os.makedirs(work_dir, exist_ok=True)
    
    try:
        files = process_single_worker(data, TEMPLATES_DIR, work_dir)
        
        rpe_clean = str(data.get("rpe")).strip()
        nombre_clean = str(data.get("nombre")).strip().replace(" ", "_")
        zip_filename = f"Formatos_COS_{rpe_clean}_{nombre_clean}.zip"
        zip_path = os.path.join(TEMP_DIR, zip_filename)
        
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for fpath in files:
                arcname = os.path.basename(fpath)
                zipf.write(fpath, arcname)
                
        shutil.rmtree(work_dir, ignore_errors=True)
        
        return send_file(zip_path, as_attachment=True, download_name=zip_filename)
    except Exception as e:
        shutil.rmtree(work_dir, ignore_errors=True)
        return jsonify({"error": str(e)}), 500

@app.route("/api/generate-batch", methods=["POST"])
def generate_batch():
    if "file" not in request.files:
        return jsonify({"error": "No se envió ningún archivo"}), 400
        
    uploaded_file = request.files["file"]
    if not uploaded_file.filename:
        return jsonify({"error": "Archivo no seleccionado"}), 400
        
    session_id = f"batch_{int(os.times().elapsed * 1000)}"
    work_dir = os.path.join(TEMP_DIR, session_id)
    os.makedirs(work_dir, exist_ok=True)
    
    try:
        filename = uploaded_file.filename.lower()
        if filename.endswith(".csv"):
            df = pd.read_csv(uploaded_file)
        else:
            df = pd.read_excel(uploaded_file)
            
        df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
        
        resp_seg = request.form.get("responsable_seguimiento", DEFAULT_OFFICIALS["responsable_seguimiento"])
        resp_enc = request.form.get("responsable_encuesta", DEFAULT_OFFICIALS["responsable_encuesta"])
        jefe_area = request.form.get("jefe_area", DEFAULT_OFFICIALS["jefe_area"])
        rep_cap = request.form.get("representante_capacitacion", DEFAULT_OFFICIALS["representante_capacitacion"])

        processed_workers = 0
        zip_filename = f"Paquete_Masivo_COS_{int(os.times().elapsed)}.zip"
        zip_path = os.path.join(TEMP_DIR, zip_filename)
        
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for idx, row in df.iterrows():
                rpe = str(row.get("rpe", row.get("rpu", ""))).strip()
                nombre = str(row.get("nombre", row.get("nombre_del_trabajador", ""))).strip()
                if not rpe or not nombre or rpe == "nan" or nombre == "nan":
                    continue
                    
                area = str(row.get("area", row.get("zona", "ZONA TOLUCA"))).strip()
                clave = str(row.get("clave", "623X5")).strip()
                puesto_probar = str(row.get("puesto_probar", row.get("puesto", "AYUDANTE LINIERO (SERVICIO AL CLIENTE)"))).strip()
                fecha_fisica = str(row.get("fecha_fisica", row.get("fecha", "2026-08-14"))).strip()
                
                profile_acts = get_profile_activities(puesto_probar, base_dir=BASE_DIR)
                
                worker_data = {
                    "rpe": rpe,
                    "nombre": nombre,
                    "area": area,
                    "clave": clave,
                    "puesto_probar": puesto_probar,
                    "fecha_fisica": fecha_fisica,
                    "activities": profile_acts,
                    "responsable_seguimiento": resp_seg,
                    "responsable_encuesta": resp_enc,
                    "jefe_area": jefe_area,
                    "representante_capacitacion": rep_cap
                }
                
                worker_folder_name = f"{rpe}_{nombre.replace(' ', '_')}"
                worker_out_dir = os.path.join(work_dir, worker_folder_name)
                files = process_single_worker(worker_data, TEMPLATES_DIR, worker_out_dir)
                
                for fpath in files:
                    arcname = os.path.join(worker_folder_name, os.path.basename(fpath))
                    zipf.write(fpath, arcname)
                    
                processed_workers += 1
                
        shutil.rmtree(work_dir, ignore_errors=True)
        
        if processed_workers == 0:
            return jsonify({"error": "No se encontraron filas válidas con RPE y Nombre"}), 400
            
        return send_file(zip_path, as_attachment=True, download_name=zip_filename)
        
    except Exception as e:
        shutil.rmtree(work_dir, ignore_errors=True)
        return jsonify({"error": f"Error procesando archivo masivo: {str(e)}"}), 500

@app.route("/api/download-template-excel", methods=["GET"])
def download_template_excel():
    data = [
        {
            "rpe": "G982P",
            "nombre": "JOHAN JESUS ORIVE GAMA",
            "area": "ZONA TOLUCA",
            "clave": "623X5",
            "puesto_probar": "AYUDANTE LINIERO (SERVICIO AL CLIENTE)",
            "fecha_fisica": "2026-08-14"
        },
        {
            "rpe": "84729",
            "nombre": "CARLOS ROBERTO MARTINEZ SANCHEZ",
            "area": "ZONA TOLUCA",
            "clave": "DN500",
            "puesto_probar": "AUXILIAR COMERCIAL",
            "fecha_fisica": "2026-08-14"
        },
        {
            "rpe": "H1029",
            "nombre": "MARIA FERNANDA LOPEZ GONZALEZ",
            "area": "ZONA TOLUCA",
            "clave": "623X5",
            "puesto_probar": "TECNICO SUBESTACIONES",
            "fecha_fisica": "2026-08-14"
        }
    ]
    df = pd.DataFrame(data)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
        df.to_excel(writer, index=False, sheet_name='Trabajadores')
    output.seek(0)
    
    return send_file(
        output,
        as_attachment=True,
        download_name="Plantilla_Carga_Masiva_COS.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

if __name__ == "__main__":
    print("Iniciando servidor SistemaCOS en http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=True)
