require('dotenv').config();
const crypto = require('crypto');
const secret = process.env.CLOUDINARY_API_SECRET;
const timestamp = Math.round(Date.now() / 1000);
const str = 'folder=vaultshare&timestamp=' + timestamp + '&type=private';
const sig = crypto.createHash('sha256').update(str + secret).digest('hex');
console.log('timestamp:', timestamp);
console.log('signature:', sig);
