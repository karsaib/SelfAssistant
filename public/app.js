"use strict";

/**
 * TaskManager — Kanban (COMING / ACTIVE / OVERDUE / DONE)
 * -------------------------------------------------------
 * Változások a kérés szerint:
 *  - 4 oszlop: COMING / ACTIVE / OVERDUE / DONE
 *  - A korábbi „mai piros” kiemelés megszűnt (cím mindig fekete).
 *  - Automatikus státuszolás betöltéskor:
 *      * ACTIVE: ma aktív feladat
 *      * OVERDUE: már lejárt
 *      * COMING: jövőbeli / még nem aktuális
 *      * DONE: kész
 *    KIVÉTEL (kérésed szerint): ami korábban NEW (legacy) vagy DONE volt, azt nem kényszerítjük át
 *    (NEW → egyszeri migráció COMING-ra, de nem tesszük át ACTIVE/OVERDUE-ba automatikusan).
 *  - Drag&Drop: bármelyik oszlopba áthúzható; csak a `status` mezőt mentjük (Calendar nélkül).
 */

/* ========================= 1) DOM ========================= */
const form = document.getElementById("taskForm");
const formTitle = document.getElementById("formTitle");
const listSection = document.getElementById("listSection");
const formSection = document.getElementById("formSection");
const newBtn = document.getElementById("newBtn");
const cancelBtn = document.getElementById("cancelBtn");
const allDayChk = document.getElementById("allDayChk");

const colComing  = document.getElementById("col-coming");
const colActive  = document.getElementById("col-active");
const colOverdue = document.getElementById("col-overdue");
const colDone    = document.getElementById("col-done");

const toggleCalBtn = document.getElementById("toggleCalBtn");
const calendarSection = document.getElementById("calendarSection");
const gcalFrame = document.getElementById("gcalFrame");

/* =========== 2) Google Calendar EMBED (opcionális) =========== */
const EMBED_CAL_ID = "";           // ← ÁLLÍTSD BE: ugyanaz mint .env GOOGLE_CALENDAR_ID
const TZ = "Europe/Budapest";
const AUTHUSER = 0;
function buildEmbedUrl() {
  const cal = encodeURIComponent(EMBED_CAL_ID);
  const tz = encodeURIComponent(TZ);
  return `https://calendar.google.com/calendar/embed?src=${cal}&ctz=${tz}&mode=WEEK&showPrint=0&showTabs=1&showTitle=0&showCalendars=1&authuser=${AUTHUSER}`;
}
toggleCalBtn?.addEventListener("click", () => {
  if (!EMBED_CAL_ID) { alert("Állíts be EMBED_CAL_ID értéket az app.js-ben!"); return; }
  const show = calendarSection.hidden;
  calendarSection.hidden = !show;
  if (show && !gcalFrame.src) gcalFrame.src = buildEmbedUrl();
});

