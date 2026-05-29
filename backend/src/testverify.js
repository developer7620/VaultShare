require('dotenv').config();
const CloudinaryProvider = require('./src/storage/CloudinaryProvider');

async function test() {
  const provider = new CloudinaryProvider();
  // Replace with a public_id that was just uploaded
  const result = await provider.verifyResource('vaultshare/kfgwoletjlclc4acywqj.pdf');
  console.log('Result:', result);
}

test().catch(err => {
  console.error('Error name:', err.name);
  console.error('Error message:', err.message);
  console.error('Error detail:', err.error);
  console.error('HTTP code:', err.error?.http_code);
});
