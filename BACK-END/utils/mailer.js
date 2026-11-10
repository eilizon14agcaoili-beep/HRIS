require("dotenv").config();
const nodemailer = require("nodemailer");

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

mailer
  .verify()
  .then(() => console.log("Mail server ready"))
  .catch((err) => console.error("Mail error:", err.message));

module.exports = { mailer };