/* ===================== 3) Helper függvények ===================== */
/** Mai nap YYYY-MM-DD (nap alapú összehasonlításhoz). */
function todayYMD() {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
/** Date obj pillanatnyilag (időalapú overdue számításhoz). */
function nowISO() { return new Date(); }

/** Emberbarát kiírás a dátum/idő mezőkből. */
function fmt(t) {
  const S = (d, tm) => (d ? d : "") + (tm ? " " + tm : "");
  if (t.allDay || (!t.startTime && !t.endTime)) {
    const s = t.startDate || t.due || "";
    const e = t.endDate || s || "";
    return s ? (e && e !== s ? `${s} – ${e} (all-day)` : `${s} (all-day)`) : "";
  } else if (t.startDate && t.startTime) {
    const s = S(t.startDate, t.startTime);
    const e = S(t.endDate || t.startDate, t.endTime || "");
    return e.trim() ? `${s} → ${e}` : s;
  }
  return "";
}

/** Kis hash → determinisztikus szín/dőlés. */
function hash(s){ let h=0; for(let i=0;i<s.length;i++){ h=((h<<5)-h)+s.charCodeAt(i); h|=0; } return Math.abs(h); }
function colorClassFor(t){ const key=(t.tag||t.title||t.id||"x"); return "c"+(hash(key)%8); }
function rotationFor(t){ const deg=(hash(t.id||t.title||"x")%9)-4; return deg/2; }

/** Ma aktív-e (nap szerinti logika – időponttól függetlenül a napra nézünk). */
function isActiveToday(t){
  if (t.done) return false;
  const today = todayYMD();
  const start = t.startDate || t.due || null;
  const end   = t.endDate || start || null;
  if (!start) return false;
  if (t.allDay || (!t.startTime && !t.endTime)) {
    return today >= start && today <= end;
  }
  // időzített: a mai nap beleesik a [startDate, endDate] napok közé
  const endD = t.endDate || t.startDate;
  return today >= t.startDate && today <= endD;
}

/** Lejárt-e (időpont szerint, ha van; különben nap szerint). */
function isOverdue(t){
  if (t.done) return false;
  const now = nowISO();

  // időzített eset: számítsunk endDateTime-et (a szerverrel konzisztensen)
  if (t.startDate && t.startTime){
    const startDT = new Date(`${t.startDate}T${t.startTime}:00`);
    let endDT = null;

    if (t.endDate && t.endTime) {
      endDT = new Date(`${t.endDate}T${t.endTime}:00`);
    } else if (t.endDate && !t.endTime) {
      endDT = new Date(`${t.endDate}T23:59:00`);
    } else if (!t.endDate && t.endTime) {
      endDT = new Date(`${t.startDate}T${t.endTime}:00`);
    } else {
      endDT = new Date(startDT.getTime() + 60*60000); // +60 perc default
    }

    // ha az end <= start, korrigáljunk +30 perccel (mint a szerver)
    if (endDT <= startDT) endDT = new Date(startDT.getTime() + 30*60000);

    return now > endDT;
  }

  // all-day / csak dátum: ha az end nap már elmúlt
  const today = todayYMD();
  const s = t.startDate || t.due || null;
  const e = t.endDate || s || null;
  if (!s) return false;
  return e < today;
}

/* ===================== 4) Adatbetöltés + migráció ===================== */
let tasks = []; // kliens cache

/**
 * Betöltés után:
 *  - Legacy státuszok migrálása: "new" → "coming", "progress" → (automata besorolás)
 *  - Automatikus besorolás ACTIVE/OVERDUE/COMING (kivételek: coming & done nem változik)
 *  - Változás esetén PUT a szerver felé (csak status mező, Calendar nélkül)
 */
async function load(){
  const r = await fetch("/api/tasks");
  tasks = await r.json();

  await migrateAndAutoClassify(tasks);
  render();
}

/** Egyszeri migráció + napi automatikus státuszolás. */
async function migrateAndAutoClassify(ts){
  const updates = [];

  for (const t of ts){
    const orig = t.status;

    // --- 1) Legacy: "new" → "coming"
    if (orig === "new"){
      t.status = "coming";
      updates.push({ id: t.id, status: t.status });
      continue; // ne automata-besoroljuk azonnal
    }

    // DONE: marad (ha külön "done" flag true, az UI-ban így is úgy is Done oszlopban lesz)
    if (orig === "done" || t.done === true){
      t.status = "done";
      if (orig !== "done") updates.push({ id: t.id, status: "done" });
      continue;
    }

    // COMING: kérés szerint NE kényszerítsük át ACTIVE/OVERDUE-ba automatikusan
    if (orig === "coming"){
      continue;
    }

    // --- 2) Ha nincs státusz, vagy legacy "progress"/"active"/"overdue": számoljuk újra
    const computed = computeStatusFromDates(t);
    if (computed && computed !== orig){
      t.status = computed;
      updates.push({ id: t.id, status: computed });
    }
  }

  // PUT-ek sorban, de nem blokkoljuk a UI-t hibára
  for (const u of updates){
    try{
      await fetch(`/api/tasks/${u.id}`, {
        method:"PUT", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ status: u.status })
      });
    }catch(_){}
  }
}

/** Dátum/idő alapján státusz: active / overdue / coming. (done-t nem adunk itt.) */
function computeStatusFromDates(t){
  if (isOverdue(t)) return "overdue";
  if (isActiveToday(t)) return "active";
  return "coming";
}

