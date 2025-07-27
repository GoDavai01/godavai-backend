require('dotenv').config();
console.log('[ENV BUCKET]', process.env.AWS_BUCKET_NAME);
console.log('[ENV ACCESS]', process.env.AWS_ACCESS_KEY_ID);
console.log('[ENV SECRET]', process.env.AWS_SECRET_ACCESS_KEY ? '[hidden]' : undefined);
console.log('[ENV REGION]', process.env.AWS_REGION);
const s3 = require('./utils/s3-setup');

s3.upload({
  Bucket: process.env.AWS_BUCKET_NAME,
  Key: 'test/test-file.txt',
  Body: 'Hello from S3 test',  // Uploads a plain string, no file needed
   // acl: 'public-read',  // <-- Gone!
}, (err, data) => {
  if (err) return console.error('UPLOAD FAIL', err);
  console.log('UPLOAD SUCCESS', data.Location);
});
