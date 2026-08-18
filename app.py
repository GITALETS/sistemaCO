import os
import io
import time
import uuid
import zipfile
import shutil
import importlib
import pandas as pd
from flask import Flask, request, jsonify, send_file, send_from_directory
from werkzeug.utils import secure_filename

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

# ==============================================================================
# VALIDACIONES DE SEGURIDAD SISTEMA COS (OWASP Top 10 & Mejores Prácticas)
# 16. Restringir subida de archivos (Límite máximo de payload: 16 MB)
# 18. Headers de Seguridad (CSP, X-Frame-Options, X-Content-Type-Options, etc.)
# 19. HTTPS (HSTS Header en conexiones seguras)
# ==============================================================================
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB max upload limit

ALLOWED_EXTENSIONS = {'.xlsx', '.xls', '.csv'}

def allowed_file(filename):
    """ Validar Inputs (#14) y Restringir Subida (#16) """
    if not filename or '.' not in filename:
        return False
    ext = os.path.splitext(filename)[1].lower()
    return ext in ALLOWED_EXTENSIONS

@app.after_request
def apply_security_headers(response):
    """ Headers de Seguridad (#18) y HTTPS (#19) """
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; "
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; "
        "img-src 'self' data:;"
    )
    if request.is_secure:
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = BASE_DIR
TEMP_DIR = os.path.join(BASE_DIR, "temp_downloads")

os.makedirs(TEMP_DIR, exist_ok=True)

# Cargar perfiles de puestos al iniciar
load_job_profiles(BASE_DIR)

DEFAULT_WORKERS = [
    {
        "rpe": "G982P",
        "nombre": "JOHAN JESUS ORIVE GAMA",
        "worker_type": "TEMPORAL SINDICALIZADO",
        "puesto_actual": "TEMPORAL SINDICALIZADO",
        "puesto_probar": "AYUDANTE LINIERO (SERVICIO AL CLIENTE)",
        "area": "ZONA TOLUCA",
        "clave": "623X5"
    },
    {
        "rpe": "H1029",
        "nombre": "MARIA FERNANDA LOPEZ GONZALEZ",
        "worker_type": "TEMPORAL SINDICALIZADO",
        "puesto_actual": "TEMPORAL SINDICALIZADO",
        "puesto_probar": "TECNICO SUBESTACIONES",
        "area": "ZONA TOLUCA",
        "clave": "623X5"
    },
    {
        "rpe": "F4810",
        "nombre": "DIEGO DE LA PAZ ORIVE OSORIO",
        "worker_type": "TEMPORAL SINDICALIZADO",
        "puesto_actual": "TEMPORAL SINDICALIZADO",
        "puesto_probar": "AUXILIAR SERVICIOS I",
        "area": "ZONA TOLUCA",
        "clave": "DN500"
    },
    {
        "rpe": "84729",
        "nombre": "CARLOS ROBERTO MARTINEZ SANCHEZ",
        "worker_type": "BASE SINDICALIZADO",
        "puesto_actual": "LINIERO LV",
        "puesto_probar": "ENCARGADO SECCION COMERCIAL",
        "area": "ZONA TOLUCA",
        "clave": "DN500"
    },
    {
        "rpe": "75312",
        "nombre": "ROBERTO CARLOS GOMEZ HERNANDEZ",
        "worker_type": "BASE SINDICALIZADO",
        "puesto_actual": "SOBRESTANTE",
        "puesto_probar": "SOBRESTANTE",
        "area": "ZONA TOLUCA",
        "clave": "623X5"
    },
    {
        "rpe": "93812",
        "nombre": "ANA PATRICIA RAMIREZ SALAZAR",
        "worker_type": "BASE SINDICALIZADO",
        "puesto_actual": "AUXILIAR COMERCIAL",
        "puesto_probar": "AUXILIAR COMERCIAL",
        "area": "ZONA TOLUCA",
        "clave": "DN500"
    },
    {
        "rpe": "51204",
        "nombre": "ALEJANDRO HERNANDEZ DIAZ",
        "worker_type": "BASE SINDICALIZADO",
        "puesto_actual": "VERIFICADOR CALIBRADOR I",
        "puesto_probar": "VERIFICADOR CALIBRADOR I",
        "area": "ZONA TOLUCA",
        "clave": "623X5"
    },
    {
        "rpe": "G3910",
        "nombre": "JOSE LUIS GARCIA MORALES",
        "worker_type": "TEMPORAL SINDICALIZADO",
        "puesto_actual": "TEMPORAL SINDICALIZADO",
        "puesto_probar": "MANIOBRISTA DE ALMACEN DIVISIONAL",
        "area": "ZONA TOLUCA",
        "clave": "623X5"
    }
]

