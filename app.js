import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Credenciales tomadas de tu pantalla
const firebaseConfig = {
  apiKey: "AIzaSyCuC-e4Cv4JaIUAdq3Ecudf8aqK4VdxQ84",
  authDomain: "agenda-posgrado-fca.firebaseapp.com",
  projectId: "agenda-posgrado-fca",
  storageBucket: "agenda-posgrado-fca.firebasestorage.app",
  messagingSenderId: "514757808587",
  appId: "TU_APP_ID_AQUI" 
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const eventsCollection = collection(db, "events");

const areaColors = {
  'Secretaría Académica': { key: 'acad', text: '#142a45', bg: '#e7effa', border: '#3c6fa8' },
  'Secretaría de Asuntos Estudiantiles y Bienestar de la Comunidad': { key: 'bien', text: '#39184d', bg: '#f2e9f8', border: '#8751a5' },
  'Secretaría de Investigación, Internacionales y Posgrado': { key: 'siip', text: '#123847', bg: '#d9f2fb', border: '#007ea3' },
  'Secretaría de Vinculación y Extensión': { key: 'vinc', text: '#4a2c03', bg: '#fff1df', border: '#c4771c' },
  'Decanato': { key: 'deca', text: '#2d4514', bg: '#f1f5eb', border: '#67823a' },
  'Otro': { key: 'otro', text: '#282d33', bg: '#eef0f2', border: '#6f7780' }
};

let view = 'week';
let isAdmin = false;
let editingIndex = null;
let activeDetailIndex = null;
let currentMailTemplate = 'confirm';
let current = new Date('2026-09-14T12:00:00');
const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
let events = [];

const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const days = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

function formatLongDate(isoDate) {
  if(!isoDate) return '—';
  let [y, m, d] = isoDate.split('-').map(Number);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

function localIso(d) {
  let y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

function isCurrentActivity(e) {
  let now = new Date();
  if (e.startDate !== localIso(now)) return false;
  let [hStart, mStart] = e.startTime.split(':').map(Number);
  let [hEnd, mEnd] = (e.endTime || '23:59').split(':').map(Number);
  let currentMin = now.getHours() * 60 + now.getMinutes();
  return currentMin >= (hStart * 60 + mStart) && currentMin <= (hEnd * 60 + mEnd);
}

function filtered() {
  let af = document.getElementById('areaFilter') ? document.getElementById('areaFilter').value : '';
  let tf = document.getElementById('typeFilter') ? document.getElementById('typeFilter').value : '';
  let query = document.getElementById('searchInput') ? document.getElementById('searchInput').value.toLowerCase().trim() : '';

  return events.filter(e => {
    let matchAdmin = isAdmin || e.status === 'Confirmado' || e.status === 'Postergado' || e.status === 'Cancelado';
    let matchArea = !af || e.area === af;
    let matchType = !tf || e.type === tf;
    let matchSearch = !query || e.title.toLowerCase().includes(query) || (e.responsible && e.responsible.toLowerCase().includes(query));
    return matchAdmin && matchArea && matchType && matchSearch;
  });
}

function areaLabel(e) { return e.area === 'Otro' ? (e.otherArea || 'Otro') : e.area; }

function evHTML(e) {
  let inProgressHTML = isCurrentActivity(e) ? `<div class="in-progress-tag"><span class="in-progress-dot"></span> en curso</div>` : '';
  let areaKey = areaColors[e.area] ? areaColors[e.area].key : 'otro';

  return `<div class="event ${areaKey}" onclick="showDetail(${events.indexOf(e)})">
    <strong>${e.startTime}${e.endTime ? '–' + e.endTime : ''} · ${e.title}</strong>
    <small>${e.type}<br>${areaLabel(e)}</small>
    ${inProgressHTML}
  </div>`;
}

window.setView = function(v) {
  view = v;
  ['day', 'week', 'month'].forEach(x => {
    let btn = document.getElementById('b' + x);
    if (btn) btn.classList.toggle('active', x === v);
  });
  render();
};

window.goToday = function() { current = new Date('2026-09-14T12:00:00'); render(); };
window.move = function(n) {
  if (view === 'day') current.setDate(current.getDate() + n);
  else if (view === 'week') current.setDate(current.getDate() + 7 * n);
  else current.setMonth(current.getMonth() + n);
  render();
};

function monday(d) {
  let x = new Date(d), w = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - w);
  x.setHours(12, 0, 0, 0);
  return x;
}

window.render = function() {
  const labels = { day: 'VISTA DIARIA', week: 'VISTA SEMANAL', month: 'VISTA MENSUAL' };
  let vl = document.getElementById('viewLabel');
  if (vl) vl.textContent = labels[view];
  if (view === 'day') renderDay();
  else if (view === 'week') renderWeek();
  else renderMonth();
  updateActivityCount();
};

function updateActivityCount() {
  let fs = filtered(), n = 0;
  if (view === 'day') {
    let d = localIso(current);
    n = fs.filter(e => e.startDate === d).length;
  } else if (view === 'week') {
    let m = monday(current), end = new Date(m);
    end.setDate(m.getDate() + 6);
    n = fs.filter(e => {
      let d = new Date(e.startDate + 'T12:00:00');
      return d >= m && d <= end;
    }).length;
  } else {
    n = fs.filter(e => {
      let d = new Date(e.startDate + 'T12:00:00');
      return d.getMonth() === current.getMonth() && d.getFullYear() === current.getFullYear();
    }).length;
  }
  let el = document.getElementById('activityCount');
  if (el) el.textContent = `${n} ${n === 1 ? 'actividad' : 'actividades'}`;
}

function renderWeek() {
  let m = monday(current), fri = new Date(m); fri.setDate(m.getDate() + 6);
  let p = document.getElementById('period');
  if (p) p.textContent = `${m.getDate()} – ${fri.getDate()} de ${months[fri.getMonth()]} de ${fri.getFullYear()}`;
  let ds = []; for (let i = 0; i < 7; i++) { let d = new Date(m); d.setDate(m.getDate() + i); ds.push(d); }
  let html = `<div class='weekhead'><div></div>${ds.map(d => `<div>${days[d.getDay()]} ${d.getDate()}</div>`).join('')}</div><div class='weekgrid'>`;
  let fs = filtered();
  hours.forEach(h => {
    html += `<div class='time'>${String(h).padStart(2, '0')}:00</div>`;
    ds.forEach(d => {
      let di = localIso(d);
      let es = fs.filter(e => e.startDate === di && parseInt(e.startTime) === h);
      html += `<div class='cell'>${es.map(evHTML).join('')}</div>`;
    });
  });
  html += '</div>';
  document.getElementById('calendar').innerHTML = html;
}

function renderDay() {
  let p = document.getElementById('period');
  if (p) p.textContent = `${days[current.getDay()]} ${current.getDate()} de ${months[current.getMonth()]} de ${current.getFullYear()}`;
  let html = `<div class='weekhead' style='grid-template-columns:90px 1fr'><div></div><div>${days[current.getDay()]} ${current.getDate()}</div></div><div class='daywrap'>`;
  let d = localIso(current), fs = filtered();
  hours.forEach(h => {
    let es = fs.filter(e => e.startDate === d && parseInt(e.startTime) === h);
    html += `<div class='daytime'>${String(h).padStart(2, '0')}:00</div><div class='dayslot'>${es.map(evHTML).join('')}</div>`;
  });
  html += '</div>';
  document.getElementById('calendar').innerHTML = html;
}

function renderMonth() {
  let p = document.getElementById('period');
  if (p) p.textContent = `${months[current.getMonth()]} de ${current.getFullYear()}`;
  let first = new Date(current.getFullYear(), current.getMonth(), 1, 12);
  let start = new Date(first); start.setDate(first.getDate() - first.getDay());
  let html = `<div class='monthhead'>${days.map(d => `<div>${d}</div>`).join('')}</div><div class='monthgrid'>`;
  let fs = filtered();
  for (let i = 0; i < 42; i++) {
    let d = new Date(start); d.setDate(start.getDate() + i);
    let di = localIso(d);
    let mut = d.getMonth() !== current.getMonth() ? 'mutedday' : '';
    let es = fs.filter(e => e.startDate === di);
    html += `<div class='monthcell ${mut}'><div class='num'>${d.getDate()}</div>${es.map(evHTML).join('')}</div>`;
  }
  html += '</div>';
  document.getElementById('calendar').innerHTML = html;
}

window.toggleOtherTypeField = function() { document.getElementById('otherTypeField').classList.toggle('hidden', document.getElementById('type').value !== 'Otro'); };
window.toggleOtherAreaField = function() { document.getElementById('otherAreaField').classList.toggle('hidden', document.getElementById('area').value !== 'Otro'); };
window.toggleOtherRoomField = function() { document.getElementById('otherRoomField').classList.toggle('hidden', document.getElementById('room').value !== 'Otra'); };

window.toggleRepeatUntilField = function() {
  let r = document.getElementById('repeat').value;
  document.getElementById('repeatUntilField').classList.toggle('hidden', r === 'Sin repetición');
};

window.toggleModeFields = function() {
  const mode = document.getElementById('mode').value;
  const isVirtual = mode === 'Virtual';
  const isVirtualOrHybrid = (mode === 'Virtual' || mode === 'Híbrida');
  
  document.getElementById('roomContainer').classList.toggle('hidden', isVirtual);
  if(isVirtual) document.getElementById('otherRoomField').classList.add('hidden');

  document.querySelectorAll('.virtualField').forEach(el => el.classList.toggle('hidden', !isVirtualOrHybrid));
  document.getElementById('recordingField').classList.toggle('hidden', mode === 'Presencial');
};

function showToast(msg) {
  let t = document.getElementById('toast');
  if (t) {
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2400);
  }
}

window.toggleAdminAccess = function() {
  if (isAdmin) {
    signOut(auth).then(() => showToast('Sesión cerrada'));
    return;
  }
  document.getElementById('adminPassword').value = '';
  document.getElementById('loginModal').classList.add('open');
  setTimeout(() => document.getElementById('adminEmail').focus(), 100);
};

window.loginAdminReal = async function() {
  const email = document.getElementById('adminEmail').value.trim();
  const pass = document.getElementById('adminPassword').value;

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    document.getElementById('loginModal').classList.remove('open');
    showToast('Sesión iniciada correctamente');
  } catch (error) {
    showToast('Credenciales incorrectas o no autorizadas');
  }
};