/* ======================== 5) Render + DnD ======================== */
function render(){
  colComing.innerHTML = colActive.innerHTML = colOverdue.innerHTML = colDone.innerHTML = "";

  for (const t of tasks){
    const card = document.createElement("div");
    card.className = `card ${colorClassFor(t)}`;
    card.style.setProperty("--rot", rotationFor(t)+"deg");
    card.draggable = true;
    card.dataset.id = t.id;

    const title = document.createElement("h3");
    title.className = "note-title";
    title.textContent = t.title; // nincs piros kiemelés

    const meta = document.createElement("div");
    meta.className = "meta";
    const when = document.createElement("div"); when.className = "when"; when.textContent = fmt(t);
    const desc = document.createElement("div"); desc.className = "desc"; desc.textContent = t.notes || "";
    meta.append(when, desc);

    const tag = document.createElement("div");
    if (t.tag){ tag.className="tag"; tag.textContent=t.tag; }

    const actions = document.createElement("div");
    actions.className = "actions";
    const editBtn = document.createElement("button");
    editBtn.className = "btn"; editBtn.textContent = "Edit";
    editBtn.addEventListener("click", ()=> showForm(true, t));
    const delBtn = document.createElement("button");
    delBtn.className = "btn danger"; delBtn.textContent = "Delete";
    delBtn.addEventListener("click", async ()=>{
      if (confirm(`Biztos törlöd? (${t.title})`)){
        await fetch(`/api/tasks/${t.id}`, { method:"DELETE" });
        load();
      }
    });
    actions.append(editBtn, delBtn);

    card.append(title, meta, tag, actions);

    // megfelelő oszlop:
    const s = t.status || "coming";
    (s === "done" ? colDone : s === "active" ? colActive : s === "overdue" ? colOverdue : colComing)
      .appendChild(card);

    // Drag forrás
    card.addEventListener("dragstart", (e)=>{
      e.dataTransfer.setData("text/plain", t.id);
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", ()=> card.classList.remove("dragging"));
  }

  // Drop célok
  for (const [col, status] of [
    [colComing,  "coming"],
    [colActive,  "active"],
    [colOverdue, "overdue"],
    [colDone,    "done"],
  ]){
    col.ondragover = (e)=>{
      e.preventDefault();
      col.classList.add("drag-over");
      const after = getDragAfterElement(col, e.clientY);
      const dragging = document.querySelector(".card.dragging");
      if (!dragging) return;
      if (after == null) col.appendChild(dragging);
      else col.insertBefore(dragging, after);
    };
    col.ondragleave = ()=> col.classList.remove("drag-over");
    col.ondrop = async (e)=>{
      e.preventDefault();
      col.classList.remove("drag-over");
      const id = e.dataTransfer.getData("text/plain");
      const t = tasks.find(x=>x.id===id);
      if (!t) return;
      if (t.status !== status){
        t.status = status; // azonnali UI összhang
        try{
          await fetch(`/api/tasks/${t.id}`, {
            method:"PUT", headers:{ "Content-Type":"application/json" },
            body: JSON.stringify({ status })
          });
        }catch(_){}
      }
    };
  }
}

/** „Beillesztési hely” meghatározása a kurzor y alapján. */
function getDragAfterElement(container, y){
  const els = [...container.querySelectorAll(".card:not(.dragging)")];
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
  for (const el of els){
    const box = el.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset){
      closest = { offset, element: el };
    }
  }
  return closest.element;
}

/* ======================== 6) Űrlap-kezelés ======================== */
function showForm(editing=false, data={}){
  listSection.hidden = true; formSection.hidden = false;
  formTitle.textContent = editing ? "Edit Task" : "New Task";
  form.id.value    = data.id || "";
  form.title.value = data.title || "";
  form.tag.value   = data.tag || "";
  form.notes.value = data.notes || "";
  form.done.checked = !!data.done;

  const startDate = data.startDate || data.due || "";
  form.allDay.checked  = !!data.allDay || (!data.startTime && !data.endTime && (startDate));
  form.startDate.value = startDate;
  form.startTime.value = data.startTime || "";
  form.endDate.value   = data.endDate || "";
  form.endTime.value   = data.endTime || "";

  toggleTimeInputs();
}
function showList(){ formSection.hidden = true; listSection.hidden = false; }
function toggleTimeInputs(){
  const dis = allDayChk.checked;
  form.startTime.disabled = dis;
  form.endTime.disabled   = dis;
}
allDayChk.addEventListener("change", toggleTimeInputs);

newBtn.addEventListener("click", ()=> showForm(false, { status:"coming" }));
cancelBtn.addEventListener("click", ()=> { showList(); load(); });

form.addEventListener("submit", async (e)=>{
  e.preventDefault();
  if (!form.title.value.trim()){ alert("Title kötelező"); return; }
  const allDay = form.allDay.checked;
  const payload = {
    title: form.title.value,
    tag: (form.tag.value||"").trim(),
    notes: form.notes.value,
    done: form.done.checked,
    allDay,
    startDate: form.startDate.value || null,
    startTime: allDay ? null : (form.startTime.value || null),
    endDate:   form.endDate.value || null,
    endTime:   allDay ? null : (form.endTime.value || null),
  };

  try{
    if (form.id.value){
      await fetch(`/api/tasks/${form.id.value}`, {
        method:"PUT", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });
    } else {
      payload.status = "coming"; // új kártyák COMING oszlop
      await fetch("/api/tasks", {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });
    }
  }catch(_){}

  showList(); load();
});

/* ======================== 7) Indítás ======================== */
load();
