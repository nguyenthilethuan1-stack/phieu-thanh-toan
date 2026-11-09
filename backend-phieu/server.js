const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cors());

// Chuỗi kết nối MongoDB Atlas
const MONGO_URI = 'mongodb+srv://nguyenthilethuan1_db_user:Thuan1210@cluster0.rmwmya3.mongodb.net/payment_approval_db?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Đã kết nối MongoDB Atlas thành công!'))
  .catch(err => console.error('❌ Lỗi kết nối MongoDB Atlas:', err));

// --- SCHEMAS ---

// 1. Schema Người dùng
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  fullName: { type: String, required: true },
  department: { type: String, default: 'Chung' },
  role: { 
    type: String, 
    required: true, 
    enum: ['nhanvien', 'tbp', 'kt_thanhtoan', 'ktt', 'gd', 'admin'] 
  },
  managerId: { type: String, default: '' }
});
const User = mongoose.model('User', userSchema);

// 2. Schema Chi tiết khoản mục thanh toán
const paymentDetailSchema = new mongoose.Schema({
  docNo: { type: String, default: '' },
  docDate: { type: String, default: '' },
  desc: { type: String, default: '' },
  amount: { type: Number, default: 0 },
  note: { type: String, default: '' }
}, { _id: false });

// 3. Schema File đính kèm
const attachmentSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  data: { type: String, default: '' }
}, { _id: false });

// 4. Schema Phiếu đề nghị thanh toán
const paymentRequestSchema = new mongoose.Schema({
  title: { type: String, required: true },
  amount: { type: Number, required: true },
  costType: { type: String, required: true },
  department: { type: String, required: true },
  supplierName: { type: String, required: true },
  bankAccount: { type: String, required: true },
  description: { type: String },
  details: [paymentDetailSchema],
  attachments: [attachmentSchema],
  status: { type: String, default: '1. Chờ Trưởng Bộ phận duyệt' },
  createdBy: { type: String, required: true },
  submittedAt: { type: Date, default: Date.now }
});
const PaymentRequest = mongoose.model('PaymentRequest', paymentRequestSchema);

// --- API HỆ THỐNG ---