window.openModal = function(index = null, isDuplicate = false) {
  if (!isAdmin) return;
  editingIndex = isDuplicate ? null : index;
  let e = index === null ? null : events[index];
  
  document.querySelector('#modal h2').textContent = isDuplicate ? 'Duplicar actividad' : (e ? 'Editar actividad' : 'Carga de Actividad');
  document.getElementById('saveActivityBtn').textContent = e && !isDuplicate ? 'Guardar cambios' : 'Guardar registro';
  
  document.getElementById('title').value = e ? (isDuplicate ? e.title + ' (Copia)' : e.title) : '';
  document.getElementById('type').value = e ? (['Curso','Defensa de Tesis','Seminario'].includes(e.type) ? e.type : 'Otro') : 'Curso';
  document.getElementById('otherType').value = e && !['Curso','Defensa de Tesis','Seminario'].includes(e.type) ? e.type : '';
  
  document.getElementById('area').value = e ? (areaColors[e.area] ? e.area : 'Otro') : 'Secretaría Académica';
  document.getElementById('otherArea').value = e && !areaColors[e.area] ? e.area : '';

  document.getElementById('startDate').value = e ? e.startDate : localIso(current);
  document.getElementById('endDate').value = e ? e.endDate : localIso(current);
  document.getElementById('startTime').value = e ? e.startTime : '10:00';
  document.getElementById('endTime').value = e ? e.endTime : '12:00';
  
  document.getElementById('repeat').value = e ? (e.repeat || 'Sin repetición') : 'Sin repetición';
  document.getElementById('repeatUntilDate').value = e ? (e.repeatUntilDate || '') : '';
  
  document.getElementById('mode').value = e ? e.mode : 'Presencial';
  document.getElementById('responsible').value = e ? (e.responsible || '') : '';
  
  document.getElementById('room').value = e ? (e.room === 'Aula de Posgrado' ? 'Aula de Posgrado' : 'Otra') : 'Aula de Posgrado';
  document.getElementById('otherRoom').value = e && e.room !== 'Aula de Posgrado' ? e.room : '';

  document.getElementById('platform').value = e ? (e.platform || 'Google Meet') : 'Google Meet';
  document.getElementById('link').value = e ? (e.link || '') : '';
  document.getElementById('linkPublic').value = e ? (e.linkPublic ? 'true' : 'false') : 'false';
  document.getElementById('account').value = e ? (e.account || '') : '';
  document.getElementById('infoLink').value = e ? (e.infoLink || '') : '';
  document.getElementById('notes').value = e ? (e.notes || '') : '';
  document.getElementById('needsRecording').value = e ? (e.needsRecording || 'No') : 'No';
  document.getElementById('status').value = e ? (e.status || 'Confirmado') : 'Confirmado';

  toggleOtherTypeField();
  toggleOtherAreaField();
  toggleOtherRoomField();
  toggleRepeatUntilField();
  toggleModeFields();

  document.getElementById('modal').classList.add('open');
};

