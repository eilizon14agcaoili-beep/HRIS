const admin = require("firebase-admin");

// Verifies the Firebase ID token and loads the role from Firestore users/{uid}
async function requireAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Missing token" });
    const decoded = await admin.auth().verifyIdToken(token);
    const snap = await admin.firestore().doc(`users/${decoded.uid}`).get();
    req.user = { uid: decoded.uid, role: snap.exists ? snap.data().role : null };
    next();
  } catch (err) {
    console.error("Auth error:", err.code || err.message);
    res.status(401).json({ error: "Auth failed: " + (err.code || err.message) });
  }
}

const requireRole = (role) => (req, res, next) =>
  req.user.role === role ? next() : res.status(403).json({ error: `${role} only` });

module.exports = { requireAuth, requireRole };