WORKERS_DATABASE = []
LAST_DB_MTIME = 0

def validate_worker_df(df):
    """
    Valida si un DataFrame de Excel/CSV contiene las 3 columnas esenciales:
    1. RPE/RTT (o RPE, RTT)
    2. NOMBRE DE TRABAJADOR (o Nombre)
    3. PUESTO (o Puesto Actual)
    """
    df_cols = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
    
    rpe_candidates = ["rpe/rtt", "rpe_rtt", "rpe", "rtt", "rpu", "rpe/rtt_", "clave_rpe"]
    nombre_candidates = ["nombre_de_trabajador", "nombre_del_trabajador", "nombre", "trabajador", "nombre_trabajador"]
    puesto_candidates = ["puesto", "puesto_actual", "puesto_base", "puesto_del_trabajador"]
    
    has_rpe = any(c in df_cols for c in rpe_candidates)
    has_nombre = any(c in df_cols for c in nombre_candidates)
    has_puesto = any(c in df_cols for c in puesto_candidates)
    
    missing = []
    if not has_rpe:
        missing.append("RPE/RTT")
    if not has_nombre:
        missing.append("NOMBRE DE TRABAJADOR")
    if not has_puesto:
        missing.append("PUESTO")
        
    is_valid = len(missing) == 0
    return is_valid, missing

def get_db_file_path():
    """ Devuelve la ruta del archivo de base de datos de trabajadores existente que cumpla con el formato """
    candidates = [
        "BD_TRABAJADORES2026.xlsx",
        "BD_TRABAJADORES2026.xls",
        "BD_TRABAJADORES2026.csv",
        "base_datos_trabajadores.xlsx",
        "base_datos_trabajadores.xls",
        "base_datos_trabajadores.csv"
    ]
    for c in candidates:
        full_path = os.path.join(BASE_DIR, c)
        if os.path.exists(full_path):
            return full_path
            
    # Buscar cualquier archivo Excel/CSV en BASE_DIR que sea válido
    for fname in os.listdir(BASE_DIR):
        if fname.startswith("~$") or fname.startswith("."):
            continue
        ext = os.path.splitext(fname)[1].lower()
        if ext in [".xlsx", ".xls", ".csv"]:
            full_path = os.path.join(BASE_DIR, fname)
            try:
                if ext == ".csv":
                    df_check = pd.read_csv(full_path, nrows=5)
                else:
                    df_check = pd.read_excel(full_path, nrows=5)
                is_valid, _ = validate_worker_df(df_check)
                if is_valid:
                    return full_path
            except Exception:
                continue
            
    return None

def get_col_val(row, candidates, default=""):
    for c in candidates:
        if c in row and pd.notna(row[c]):
            val = str(row[c]).strip()
            if val and val.lower() != "nan":
                return val
    return default

def load_workers_database():
    global WORKERS_DATABASE, LAST_DB_MTIME
    excel_db_path = get_db_file_path()
    loaded = []
    if excel_db_path and os.path.exists(excel_db_path):
        try:
            LAST_DB_MTIME = os.path.getmtime(excel_db_path)
            if excel_db_path.lower().endswith(".csv"):
                df = pd.read_csv(excel_db_path)
            else:
                df = pd.read_excel(excel_db_path)
                
            df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
            for _, row in df.iterrows():
                rpe_val = get_col_val(row, ["rpe/rtt", "rpe_rtt", "rpe", "rtt", "rpu", "rpe/rtt_", "clave_rpe"])
                nombre_val = get_col_val(row, ["nombre_de_trabajador", "nombre_del_trabajador", "nombre", "trabajador", "nombre_trabajador"])
                if not rpe_val or not nombre_val:
                    continue
                wtype = detect_worker_type(rpe_val)
                p_actual = get_col_val(row, ["puesto_actual", "puesto_base", "puesto", "puesto_del_trabajador"], wtype)
                p_probar = get_col_val(row, ["puesto_probar", "puesto_evaluado", "puesto_a_probar"], p_actual)
                area_val = get_col_val(row, ["area", "zona", "departamento"], "ZONA TOLUCA")
                clave_val = get_col_val(row, ["clave", "clave_area", "centro_de_trabajo"], "623X5")
                loaded.append({
                    "rpe": rpe_val,
                    "nombre": nombre_val,
                    "worker_type": wtype,
                    "puesto_actual": p_actual,
                    "puesto_probar": p_probar,
                    "area": area_val,
                    "clave": clave_val
                })
        except Exception as e:
            print(f"Advertencia al leer base de datos de trabajadores: {e}")
            
    if not loaded:
        loaded = DEFAULT_WORKERS.copy()
        
    WORKERS_DATABASE = loaded
    return WORKERS_DATABASE

