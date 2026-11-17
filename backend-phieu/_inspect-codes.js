const fs = require('fs');
const mongoose = require('mongoose');

const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const match = src.match(/mongodb\+srv:\/\/[^'"]+/);
if (!match) {
  console.error('no uri');
  process.exit(1);
}

mongoose.connect(match[0]).then(async () => {
  const col = mongoose.connection.db.collection('paymentrequests');
  const n = await col.countDocuments();
  const withCode = await col.countDocuments({
    requestCode: { $exists: true, $nin: [null, ''] }
  });
  const sample = await col.find({}, {
    projection: { attachments: 0, details: 0, description: 0 }
  }).sort({ submittedAt: -1 }).limit(12).toArray();

  const keys = new Set();
  sample.forEach(doc => Object.keys(doc).forEach(key => keys.add(key)));

  const codes = sample.map(doc => ({
    requestCode: doc.requestCode || '',
    code: doc.code || '',
    soPhieu: doc.soPhieu || '',
    requestNo: doc.requestNo || '',
    maPhieu: doc.maPhieu || ''
  }));

  console.log(JSON.stringify({ n, withCode, keys: [...keys], codes }, null, 2));
  await mongoose.disconnect();
}).catch(err => {
  console.error(err.message);
  process.exit(1);
});
