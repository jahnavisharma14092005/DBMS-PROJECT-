import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

const emptyQueue = { items: [], notifications: [] };

function localInputValue(date = new Date()) {
  const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return copy.toISOString().slice(0, 16);
}

function nextSlotInputValue(date = new Date(), leadMinutes = 0) {
  const copy = new Date(date.getTime() + leadMinutes * 60000);
  copy.setSeconds(0, 0);
  const minuteRemainder = copy.getMinutes() % 15;
  if (minuteRemainder) copy.setMinutes(copy.getMinutes() + 15 - minuteRemainder);
  return localInputValue(copy);
}

function formatTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function statusLabel(status) {
  return status.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function Metric({ label, value }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value ?? 0}</strong>
    </article>
  );
}

function Toast({ toast }) {
  return (
    <div id="toast" className={toast.message ? "show" : ""} style={{ background: toast.error ? "#b8322a" : "#182026" }}>
      {toast.message}
    </div>
  );
}

function ActionButtons({ item, onAction, onReschedule }) {
  const id = item.appointment_id;
  if (item.status === "COMPLETED") {
    return <span className="subtle">Closed</span>;
  }
  if (["CANCELLED", "NO_SHOW"].includes(item.status)) {
    return <button onClick={() => onReschedule(item)}>Reschedule</button>;
  }

  return (
    <>
      {item.status === "BOOKED" && <button onClick={() => onAction("checkin", id)}>Check in</button>}
      {["BOOKED", "CHECKED_IN"].includes(item.status) && <button onClick={() => onAction("start", id)}>Start</button>}
      {item.status === "IN_CONSULTATION" && <button onClick={() => onAction("finish", id)}>Finish</button>}
      {item.status !== "IN_CONSULTATION" && <button onClick={() => onReschedule(item)}>Move</button>}
      {item.status !== "IN_CONSULTATION" && <button onClick={() => onAction("cancel", id)}>Cancel</button>}
    </>
  );
}