def get_workers_db():
    global WORKERS_DATABASE, LAST_DB_MTIME
    excel_db_path = get_db_file_path()
    current_mtime = os.path.getmtime(excel_db_path) if (excel_db_path and os.path.exists(excel_db_path)) else 0
    if not WORKERS_DATABASE or current_mtime != LAST_DB_MTIME:
        load_workers_database()
    return WORKERS_DATABASE

# Cargar base de datos de trabajadores al iniciar
load_workers_database()

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/api/workers/info", methods=["GET"])
def get_workers_db_info():
    """ Retorna información del estado actual de la base de datos de trabajadores """
    excel_db_path = get_db_file_path()
    db = get_workers_db()
    exists = excel_db_path is not None and os.path.exists(excel_db_path)
    last_mod = ""
    filename = os.path.basename(excel_db_path) if exists else "Catálogo Predeterminado (8)"
    if exists:
        try:
            mtime = os.path.getmtime(excel_db_path)
            from datetime import datetime
            last_mod = datetime.fromtimestamp(mtime).strftime("%d/%m/%Y %H:%M:%S")
        except Exception:
            last_mod = "Desconocida"
    return jsonify({
        "count": len(db),
        "file_exists": exists,
        "filename": filename,
        "last_modified": last_mod
    })

@app.route("/api/workers/reload-db", methods=["POST"])
def reload_workers_db_endpoint():
    """ Fuerza la recarga de la base de datos desde el archivo Excel en disco """
    db = load_workers_database()
    excel_db_path = get_db_file_path()
    last_mod = ""
    filename = os.path.basename(excel_db_path) if (excel_db_path and os.path.exists(excel_db_path)) else "Catálogo Predeterminado (8)"
    if excel_db_path and os.path.exists(excel_db_path):
        try:
            mtime = os.path.getmtime(excel_db_path)
            from datetime import datetime
            last_mod = datetime.fromtimestamp(mtime).strftime("%d/%m/%Y %H:%M:%S")
        except Exception:
            last_mod = "Desconocida"
    return jsonify({
        "message": f"Base de datos recargada exitosamente ({len(db)} registros)",
        "count": len(db),
        "filename": filename,
        "last_modified": last_mod
    })

@app.route("/api/workers/search", methods=["GET"])
def search_workers():
    """ Filtra la base de datos de trabajadores por RPE/RTT, Nombre o Puesto """
    query = request.args.get("q", "").strip().lower()
    db = get_workers_db()
    if not query:
        return jsonify(db[:15])
    
    results = []
    for w in db:
        rpe_str = str(w.get("rpe", "")).lower()
        nom_str = str(w.get("nombre", "")).lower()
        pact_str = str(w.get("puesto_actual", "")).lower()
        pprob_str = str(w.get("puesto_probar", "")).lower()
        if (query in rpe_str or query in nom_str or query in pact_str or query in pprob_str):
            results.append(w)
    return jsonify(results[:15])

