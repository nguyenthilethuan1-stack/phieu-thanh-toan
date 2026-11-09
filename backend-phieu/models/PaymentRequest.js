const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  // Loại chi phí: Tạm ứng, Thanh toán nhà cung cấp, Hoàn ứng, v.v.
  expenseType: { 
    type: String, 
    required: true 
  },
  
  // Thông tin số tiền và nội dung
  amount: { 
    type: Number, 
    required: true 
  },
  description: { 
    type: String, 
    required: true 
  },
  
  // Thông tin người thụ hưởng (Nhà cung cấp / Cần nhận tiền)
  beneficiary: {
    name: { type: String, required: true },
    accountNumber: { type: String, required: true },
    bankName: { type: String, required: true },
    branch: { type: String }
  },

  // Người tạo yêu cầu
  requester: { 
    type: String, 
    required: true 
  },

  // Trạng thái phiếu: Draft, Pending Approval, Approved, Rejected, Paid...
  status: { 
    type: String, 
    default: 'Draft' 
  },

  // Thời gian tạo phiếu
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

module.exports = mongoose.model('PaymentRequest', paymentSchema);