export function App() {
  const [activeTab, setActiveTab] = useState("book");
  const [doctors, setDoctors] = useState([]);
  const [patients, setPatients] = useState([]);
  const [queue, setQueue] = useState(emptyQueue);
  const [reports, setReports] = useState({ stats: {} });
  const [doctorFilter, setDoctorFilter] = useState("");
  const [clock, setClock] = useState(new Date());
  const [toast, setToast] = useState({ message: "", error: false });
  const [reschedule, setReschedule] = useState(null);
  const [defaults, setDefaults] = useState(() => ({
    scheduled_time: nextSlotInputValue(new Date(), 30),
    break_start_time: localInputValue(new Date()),
    break_duration: 20,
  }));

  const doctorOptions = useMemo(
    () => doctors.map((doctor) => ({ value: doctor.doctor_id, label: `${doctor.name} - ${doctor.specialization}` })),
    [doctors],
  );

  const visibleQueue = useMemo(() => {
    if (!doctorFilter) return queue.items;
    return queue.items.filter((item) => String(item.doctor_id) === String(doctorFilter));
  }, [doctorFilter, queue.items]);

  function showToast(message, error = false) {
    setToast({ message, error });
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => setToast({ message: "", error: false }), error ? 4200 : 3400);
  }

  async function load() {
    const data = await api("/api/bootstrap");
    setDoctors(data.doctors);
    setPatients(data.patients);
    setQueue(data.queue);
    setReports(data.reports);
  }

  function resetDefaultTimes() {
    setDefaults({
      scheduled_time: nextSlotInputValue(new Date(), 30),
      break_start_time: localInputValue(new Date()),
      break_duration: 20,
    });
  }

  async function submitForm(event, endpoint, success) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      const result = await api(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      form.reset();
      resetDefaultTimes();
      await load();
      showToast(success(result));
    } catch (error) {
      showToast(error.message, true);
    }
  }

  async function refreshDashboard() {
    try {
      await load();
      showToast("Dashboard refreshed.");
    } catch (error) {
      showToast(error.message, true);
    }
  }

  async function queueAction(action, appointmentId) {
    const endpoints = {
      checkin: "/api/checkin",
      start: "/api/consultations/start",
      finish: "/api/consultations/finish",
      cancel: "/api/appointments/cancel",
    };

    try {
      await api(endpoints[action], {
        method: "POST",
        body: JSON.stringify({ appointment_id: appointmentId }),
      });
      await load();
      showToast("Workflow updated and queue recalculated.");
    } catch (error) {
      showToast(error.message, true);
    }
  }

  async function submitReschedule(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      const result = await api("/api/appointments/reschedule", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setReschedule(null);
      await load();
      showToast(result.adjusted ? `Requested slot was busy. Appointment moved to ${formatTime(result.scheduled_time)}.` : "Appointment rescheduled and slot constraints rechecked.");
    } catch (error) {
      showToast(error.message, true);
    }
  }

  useEffect(() => {
    load().catch((error) => showToast(error.message, true));
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const stats = reports.stats || {};

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">DBMS Project</p>
          <h1>Smart Appointment & Dynamic Scheduling System</h1>
        </div>
        <div className="top-actions">
          <select value={doctorFilter} onChange={(event) => setDoctorFilter(event.target.value)} aria-label="Filter queue by doctor">
            <option value="">All doctors</option>
            {doctorOptions.map((doctor) => (
              <option key={doctor.value} value={doctor.value}>
                {doctor.label}
              </option>
            ))}
          </select>
          <button className="icon-button" title="Refresh dashboard" onClick={refreshDashboard}>
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      <main>
        <section className="metrics">
          <Metric label="Total" value={stats.total} />
          <Metric label="Booked" value={stats.booked} />
          <Metric label="Checked in" value={stats.checked_in} />
          <Metric label="In consult" value={stats.in_consultation} />
          <Metric label="Completed" value={stats.completed} />
          <Metric label="No-show" value={stats.no_show} />
        </section>

        <section className="workspace">
          <aside className="panel">
            <div className="tabs" role="tablist">
              {["book", "patient", "delay"].map((tab) => (
                <button key={tab} className={`tab ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
                  {tab[0].toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {activeTab === "book" && (
              <form className="tab-panel active" onSubmit={(event) => submitForm(event, "/api/appointments", (result) => (
                result.adjusted
                  ? `Requested slot was busy. Appointment #${result.appointment_id} created at ${formatTime(result.scheduled_time)}.`
                  : `Appointment #${result.appointment_id} created and queued.`
              ))}>
                <h2>Appointment Booking</h2>
                <label>
                  Patient
                  <select name="patient_id" required>
                    {patients.map((patient) => (
                      <option key={patient.patient_id} value={patient.patient_id}>
                        {patient.name} - {patient.phone}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Doctor
                  <select name="doctor_id" required>
                    {doctorOptions.map((doctor) => (
                      <option key={doctor.value} value={doctor.value}>
                        {doctor.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Scheduled time
                  <input key={defaults.scheduled_time} name="scheduled_time" type="datetime-local" defaultValue={defaults.scheduled_time} required />
                </label>
                <label>
                  Type
                  <select name="appointment_type" defaultValue="SCHEDULED">
                    <option value="SCHEDULED">Scheduled</option>
                    <option value="WALK_IN">Walk-in</option>
                    <option value="EMERGENCY">Emergency</option>
                  </select>
                </label>
                <label>
                  Notes
                  <textarea name="notes" rows="2" placeholder="Symptoms, case priority, or reception notes" />
                </label>
                <button className="primary" type="submit">Create appointment</button>
              </form>
            )}

            {activeTab === "patient" && (
              <form className="tab-panel active" onSubmit={(event) => submitForm(event, "/api/patients", (result) => `Patient #${result.patient_id} registered.`)}>
                <h2>Patient Registration</h2>
                <label>
                  Full name
                  <input name="name" autoComplete="name" required />
                </label>
                <label>
                  Phone
                  <input name="phone" autoComplete="tel" required />
                </label>
                <label>
                  Email
                  <input name="email" autoComplete="email" type="email" />
                </label>
                <button className="primary" type="submit">Register patient</button>
              </form>
            )}

            {activeTab === "delay" && (
              <form className="tab-panel active" onSubmit={(event) => submitForm(event, "/api/availability", () => "Doctor availability saved and affected ETAs updated.")}>
                <h2>Doctor Unavailability</h2>
                <label>
                  Doctor
                  <select name="doctor_id" required>
                    {doctorOptions.map((doctor) => (
                      <option key={doctor.value} value={doctor.value}>
                        {doctor.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Start time
                  <input key={defaults.break_start_time} name="break_start_time" type="datetime-local" defaultValue={defaults.break_start_time} required />
                </label>
                <label>
                  Duration
                  <input name="break_duration" type="number" min="5" max="240" defaultValue={defaults.break_duration} required />
                </label>
                <label>
                  Reason
                  <input name="reason" placeholder="Emergency case, break, surgery delay" />
                </label>
                <button className="primary" type="submit">Recalculate queue</button>
              </form>
            )}
          </aside>

          <section className="queue-area">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Live Operations</p>
                <h2>Queue Monitor</h2>
              </div>
              <div className="clock">
                {new Intl.DateTimeFormat(undefined, {
                  weekday: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                }).format(clock)}
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Pos</th>
                    <th>Patient</th>
                    <th>Doctor</th>
                    <th>Scheduled</th>
                    <th>ETA</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleQueue.length === 0 ? (
                    <tr><td colSpan="7">No appointments found.</td></tr>
                  ) : visibleQueue.map((item) => (
                    <tr key={item.appointment_id}>
                      <td><strong>{item.queue_position || "-"}</strong></td>
                      <td>
                        <div className="patient">
                          <strong>{item.patient_name}</strong>
                          <small>{item.phone} - {item.appointment_type.replace("_", " ")}</small>
                        </div>
                      </td>
                      <td>{item.doctor_name}<br /><span className="subtle">{item.specialization}</span></td>
                      <td>{formatTime(item.scheduled_time)}</td>
                      <td>{formatTime(item.estimated_time)}</td>
                      <td><span className={`status ${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span></td>
                      <td>
                        <div className="row-actions">
                          <ActionButtons item={item} onAction={queueAction} onReschedule={(row) => setReschedule(row)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <section className="lower-grid">
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Database Views</p>
                <h2>Doctor Performance</h2>
              </div>
            </div>
            <div className="performance-list">
              {(reports.performance || []).map((doctor) => (
                <article className="list-item" key={doctor.doctor_id}>
                  <div className="split">
                    <strong>{doctor.name}</strong>
                    <span className="status">{doctor.actual_avg_duration || "-"} min avg</span>
                  </div>
                  <span className="subtle">{doctor.specialization}</span>
                  <span>{doctor.completed_appointments || 0} completed of {doctor.total_appointments || 0} appointments</span>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Automation</p>
                <h2>Notifications</h2>
              </div>
            </div>
            <div className="notification-list">
              {queue.notifications.length === 0 ? <p className="subtle">No notifications yet.</p> : queue.notifications.map((note) => (
                <article className="list-item" key={note.notification_id}>
                  <strong>{note.patient_name}</strong>
                  <span>{note.message}</span>
                  <small className="subtle">{formatTime(note.created_at)}</small>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Analytics</p>
                <h2>Above-average Waits</h2>
              </div>
            </div>
            <div className="wait-list">
              {(reports.aboveAverageWait || []).length === 0 ? <p className="subtle">No above-average delays currently.</p> : reports.aboveAverageWait.map((row) => (
                <article className="list-item" key={`${row.patient_name}-${row.doctor_name}-${row.estimated_time}`}>
                  <strong>{row.patient_name}</strong>
                  <span>{row.doctor_name}</span>
                  <span className="subtle">{row.delay_minutes} minutes beyond slot</span>
                </article>
              ))}
            </div>
          </section>
        </section>
      </main>

      {reschedule && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal" onSubmit={submitReschedule}>
            <h2>Reschedule Appointment</h2>
            <input type="hidden" name="appointment_id" value={reschedule.appointment_id} />
            <label>
              New time
              <input name="scheduled_time" type="datetime-local" defaultValue={nextSlotInputValue(new Date(), 15)} required />
            </label>
            <div className="dialog-actions">
              <button type="button" onClick={() => setReschedule(null)}>Cancel</button>
              <button className="primary" type="submit">Save</button>
            </div>
          </form>
        </div>
      )}

      <Toast toast={toast} />
    </>
  );
}
