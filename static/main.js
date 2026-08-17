/* ==========================================================================
   SistemaCOS - CFE Frontend Controller & Database Dynamic Loader System
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
    if (!currentPreviewScores) {
        currentPreviewScores = generateClientRandomScores();
    }
    await fetchWorkersDbInfo();
    await fetchProfiles();
    renderActivities();
    renderMiniScores();
    validateAndAdjustDateInput();
    handleRpeInput();
    setupDropzone();

    const dateInput = document.getElementById("input-fecha-fisica");
    if (dateInput) dateInput.addEventListener("change", handleDateInputChange);

    // Prevenir envío accidental del formulario al presionar ENTER
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

// Fetch & Update Database Status Info Across Header and Tab 3
async function fetchWorkersDbInfo() {
    try {
        const res = await fetch("/api/workers/info");
        if (res.ok) {
            const data = await res.json();
            updateDbInfoUI(data);
        }
    } catch (err) {
        console.error("Error consultando información de la base de datos:", err);
    }
}

function updateDbInfoUI(data) {
    if (!data) return;

    // Header Status Bar
    const barCount = document.getElementById("bar-db-count");
    const barTime = document.getElementById("bar-db-time");
    const barFile = document.getElementById("bar-db-file");

    if (barCount) barCount.innerText = data.count;
    if (barTime) barTime.innerText = data.last_modified || "Recién iniciado";
    if (barFile) barFile.innerHTML = `<i class="fa-solid fa-file-excel text-cfe"></i> ${data.filename}`;

    // Tab 3 Database Card
    const dbCount = document.getElementById("db-workers-count");
    const dbLastModBadge = document.getElementById("db-last-mod-badge");

    if (dbCount) dbCount.innerText = data.count;
    if (dbLastModBadge) {
        dbLastModBadge.innerHTML = `<i class="fa-solid fa-clock"></i> Última Modificación: <strong>${data.last_modified || "Sin registro"}</strong>`;
    }
}

// Force reload database from server disk
async function reloadWorkersDb() {
    try {
        const res = await fetch("/api/workers/reload-db", { method: "POST" });
        if (res.ok) {
            const data = await res.json();
            updateDbInfoUI(data);
            showToast(`¡Base de Datos recargada correctamente desde disco! (${data.count} trabajadores activos)`, "success");
        } else {
            showToast("Error al recargar la base de datos desde el archivo", "error");
        }
    } catch (err) {
        showToast("Error de conexión al recargar la base de datos", "error");
    }
}

// Handle File Upload for Database (Excel / CSV)
async function handleDbFileUploaded(e) {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    
    const formData = new FormData();
    formData.append("file", file);
    
    try {
        const res = await fetch("/api/workers/upload-db", {
            method: "POST",
            body: formData
        });
        
        if (res.ok) {
            const data = await res.json();
            await fetchWorkersDbInfo();
            showToast(`¡Base de Datos cargada y actualizada con éxito! (${data.count} trabajadores en catálogo)`, "success");
            // Clear input file value so user can re-upload if needed
            e.target.value = "";
        } else {
            const err = await res.json();
            showToast(`Error cargando base de datos: ${err.error}`, "error");
        }
    } catch (err) {
        showToast("Error de conexión al subir la base de datos de trabajadores", "error");
    }
}

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
                showToast(`Actividades del perfil '${puestoName}' vinculadas (${currentActivities.length} actividades)`, "success");
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

// RPE / RTT Validation (Exactly 5 Characters)
function handleRpeInput() {
    const rpeInput = document.getElementById("input-rpe");
    const warningBadge = document.getElementById("rpe-warning-badge");
    const btnSubmit = document.getElementById("btn-submit-single");
    
    const rpeVal = rpeInput.value.trim();

    if (rpeVal.length !== 5) {
        if (warningBadge) {
            warningBadge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> El RPE / RTT debe tener exactamente 5 caracteres (actual: ${rpeVal.length}). Ejemplo: G982P o 84729.`;
            warningBadge.classList.remove("hidden");
        }
        if (btnSubmit) btnSubmit.disabled = true;
    } else {
        if (warningBadge) {
            warningBadge.classList.add("hidden");
        }
        if (btnSubmit) btnSubmit.disabled = false;
        
        // Auto-sugerir Puesto Actual si es RTT (inicia con letra)
        const isTemporal = rpeVal && isNaN(rpeVal.charAt(0));
        const inputPuestoActual = document.getElementById("input-puesto-actual");
        if (inputPuestoActual && isTemporal && (!inputPuestoActual.value || inputPuestoActual.value === "BASE SINDICALIZADO")) {
            inputPuestoActual.value = "TEMPORAL SINDICALIZADO";
        }
        
        updatePreview();
    }
}

// Live Worker Search & Database Autocomplete
let searchDebounceTimer = null;

function handleWorkerSearch(query) {
    const clearBtn = document.getElementById("btn-clear-search");
    const resultsDropdown = document.getElementById("worker-search-results");
    
    if (!query || query.trim().length === 0) {
        if (clearBtn) clearBtn.classList.add("hidden");
        if (resultsDropdown) resultsDropdown.classList.add("hidden");
        return;
    }
    
    if (clearBtn) clearBtn.classList.remove("hidden");
    
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(async () => {
        try {
            const res = await fetch(`/api/workers/search?q=${encodeURIComponent(query.trim())}`);
            if (res.ok) {
                const workers = await res.json();
                renderWorkerSearchResults(workers);
            }
        } catch (err) {
            console.error("Error buscando trabajadores:", err);
        }
    }, 200);
}

function renderWorkerSearchResults(workers) {
    const dropdown = document.getElementById("worker-search-results");
    if (!dropdown) return;
    
    if (!workers || workers.length === 0) {
        dropdown.innerHTML = '<div style="padding: 12px; color: #64748b; text-align: center; font-size: 13px;"><i class="fa-solid fa-user-slash"></i> No se encontraron trabajadores en la base de datos.</div>';
        dropdown.classList.remove("hidden");
        return;
    }
    
    dropdown.innerHTML = "";
    workers.forEach((w) => {
        const item = document.createElement("div");
        item.className = "search-result-item";
        
        const isTemporal = w.worker_type ? w.worker_type.includes("TEMPORAL") : (w.rpe && isNaN(w.rpe.charAt(0)));
        const badgeClass = isTemporal ? "badge-rtt" : "badge-rpe";
        const badgeLabel = isTemporal ? "RTT (Temporal)" : "RPE (Base)";
        
        item.innerHTML = `
            <div class="search-result-info">
                <div class="search-result-name"><i class="fa-solid fa-user text-cfe"></i> ${w.nombre}</div>
                <div class="search-result-details">
                    <span><strong><i class="fa-solid fa-fingerprint"></i> RPE/RTT:</strong> ${w.rpe}</span> | 
                    <span><strong><i class="fa-solid fa-briefcase"></i> Base:</strong> ${w.puesto_actual || 'N/A'}</span> | 
                    <span><strong><i class="fa-solid fa-user-gear"></i> Probar:</strong> ${w.puesto_probar || 'N/A'}</span>
                </div>
            </div>
            <div class="search-result-badges">
                <span class="${badgeClass}">${badgeLabel}</span>
            </div>
        `;
        
        item.addEventListener("click", () => selectWorker(w));
        dropdown.appendChild(item);
    });
    
    dropdown.classList.remove("hidden");
}

function selectWorker(w) {
    if (!w) return;

    document.getElementById("input-nombre").value = w.nombre || "";
    document.getElementById("input-rpe").value = w.rpe || "";
    document.getElementById("input-clave").value = w.clave || "623X5";
    document.getElementById("input-area").value = w.area || "ZONA TOLUCA";
    
    const inputPuestoActual = document.getElementById("input-puesto-actual");
    if (inputPuestoActual) {
        inputPuestoActual.value = w.puesto_actual || (w.worker_type || "TEMPORAL SINDICALIZADO");
    }
    
    const inputPuestoProbar = document.getElementById("input-puesto-probar");
    if (inputPuestoProbar) {
        inputPuestoProbar.value = w.puesto_probar || "";
        handlePuestoInputChange(w.puesto_probar);
    }
    
    const selectPerfil = document.getElementById("select-perfil-puesto");
    if (selectPerfil && w.puesto_probar) {
        let found = false;
        for (let i = 0; i < selectPerfil.options.length; i++) {
            if (selectPerfil.options[i].value.toLowerCase() === w.puesto_probar.toLowerCase()) {
                selectPerfil.selectedIndex = i;
                found = true;
                break;
            }
        }
        if (!found) selectPerfil.value = "";
    }
    
    handleRpeInput();
    updatePreview();
    clearWorkerSearch();
    showToast(`Trabajador '${w.nombre}' cargado desde el catálogo CFE`, "success");
}

function clearWorkerSearch() {
    const input = document.getElementById("input-worker-search");
    if (input) input.value = "";
    const clearBtn = document.getElementById("btn-clear-search");
    if (clearBtn) clearBtn.classList.add("hidden");
    const dropdown = document.getElementById("worker-search-results");
    if (dropdown) dropdown.classList.add("hidden");
}

// Close search dropdown on outside click
document.addEventListener("click", (e) => {
    const searchWrapper = document.querySelector(".search-box-wrapper");
    const dropdown = document.getElementById("worker-search-results");
    if (dropdown && searchWrapper && !searchWrapper.contains(e.target)) {
        dropdown.classList.add("hidden");
    }
});

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
            warningBadge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Fecha ajustada al Viernes ${adjDay}/${adjMonth}/${adjYear} (días hábiles).`;
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
                    <i class="fa-solid fa-trash-can"></i>
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
    const puestoActualVal = document.getElementById("input-puesto-actual") ? document.getElementById("input-puesto-actual").value.trim() : "";

    if (rpe.length !== 5) return;

    const badge = document.getElementById("worker-type-badge");
    const prevWorkerType = document.getElementById("prev-worker-type-text");
    const prevPuestoActual = document.getElementById("prev-puesto-actual-text");
    const prevProfileMatched = document.getElementById("prev-profile-matched");

    const isTemporal = rpe && isNaN(rpe.charAt(0));
    const workerTypeStr = isTemporal ? "TEMPORAL SINDICALIZADO (RTT)" : "BASE SINDICALIZADO (RPE)";

    if (badge) badge.innerHTML = `<i class="fa-solid ${isTemporal ? 'fa-user-clock' : 'fa-user-check'}"></i> ${workerTypeStr}`;
    if (prevWorkerType) prevWorkerType.innerText = workerTypeStr;
    if (prevPuestoActual) prevPuestoActual.innerText = puestoActualVal || (isTemporal ? "TEMPORAL SINDICALIZADO" : "BASE SINDICALIZADO");
    if (prevProfileMatched) prevProfileMatched.innerText = puestoProbar || "PERSONALIZADO";

    if (badge) {
        if (isTemporal) {
            badge.className = "badge-tag";
        } else {
            badge.className = "badge-tag base";
        }
    }

    try {
        const res = await fetch("/api/preview-info", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rpe, puesto_actual: puestoActualVal, puesto_probar: puestoProbar, fecha_fisica: fechaFisica })
        });
        if (res.ok) {
            const data = await res.json();
            document.getElementById("prev-periodo-str").innerText = data.period_info.period_str;
            document.getElementById("prev-dias-habiles").innerText = `${data.period_info.working_days.length} Días (Sin Fines de Semana)`;
            
            if (!currentPreviewScores) {
                currentPreviewScores = data.sample_scores;
            }
            renderMiniScores(animate);
        }
    } catch (err) {
        console.error("Preview fetch error:", err);
    }
}

function generateClientRandomScores(minTotal = 80, maxTotal = 100) {
    const possibleTotals = [];
    for (let t = minTotal; t <= maxTotal; t += 2) {
        possibleTotals.push(t);
    }
    const targetTotal = possibleTotals[Math.floor(Math.random() * possibleTotals.length)];
    
    let k = Math.floor((targetTotal - 60) / 2);
    const increments = new Array(10).fill(0);
    
    while (k > 0) {
        const validIndices = [];
        for (let i = 0; i < 10; i++) {
            if (increments[i] < 2) validIndices.push(i);
        }
        if (validIndices.length === 0) break;
        const idx = validIndices[Math.floor(Math.random() * validIndices.length)];
        increments[idx]++;
        k--;
    }
    
    const scores = increments.map(inc => 6 + 2 * inc);
    for (let i = scores.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [scores[i], scores[j]] = [scores[j], scores[i]];
    }
    
    const apt = scores.slice(0, 5);
    const act = scores.slice(5, 10);
    const sumApt = apt.reduce((a, b) => a + b, 0);
    const sumAct = act.reduce((a, b) => a + b, 0);
    const total = sumApt + sumAct;
    
    return {
        aptitudes: apt,
        actitudes: act,
        sum_aptitudes: sumApt,
        sum_actitudes: sumAct,
        total: total
    };
}

function regenerateScoresPreview() {
    const btn = document.getElementById("btn-regenerate-scores");
    if (btn) {
        const icon = btn.querySelector("i");
        if (icon) {
            icon.classList.add("fa-spin");
            setTimeout(() => icon.classList.remove("fa-spin"), 400);
        }
    }
    currentPreviewScores = generateClientRandomScores();
    renderMiniScores(true);
    showToast("Calificaciones simuladas regeneradas (Suma Total ≥ 80)", "success");
}

function renderMiniScores(animate = false) {
    if (!currentPreviewScores) {
        currentPreviewScores = generateClientRandomScores();
    }
    const container = document.getElementById("mini-scores-container");
    if (!container) return;
    container.innerHTML = "";

    const labels = ["Conoc.", "Destr.", "Conf.", "Razon.", "Obs.", "Aplic.", "Trato", "Discip.", "Segur.", "Orden"];
    const allScores = [...currentPreviewScores.aptitudes, ...currentPreviewScores.actitudes];

    allScores.forEach((s, i) => {
        const box = document.createElement("div");
        box.className = animate ? "mini-score-box score-pop" : "mini-score-box";
        box.innerHTML = `<span>${labels[i]}</span><strong>${s}</strong>`;
        container.appendChild(box);
    });

    const totalEl = document.getElementById("prev-total-puntos");
    if (totalEl) {
        totalEl.innerText = `${currentPreviewScores.total} / 100`;
    }
}

// Handle Single Worker Generation
async function handleSingleGenerate(e) {
    e.preventDefault();
    handleRpeInput();
    validateAndAdjustDateInput();

    const rpeVal = document.getElementById("input-rpe").value.trim();
    if (rpeVal.length !== 5) {
        showToast("El RPE/RTT debe constar de exactamente 5 caracteres.", "error");
        return;
    }

    const exportFormatVal = "xlsx";
    const btn = document.getElementById("btn-submit-single");
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Generando Paquete (.ZIP)...`;

    const isTemporal = rpeVal && isNaN(rpeVal.charAt(0));
    const offJefeTemp = document.getElementById("off-jefe-temp") ? document.getElementById("off-jefe-temp").value : "ING. VICENTE G. RAMOS HUERTA";
    const offJefeBase = document.getElementById("off-jefe-base") ? document.getElementById("off-jefe-base").value : "ING. MARCO ANTONIO ESTRADA AMADOR";
    const selectedJefe = isTemporal ? offJefeTemp : offJefeBase;

        const formData = {
            nombre: document.getElementById("input-nombre").value.trim(),
            rpe: rpeVal,
            puesto_actual: document.getElementById("input-puesto-actual") ? document.getElementById("input-puesto-actual").value.trim() : "",
            clave: document.getElementById("input-clave").value.trim(),
            area: document.getElementById("input-area").value.trim(),
            puesto_probar: document.getElementById("input-puesto-probar").value.trim(),
            fecha_fisica: document.getElementById("input-fecha-fisica").value,
            activities: currentActivities,
            export_format: exportFormatVal,
            responsable_seguimiento: document.getElementById("off-seguimiento").value,
            responsable_encuesta: document.getElementById("off-encuesta").value,
            jefe_area: selectedJefe,
            jefe_area_temporal: offJefeTemp,
            jefe_area_base: offJefeBase,
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
        btn.innerHTML = `<i class="fa-solid fa-file-zipper"></i> Generar Paquete de 3 Formatos (.ZIP)`;
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
    showToast("Archivo cargado listo para procesar por lote", "success");
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

    const offJefeTemp = document.getElementById("off-jefe-temp") ? document.getElementById("off-jefe-temp").value : "ING. VICENTE G. RAMOS HUERTA";
    const offJefeBase = document.getElementById("off-jefe-base") ? document.getElementById("off-jefe-base").value : "ING. MARCO ANTONIO ESTRADA AMADOR";

    const exportFormatBatchVal = "xlsx";
    const loaderSub = document.getElementById("loader-subtitle");
    if (loaderSub) {
        loaderSub.innerText = "Vinculando perfiles de puesto y actividades de Gantt por cada trabajador.";
    }

    const formData = new FormData();
    formData.append("file", selectedBatchFile);
    formData.append("export_format", exportFormatBatchVal);
    formData.append("responsable_seguimiento", document.getElementById("off-seguimiento").value);
    formData.append("responsable_encuesta", document.getElementById("off-encuesta").value);
    formData.append("jefe_area_temporal", offJefeTemp);
    formData.append("jefe_area_base", offJefeBase);
    formData.append("jefe_area", offJefeTemp);
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
    if (!container) return;

    // Limpiar notificaciones previas de inmediato para evitar amontonamiento / fatiga visual
    container.innerHTML = "";

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    const icon = type === "success" ? "fa-circle-check text-green" : "fa-circle-exclamation text-red";
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
    }, 3000);
}
