# Chat & Call - dự án học tập cho sinh viên năm nhất

Ứng dụng mẫu hỗ trợ:
- Đăng ký, đăng nhập, đăng xuất.
- Nhắn tin riêng 1-1 và lưu lịch sử trong MySQL.
- Hiển thị người dùng đang trực tuyến.
- Gọi thoại và gọi video 1-1 bằng WebRTC.
- Giao diện HTML/CSS/JavaScript thuần; backend Node.js + Express; database MySQL (SQL).

## 1. Công nghệ

| Phần | Công nghệ | Vai trò |
|---|---|---|
| Frontend | HTML, CSS, JavaScript | Giao diện và xử lý thao tác |
| Backend | Node.js, Express | API, xác thực, nghiệp vụ |
| Realtime | Socket.IO | Gửi tin nhắn và tín hiệu cuộc gọi |
| Cơ sở dữ liệu | MySQL | Lưu tài khoản và tin nhắn |
| Gọi thoại/video | WebRTC | Truyền âm thanh/hình ảnh giữa hai trình duyệt |

Không dùng Ruby, React hay framework frontend phức tạp.

## 2. Cài đặt

Cần cài:
- Node.js phiên bản 20 trở lên.
- MySQL 8 trở lên (hoặc XAMPP có MySQL).
- VS Code (không bắt buộc).

Mở Terminal tại thư mục dự án và chạy:

```bash
npm install
```

Tạo database:
1. Mở MySQL Workbench hoặc phpMyAdmin.
2. Mở file `database.sql`.
3. Chạy toàn bộ câu lệnh SQL.

Tạo file cấu hình:
- Sao chép `.env.example` thành `.env`.
- Điền mật khẩu MySQL ở `DB_PASSWORD`.
- Thay `JWT_SECRET` bằng chuỗi bí mật dài, ngẫu nhiên ít nhất 32 ký tự.
- Giữ `DB_NAME=chat_app` nếu bạn chạy đúng `database.sql`.

Chạy ứng dụng:

```bash
npm start
```

Mở trình duyệt tại `http://localhost:3000`.

## 3. Cách thử

1. Mở trình duyệt, tạo tài khoản thứ nhất.
2. Mở cửa sổ ẩn danh hoặc trình duyệt khác, tạo tài khoản thứ hai.
3. Chọn tài khoản còn lại ở danh sách người dùng.
4. Gửi tin nhắn để thử realtime.
5. Chọn Gọi thoại hoặc Gọi video; cửa sổ bên kia cần chấp nhận quyền microphone/camera.

## 4. Luồng hệ thống

```text
Trình duyệt A  <--HTTP/Socket.IO-->  Node.js + Express
     |                                  |
     |<------ WebRTC media trực tiếp --->| Trình duyệt B
                                        |
                                    MySQL
                           (users, messages)
```

- Tin nhắn đi qua Socket.IO, backend kiểm tra dữ liệu rồi lưu MySQL.
- Socket.IO chỉ chuyển tín hiệu bắt đầu cuộc gọi (offer/answer/ICE).
- Âm thanh và video truyền bằng WebRTC, không lưu trong MySQL.
- Mật khẩu được băm bằng bcrypt; truy vấn SQL dùng tham số `?` để hạn chế SQL injection.
- JWT được đặt trong cookie `HttpOnly`, không lưu token trong localStorage.

## 5. Cấu trúc thư mục

```text
chat-call-web/
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── database.sql
├── server.js
├── package.json
├── .env.example
└── .gitignore
```

## 6. Giới hạn cần biết

Đây là bản MVP học tập, gọi 1-1, chưa phải sản phẩm thương mại:
- Gọi video có thể không kết nối được ở một số mạng NAT/firewall. Khi triển khai thật, cần cấu hình TURN server (ví dụ coturn) và HTTPS.
- Trình duyệt thường chỉ cho phép camera/microphone trên `localhost` hoặc website HTTPS.
- Chưa có gửi ảnh/tệp, nhóm chat, gọi nhóm, thông báo đẩy, quên mật khẩu, chặn người dùng hay mã hóa đầu cuối (E2EE).
- Cookie hiện dùng `SameSite=Lax`; nếu mở rộng API sang domain khác, cần thiết kế CORS và CSRF đúng cách.
- Cần bổ sung kiểm thử, logging, sao lưu database, chính sách quyền riêng tư và giám sát trước khi dùng thật.

## 7. Đưa lên Internet

Không thể chỉ tải thư mục HTML lên hosting tĩnh vì ứng dụng cần Node.js, Socket.IO và MySQL.
Bạn cần:
1. Hosting chạy Node.js cho backend.
2. Dịch vụ MySQL có thể truy cập từ backend.
3. Domain và HTTPS.
4. Cấu hình biến môi trường trên hosting, không tải file `.env` lên GitHub.
5. TURN server để tăng khả năng kết nối cuộc gọi qua các mạng khác nhau.

Không dùng dữ liệu thật hoặc mật khẩu đang dùng ở nơi khác khi thử nghiệm.
