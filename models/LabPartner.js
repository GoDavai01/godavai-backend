const mongoose = require("mongoose");

const docSchema = new mongoose.Schema(
  {
    docType: { type: String, default: "", trim: true },
    fileName: { type: String, default: "", trim: true },
    mimeType: { type: String, default: "", trim: true },
    fileSize: { type: Number, default: 0 },
    fileKey: { type: String, default: "", trim: true },
    fileUrl: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const labPartnerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, index: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    organization: { type: String, default: "", trim: true },
    city: { type: String, default: "Noida", trim: true, index: true },
    labAddress: { type: String, default: "", trim: true },
    serviceAreasText: { type: String, default: "", trim: true },
    areas: [{ type: String, trim: true }],
    homeCollectionAvailable: { type: Boolean, default: false },
    licenseNumber: { type: String, default: "", trim: true, index: true },
    documents: { type: [docSchema], default: [] }, // step-1 basic proof docs
    consentAccepted: { type: Boolean, default: false },
    consentAcceptedAt: { type: Date, default: null },
    preferredLanguage: { type: String, default: "hinglish", trim: true },
    partnerStatus: {
      type: String,
      enum: [
        "applied",
        "under_review",
        "docs_pending",
        "verification_in_review",
        "approved",
        "live",
        "suspended",
        "rejected",
      ],
      default: "under_review",
      index: true,
    },
    // Back-compat field kept for existing records/old admin views.
    kycStatus: { type: String, default: "pending", trim: true, index: true },
    statusNotes: { type: String, default: "", trim: true },
    approvedAt: { type: Date, default: null },
    liveAt: { type: Date, default: null },
    approvedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    passwordHash: { type: String, default: "" }, // optional; public form does not ask password
    active: { type: Boolean, default: false, index: true },
    verification: {
      businessIdentity: {
        legalEntityType: { type: String, default: "", trim: true },
        authorizedSignatoryName: { type: String, default: "", trim: true },
        authorizedSignatoryMobile: { type: String, default: "", trim: true },
        authorizedSignatoryEmail: { type: String, default: "", trim: true },
      },
      compliance: {
        stateRegistrationCertificate: { type: [docSchema], default: [] },
        panCardCopy: { type: [docSchema], default: [] },
        gstCertificate: { type: [docSchema], default: [] },
        gstNotApplicable: { type: String, default: "", trim: true }, // yes/no
        addressProof: { type: [docSchema], default: [] },
        authorizedSignatoryIdProof: { type: [docSchema], default: [] },
        nablCertificate: { type: [docSchema], default: [] }, // preferred, optional
        pathologistName: { type: String, default: "", trim: true },
        pathologistRegistrationNumber: { type: String, default: "", trim: true },
      },
      operations: {
        homeCollectionCapabilityConfirmed: { type: Boolean, default: false },
        ownPhlebotomistAvailable: { type: String, default: "", trim: true }, // yes/no
        phlebotomistCount: { type: Number, default: 0 },
        serviceRadiusKm: { type: String, default: "", trim: true },
        sameDayCollectionAvailable: { type: String, default: "", trim: true }, // yes/no
        sundayAvailability: { type: String, default: "", trim: true }, // yes/no
        reportTat: { type: String, default: "", trim: true },
        recollectionHandling: { type: String, default: "", trim: true },
      },
      banking: {
        accountHolderName: { type: String, default: "", trim: true },
        bankName: { type: String, default: "", trim: true },
        accountNumber: { type: String, default: "", trim: true },
        ifscCode: { type: String, default: "", trim: true },
        bankProof: { type: [docSchema], default: [] }, // cancelled cheque / bank proof
      },
      techReportFlow: {
        canUploadSignedPdfReport: { type: String, default: "", trim: true }, // yes/no
        canUpdateBookingStatusDigitally: { type: String, default: "", trim: true }, // yes/no
        canAcceptWhatsappBookings: { type: String, default: "", trim: true }, // yes/no
        usesLisSoftware: { type: String, default: "", trim: true }, // yes/no
        reportUploadTestPassed: { type: Boolean, default: false },
      },
      legalAgreement: {
        signedPartnerAgreement: { type: [docSchema], default: [] },
        consentForDocumentVerification: { type: Boolean, default: false },
        acceptanceOfCommercialTerms: { type: Boolean, default: false },
      },
      verificationChecklist: {
        docsCompleted: { type: Boolean, default: false },
        bankVerified: { type: Boolean, default: false },
        opsChecked: { type: Boolean, default: false },
        agreementSigned: { type: Boolean, default: false },
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.models.LabPartner || mongoose.model("LabPartner", labPartnerSchema);
