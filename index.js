const express = require("express");
const cors = require("cors");
const tls = require("tls");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.wxzkvmx.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

function escapeHeader(value = "") {
  return String(value).replace(/[\r\n]+/g, " ").trim();
}

function normalizeEmail(value = "") {
  return String(value).replace(/[\r\n<>]+/g, "").trim();
}

function extractEmail(message) {
  return normalizeEmail(message.Email || message.email || message.userEmail || message.from || message.senderEmail);
}

function buildMessageBody(message) {
  return Object.entries(message)
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`)
    .join("\n");
}

function dotStuff(text) {
  return text.replace(/^\./gm, "..");
}

function smtpCommand(socket, command, expectedCode) {
  return new Promise((resolve, reject) => {
    const onData = (data) => {
      const response = data.toString();
      const lines = response.trim().split(/\r?\n/);
      const lastLine = lines[lines.length - 1] || "";

      if (!lastLine.startsWith(`${expectedCode}`)) {
        cleanup();
        reject(new Error(`SMTP command failed: ${command || "connect"} -> ${response.trim()}`));
        return;
      }

      if (lastLine.charAt(3) !== "-") {
        cleanup();
        resolve(response);
      }
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };

    socket.on("data", onData);
    socket.on("error", onError);

    if (command) {
      socket.write(`${command}\r\n`);
    }
  });
}

async function sendEmail({ to, subject, text }) {
  const emailUser = normalizeEmail(process.env.EMAIL_USER);
  const emailPassword = process.env.EMAIL_APP_PASSWORD;
  const recipient = normalizeEmail(to);

  if (!emailUser || !emailPassword || !recipient) {
    throw new Error("Email credentials are missing. Set EMAIL_USER and EMAIL_APP_PASSWORD in .env.");
  }

  const socket = tls.connect(465, "smtp.gmail.com", { servername: "smtp.gmail.com" });
  const message = [
    `From: ${escapeHeader(emailUser)}`,
    `To: ${escapeHeader(recipient)}`,
    `Subject: ${escapeHeader(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    dotStuff(text),
  ].join("\r\n");

  try {
    await smtpCommand(socket, null, 220);
    await smtpCommand(socket, "EHLO localhost", 250);
    await smtpCommand(socket, "AUTH LOGIN", 334);
    await smtpCommand(socket, Buffer.from(emailUser).toString("base64"), 334);
    await smtpCommand(socket, Buffer.from(emailPassword).toString("base64"), 235);
    await smtpCommand(socket, `MAIL FROM:<${emailUser}>`, 250);
    await smtpCommand(socket, `RCPT TO:<${recipient}>`, 250);
    await smtpCommand(socket, "DATA", 354);
    await smtpCommand(socket, `${message}\r\n.`, 250);
    await smtpCommand(socket, "QUIT", 221);
  } finally {
    socket.end();
  }
}

async function run() {
  try {
    const messages = client.db("Portfolio").collection("Messages");

    app.post("/post", async (req, res) => {
      try {
        const tempMessages = req.body;
        const userEmail = extractEmail(tempMessages);
        const notificationEmail = process.env.NOTIFICATION_EMAIL || process.env.EMAIL_USER;

        if (!userEmail) {
          return res.status(400).send({ message: "Email is required." });
        }

        if (!notificationEmail) {
          return res.status(500).send({ message: "Notification email is not configured." });
        }

        const result = await messages.insertOne(tempMessages);
        const messageBody = buildMessageBody(tempMessages);

        await Promise.all([
          sendEmail({
            to: notificationEmail,
            subject: "New portfolio message",
            text: `You received a new portfolio message.\n\n${messageBody}`,
          }),
          sendEmail({
            to: userEmail,
            subject: "Your message has been sent successfully",
            text: "Your message has been sent successfully. Thank you for reaching out. I will get back to you soon.",
          }),
        ]);

        res.send({
          ...result,
          notification: "Emails sent successfully.",
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to save message or send email." });
      }
    });

  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);


app.get("/", (req, res) => {
  res.send("Server running");
});

app.listen(port, () => {
  console.log("Server is running");
});
