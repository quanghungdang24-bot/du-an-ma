require("dotenv").config();

const http = require("http");
const express = require("express");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2/promise");
const cookie = require("cookie");
const { Server } = require("socket.io");
const { rateLimit } = require("express-rate-limit");

const required = ["DB_HOST", "DB_USER", "DB_NAME", "JWT_SECRET"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Thieu bien moi truong ${key}`);
}
if (process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET phai dai it nhat 32 ky tu.");
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const COOKIE_NAME = "chat_token";

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4"
});

app.use(helmet());
app.use(express.json({ limit: "20kb" }));
app.use(express.static("public"));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Qua nhieu lan thu. Hay thu lai sau." }
});

function makeToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, {
    expiresIn: "7d"
  });
}
function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}
function readTokenFromRequest(req) {
  return req.cookies?.[COOKIE_NAME] || cookie.parse(req.headers.cookie || "")[COOKIE_NAME];
}
function requireAuth(req, res, next) {
  try {
    const token = readTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: "Ban chua dang nhap." });
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Phien dang nhap khong hop le." });
  }
}
function validUsername(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_]{3,30}$/.test(value);
}
function validPassword(value) {
  return typeof value === "string" && value.length >= 8 && value.length <= 72;
}

// Dang ky
app.post("/api/auth/register", authLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!validUsername(username)) {
      return res.status(400).json({ error: "Ten tai khoan 3-30 ky tu, chi gom chu, so va _." });
    }
    if (!validPassword(password)) {
      return res.status(400).json({ error: "Mat khau can tu 8 den 72 ky tu." });
    }
    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      [username, hash]
    );
    const user = { id: result.insertId, username };
    setAuthCookie(res, makeToken(user));
    res.status(201).json({ user });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Ten tai khoan da ton tai." });
    next(err);
  }
});

// Dang nhap
app.post("/api/auth/login", authLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!validUsername(username) || typeof password !== "string") {
      return res.status(400).json({ error: "Thong tin dang nhap khong hop le." });
    }
    const [rows] = await pool.execute(
      "SELECT id, username, password_hash FROM users WHERE username = ?",
      [username]
    );
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ error: "Sai ten tai khoan hoac mat khau." });
    }
    const user = { id: rows[0].id, username: rows[0].username };
    setAuthCookie(res, makeToken(user));
    res.json({ user });
  } catch (err) { next(err); }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true, secure: isProduction, sameSite: "lax", path: "/"
  });
  res.json({ message: "Da dang xuat." });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username } });
});

// Danh sach tai khoan de chon nguoi nhan
app.get("/api/users", requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, username FROM users WHERE id <> ? ORDER BY username LIMIT 100",
      [req.user.id]
    );
    res.json({ users: rows });
  } catch (err) { next(err); }
});

// Lay lich su hoi thoai 1-1
app.get("/api/messages/:userId", requireAuth, async (req, res, next) => {
  try {
    const otherId = Number(req.params.userId);
    if (!Number.isSafeInteger(otherId) || otherId <= 0 || otherId === Number(req.user.id)) {
      return res.status(400).json({ error: "Nguoi dung khong hop le." });
    }
    const [rows] = await pool.execute(
      `SELECT id, sender_id, receiver_id, content, created_at
       FROM messages
       WHERE (sender_id = ? AND receiver_id = ?)
          OR (sender_id = ? AND receiver_id = ?)
       ORDER BY id DESC LIMIT 100`,
      [req.user.id, otherId, otherId, req.user.id]
    );
    res.json({ messages: rows.reverse() });
  } catch (err) { next(err); }
});

// Socket xac thuc bang cookie HttpOnly
const onlineUsers = new Map(); // userId -> Set(socketId)
io.use((socket, next) => {
  try {
    const parsed = cookie.parse(socket.handshake.headers.cookie || "");
    const token = parsed[COOKIE_NAME];
    if (!token) return next(new Error("UNAUTHORIZED"));
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch { next(new Error("UNAUTHORIZED")); }
});

io.on("connection", (socket) => {
  const myId = String(socket.user.id);
  socket.join(`user:${myId}`);
  if (!onlineUsers.has(myId)) onlineUsers.set(myId, new Set());
  onlineUsers.get(myId).add(socket.id);
  io.emit("presence", { userId: Number(myId), online: true });

  socket.on("private-message", async (data, ack = () => {}) => {
    try {
      const receiverId = Number(data?.receiverId);
      const content = typeof data?.content === "string" ? data.content.trim() : "";
      if (!Number.isSafeInteger(receiverId) || receiverId <= 0 ||
          receiverId === Number(myId) || !content || content.length > 4000) {
        return ack({ ok: false, error: "Tin nhan khong hop le." });
      }
      const [users] = await pool.execute("SELECT id FROM users WHERE id = ?", [receiverId]);
      if (!users.length) return ack({ ok: false, error: "Tai khoan nhan khong ton tai." });

      const [result] = await pool.execute(
        "INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)",
        [myId, receiverId, content]
      );
      const message = {
        id: result.insertId, sender_id: Number(myId), receiver_id: receiverId,
        content, created_at: new Date().toISOString()
      };
      io.to(`user:${receiverId}`).emit("new-message", message);
      socket.emit("new-message", message);
      ack({ ok: true, message });
    } catch (err) {
      console.error("private-message:", err.message);
      ack({ ok: false, error: "Khong gui duoc tin nhan." });
    }
  });

  // Chuyen tiep tin hieu WebRTC. Media khong di qua server nay.
  for (const eventName of ["call-offer", "call-answer", "call-ice", "call-end"]) {
    socket.on(eventName, (data = {}) => {
      const peerId = Number(data.peerId);
      if (!Number.isSafeInteger(peerId) || peerId <= 0 || peerId === Number(myId)) return;
      io.to(`user:${peerId}`).emit(eventName, {
        ...data,
        peerId: Number(myId),
        fromUsername: socket.user.username
      });
    });
  }

  socket.on("disconnect", () => {
    const set = onlineUsers.get(myId);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) {
        onlineUsers.delete(myId);
        io.emit("presence", { userId: Number(myId), online: false });
      }
    }
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "May chu gap loi. Vui long thu lai." });
});

async function start() {
  await pool.query("SELECT 1");
  server.listen(PORT, () => console.log(`Server dang chay: http://localhost:${PORT}`));
}
start().catch((err) => {
  console.error("Khong ket noi duoc MySQL:", err.message);
  process.exit(1);
});
