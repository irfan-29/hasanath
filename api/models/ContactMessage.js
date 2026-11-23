const mongoose = require("mongoose");

// Messages visitors send to the admin portal. A row exists whether or not the
// admin has replied, so the history stays readable and the reply is delivered
// as an in-app notification rather than being lost.
const contactMessageSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Copied at send time so the inbox still reads if the account is later
    // renamed or deleted.
    fromName: { type: String, default: "" },
    fromEmail: { type: String, default: "" },
    subject: { type: String, default: "", maxlength: 120 },
    message: { type: String, required: true, maxlength: 2000 },
    status: {
        type: String,
        enum: ["new", "read", "replied", "resolved"],
        default: "new",
        index: true
    },
    adminReply: { type: String, default: "" },
    repliedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    repliedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now, index: true }
});

contactMessageSchema.index({ status: 1, createdAt: -1 });
contactMessageSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("ContactMessage", contactMessageSchema);