const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));
app.use(cors());

// --- CẤU HÌNH THƯ MỤC UPLOAD VẬT LÝ ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        cb(null, uniqueSuffix + '-' + originalName);
    }
});
const upload = multer({ storage: storage });

// Cho phép truy cập công khai thư mục uploads qua đường dẫn tĩnh HTTP
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Chuỗi kết nối MongoDB Atlas
const MONGO_URI = 'mongodb+srv://nguyenthilethuan1_db_user:Thuan1210@cluster0.rmwmya3.mongodb.net/phieu_thanh_toan?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('✅ Đã kết nối MongoDB Atlas thành công!');
    fixOldRequests();
  })
  .catch(err => console.error('❌ Lỗi kết nối MongoDB Atlas:', err));

function departmentPrefix(department) {
  const deptLower = (department || '').toLowerCase();
  if (deptLower.includes('hành chính') || deptLower.includes('hc')) return 'HC';
  if (deptLower.includes('kỹ thuật') || deptLower.includes('kt')) return 'KT';
  if (deptLower.includes('kế toán') || deptLower.includes('tckt')) return 'TCKT';
  if (deptLower.includes('kinh doanh') || deptLower.includes('kd')) return 'KD';
  if (deptLower.includes('ban giám đốc') || deptLower.includes('bgđ') || deptLower.includes('bgd')) return 'BGD';
  return 'PT';
}

function yearMonthInVietnam(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(new Date(date));
  const year = parts.find(part => part.type === 'year').value;
  const month = parts.find(part => part.type === 'month').value;
  return `${year}${month}`;
}

function isGeneratedRequestCode(code) {
  return /^[A-Z]+-\d{6}-\d{2,}$/.test(String(code || '').trim());
}

async function allocateNextRequestCode(department, date = new Date()) {
  const prefix = departmentPrefix(department);
  const dateCode = yearMonthInVietnam(date);
  const pattern = new RegExp(`^${prefix}-${dateCode}-(\\d+)$`);
  const existing = await PaymentRequest.find({ requestCode: pattern }).select('requestCode');
  let max = 0;
  existing.forEach(item => {
    const match = String(item.requestCode).match(pattern);
    if (match) max = Math.max(max, parseInt(match[1], 10) || 0);
  });
  return `${prefix}-${dateCode}-${String(max + 1).padStart(2, '0')}`;
}

async function resolveRequestCode(department, preferredCode) {
  const preferred = String(preferredCode || '').trim();
  if (isGeneratedRequestCode(preferred)) {
    const taken = await PaymentRequest.findOne({ requestCode: preferred }).select('_id');
    if (!taken) return preferred;
  }
  return allocateNextRequestCode(department);
}

async function fixOldRequests() {
  try {
    const requests = await PaymentRequest.find({
      $or: [
        { requestCode: { $exists: false } },
        { requestCode: null },
        { requestCode: '' }
      ]
    }).sort({ submittedAt: 1, createdAt: 1, _id: 1 });

    for (const req of requests) {
      const dateObj = req.submittedAt || req.createdAt || new Date();
      req.requestCode = await allocateNextRequestCode(req.department, dateObj);
      await req.save();
    }
  } catch (e) {
    console.log('Fix old requests error:', e);
  }
}

const STANDARD_DEPARTMENTS = [
  'Phòng Kỹ Thuật',
  'Phòng Kế Toán',
  'Phòng Hành Chính - Nhân Sự',
  'Phòng Kinh Doanh',
  'Ban Giám Đốc',
];

// --- SCHEMAS ---
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  fullName: { type: String, required: true },
  department: { type: String, default: 'Chung' },
  role: { 
    type: String, 
    required: true, 
    enum: ['nhanvien', 'tbp', 'kt_thanhtoan', 'ktt', 'pgd_sx', 'gd', 'admin'] 
  },
  managerId: { type: String, default: '' }
});
const User = mongoose.model('User', userSchema);

const paymentDetailSchema = new mongoose.Schema({
  docNo: { type: String, default: '' },
  docDate: { type: String, default: '' },
  desc: { type: String, default: '' },
  amount: { type: Number, default: 0 },
  note: { type: String, default: '' },
  attachments: [{
    name: { type: String, default: '' },
    data: { type: String, default: '' }
  }]
}, { _id: false });

const attachmentSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  data: { type: String, default: '' }
}, { _id: false });

const paymentRequestSchema = new mongoose.Schema({
  requestCode: { type: String, default: '' },
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
  paidStatus: { type: String, default: 'Chờ thanh toán' },
  paidDate: { type: String, default: '' },
  comment: { type: String, default: '' },
  rejectReason: { type: String, default: '' },
  createdBy: { type: String, required: true },
  submittedAt: { type: Date, default: Date.now }
});
const PaymentRequest = mongoose.model('PaymentRequest', paymentRequestSchema);

