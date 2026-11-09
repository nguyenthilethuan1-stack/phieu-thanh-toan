const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Chuỗi kết nối MongoDB Atlas
const MONGO_URI = 'mongodb+srv://nguyenthilethuan1_db_user:Thuan1210@cluster0.rmwmya3.mongodb.net/payment_approval_db?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Đã kết nối MongoDB Atlas thành công!'))
  .catch(err => console.error('❌ Lỗi kết nối MongoDB Atlas:', err));

// 1. Schema Người dùng
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  fullName: { type: String, required: true },
  role: { type: String, required: true, enum: ['nhanvien', 'tbp', 'kt_thanhtoan', 'ktt', 'gd'] }
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

// 3. Schema Phiếu đề nghị thanh toán (Thêm trường attachments)
const paymentRequestSchema = new mongoose.Schema({
  title: { type: String, required: true },           
  amount: { type: Number, required: true },          
  costType: { type: String, required: true },        
  department: { type: String, required: true },      
  supplierName: { type: String, required: true },    
  bankAccount: { type: String, required: true },     
  description: { type: String },                     
  details: [paymentDetailSchema],                    
  attachments: [{ type: String }],                   // Mảng lưu tên/đường dẫn file chứng từ đính kèm
  status: { type: String, default: '1. Chờ Trưởng Bộ phận duyệt' }, 
  createdBy: { type: String, required: true },       
  submittedAt: { type: Date, default: Date.now }     
});
const PaymentRequest = mongoose.model('PaymentRequest', paymentRequestSchema);

// API Đăng nhập
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

// API Tạo mới phiếu (Hỗ trợ nhận attachments)
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

// API Sửa phiếu (Hỗ trợ cập nhật attachments)
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
      {
        title, amount, costType, department, supplierName, bankAccount, description,
        details: details || [],
        attachments: attachments || []
      },
      { new: true }
    );

    res.json({ message: 'Cập nhật nội dung phiếu thành công!', request: updatedRequest });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Lấy danh sách phiếu
app.get('/api/requests', async (req, res) => {
  try {
    const requests = await PaymentRequest.find().sort({ submittedAt: -1 });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Cập nhật trạng thái
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

// Khởi tạo tài khoản mẫu
async function seedUsers() {
  try {
    const count = await User.countDocuments();
    if (count === 0) {
      const defaultUsers = [
        { username: 'nhanvien1', password: '123', fullName: 'Nguyễn Văn Nhân Viên', role: 'nhanvien' },
        { username: 'tbp1', password: '123', fullName: 'Trần Văn Trưởng Bộ Phận', role: 'tbp' },
        { username: 'kt1', password: '123', fullName: 'Lê Thị Kế Toán Thanh Toán', role: 'kt_thanhtoan' },
        { username: 'ktt1', password: '123', fullName: 'Phạm Văn Kế Toán Trưởng', role: 'ktt' },
        { username: 'gd1', password: '123', fullName: 'Hoàng Văn Giám Đốc', role: 'gd' }
      ];
      await User.insertMany(defaultUsers);
      console.log('🌱 Đã khởi tạo 5 tài khoản mẫu thành công!');
    }
  } catch (err) {
    console.error('Lỗi khởi tạo tài khoản mẫu:', err.message);
  }
}
seedUsers();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại cổng http://localhost:${PORT}`);
});