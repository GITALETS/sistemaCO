/* ==========================================================================
   SistemaCOS - Frontend Controller Logic with Job Profiles System
   ========================================================================== */

let loadedProfiles = [];
let currentActivities = [
    "Cortes",
    "conexión de servicio nuevo",
    "Reconexiones",
    "Restablecimiento de suministro eléctrico baja tensión",
    "Restablecimiento de suministro eléctrico media tensión",
    "Atención de solicitudes de servicio"
];

let selectedBatchFile = null;
let currentPreviewScores = null;

document.addEventListener("DOMContentLoaded", async () => {
    await fetchProfiles();
    renderActivities();
    validateAndAdjustDateInput();
    handleRpeInput();
    setupDropzone();

    const dateInput = document.getElementById("input-fecha-fisica");
    if (dateInput) dateInput.addEventListener("change", handleDateInputChange);

    // Prevenir envío accidental del formulario al presionar la tecla ENTER en los inputs
    const formSingle = document.getElementById("form-single-worker");
    if (formSingle) {
        formSingle.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && e.target.tagName !== "BUTTON" && e.target.type !== "submit") {
                e.preventDefault();
                if (e.target.id === "input-puesto-probar") {
                    handlePuestoInputChange(e.target.value);
                }
                return false;
            }
        });
    }
});

// Load Job Profiles from Backend
async function fetchProfiles() {
    try {
        const res = await fetch("/api/profiles");
        if (res.ok) {
            loadedProfiles = await res.json();
            populateProfileSelect();
        }
    } catch (err) {
        console.error("Error cargando perfiles:", err);
    }
}

function populateProfileSelect() {
    const select = document.getElementById("select-perfil-puesto");
    if (!select) return;

    select.innerHTML = '<option value="">-- Seleccionar Perfil de Puesto Registrado --</option>';

    loadedProfiles.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.puesto;
        opt.innerText = `${p.puesto} (${p.activities.length} actividades)`;
        select.appendChild(opt);
    });
}

async function handleProfileSelectChange(puestoValue) {
    if (!puestoValue) return;

    document.getElementById("input-puesto-probar").value = puestoValue;
    await loadActivitiesForPuesto(puestoValue);
}

async function handlePuestoInputChange(puestoValue) {
    if (!puestoValue) return;
    await loadActivitiesForPuesto(puestoValue);
}

async function loadActivitiesForPuesto(puestoName) {
    try {
        const res = await fetch("/api/profile-activities", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ puesto: puestoName })
        });
        if (res.ok) {
            const data = await res.json();
            if (data.activities && data.activities.length > 0) {
                currentActivities = [...data.activities];
                renderActivities();
                updatePreview();
                showToast(`Actividades del perfil '${puestoName}' cargadas (${currentActivities.length} actividades)`, "success");
            }
        }
    } catch (err) {
        console.error("Error al obtener actividades del perfil:", err);
    }
}

// Tab Navigation
function switchTab(tabName) {
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(content => content.classList.remove("active"));

    document.getElementById(`tab-btn-${tabName}`).classList.add("active");
    document.getElementById(`tab-content-${tabName}`).classList.add("active");
}

// RPE Validation (Exactly 5 Characters)
function handleRpeInput() {
    const rpeInput = document.getElementById("input-rpe");
    const warningBadge = document.getElementById("rpe-warning-badge");
    const btnSubmit = document.getElementById("btn-submit-single");
    
    const rpeVal = rpeInput.value.trim();

    if (rpeVal.length !== 5) {
        if (warningBadge) {
            warningBadge.innerText = `⚠️ El RPE / RPU debe tener exactamente 5 caracteres (longitud actual: ${rpeVal.length}). Ejemplo: G982P o 84729.`;
            warningBadge.classList.remove("hidden");
        }
        if (btnSubmit) btnSubmit.disabled = true;
    } else {
        if (warningBadge) {
            warningBadge.classList.add("hidden");
        }
        if (btnSubmit) btnSubmit.disabled = false;
        updatePreview();
    }
}

// Date Picker Weekend Validation
function handleDateInputChange() {
    validateAndAdjustDateInput();
    updatePreview();
}

