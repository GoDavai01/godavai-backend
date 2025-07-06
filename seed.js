require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Medicine = require("./models/Medicine");
const Pharmacy = require("./models/Pharmacy");

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    await Medicine.deleteMany({});
    await Pharmacy.deleteMany({});

    const hashedPass = await bcrypt.hash("pass", 10); // ✅ hashed password

    const [healthPlusDelhi, cityMedDelhi, lifelineMumbai, quickMedsMumbai] =
      await Pharmacy.create([
        {
          name: "HealthPlus Delhi",
          ownerName: "Dr. A. Kumar",
          city: "Delhi",
          area: "Connaught Place",
          address: "1 CP Street, Delhi",
          contact: "9876543210",
          email: "delhi@healthplus.com",
          password: hashedPass,
          qualification: "B.Pharm",
          stateCouncilReg: "D12345",
          drugLicenseRetail: "DLR-DEL-123",
          gstin: "07AAAPL1234C1ZV",
          identityProof: "Aadhar123",
          addressProof: "AddressProof123",
          photo: "https://randomuser.me/api/portraits/men/11.jpg",
          qualificationCert: "qual_cert.pdf",
          councilCert: "council_cert.pdf",
          retailLicense: "retail_license.pdf",
          gstCert: "gst_cert.pdf",
          bankAccount: "1234567890",
          ifsc: "SBIN0001234",
          declarationAccepted: true,
          pharmacyTimings: { is24Hours: false, open: "08:00 AM", close: "10:00 PM" },
          status: "approved"
        },
        {
          name: "CityMed Pharmacy",
          ownerName: "Dr. R. Singh",
          city: "Delhi",
          area: "Dwarka",
          address: "5 Dwarka Road, Delhi",
          contact: "9876543222",
          email: "citymed@delhi.com",
          password: hashedPass,
          qualification: "D.Pharm",
          stateCouncilReg: "D67890",
          drugLicenseRetail: "DLR-DEL-456",
          gstin: "07AAAPL4567C2ZV",
          identityProof: "Aadhar456",
          addressProof: "AddressProof456",
          photo: "https://randomuser.me/api/portraits/women/22.jpg",
          qualificationCert: "qual_cert2.pdf",
          councilCert: "council_cert2.pdf",
          retailLicense: "retail_license2.pdf",
          gstCert: "gst_cert2.pdf",
          bankAccount: "1234567800",
          ifsc: "SBIN0005678",
          declarationAccepted: true,
          pharmacyTimings: { is24Hours: true },
          status: "approved"
        },
        {
          name: "Lifeline Mumbai",
          ownerName: "Dr. S. Patel",
          city: "Mumbai",
          area: "Bandra",
          address: "2 Bandra Ave, Mumbai",
          contact: "9123456789",
          email: "lifeline@mumbai.com",
          password: hashedPass,
          qualification: "B.Pharm",
          stateCouncilReg: "M54321",
          drugLicenseRetail: "DLR-MUM-111",
          gstin: "27AAAPL7654C1ZV",
          identityProof: "Aadhar789",
          addressProof: "AddressProof789",
          photo: "https://randomuser.me/api/portraits/men/33.jpg",
          qualificationCert: "qual_cert3.pdf",
          councilCert: "council_cert3.pdf",
          retailLicense: "retail_license3.pdf",
          gstCert: "gst_cert3.pdf",
          bankAccount: "7894561230",
          ifsc: "SBIN0009012",
          declarationAccepted: true,
          pharmacyTimings: { is24Hours: false, open: "09:00 AM", close: "09:00 PM" },
          status: "approved"
        },
        {
          name: "QuickMeds Mumbai",
          ownerName: "Dr. V. Mehta",
          city: "Mumbai",
          area: "Andheri",
          address: "9 Andheri West, Mumbai",
          contact: "9988776655",
          email: "quickmeds@mumbai.com",
          password: hashedPass,
          qualification: "M.Pharm",
          stateCouncilReg: "M88888",
          drugLicenseRetail: "DLR-MUM-222",
          gstin: "27AAAPL9999C2ZV",
          identityProof: "Aadhar999",
          addressProof: "AddressProof999",
          photo: "https://randomuser.me/api/portraits/women/44.jpg",
          qualificationCert: "qual_cert4.pdf",
          councilCert: "council_cert4.pdf",
          retailLicense: "retail_license4.pdf",
          gstCert: "gst_cert4.pdf",
          bankAccount: "1122334455",
          ifsc: "SBIN0002233",
          declarationAccepted: true,
          pharmacyTimings: { is24Hours: false, open: "07:00 AM", close: "11:00 PM" },
          status: "approved"
        }
      ]);

    // --- Medicines ---
    const paracetamol = await Medicine.create({
      name: "Paracetamol 500mg",
      price: 30,
      mrp: 33,
      stock: 100,
      img: "https://img.freepik.com/free-vector/medicine-bottle-pills-isolated_1284-42391.jpg",
      category: "Painkiller",
      trending: true,
      pharmacy: healthPlusDelhi._id,
      description: "Pain and fever reducer"
    });

    const vitaminC = await Medicine.create({
      name: "Vitamin C 1000mg",
      price: 120,
      mrp: 135,
      stock: 50,
      img: "https://img.freepik.com/free-vector/medicine-bottle-pills-isolated_1284-42391.jpg",
      category: "Supplement",
      trending: true,
      pharmacy: cityMedDelhi._id,
      description: "Immunity booster"
    });

    const coughSyrup = await Medicine.create({
      name: "Cough Syrup 100ml",
      price: 70,
      mrp: 85,
      stock: 80,
      img: "https://img.freepik.com/free-vector/medicine-bottle-pills-isolated_1284-42391.jpg",
      category: "Cough & Cold",
      trending: false,
      pharmacy: healthPlusDelhi._id,
      description: "For cough and sore throat"
    });

    const sumo = await Medicine.create({
      name: "Sumo Tablet",
      price: 60,
      mrp: 75,
      stock: 40,
      img: "https://img.freepik.com/free-vector/medicine-bottle-pills-isolated_1284-42391.jpg",
      category: "Painkiller",
      trending: false,
      pharmacy: cityMedDelhi._id,
      description: "Pain relief"
    });

    const crocin = await Medicine.create({
      name: "Crocin Advance",
      price: 35,
      mrp: 45,
      stock: 60,
      img: "https://img.freepik.com/free-vector/medicine-bottle-pills-isolated_1284-42391.jpg",
      category: "Painkiller",
      trending: true,
      pharmacy: lifelineMumbai._id,
      description: "Effective on fever and headache"
    });

    const vitaminD = await Medicine.create({
      name: "Vitamin D3 60000 IU",
      price: 180,
      mrp: 220,
      stock: 30,
      img: "https://img.freepik.com/free-vector/medicine-bottle-pills-isolated_1284-42391.jpg",
      category: "Supplement",
      trending: false,
      pharmacy: quickMedsMumbai._id,
      description: "Bone and immunity support"
    });

    const paracetamol2 = await Medicine.create({
      name: "Paracetamol 500mg",
      price: 32,
      mrp: 35,
      stock: 55,
      img: "https://img.freepik.com/free-vector/medicine-bottle-pills-isolated_1284-42391.jpg",
      category: "Painkiller",
      trending: false,
      pharmacy: cityMedDelhi._id,
      description: "Pain and fever reducer"
    });

    const paracetamol3 = await Medicine.create({
      name: "Paracetamol 500mg",
      price: 33,
      mrp: 36,
      stock: 70,
      img: "https://img.freepik.com/free-vector/medicine-bottle-pills-isolated_1284-42391.jpg",
      category: "Painkiller",
      trending: false,
      pharmacy: lifelineMumbai._id,
      description: "Pain and fever reducer"
    });

    const coughSyrup2 = await Medicine.create({
      name: "Cough Syrup 100ml",
      price: 68,
      mrp: 82,
      stock: 60,
      img: "https://img.freepik.com/free-vector/medicine-bottle-pills-isolated_1284-42391.jpg",
      category: "Cough & Cold",
      trending: false,
      pharmacy: quickMedsMumbai._id,
      description: "For cough and sore throat"
    });

    // Link medicines to pharmacies
    healthPlusDelhi.medicines = [paracetamol._id, coughSyrup._id];
    await healthPlusDelhi.save();

    cityMedDelhi.medicines = [sumo._id, vitaminC._id, paracetamol2._id];
    await cityMedDelhi.save();

    lifelineMumbai.medicines = [crocin._id, paracetamol3._id];
    await lifelineMumbai.save();

    quickMedsMumbai.medicines = [vitaminD._id, coughSyrup2._id];
    await quickMedsMumbai.save();

    console.log("✅ Pharmacies and medicines seeded successfully!");
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("❌ SEED ERROR:", err);
    await mongoose.disconnect();
    process.exit(1);
  }
}

seed();
