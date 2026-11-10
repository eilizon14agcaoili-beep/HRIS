const { sendMail } = require("./utils/mailer");

sendMail({
  to: "eilizon14agcaoili@gmail.com",
  subject: "Test HRIS",
  text: "Gumagana na ang Nodemailer!",
})
  .then((info) => console.log("Sent:", info.messageId))
  .catch((err) => console.error("Failed:", err.message));