window.closeModal = function() {
  document.getElementById('modal').classList.remove('open');
  editingIndex = null;
};

window.saveEvent = async function() {
  const title = document.getElementById('title').value.trim();
  const startDate = document.getElementById('startDate').value;
  const startTime = document.getElementById('startTime').value;

  if (!title || !startDate || !startTime) {
    showToast('Completá al menos título, fecha y hora de inicio');
    return;
  }

  const typeSelect = document.getElementById('type').value;
  const areaSelect = document.getElementById('area').value;
  const roomSelect = document.getElementById('room').value;
  const modeVal = document.getElementById('mode').value;

  const data = {
    title: title,
    type: typeSelect === 'Otro' ? document.getElementById('otherType').value.trim() : typeSelect,
    area: areaSelect === 'Otro' ? document.getElementById('otherArea').value.trim() : areaSelect,
    startDate: startDate,
    endDate: document.getElementById('endDate').value || startDate,
    startTime: startTime,
    endTime: document.getElementById('endTime').value,
    repeat: document.getElementById('repeat').value,
    repeatUntilDate: document.getElementById('repeatUntilDate').value,
    mode: modeVal,
    responsible: document.getElementById('responsible').value.trim(),
    room: modeVal === 'Virtual' ? '' : (roomSelect === 'Otra' ? document.getElementById('otherRoom').value.trim() : roomSelect),
    platform: document.getElementById('platform').value,
    link: document.getElementById('link').value.trim(),
    linkPublic: document.getElementById('linkPublic').value === 'true',
    account: document.getElementById('account').value.trim(),
    infoLink: document.getElementById('infoLink').value.trim(),
    notes: document.getElementById('notes').value.trim(),
    needsRecording: modeVal === 'Presencial' ? 'No' : document.getElementById('needsRecording').value,
    status: document.getElementById('status').value,
    mailSent: editingIndex !== null ? (events[editingIndex].mailSent || false) : false
  };

  try {
    if (editingIndex !== null && events[editingIndex]) {
      await updateDoc(doc(db, "events", events[editingIndex].id), data);
      showToast('Actividad actualizada');
    } else {
      await addDoc(eventsCollection, data);
      showToast('Actividad registrada');
    }
  } catch (e) {
    showToast('Error de permisos o conexión');
  }

  closeModal();
};