function validateAndAdjustDateInput() {
    const dateInput = document.getElementById("input-fecha-fisica");
    const warningBadge = document.getElementById("date-warning-badge");

    if (!dateInput || !dateInput.value) return;

    const parts = dateInput.value.split("-");
    if (parts.length !== 3) return;

    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);

    const dt = new Date(Date.UTC(year, month, day));
    const dayOfWeek = dt.getUTCDay();

    if (dayOfWeek === 0 || dayOfWeek === 6) {
        const daysToSubtract = dayOfWeek === 6 ? 1 : 2;
        const adjustedDt = new Date(Date.UTC(year, month, day - daysToSubtract));
        
        const adjYear = adjustedDt.getUTCFullYear();
        const adjMonth = String(adjustedDt.getUTCMonth() + 1).padStart(2, '0');
        const adjDay = String(adjustedDt.getUTCDate()).padStart(2, '0');

        dateInput.value = `${adjYear}-${adjMonth}-${adjDay}`;

        if (warningBadge) {
            warningBadge.innerText = `⚠️ La fecha física no puede ser Sábado o Domingo. Se ajustó al Viernes ${adjDay}/${adjMonth}/${adjYear}.`;
            warningBadge.classList.remove("hidden");
        }

        showToast(`⚠️ Fin de semana no permitido. Fecha ajustada al Viernes hábil (${adjDay}/${adjMonth}/${adjYear}).`, "error");
    } else {
        if (warningBadge) {
            warningBadge.classList.add("hidden");
        }
    }
}

// Activity Rows Management
function renderActivities() {
    const container = document.getElementById("activities-container");
    const countBadge = document.getElementById("activities-profile-count");

    if (countBadge) {
        countBadge.innerText = `${currentActivities.length} Actividades`;
    }

    container.innerHTML = "";

    currentActivities.forEach((act, idx) => {
        const row = document.createElement("div");
        row.className = "activity-row";
        row.innerHTML = `
            <input type="text" value="${act}" onchange="updateActivityText(${idx}, this.value)" placeholder="Nombre de actividad ${idx + 1}">
            ${currentActivities.length > 1 ? `
                <button type="button" class="btn-xs btn-danger" onclick="removeActivityRow(${idx})">
                    <i class="fa-solid fa-trash"></i>
                </button>
            ` : ''}
        `;
        container.appendChild(row);
    });
}

function addActivityRow() {
    if (currentActivities.length >= 10) {
        showToast("Máximo 10 actividades permitidas en la plantilla", "error");
        return;
    }
    currentActivities.push(`Nueva Actividad ${currentActivities.length + 1}`);
    renderActivities();
}

function removeActivityRow(idx) {
    currentActivities.splice(idx, 1);
    renderActivities();
}

function updateActivityText(idx, val) {
    currentActivities[idx] = val;
}

// Live Preview Update
async function updatePreview() {
    const rpe = document.getElementById("input-rpe").value.trim();
    const puestoProbar = document.getElementById("input-puesto-probar").value.trim();
    const fechaFisica = document.getElementById("input-fecha-fisica").value;

    if (rpe.length !== 5) return;

    const badge = document.getElementById("worker-type-badge");
    const prevWorkerType = document.getElementById("prev-worker-type-text");
    const prevProfileMatched = document.getElementById("prev-profile-matched");

    const isTemporal = rpe && isNaN(rpe.charAt(0));
    const workerTypeStr = isTemporal ? "TEMPORAL SINDICALIZADO" : "BASE SINDICALIZADO";

    badge.innerText = workerTypeStr;
    prevWorkerType.innerText = workerTypeStr;
    if (prevProfileMatched) prevProfileMatched.innerText = puestoProbar || "PERSONALIZADO";

    if (isTemporal) {
        badge.className = "badge-tag";
    } else {
        badge.className = "badge-tag base";
    }

    try {
        const res = await fetch("/api/preview-info", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rpe, puesto_probar: puestoProbar, fecha_fisica: fechaFisica })
        });
        if (res.ok) {
            const data = await res.json();
            document.getElementById("prev-periodo-str").innerText = data.period_info.period_str;
            document.getElementById("prev-dias-habiles").innerText = `${data.period_info.working_days.length} Días (Sin Fines de Semana)`;
            
            if (!currentPreviewScores) {
                currentPreviewScores = data.sample_scores;
            }
            renderMiniScores();
        }
    } catch (err) {
        console.error("Preview fetch error:", err);
    }
}

function regenerateScoresPreview() {
    currentPreviewScores = null;
    updatePreview();
    showToast("Puntuaciones aleatorias regeneradas (Total ≥ 80)", "success");
}

function renderMiniScores() {
    if (!currentPreviewScores) return;
    const container = document.getElementById("mini-scores-container");
    container.innerHTML = "";

    const labels = ["Conoc.", "Destr.", "Conf.", "Razon.", "Obs.", "Aplic.", "Trato", "Discip.", "Segur.", "Orden"];
    const allScores = [...currentPreviewScores.aptitudes, ...currentPreviewScores.actitudes];

    allScores.forEach((s, i) => {
        const box = document.createElement("div");
        box.className = "mini-score-box";
        box.innerHTML = `<span>${labels[i]}</span><strong>${s}</strong>`;
        container.appendChild(box);
    });

    document.getElementById("prev-total-puntos").innerText = `${currentPreviewScores.total} / 100 (≥ 80)`;
}

