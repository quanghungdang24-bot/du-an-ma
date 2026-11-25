const $ = (id) => document.getElementById(id);
let me = null;
let selectedUser = null;
let socket = null;
let peer = null;
let localStream = null;
let pendingOffer = null;
const online = new Set();

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Co loi xay ra.");
  return data;
}
function showError(message) { $("authError").textContent = message; }
function showApp(user) {
  me = user;
  $("authPanel").classList.add("hidden");
  $("chatPanel").classList.remove("hidden");
  $("myName").textContent = `Đăng nhập: ${user.username}`;
  connectSocket();
  loadUsers();
}
async function authenticate(path) {
  showError("");
  try {
    const data = await api(path, {
      method: "POST",
      body: JSON.stringify({ username: $("username").value.trim(), password: $("password").value })
    });
    showApp(data.user);
  } catch (err) { showError(err.message); }
}
$("loginBtn").onclick = () => authenticate("/api/auth/login");
$("registerBtn").onclick = () => authenticate("/api/auth/register");
$("logoutBtn").onclick = async () => {
  await endCall(false);
  if (socket) socket.disconnect();
  await api("/api/auth/logout", { method: "POST" });
  location.reload();
};

async function loadUsers() {
  try {
    const { users } = await api("/api/users");
    $("users").replaceChildren();
    if (!users.length) $("users").textContent = "Chưa có tài khoản khác. Hãy tạo tài khoản thứ hai để thử.";
    users.forEach(user => {
      const button = document.createElement("button");
      button.className = "user" + (selectedUser?.id === user.id ? " active" : "");
      const name = document.createElement("span");
      name.textContent = user.username;
      const state = document.createElement("small");
      state.textContent = online.has(user.id) ? "Đang trực tuyến" : "Ngoại tuyến";
      button.append(name, state);
      button.onclick = () => selectUser(user);
      $("users").append(button);
    });
  } catch (err) { $("users").textContent = err.message; }
}
async function selectUser(user) {
  selectedUser = user;
  $("chatTitle").textContent = `Trò chuyện với ${user.username}`;
  $("messageInput").disabled = false;
  $("sendBtn").disabled = false;
  $("voiceBtn").disabled = false;
  $("videoBtn").disabled = false;
  await loadMessages();
  loadUsers();
}
async function loadMessages() {
  const { messages } = await api(`/api/messages/${selectedUser.id}`);
  $("messages").replaceChildren();
  messages.forEach(renderMessage);
  $("messages").scrollTop = $("messages").scrollHeight;
}
function renderMessage(message) {
  const bubble = document.createElement("div");
  bubble.className = "bubble" + (Number(message.sender_id) === Number(me.id) ? " mine" : "");
  const content = document.createElement("div");
  content.textContent = message.content; // textContent ngan XSS
  const time = document.createElement("small");
  time.textContent = new Date(message.created_at).toLocaleString("vi-VN");
  bubble.append(content, time);
  $("messages").append(bubble);
  $("messages").scrollTop = $("messages").scrollHeight;
}
$("sendForm").onsubmit = async (event) => {
  event.preventDefault();
  const content = $("messageInput").value.trim();
  if (!content || !selectedUser || !socket) return;
  socket.emit("private-message", { receiverId: selectedUser.id, content }, (result) => {
    if (!result?.ok) alert(result?.error || "Khong gui duoc tin nhan.");
    else $("messageInput").value = "";
  });
};

function connectSocket() {
  socket = io();
  socket.on("connect_error", () => showError("Khong the ket noi may chu chat. Hay dang nhap lai."));
  socket.on("presence", ({ userId, online: isOnline }) => {
    if (isOnline) online.add(Number(userId)); else online.delete(Number(userId));
    loadUsers();
  });
  socket.on("new-message", (message) => {
    if (selectedUser &&
      ((Number(message.sender_id) === Number(selectedUser.id) && Number(message.receiver_id) === Number(me.id)) ||
       (Number(message.sender_id) === Number(me.id) && Number(message.receiver_id) === Number(selectedUser.id)))) {
      renderMessage(message);
    }
  });
  socket.on("call-offer", async (data) => {
    if (!selectedUser || Number(selectedUser.id) !== Number(data.peerId)) {
      const accept = confirm(`${data.fromUsername} đang gọi. Chấp nhận cuộc gọi?`);
      if (!accept) {
        socket.emit("call-end", { peerId: data.peerId });
        return;
      }
      const { users } = await api("/api/users");
      selectedUser = users.find(u => Number(u.id) === Number(data.peerId)) || { id: data.peerId, username: data.fromUsername };
      $("chatTitle").textContent = `Cuộc gọi với ${selectedUser.username}`;
      $("messageInput").disabled = false;
      $("sendBtn").disabled = false;
    }
    pendingOffer = data.offer;
    await startCall(data.video, false);
    await peer.setRemoteDescription(new RTCSessionDescription(pendingOffer));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit("call-answer", { peerId: selectedUser.id, answer });
    $("callStatus").textContent = "Đang kết nối...";
  });
  socket.on("call-answer", async (data) => {
    if (peer && Number(data.peerId) === Number(selectedUser?.id)) {
      await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
  });
  socket.on("call-ice", async (data) => {
    if (peer && Number(data.peerId) === Number(selectedUser?.id) && data.candidate) {
      try { await peer.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) { console.warn(e); }
    }
  });
  socket.on("call-end", () => endCall(false));
}

async function startCall(video, createOffer = true) {
  if (!selectedUser) return alert("Hay chon nguoi goi.");
  try {
    await endCall(false);
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: video });
    $("localVideo").srcObject = video ? localStream : null;
    peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
    peer.ontrack = (event) => { $("remoteVideo").srcObject = event.streams[0]; };
    peer.onicecandidate = (event) => {
      if (event.candidate) socket.emit("call-ice", {
        peerId: selectedUser.id, candidate: event.candidate
      });
    };
    peer.onconnectionstatechange = () => {
      $("callStatus").textContent = `Trạng thái cuộc gọi: ${peer.connectionState}`;
    };
    $("hangupBtn").disabled = false;
    $("callStatus").textContent = video ? "Đang gọi video..." : "Đang gọi thoại...";
    if (createOffer) {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socket.emit("call-offer", {
        peerId: selectedUser.id, offer, video
      });
    }
  } catch (err) {
    $("callStatus").textContent = `Không thể bắt đầu cuộc gọi: ${err.message}`;
    await endCall(false);
  }
}
$("voiceBtn").onclick = () => startCall(false, true);
$("videoBtn").onclick = () => startCall(true, true);
$("hangupBtn").onclick = () => endCall(true);

async function endCall(notifyPeer) {
  if (notifyPeer && socket && selectedUser) socket.emit("call-end", { peerId: selectedUser.id });
  if (peer) { peer.close(); peer = null; }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  $("localVideo").srcObject = null;
  $("remoteVideo").srcObject = null;
  $("hangupBtn").disabled = true;
  $("callStatus").textContent = "Chưa có cuộc gọi";
}

// Tu dong khoi phuc phien neu cookie con hieu luc
(async function init() {
  try {
    const data = await api("/api/auth/me");
    showApp(data.user);
  } catch { /* Chua dang nhap */ }
})();