@app.route("/api/workers/upload-db", methods=["POST"])
def upload_workers_db():
    """ Permite subir cualquier archivo Excel/CSV para actualizar la base de datos de trabajadores """
    if "file" not in request.files:
        return jsonify({"error": "No se envió ningún archivo"}), 400
    uploaded_file = request.files["file"]
    if not uploaded_file.filename:
        return jsonify({"error": "Archivo no seleccionado"}), 400
        
    try:
        filename = secure_filename(uploaded_file.filename)
        if not allowed_file(filename):
            return jsonify({"error": "Formato no permitido. Solamente se admiten archivos .xlsx, .xls o .csv"}), 400
            
        ext = os.path.splitext(filename)[1].lower()
        if ext == ".csv":
            df = pd.read_csv(uploaded_file)
        else:
            df = pd.read_excel(uploaded_file)
            
        is_valid, missing = validate_worker_df(df)
        if not is_valid:
            return jsonify({
                "error": f"El archivo '{filename}' no contiene las columnas requeridas. Faltan: {', '.join(missing)}. Las columnas obligatorias son: RPE/RTT, NOMBRE DE TRABAJADOR, PUESTO."
            }), 400

        target_path = os.path.join(BASE_DIR, "BD_TRABAJADORES2026.xlsx")
        if ext == ".csv":
            df.to_excel(target_path, index=False)
        else:
            uploaded_file.seek(0)
            uploaded_file.save(target_path)
            
        workers = load_workers_database()
        from datetime import datetime
        last_mod = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
        return jsonify({
            "message": f"¡Base de datos cargada con éxito! ({len(workers)} trabajadores desde '{filename}')",
            "count": len(workers),
            "filename": filename,
            "last_modified": last_mod
        })
    except Exception as e:
        return jsonify({"error": "Error interno procesando archivo de base de datos"}), 500

