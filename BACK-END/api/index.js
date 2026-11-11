const path = require("path");

// palitan ang "public" kung ibang folder ang pinaglalagyan ng index.html mo
const FRONT = path.join(__dirname, "public");

app.get(
  ["/hr/login", "/hr/register", "/staff/login", "/staff/register"],
  (req, res) => res.sendFile(path.join(FRONT, "index.html"))
);