// 1. API ĐĂNG NHẬP
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    if (!user) {
      return res.status(400).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng!' });
    }
    res.json({ message: 'Đăng nhập thành công!', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. API LẤY DANH SÁCH USER
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. API TẠO USER MỚI (Dành cho Admin)
app.post('/api/users', async (req, res) => {
  try {
    const { username, password, fullName, department, role, managerId } = req.body;
    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại!' });
    }
    const newUser = new User({ username, password, fullName, department, role, managerId });
    await newUser.save();
    res.status(201).json({ message: 'Tạo tài khoản thành công!', user: newUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. API XÓA USER (Dành cho Admin)
app.delete('/api/users/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Xóa tài khoản thành công!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. API ĐỔI MẬT KHẨU CÁ NHÂN (Dành cho mọi user)
app.put('/api/users/:username/change-password', async (req, res) => {
  try {
    const { username } = req.params;
    const { oldPassword, newPassword } = req.body;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng!' });
    }

    if (user.password !== oldPassword) {
      return res.status(400).json({ error: 'Mật khẩu cũ không chính xác!' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ message: 'Đổi mật khẩu thành công!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. API TẠO PHIẾU THANH TOÁN MỚI
app.post('/api/requests', async (req, res) => {
  try {
    const { title, amount, costType, department, supplierName, bankAccount, description, details, attachments, createdBy } = req.body;
    const newRequest = new PaymentRequest({
      title, amount, costType, department, supplierName, bankAccount, description,
      details: details || [],
      attachments: attachments || [],
      createdBy
    });
    await newRequest.save();
    res.status(201).json({ message: 'Tạo phiếu đề nghị thanh toán thành công!', request: newRequest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. API SỬA NỘI DUNG PHIẾU
app.put('/api/requests/:id', async (req, res) => {
  try {
    const { title, amount, costType, department, supplierName, bankAccount, description, details, attachments } = req.body;
    const existingRequest = await PaymentRequest.findById(req.params.id);
    if (!existingRequest) {
      return res.status(404).json({ error: 'Không tìm thấy phiếu thanh toán!' });
    }

    if (!existingRequest.status.includes('1. Chờ Trưởng Bộ phận')) {
      return res.status(400).json({ error: 'Phiếu đã được cấp trên duyệt, không thể chỉnh sửa!' });
    }

    const updatedRequest = await PaymentRequest.findByIdAndUpdate(
      req.params.id,
      { title, amount, costType, department, supplierName, bankAccount, description, details: details || [], attachments: attachments || [] },
      { new: true }
    );
    res.json({ message: 'Cập nhật nội dung phiếu thành công!', request: updatedRequest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. API LẤY DANH SÁCH PHIẾU THANH TOÁN (LỌC THEO CẤP QUẢN LÝ MANAGER ID)
app.get('/api/requests', async (req, res) => {
  try {
    const { role, username } = req.query;
    let filter = {};

    if (role === 'nhanvien') {
      const user = await User.findOne({ username });
      filter.createdBy = user ? user.fullName : username;
    } 
    else if (role === 'tbp') {
      // Tìm tất cả nhân viên nhận tbp này làm cấp quản lý trực tiếp
      const subUsers = await User.find({ managerId: username });
      const subUserFullNames = subUsers.map(u => u.fullName);
      
      // Trưởng bộ phận chỉ thấy phiếu do các nhân viên thuộc quyền mình lập
      filter.createdBy = { $in: subUserFullNames };
    }
    // Admin, Giám đốc, Kế toán: Thấy tất cả

    const requests = await PaymentRequest.find(filter).sort({ submittedAt: -1 });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. API CẬP NHẬT TRẠNG THÁI PHÊ DUYỆT (5 CẤP)
app.put('/api/requests/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const updatedRequest = await PaymentRequest.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!updatedRequest) {
      return res.status(404).json({ error: 'Không tìm thấy phiếu thanh toán!' });
    }
    res.json({ message: 'Cập nhật trạng thái thành công!', request: updatedRequest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API CẬP NHẬT THÔNG TIN TÀI KHOẢN (Dành cho Admin)
app.put('/api/users/:id', async (req, res) => {
  try {
    const { fullName, department, role, managerId, password } = req.body;
    let updateData = { fullName, department, role, managerId };
    
    // Nếu Admin có nhập mật khẩu mới thì cập nhật, không thì giữ nguyên mật khẩu cũ
    if (password && password.trim() !== '') {
      updateData.password = password;
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản!' });
    }
    res.json({ message: 'Cập nhật tài khoản thành công!', user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- KHỞI TẠO TÀI KHOẢN MẪU & ADMIN ---
async function seedUsers() {
  try {
    const defaultUsers = [
      { username: 'admin', password: '123', fullName: 'Quản Trị Hệ Thống', department: 'IT', role: 'admin' },
      { username: 'nhanvien1', password: '123', fullName: 'Nguyễn Văn Nhân Viên', department: 'Phòng Kỹ Thuật', role: 'nhanvien', managerId: 'tbp1' },
      { username: 'tbp1', password: '123', fullName: 'Trần Văn Trưởng Bộ Phận', department: 'Phòng Kỹ Thuật', role: 'tbp', managerId: 'kt1' },
      { username: 'kt1', password: '123', fullName: 'Lê Thị Kế Toán Thanh Toán', department: 'Phòng Kế Toán', role: 'kt_thanhtoan', managerId: 'ktt1' },
      { username: 'ktt1', password: '123', fullName: 'Phạm Văn Kế Toán Trưởng', department: 'Phòng Kế Toán', role: 'ktt', managerId: 'gd1' },
      { username: 'gd1', password: '123', fullName: 'Hoàng Văn Giám Đốc', department: 'Ban Giám Đốc', role: 'gd', managerId: '' }
    ];

    for (let u of defaultUsers) {
      await User.findOneAndUpdate(
        { username: u.username },
        u,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    console.log('🌱 Đã đồng bộ tài khoản mẫu và Admin thành công!');
  } catch (err) {
    console.error('Lỗi khởi tạo tài khoản:', err.message);
  }
}
seedUsers();

// --- LẮNG NGHE CỔNG SERVER ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại cổng http://localhost:${PORT}`);
});