require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const multer = require("multer");
const admin = require("firebase-admin");
const cloudinary = require("cloudinary").v2;
const Request201 = require("./models/Request201");
const { requireAuth, requireRole } = require("./middleware/auth");
const { mailer } = require("./utils/mailer");

// Firebase (accounts)
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
  })
});

// Cloudinary (requirement files)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// MongoDB (201 requests)
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((e) => { console.error(e); process.exit(1); });

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Email attachment (contract): one PDF, up to 10 MB
const MAIL_FILE_OK = /\.pdf$/i;
const mailUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (MAIL_FILE_OK.test(file.originalname) && file.mimetype === "application/pdf") return cb(null, true);
    const err = new Error(`${file.originalname}: only a PDF file can be attached.`);
    err.status = 400;
    cb(err);
  }
});

/* ---------- CORS ---------- */
// CLIENT_ORIGIN can hold one or many origins separated by commas.
// Trailing slashes are stripped because the browser's Origin header never has one.
const allowedOrigins = (process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

console.log("Allowed origins:", allowedOrigins);

app.use(cors({
  origin: (origin, cb) => {
    // allow requests with no Origin (curl, Postman, server-to-server) and listed origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    console.warn("Blocked by CORS:", origin);
    cb(null, false);
  },
  allowedHeaders: ["Content-Type", "Authorization"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
}));
app.use(express.json());

/* ---------- Allowed fields and file names ---------- */
const FIELDS = [
  "fullName", "email", "position", "department", "contactNumber", "address", "remarks",
  "company", "supervisorName", "supervisorEmail", "supervisorMobile",
  "lastName", "firstName", "middleName", "suffix", "nickname", "dob", "pob", "sex", "civilStatus",
  "nationality", "residence", "empEmail", "mobile",
  "fatherName", "motherName", "spouse", "dependents",
  "dateHired", "empStatus", "client", "deptCode",
    "workArea", "region", "province", "city", "cityMunicipality",
  "sss", "philhealth", "pagibig", "tin",
  "ecName", "ecRelationship", "ecMobile", "ecAddress",
  "education", "school", "course", "yearGrad", "prevWork", "prevDetails"
];
const FILE_NAMES = ["Resume", "2x2 ID Photo", "E-Signature", "PSA Birth Certificate", "SSS", "PhilHealth", "Pag-IBIG", "TIN"];
const REQUIRED = FILE_NAMES.filter((n) => n !== "Resume");   // must all be attached before approval
const validFileName = (n) =>
  typeof n === "string" && (FILE_NAMES.includes(n) || (n.startsWith("Additional: ") && n.length <= 80));

const pick = (body) => {
  const data = {};
  for (const k of FIELDS) {
    const v = body[k];
    if (v === undefined || v === null) continue;
    const s = typeof v === "string" ? v.trim() : v;
    if (s !== "") data[k] = s;
  }
  return data;
};

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Staff: submit a 201 request form
app.post("/api/requests", requireAuth, requireRole("staff"), async (req, res) => {
  try {
    const data = pick(req.body);
    if (data.mobile && !/^09\d{9}$/.test(data.mobile)) return res.status(400).json({ error: "Mobile number must be 11 digits (09XXXXXXXXX)." });
    if (data.supervisorMobile && !/^09\d{9}$/.test(data.supervisorMobile)) return res.status(400).json({ error: "Supervisor mobile number must be 11 digits (09XXXXXXXXX)." });
    if (data.ecMobile && !/^09\d{9}$/.test(data.ecMobile)) return res.status(400).json({ error: "Emergency contact number must be 11 digits." });
    const doc = await Request201.create({ ...data, submittedBy: req.user.uid, status: "pending" });
    res.status(201).json(doc);
  } catch (e) {
    res.status(e.name === "ValidationError" ? 400 : 500).json({ error: e.message });
  }
});

// Staff: upload (or replace) one requirement file (form-data: file, name)
app.post("/api/requests/:id/requirements", requireAuth, requireRole("staff"), upload.single("file"), async (req, res) => {
  try {
    const doc = await Request201.findOne({ _id: req.params.id, submittedBy: req.user.uid });
    if (!doc) return res.status(404).json({ error: "Request not found" });
    if (!req.file) return res.status(400).json({ error: "No file" });
    const name = req.body.name;
    if (!validFileName(name)) return res.status(400).json({ error: "Invalid document name." });

    // E-signature: any image format is accepted, then shrunk to fit 600x200 (never enlarged)
    const uploadOpts = { folder: `hris/${doc._id}`, resource_type: "auto" };
    if (name === "E-Signature" && req.file.mimetype.startsWith("image/")) {
      uploadOpts.transformation = [{ width: 600, height: 200, crop: "limit" }];
    }

    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        uploadOpts,
        (err, r) => (err ? reject(err) : resolve(r))
      ).end(req.file.buffer);
    });

    const existing = doc.requirements.find((f) => f.name === name);
    if (existing) {
      // replace: remove the old file from Cloudinary, keep the original uploadedAt
      const old = { publicId: existing.publicId, type: existing.url && existing.url.includes("/raw/") ? "raw" : "image" };
      existing.url = result.secure_url;
      existing.publicId = result.public_id;
      existing.updatedAt = new Date();
      if (old.publicId) cloudinary.uploader.destroy(old.publicId, { resource_type: old.type }).catch(() => {});
    } else {
      doc.requirements.push({ name, url: result.secure_url, publicId: result.public_id, uploadedAt: new Date() });
    }
    await doc.save();
    res.json(doc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Staff: edit the note on their own request (form-data: remarks)
app.patch("/api/requests/:id/remarks", requireAuth, requireRole("staff"), upload.none(), async (req, res) => {
  try {
    const remarks = String(req.body.remarks ?? "").trim().slice(0, 300);
    const doc = await Request201.findOneAndUpdate(
      { _id: req.params.id, submittedBy: req.user.uid },
      { remarks },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: "Request not found" });
    res.json(doc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Staff sees own requests, manager sees all
app.get("/api/requests", requireAuth, async (req, res) => {
  try {
    const filter = req.user.role === "manager" ? {} : { submittedBy: req.user.uid };
    res.json(await Request201.find(filter).sort({ createdAt: -1 }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manager: approve or reject (form-data: status, approvalNote)
app.patch("/api/requests/:id/status", requireAuth, requireRole("manager"), upload.none(), async (req, res) => {
  try {
    const { status } = req.body;
    if (!["approved", "rejected", "pending"].includes(status)) return res.status(400).json({ error: "Invalid status" });
    const doc = await Request201.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Request not found" });
    if (status === "approved") {
      const missing = REQUIRED.filter((n) => !doc.requirements.some((f) => f.name === n));
      if (missing.length) return res.status(400).json({ error: "Missing documents: " + missing.join(", ") });
    }
    doc.status = status;
    const note = String(req.body.approvalNote ?? "").trim().slice(0, 300);
    if (note) doc.approvalNote = note;   // saved only if approvalNote exists in the model schema
    await doc.save();
    res.json(doc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manager: mark who checked (opened) a 201 submission. First checker wins. (JSON body: checkedBy)
app.patch("/api/requests/:id/checked", requireAuth, requireRole("manager"), async (req, res) => {
  try {
    const name = String(req.body?.checkedBy || req.user?.name || req.user?.email || "")
      .trim()
      .slice(0, 100);
    if (!name) return res.status(400).json({ error: "Missing checker name" });

    // Only update if nobody has checked yet (atomic, so two admins can't both win)
    const updated = await Request201.findOneAndUpdate(
      {
        _id: req.params.id,
        $or: [{ checkedBy: { $exists: false } }, { checkedBy: "" }, { checkedBy: null }]
      },
      { $set: { checkedBy: name, checkedAt: new Date() } },
      { new: true }
    );
    if (updated) return res.json({ checkedBy: updated.checkedBy, checkedAt: updated.checkedAt });

    // Already checked by someone: return theirs so the front-end shows the warning
    const cur = await Request201.findById(req.params.id);
    if (!cur) return res.status(404).json({ error: "Request not found" });
    res.json({ checkedBy: cur.checkedBy, checkedAt: cur.checkedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manager: email one coordinator / recruiter about one or more employees,
// with optional attachments (contract).
// form-data: ids (JSON array of request ids that share ONE coordinator email), subject, message, attachments (files)
// The recipient is read from the saved records, never from the browser.
app.post("/api/requests/email", requireAuth, requireRole("manager"), mailUpload.array("attachments", 1), async (req, res) => {
  try {
    let ids;
    try { ids = JSON.parse(req.body.ids || "[]"); } catch { ids = []; }
    if (!Array.isArray(ids) || !ids.length || ids.length > 100) return res.status(400).json({ error: "No records selected." });
    if (!ids.every((id) => mongoose.isValidObjectId(id))) return res.status(400).json({ error: "Invalid record id." });

    const subject = String(req.body.subject ?? "").trim().slice(0, 150);
    const message = String(req.body.message ?? "").trim().slice(0, 3000);
    if (!subject || !message) return res.status(400).json({ error: "Subject and message are required." });

    const recs = await Request201.find({ _id: { $in: ids } });
    if (recs.length !== new Set(ids.map(String)).size) return res.status(404).json({ error: "Some records were not found." });

    const emails = new Set(recs.map((r) => (r.supervisorEmail || "").trim().toLowerCase()));
    if (emails.size !== 1 || emails.has("")) return res.status(400).json({ error: "Selected records must share one coordinator email." });

    await mailer.sendMail({
      from: process.env.MAIL_FROM,                                   // e.g. "Regcris-HR <hr@gmail.com>"
      to: recs[0].supervisorEmail.trim(),
      replyTo: process.env.MAIL_REPLY_TO || process.env.SMTP_USER,   // the HR account
      subject,
      text: message,
      attachments: (req.files || []).map((f) => ({
        filename: f.originalname,
        content: f.buffer,
        contentType: f.mimetype
      }))
    });
    res.json({ ok: true });
  } catch (e) {
    console.error("Email failed:", e.message);
    res.status(502).json({ error: "Could not send the email. Check the SMTP settings." });
  }
});

/* ---------- GM analytics (201 submissions) ---------- */
// GM analytics for 201 submissions.

const F = {
  company:     'company',
  client:      'client',
  region:      'region',
  province:    'province',
  city:        'cityMunicipality',   // falls back to `city` if empty
  position:    'position',
  gender:      'sex',
  birthdate:   'dob',
  startDate:   'dateHired',
  submittedAt: 'createdAt'
};

const LATE_HOURS = 72;
const AGE_BANDS = [[18,24,'18-24'],[25,34,'25-34'],[35,44,'35-44'],[45,54,'45-54'],[55,200,'55+']];

const val = (d, k) => {
  let v = d[F[k]];
  if ((v === undefined || v === null || v === '') && k === 'city') v = d.city;
  return v === undefined || v === null || v === '' ? 'Unspecified' : String(v).trim();
};
const toDate = v => { const d = new Date(v); return isNaN(d) ? null : d; };

function ageOf(d) {
  const b = toDate(d[F.birthdate]);
  if (b) {
    const ref = toDate(d[F.startDate]) || new Date();
    let a = ref.getFullYear() - b.getFullYear();
    const m = ref.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && ref.getDate() < b.getDate())) a--;
    return a;
  }
  return null;
}
const bandOf = a => (a == null ? 'Unspecified' : (AGE_BANDS.find(([lo, hi]) => a >= lo && a <= hi) || [0,0,'Unspecified'])[2]);

const tally = (arr, fn) => {
  const m = {};
  arr.forEach(x => { const k = fn(x); m[k] = (m[k] || 0) + 1; });
  return Object.entries(m).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
};
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// GET /api/analytics/201?year=2026&month=11&company=Prestige
app.get('/api/analytics/201', requireAuth, requireRole('manager'), async (req, res) => {
  try {
    const { year, month, company } = req.query;
    const q = {};
    if (company && company !== 'all') q[F.company] = company;

    let docs = await Request201.find(q).lean();

    // attach submitted date + filter by year/month (by submission date)
    docs = docs.map(d => ({ d, sub: toDate(d[F.submittedAt]), start: toDate(d[F.startDate]) }))
      .filter(x => x.sub)
      .filter(x => !year || x.sub.getFullYear() === Number(year))
      .filter(x => !month || x.sub.getMonth() + 1 === Number(month));

    const rows = docs.map(({ d, sub, start }) => {
      const lagHrs = start ? (sub - start) / 36e5 : null;
      return { d, sub, start, lagHrs, late: lagHrs !== null && lagHrs > LATE_HOURS };
    });

    const measurable = rows.filter(r => r.lagHrs !== null);
    const late = measurable.filter(r => r.late).length;
    const onTime = measurable.length - late;

    const perMonth = tally(rows, r => `${r.sub.getFullYear()}-${pad(r.sub.getMonth() + 1)}`)
      .sort((a, b) => a.label.localeCompare(b.label));
    const perYear = tally(rows, r => String(r.sub.getFullYear())).sort((a, b) => a.label.localeCompare(b.label));
    const perPayroll = tally(rows, r =>
      `${r.sub.getFullYear()}-${pad(r.sub.getMonth() + 1)} ${r.sub.getDate() <= 15 ? '1st (1-15)' : '2nd (16-end)'}`)
      .sort((a, b) => a.label.localeCompare(b.label));

    // calendar: per submission day -> on-time / late counts
    const cal = {};
    measurable.forEach(r => {
      const k = ymd(r.sub);
      cal[k] = cal[k] || { date: k, onTime: 0, late: 0 };
      r.late ? cal[k].late++ : cal[k].onTime++;
    });

    const lateList = measurable.filter(r => r.late)
      .sort((a, b) => b.lagHrs - a.lagHrs).slice(0, 15)
      .map(r => ({
        company: val(r.d, 'company'), client: val(r.d, 'client'), position: val(r.d, 'position'),
        start: ymd(r.start), submitted: ymd(r.sub), hoursLate: Math.round(r.lagHrs - LATE_HOURS)
      }));

    res.json({
      kpi: {
        total: rows.length,
        onTime, late,
        onTimeRate: measurable.length ? Math.round((onTime / measurable.length) * 1000) / 10 : 0,
        avgLagHours: measurable.length ? Math.round(measurable.reduce((s, r) => s + r.lagHrs, 0) / measurable.length) : 0,
        lateHours: LATE_HOURS
      },
      perMonth, perYear, perPayroll,
      perCompany:  tally(rows, r => val(r.d, 'company')),
      perClient:   tally(rows, r => val(r.d, 'client')).slice(0, 10),
      perRegion:   tally(rows, r => val(r.d, 'region')),
      perProvince: tally(rows, r => val(r.d, 'province')).slice(0, 10),
      perCity:     tally(rows, r => val(r.d, 'city')).slice(0, 10),
      perPosition: tally(rows, r => val(r.d, 'position')).slice(0, 10),
      perGender:   tally(rows, r => val(r.d, 'gender')),
      perAge:      tally(rows, r => bandOf(ageOf(r.d))),
      calendar: Object.values(cal),
      lateList
    });
  } catch (err) {
    console.error('analytics/201', err);
    res.status(500).json({ error: 'Failed to build analytics' });
  }
});

// Error handler (keep this after all routes): clear messages for big files and bad requests
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? "File is over 10 MB."
      : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE" ? "You can attach only one PDF."
      : err.message;
    return res.status(400).json({ error: msg });
  }
  res.status(err.status || 500).json({ error: err.message });
});

app.listen(process.env.PORT || 5000, () => console.log("HRIS API running"));