import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const db = initializeFirestore(app, { experimentalForceLongPolling: true });

const setName = (name) => {
  document.getElementById("userName").textContent = name;
  document.getElementById("welcomeName").textContent = name;
};

// Saan babalik ang user kapag hindi naka-login o mali ang role
const LOGIN = { manager: "/hr/login", staff: "/" };

// Keeps a page for one role only. Not logged in or wrong role -> back to that role's login page.
// onReady(user, name) runs once the role is confirmed.
export function guard(role, onReady) {
  const loginUrl = LOGIN[role] || "/";

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await signOut(auth);
    location.href = loginUrl;
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user) { location.href = loginUrl; return; }
    setName(user.displayName || user.email);
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists() || snap.data().role !== role) {
        await signOut(auth);
        location.href = loginUrl;
        return;
      }
      const name = snap.data().fullName || user.displayName || user.email;
      setName(name);
      if (onReady) onReady(user, name);
    } catch (err) {
      console.error("Role check failed:", err);
      document.getElementById("userName").textContent = user.email;
    }
  });
}