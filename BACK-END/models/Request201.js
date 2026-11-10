const mongoose = require("mongoose");

const requirementSchema = new mongoose.Schema({
  name: String,        // "2x2 ID Photo", "SSS", "Additional: Passport", "Resume", ...
  url: String,         // Cloudinary URL
  publicId: String,
  uploadedAt: { type: Date, default: Date.now },  // front-end reads this
  updatedAt: Date,                                // set it when a file is replaced
  supervisorName: String,
  supervisorEmail: String
});

const request201Schema = new mongoose.Schema({
  // --- existing fields (the front-end still sends these) ---
  fullName: { type: String, required: true },
  email: { type: String, required: true },
  position: { type: String, required: true },
  department: String,
  contactNumber: String,
  address: String,
  resumeSummary: String,
  remarks: String,
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  requirements: [requirementSchema],
  submittedBy: { type: String, required: true }, // Firebase uid

  // --- manager review ---
  approvalNote: String,                              // note typed in the Approve pop-up
  checkedBy: { type: String, default: "" },          // name of the admin who first clicked View
  checkedAt: { type: Date, default: null },          // when they checked it

  // --- 1. Supervisor ---
  company: { type: String, enum: ["Prestige", "Regcris", "Tmarks", "CoMerch", ""] },
  supervisorName: String,
  supervisorEmail: String,
  supervisorMobile: String,                          // NEW

  // --- 2. Personal ---
  lastName: String,
  firstName: String,
  middleName: String,
  suffix: String,
  nickname: String,
  dob: Date,
  pob: String,
  sex: { type: String, enum: ["Male", "Female", ""] },
  civilStatus: { type: String, enum: ["Single", "Married", "Widowed", "Separated", "Annulled", ""] },
  nationality: String,
  residence: String,
  empEmail: String,
  mobile: String,

  // --- 3. Family ---
  fatherName: String,
  motherName: String,
  spouse: String,
  dependents: { type: Number, min: 0 },

  // --- 4. Employment ---
  dateHired: Date,
  empStatus: { type: String, enum: ["Probationary", "Regular", "Project Based", "Casual", "Temporary", ""] },
  client: String,
  deptCode: String,

  // --- 4b. Work assignment (NEW) ---
  workArea: { type: String, enum: ["Luzon", "Visayas", "Mindanao", ""] },
  region: String,
  province: String,                                  // "N/A" for NCR (no province)
  cityMunicipality: String,

  // --- 5. Government numbers ---
  sss: String,
  philhealth: String,
  pagibig: String,
  tin: String,

  // --- 6. Emergency contact ---
  ecName: String,
  ecRelationship: String,
  ecMobile: String,
  ecAddress: String,

  // --- 7. Education / previous work ---
  education: String,
  school: String,
  course: String,
  yearGrad: String,
  prevWork: { type: String, enum: ["Yes", "No", ""] },
  prevDetails: String
}, { timestamps: true });

module.exports = mongoose.model("Request201", request201Schema);