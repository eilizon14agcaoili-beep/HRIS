import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, sendEmailVerification, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, doc, setDoc, getDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = (id) => document.getElementById(id);
const form = $("authForm"), msg = $("msg");
const say = (text, type = "") => { msg.textContent = text; msg.className = "msg " + type; };

// ---------- UI: role + mode tabs ----------
const COPY = {
  staff:   { title: "Your 201 file, in one place.", text: "Submit requests and upload your requirements.", name: "HR staff" },
  manager: { title: "Review every 201 request.", text: "Approve requests and check each person's requirements.", name: "HR manager" }
};
const SUB = {
  staff:   { login: "Log in to submit and track your 201 file.", register: "Create your HR staff account." },
  manager: { login: "Log in to review and approve requests.", register: "Create your HR manager account." }
};

// Where each role goes after logging in (exact file paths, so no hash routing is involved)
const DASHBOARD = { manager: "/manager/index.html", staff: "/staff/" };

function render() {
  const { role, mode } = form.dataset;
  document.body.dataset.role = role;
  document.querySelectorAll("#roleTabs button").forEach(b => b.setAttribute("aria-pressed", b.dataset.role === role));
  document.querySelectorAll("#modeTabs button").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === mode));
  const reg = mode === "register";
  $("nameField").hidden = !reg; $("confirmField").hidden = !reg;
  $("fullName").required = reg; $("confirm").required = reg;
  $("password").autocomplete = reg ? "new-password" : "current-password";
  $("formTitle").textContent = `${COPY[role].name} ${reg ? "registration" : "login"}`;
  $("formSub").textContent = SUB[role][mode];
  $("submitBtn").textContent = reg ? "Create account" : "Log in";
  $("sideTitle").textContent = COPY[role].title;
  $("sideText").textContent = COPY[role].text;
  say("");
  showResend(false);
}
$("roleTabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { form.dataset.role = b.dataset.role; render(); } });
$("modeTabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { form.dataset.mode = b.dataset.mode; render(); } });

// ---------- Show / hide password ----------
document.querySelectorAll(".eye").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = btn.parentElement.querySelector("input");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.setAttribute("aria-pressed", show);
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
});

// ---------- Firebase ----------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { experimentalForceLongPolling: true });

const friendly = (code) => ({
  "auth/invalid-credential": "Wrong email or password.",
  "auth/email-already-in-use": "This email already has an account. Log in instead.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/operation-not-allowed": "Email/Password sign-in is not enabled in Firebase Authentication.",
  "auth/network-request-failed": "Network problem. Check your internet or ad blocker.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "permission-denied": "Firestore rules are blocking this. Set Firestore to test mode."
}[code] || "Something went wrong. Try again.");

// If a step takes more than 12 seconds, show which step is stuck
const step = (promise, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(
    () => reject({ message: `Stuck at: ${label}. Open the browser console (F12) for details.` }), 12000))
]);

const setLoading = (on, label) => {
  const btn = $("submitBtn");
  btn.disabled = on;
  btn.classList.toggle("loading", on);
  if (label) btn.textContent = label;
};

// ---------- "Resend verification email" button (created here, no HTML needed) ----------
function showResend(on) {
  let btn = $("resendBtn");
  if (!btn && on) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "resendBtn";
    btn.className = "link-btn";
    btn.textContent = "Resend verification email";
    btn.style.cssText = "display:block;margin:10px 0 0;padding:6px 0;border:0;background:transparent;color:var(--red,#b91c1c);font:inherit;font-weight:700;font-size:.9rem;cursor:pointer;text-decoration:underline";
    msg.after(btn);
    btn.addEventListener("click", resendVerification);
  }
  if (btn) btn.hidden = !on;
}

async function resendVerification() {
  const btn = $("resendBtn");
  btn.disabled = true;
  try {
    // Sign in briefly with what is typed in the form, send the email, sign out again
    const cred = await step(signInWithEmailAndPassword(auth, $("email").value, $("password").value), "signing in (Authentication)");
    await step(sendEmailVerification(cred.user), "sending the verification email");
    await signOut(auth);
    say("Verification email sent again. Check your inbox and Spam folder.", "ok");
  } catch (err) {
    console.error(err);
    say(err.code ? friendly(err.code) + ` (${err.code})` : (err.message || "Could not send the email."), "err");
  } finally {
    btn.disabled = false;
  }
}

render();

// ---------- Submit ----------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const { role, mode } = form.dataset;
  const data = Object.fromEntries(new FormData(form));
  setLoading(true, mode === "register" ? "Creating account..." : "Logging in...");
  say("");
  showResend(false);
  let redirecting = false;
  try {
    if (mode === "register") {
      if (data.password !== data.confirm) throw { message: "Passwords do not match." };
      const cred = await step(createUserWithEmailAndPassword(auth, data.email, data.password), "creating the account (Authentication)");
      await step(updateProfile(cred.user, { displayName: data.fullName }), "saving your name");
      await step(setDoc(doc(db, "users", cred.user.uid), {
        fullName: data.fullName, email: data.email, role,
        verifyRequired: true,            // new accounts must verify their email before logging in
        createdAt: serverTimestamp()
      }), "saving your role (Firestore)");
      await step(sendEmailVerification(cred.user), "sending the verification email");
      await signOut(auth);
      form.dataset.mode = "login"; render();
      $("email").value = data.email; $("password").value = ""; $("password").focus();
      say(`We sent a verification link to ${data.email}. Click it (check Spam too), then log in.`, "ok");
    } else {
      const cred = await step(signInWithEmailAndPassword(auth, data.email, data.password), "signing in (Authentication)");
      const snap = await step(getDoc(doc(db, "users", cred.user.uid)), "checking your role (Firestore)");
      if (!snap.exists() || snap.data().role !== role) {
        await signOut(auth);
        throw { message: role === "manager"
          ? "This account is not an HR account. Use the Recruitment / Coordinator login."
          : "This account is not a Recruitment / Coordinator account. Use the HR login at /hr/login." };
      }
      // Older accounts have no verifyRequired flag, so they can still log in
      if (snap.data().verifyRequired === true && !cred.user.emailVerified) {
        await signOut(auth);
        say("Your email is not verified yet. Click the link we emailed you, then log in again.", "err");
        showResend(true);
        return;
      }
      redirecting = true;
      setLoading(true, "Opening dashboard...");
      say("Logged in. Opening your dashboard...", "ok");
      location.href = DASHBOARD[role] || "/";
    }
  } catch (err) {
    console.error(err);
    say(err.code ? friendly(err.code) + ` (${err.code})` : (err.message || "Something went wrong."), "err");
  } finally {
    if (!redirecting) {
      setLoading(false);
      $("submitBtn").textContent = form.dataset.mode === "register" ? "Create account" : "Log in";
    }
  }
});