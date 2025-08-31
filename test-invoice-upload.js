require('dotenv').config(); // Ensure .env is loaded
const AWS = require('aws-sdk');
const generateInvoice = require('./utils/generateInvoice'); // adjust path if needed

// --- Configure AWS ---
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();

(async () => {
  try {
    // 1. Dummy order/pharmacy/customer for test PDF
    const order = {
      _id: '123456',
      invoiceNo: 'TEST123',
      orderId: '123456',
      date: new Date().toLocaleDateString(),
      deliveryDate: new Date().toLocaleDateString(),
      items: [
        { name: "Paracetamol", quantity: 2, price: 20 },
        { name: "Cough Syrup", quantity: 1, price: 80 }
      ],
      paymentMode: "COD"
    };
    const pharmacy = { name: "Test Pharmacy", address: "123, Main St", gstin: "GSTIN1234" };
    const customer = { name: "John Doe", address: "456, Lane 2" };

    // 2. Generate PDF
    const pdfBuffer = await generateInvoice({ order, pharmacy, customer });
    console.log("✅ PDF generated. Size (bytes):", pdfBuffer.length);

    // 3. Upload to S3
    const Key = 'test-invoices/invoice-123456.pdf';
    const s3Res = await s3.upload({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
    }).promise();

    console.log("✅ Uploaded to S3! URL:", s3Res.Location);
  } catch (err) {
    console.error("❌ TEST FAILED! Error:", err.message, err);
    process.exit(1);
  }
})();
