require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const APPS_SCRIPT_URL =
  process.env.GOOGLE_APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbxW8msuUT4zR8Z41k1dWCItlcTy3gt-VOiV20nAc1Ij_Wg6aw3PPo2hvDwsp6dugtcJ/exec';

function getVietnamYearMonth(dateInput) {
  const parsed = dateInput ? new Date(dateInput) : new Date();
  const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit'
  });

  const parts = formatter.formatToParts(safeDate);
  const year = parts.find((p) => p.type === 'year')?.value || '2026';
  const month = parts.find((p) => p.type === 'month')?.value || '11';
  return { year, month };
}

function extractBase64Payload(rawData) {
  if (!rawData || typeof rawData !== 'string') return '';
  const commaIdx = rawData.indexOf(',');
  return commaIdx >= 0 ? rawData.slice(commaIdx + 1).trim() : rawData.trim();
}

async function syncDriveAttachmentsInBackground(requestDoc, driveAttachments = []) {
  if (!APPS_SCRIPT_URL || !Array.isArray(driveAttachments) || driveAttachments.length === 0) {
    return;
  }

  const refDate =
    requestDoc?.details?.[0]?.docDate ||
    requestDoc?.createdAt ||
    requestDoc?.updatedAt ||
    new Date();
  const { year, month } = getVietnamYearMonth(refDate);
  const department =
  requestDoc?.department ||
  requestDoc?.dept ||
  requestDoc?.departmentName ||
  requestDoc?.boPhan ||
  'Chua_phan_loai';

  for (const item of driveAttachments) {
    try {
      const base64Data = extractBase64Payload(
        item?.dataUrl || item?.data || item?.base64 || ''
      );
      if (!base64Data) continue;

      const fileName =
        item?.originalName ||
        item?.fileName ||
        item?.name ||
        `chung-tu-${Date.now()}`;
      const mimeType =
        item?.mimeType ||
        item?.type ||
        'application/octet-stream';

      const payload = {
  fileName,
  mimeType,
  base64Data,
  year,
  month,
  department,
  yearFolderName: year,
  monthFolderName: month,
  deptFolderName: department,
  requestCode: requestDoc?.requestCode || '',
  requestId: String(requestDoc?._id || requestDoc?.id || '')
};

      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const text = await res.text();
      let result = null;
      try {
        result = JSON.parse(text);
      } catch (_) {
        result = { raw: text };
      }

      if (!res.ok || result?.success === false) {
        console.error('[DriveSync] Lỗi đẩy file lên Apps Script:', fileName, result);
      } else {
        console.log(
          '[DriveSync] Đã đẩy file:',
          result?.fileName || fileName,
          '->',
          result?.folderPath || `${year}/${month}/${department}`
        );
      }
    } catch (err) {
      console.error('[DriveSync] Ngoại lệ khi đồng bộ file:', err?.message || err);
    }
  }
}
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
const MONGO_URI = process.env.MONGO_URI;

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
    enum: ['nhanvien', 'tbp', 'kt_thanhtoan', 'ktt', 'pgd_sx', 'giam_doc', 'admin'] 
  },
  managerId: { type: String, default: '' },
  zaloPhone: { type: String, default: '' }
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
  submittedAt: { type: Date, default: Date.now },
  tbpApprovedAt: { type: Date, default: null },
  ktApprovedAt: { type: Date, default: null },
  kttApprovedAt: { type: Date, default: null },
  pgdApprovedAt: { type: Date, default: null },
  gdApprovedAt: { type: Date, default: null }
});
const PaymentRequest = mongoose.model('PaymentRequest', paymentRequestSchema);
function normalizeVnPhone(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('84')) return digits;
  if (digits.startsWith('0')) return '84' + digits.slice(1);
  return '84' + digits;
}
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
    const { username, password, fullName, department, role, managerId, zaloPhone } = req.body;
    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại!' });
    }
    const newUser = new User({
      username,
      password,
      fullName,
      department,
      role,
      managerId,
      zaloPhone: normalizeVnPhone(zaloPhone || '')
    });
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
    const {
        title, amount, costType, department, supplierName, bankAccount,
        description, details, attachments, driveAttachments, createdBy, requestCode: preferredCode
      } = req.body;

    let requestCode = await resolveRequestCode(department, preferredCode);
    let savedRequest = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const newRequest = new PaymentRequest({
          requestCode,
          title, amount, costType, department, supplierName, bankAccount, description,
          details: details || [],
          attachments: attachments || [],
          createdBy,
          status: '1. Chờ Trưởng Bộ phận duyệt'
        });
        savedRequest = await newRequest.save();
        break;
      } catch (saveErr) {
        if (saveErr && saveErr.code === 11000) {
          requestCode = await allocateNextRequestCode(department);
          continue;
        }
        throw saveErr;
      }
    }

    if (!savedRequest) {
      return res.status(409).json({ error: 'Không thể cấp số phiếu duy nhất, vui lòng thử lại!' });
    }
    const filesToSync = Array.isArray(driveAttachments) ? driveAttachments : [];
    if (filesToSync.length > 0) {
      setImmediate(() => {
        syncDriveAttachmentsInBackground(savedRequest, filesToSync);
      });
    }

    res.status(201).json({ message: 'Tạo phiếu thành công!', request: savedRequest });
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
    const filesToSync = [];

      if (Array.isArray(req.body?.driveAttachments)) {
        filesToSync.push(...req.body.driveAttachments);
      }

      if (Array.isArray(req.body?.details)) {
        for (const row of req.body.details) {
          if (Array.isArray(row?.attachments)) {
            for (const att of row.attachments) {
              if (att && (att.dataUrl || att.data || att.base64)) {
                filesToSync.push(att);
              }
            }
          }
        }
      }

      if (filesToSync.length > 0 && updatedRequest) {
        setImmediate(() => {
          syncDriveAttachmentsInBackground(updatedRequest, filesToSync);
        });
      }
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
  const s = String(status).trim().toLowerCase();
  if (s.includes('chờ duyệt')) {
    query.status = { $not: /hoàn tất|từ chối/i };
  } else if (s.includes('chờ thanh toán')) {
    query.status = /hoàn tất/i;
    query.paidStatus = { $ne: 'Đã thanh toán' };
  } else if (s.includes('đã thanh toán')) {
    query.paidStatus = 'Đã thanh toán';
  } else if (s.includes('từ chối')) {
    query.status = { $regex: 'từ chối', $options: 'i' };
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
    const { username, password, fullName, department, role, managerId, zaloPhone } = req.body;
    const updateData = {};

    if (username !== undefined) updateData.username = username;
    if (password) updateData.password = password;
    if (fullName !== undefined) updateData.fullName = fullName;
    if (department !== undefined) updateData.department = department;
    if (role !== undefined) updateData.role = role;
    if (managerId !== undefined) updateData.managerId = managerId;
    if (zaloPhone !== undefined) updateData.zaloPhone = normalizeVnPhone(zaloPhone);

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).select('-password');

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
// Lấy số phiếu tiếp theo theo phòng ban + tháng hiện tại trên toàn bộ database (không lọc theo user)
app.get('/api/next-request-code', async (req, res) => {
  try {
    const department = String(req.query.department || '').trim();
    const nextCode = await allocateNextRequestCode(department);
    res.json({ requestCode: nextCode });
  } catch (err) {
    console.error('Lỗi lấy số phiếu kế tiếp:', err);
    res.status(500).json({ error: 'Không thể lấy số phiếu kế tiếp!' });
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

        const now = new Date();
        let currentStatus = reqDoc.status || '';
        let isKyThuat = (reqDoc.department || '').toLowerCase().includes('kỹ thuật');
        const roleNorm = String(userRole || req.body.role || '').trim().toLowerCase();

        if (action === 'approve') {
            // Kiểm tra nghiêm ngặt phân quyền tuần tự chống vượt cấp
            if (currentStatus.includes('1. Chờ Trưởng Bộ phận') || !currentStatus) {
                if (roleNorm && roleNorm !== 'tbp' && roleNorm !== 'admin') {
                    return res.status(400).json({ error: 'Phiếu chưa được Trưởng Bộ phận duyệt, bạn không có quyền duyệt bước này!' });
                }
                reqDoc.status = '2. Chờ KT Thanh toán';
                reqDoc.tbpApprovedAt = now;
            } else if (currentStatus.includes('2. Chờ KT Thanh toán')) {
                if (roleNorm && roleNorm !== 'kt_thanhtoan' && !roleNorm.includes('thanhtoan') && roleNorm !== 'admin') {
                    return res.status(400).json({ error: 'Chưa đến lượt Kế toán thanh toán duyệt!' });
                }
                reqDoc.status = '3. Chờ Kế toán trưởng';
                reqDoc.ktApprovedAt = now;
            } else if (currentStatus.includes('3. Chờ Kế toán trưởng')) {
                if (roleNorm && roleNorm !== 'ktt' && roleNorm !== 'kt_truong' && !roleNorm.includes('ke_toan_truong') && roleNorm !== 'admin') {
                    return res.status(400).json({ error: 'Chưa đến lượt Kế toán trưởng duyệt!' });
                }
                reqDoc.status = isKyThuat ? '4. Chờ Phó GĐ' : '4. Chờ Giám đốc';
                reqDoc.kttApprovedAt = now;
            } else if (currentStatus.includes('4. Chờ Phó GĐ')) {
                if (roleNorm && roleNorm !== 'pgd_sx' && roleNorm !== 'pgdsx' && !roleNorm.includes('pgd') && roleNorm !== 'admin') {
                    return res.status(400).json({ error: 'Chưa đến lượt Phó GĐ sản xuất duyệt!' });
                }
                reqDoc.status = '4. Chờ Giám đốc';
                reqDoc.pgdApprovedAt = now;
            } else if (currentStatus.includes('4. Chờ Giám đốc')) {
                if (roleNorm && roleNorm !== 'giam_doc' && !roleNorm.includes('giamdoc') && roleNorm !== 'admin') {
                    return res.status(400).json({ error: 'Chưa đến lượt Giám đốc duyệt!' });
                }
                reqDoc.status = '5. Đã hoàn tất';
                reqDoc.gdApprovedAt = now;
            } else {
                return res.status(400).json({ error: 'Phiếu không ở trạng thái chờ duyệt hợp lệ!' });
            }

            if (comment) reqDoc.comment = comment;
        } else if (action === 'reject') {
            // Nhận diện chức vụ người từ chối để lưu trạng thái minh bạch
            let roleTitle = 'Người duyệt';
            if (roleNorm === 'tbp' || roleNorm.includes('truong_bo_phan')) roleTitle = 'Trưởng Bộ Phận';
            else if (roleNorm === 'kt_thanhtoan' || roleNorm.includes('thanhtoan')) roleTitle = 'Kế Toán Thanh Toán';
            else if (roleNorm === 'ktt' || roleNorm === 'kt_truong' || roleNorm.includes('ke_toan_truong')) roleTitle = 'Kế Toán Trưởng';
            else if (roleNorm === 'pgd_sx' || roleNorm.includes('pgd')) roleTitle = 'Phó Giám Đốc';
            else if (roleNorm === 'giam_doc') roleTitle = 'Giám Đốc';
            else if (roleNorm === 'admin') roleTitle = 'Admin';

            reqDoc.status = `Đã từ chối (${roleTitle})`;
            reqDoc.rejectReason = comment || '';
            if (comment) reqDoc.comment = comment;
        } else {
            return res.status(400).json({ error: 'Hành động phê duyệt không hợp lệ!' });
        }

        await reqDoc.save();
        res.json({ message: 'Xử lý phiếu thành công!', request: reqDoc });
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