@app.route("/api/workers/download-template-db", methods=["GET"])
def download_workers_db_template():
    """ Genera plantilla Excel para la base de datos de trabajadores """
    sample_data = [
        {
            "RPE/RTT": "9L58M",
            "NOMBRE DE TRABAJADOR": "JOSE LUIS MULIA RAMOS",
            "PUESTO": "AUXILIAR ESPECIALIZADO"
        },
        {
            "RPE/RTT": "85894",
            "NOMBRE DE TRABAJADOR": "ERIKA ALEJANDRA MENDOZA GUTIERREZ",
            "PUESTO": "AUXILIAR ESPECIALIZADO"
        },
        {
            "RPE/RTT": "GA02W",
            "NOMBRE DE TRABAJADOR": "VICTOR HUGO ESPINOSA AVALOS",
            "PUESTO": "AYUDANTE LINIERO"
        }
    ]
    df = pd.DataFrame(sample_data)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
        df.to_excel(writer, index=False, sheet_name='Base_Trabajadores')
    output.seek(0)
    return send_file(
        output,
        as_attachment=True,
        download_name="BD_TRABAJADORES2026_Plantilla.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

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
    puesto_actual = data.get("puesto_actual", data.get("puesto_base", ""))
    puesto_probar = data.get("puesto_probar", "AYUDANTE LINIERO (SERVICIO AL CLIENTE)")
    fecha_fisica = data.get("fecha_fisica", "2026-08-14")
    
    worker_type = detect_worker_type(rpe)
    period_info = calculate_target_month_from_physical_date(fecha_fisica)
    activities = get_profile_activities(puesto_probar, base_dir=BASE_DIR)
    
    apt, act, sum_apt, sum_act, total = generate_random_scores(80, 100)
    
    return jsonify({
        "rpe": rpe,
        "worker_type": worker_type,
        "puesto_actual": puesto_actual or worker_type,
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
        
    session_id = f"single_{uuid.uuid4().hex}"
    work_dir = os.path.join(TEMP_DIR, session_id)
    os.makedirs(work_dir, exist_ok=True)
    
    try:
        export_format = data.get("export_format", "pdf")
        files = process_single_worker(data, TEMPLATES_DIR, work_dir, export_format=export_format)
        
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
        
    filename = secure_filename(uploaded_file.filename)
    if not allowed_file(filename):
        return jsonify({"error": "Formato no permitido. Solamente se admiten archivos .xlsx, .xls o .csv"}), 400

    session_id = f"batch_{uuid.uuid4().hex}"
    work_dir = os.path.join(TEMP_DIR, session_id)
    os.makedirs(work_dir, exist_ok=True)
    
    try:
        ext = os.path.splitext(filename)[1].lower()
        if ext == ".csv":
            df = pd.read_csv(uploaded_file)
        else:
            df = pd.read_excel(uploaded_file)
            
        df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
        
        export_format = request.form.get("export_format", "pdf")
        resp_seg = request.form.get("responsable_seguimiento", DEFAULT_OFFICIALS["responsable_seguimiento"])
        resp_enc = request.form.get("responsable_encuesta", DEFAULT_OFFICIALS["responsable_encuesta"])
        jefe_area_temp = request.form.get("jefe_area_temporal", request.form.get("jefe_area", DEFAULT_OFFICIALS["jefe_area_temporal"]))
        jefe_area_base = request.form.get("jefe_area_base", DEFAULT_OFFICIALS["jefe_area_base"])
        rep_cap = request.form.get("representante_capacitacion", DEFAULT_OFFICIALS["representante_capacitacion"])

        processed_workers = 0
        zip_filename = f"Paquete_Masivo_COS_{int(time.time())}_{uuid.uuid4().hex[:6]}.zip"
        zip_path = os.path.join(TEMP_DIR, zip_filename)
        
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for idx, row in df.iterrows():
                rpe = get_col_val(row, ["rpe/rtt", "rpe_rtt", "rpe", "rtt", "rpu", "rpe/rtt_", "clave_rpe"])
                nombre = get_col_val(row, ["nombre_de_trabajador", "nombre_del_trabajador", "nombre", "trabajador", "nombre_trabajador"])
                if not rpe or not nombre:
                    continue
                    
                wtype = detect_worker_type(rpe)
                puesto_actual = get_col_val(row, ["puesto_actual", "puesto_base", "puesto", "puesto_del_trabajador"], wtype)
                puesto_probar = get_col_val(row, ["puesto_probar", "puesto_evaluado", "puesto_a_probar"], puesto_actual)
                area = get_col_val(row, ["area", "zona", "departamento"], "ZONA TOLUCA")
                clave = get_col_val(row, ["clave", "clave_area"], "623X5")
                fecha_fisica = get_col_val(row, ["fecha_fisica", "fecha", "fecha_evaluacion"], "2026-08-14")
                
                profile_acts = get_profile_activities(puesto_probar, base_dir=BASE_DIR)
                
                is_base = "BASE" in wtype.upper() or (rpe and str(rpe).strip() and str(rpe).strip()[0].isdigit())
                jefe_area_curr = jefe_area_base if is_base else jefe_area_temp

                worker_data = {
                    "rpe": rpe,
                    "nombre": nombre,
                    "worker_type": wtype,
                    "puesto_actual": puesto_actual,
                    "area": area,
                    "clave": clave,
                    "puesto_probar": puesto_probar,
                    "fecha_fisica": fecha_fisica,
                    "activities": profile_acts,
                    "export_format": export_format,
                    "responsable_seguimiento": resp_seg,
                    "responsable_encuesta": resp_enc,
                    "jefe_area": jefe_area_curr,
                    "jefe_area_temporal": jefe_area_temp,
                    "jefe_area_base": jefe_area_base,
                    "representante_capacitacion": rep_cap
                }
                
                worker_folder_name = f"{rpe}_{nombre.replace(' ', '_')}"
                worker_out_dir = os.path.join(work_dir, worker_folder_name)
                files = process_single_worker(worker_data, TEMPLATES_DIR, worker_out_dir, export_format=export_format)
                
                for fpath in files:
                    arcname = os.path.join(worker_folder_name, os.path.basename(fpath))
                    zipf.write(fpath, arcname)
                    
                processed_workers += 1
                
        shutil.rmtree(work_dir, ignore_errors=True)
        
        if processed_workers == 0:
            return jsonify({"error": "No se encontraron filas válidas con RPE/RTT y Nombre"}), 400
            
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
            "puesto_actual": "TEMPORAL SINDICALIZADO",
            "area": "ZONA TOLUCA",
            "clave": "623X5",
            "puesto_probar": "AYUDANTE LINIERO (SERVICIO AL CLIENTE)",
            "fecha_fisica": "2026-08-14"
        },
        {
            "rpe": "84729",
            "nombre": "CARLOS ROBERTO MARTINEZ SANCHEZ",
            "puesto_actual": "LINIERO LV",
            "area": "ZONA TOLUCA",
            "clave": "DN500",
            "puesto_probar": "ENCARGADO SECCION COMERCIAL",
            "fecha_fisica": "2026-08-14"
        },
        {
            "rpe": "H1029",
            "nombre": "MARIA FERNANDA LOPEZ GONZALEZ",
            "puesto_actual": "TEMPORAL SINDICALIZADO",
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