window.toggleMailAccordion = function() {
  const content = document.getElementById('mailContent');
  const arrow = document.getElementById('accordionArrow');
  if (content.classList.contains('open')) {
    content.classList.remove('open');
    arrow.textContent = '▼';
  } else {
    content.classList.add('open');
    arrow.textContent = '▲';
  }
};

window.switchMailTemplate = function(templateType) {
  currentMailTemplate = templateType;
  ['Confirm', 'Postpone', 'Cancel'].forEach(t => {
    let el = document.getElementById('tab' + t);
    if (el) el.classList.remove('active');
  });

  if (templateType === 'confirm') document.getElementById('tabConfirm').classList.add('active');
  if (templateType === 'postpone') document.getElementById('tabPostpone').classList.add('active');
  if (templateType === 'cancel') document.getElementById('tabCancel').classList.add('active');

  if (activeDetailIndex !== null) {
    fillMailForm(events[activeDetailIndex], templateType);
  }
};

function fillMailForm(e, templateType) {
  const respName = e.responsible ? e.responsible : '[Nombre del Responsable]';
  const dateFormatted = formatLongDate(e.startDate);
  const timeFormatted = e.endTime ? `${e.startTime} a ${e.endTime}` : e.startTime;
  const roomName = e.room || 'Aula de Posgrado';

  let subject = '';
  let body = '';

  if (templateType === 'confirm') {
    subject = `Confirmación de reserva: ${e.title}`;
    body = `Estimado/a ${respName}:

Queda confirmada la reserva del ${roomName} para la siguiente actividad:

• Actividad: ${e.title}
• Fecha: ${dateFormatted}
• Horario: ${timeFormatted} hs
• Modalidad: ${e.mode}
• Responsable: ${respName}

Cuidados y entrega del aula:
- Dejar el mobiliario ordenado en su disposición habitual.
- Apagar luces, equipos y dispositivos utilizados.
- Retirar materiales, residuos y objetos personales.
- Cerrar puertas y ventanas antes de retirarse.
- Colocar la alarma.
- Informar cualquier inconveniente o desperfecto ocurrido durante el uso.

Muchas gracias por colaborar con el cuidado del espacio.

Secretaría de Investigación, Internacionales y Posgrado
Facultad de Ciencias Agrarias – UNCUYO`;
  } else if (templateType === 'postpone') {
    subject = `Reprogramación de actividad: ${e.title}`;
    body = `Estimado/a ${respName}:

Registramos la postergación de la actividad "${e.title}", programada inicialmente para el ${dateFormatted}.

Hemos liberado el aula asignada para esa jornada. Le solicitamos que nos comunique la nueva fecha y horario en cuanto estén definidos, para poder reasignar el espacio en el calendario.

Quedamos atentos a su confirmación.

Atentamente,

Secretaría de Investigación, Internacionales y Posgrado
Facultad de Ciencias Agrarias – UNCUYO`;
  } else if (templateType === 'cancel') {
    subject = `Cancelación de reserva: ${e.title}`;
    body = `Estimado/a ${respName}:

Le informamos que se ha procesado la cancelación de la reserva del ${roomName} para la actividad "${e.title}", originalmente prevista para el ${dateFormatted} en el horario de ${timeFormatted} hs.

El espacio ha sido liberado en la agenda de Posgrado. Si en otro momento requiere coordinar una nueva fecha, quedamos a disposición para gestionarla.

Atentamente,

Secretaría de Investigación, Internacionales y Posgrado
Facultad de Ciencias Agrarias – UNCUYO`;
  }

  document.getElementById('editableSubject').value = subject;
  document.getElementById('editableBody').value = body;
}