// Handle Single Worker Generation
async function handleSingleGenerate(e) {
    e.preventDefault();
    handleRpeInput();
    validateAndAdjustDateInput();

    const rpeVal = document.getElementById("input-rpe").value.trim();
    if (rpeVal.length !== 5) {
        showToast("El RPE/RPU debe constar de exactamente 5 caracteres.", "error");
        return;
    }

    const btn = document.getElementById("btn-submit-single");
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Generando Paquete...`;

    const formData = {
        nombre: document.getElementById("input-nombre").value.trim(),
        rpe: rpeVal,
        clave: document.getElementById("input-clave").value.trim(),
        area: document.getElementById("input-area").value.trim(),
        puesto_probar: document.getElementById("input-puesto-probar").value.trim(),
        fecha_fisica: document.getElementById("input-fecha-fisica").value,
        activities: currentActivities,
        responsable_seguimiento: document.getElementById("off-seguimiento").value,
        responsable_encuesta: document.getElementById("off-encuesta").value,
        jefe_area: document.getElementById("off-jefe").value,
        representante_capacitacion: document.getElementById("off-capacitacion").value
    };

    try {
        const res = await fetch("/api/generate-single", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formData)
        });

        if (res.ok) {
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `Formatos_COS_${formData.rpe}_${formData.nombre.replace(/\s+/g, '_')}.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            showToast("¡Archivos Excel generados e integrados en ZIP con éxito!", "success");
        } else {
            const errData = await res.json();
            showToast(`Error: ${errData.error}`, "error");
        }
    } catch (err) {
        showToast("Error de conexión con el servidor", "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-file-arrow-down"></i> Generar Paquete de 3 Formatos (.ZIP)`;
    }
}

// Drag and Drop & Batch Processing
function setupDropzone() {
    const dropzone = document.getElementById("dropzone");

    ["dragenter", "dragover"].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add("dragover");
        }, false);
    });

    ["dragleave", "drop"].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove("dragover");
        }, false);
    });

    dropzone.addEventListener("drop", (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            setBatchFile(files[0]);
        }
    });
}

function handleFileSelected(e) {
    if (e.target.files.length > 0) {
        setBatchFile(e.target.files[0]);
    }
}

function setBatchFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
        showToast("Por favor selecciona un archivo .xlsx, .xls o .csv", "error");
        return;
    }
    selectedBatchFile = file;
    document.getElementById("batch-file-name").innerText = file.name;
    document.getElementById("batch-file-size").innerText = `${(file.size / 1024).toFixed(1)} KB`;
    document.getElementById("file-info-container").classList.remove("hidden");
    document.getElementById("btn-process-batch").disabled = false;
    showToast("Archivo cargado listo para procesar", "success");
}

function clearBatchFile() {
    selectedBatchFile = null;
    document.getElementById("input-file-batch").value = "";
    document.getElementById("file-info-container").classList.add("hidden");
    document.getElementById("btn-process-batch").disabled = true;
}

async function handleBatchGenerate() {
    if (!selectedBatchFile) return;

    const loader = document.getElementById("batch-loader");
    loader.classList.remove("hidden");

    const formData = new FormData();
    formData.append("file", selectedBatchFile);
    formData.append("responsable_seguimiento", document.getElementById("off-seguimiento").value);
    formData.append("responsable_encuesta", document.getElementById("off-encuesta").value);
    formData.append("jefe_area", document.getElementById("off-jefe").value);
    formData.append("representante_capacitacion", document.getElementById("off-capacitacion").value);

    try {
        const res = await fetch("/api/generate-batch", {
            method: "POST",
            body: formData
        });

        if (res.ok) {
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `Paquete_Masivo_COS_${Date.now()}.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            showToast("¡Lote procesado con éxito! Se ha descargado el paquete ZIP.", "success");
            clearBatchFile();
        } else {
            const errData = await res.json();
            showToast(`Error masivo: ${errData.error}`, "error");
        }
    } catch (err) {
        showToast("Error procesando el lote en el servidor", "error");
    } finally {
        loader.classList.add("hidden");
    }
}

function saveOfficials(e) {
    e.preventDefault();
    showToast("Ajustes de firmas e institucionales guardados correctamente", "success");
}

function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    const icon = type === "success" ? "fa-circle-check text-green" : "fa-circle-exclamation text-red";
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 4000);
}
