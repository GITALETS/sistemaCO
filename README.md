# SistemaCOS

Sistema de Correspondencia y Evaluación de Personal para la generación, gestión y automatización de formatos institucionales de evaluación laboral (CO-03-01, CO-03-02 y CO-03-03).

---

## Tabla de Contenidos

- [Descripción General](#descripción-general)
- [Características Principales](#características-principales)
- [Arquitectura del Sistema](#arquitectura-del-sistema)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Requisitos del Sistema](#requisitos-del-sistema)
- [Instalación y Configuración](#instalación-y-configuración)
- [Uso del Aplicativo](#uso-del-aplicativo)
- [Endpoints de la API](#endpoints-de-la-api)
- [Despliegue](#despliegue)
- [Licencia](#licencia)

---

## Descripción General

**SistemaCOS** es una plataforma web desarrollada en Python con Flask y JavaScript que automatiza la elaboración de expedientes de correspondencia y evaluación laboral para personal de base y temporal sindicalizado.

El sistema procesa y genera automáticamente tres formatos institucionales clave:
1. **CO-03-01 (Seguimiento Programado Especial de Tarea):** Construye un diagrama de Gantt automatizado calculando días hábiles del mes evaluado y mapeando actividades según el perfil de puesto.
2. **CO-03-02 (Valoración de Aptitudes y Actitudes):** Procesa criterios cualitativos y cuantitativos de desempeño laboral.
3. **CO-03-03 (Encuesta Tarea):** Aplica y consolida encuestas estandarizadas de evaluación.

---

## Características Principales

- **Captura Individual y Carga Masiva:** Permite generar expedientes para un trabajador individual mediante formularios interactivos o de forma masiva cargando archivos en formato Excel (`.xlsx`, `.xls`) o CSV, generando paquetes comprimidos en ZIP.
- **Búsqueda Predictiva en Tiempo Real:** Integra un buscador en vivo sobre el catálogo de trabajadores (`BD_TRABAJADORES2026.xlsx`) filtrando por RPE/RTT, Nombre o Puesto.
- **Gestión Dinámica de Perfiles de Puesto:** Extrae de manera automatizada las actividades operativas especificadas en los archivos plantillas de puesto (`CO-03-01 SEGUIMIENTO_PROG_ESP_TAREA *.xlsx`).
- **Determinación Automática de Periodo y Días Hábiles:** Calcula el mes objeto de evaluación a partir de la fecha física ingresada y contabiliza únicamente los días hábiles del periodo, omitiendo fines de semana.
- **Lógica de Firmas Institucionales Adaptativa:** Identifica automáticamente el tipo de trabajador (Base vs. Temporal Sindicalizado) asignando los responsables y jefes de área correspondientes.
- **Exportación Dual (Excel y PDF):** Genera libros nativos de Excel con preservación de fórmulas y estilos visuales, o documentos en formato PDF listos para impresión y firma mediante LibreOffice headless o interfaces COM.

---

## Arquitectura del Sistema

```
+-------------------------------------------------------+
|                    Interfaz Web                       |
|           (HTML5 / Vanilla CSS3 / JavaScript)         |
+---------------------------+---------------------------+
                            | HTTP / REST API
                            v
+-------------------------------------------------------+
|                    Servidor Flask                     |
|                 (app.py - Controller)                 |
+---------------------------+---------------------------+
                            |
        +-------------------+-------------------+
        |                                       |
        v                                       v
+-----------------------+               +-----------------------+
| Engine de Procesamiento|               | Catálogo de Personal  |
|  (excel_processor.py) |               |  (Pandas / OpenPyXL)  |
+-----------+-----------+               +-----------------------+
            |
            +-------------------+
            |                   |
            v                   v
+-----------------------+ +-----------------------+
|  Generación de Excel  | |   Conversión a PDF    |
| (OpenPyXL / XlsxWriter| |(LibreOffice / WinCOM) |
+-----------------------+ +-----------------------+
```

---

## Estructura del Proyecto

```
SistemaCOS/
├── app.py                      # Punto de entrada de la aplicación Flask y rutas API
├── excel_processor.py          # Lógica de negocio, manipulación de libros y exportación
├── requirements.txt            # Lista de dependencias del proyecto Python
├── Procfile                    # Configuración de ejecución para servicios en la nube (Gunicorn)
├── BD_TRABAJADORES2026.xlsx    # Archivo base de datos del catálogo de personal
├── static/                     # Recursos web estáticos
│   ├── index.html              # Interfaz de usuario de la aplicación
│   └── styles.css              # Hoja de estilos con arquitectura CSS moderna
├── temp_downloads/             # Directorio para almacenamiento de archivos temporales
└── CO-03-01 SEGUIMIENTO...xlsx # Plantillas institucionales por perfil de puesto
```

---

## Requisitos del Sistema

- **Python:** Versión 3.10 o superior.
- **Entorno de Conversión PDF (Opcional):**
  - **Servidores Linux / Contenedores:** LibreOffice instalado (`libreoffice --headless`).
  - **Entornos Windows:** Microsoft Excel instalado con soporte para automatización COM (`pywin32` / `comtypes`) o LibreOffice.

---

## Instalación y Configuración

### 1. Clonar el repositorio

```bash
git clone https://github.com/tu-usuario/SistemaCOS.git
cd SistemaCOS
```

### 2. Crear y activar un entorno virtual

En Windows (PowerShell / CMD):

```powershell
python -m venv venv
.\venv\Scripts\activate
```

En Linux / macOS:

```bash
python3 -m venv venv
source venv/bin/activate
```

### 3. Instalar dependencias

```bash
pip install -r requirements.txt
```

---

## Uso del Aplicativo

### Ejecución en Modo Desarrollo

Para iniciar el servidor local de desarrollo:

```bash
python app.py
```

El aplicativo estará accesible desde el navegador web en la dirección:
`http://localhost:5000`

### Módulos de la Interfaz

1. **Captura Individual:** Ingrese o busque un trabajador en el catálogo. Seleccione el puesto a evaluar, la fecha física y la plantilla de perfil. Haga clic en generar para obtener el paquete de formatos en ZIP (archivos Excel o PDF).
2. **Carga Masiva (Excel):** Cargue una lista de trabajadores utilizando la plantilla estándar del sistema. El sistema generará una carpeta por cada trabajador agrupada dentro de un archivo comprimido único.
3. **Firmas y Base de Datos:** Administre los nombres del personal directivo/evaluador y actualice el catálogo de trabajadores mediante la carga directa de un nuevo archivo Excel o CSV.

---

## Endpoints de la API

### Catálogo de Trabajadores

- `GET /api/workers/info`
  Retorna el estado del catálogo, total de registros cargados y fecha de última modificación.
- `GET /api/workers/search?q={query}`
  Búsqueda predictiva de trabajadores por RPE/RTT, Nombre o Puesto.
- `POST /api/workers/upload-db`
  Permite reemplazar la base de datos de trabajadores mediante un archivo `.xlsx`, `.xls` o `.csv`.
- `POST /api/workers/reload-db`
  Recarga la base de datos directamente desde el archivo guardado en el servidor.
- `GET /api/workers/download-template-db`
  Descarga la plantilla de Excel requerida para la base de datos de trabajadores.

### Procesamiento y Generación

- `GET /api/profiles`
  Devuelve los perfiles de puesto disponibles e identificados en el sistema.
- `POST /api/preview-info`
  Genera una vista previa del periodo calculated, actividades asociadas y calificaciones muestra.
- `POST /api/generate-single`
  Procesa y devuelve un archivo ZIP con los formatos de un trabajador individual.
- `POST /api/generate-batch`
  Procesa de forma masiva un archivo de trabajadores y devuelve la estructura de formatos en ZIP.
- `GET /api/download-template-excel`
  Descarga la plantilla oficial para la carga masiva de evaluaciones.

---

## Despliegue

El proyecto incluye un archivo `Procfile` preconfigurado para entornos de producción en la nube (ej. Render, Heroku, Dokku):

```
web: gunicorn app:app
```

Para ejecutar con Gunicorn de manera local en entornos de producción:

```bash
gunicorn --bind 0.0.0.0:5000 app:app
```

---

## Licencia

Este proyecto es de carácter institucional y privado. Todos los derechos reservados.