window.copyMailContent = function() {
  const subject = document.getElementById('editableSubject').value.trim();
  const body = document.getElementById('editableBody').value.trim();
  const fullText = `Asunto: ${subject}\n\n${body}`;

  navigator.clipboard.writeText(fullText).then(() => {
    showToast('Mail copiado al portapapeles');
  }).catch(() => {
    showToast('Error al copiar el texto');
  });
};

window.toggleMailSentStatus = async function() {
  if (!isAdmin || activeDetailIndex === null) return;
  const e = events[activeDetailIndex];
  const updatedStatus = !e.mailSent;
  
  try {
    await updateDoc(doc(db, "events", e.id), { mailSent: updatedStatus });
    e.mailSent = updatedStatus;
    showDetail(activeDetailIndex);
    showToast(updatedStatus ? 'Marcado como enviado' : 'Marcado como no enviado');
  } catch (err) {
    showToast('Error al actualizar estado');
  }
};

window.showDetail = function(i) {
  activeDetailIndex = i;
  let e = events[i];
  let areaInfo = areaColors[e.area] || areaColors['Otro'];
  
  let panel = document.getElementById('detailPanel');
  if (panel) {
    panel.style.setProperty('--detail-color', areaInfo.border);
    panel.style.setProperty('--detail-bg', areaInfo.bg);
  }

  let dBadge = document.getElementById('dareaBadge');
  if (dBadge) dBadge.textContent = areaLabel(e);

  let dTitle = document.getElementById('dtitle');
  if (dTitle) dTitle.textContent = e.title;

  let dateFormatted = (e.startDate === e.endDate) 
    ? formatLongDate(e.startDate) 
    : `${formatLongDate(e.startDate)} al ${formatLongDate(e.endDate)}`;

  let roomFieldHTML = (e.mode !== 'Virtual') ? `<div class='detailLine'><b>Aula:</b><br>${e.room || '—'}</div>` : '';

  let linkFieldHTML = '';
  if (e.mode === 'Virtual' || e.mode === 'Híbrida') {
    if (e.linkPublic && e.link) {
      linkFieldHTML = `<div class='detailLine full'><b>Enlace:</b><br><a href='${e.link}' target='_blank' class='btn primary' style='margin-top:6px;padding:6px 14px;font-size:12px;'>Ingresar a la sala</a></div>`;
    } else {
      linkFieldHTML = `<div class='detailLine full'><b>Enlace:</b><br><span style='color:var(--muted);font-weight:700;'>Link privado</span></div>`;
    }
  }

  let infoLinkHTML = e.infoLink ? `<div class='detailLine full'><b>Más información:</b><br><a href='${e.infoLink}' target='_blank' style='color:${areaInfo.border};font-weight:700;'>${e.infoLink}</a></div>` : '';

  let inProgressBadgeHTML = isCurrentActivity(e) ? `<div style='margin-bottom:10px;'><span class='in-progress-tag'><span class='in-progress-dot'></span> Actividad en curso</span></div>` : '';

  let sentStatusBadge = (isAdmin && e.mailSent) ? `<div class="sentBadge"><span>✓</span> Confirmación enviada por mail</div>` : '';

  let adminButtons = isAdmin ? `
    <div class='adminActions' style='display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;'>
      <button class='btn primary' style='background:var(--accent);' onclick="document.getElementById('detail').classList.remove('open');openModal(${i})">Editar</button>
      <button class='btn ghost' onclick="document.getElementById('detail').classList.remove('open');openModal(${i}, true)">Duplicar</button>
      <button class='btn ghost' style='color:#a64b4b;' onclick='deleteEvent(${i})'>Eliminar</button>
    </div>
  ` : '';

  let dBody = document.getElementById('dbody');
  if (dBody) {
    dBody.innerHTML = `
      ${inProgressBadgeHTML}
      ${sentStatusBadge}
      <div class='detailGrid'>
        <div class='detailLine full'><b>Fecha:</b><br>${dateFormatted} (${e.startTime}${e.endTime ? ' - ' + e.endTime : ''})</div>
        <div class='detailLine'><b>Tipo:</b><br>${e.type}</div>
        <div class='detailLine'><b>Modalidad:</b><br>${e.mode}</div>
        ${roomFieldHTML}
        <div class='detailLine'><b>Responsable:</b><br>${e.responsible || '—'}</div>
        <div class='detailLine'><b>Estado:</b><br><span class='statusPill status-${e.status}'>${e.status}</span></div>
        ${linkFieldHTML}
        ${infoLinkHTML}
      </div>
      ${adminButtons}
    `;
  }

  const mailAccordion = document.getElementById('mailAccordion');
  if (mailAccordion) {
    if (isAdmin) {
      mailAccordion.style.display = 'block';
      switchMailTemplate('confirm');
      document.getElementById('mailContent').classList.remove('open');
      document.getElementById('accordionArrow').textContent = '▼';
    } else {
      mailAccordion.style.display = 'none';
    }
  }

  const adminMailStatusContainer = document.getElementById('adminMailStatusBtn');
  if (isAdmin) {
    if (e.mailSent) {
      adminMailStatusContainer.innerHTML = `<button class="btn ghost" style="font-size:12px; padding:8px 14px; color:#2d4514; border-color:#8ba963; background:#e2ebd8;" onclick="toggleMailSentStatus()">✓ Confirmación enviada (desmarcar)</button>`;
    } else {
      adminMailStatusContainer.innerHTML = `<button class="btn ghost" style="font-size:12px; padding:8px 14px;" onclick="toggleMailSentStatus()">☑ Marcar como enviado</button>`;
    }
  } else {
    adminMailStatusContainer.innerHTML = '';
  }

  let detailModal = document.getElementById('detail');
  if (detailModal) detailModal.classList.add('open');
};

window.deleteEvent = async function(i) {
  if (!isAdmin) return;
  if (confirm('¿Eliminar esta actividad?')) {
    const e = events[i];
    try {
      await deleteDoc(doc(db, "events", e.id));
      showToast('Actividad eliminada');
      let detailModal = document.getElementById('detail');
      if (detailModal) detailModal.classList.remove('open');
    } catch (err) {
      showToast('Error al eliminar registro');
    }
  }
};

// Listener de Autenticación
onAuthStateChanged(auth, (user) => {
  if (user) {
    isAdmin = true;
    document.body.classList.add('admin-mode');
    document.getElementById('adminBtn').textContent = 'Cerrar Sesión';
    document.getElementById('publicHint').textContent = `Modo administrador (${user.email})`;
  } else {
    isAdmin = false;
    document.body.classList.remove('admin-mode');
    document.getElementById('adminBtn').textContent = 'Administrar';
    document.getElementById('publicHint').textContent = 'Consulta pública · Actividades confirmadas.';
  }
  render();
});

// Listener de Firestore en Tiempo Real
onSnapshot(eventsCollection, (snapshot) => {
  events = snapshot.docs.map(docSnapshot => ({
    id: docSnapshot.id,
    ...docSnapshot.data()
  }));
  render();
});