// --- API HỆ THỐNG ---
app.get('/api/departments', (req, res) => {
  res.json(STANDARD_DEPARTMENTS);
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username, password });
        if (user) {
            res.json({ success: true, user });
        } else {
            res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng!' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

app.delete('/api/users/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Xóa tài khoản thành công!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

app.post('/api/requests', async (req, res) => {
  try {
    const { title, amount, costType, department, supplierName, bankAccount, description, details, attachments, createdBy, requestCode: preferredCode } = req.body;
    const requestCode = await resolveRequestCode(department, preferredCode);

    const newRequest = new PaymentRequest({
      requestCode, 
      title, amount, costType, department, supplierName, bankAccount, description,
      details: details || [],
      attachments: attachments || [],
      createdBy,
      status: '1. Chờ Trưởng Bộ phận duyệt'
    });
    
    await newRequest.save();
    res.status(201).json({ message: 'Tạo phiếu thành công!', request: newRequest });
  } catch (err) {
    console.error('Lỗi khi tạo phiếu:', err);
    res.status(500).json({ error: err.message });
  }
});

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

app.get('/api/requests', async (req, res) => {
    try {
        const { role, department, username, status, departmentFilter } = req.query;
        let query = {};

        if (role === 'nhanvien') {
            const user = await User.findOne({ username });
            if (user) {
                query.createdBy = { $in: [user.fullName, username] };
            } else {
                query.createdBy = username;
            }
        } else if (role === 'tbp') {
            if (department) {
                query.department = { $regex: new RegExp('^' + department.trim() + '$', 'i') };
            } else {
                query.department = 'KHÔNG_CÓ_BỘ_PHẬN';
            }
        }

        if (departmentFilter && role !== 'tbp') {
            query.department = departmentFilter;
        }

        if (status) {
            if (status === 'Chờ duyệt') {
                query.status = { $not: /Đã hoàn tất|Đã từ chối/ };
            } else if (status === 'Chờ thanh toán') {
                query.status = /Đã hoàn tất/;
                query.paidStatus = { $ne: 'Đã thanh toán' };
            } else if (status === 'Đã thanh toán') {
                query.paidStatus = 'Đã thanh toán';
            } else if (status === 'Đã từ chối') {
                query.status = 'Đã từ chối';
            }
        }

        const requests = await PaymentRequest.find(query).sort({ submittedAt: -1, createdAt: -1 }).lean();
        res.json(requests);
    } catch (err) {
        console.error('Lỗi API requests:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const { username, fullName, department, role, managerId, password } = req.body;
    if (username) {
      const existingUser = await User.findOne({ username, _id: { $ne: req.params.id } });
      if (existingUser) {
        return res.status(400).json({ error: 'Tên đăng nhập này đã tồn tại ở tài khoản khác!' });
      }
    }
    let updateData = { username, fullName, department, role, managerId };
    if (password && password.trim() !== '') {
      updateData.password = password;
    }
    const updatedUser = await User.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!updatedUser) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản!' });
    }
    res.json({ message: 'Cập nhật tài khoản thành công!', user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/requests/:id/paid-status', async (req, res) => {
  try {
    const { paidStatus, paidDate } = req.body;
    const updatedRequest = await PaymentRequest.findByIdAndUpdate(
      req.params.id,
      { paidStatus, paidDate },
      { new: true }
    );
    if (!updatedRequest) {
      return res.status(404).json({ error: 'Không tìm thấy phiếu thanh toán!' });
    }
    res.json({ message: 'Cập nhật trạng thái thanh toán thành công!', request: updatedRequest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API DUYỆT PHIẾU ĐÃ ĐƯỢC VÁ LỖI CHẶN VƯỢT CẤP & CHỐNG TRÙNG LẶP ---
app.put('/api/requests/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const { action, comment, userRole } = req.body; 
        const reqDoc = await PaymentRequest.findById(id); 
        if (!reqDoc) {
            return res.status(404).json({ error: 'Không tìm thấy phiếu thanh toán!' });
        }

        let currentStatus = reqDoc.status || '';
        let isKyThuat = (reqDoc.department || '').toLowerCase().includes('kỹ thuật');

        if (action === 'approve') {
            // Kiểm tra nghiêm ngặt phân quyền tuần tự chống vượt cấp
            if (currentStatus.includes('1. Chờ Trưởng Bộ phận') || !currentStatus) {
                if (userRole && userRole !== 'tbp' && userRole !== 'admin') {
                    return res.status(400).json({ error: 'Phiếu chưa được Trưởng Bộ phận duyệt, bạn không có quyền duyệt bước này!' });
                }
                reqDoc.status = '2. Chờ KT Thanh toán';
            } else if (currentStatus.includes('2. Chờ KT Thanh toán')) {
                if (userRole && userRole !== 'kt_thanhtoan' && userRole !== 'admin') {
                    return res.status(400).json({ error: 'Chưa đến lượt Kế toán thanh toán duyệt!' });
                }
                reqDoc.status = '3. Chờ Kế toán trưởng';
            } else if (currentStatus.includes('3. Chờ Kế toán trưởng')) {
                if (userRole && userRole !== 'ktt' && userRole !== 'admin') {
                    return res.status(400).json({ error: 'Chưa đến lượt Kế toán trưởng duyệt!' });
                }
                reqDoc.status = isKyThuat ? '4. Chờ Phó GĐ' : '4. Chờ Giám đốc';
            } else if (currentStatus.includes('4. Chờ Phó GĐ')) {
                if (userRole && userRole !== 'pgd_sx' && userRole !== 'admin') {
                    return res.status(400).json({ error: 'Chưa đến lượt Phó GĐ sản xuất duyệt!' });
                }
                reqDoc.status = '4. Chờ Giám đốc';
            } else if (currentStatus.includes('4. Chờ Giám đốc')) {
                if (userRole && userRole !== 'gd' && userRole !== 'admin') {
                    return res.status(400).json({ error: 'Chưa đến lượt Giám đốc duyệt!' });
                }
                reqDoc.status = '5. Đã hoàn tất';
            }
            if (comment) reqDoc.comment = comment;
        } else if (action === 'reject') {
            // Nhận diện chức vụ người từ chối để lưu trạng thái minh bạch
            let roleTitle = 'Người duyệt';
            if (userRole === 'tbp') roleTitle = 'Trưởng Bộ Phận';
            else if (userRole === 'kt_thanhtoan') roleTitle = 'Kế Toán Thanh Toán';
            else if (userRole === 'ktt') roleTitle = 'Kế Toán Trưởng';
            else if (userRole === 'pgd_sx') roleTitle = 'Phó Giám Đốc';
            else if (userRole === 'gd') roleTitle = 'Giám Đốc';
            else if (userRole === 'admin') roleTitle = 'Admin';

            reqDoc.status = `Đã từ chối (${roleTitle})`;
            reqDoc.rejectReason = comment;
            if (comment) reqDoc.comment = comment;
        }

        await reqDoc.save();
        res.json({ message: 'Phê duyệt thành công bước hiện tại!', request: reqDoc });
    } catch (err) {
        console.error('Lỗi server khi duyệt:', err);
        res.status(500).json({ error: 'Lỗi máy chủ: ' + err.message });
    }
});

// API Upload file lẻ trả về đường dẫn URL công khai
app.post('/api/upload', upload.array('files'), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'Không có file nào được tải lên!' });
        }
        const fileUrls = req.files.map(file => {
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            return {
                name: Buffer.from(file.originalname, 'latin1').toString('utf8'),
                data: `${baseUrl}/uploads/${file.filename}`
            };
        });
        res.json({ success: true, files: fileUrls });
    } catch (err) {
        console.error('Lỗi upload file:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/requests/:id', async (req, res) => {
  try {
    await PaymentRequest.findByIdAndDelete(req.params.id);
    res.json({ message: 'Xóa phiếu thành công!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function seedUsers() {
  try {
    const defaultUsers = [
      { username: 'admin', password: '123', fullName: 'Quản Trị Hệ Thống', department: 'Ban Giám Đốc', role: 'admin' },
      { username: 'nhanvien1', password: '123', fullName: 'Nguyễn Văn Nhân Viên', department: 'Phòng Kỹ Thuật', role: 'nhanvien', managerId: 'tbp1' },
      { username: 'tbp1', password: '123', fullName: 'Trần Văn Trưởng Bộ Phận', department: 'Phòng Kỹ Thuật', role: 'tbp', managerId: 'kt1' },
      { username: 'kt1', password: '123', fullName: 'Lê Thị Kế Toán Thanh Toán', department: 'Phòng Kế Toán', role: 'kt_thanhtoan', managerId: 'ktt1' },
      { username: 'ktt1', password: '123', fullName: 'Phạm Văn Kế Toán Trưởng', department: 'Phòng Kế Toán', role: 'ktt', managerId: 'pgdsx1' },
      { username: 'pgdsx1', password: '123', fullName: 'Nguyễn Văn Phó GĐ Sản Xuất', department: 'Phòng Kỹ Thuật', role: 'pgd_sx', managerId: 'gd1' },
      { username: 'gd1', password: '123', fullName: 'Hoàng Văn Giám Đốc', department: 'Ban Giám Đốc', role: 'gd', managerId: '' }
    ];
    for (let u of defaultUsers) {
      await User.findOneAndUpdate({ username: u.username }, u, { upsert: true, new: true, setDefaultsOnInsert: true });
    }
  } catch (err) {
    console.error('Lỗi khởi tạo tài khoản:', err.message);
  }
}
seedUsers();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại cổng http://localhost:${PORT}`);
});